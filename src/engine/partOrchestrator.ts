import type { Part, PauseEvent, PauseType, PartThought, EmotionalTone } from '../types'
import { buildPartMessages } from '../ai/partPrompts'
import { streamChatCompletion, analyzeEmotion } from '../ai/openrouter'
import { db, generateId } from '../store/db'
import { getSettings } from '../store/settings'

interface OrchestratorCallbacks {
  onThoughtStart: (partId: string, partName: string, partColor: string) => void
  onThoughtToken: (token: string) => void
  onThoughtComplete: (thought: PartThought) => void
  onEmotionDetected: (tone: EmotionalTone) => void
  onError: (error: Error) => void
}

export class PartOrchestrator {
  private parts: Part[] = []
  private recentSpeakers: string[] = []
  private lastEmotionCheck: number = 0
  private currentEmotion: EmotionalTone = 'neutral'
  private isGenerating: boolean = false
  private entryId: string = ''
  private callbacks: OrchestratorCallbacks

  private readonly MAX_RECENT_SPEAKERS = 3
  private readonly EMOTION_CHECK_INTERVAL = 30000

  constructor(callbacks: OrchestratorCallbacks) {
    this.callbacks = callbacks
  }

  async loadParts() {
    const dbParts = await db.parts.toArray()
    this.parts = await Promise.all(
      dbParts.map(async (p) => {
        const memories = await db.memories
          .where('partId')
          .equals(p.id)
          .toArray()
        return { ...p, memories } as Part
      }),
    )
  }

  setEntryId(id: string) {
    this.entryId = id
  }

  isCurrentlyGenerating(): boolean {
    return this.isGenerating
  }

  async handlePause(event: PauseEvent): Promise<void> {
    if (this.isGenerating) return
    if (this.parts.length === 0) return
    if (event.currentText.trim().length < 20) return
    if (!getSettings().openRouterApiKey) return

    // Check emotion periodically
    if (Date.now() - this.lastEmotionCheck > this.EMOTION_CHECK_INTERVAL) {
      this.checkEmotion(event.currentText)
    }

    const selectedPart = this.selectPart(event)
    if (!selectedPart) return

    this.isGenerating = true
    await this.generateThought(selectedPart, event)
    this.isGenerating = false
  }

  private selectPart(event: PauseEvent): Part | null {
    const scored = this.parts.map((part) => ({
      part,
      score: this.scorePart(part, event),
    }))

    scored.sort((a, b) => b.score - a.score)

    const top = scored[0]
    if (top.score <= 0) return null
    return top.part
  }

  private scorePart(part: Part, event: PauseEvent): number {
    let score = 0
    const text = event.recentText.toLowerCase()

    // Recency penalty — don't repeat the same voice
    const recencyIndex = this.recentSpeakers.indexOf(part.id)
    if (recencyIndex === 0) score -= 50
    else if (recencyIndex === 1) score -= 25

    // Pause type affinity
    score += this.pauseTypeAffinity(part, event.type)

    // Content relevance
    score += this.contentRelevance(part, text)

    // Emotional match
    score += this.emotionMatch(part, this.currentEmotion)

    // Add some randomness for organic feel
    score += Math.random() * 15

    return score
  }

  private pauseTypeAffinity(part: Part, pauseType: PauseType): number {
    const affinities: Record<string, Record<PauseType, number>> = {
      watcher: {
        short_pause: 5,
        sentence_complete: 10,
        cadence_slowdown: 20,
        paragraph_break: 10,
        long_pause: 5,
        ellipsis: 15,
        question: 5,
        trailing_off: 25,
      },
      tender: {
        short_pause: 5,
        sentence_complete: 10,
        cadence_slowdown: 15,
        paragraph_break: 10,
        long_pause: 25,
        ellipsis: 20,
        question: 10,
        trailing_off: 15,
      },
      still: {
        short_pause: 5,
        sentence_complete: 10,
        cadence_slowdown: 10,
        paragraph_break: 15,
        long_pause: 25,
        ellipsis: 10,
        question: 20,
        trailing_off: 10,
      },
      spark: {
        short_pause: 10,
        sentence_complete: 15,
        cadence_slowdown: 5,
        paragraph_break: 15,
        long_pause: 10,
        ellipsis: 5,
        question: 20,
        trailing_off: 5,
      },
      weaver: {
        short_pause: 5,
        sentence_complete: 15,
        cadence_slowdown: 10,
        paragraph_break: 25,
        long_pause: 15,
        ellipsis: 10,
        question: 10,
        trailing_off: 10,
      },
    }

    return affinities[part.id]?.[pauseType] ?? 10
  }

  private contentRelevance(part: Part, text: string): number {
    const keywords: Record<string, string[]> = {
      watcher: ['avoid', 'ignore', 'pretend', 'fine', 'okay', 'whatever', 'anyway', 'but', 'should', 'just', 'never mind'],
      tender: ['hurt', 'miss', 'wish', 'love', 'feel', 'heart', 'pain', 'alone', 'cry', 'soft', 'remember', 'lost', 'need', 'warm'],
      still: ['wonder', 'what if', 'maybe', 'breathe', 'moment', 'notice', 'space', 'quiet', 'sit with', 'here', 'presence'],
      spark: ['do', 'change', 'act', 'move', 'enough', 'tired of', 'want', 'go', 'make', 'try', 'decide', 'fight', 'ready'],
      weaver: ['again', 'always', 'every time', 'pattern', 'same', 'remind', 'before', 'back then', 'cycle', 'repeat', 'used to'],
    }

    const partKeywords = keywords[part.id] || []
    let relevance = 0
    for (const keyword of partKeywords) {
      if (text.includes(keyword)) relevance += 8
    }
    return Math.min(relevance, 30)
  }

  private emotionMatch(part: Part, emotion: EmotionalTone): number {
    const affinities: Record<string, EmotionalTone[]> = {
      watcher: ['anxious', 'conflicted', 'neutral'],
      tender: ['sad', 'tender', 'hopeful', 'fearful'],
      still: ['contemplative', 'neutral', 'tender'],
      spark: ['angry', 'conflicted', 'hopeful', 'joyful'],
      weaver: ['contemplative', 'sad', 'conflicted'],
    }

    const partAffinities = affinities[part.id] || []
    return partAffinities.includes(emotion) ? 15 : 0
  }

  private async generateThought(part: Part, event: PauseEvent): Promise<void> {
    const memories = part.memories.map((m) => m.content).slice(-5)

    const messages = buildPartMessages(
      part,
      event.currentText,
      event.recentText,
      memories,
    )

    this.callbacks.onThoughtStart(part.id, part.name, part.color)

    await streamChatCompletion(
      messages,
      {
        onToken: (token) => {
          this.callbacks.onThoughtToken(token)
        },
        onComplete: (text) => {
          const thought: PartThought = {
            id: generateId(),
            partId: part.id,
            entryId: this.entryId,
            content: text.trim(),
            anchorText: event.recentText.slice(-50),
            anchorOffset: event.cursorPosition,
            timestamp: Date.now(),
            isNew: true,
          }

          this.recentSpeakers.unshift(part.id)
          this.recentSpeakers = this.recentSpeakers.slice(0, this.MAX_RECENT_SPEAKERS)

          // Persist thought
          db.thoughts.add({
            id: thought.id,
            partId: thought.partId,
            entryId: thought.entryId,
            content: thought.content,
            anchorText: thought.anchorText,
            anchorOffset: thought.anchorOffset,
            timestamp: thought.timestamp,
          })

          this.callbacks.onThoughtComplete(thought)
        },
        onError: (error) => {
          this.callbacks.onError(error)
        },
      },
      150,
    )
  }

  private async checkEmotion(text: string) {
    this.lastEmotionCheck = Date.now()
    try {
      const emotion = await analyzeEmotion(text)
      if (this.isValidEmotion(emotion)) {
        this.currentEmotion = emotion as EmotionalTone
        this.callbacks.onEmotionDetected(this.currentEmotion)
      }
    } catch {
      // Emotion check is non-critical; silently continue
    }
  }

  private isValidEmotion(tone: string): tone is EmotionalTone {
    return [
      'neutral', 'tender', 'anxious', 'angry', 'sad',
      'joyful', 'contemplative', 'fearful', 'hopeful', 'conflicted',
    ].includes(tone)
  }
}
