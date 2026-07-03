import { describe, it, expect } from 'vitest'
import { resolveCap, periodKey, decideReservation, type QuotaConfig } from './quota'

describe('resolveCap', () => {
  const base: QuotaConfig = { enabled: true, monthlyTokenCap: 1000 }

  it('uses the base cap when no per-role override exists', () => {
    expect(resolveCap(base, 'standard')).toBe(1000)
    expect(resolveCap(base, 'admin')).toBe(1000)
  })

  it('applies a per-role override', () => {
    const cfg: QuotaConfig = { ...base, perRoleCaps: { admin: 50_000 } }
    expect(resolveCap(cfg, 'admin')).toBe(50_000)
    expect(resolveCap(cfg, 'standard')).toBe(1000)
  })

  it('treats a 0 or negative cap as unlimited (Infinity) so a typo cannot lock everyone out', () => {
    expect(resolveCap({ enabled: true, monthlyTokenCap: 0 }, 'standard')).toBe(Infinity)
    expect(resolveCap({ enabled: true, monthlyTokenCap: -5 }, 'standard')).toBe(Infinity)
    expect(resolveCap({ enabled: true, monthlyTokenCap: 1000, perRoleCaps: { admin: 0 } }, 'admin')).toBe(Infinity)
  })
})

describe('periodKey', () => {
  it('produces a UTC YYYY-MM key', () => {
    expect(periodKey(new Date('2026-07-03T12:00:00Z'))).toBe('2026-07')
    expect(periodKey(new Date('2026-01-01T00:00:00Z'))).toBe('2026-01')
    expect(periodKey(new Date('2026-12-31T23:59:59Z'))).toBe('2026-12')
  })

  it('uses UTC, not local time, at the month boundary', () => {
    // 2026-08-01 00:30 UTC is still July in US timezones but must key as August.
    expect(periodKey(new Date('2026-08-01T00:30:00Z'))).toBe('2026-08')
  })
})

describe('decideReservation', () => {
  const KEY = '2026-07'

  it('admits and starts from 0 when there is no prior doc', () => {
    expect(decideReservation(undefined, KEY, 1000, 200)).toEqual({ allowed: true, used: 0 })
  })

  it('admits when the reservation fits under the cap', () => {
    expect(decideReservation({ period: KEY, tokensUsed: 700 }, KEY, 1000, 200))
      .toEqual({ allowed: true, used: 700 })
  })

  it('rejects when the reservation would cross the cap', () => {
    expect(decideReservation({ period: KEY, tokensUsed: 900 }, KEY, 1000, 200))
      .toEqual({ allowed: false, used: 900 })
  })

  it('admits exactly at the cap boundary', () => {
    expect(decideReservation({ period: KEY, tokensUsed: 800 }, KEY, 1000, 200))
      .toEqual({ allowed: true, used: 800 })
  })

  it('resets usage to 0 when the stored period is a previous month (rollover)', () => {
    // Last month's usage was maxed out, but this month starts fresh.
    expect(decideReservation({ period: '2026-06', tokensUsed: 999_999 }, KEY, 1000, 200))
      .toEqual({ allowed: true, used: 0 })
  })
})
