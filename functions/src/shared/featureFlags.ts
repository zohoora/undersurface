import { getFirestore } from 'firebase-admin/firestore'

// Server-side reads of appConfig/global.features, so cost paths can enforce the
// same flags the client uses to show or hide a surface. Experimental flags are
// default OFF (`=== true`), matching the client convention.

export type FeatureFlags = Record<string, unknown>

// Room replaced Relax/Drift on 2026-07-11. Cross-agent contract
// (2026-10-14): an explicit `roomEnabled` wins; when it is unset, Room follows
// the legacy flags it replaced.
export function isRoomEnabled(features: FeatureFlags | null | undefined): boolean {
  const room = features?.roomEnabled
  if (room === true) return true
  if (room !== undefined) return false
  return features?.relaxEnabled === true || features?.driftEnabled === true
}

// Realtime client secrets back two surfaces: Speak (voiceEnabled) and Room.
export function isRealtimeVoiceAllowed(features: FeatureFlags | null | undefined): boolean {
  return features?.voiceEnabled === true || isRoomEnabled(features)
}

// Cached in-instance like the chat quota config: 60s TTL means an admin toggle
// propagates within a minute without adding a Firestore read per request.
// Read failures are NOT cached, so the next request retries.
const FEATURE_FLAGS_TTL_MS = 60_000
let featureFlagsCache: { value: FeatureFlags; fetchedAt: number } | null = null

export async function loadFeatureFlags(nowMs: number): Promise<FeatureFlags> {
  if (featureFlagsCache && nowMs - featureFlagsCache.fetchedAt < FEATURE_FLAGS_TTL_MS) {
    return featureFlagsCache.value
  }
  const snap = await getFirestore().collection('appConfig').doc('global').get()
  const raw = snap.exists ? snap.get('features') : undefined
  const value: FeatureFlags = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? { ...(raw as FeatureFlags) }
    : {}
  featureFlagsCache = { value, fetchedAt: nowMs }
  return value
}

/** Test hook: drop the in-instance cache. */
export function resetFeatureFlagsCacheForTests(): void {
  featureFlagsCache = null
}
