import type { GlobalConfig } from './adminTypes'
import { isRoomEnabled } from '../engine/surfaceAvailability'

type Features = Partial<GlobalConfig['features']>

/**
 * Room's effective state. `roomEnabled` wins when set; while it is unset the
 * legacy Relax / Drift flags still turn Room on (Room replaced both surfaces),
 * so an existing config keeps its behavior until an admin sets the new flag.
 * Delegates to the single shared formula the session shell also uses.
 */
export function effectiveRoomEnabled(features: Features | null | undefined): boolean {
  return isRoomEnabled(features)
}

/** SMS field channel: on unless explicitly disabled. */
export function effectiveSmsEnabled(features: Features | null | undefined): boolean {
  return features?.smsEnabled !== false
}

/**
 * Feature keys that no longer control anything. Older saved configs may still
 * carry them, so they are stripped before an admin save instead of being
 * round-tripped back to the server. `emergencyGrounding` was only ever read by
 * the admin UI: grounding is always on through the crisis stack. The server
 * still accepts it so a stale admin bundle can save.
 */
export const RETIRED_FEATURE_KEYS: readonly string[] = ['customSoundscapesEnabled', 'emergencyGrounding']

/**
 * Grounding tuning keys nothing reads. `intensityThreshold` drove the retired
 * emotion-check → grounding path; the L2 classifier owns grounding now.
 */
export const RETIRED_GROUNDING_KEYS: readonly string[] = ['intensityThreshold']

function without<T extends object>(value: T, keys: readonly string[]): T {
  const next: Record<string, unknown> = { ...(value as Record<string, unknown>) }
  for (const key of keys) delete next[key]
  return next as T
}

export function withoutRetiredFeatures<T extends object>(features: T): T {
  return without(features, RETIRED_FEATURE_KEYS)
}

export function withoutRetiredGrounding<T extends object>(grounding: T | undefined): T | undefined {
  return grounding ? without(grounding, RETIRED_GROUNDING_KEYS) : grounding
}
