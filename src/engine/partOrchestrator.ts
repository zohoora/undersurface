import type { Part, PauseEvent, PauseType, PartThought, EmotionalTone, IFSRole } from '../types'
import { buildPartMessages } from '../ai/partPrompts'
import { streamChatCompletion, analyzeEmotion } from '../ai/openrouter'
import { db, generateId } from '../store/db'
import { getGlobalConfig } from '../store/globalConfig'
import { activateGrounding, isGroundingActive } from '../hooks/useGroundingMode'
import { QuoteEngine } from './quoteEngine'
import { DisagreementEngine } from './disagreementEngine'
import { QuietTracker } from './quietTracker'
import { EchoEngine } from './echoEngine'
import { ThreadEngine } from './threadEngine'
import { RitualEngine } from './ritualEngine'

const DISTRESS_KEYWORDS = [
  'scared', 'terrified', 'panic', "can't breathe", 'shaking', 'spiraling',
  'drowning', 'overwhelmed', 'trapped', 'suffocating', 'falling apart',
  "can't stop", 'numb', 'frozen', 'dizzy', 'hyperventilating', 'dissociating',
  'losing it', "can't think", 'shutdown', 'shutting down',
]

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
  onDisagreementStart?: (partId: string, partName: string, partColor: string) => void
  onDisagreementToken?: (token: string) => void
  onDisagreementComplete?: (thought: PartThought) => void
  onEcho?: (echo: { text: string, entryId: string, date: number, partId: string, partName: string, partColor: string, partColorLight: string }) => void
  onSilence?: (partId: string, partName: string, partColor: string, partColorLight: string) => void
}

export class PartOrchestrator {
  private parts: Part[] = []
  private recentSpeakers: string[] = []
  private lastEmotionCheck: number = 0
  private currentEmotion: EmotionalTone = 'neutral'
  private isGenerating: boolean = false
  private entryId: string = ''
  private intention: string = ''
  private callbacks: OrchestratorCallbacks

  private quoteEngine = new QuoteEngine()
  private disagreementEngine = new DisagreementEngine()
  private quietTracker = new QuietTracker()
  private echoEngine = new EchoEngine()
  private threadEngine = new ThreadEngine()
  private ritualEngine = new RitualEngine()

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

  setIntention(v: string) {
    this.intention = v
  }

  isCurrentlyGenerating(): boolean {
    return this.isGenerating
  }

  async handlePause(event: PauseEvent): Promise<void> {
    if (getGlobalConfig()?.features?.partsEnabled === false) return
    if (this.isGenerating) return
    if (this.parts.length === 0) return
    if (event.currentText.trim().length < 20) return

    // Check emotion periodically
    if (Date.now() - this.lastEmotionCheck > this.EMOTION_CHECK_INTERVAL) {
      this.checkEmotion(event.currentText)
    }

    // Distress detection for emergency grounding
    this.checkDistress(event.currentText)

    // Echo check (before regular thought)
    const echo = await this.echoEngine.findEcho(event.currentText)
    if (echo) {
      // Find a relevant part for this echo
      const echoPart = this.parts[Math.floor(Math.random() * this.parts.length)]
      this.callbacks.onEcho?.({
        text: echo.text,
        entryId: echo.entryId,
        date: echo.date,
        partId: echoPart.id,
        partName: echoPart.name,
        partColor: echoPart.color,
        partColorLight: echoPart.colorLight,
      })
      return
    }

    // Silence as response (requires flow state check)
    const config = getGlobalConfig()
    if (config?.features?.silenceAsResponse === true) {
      const silenceChance = config.partIntelligence?.silenceChance ?? 0.2
      if (event.duration > (config.partIntelligence?.silenceFlowThreshold ?? 120) * 1000) {
        if (Math.random() < silenceChance) {
          const silencePart = this.parts[Math.floor(Math.random() * this.parts.length)]
          this.callbacks.onSilence?.(silencePart.id, silencePart.name, silencePart.color, silencePart.colorLight)
          return
        }
      }
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

    // Grounding mode: strongly favor self-role parts
    if (isGroundingActive()) {
      const config = getGlobalConfig()
      if (part.ifsRole === 'self') {
        score += config?.grounding?.selfRoleScoreBonus ?? 40
      } else {
        score -= config?.grounding?.otherRolePenalty ?? 30
      }
    }

    // Quiet return bonus/penalty
    const quietParts = this.quietTracker.getQuietParts(this.parts)
    if (quietParts?.some(qp => qp.id === part.id)) {
      // Quiet parts score near zero unless they have strong content match
      if (score < 30) score -= 40
    }
    if (this.quietTracker.isReturning(part)) {
      score *= this.quietTracker.getReturnBonus()
    }

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
    // Parallel DB reads — all independent, no need to be sequential
    const [allMemories, profile, summariesRaw, quote, thread, rituals] = await Promise.all([
      db.memories.where('partId').equals(part.id).toArray() as Promise<import('../types').PartMemory[]>,
      db.userProfile.get('current') as Promise<import('../types').UserProfile | undefined>,
      (part.ifsRole === 'manager' || part.ifsRole === 'self')
        ? db.entrySummaries.orderBy('timestamp').reverse().toArray() as Promise<import('../types').EntrySummary[]>
        : Promise.resolve(undefined),
      this.quoteEngine.findQuote(event.currentText),
      this.threadEngine.findUnfinishedThread(event.currentText),
      this.ritualEngine.detectRituals(),
    ])
    const entrySummaries = summariesRaw?.slice(0, 5)

    const messages = buildPartMessages(
      part,
      event.currentText,
      event.recentText,
      allMemories,
      profile,
      entrySummaries,
      {
        quotedPassage: quote ?? undefined,
        isQuietReturn: this.quietTracker.isReturning(part),
        catchphrases: part.catchphrases,
        threadContext: thread ?? undefined,
        ritualContext: rituals.length > 0 ? rituals[0].description : undefined,
        isGrounding: isGroundingActive() || undefined,
        intention: this.intention || undefined,
      },
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

          // Track activity for quiet return system
          this.quietTracker.updateLastActive(part.id)

          // Disagreement check — another part may push back
          const disagreePart = this.disagreementEngine.shouldDisagree(part, this.parts)
          if (disagreePart) {
            // Generate disagreement after a brief delay
            setTimeout(async () => {
              try {
                const disagreeText = await this.disagreementEngine.generateDisagreement(
                  disagreePart, thought.content, event.currentText,
                )
                if (disagreeText) {
                  const disagreementThought: PartThought = {
                    id: generateId(),
                    partId: disagreePart.id,
                    entryId: this.entryId,
                    content: disagreeText,
                    anchorText: event.recentText.slice(-50),
                    anchorOffset: event.cursorPosition,
                    timestamp: Date.now(),
                    isNew: true,
                    isDisagreement: true,
                    respondingToPartId: part.id,
                  }
                  db.thoughts.add({ ...disagreementThought, isNew: undefined })
                  this.callbacks.onDisagreementComplete?.(disagreementThought)
                }
              } catch (e) {
                console.error('Disagreement error:', e)
              }
            }, 2000)
          }
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

  resetSession() {
    this.echoEngine.reset()
  }

  private checkDistress(text: string): void {
    const config = getGlobalConfig()
    if (config?.features?.emergencyGrounding !== true) return
    if (isGroundingActive()) return

    const tail = text.slice(-500).toLowerCase()
    let hits = 0
    for (const kw of DISTRESS_KEYWORDS) {
      if (tail.includes(kw)) hits++
    }
    if (this.currentEmotion === 'anxious' || this.currentEmotion === 'fearful') {
      hits++
    }

    const threshold = config.grounding?.intensityThreshold ?? 3
    if (hits >= threshold) {
      activateGrounding()
    }
  }

  private isValidEmotion(tone: string): tone is EmotionalTone {
    return [
      'neutral', 'tender', 'anxious', 'angry', 'sad',
      'joyful', 'contemplative', 'fearful', 'hopeful', 'conflicted',
    ].includes(tone)
  }
}
