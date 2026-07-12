// Single source of truth for the per-user Firestore subcollections under
// users/{uid}. Account deletion iterates this list. User-visible collections
// should also appear in the client db proxy and export; server support
// collections such as smsSettings need deletion coverage but not a client API.
// `sessions` additionally has a `messages` subcollection handled explicitly
// (subcollections are deleted before their parent docs).
export const USER_SUBCOLLECTIONS = [
  'entries',
  'parts',
  'memories',
  'thoughts',
  'interactions',
  'entrySummaries',
  'userProfile',
  'personalFacts',
  'fossils',
  'letters',
  'sessionLog',
  'innerWeather',
  'consent',
  'sessions',
  'apiKeys',
  'hrvSessions',
  'relaxSessions',
  'driftSessions',
  'roomSessions',
  'diagnostics',
  'companionSignals',
  'userParts',
  'sessionIntentions',
  'stanceProfile',
  'userValues',
  'companionPromises',
  'companionPreferences',
  'fieldMoments',
  'interventionOutcomes',
  'researchEvents',
  'personalProtocols',
  'livingHypotheses',
  'smsMessages',
  'smsSettings',
] as const
