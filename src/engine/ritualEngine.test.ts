import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SessionLog } from '../types'

vi.mock('../store/globalConfig', () => ({
  getGlobalConfig: vi.fn(),
}))

vi.mock('../store/db', () => ({
  db: {
    sessionLog: {
      add: vi.fn(),
      toArray: vi.fn(),
    },
  },
  generateId: vi.fn(() => 'test-id'),
}))

import { categorizeHour } from './ritualEngine'
import { RitualEngine } from './ritualEngine'
import { getGlobalConfig } from '../store/globalConfig'
import { db } from '../store/db'

const mockGetGlobalConfig = vi.mocked(getGlobalConfig)
const mockToArray = vi.mocked(db.sessionLog.toArray)

function enableRituals() {
  mockGetGlobalConfig.mockReturnValue({
    features: { ritualsNotStreaks: true },
    engagement: { ritualDetectionWindow: 14 },
  } as ReturnType<typeof getGlobalConfig>)
}

function disableRituals() {
  mockGetGlobalConfig.mockReturnValue({
    features: { ritualsNotStreaks: false },
  } as ReturnType<typeof getGlobalConfig>)
}

function makeLog(overrides: Partial<SessionLog>): SessionLog {
  return {
    id: 'log-1',
    startedAt: Date.now(),
    wordCount: 200,
    timeOfDay: 'morning',
    dayOfWeek: 1,
    ...overrides,
  }
}

describe('categorizeHour', () => {
  it('returns early-morning for hour 5', () => {
    expect(categorizeHour(5)).toBe('early-morning')
  })

  it('returns early-morning for hour 7', () => {
    expect(categorizeHour(7)).toBe('early-morning')
  })

  it('returns morning for hour 8', () => {
    expect(categorizeHour(8)).toBe('morning')
  })

  it('returns afternoon for hour 12', () => {
    expect(categorizeHour(12)).toBe('afternoon')
  })

  it('returns evening for hour 17', () => {
    expect(categorizeHour(17)).toBe('evening')
  })

  it('returns night for hour 23', () => {
    expect(categorizeHour(23)).toBe('night')
  })

  it('returns night for hour 4 (pre-dawn)', () => {
    expect(categorizeHour(4)).toBe('night')
  })

  it('returns night for hour 0 (midnight)', () => {
    expect(categorizeHour(0)).toBe('night')
  })
})

describe('RitualEngine.detectRituals', () => {
  let engine: RitualEngine

  beforeEach(() => {
    engine = new RitualEngine()
    vi.clearAllMocks()
  })

  it('returns empty when feature is disabled', async () => {
    disableRituals()
    expect(await engine.detectRituals()).toEqual([])
  })

  it('returns empty with fewer than 3 sessions', async () => {
    enableRituals()
    mockToArray.mockResolvedValue([
      makeLog({}),
      makeLog({}),
    ])
    expect(await engine.detectRituals()).toEqual([])
  })

  it('detects time-of-day pattern', async () => {
    enableRituals()
    // 4 out of 5 sessions in morning → 80% > 60% threshold
    mockToArray.mockResolvedValue([
      makeLog({ timeOfDay: 'morning', dayOfWeek: 1 }),
      makeLog({ timeOfDay: 'morning', dayOfWeek: 2 }),
      makeLog({ timeOfDay: 'morning', dayOfWeek: 3 }),
      makeLog({ timeOfDay: 'morning', dayOfWeek: 4 }),
      makeLog({ timeOfDay: 'evening', dayOfWeek: 5 }),
    ])

    const rituals = await engine.detectRituals()
    const timeRituals = rituals.filter((r) => r.pattern.startsWith('time:'))
    expect(timeRituals.length).toBeGreaterThanOrEqual(1)
    expect(timeRituals[0].pattern).toBe('time:morning')
  })

  it('detects day-of-week pattern', async () => {
    enableRituals()
    // 4 out of 5 sessions on Monday (day 1) → 80% > 60%
    mockToArray.mockResolvedValue([
      makeLog({ dayOfWeek: 1, timeOfDay: 'morning' }),
      makeLog({ dayOfWeek: 1, timeOfDay: 'afternoon' }),
      makeLog({ dayOfWeek: 1, timeOfDay: 'evening' }),
      makeLog({ dayOfWeek: 1, timeOfDay: 'morning' }),
      makeLog({ dayOfWeek: 3, timeOfDay: 'morning' }),
    ])

    const rituals = await engine.detectRituals()
    const dayRituals = rituals.filter((r) => r.pattern.startsWith('day:'))
    expect(dayRituals.length).toBeGreaterThanOrEqual(1)
    expect(dayRituals[0].pattern).toBe('day:1')
  })

  it('detects word count length pattern', async () => {
    enableRituals()
    // Morning sessions much longer than others → length:morning
    mockToArray.mockResolvedValue([
      makeLog({ timeOfDay: 'morning', wordCount: 500 }),
      makeLog({ timeOfDay: 'morning', wordCount: 600 }),
      makeLog({ timeOfDay: 'evening', wordCount: 100, dayOfWeek: 2 }),
      makeLog({ timeOfDay: 'afternoon', wordCount: 120, dayOfWeek: 3 }),
      makeLog({ timeOfDay: 'night', wordCount: 80, dayOfWeek: 4 }),
    ])

    const rituals = await engine.detectRituals()
    const lengthRituals = rituals.filter((r) => r.pattern.startsWith('length:'))
    expect(lengthRituals.length).toBeGreaterThanOrEqual(1)
    expect(lengthRituals[0].pattern).toBe('length:morning')
  })

  it('returns no patterns when sessions are evenly distributed', async () => {
    enableRituals()
    mockToArray.mockResolvedValue([
      makeLog({ timeOfDay: 'morning', dayOfWeek: 1, wordCount: 200 }),
      makeLog({ timeOfDay: 'afternoon', dayOfWeek: 2, wordCount: 200 }),
      makeLog({ timeOfDay: 'evening', dayOfWeek: 3, wordCount: 200 }),
      makeLog({ timeOfDay: 'night', dayOfWeek: 4, wordCount: 200 }),
      makeLog({ timeOfDay: 'early-morning', dayOfWeek: 5, wordCount: 200 }),
    ])

    const rituals = await engine.detectRituals()
    // No single time/day/combo exceeds 60%
    const timeOrDayRituals = rituals.filter(
      (r) => r.pattern.startsWith('time:') || r.pattern.startsWith('day:'),
    )
    expect(timeOrDayRituals).toEqual([])
  })
})
