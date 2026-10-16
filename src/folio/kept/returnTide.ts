import type { FolioTrace } from '../../types/folio'
import { ymdIn } from './comeBack'

// H3, automatic Return (build plan §4): a kept thing may come back on its own,
// only when the writer opted in twice (Folio settings, then the trace). Never
// within 72 h of a grounding activation, never in Shore or Quiet, never for a
// trace kept near one, at most once per visit, and always after a come-back
// the writer asked for. Anniversaries first, then the oldest kept.

export const RETURN_MIN_AGE_MS = 14 * 24 * 60 * 60 * 1000
export const RETURN_REST_MS = 60 * 24 * 60 * 60 * 1000

export type ReturnTrace = Pick<FolioTrace, 'id' | 'keptAt' | 'comeBackAt' | 'groundedNearKeep'> & {
  returnEligible?: boolean
  lastReturnShownAt?: number | null
}

export function isReturnEligible(t: ReturnTrace, now: number): boolean {
  if (t.returnEligible !== true) return false
  if (t.groundedNearKeep) return false
  if (now - t.keptAt < RETURN_MIN_AGE_MS) return false
  if (typeof t.lastReturnShownAt === 'number' && now - t.lastReturnShownAt < RETURN_REST_MS) return false
  if (typeof t.comeBackAt === 'number') return false // its own come-back is pending
  return true
}

/** Kept on this calendar day in an earlier year, writer-local. */
export function isAnniversary(t: Pick<FolioTrace, 'keptAt'>, now: number, tz: string): boolean {
  const kept = ymdIn(t.keptAt, tz)
  const today = ymdIn(now, tz)
  return kept.y < today.y && kept.m === today.m && kept.d === today.d
}

/** The trace Return would bring now, or none. The caller checks the other conditions. */
export function nextReturn<T extends ReturnTrace>(traces: T[], now: number, tz: string): T | null {
  const eligible = traces.filter((t) => isReturnEligible(t, now))
  if (eligible.length === 0) return null
  const anniversaries = eligible.filter((t) => isAnniversary(t, now, tz)).sort((a, b) => a.keptAt - b.keptAt)
  if (anniversaries.length > 0) return anniversaries[0]
  return [...eligible].sort((a, b) => a.keptAt - b.keptAt)[0]
}

export interface ReturnGate {
  /** Folio settings: "Let kept things come back on their own". */
  settingOn: boolean
  /** The admin switch `folioReturn`. */
  switchOn: boolean
  recent: boolean
  presentation: 'normal' | 'shore' | 'quiet'
  /** A writer-asked come-back is due: it goes first. */
  askedDue: boolean
  shownThisVisit: boolean
}

export function returnAllowed(g: ReturnGate): boolean {
  return g.settingOn && g.switchOn && !g.recent && g.presentation === 'normal' && !g.askedDue && !g.shownThisVisit
}
