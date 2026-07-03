import type { Part, PauseEvent, PauseType, PartThought, EmotionalTone, IFSRole } from '../types'
import type { AutonomicState } from '../types/hrv'
import { buildPartMessages } from '../ai/partPrompts'
import { streamChatCompletion, analyzeEmotionAndDistress, classifyCrisisRisk, reasoningForSpeed } from '../ai/openrouter'
import { db, generateId } from '../store/db'
import { getGlobalConfig } from '../store/globalConfig'
import { getSettings } from '../store/settings'
import { activateGrounding, isGroundingActive } from '../store/groundingState'
import { detectCrisisKeywords } from './sessionOrchestrator'
import { trackEvent } from '../services/analytics'
import { getPartDisplayName, t, getLanguageCode } from '../i18n'
import { QuoteEngine } from './quoteEngine'
import { DisagreementEngine } from './disagreementEngine'
import { QuietTracker } from './quietTracker'
import { engineLog } from '../services/diagnostics'
import { EchoEngine } from './echoEngine'
import { ThreadEngine } from './threadEngine'
import { RitualEngine } from './ritualEngine'

// ROLE_PAUSE_AFFINITIES — pause-type × IFS-role weights added to a part's
// selection score (consumed by `pauseTypeAffinity()` below). Higher = this
// role is more likely to be the one with something to say after that kind of
// pause. Scale: 5 (mismatch) → 10 (baseline / unknown lookup) → 25 (signature
// pause). Rows aren't normalized; a tall peak makes a role decisive on its
// pause, not louder overall.
//
//   protector:   loudest at trailing-off and cadence slowdown — the lid
//                wobbling is the Protector's territory by definition.
//   exile:       long pauses and ellipses — exiles surface slowly, in the
//                silence that makes room for what's tender.
//   self:        shares the long-pause peak with exile (disambiguation via
//                content/emotion scoring); owns the question pause —
//                curious, listening to oneself.
//   firefighter: intentionally no 25-peak. Firefighters are reactive,
//                surfacing in "okay, now what" moments (questions,
//                completions, breaks) rather than owning a single pause.
//   manager:     paragraph break — managers organize experience into
//                chunks; the writer hitting return is doing that move.
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

// Autonomic-state bias on part scoring — softer than grounding (which uses ±40/±30),
// since HRV-activated is a precursor to distress, not distress itself. 'transitioning'
// is intentionally excluded by the call site.
const HRV_ROLE_BIAS: Record<Exclude<AutonomicState, 'transitioning'>, Record<IFSRole, number>> = {
  activated: { self: 20, protector: -8, firefighter: -10, exile: 0, manager: -5 },
  calm: { self: 0, protector: 0, firefighter: 0, exile: 8, manager: 0 },
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
  private quietOneLastSpokeEntry: string | null = null
  private hrvState: AutonomicState | null = null
  private voiceActive: boolean = false
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

  // L2 crisis classifier rate limit. The pause flow can fire many times per
  // second on rapid pause events; without this, identical text would be
  // re-classified repeatedly. 10s is short enough that fresh writing is
  // covered, long enough to suppress redundant calls.
  private readonly CRISIS_CHECK_RATE_LIMIT_MS = 10_000
  private lastCrisisCheckSample = ''
  private lastCrisisCheckTime = 0

  constructor(callbacks: OrchestratorCallbacks) {
    this.callbacks = callbacks
  }

  getParts(): Part[] {
    return this.parts
  }

  addPart(part: Part): void {
    this.parts.push(part)
  }

  async loadParts() {
    const [dbParts, profile, summariesRaw] = await Promise.all([
      db.parts.toArray(),
      db.userProfile.get('current'),
      db.entrySummaries.orderBy('timestamp').reverse().toArray(),
    ])
    this.cachedProfile = profile
    this.cachedSummaries = summariesRaw?.slice(0, 5)
    this.parts = await Promise.all(
      dbParts.map(async (p) => {
        const memories = await db.memories
          .where('partId')
          .equals(p.id)
          .toArray()
        // No orderBy on the query, so Firestore returns doc-ID order — random
        // relative to time (ids are UUIDs). Prompt builders slice(-n) expecting
        // chronological order; sort ascending so the tail is genuinely newest.
        memories.sort((a, b) => a.timestamp - b.timestamp)
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

  /** Soft autonomic bias on scoring + pacing. null disables the bias. */
  setHrvState(state: AutonomicState | null) {
    this.hrvState = state
  }

  /**
   * Suppress part generation while the user is speaking. Mirrors the typing
   * suppression (parts wait their turn). Does not affect grounding state.
   */
  setVoiceActive(active: boolean) {
    this.voiceActive = active
  }

  isCurrentlyGenerating(): boolean {
    return this.isGenerating
  }

  async handlePause(event: PauseEvent): Promise<void> {
    if (getGlobalConfig()?.features?.partsEnabled === false) return
    if (this.voiceActive) return
    if (this.isGenerating) return
    if (this.parts.length === 0) {
      engineLog('warn', 'parts.empty_active_set', 'pause fired with no active parts loaded', { sessionId: this.entryId })
      return
    }
    if (event.currentText.trim().length < 20) return

    // Crisis detection (L1 sync regex + L2 async classifier). Fired
    // before part selection so grounding state is fresh when scorePart
    // applies the self-role bias (+40) below. L2 is non-blocking and
    // rate-limited; subsequent pauses on the same text skip the call.
    this.checkCrisisInJournalMode(event.currentText)

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
    } else if (this.hrvState && this.hrvState !== 'transitioning') {
      score += HRV_ROLE_BIAS[this.hrvState][part.ifsRole] ?? 0
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
    const lastSpokeEntry = this.quietOneLastSpokeEntry
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
    const allMemories = part.memories || []
    const profile = this.cachedProfile
    const entrySummaries = (part.ifsRole === 'manager' || part.ifsRole === 'self')
      ? this.cachedSummaries : undefined

    const [quote, thread, rituals] = await Promise.all([
      this.quoteEngine.findQuote(event.currentText),
      this.threadEngine.findUnfinishedThread(event.currentText),
      this.ritualEngine.detectRituals(),
    ])

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

    this.callbacks.onThoughtStart(part.id, getPartDisplayName(part), part.color)

    await streamChatCompletion(
      messages,
      {
        onToken: (token) => {
          this.callbacks.onThoughtToken(token)
        },
        onComplete: (fullText) => {
          const thoughtText = fullText
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
            if (part.memories) part.memories.push(newMemory)
          }

          this.callbacks.onThoughtComplete(thought)
          // No `emotion` param: detected emotional state is sensitive-category
          // data and GA is linked to the user id + Ads conversions.
          trackEvent('part_thought', { part_name: part.name, pause_type: event.type })

          // Track activity for quiet return system
          this.quietTracker.updateLastActive(part.id)

          // Record entry for The Quiet One cooldown
          if (part.id === 'quiet') {
            this.quietOneLastSpokeEntry = this.entryId
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
      150,
      reasoningForSpeed(getSettings().responseSpeed),
    )
  }

  private async checkEmotionAndDistress(text: string) {
    this.lastEmotionCheck = Date.now()
    try {
      // distressLevel is no longer consumed — L2 (classifyCrisisRisk) owns
      // grounding decisions now. Emotion still feeds part scoring + UI.
      const { emotion } = await analyzeEmotionAndDistress(text)
      if (this.isValidEmotion(emotion)) {
        this.currentEmotion = emotion as EmotionalTone
        this.callbacks.onEmotionDetected(this.currentEmotion)
      }
    } catch {
      // Emotion check is non-critical; silently continue
    }
  }

  // L1 (sync regex) + L2 (async classifier) for crisis detection in journal
  // mode. L1 fires immediately if hit; L2 fires non-blocking with a 10s
  // rate limit on identical text. Either layer activating grounding biases
  // part selection toward self-role parts via the existing scorePart logic.
  private checkCrisisInJournalMode(text: string): void {
    if (detectCrisisKeywords(text)) {
      activateGrounding('auto')
      return
    }

    const sample = text.slice(-1000)
    const now = Date.now()
    if (
      sample === this.lastCrisisCheckSample
      && now - this.lastCrisisCheckTime < this.CRISIS_CHECK_RATE_LIMIT_MS
    ) {
      return
    }
    this.lastCrisisCheckSample = sample
    this.lastCrisisCheckTime = now

    classifyCrisisRisk(sample, getLanguageCode())
      .then(result => {
        if (result.risk === 2) {
          activateGrounding('auto')
        }
      })
      .catch(() => { /* fail-open inside classifyCrisisRisk */ })
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
