import type { GlobalConfig } from './adminTypes'

type Features = Partial<GlobalConfig['features']>

/**
 * Room's effective state. `roomEnabled` wins when set; while it is unset the
 * legacy Relax / Drift flags still turn Room on (Room replaced both surfaces),
 * so an existing config keeps its behavior until an admin sets the new flag.
 */
export function effectiveRoomEnabled(features: Features | null | undefined): boolean {
  if (!features) return false
  if (features.roomEnabled === true) return true
  if (features.roomEnabled === false) return false
  return features.relaxEnabled === true || features.driftEnabled === true
}

/** SMS field channel: on unless explicitly disabled. */
export function effectiveSmsEnabled(features: Features | null | undefined): boolean {
  return features?.smsEnabled !== false
}

/**
 * Feature keys that no longer control anything. Older saved configs may still
 * carry them, so they are stripped before an admin save instead of being
 * round-tripped back to the server.
 */
export const RETIRED_FEATURE_KEYS: readonly string[] = ['customSoundscapesEnabled']

export function withoutRetiredFeatures<T extends object>(features: T): T {
  const next: Record<string, unknown> = { ...(features as Record<string, unknown>) }
  for (const key of RETIRED_FEATURE_KEYS) delete next[key]
  return next as T
}
