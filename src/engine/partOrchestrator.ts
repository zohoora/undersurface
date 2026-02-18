import type { Part, PauseEvent, PauseType, PartThought, EmotionalTone, IFSRole, PartAnnotations } from '../types'
import { buildPartMessages } from '../ai/partPrompts'
import { streamChatCompletion, analyzeEmotionAndDistress } from '../ai/openrouter'
import { parseAnnotations, isDelimiterPrefix, DELIMITER, fixGhostCapitalization } from '../ai/annotationParser'
import { db, generateId } from '../store/db'
import { getGlobalConfig } from '../store/globalConfig'
import { getSettings } from '../store/settings'
import { activateGrounding, isGroundingActive } from '../hooks/useGroundingMode'
import { trackEvent } from '../services/analytics'
import { getPartDisplayName, t } from '../i18n'
import { QuoteEngine } from './quoteEngine'
import { DisagreementEngine } from './disagreementEngine'
import { QuietTracker } from './quietTracker'
import { EchoEngine } from './echoEngine'
import { ThreadEngine } from './threadEngine'
import { RitualEngine } from './ritualEngine'

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
  onAnnotations?: (annotations: PartAnnotations, partColor: string) => void
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

  // Pre-warmed caches — loaded once in loadParts(), avoids repeated DB reads per thought
  private cachedProfile: import('../types').UserProfile | undefined
  private cachedSummaries: import('../types').EntrySummary[] | undefined

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
    const [dbParts, profile, summariesRaw] = await Promise.all([
      db.parts.toArray(),
      db.userProfile.get('current') as Promise<import('../types').UserProfile | undefined>,
      db.entrySummaries.orderBy('timestamp').reverse().toArray() as Promise<import('../types').EntrySummary[]>,
    ])
    this.cachedProfile = profile
    this.cachedSummaries = summariesRaw?.slice(0, 5)
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

    // Check emotion + distress periodically (combined LLM call, works in any language)
    if (Date.now() - this.lastEmotionCheck > this.EMOTION_CHECK_INTERVAL) {
      this.checkEmotionAndDistress(event.currentText)
    }

    // Echo check (before regular thought)
    const echo = await this.echoEngine.findEcho(event.currentText)
    if (echo) {
      this.callbacks.onEcho?.({
        text: echo.text,
        entryId: echo.entryId,
        date: echo.date,
        partId: 'echo',
        partName: t('echo.label'),
        partColor: '#A09A94',
        partColorLight: '#A09A9415',
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
          this.callbacks.onSilence?.(silencePart.id, getPartDisplayName(silencePart), silencePart.color, silencePart.colorLight)
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
    const recencyIndex = this.recentSpeakers.indexOf(part.id)
    const config = getGlobalConfig()

    // Recency penalty — don't repeat the same voice
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

    // Grounding mode: strongly favor self-role parts, suppress The Quiet One
    if (isGroundingActive()) {
      if (part.ifsRole === 'self') {
        score += config?.grounding?.selfRoleScoreBonus ?? 40
      } else {
        score -= config?.grounding?.otherRolePenalty ?? 30
      }
      if (part.id === 'quiet') score -= 60
    }

    // Quiet return bonus/penalty
    const quietParts = this.quietTracker.getQuietParts(this.parts)
    if (quietParts?.some(qp => qp.id === part.id)) {
      if (score < 30) score -= 40
    }
    if (this.quietTracker.isReturning(part)) {
      score *= this.quietTracker.getReturnBonus()
    }

    // The Quiet One: avoidance-aware scoring with strict cooldowns
    if (part.id === 'quiet') {
      score += this.scoreQuietOne(text, event.type, recencyIndex, config)
    }

    return score
  }

  private scoreQuietOne(
    text: string,
    pauseType: PauseType,
    recencyIndex: number,
    config: ReturnType<typeof getGlobalConfig>,
  ): number {
    if (config?.features?.quietOneEnabled !== true) return -200

    let adjustment = 0

    // Boost when text overlaps with known avoidance patterns
    const avoidancePatterns = this.cachedProfile?.avoidancePatterns
    if (avoidancePatterns?.length) {
      adjustment += this.avoidanceOverlap(avoidancePatterns, text)
    }

    // Steep recency penalty — should never speak twice in a session
    if (recencyIndex === 0) adjustment -= 80
    else if (recencyIndex === 1) adjustment -= 50

    // Only speak on avoidance-related pause types
    const AVOIDANCE_PAUSE_TYPES: PauseType[] = ['trailing_off', 'ellipsis', 'long_pause', 'cadence_slowdown']
    if (!AVOIDANCE_PAUSE_TYPES.includes(pauseType)) {
      adjustment -= 40
    }

    // Entry cooldown — must wait at least 3 entries between appearances
    const lastSpokeEntry = localStorage.getItem('quietOneLastSpokeEntry')
    if (lastSpokeEntry && this.getEntriesSinceQuietSpoke(lastSpokeEntry) < 3) {
      adjustment -= 100
    }

    return adjustment
  }

  private avoidanceOverlap(patterns: string[], text: string): number {
    const words = patterns.join(' ').toLowerCase().split(/\s+/).filter(w => w.length > 3)
    const matchCount = words.filter(w => text.includes(w)).length
    return Math.min(matchCount * 10, 30)
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
    // Use pre-warmed caches for profile/summaries; part.memories loaded in loadParts()
    const allMemories = (part.memories || []) as import('../types').PartMemory[]
    const profile = this.cachedProfile
    const entrySummaries = (part.ifsRole === 'manager' || part.ifsRole === 'self')
      ? this.cachedSummaries : undefined

    const [quote, thread, rituals] = await Promise.all([
      this.quoteEngine.findQuote(event.currentText),
      this.threadEngine.findUnfinishedThread(event.currentText),
      this.ritualEngine.detectRituals(),
    ])

    const config = getGlobalConfig()
    const userSettings = getSettings()
    const annotateHighlights = config?.features?.textHighlights === true && userSettings.textHighlights
    const annotateGhostText = config?.features?.ghostText === true && userSettings.ghostText
    const wantAnnotations = annotateHighlights || annotateGhostText

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
        annotateHighlights,
        annotateGhostText,
      },
    )

    this.callbacks.onThoughtStart(part.id, getPartDisplayName(part), part.color)

    // Delimiter buffering state for annotation suppression
    let delimiterBuffer = ''
    let pastDelimiter = false

    await streamChatCompletion(
      messages,
      {
        onToken: (token) => {
          if (pastDelimiter) return // suppress tokens after delimiter

          if (!wantAnnotations) {
            this.callbacks.onThoughtToken(token)
            return
          }

          // Buffer tokens that might be part of the delimiter
          for (const ch of token) {
            delimiterBuffer += ch

            if (isDelimiterPrefix(delimiterBuffer)) {
              if (delimiterBuffer === DELIMITER) {
                pastDelimiter = true
                delimiterBuffer = ''
                return
              }
              // Keep buffering — could still be the delimiter
            } else {
              // False alarm — flush buffer as display tokens
              this.callbacks.onThoughtToken(delimiterBuffer)
              delimiterBuffer = ''
            }
          }
        },
        onComplete: (fullText) => {
          // Flush any remaining buffer (partial delimiter that never completed)
          if (delimiterBuffer.length > 0 && !pastDelimiter) {
            this.callbacks.onThoughtToken(delimiterBuffer)
          }

          // Parse annotations from full text
          const { thoughtText, annotations } = wantAnnotations
            ? parseAnnotations(fullText)
            : { thoughtText: fullText, annotations: null }

          const thought: PartThought = {
            id: generateId(),
            partId: part.id,
            entryId: this.entryId,
            content: thoughtText.trim(),
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
          const trimmed = thoughtText.trim()
          if (trimmed.length > 20) {
            const contextSnippet = event.recentText.slice(-100).trim()
            const newMemory = {
              id: generateId(),
              partId: part.id,
              entryId: this.entryId,
              content: `Noticed: "${contextSnippet}" → Responded: "${trimmed}"`,
              type: 'observation' as const,
              timestamp: Date.now(),
            }
            db.memories.add(newMemory)
            // Keep in-memory cache in sync so subsequent thoughts see this memory
            if (part.memories) (part.memories as import('../types').PartMemory[]).push(newMemory)
          }

          this.callbacks.onThoughtComplete(thought)
          trackEvent('part_thought', { part_name: part.name, emotion: this.currentEmotion, pause_type: event.type })

          // Fire annotations callback (fix capitalization deterministically)
          if (annotations) {
            if (annotations.ghostText) {
              annotations.ghostText = fixGhostCapitalization(annotations.ghostText, event.recentText)
            }
            this.callbacks.onAnnotations?.(annotations, part.color)
          }

          // Track activity for quiet return system
          this.quietTracker.updateLastActive(part.id)

          // Record entry for The Quiet One cooldown
          if (part.id === 'quiet') {
            localStorage.setItem('quietOneLastSpokeEntry', this.entryId)
          }

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
                  // eslint-disable-next-line @typescript-eslint/no-unused-vars
                  const { isNew: _, ...toStore } = disagreementThought
                  db.thoughts.add(toStore)
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
      wantAnnotations ? 250 : 150,
    )
  }

  private async checkEmotionAndDistress(text: string) {
    this.lastEmotionCheck = Date.now()
    try {
      const { emotion, distressLevel } = await analyzeEmotionAndDistress(text)
      if (this.isValidEmotion(emotion)) {
        this.currentEmotion = emotion as EmotionalTone
        this.callbacks.onEmotionDetected(this.currentEmotion)
      }

      // Handle distress result
      this.handleDistressResult(distressLevel)
    } catch {
      // Emotion/distress check is non-critical; silently continue
    }
  }

  private handleDistressResult(level: number): void {
    const config = getGlobalConfig()
    if (config?.features?.emergencyGrounding !== true) return
    if (isGroundingActive()) return

    // Default threshold is 3 (safety concern only) — configurable via admin
    const threshold = config.grounding?.intensityThreshold ?? 3
    if (level >= threshold) {
      activateGrounding()
    }
  }

  resetSession() {
    this.echoEngine.reset()
  }

  private getEntriesSinceQuietSpoke(lastEntryId: string): number {
    if (lastEntryId === this.entryId) return 0
    if (!this.cachedSummaries?.length) return 1
    const lastIdx = this.cachedSummaries.findIndex(s => s.entryId === lastEntryId)
    if (lastIdx === -1) return 3
    return lastIdx
  }

  private isValidEmotion(tone: string): tone is EmotionalTone {
    return [
      'neutral', 'tender', 'anxious', 'angry', 'sad',
      'joyful', 'contemplative', 'fearful', 'hopeful', 'conflicted',
    ].includes(tone)
  }
}
