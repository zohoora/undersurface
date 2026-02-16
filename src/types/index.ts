export type IFSRole = 'protector' | 'exile' | 'manager' | 'firefighter' | 'self'

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
  memories: PartMemory[]
  learnedKeywords?: string[]
  learnedEmotions?: EmotionalTone[]
  systemPromptAddition?: string
  growthVersion?: number
  lastGrowthAt?: number
  lastActiveAt?: number
  catchphrases?: string[]
  quietSince?: number
}

export type MemoryType = 'observation' | 'interaction' | 'reflection' | 'pattern'

export interface PartMemory {
  id: string
  partId: string
  entryId: string
  content: string
  type?: MemoryType
  timestamp: number
}

export interface DiaryEntry {
  id: string
  content: string
  plainText: string
  createdAt: number
  updatedAt: number
  thoughts: PartThought[]
  interactions: ThinkingOutLoudInteraction[]
}

export interface PartThought {
  id: string
  partId: string
  entryId: string
  content: string
  anchorText: string
  anchorOffset: number
  timestamp: number
  isNew: boolean
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
}

export interface UserProfile {
  id: string // always 'current'
  recurringThemes: string[]
  emotionalPatterns: string[]
  avoidancePatterns: string[]
  growthSignals: string[]
  innerLandscape: string
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
