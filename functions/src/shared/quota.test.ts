import { describe, it, expect } from 'vitest'
import {
  resolveCap,
  periodKey,
  decideReservation,
  computeReconcileUpdate,
  dayKey,
  decideDailyBudget,
  type QuotaConfig,
} from './quota'

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

describe('computeReconcileUpdate', () => {
  const KEY = '2026-10'

  it('refunds unused completion reservation and meters prompt tokens separately', () => {
    // Regression for TECH_ISSUES_2026-10-14 #16: streamed turns now report
    // usage, so a 4000-token reservation settles to the real 300.
    expect(computeReconcileUpdate({ period: KEY, tokensUsed: 4000 }, KEY, 4000, 300, 9000))
      .toEqual({ tokensUsed: 300, promptTokensUsed: 9000 })
  })

  it('adds prompt tokens to the existing monthly input meter without touching the cap unit', () => {
    expect(computeReconcileUpdate({ period: KEY, tokensUsed: 500, promptTokensUsed: 1000 }, KEY, 200, 200, 50))
      .toEqual({ promptTokensUsed: 1050 })
  })

  it('charges the full reservation when actual usage is unknown (caller passes reserved)', () => {
    expect(computeReconcileUpdate({ period: KEY, tokensUsed: 4000 }, KEY, 4000, 4000, 0)).toBeNull()
  })

  it('never drives tokensUsed negative', () => {
    expect(computeReconcileUpdate({ period: KEY, tokensUsed: 10 }, KEY, 4000, 0, 0)).toEqual({ tokensUsed: 0 })
  })

  it('leaves a rolled-over period alone', () => {
    expect(computeReconcileUpdate({ period: '2026-09', tokensUsed: 4000 }, KEY, 4000, 10, 100)).toBeNull()
  })
})

describe('daily budgets', () => {
  it('keys days in UTC', () => {
    expect(dayKey(new Date('2026-10-14T23:59:59Z'))).toBe('2026-10-14')
    expect(dayKey(new Date('2026-10-15T00:00:01Z'))).toBe('2026-10-15')
  })

  it('admits until the limit and rejects at it', () => {
    expect(decideDailyBudget(undefined, '2026-10-14', 30)).toEqual({ allowed: true, used: 0 })
    expect(decideDailyBudget({ day: '2026-10-14', count: 29 }, '2026-10-14', 30)).toEqual({ allowed: true, used: 29 })
    expect(decideDailyBudget({ day: '2026-10-14', count: 30 }, '2026-10-14', 30)).toEqual({ allowed: false, used: 30 })
  })

  it('resets on a new UTC day', () => {
    expect(decideDailyBudget({ day: '2026-10-13', count: 30 }, '2026-10-14', 30)).toEqual({ allowed: true, used: 0 })
  })
})
