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

export interface DriftState {
  phase: DriftPhase
  setCount: number
  sameStreak: number
  inSettleRecheck: boolean
  elapsedMs: number
  closureReason: ClosureReason
  // The interweave used on the previous exchange, for the one-exchange cooldown.
  // No reducer event carries interweave data (NOTICE holds only direction+risk),
  // so the driving hook owns this value and passes it into selectInterweave.
  lastInterweave: InterweaveKind | null
}

export type DriftEvent =
  | { type: 'BEGIN' }
  | { type: 'ANCHOR_CONFIRMED' }
  | { type: 'STARTING_POINT' }
  | { type: 'BASELINE_DONE' }
  | { type: 'SET_COMPLETE' }
  | { type: 'NOTICE'; direction: NoticeDirection; risk: 0 | 1 | 2 }
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
    inSettleRecheck: false,
    elapsedMs: 0,
    closureReason: null,
    lastInterweave: null,
  }
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
// to closure by cap. Because setTarget (6) < hardSetCap (8) and this is the ONLY
// gate into `set` after the first, setCount can never exceed hardSetCap.
function toSet(state: DriftState, changes: Partial<DriftState>): DriftState {
  if (state.setCount >= DRIFT_LIMITS.setTarget) return toClosure(state, 'cap')
  return { ...state, ...changes, phase: 'set' }
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

  // Crisis preempts everything.
  if (risk === 2) return toClosure(state, 'crisis')

  // Intensity rising (tapped stronger, or L2 risk=1) → pendulate toward the
  // anchor. If the settle re-check itself came back stronger, we do NOT loop
  // back to the material — we close (mapped to eased_early).
  if (direction === 'stronger' || risk === 1) {
    if (state.inSettleRecheck) return toClosure(state, 'settle')
    return { ...state, phase: 'settle', inSettleRecheck: true, sameStreak: 0 }
  }

  // "same" twice consecutively → stuck → closure. Otherwise another set.
  if (direction === 'same') {
    const sameStreak = state.sameStreak + 1
    if (sameStreak >= 2) return toClosure(state, 'stuck')
    return toSet(state, { sameStreak, inSettleRecheck: false })
  }

  // softer or skipped → neutral continue; the streak and settle re-check clear.
  return toSet(state, { sameStreak: 0, inSettleRecheck: false })
}

function reduceTick(state: DriftState, elapsedMs: number): DriftState {
  const next = { ...state, elapsedMs }
  const inActiveLoop = state.phase === 'set' || state.phase === 'notice' || state.phase === 'settle'
  if (inActiveLoop && elapsedMs >= DRIFT_LIMITS.maxSessionMs) return toClosure(next, 'cap')
  return next
}

export function driftReduce(state: DriftState, event: DriftEvent): DriftState {
  switch (event.type) {
    case 'BEGIN':
      return state.phase === 'arrive' ? { ...state, phase: 'anchor' } : state
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
  'shouldn’t', 'always ruin', 'never get', 'i’m such',
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
  const n = name.trim().toLowerCase()
  if (!n) return false
  return new RegExp(`\\b${escapeRegExp(n)}\\b`).test(lowerText)
}

export function selectInterweave(
  text: string,
  opts: { lastInterweave: InterweaveKind | null; grounding: boolean; userPartNames: string[] },
): InterweaveKind | null {
  if (opts.grounding) return null
  const lower = text.toLowerCase()
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
