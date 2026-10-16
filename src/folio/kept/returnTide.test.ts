import { describe, expect, it } from 'vitest'
import { RETURN_MIN_AGE_MS, RETURN_REST_MS, isAnniversary, isReturnEligible, nextReturn, returnAllowed } from './returnTide'
import type { ReturnTrace } from './returnTide'

// H3 (build plan §4): eligibility across DST and timezones; holds under
// Recent, Shore and Quiet; once per visit; after asked come-backs; the switch.

const DAY = 24 * 60 * 60 * 1000
const at = (iso: string) => Date.parse(iso)
const t = (id: string, keptAt: number, extra: Partial<ReturnTrace> = {}): ReturnTrace => ({ id, keptAt, comeBackAt: null, groundedNearKeep: false, returnEligible: true, lastReturnShownAt: null, ...extra })

describe('Return eligibility', () => {
  const now = at('2026-10-20T15:00:00Z')

  it('needs the trace\'s own opt-in, 14 days, 60 days\' rest, no pending come-back, and no grounding near keep', () => {
    expect(isReturnEligible(t('a', now - 15 * DAY), now)).toBe(true)
    expect(isReturnEligible(t('a', now - 15 * DAY, { returnEligible: false }), now)).toBe(false)
    expect(isReturnEligible(t('a', now - 15 * DAY, { returnEligible: undefined }), now)).toBe(false)
    expect(isReturnEligible(t('a', now - RETURN_MIN_AGE_MS + 1), now)).toBe(false)
    expect(isReturnEligible(t('a', now - 100 * DAY, { lastReturnShownAt: now - RETURN_REST_MS + DAY }), now)).toBe(false)
    expect(isReturnEligible(t('a', now - 100 * DAY, { lastReturnShownAt: now - RETURN_REST_MS - 1 }), now)).toBe(true)
    expect(isReturnEligible(t('a', now - 100 * DAY, { comeBackAt: now + DAY }), now)).toBe(false)
    expect(isReturnEligible(t('a', now - 100 * DAY, { groundedNearKeep: true }), now)).toBe(false)
  })

  it('anniversaries come first, then the oldest kept', () => {
    const traces = [t('old', at('2025-01-02T12:00:00Z')), t('anniv', at('2025-10-20T12:00:00Z')), t('older', at('2024-03-03T12:00:00Z'))]
    expect(nextReturn(traces, now, 'UTC')?.id).toBe('anniv')
    expect(nextReturn(traces.filter((x) => x.id !== 'anniv'), now, 'UTC')?.id).toBe('older')
    expect(nextReturn([], now, 'UTC')).toBeNull()
  })

  it('the anniversary is the writer-local day, across timezones and DST', () => {
    // Kept 23:30 on 19 Oct 2025 in Toronto (already the 20th in UTC).
    const kept = { keptAt: at('2025-10-20T03:30:00Z') }
    expect(isAnniversary(kept, at('2026-10-19T16:00:00Z'), 'America/Toronto')).toBe(true)
    expect(isAnniversary(kept, at('2026-10-20T16:00:00Z'), 'America/Toronto')).toBe(false)
    expect(isAnniversary(kept, at('2026-10-20T16:00:00Z'), 'UTC')).toBe(true)
    // Kept the day DST began; its anniversary needn't be a DST day.
    const spring = { keptAt: at('2026-03-08T12:00:00Z') }
    expect(isAnniversary(spring, at('2027-03-08T12:00:00Z'), 'America/Toronto')).toBe(true)
    // Never the same year.
    expect(isAnniversary({ keptAt: at('2026-10-20T08:00:00Z') }, at('2026-10-20T16:00:00Z'), 'UTC')).toBe(false)
  })

  it('held under Recent, Shore and Quiet; after an asked come-back; once per visit; both opt-ins', () => {
    const base = { settingOn: true, switchOn: true, recent: false, presentation: 'normal' as const, askedDue: false, shownThisVisit: false }
    expect(returnAllowed(base)).toBe(true)
    expect(returnAllowed({ ...base, recent: true })).toBe(false)
    expect(returnAllowed({ ...base, presentation: 'shore' })).toBe(false)
    expect(returnAllowed({ ...base, presentation: 'quiet' })).toBe(false)
    expect(returnAllowed({ ...base, askedDue: true })).toBe(false)
    expect(returnAllowed({ ...base, shownThisVisit: true })).toBe(false)
    expect(returnAllowed({ ...base, settingOn: false })).toBe(false)
    expect(returnAllowed({ ...base, switchOn: false })).toBe(false)
  })
})
