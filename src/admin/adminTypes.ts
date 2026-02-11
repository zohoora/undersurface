export interface GlobalConfig {
  defaultModel: string
  defaultResponseSpeed: number
  defaultTypewriterScroll: 'off' | 'comfortable' | 'typewriter'
  features: {
    partsEnabled: boolean
    visualEffectsEnabled: boolean
    autocorrectEnabled: boolean
    // Atmosphere
    timeAwareAtmosphere?: boolean
    seasonalShifts?: boolean
    flowStateVisuals?: boolean
    handwritingMode?: boolean
    // Part Intelligence
    partsQuoting?: boolean
    partsDisagreeing?: boolean
    partQuietReturn?: boolean
    partCatchphrases?: boolean
    silenceAsResponse?: boolean
    blankPageSpeaks?: boolean
    // Memory/Engagement
    echoes?: boolean
    innerWeather?: boolean
    entryFossils?: boolean
    lettersFromParts?: boolean
    ritualsNotStreaks?: boolean
    unfinishedThreads?: boolean
    // Visual Effects (individual)
    paragraphFade?: boolean
    inkWeight?: boolean
    colorBleed?: boolean
    breathingBackground?: boolean
    // Safety & Guidance
    emergencyGrounding?: boolean
    intentionsEnabled?: boolean
    guidedExplorations?: boolean
  }
  announcement: {
    message: string
    type: 'info' | 'warning'
    dismissible: boolean
  } | null
  buildVersion?: string
  updatedAt: number
  updatedBy: string

  // Tuning sections
  atmosphere?: {
    timeShiftIntensity?: number
    morningHue?: number
    afternoonHue?: number
    eveningHue?: number
    nightHue?: number
    seasonalIntensity?: number
    seasonOverride?: 'spring' | 'summer' | 'autumn' | 'winter' | 'auto'
    flowThresholdSeconds?: number
    flowGlowIntensity?: number
    handwritingFont?: string
    handwritingEffectBoost?: number
  }

  partIntelligence?: {
    quoteMinAge?: number
    quoteChance?: number
    disagreeChance?: number
    disagreeMinParts?: number
    quietThresholdDays?: number
    returnBonusMultiplier?: number
    catchphraseMaxPerPart?: number
    silenceFlowThreshold?: number
    silenceChance?: number
    blankPageDelaySeconds?: number
  }

  engagement?: {
    echoMaxAge?: number
    echoChance?: number
    echoMaxPerSession?: number
    weatherUpdateInterval?: number
    fossilMinAge?: number
    fossilChance?: number
    letterTriggerEntries?: number
    letterMinParts?: number
    ritualDetectionWindow?: number
    threadMaxAge?: number
    threadChance?: number
  }

  grounding?: {
    autoExitMinutes?: number
    selfRoleScoreBonus?: number
    otherRolePenalty?: number
    intensityThreshold?: number
  }

  explorations?: {
    maxPrompts?: number
    triggerOnNewEntry?: boolean
  }
}

export interface AdminOverviewResponse {
  userCount: number
  totalEntries: number
  totalThoughts: number
  totalInteractions: number
  recentActivity: RecentActivity[]
}

export interface RecentActivity {
  uid: string
  displayName: string
  entryId: string
  preview: string
  updatedAt: number
}

export interface AdminUser {
  uid: string
  email: string
  displayName: string
  photoURL: string | null
  entryCount: number
  thoughtCount: number
  interactionCount: number
  totalWords: number
  lastActive: number | null
}

export interface AdminUserDetailResponse {
  user: AdminUser
  entries: AdminEntry[]
  parts: AdminPart[]
  thoughts: AdminThought[]
  interactions: AdminInteraction[]
  memories: AdminMemory[]
  userProfile: AdminUserProfile | null
  entrySummaries: AdminEntrySummary[]
}

export interface AdminEntry {
  id: string
  plainText: string
  createdAt: number
  updatedAt: number
}

export interface AdminPart {
  id: string
  name: string
  color: string
  colorLight: string
  ifsRole: string
  concern: string
  isSeeded: boolean
  learnedKeywords?: string[]
  learnedEmotions?: string[]
  systemPromptAddition?: string
  growthVersion?: number
}

export interface AdminThought {
  id: string
  partId: string
  entryId: string
  content: string
  timestamp: number
}

export interface AdminInteraction {
  id: string
  partId: string
  entryId: string
  partOpening: string
  userResponse: string | null
  partReply: string | null
  status: string
  timestamp: number
}

export interface AdminMemory {
  id: string
  partId: string
  entryId: string
  content: string
  type?: string
  timestamp: number
}

export interface AdminUserProfile {
  recurringThemes: string[]
  emotionalPatterns: string[]
  avoidancePatterns: string[]
  growthSignals: string[]
  innerLandscape: string
  lastUpdated: number
}

export interface AdminEntrySummary {
  id: string
  entryId: string
  themes: string[]
  emotionalArc: string
  keyMoments: string[]
  timestamp: number
}

export interface AdminInsightsResponse {
  narrative: string
  highlights: string[]
}

export interface ContactMessage {
  id: string
  uid: string
  email: string
  displayName: string
  message: string
  createdAt: number
}

export type AdminAction =
  | 'getOverview'
  | 'getUserList'
  | 'getUserDetail'
  | 'getConfig'
  | 'updateConfig'
  | 'generateInsights'
  | 'getContactMessages'
