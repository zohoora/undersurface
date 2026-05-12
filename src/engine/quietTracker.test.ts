import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Part } from '../types'

const globalConfigMock = vi.fn(() => null as Record<string, unknown> | null)
vi.mock('../store/globalConfig', () => ({
  getGlobalConfig: () => globalConfigMock(),
}))

const dbPartsUpdate = vi.fn()
vi.mock('../store/db', () => ({
  db: {
    parts: {
      update: (...a: unknown[]) => dbPartsUpdate(...a),
    },
  },
}))

const { QuietTracker } = await import('./quietTracker')

const NOW = Date.parse('2026-05-12T12:00:00Z')
const ONE_DAY = 24 * 60 * 60 * 1000

function makePart(over: Partial<Part>): Part {
  return {
    id: 'p1',
    name: 'Watcher',
    color: '#abc',
    colorLight: '#abc25',
    ifsRole: 'protector',
    voiceDescription: 'quiet',
    concern: 'avoidance',
    systemPrompt: 'be present',
    isSeeded: true,
    createdAt: 0,
    ...over,
  } as Part
}

beforeEach(() => {
  vi.useFakeTimers().setSystemTime(NOW)
  globalConfigMock.mockReset()
  globalConfigMock.mockReturnValue({
    features: { partQuietReturn: true },
    partIntelligence: { quietThresholdDays: 5, returnBonusMultiplier: 2.0 },
  })
  dbPartsUpdate.mockReset()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('QuietTracker.updateLastActive', () => {
  it('stamps lastActiveAt to now and clears quietSince', async () => {
    const tracker = new QuietTracker()
    await tracker.updateLastActive('p1')

    expect(dbPartsUpdate).toHaveBeenCalledWith('p1', {
      lastActiveAt: NOW,
      quietSince: undefined,
    })
  })

  it('swallows db errors and does not throw', async () => {
    dbPartsUpdate.mockRejectedValueOnce(new Error('db down'))
    const tracker = new QuietTracker()
    await expect(tracker.updateLastActive('p1')).resolves.toBeUndefined()
  })
})

describe('QuietTracker.getQuietParts — gating', () => {
  it('returns [] when the partQuietReturn feature flag is off', () => {
    globalConfigMock.mockReturnValue({
      features: { partQuietReturn: false },
      partIntelligence: { quietThresholdDays: 5 },
    })
    const tracker = new QuietTracker()
    const result = tracker.getQuietParts([makePart({ id: 'p1' })])
    expect(result).toEqual([])
  })

  it('returns [] when globalConfig is null (flag check uses !== true)', () => {
    globalConfigMock.mockReturnValue(null)
    const tracker = new QuietTracker()
    expect(tracker.getQuietParts([makePart({ id: 'p1' })])).toEqual([])
  })
})

describe('QuietTracker.getQuietParts — threshold logic', () => {
  it('classifies a part as quiet when lastActiveAt is older than quietThresholdDays', () => {
    const tracker = new QuietTracker()
    const stale = makePart({ id: 'stale', lastActiveAt: NOW - 10 * ONE_DAY })
    const fresh = makePart({ id: 'fresh', lastActiveAt: NOW - 1 * ONE_DAY })

    const result = tracker.getQuietParts([stale, fresh])
    expect(result.map((p) => p.id)).toEqual(['stale'])
  })

  it('treats a part with no lastActiveAt as quiet (never been heard)', () => {
    const tracker = new QuietTracker()
    const neverActive = makePart({ id: 'never', lastActiveAt: undefined })
    expect(tracker.getQuietParts([neverActive]).map((p) => p.id)).toEqual(['never'])
  })

  it('uses the configured threshold (defaults to 5 days when omitted)', () => {
    globalConfigMock.mockReturnValue({ features: { partQuietReturn: true } })
    const tracker = new QuietTracker()
    // 6 days old > default 5-day threshold
    const sixDays = makePart({ id: 'six', lastActiveAt: NOW - 6 * ONE_DAY })
    // 4 days old < default 5-day threshold
    const fourDays = makePart({ id: 'four', lastActiveAt: NOW - 4 * ONE_DAY })

    const result = tracker.getQuietParts([sixDays, fourDays])
    expect(result.map((p) => p.id)).toEqual(['six'])
  })

  it('respects a custom quietThresholdDays from globalConfig', () => {
    globalConfigMock.mockReturnValue({
      features: { partQuietReturn: true },
      partIntelligence: { quietThresholdDays: 30 },
    })
    const tracker = new QuietTracker()
    // 10 days < 30 day threshold → NOT quiet
    const ten = makePart({ id: 'ten', lastActiveAt: NOW - 10 * ONE_DAY })
    expect(tracker.getQuietParts([ten])).toEqual([])
  })
})

describe('QuietTracker.isReturning', () => {
  it('returns true when quietSince is a timestamp', () => {
    const tracker = new QuietTracker()
    expect(tracker.isReturning(makePart({ quietSince: NOW - ONE_DAY }))).toBe(true)
  })

  it('returns true when quietSince is 0 (still a number, != null)', () => {
    // Defensive: quietSince of 0 is unusual but != null, so it counts.
    const tracker = new QuietTracker()
    expect(tracker.isReturning(makePart({ quietSince: 0 }))).toBe(true)
  })

  it('returns false when quietSince is undefined', () => {
    const tracker = new QuietTracker()
    expect(tracker.isReturning(makePart({ quietSince: undefined }))).toBe(false)
  })
})

describe('QuietTracker.markQuiet', () => {
  it('persists quietSince=now via db.parts.update', async () => {
    const tracker = new QuietTracker()
    await tracker.markQuiet(makePart({ id: 'p1' }))
    expect(dbPartsUpdate).toHaveBeenCalledWith('p1', { quietSince: NOW })
  })

  it('swallows db errors and does not throw', async () => {
    dbPartsUpdate.mockRejectedValueOnce(new Error('db down'))
    const tracker = new QuietTracker()
    await expect(tracker.markQuiet(makePart({ id: 'p1' }))).resolves.toBeUndefined()
  })
})

describe('QuietTracker.getReturnBonus', () => {
  it('returns the configured returnBonusMultiplier', () => {
    globalConfigMock.mockReturnValue({
      partIntelligence: { returnBonusMultiplier: 3.5 },
    })
    expect(new QuietTracker().getReturnBonus()).toBe(3.5)
  })

  it('defaults to 2.0 when globalConfig is null', () => {
    globalConfigMock.mockReturnValue(null)
    expect(new QuietTracker().getReturnBonus()).toBe(2.0)
  })

  it('defaults to 2.0 when partIntelligence is missing', () => {
    globalConfigMock.mockReturnValue({})
    expect(new QuietTracker().getReturnBonus()).toBe(2.0)
  })
})
