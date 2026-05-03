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
  HrvSignalDump, HrvSessionData, CameraHrvConsent,
} from './hrv'
