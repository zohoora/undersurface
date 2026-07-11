// Drift — pure state machine for the bilateral dual-attention regulation
// practice. This module is the single authority over flow, caps, pendulation
// routing, and the abort path in BOTH text and voice modalities. It has NO
// React or Firestore imports — the hooks drive it and persist its output.
//
// The defining safety inversion: unlike EMDR reprocessing, Drift never
// re-invokes the starting material once attention has left `baseline`. That
// invariant is expressed structurally — the phases form a monotonic order and
// no event ever moves to an earlier phase (see PHASE ORDER below and the
// no-return test). Stuck or capped → converge to closure, never back to target.

import type { DriftOutcome } from '../types'

// PHASE ORDER (monotonic): arrive < anchor < choose < baseline
//   < set = notice = settle < closure < closed
// The set/notice/settle band cycles among itself; every other transition only
// advances. Nothing returns to an earlier phase.
export type DriftPhase =
  | 'arrive' | 'anchor' | 'choose' | 'baseline'
  | 'set' | 'notice' | 'settle'
  | 'closure' | 'closed'

export type NoticeDirection = 'softer' | 'same' | 'stronger' | 'skipped'
export type InterweaveKind = 'rain' | 'defusion' | 'parts' | 'focusing'
export type ClosureReason = 'stuck' | 'cap' | 'user' | 'settle' | 'crisis' | null

// v3: the practice is time-boxed and chosen upfront. A round is long enough to
// settle into the rhythm before the interface asks anything. Fewer, longer
// rounds replace the restless 12-second wave/check-in loop from v2.
export type DriftLength = 'quick' | 'short' | 'full'

export interface DriftLimitsActive {
  setTarget: number
  setMs: number
  maxSessionMs: number
}

export const DRIFT_LENGTHS: Record<DriftLength, DriftLimitsActive> = {
  quick: { setTarget: 2, setMs: 45_000, maxSessionMs: 180_000 }, // ~2 min including one check-in + landing
  short: { setTarget: 3, setMs: 60_000, maxSessionMs: 300_000 }, // ~4 min including check-ins + landing
  full: { setTarget: 4, setMs: 75_000, maxSessionMs: 480_000 }, // ~6 min including check-ins + landing
}

export interface DriftState {
  phase: DriftPhase
  setCount: number
  sameStreak: number
  // Consecutive 'softer' notices (reset by same/stronger; 'skipped' is neutral).
  // Drives passMsForSoftening — the BLS sweep slows as the writer settles.
  softerStreak: number
  // Total 'softer' notices this session — the closure screen's felt-contrast
  // line ("softened" vs "stayed with it") reads this, never a numeric scale.
  softerTotal: number
  inSettleRecheck: boolean
  elapsedMs: number
  closureReason: ClosureReason
  // The interweave used on the previous exchange, for the one-exchange cooldown.
  // Set by the reducer from NOTICE.interweave; the hook passes state.lastInterweave
  // into selectInterweave.
  lastInterweave: InterweaveKind | null
  // Active caps for this session, fixed at BEGIN from the chosen length.
  // Defaults to the v1 constants when BEGIN carries no length.
  limits: DriftLimitsActive
}

export type DriftEvent =
  | { type: 'BEGIN'; length?: DriftLength }
  | { type: 'ANCHOR_CONFIRMED' }
  | { type: 'STARTING_POINT' }
  | { type: 'BASELINE_DONE' }
  | { type: 'SET_COMPLETE' }
  | { type: 'NOTICE'; direction: NoticeDirection; risk: 0 | 1 | 2; interweave: InterweaveKind | null }
  | { type: 'SETTLE_DONE' }
  | { type: 'REQUEST_CLOSE' }
  | { type: 'CRISIS' }
  | { type: 'CLOSURE_DONE' }
  | { type: 'TICK'; elapsedMs: number }

export const DRIFT_LIMITS = {
  setTarget: 6,
  hardSetCap: 8,
  maxSessionMs: 720_000, // ~12 min
  passMsMin: 1500,
  passMsMax: 2500,
  setMs: 25_000,
  stillnessMs: 4_000,
} as const

export function initialDriftState(): DriftState {
  return {
    phase: 'arrive',
    setCount: 0,
    sameStreak: 0,
    softerStreak: 0,
    softerTotal: 0,
    inSettleRecheck: false,
    elapsedMs: 0,
    closureReason: null,
    lastInterweave: null,
    limits: {
      setTarget: DRIFT_LIMITS.setTarget,
      setMs: DRIFT_LIMITS.setMs,
      maxSessionMs: DRIFT_LIMITS.maxSessionMs,
    },
  }
}

// Resolve the active limits for a chosen length, never exceeding the absolute
// hard cap (belt-and-suspenders — presets are all below it already).
function limitsForLength(length: DriftLength | undefined, current: DriftLimitsActive): DriftLimitsActive {
  if (!length) return current
  const preset = DRIFT_LENGTHS[length]
  return { ...preset, setTarget: Math.min(preset.setTarget, DRIFT_LIMITS.hardSetCap) }
}

// The BLS sweep slows as the writer settles — pendulation made visible. Base
// 2000ms per pass, +200ms per consecutive 'softer', clamped to the existing
// pass bound. Deterministic; the UI polls it, the engine owns the input.
export function passMsForSoftening(softerStreak: number): number {
  return clampPassMs(2000 + softerStreak * 200)
}

// Move to closure with a reason, honoring two invariants:
//   - crisis is sticky: a crisis closure is never downgraded to a lesser reason
//   - closed never reopens
function toClosure(state: DriftState, reason: Exclude<ClosureReason, null>): DriftState {
  if (state.phase === 'closed') return state
  if (state.closureReason === 'crisis' && reason !== 'crisis') return state
  return { ...state, phase: 'closure', closureReason: reason }
}

// Enter another set — unless the set target is reached, in which case converge
// to closure by cap. Because every setTarget ≤ hardSetCap and this is the ONLY
// gate into `set` after the first, setCount can never exceed hardSetCap. The
// changes (streak/counter updates) apply even on the cap branch so the final
// notice's softening is recorded for the closure contrast line.
function toSet(state: DriftState, changes: Partial<DriftState>): DriftState {
  const s = { ...state, ...changes }
  if (state.setCount >= state.limits.setTarget) return toClosure(s, 'cap')
  return { ...s, phase: 'set' }
}

// "Settle & close" is reachable from anchor onward — never a dead exit — but not
// from arrive (which just closes the overlay) or once already closing/closed.
function canRequestClose(phase: DriftPhase): boolean {
  return phase === 'anchor' || phase === 'choose' || phase === 'baseline'
    || phase === 'set' || phase === 'notice' || phase === 'settle'
}

function reduceNotice(state: DriftState, event: Extract<DriftEvent, { type: 'NOTICE' }>): DriftState {
  if (state.phase !== 'notice') return state
  const { direction, risk } = event
  // Record the interweave used on this exchange — the reducer owns the
  // one-exchange-cooldown input that selectInterweave reads next turn.
  const s: DriftState = { ...state, lastInterweave: event.interweave }

  // Crisis preempts everything.
  if (risk === 2) return toClosure(s, 'crisis')

  // Intensity rising (tapped stronger, or L2 risk=1) → pendulate toward the
  // anchor. If the settle re-check itself came back stronger, we do NOT loop
  // back to the material — we close (mapped to eased_early).
  if (direction === 'stronger' || risk === 1) {
    if (s.inSettleRecheck) return toClosure(s, 'settle')
    return { ...s, phase: 'settle', inSettleRecheck: true, sameStreak: 0, softerStreak: 0 }
  }

  // "same" twice consecutively → stuck → closure. Otherwise another set.
  if (direction === 'same') {
    const sameStreak = s.sameStreak + 1
    if (sameStreak >= 2) return toClosure(s, 'stuck')
    return toSet(s, { sameStreak, inSettleRecheck: false, softerStreak: 0 })
  }

  // softer or skipped → continue; the same-streak and settle re-check clear.
  // 'softer' advances the softening counters; 'skipped' is neutral (keeps them).
  const softened = direction === 'softer'
  return toSet(s, {
    sameStreak: 0,
    inSettleRecheck: false,
    softerStreak: softened ? s.softerStreak + 1 : s.softerStreak,
    softerTotal: softened ? s.softerTotal + 1 : s.softerTotal,
  })
}

function reduceTick(state: DriftState, elapsedMs: number): DriftState {
  const next = { ...state, elapsedMs }
  const inActiveLoop = state.phase === 'set' || state.phase === 'notice' || state.phase === 'settle'
  if (inActiveLoop && elapsedMs >= state.limits.maxSessionMs) return toClosure(next, 'cap')
  return next
}

export function driftReduce(state: DriftState, event: DriftEvent): DriftState {
  switch (event.type) {
    case 'BEGIN':
      return state.phase === 'arrive'
        ? { ...state, phase: 'anchor', limits: limitsForLength(event.length, state.limits) }
        : state
    case 'ANCHOR_CONFIRMED':
      return state.phase === 'anchor' ? { ...state, phase: 'choose' } : state
    case 'STARTING_POINT':
      return state.phase === 'choose' ? { ...state, phase: 'baseline' } : state
    case 'BASELINE_DONE':
      return state.phase === 'baseline' ? { ...state, phase: 'set' } : state
    case 'SET_COMPLETE':
      return state.phase === 'set'
        ? { ...state, phase: 'notice', setCount: state.setCount + 1 }
        : state
    case 'NOTICE':
      return reduceNotice(state, event)
    case 'SETTLE_DONE':
      return state.phase === 'settle' ? { ...state, phase: 'notice' } : state
    case 'REQUEST_CLOSE':
      return canRequestClose(state.phase) ? toClosure(state, 'user') : state
    case 'CRISIS':
      return state.phase === 'closed' ? state : toClosure(state, 'crisis')
    case 'CLOSURE_DONE':
      return state.phase === 'closure' ? { ...state, phase: 'closed' } : state
    case 'TICK':
      return reduceTick(state, event.elapsedMs)
  }
}

export function outcomeForReason(reason: ClosureReason): DriftOutcome {
  switch (reason) {
    case 'crisis':
      return 'aborted_to_grounding'
    case 'user':
    case 'settle':
      return 'eased_early'
    case 'stuck':
    case 'cap':
    default:
      return 'settled'
  }
}

// ── Interweave selector ──────────────────────────────────────────────────────
// Deterministic, client-side, lexical. Output is ONE interweave move (or null)
// used to append a single prompt fragment for the current turn. The model never
// chooses the move. Priority parts > rain > defusion > focusing. A category used
// on the previous exchange is on cooldown for one exchange. Never fires under
// grounding.

const RAIN_WORDS = [
  'ashamed', 'shame', 'sad', 'grief', 'hurt', 'lonely', 'scared', 'afraid',
  'tender', 'miss ', 'missing', 'cry', 'tears', 'heavy',
]
const DEFUSION_WORDS = [
  'i keep thinking', 'the thought', 'i tell myself', 'story', 'should have',
  'shouldn\'t', 'always ruin', 'never get', 'i\'m such',
]
const FOCUSING_WORDS = [
  'tight', 'knot', 'chest', 'throat', 'stomach', 'pressure', 'warm', 'cold',
  'numb', 'buzz', 'heavy in',
]
const PARTS_PHRASES = ['part of me', 'a part ', 'voice in me']

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function matchesPartName(lowerText: string, name: string): boolean {
  const n = name.trim().toLowerCase().replace(/[’‘]/g, '\'')
  if (!n) return false
  return new RegExp(`\\b${escapeRegExp(n)}\\b`).test(lowerText)
}

export function selectInterweave(
  text: string,
  opts: { lastInterweave: InterweaveKind | null; grounding: boolean; userPartNames: string[] },
): InterweaveKind | null {
  if (opts.grounding) return null
  // Fold curly apostrophes so platform smart-punctuation and plain typing both match.
  const lower = text.toLowerCase().replace(/[’‘]/g, '\'')
  const has = (w: string) => lower.includes(w)

  const emotionMatched = RAIN_WORDS.some(has)
  const isParts = PARTS_PHRASES.some(has) || opts.userPartNames.some((n) => matchesPartName(lower, n))
  const isRain = emotionMatched
  const isDefusion = DEFUSION_WORDS.some(has)
  // Focusing is a *vague* bodily sense — a body word with no emotion word present.
  const isFocusing = !emotionMatched && FOCUSING_WORDS.some(has)

  let chosen: InterweaveKind | null = null
  if (isParts) chosen = 'parts'
  else if (isRain) chosen = 'rain'
  else if (isDefusion) chosen = 'defusion'
  else if (isFocusing) chosen = 'focusing'

  if (!chosen) return null
  if (chosen === opts.lastInterweave) return null // one-exchange cooldown
  return chosen
}

// ── BLS pan math ─────────────────────────────────────────────────────────────

export function clampPassMs(ms: number): number {
  return Math.max(DRIFT_LIMITS.passMsMin, Math.min(DRIFT_LIMITS.passMsMax, ms))
}

// Smooth, continuous left↔right sweep in [-1, 1]. One full cycle per 2*passMs;
// starts full-left (-1) at elapsed 0, no discontinuity at the wrap.
export function blsPan(elapsedMs: number, passMs: number): number {
  const p = clampPassMs(passMs)
  return Math.sin((Math.PI * (elapsedMs % (2 * p))) / p - Math.PI / 2)
}
