import { describe, expect, it } from 'vitest'
import { CLEARED, addMonths, chosenDay, comeBackFields, nextSlip, setAsideToday, usableTimezone, ymdIn, zonedTime } from './comeBack'

// Draft 4 §7 Phase 2: "The due time is correct across DST, timezone changes
// and leap years. One slip appears at a time."

const at = (iso: string) => Date.parse(iso)

describe('the due time: 07:00 writer-local on the chosen day', () => {
  it('Tomorrow across the spring change (Toronto, 8 March 2026)', () => {
    const now = at('2026-03-08T01:00:00Z') // 7 March, 20:00 EST
    const f = comeBackFields('tomorrow', now, 'America/Toronto')
    expect(f?.comeBackAt).toBe(at('2026-03-08T11:00:00Z')) // 07:00 EDT
    expect(f?.comeBackTz).toBe('America/Toronto')
    expect(f?.comeBackSetAt).toBe(now)
  })

  it('Tomorrow across the autumn change (Toronto, 1 November 2026)', () => {
    const now = at('2026-11-01T02:00:00Z') // 31 October, 22:00 EDT
    expect(comeBackFields('tomorrow', now, 'America/Toronto')?.comeBackAt).toBe(at('2026-11-01T12:00:00Z')) // 07:00 EST
  })

  it('In a week spans a change and keeps 07:00 local (London, March 2027)', () => {
    const now = at('2027-03-24T09:00:00Z')
    expect(comeBackFields('week', now, 'Europe/London')?.comeBackAt).toBe(at('2027-03-31T06:00:00Z')) // 07:00 BST
  })

  it('In a month clamps to the month end, with leap years', () => {
    expect(addMonths({ y: 2028, m: 1, d: 31 }, 1)).toEqual({ y: 2028, m: 2, d: 29 })
    expect(addMonths({ y: 2027, m: 1, d: 31 }, 1)).toEqual({ y: 2027, m: 2, d: 28 })
    expect(addMonths({ y: 2026, m: 12, d: 15 }, 1)).toEqual({ y: 2027, m: 1, d: 15 })
    expect(comeBackFields('month', at('2028-01-31T15:00:00Z'), 'UTC')?.comeBackAt).toBe(at('2028-02-29T07:00:00Z'))
  })

  it('half-hour and 45-minute zones', () => {
    expect(zonedTime({ y: 2026, m: 10, d: 20 }, 7, 'Asia/Kolkata')).toBe(at('2026-10-20T01:30:00Z'))
    expect(zonedTime({ y: 2026, m: 10, d: 20 }, 7, 'America/St_Johns')).toBe(at('2026-10-20T09:30:00Z'))
    expect(zonedTime({ y: 2026, m: 10, d: 20 }, 7, 'Pacific/Chatham')).toBe(at('2026-10-19T17:15:00Z'))
  })

  it('"today" is the writer-local day, not UTC', () => {
    // 23:30 on 14 Oct in Toronto is already 15 Oct in UTC.
    const now = at('2026-10-15T03:30:00Z')
    expect(ymdIn(now, 'America/Toronto')).toEqual({ y: 2026, m: 10, d: 14 })
    expect(chosenDay('tomorrow', now, 'America/Toronto')).toEqual({ y: 2026, m: 10, d: 15 })
  })

  it('a date set in one zone stays an instant after the writer moves', () => {
    const f = comeBackFields('tomorrow', at('2026-10-14T12:00:00Z'), 'Asia/Tokyo')
    expect(f?.comeBackAt).toBe(at('2026-10-14T22:00:00Z')) // 07:00 on 15 Oct in Tokyo
    const traces = [{ id: 'a', comeBackAt: f?.comeBackAt ?? null, lastComeBackShownAt: null }]
    expect(nextSlip(traces, at('2026-10-14T21:59:00Z'), 'America/Toronto')).toBeNull()
    expect(nextSlip(traces, at('2026-10-14T22:00:00Z'), 'America/Toronto')?.id).toBe('a')
  })

  it('Pick a day: a real date after today only', () => {
    const now = at('2026-10-14T12:00:00Z')
    expect(comeBackFields({ pick: '2026-10-20' }, now, 'UTC')?.comeBackAt).toBe(at('2026-10-20T07:00:00Z'))
    expect(comeBackFields({ pick: '2026-10-14' }, now, 'UTC')).toBeNull()
    expect(comeBackFields({ pick: '2026-02-30' }, now, 'UTC')).toBeNull()
    expect(comeBackFields({ pick: 'soon' }, now, 'UTC')).toBeNull()
  })

  it('an unusable zone falls back instead of failing', () => {
    expect(usableTimezone('Not/AZone')).not.toBe('Not/AZone')
    expect(comeBackFields('tomorrow', at('2026-10-14T12:00:00Z'), 'Not/AZone')).not.toBeNull()
  })

  it('clearing writes nulls for every come-back field', () => {
    expect(CLEARED).toEqual({ comeBackAt: null, comeBackTz: null, comeBackSetAt: null, lastComeBackShownAt: null })
  })
})

describe('the slip', () => {
  const tz = 'America/Toronto'
  const now = at('2026-10-20T15:00:00Z')
  const t = (id: string, comeBackAt: number | null, lastComeBackShownAt: number | null = null) => ({ id, comeBackAt, lastComeBackShownAt })

  it('one at a time, the earliest due first; nothing not yet due', () => {
    const traces = [t('later', at('2026-10-19T11:00:00Z')), t('first', at('2026-10-10T11:00:00Z')), t('future', at('2026-10-25T11:00:00Z')), t('none', null)]
    expect(nextSlip(traces, now, tz)?.id).toBe('first')
    expect(nextSlip(traces.filter((x) => x.id !== 'first'), now, tz)?.id).toBe('later')
    expect(nextSlip([t('future', at('2026-10-25T11:00:00Z'))], now, tz)).toBeNull()
  })

  it('Not now hides it until the next writer-local day', () => {
    const set = at('2026-10-20T14:00:00Z') // 10:00 in Toronto
    const traces = [t('a', at('2026-10-10T11:00:00Z'), set)]
    expect(setAsideToday(traces[0], now, tz)).toBe(true)
    expect(nextSlip(traces, now, tz)).toBeNull()
    expect(nextSlip(traces, at('2026-10-21T03:59:00Z'), tz)).toBeNull() // 23:59 the same day
    expect(nextSlip(traces, at('2026-10-21T04:00:00Z'), tz)?.id).toBe('a') // midnight
  })
})
