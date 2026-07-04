// Single source of truth for the per-user Firestore subcollections under
// users/{uid}. Account deletion iterates this list; keep it in sync with the
// `db` proxy in src/store/db.ts and the export list in src/store/dataExport.ts.
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
  'diagnostics',
  'companionSignals',
] as const
