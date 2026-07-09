export type IFSRole = 'protector' | 'exile' | 'manager' | 'firefighter' | 'self'

export type InputMode = 'desktop' | 'mobile' | 'voice'

export type RegisterTierId = 'plain' | 'conversational' | 'literate' | 'scholarly'

export interface Part {
  id: string
  name: string
  color: string
  colorLight: string
  ifsRole: IFSRole
  voiceDescription: string
  concern: string
  systemPrompt: string
  isSeeded: boolean
  createdAt: number
  memories?: PartMemory[]
  learnedKeywords?: string[]
  learnedEmotions?: EmotionalTone[]
  systemPromptAddition?: string
  growthVersion?: number
  lastGrowthAt?: number
  lastActiveAt?: number
  catchphrases?: string[]
  quietSince?: number
}

export type MemoryType = 'observation' | 'interaction' | 'reflection' | 'pattern' | 'somatic'

export interface PartMemory {
  id: string
  partId: string
  entryId: string
  content: string
  type?: MemoryType
  timestamp: number
  source?: 'journal' | 'session'
  sessionId?: string
  bodyRegion?: string
  quote?: string
  emotion?: string
  intensity?: string
}

export interface DiaryEntry {
  id: string
  content: string
  plainText: string
  title?: string
  favorited?: boolean
  intention?: string
  inputMode?: InputMode
  createdAt: number
  updatedAt: number
  thoughts?: PartThought[]
  interactions?: ThinkingOutLoudInteraction[]
}

export interface PartThought {
  id: string
  partId: string
  entryId: string
  content: string
  anchorText: string
  anchorOffset: number
  timestamp: number
  isNew?: boolean
  isEcho?: boolean
  isSilence?: boolean
  isBlankPage?: boolean
  isQuote?: boolean
  isDisagreement?: boolean
  quotedText?: string
  quotedEntryId?: string
  respondingToPartId?: string
}

export interface ThinkingOutLoudInteraction {
  id: string
  thoughtId: string
  partId: string
  entryId: string
  partOpening: string
  userResponse: string | null
  partReply: string | null
  status: 'open' | 'user_responded' | 'complete' | 'closed'
  timestamp: number
}

export type SessionPhase = 'opening' | 'deepening' | 'closing'
export type SessionOpeningMethod = 'auto' | 'user_chose' | 'open_invitation'
export type EmergenceReason = 'emotional_gravity' | 'tension' | 'user_invitation'

export type SessionMode = 'standard' | 'real_talk'

// Relax mode — 4th session surface combining meditation, biofeedback, hypnotherapy.
// SessionType drives the breath target rate and narration script.
export type RelaxSessionType = 'breathwork' | 'body_scan' | 'safe_place' | 'open_awareness'
export type RelaxAudioTrack = 'none' | 'ocean' | 'forest' | 'drone' | 'binaural' | 'custom'
export type RelaxVisualMode = 'full' | 'minimal' | 'off'

// Persisted record of a single relax session. Stored under
// users/{uid}/relaxSessions/{id}. Sibling to hrvSessions — never bolted onto
// the parent chat Session.
export interface RelaxSession {
  id: string
  // Parent chat session id, if relax was entered from inside a session.
  // Null if/when relax is launched standalone (future: not in v1).
  parentSessionId: string | null
  startedAt: number
  endedAt: number | null
  sessionType: RelaxSessionType
  // Planned duration in minutes (5 / 10 / 20). Actual elapsed = endedAt - startedAt.
  duration: number
  audioTrack: RelaxAudioTrack
  voiceEnabled: boolean
  visualMode: RelaxVisualMode
  // For audioTrack === 'custom' only. The prompt the user described and the
  // hash that addresses the cached generated audio. The signed URL is NOT
  // persisted (it expires); we keep the hash for analytics + cache lookup
  // when re-opening a closed session.
  customAudioPrompt?: string | null
  customAudioHash?: string | null
  // True if user reached the planned duration. False if ended early.
  completed: boolean
  // Snapshot of HRV deltas if biometrics were on. Null if HRV was off or
  // calibration never produced a baseline.
  hrvSummary: {
    startCoherence: number | null
    endCoherence: number | null
    startHr: number | null
    endHr: number | null
    samplesCount: number
  } | null
}

// Drift — a flag-gated (driftEnabled) bilateral dual-attention regulation
// practice launched from Relax; the reprocessing loop is deliberately designed
// out (the flow always resolves toward settling, never re-invoking the starting
// point once left). Persisted under users/{uid}/driftSessions/{id}. Sibling to
// relaxSessions — never bolted onto the parent chat Session.
export type DriftOutcome = 'settled' | 'eased_early' | 'aborted_to_grounding' | 'abandoned'
export type DriftBlsChannel = 'audio' | 'visual'
export type DriftAnchorKind = 'calm_place' | 'feet'
export interface DriftTranscriptEntry {
  role: 'user' | 'companion' | 'cue'
  content: string
  atMs: number
}
export interface DriftSession {
  id: string
  // Parent chat session id if Drift was entered from inside a session; null when standalone.
  parentSessionId: string | null
  startedAt: number
  endedAt: number | null
  outcome: DriftOutcome | null
  setCount: number
  interweavesUsed: string[]
  transcript: DriftTranscriptEntry[]
  anchorKind: DriftAnchorKind
  blsChannel: DriftBlsChannel
  // v2: the chosen practice length (quick ~2min / short ~4min / full ~6min).
  // Optional — v1 records predate it. Literal union to avoid an engine import.
  length?: 'quick' | 'short' | 'full'
  voiceUsed: boolean
  hrvPresent: boolean
}

export interface Session {
  id: string
  startedAt: number
  endedAt: number | null
  status: 'active' | 'closed'
  hostPartId: string
  participantPartIds: string[]
  openingMethod: SessionOpeningMethod
  chosenPartId?: string
  sessionNote: string | null
  messageCount: number
  firstLine: string
  phase: SessionPhase
  favorited?: boolean
  // Tone variant for the therapist persona. Optional for backward compat —
  // legacy sessions without this field are treated as 'standard'.
  mode?: SessionMode
  // Per-session toggle for parts responding when the user pauses inside the
  // unified Journal surface. Read with `journalPartsEnabled !== false` so
  // legacy sessions (undefined) default to true (opt-out semantics).
  journalPartsEnabled?: boolean
  // One-tap closing check-in ("How are you leaving?"), skippable — absent
  // when skipped or when the stanceAdaptation flag is off.
  leavingFeeling?: 'heavier' | 'same' | 'shade_lighter' | 'lighter' | 'much_lighter'
}

export interface SessionMessage {
  id: string
  speaker: 'user' | 'part' | 'therapist'
  partId: string | null
  partName: string | null
  content: string
  timestamp: number
  phase: SessionPhase
  isEmergence: boolean
  emergenceReason?: EmergenceReason
  inputMethod?: 'text' | 'voice'
  userInputMode?: InputMode
}

export type PauseType =
  | 'short_pause'
  | 'sentence_complete'
  | 'cadence_slowdown'
  | 'paragraph_break'
  | 'long_pause'
  | 'ellipsis'
  | 'question'
  | 'trailing_off'

export interface PauseEvent {
  type: PauseType
  duration: number
  currentText: string
  cursorPosition: number
  recentText: string
  timestamp: number
}

export type EmotionalTone =
  | 'neutral'
  | 'tender'
  | 'anxious'
  | 'angry'
  | 'sad'
  | 'joyful'
  | 'contemplative'
  | 'fearful'
  | 'hopeful'
  | 'conflicted'

export interface AtmosphereState {
  tone: EmotionalTone
  intensity: number
  gradientColors: [string, string, string]
}

export interface EntrySummary {
  id: string
  entryId: string
  themes: string[]
  emotionalArc: string
  keyMoments: string[]
  timestamp: number
  contentHash?: string
}

export interface UserProfile {
  id: string // always 'current'
  recurringThemes: string[]
  emotionalPatterns: string[]
  avoidancePatterns: string[]
  growthSignals: string[]
  innerLandscape: string
  lastUpdated: number
  linguisticRegister?: RegisterTierId
  lastClassifiedAtEntryCount?: number
}

// LLM owns merge: returns the full updated object each session, not a delta —
// avoids hand-rolled dedup against fuzzy name/date variants.
export interface PersonalFacts {
  id: string // always 'current'
  people: Array<{
    name: string
    relationship?: string // "wife", "best friend", "dog", "therapist"
    notes?: string // brief description, important context
  }>
  dates: Array<{
    event: string // "anniversary", "Sarah's birthday", "started new job"
    date: string // ISO 8601 if known, else descriptive ("around March")
  }>
  context: Array<{
    category: string // "location", "occupation", "age", "family structure"
    value: string
  }>
  currentThreads: Array<{
    topic: string // "job interview Thursday", "mom in hospital"
    addedAt: number // Unix ms — for soft staleness; LLM drops resolved threads
  }>
  // Shared language: phrases the WRITER coined in sessions ("the basement",
  // "the gray days"). Harvested by the reflection pass, cap 12, used by the
  // companion naturally and sparingly — their words, their sense.
  lexicon?: string[]
  lastUpdated: number
}

export interface InnerWeather {
  id: string
  dominantEmotion: string
  secondaryEmotion?: string
  intensity: number
  trend: 'rising' | 'falling' | 'steady'
  updatedAt: number
}

export interface PartLetter {
  id: string
  partIds: string[]
  content: string
  triggerType: 'milestone' | 'pattern' | 'growth'
  createdAt: number
  isRead: boolean
}

export interface SessionRitual {
  id: string
  pattern: string
  description: string
  detectedAt: number
  sessionCount: number
}

export interface EntryFossil {
  id: string
  entryId: string
  partId: string
  commentary: string
  createdAt: number
}

export interface SessionLog {
  id: string
  startedAt: number
  endedAt?: number
  duration?: number
  wordCount: number
  timeOfDay: string
  dayOfWeek: number
}

// Rupture / rumination signal state (singleton doc 'current'). Written by the
// context loader (open-time rupture evidence), the reflection engine
// (terse-ending marker, cross-session loop streak), and the session stream
// (consume-once repair clearing). Spec:
// docs/superpowers/specs/2026-07-03-rupture-rumination-design.md
export type RuptureEvidence = 'abandoned' | 'terse_ending' | 'atypical_gap'

export interface CompanionSignals {
  id: 'current'
  // Single slot; newest evidence wins. Cleared by the opener that uses it —
  // a repair that repeats becomes an accusation.
  pendingRepair: {
    evidence: RuptureEvidence
    sourceSessionId: string
    createdAt: number
  } | null
  // Armed after 3 consecutive loop sessions (LLM judges recurrence; client
  // only counts). theme is model output — treat as untrusted in prompts.
  ruminationWatch: {
    theme: string
    streak: number
    lastConfirmedAt: number
  } | null
  // Stamped BEFORE the one-time user-parts history backfill starts (claim-
  // first: an interrupted run never repeats; partial seeding is acceptable).
  partsBackfillAt?: number
  // One noticing carried between sessions (consume-once at the next opener).
  carriedNoticing?: { text: string; fromSessionId: string; createdAt: number } | null
  // Cooldown stamp for story-arc reflections (>= 30 days between arcs).
  lastArcAt?: number
  // A generated arc awaiting delivery (consume-once, non-opener turns).
  pendingArc?: { text: string; createdAt: number } | null
  updatedAt: number
}

// A part of the USER, mapped collaboratively (proposed by the companion,
// confirmed and named by the user — never diagnosed at them). Distinct from
// the companion's own parts (SEEDED_PARTS). Spec:
// docs/superpowers/specs/2026-07-04-user-parts-model-design.md
export interface UserPart {
  id: string
  // The user's words. Tentative (companion-suggested) until confirmed.
  name: string
  description: string
  // Internal soft descriptor guiding companion tone. NEVER shown to the user;
  // regenerated by the reflection pass as the part changes.
  stance: string
  status: 'candidate' | 'active' | 'retired'
  evidence: { sessionId: string; quote: string; observedAt: number }[]
  // Distinct sessions with evidence — the proposal threshold counts these.
  sessionsSeen: number
  dismissedCount: number
  proposedAt?: number
  confirmedAt?: number
  retiredAt?: number
  lastActiveAt: number
  createdAt: number
  updatedAt: number
}

// A between-session intention in the writer's own words ("the thread").
// Volunteered intentions come straight from reflection; companion-offered ones
// require the IntentionCard. Cap 3 open — scarcity keeps it meaningful.
// Spec: docs/superpowers/specs/2026-07-04-intentions-and-stance-design.md
export interface SessionIntention {
  id: string
  text: string
  sessionId: string
  status: 'open' | 'kept' | 'adapted' | 'released' | 'expired'
  askedCount: number
  // Three "not yet"s make the avoidance itself material — named once, then
  // patternNamed prevents repeats.
  notYetCount: number
  patternNamed: boolean
  // The user value this intention serves, when the reflection pass linked one.
  valueId?: string
  lastAskedAt?: number
  resolvedAt?: number
  outcomeNote?: string
  createdAt: number
  updatedAt: number
}

// Internal N-of-1 stance profile (singleton 'current'): what ways of working
// actually help THIS writer, learned from their own sessions. Plain-language
// entries (a future transparency panel is pure rendering). Never touches
// safety behavior.
export interface StanceProfile {
  id: 'current'
  rawObservations: {
    observation: string
    direction: 'helped' | 'hindered' | 'unclear'
    sessionId: string
    createdAt: number
  }[]
  entries: string[]
  consolidatedAt?: number
  updatedAt: number
}

// A value of the USER — what matters to them, in their words. Same
// collaborative grammar as UserPart (proposed by the companion, confirmed and
// named by the writer). Spec: docs/superpowers/specs/2026-07-04-companion-depth-program.md
export interface UserValue {
  id: string
  name: string          // writer's words; tentative until confirmed
  description: string
  status: 'candidate' | 'active' | 'retired'
  evidence: { sessionId: string; quote: string; observedAt: number }[]
  sessionsSeen: number
  dismissedCount: number
  proposedAt?: number
  confirmedAt?: number
  retiredAt?: number
  lastActiveAt: number
  createdAt: number
  updatedAt: number
}

// A promise the COMPANION made and must visibly keep (cap 2 active). Never
// silently dropped — a missed dated promise is acknowledged.
export interface CompanionPromise {
  id: string
  text: string
  dueKind: 'next_session' | 'date'
  dueDate?: string       // ISO date when dueKind === 'date'
  status: 'active' | 'kept' | 'acknowledged_missed'
  sessionId: string      // born in
  createdAt: number
  keptAt?: number
  updatedAt: number
}

export interface GuidedExploration {
  id: string
  prompt: string
  source: 'theme' | 'thread' | 'pattern' | 'avoidance'
  sourceDetail?: string
}

export interface PartAnnotations {
  highlights?: string[]
  ghostText?: string
}

export interface ConsentRecord {
  id: string
  acceptedAt: number
  acceptedVersion: string
  disclaimerAccepted: boolean
  privacyAccepted: boolean
}

export interface ApiKey {
  id: string
  hash: string
  name: string
  createdAt: number
  lastUsedAt: number | null
}

export type BodyRegion = 'head' | 'eyes' | 'throat' | 'chest' | 'stomach' | 'shoulders' | 'hands' | 'back' | 'hips' | 'legs'

export interface SomaticSignal {
  bodyRegion: BodyRegion
  quote: string
  emotion: string
  intensity: 'low' | 'medium' | 'high'
}

export interface SomaticMemory {
  id: string
  partId: '_somatic'
  entryId: string
  content: string
  type: 'somatic'
  bodyRegion: BodyRegion
  quote: string
  emotion: string
  intensity: 'low' | 'medium' | 'high'
  timestamp: number
}

export interface HomunculusRegionState {
  signalCount: number
  dominantEmotions: Array<{ emotion: string; count: number; color: string }>
  sizeFactor: number
  fillColor: string
  quotes: Array<{ text: string; date: string; entryId: string }>
}

export type HomunculusState = Record<BodyRegion, HomunculusRegionState>

export type {
  AutonomicState, HrvTrend, HrvDerivedMetrics, HrvMeasurement, HrvError,
  HrvConversationEventType, HrvTimelineEvent, HrvShift,
  HrvSignalDump, HrvSessionData, CameraHrvConsent, PolarH10Consent, HrvSource,
  HrvRespiratoryDiagnostics, RespiratoryEstimate, LandmarkerState,
} from './hrv'
