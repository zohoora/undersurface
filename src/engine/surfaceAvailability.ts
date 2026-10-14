import type { GlobalConfig } from '../admin/adminTypes'

type Features = Partial<GlobalConfig['features']> | null | undefined

/**
 * Effective Room availability (cross-agent contract with the admin toggle and
 * its server twin in functions/src/shared/featureFlags.ts): an explicit
 * `roomEnabled` wins; when it is unset, Room stays derived from the legacy
 * Relax/Drift flags so no config migration is needed before deploy. Room's
 * voice approaches additionally need `voiceEnabled` (isVoiceEnabled), which is
 * also the server's rule for minting a Realtime secret.
 */
export function isRoomEnabled(features: Features): boolean {
  const roomEnabled = features?.roomEnabled
  if (roomEnabled === true) return true
  if (roomEnabled === false) return false
  return features?.relaxEnabled === true || features?.driftEnabled === true
}

export function isVoiceEnabled(features: Features): boolean {
  return features?.voiceEnabled === true
}

export interface SurfaceAvailability {
  voiceEnabled: boolean
  roomEnabled: boolean
  grounding: boolean
}

const VOICE_TARGETS = new Set(['speak', 'speak-arc'])
const ROOM_TARGETS = new Set(['room', 'room-arc', 'relax', 'relax-arc', 'drift', 'drift-arc'])

/**
 * Whether a surface (or a #switch recommendation target naming one) may open
 * right now. A link to Speak with voice disabled used to start a Realtime
 * session with no visible overlay (TECH_ISSUES #12); Room never opens under
 * grounding.
 */
export function canOpenSurface(target: string, availability: SurfaceAvailability): boolean {
  if (VOICE_TARGETS.has(target)) return availability.voiceEnabled
  if (ROOM_TARGETS.has(target)) return availability.roomEnabled && !availability.grounding
  return true
}
