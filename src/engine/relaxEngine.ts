import type { RelaxSessionType } from '../types'

const TARGET_RATES: Record<RelaxSessionType, number> = {
  breathwork: 5.5,
  body_scan: 5.0,
  safe_place: 5.0,
  open_awareness: 5.5,
}

export function getTargetRespRate(sessionType: RelaxSessionType): number {
  return TARGET_RATES[sessionType]
}

export function cycleMs(bpm: number): number {
  return Math.round(60_000 / bpm)
}

// Adaptive pacing — match the user's measured respiratory rate but run 5%
// slower so each cycle the user can match and the animation can keep pulling
// them toward the resonance target. Floored at the session target so the
// lead never drives below the therapeutic range. Bounds reject readings
// outside what the worker's respiratory bandpass (0.15–0.45 Hz) can resolve.
const ADAPTIVE_LEAD_FACTOR = 0.95
const RR_VALID_MIN = 4
const RR_VALID_MAX = 30

export function computeAdaptiveBpm(
  userRespRate: number | null,
  sessionTarget: number,
): number | null {
  if (userRespRate === null) return null
  if (userRespRate < RR_VALID_MIN || userRespRate > RR_VALID_MAX) return null
  return Math.max(sessionTarget, userRespRate * ADAPTIVE_LEAD_FACTOR)
}

// Phase wraps every cycle: 0 = start of inhale, 0.5 = peak (start of exhale),
// 1 (== 0) = end of exhale.
export function breathPhase(elapsedMs: number, bpm: number): number {
  const cycle = cycleMs(bpm)
  return (((elapsedMs % cycle) + cycle) % cycle) / cycle
}

// Cosine map from phase to scale 0..1. scale=0 at cycle boundaries (no breath
// taken / fully exhaled), scale=1 at peak (end of inhale).
export function breathScale(phase: number): number {
  return (1 - Math.cos(phase * 2 * Math.PI)) / 2
}

export interface NarrationCue {
  atMs: number
  text: string
}

const BREATHWORK_CUES: readonly NarrationCue[] = [
  { atMs: 3_000, text: 'Settle in.' },
  { atMs: 12_000, text: 'Inhale slowly… and out.' },
  { atMs: 30_000, text: 'Notice the air at your nostrils. Cool on the way in. Warm on the way out.' },
  { atMs: 60_000, text: 'Let the breath find the circle.' },
  { atMs: 120_000, text: 'Anything you do not need right now — let it leave with the next exhale.' },
  { atMs: 180_000, text: 'Notice what is here without changing it.' },
  { atMs: 240_000, text: 'Continue breathing.' },
  { atMs: 300_000, text: 'Coming back, slowly. Just a little longer.' },
] as const

const BODY_SCAN_CUES: readonly NarrationCue[] = [
  { atMs: 3_000, text: 'Bring your attention to the crown of your head.' },
  { atMs: 30_000, text: 'Move down to your forehead, your eyes, your jaw. Soften.' },
  { atMs: 60_000, text: 'Notice your throat, your shoulders. Whatever is held — let it loosen.' },
  { atMs: 120_000, text: 'Breath into your chest. Notice the rise and fall.' },
  { atMs: 180_000, text: 'Down through your belly. Through your hips.' },
  { atMs: 240_000, text: 'Through your thighs, your knees, your calves.' },
  { atMs: 300_000, text: 'Your feet. The soles. The toes. The whole body, one piece.' },
  { atMs: 360_000, text: 'Stay here. The breath continues.' },
] as const

const SAFE_PLACE_CUES: readonly NarrationCue[] = [
  { atMs: 3_000, text: 'Let your eyes soften, or close.' },
  { atMs: 20_000, text: 'Imagine a place where you feel completely at ease.' },
  { atMs: 60_000, text: 'It might be real, or imagined. There is no wrong choice.' },
  { atMs: 120_000, text: 'Look around. What do you see?' },
  { atMs: 180_000, text: 'What do you hear? Maybe water, or wind, or quiet.' },
  { atMs: 240_000, text: 'What do you smell?' },
  { atMs: 300_000, text: 'You can come back to this place anytime.' },
  { atMs: 360_000, text: 'Stay here as long as you like.' },
] as const

const OPEN_AWARENESS_CUES: readonly NarrationCue[] = [
  { atMs: 3_000, text: 'Just sit. Let the breath be what it is.' },
  { atMs: 90_000, text: 'No goal. No work. Just here.' },
  { atMs: 240_000, text: 'If a thought comes, notice it, and return.' },
  { atMs: 480_000, text: 'Continue.' },
] as const

const CUES: Record<RelaxSessionType, readonly NarrationCue[]> = {
  breathwork: BREATHWORK_CUES,
  body_scan: BODY_SCAN_CUES,
  safe_place: SAFE_PLACE_CUES,
  open_awareness: OPEN_AWARENESS_CUES,
}

export function getNarrationCues(sessionType: RelaxSessionType): readonly NarrationCue[] {
  return CUES[sessionType]
}

// Returns the cue scheduled in (lastEmittedAtMs, elapsedMs], or null. Caller
// tracks lastEmittedAtMs to avoid double-emission.
export function nextNarrationCue(
  sessionType: RelaxSessionType,
  elapsedMs: number,
  lastEmittedAtMs: number,
): NarrationCue | null {
  for (const cue of CUES[sessionType]) {
    if (cue.atMs > lastEmittedAtMs && cue.atMs <= elapsedMs) {
      return cue
    }
  }
  return null
}
