export interface GlobalConfig {
  defaultResponseSpeed: number
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
    quietOneEnabled?: boolean
    bodyMap?: boolean
    bilateralStimulation?: boolean
    // Memory/Engagement
    echoes?: boolean
    innerWeather?: boolean
    lettersFromParts?: boolean
    ritualsNotStreaks?: boolean
    unfinishedThreads?: boolean
    // Visual Effects (individual)
    paragraphFade?: boolean
    inkWeight?: boolean
    breathingBackground?: boolean
    // Safety
    emergencyGrounding?: boolean
    // Companion signals (rupture repair + rumination pivot)
    /** Explicit alliance-rupture repair at the next session's opener. */
    ruptureRepair?: boolean
    /** Silent register pivot out of rumination loops (live + cross-session). */
    ruminationPivot?: boolean
    /** Collaborative user-parts mapping (propose → confirm) + shared lexicon. */
    userParts?: boolean
    /** Between-session intentions: capture, warm follow-up, avoidance path. */
    sessionIntentions?: boolean
    /** N-of-1 stance learning: closing check-in + internal stance profile. */
    stanceAdaptation?: boolean
    // Biometric
    webcamHrv?: boolean
    /** Polar H10 (or any standard Bluetooth HR monitor) — session-mode only. */
    polarH10?: boolean
    // Voice (OpenAI Realtime)
    voiceEnabled?: boolean
    // Relax mode (4th session surface)
    relaxEnabled?: boolean
    // Custom soundscape generation in Relax mode (text prompt → ElevenLabs)
    customSoundscapesEnabled?: boolean
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
  }

  engagement?: {
    echoMaxAge?: number
    echoChance?: number
    echoMaxPerSession?: number
    weatherUpdateInterval?: number
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

  voice?: {
    defaultVoice?: 'alloy' | 'ash' | 'ballad' | 'coral' | 'echo' | 'sage' | 'shimmer' | 'verse' | 'marin' | 'cedar'
  }
}

export interface WritingHabits {
  totalSessions: number
  avgSessionDuration: number
  avgSessionsPerUser: number
  peakWritingHour: number | null
}

export interface EmotionalLandscape {
  topEmotions: Array<{ emotion: string; count: number }>
  weatherAdoptionPercent: number
  avgIntensity: number
}

export interface FeatureAdoption {
  profileAdoptionPercent: number
  letterAdoptionPercent: number
  fossilAdoptionPercent: number
  avgPartsPerUser: number
  sessionAdoptionPercent: number
  intentionUsagePercent: number
}

export interface AdminOverviewResponse {
  userCount: number
  totalEntries: number
  totalThoughts: number
  totalInteractions: number
  totalConversations: number
  recentActivity: RecentActivity[]
  refreshedAt?: number
  writingHabits: WritingHabits | null
  emotionalLandscape: EmotionalLandscape | null
  featureAdoption: FeatureAdoption | null
}

export interface RecentActivity {
  uid: string
  displayName: string
  itemId: string
  preview: string
  updatedAt: number
  type: 'entry' | 'conversation'
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
  partCount: number
  sessionCount: number
  createdAt: number | null
}

export interface AdminSession {
  id: string
  startedAt: number
  endedAt?: number
  duration?: number
  wordCount: number
  timeOfDay: string
  dayOfWeek: number
}

export interface AdminWeather {
  id: string
  dominantEmotion: string
  secondaryEmotion?: string
  intensity: number
  trend: 'rising' | 'falling' | 'steady'
  updatedAt: number
}

export interface AdminLetter {
  id: string
  partIds: string[]
  content: string
  triggerType: 'milestone' | 'pattern' | 'growth'
  createdAt: number
  isRead: boolean
}

export interface AdminFossil {
  id: string
  entryId: string
  partId: string
  commentary: string
  createdAt: number
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
  sessions: AdminSession[]
  conversations: AdminConversation[]
  weather: AdminWeather[]
  letters: AdminLetter[]
  fossils: AdminFossil[]
}

export interface AdminEntry {
  id: string
  plainText: string
  createdAt: number
  updatedAt: number
  intention?: string | null
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

export interface AdminAnalyticsResponse {
  activeUsers: {
    daily: number
    weekly: number
    monthly: number
  }
  signupsByWeek: Array<{ week: string; count: number }>
  entriesByDay: Array<{ date: string; count: number }>
  conversationsByDay: Array<{ date: string; count: number }>
  partUsage: Array<{ name: string; color: string; count: number }>
  averageWordsPerEntry: number
  averageEntriesPerUser: number
  averageConversationsPerUser: number
  totalWords: number
  totalConversations: number
  refreshedAt?: number
}

// Real conversation session (from sessions/{id})
export interface AdminConversation {
  id: string
  startedAt: number
  endedAt: number | null
  status: 'active' | 'closed'
  hostPartId: string
  phase: 'opening' | 'deepening' | 'closing'
  sessionNote: string | null
  messageCount: number
  firstLine: string
  isTherapistSession?: boolean
  favorited?: boolean
}

// Lazy-loaded message within a conversation
export interface AdminSessionMessage {
  id: string
  speaker: 'user' | 'part' | 'therapist'
  partId: string | null
  partName: string | null
  content: string
  timestamp: number
  phase: string
  isEmergence: boolean
}

export type AdminAction =
  | 'getOverview'
  | 'getUserList'
  | 'getUserDetail'
  | 'getConfig'
  | 'updateConfig'
  | 'generateInsights'
  | 'getContactMessages'
  | 'getAnalytics'
  | 'refreshAnalytics'
  | 'getSessionMessages'
  | 'getDiagnostics'
