import type { Session, RuptureEvidence } from '../types'

// Deterministic rupture-evidence markers. Pure functions over data the app
// already has — no LLM involvement. Calibrated for PRECISION: a missed repair
// costs nothing, a false "did I upset you?" is itself rupture-inducing.
// Spec: docs/superpowers/specs/2026-07-03-rupture-rumination-design.md

// Abandoned: engaged enough that leaving mid-way means something…
const ABANDON_MIN_MESSAGES = 4
// …and stale enough that "I'll come back to it" has expired.
const ABANDON_MIN_AGE_MS = 6 * 3_600_000
// Habit guard: only meaningful for users who normally close sessions.
const ABANDON_HABIT_WINDOW = 10
const ABANDON_MIN_CLOSED_RATIO = 0.5

// Atypical gap: relative to the user's own cadence AND an absolute floor,
// with enough history that "cadence" is a real thing.
const GAP_MEDIAN_MULTIPLIER = 3
const GAP_ABSOLUTE_FLOOR_MS = 10 * 24 * 3_600_000
const GAP_MIN_SESSIONS = 5

// Terse ending: the last few messages collapsing relative to the user's own
// median in that session — not absolute length, so brief writers don't flag.
const TERSE_TAIL = 3
const TERSE_RATIO = 0.4
const TERSE_MIN_MESSAGES = 8

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

// `prior` is the user's previous sessions, newest first, EXCLUDING the one
// being opened (matches db.sessions.orderBy('startedAt').reverse()).
export function detectAbandonedSession(prior: Session[], now: number): boolean {
  const newest = prior[0]
  if (!newest) return false
  if (newest.status !== 'active') return false
  if ((newest.messageCount ?? 0) < ABANDON_MIN_MESSAGES) return false
  if (now - newest.startedAt < ABANDON_MIN_AGE_MS) return false

  const window = prior.slice(0, ABANDON_HABIT_WINDOW)
  const closedRatio = window.filter((s) => s.status === 'closed').length / window.length
  return closedRatio >= ABANDON_MIN_CLOSED_RATIO
}

export function detectAtypicalGap(prior: Session[], now: number): boolean {
  if (prior.length < GAP_MIN_SESSIONS) return false

  const gap = now - prior[0].startedAt
  if (gap < GAP_ABSOLUTE_FLOOR_MS) return false

  const gaps: number[] = []
  for (let i = 0; i < prior.length - 1; i++) {
    gaps.push(prior[i].startedAt - prior[i + 1].startedAt)
  }
  const typical = median(gaps)
  if (typical <= 0) return false
  return gap > GAP_MEDIAN_MULTIPLIER * typical
}

// `userMessageLengths` in message order for one session (char counts).
export function detectTerseEnding(userMessageLengths: number[]): boolean {
  if (userMessageLengths.length < TERSE_MIN_MESSAGES) return false
  const sessionMedian = median(userMessageLengths)
  if (sessionMedian <= 0) return false
  const threshold = sessionMedian * TERSE_RATIO
  const tail = userMessageLengths.slice(-TERSE_TAIL)
  return tail.every((len) => len < threshold)
}

// The two markers computable at session open from session docs alone.
// Abandoned wins over gap: it's the more specific evidence.
export function detectOpenTimeEvidence(prior: Session[], now: number): RuptureEvidence | null {
  if (detectAbandonedSession(prior, now)) return 'abandoned'
  if (detectAtypicalGap(prior, now)) return 'atypical_gap'
  return null
}
