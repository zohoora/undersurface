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
}

export interface PartMemory {
  id: string
  partId: string
  entryId: string
  content: string
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
