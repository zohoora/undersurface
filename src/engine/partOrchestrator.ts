import type { Part, PauseEvent, PauseType, PartThought, EmotionalTone, IFSRole } from '../types'
import { buildPartMessages } from '../ai/partPrompts'
import { streamChatCompletion, analyzeEmotion } from '../ai/openrouter'
import { db, generateId } from '../store/db'

const ROLE_PAUSE_AFFINITIES: Record<IFSRole, Record<PauseType, number>> = {
  protector: {
    short_pause: 5, sentence_complete: 10, cadence_slowdown: 20,
    paragraph_break: 10, long_pause: 5, ellipsis: 15, question: 5, trailing_off: 25,
  },
  exile: {
    short_pause: 5, sentence_complete: 10, cadence_slowdown: 15,
    paragraph_break: 10, long_pause: 25, ellipsis: 20, question: 10, trailing_off: 15,
  },
  self: {
    short_pause: 5, sentence_complete: 10, cadence_slowdown: 10,
    paragraph_break: 15, long_pause: 25, ellipsis: 10, question: 20, trailing_off: 10,
  },
  firefighter: {
    short_pause: 10, sentence_complete: 15, cadence_slowdown: 5,
    paragraph_break: 15, long_pause: 10, ellipsis: 5, question: 20, trailing_off: 5,
  },
  manager: {
    short_pause: 5, sentence_complete: 15, cadence_slowdown: 10,
    paragraph_break: 25, long_pause: 15, ellipsis: 10, question: 10, trailing_off: 10,
  },
}

const ROLE_KEYWORDS: Record<IFSRole, string[]> = {
  protector: ['avoid', 'ignore', 'pretend', 'fine', 'okay', 'whatever', 'anyway', 'but', 'should', 'just', 'never mind'],
  exile: ['hurt', 'miss', 'wish', 'love', 'feel', 'heart', 'pain', 'alone', 'cry', 'soft', 'remember', 'lost', 'need', 'warm'],
  self: ['wonder', 'what if', 'maybe', 'breathe', 'moment', 'notice', 'space', 'quiet', 'sit with', 'here', 'presence'],
  firefighter: ['do', 'change', 'act', 'move', 'enough', 'tired of', 'want', 'go', 'make', 'try', 'decide', 'fight', 'ready'],
  manager: ['again', 'always', 'every time', 'pattern', 'same', 'remind', 'before', 'back then', 'cycle', 'repeat', 'used to'],
}

const ROLE_EMOTIONS: Record<IFSRole, EmotionalTone[]> = {
  protector: ['anxious', 'conflicted', 'neutral'],
  exile: ['sad', 'tender', 'hopeful', 'fearful'],
  self: ['contemplative', 'neutral', 'tender'],
  firefighter: ['angry', 'conflicted', 'hopeful', 'joyful'],
  manager: ['contemplative', 'sad', 'conflicted'],
}

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
    return ROLE_PAUSE_AFFINITIES[part.ifsRole]?.[pauseType] ?? 10
  }

  private contentRelevance(part: Part, text: string): number {
    // Merge role keywords + concern words + learned keywords
    const roleKw = ROLE_KEYWORDS[part.ifsRole] || []
    const concernKw = part.concern.toLowerCase().split(/[,.\s]+/).filter((w) => w.length > 3)
    const learnedKw = part.learnedKeywords || []
    const allKeywords = [...new Set([...roleKw, ...concernKw, ...learnedKw])]

    let relevance = 0
    for (const keyword of allKeywords) {
      if (text.includes(keyword)) relevance += 8
    }
    return Math.min(relevance, 30)
  }

  private emotionMatch(part: Part, emotion: EmotionalTone): number {
    const roleEmotions = ROLE_EMOTIONS[part.ifsRole] || []
    const learnedEmotions = part.learnedEmotions || []
    const allEmotions = [...new Set([...roleEmotions, ...learnedEmotions])]
    return allEmotions.includes(emotion) ? 15 : 0
  }

  private async generateThought(part: Part, event: PauseEvent): Promise<void> {
    // Load fresh memories from db instead of stale in-memory cache
    const allMemories = await db.memories.where('partId').equals(part.id).toArray() as import('../types').PartMemory[]

    // Load user profile
    const profile = await db.userProfile.get('current') as import('../types').UserProfile | undefined

    // Load entry summaries for manager/self-role parts
    let entrySummaries: import('../types').EntrySummary[] | undefined
    if (part.ifsRole === 'manager' || part.ifsRole === 'self') {
      const allSummaries = await db.entrySummaries.orderBy('timestamp').reverse().toArray() as import('../types').EntrySummary[]
      entrySummaries = allSummaries.slice(0, 5)
    }

    const messages = buildPartMessages(
      part,
      event.currentText,
      event.recentText,
      allMemories,
      profile,
      entrySummaries,
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

          // Create observation memory from inline thought
          const trimmed = text.trim()
          if (trimmed.length > 20) {
            const contextSnippet = event.recentText.slice(-100).trim()
            db.memories.add({
              id: generateId(),
              partId: part.id,
              entryId: this.entryId,
              content: `Noticed: "${contextSnippet}" → Responded: "${trimmed}"`,
              type: 'observation',
              timestamp: Date.now(),
            })
          }

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
