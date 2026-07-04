import { describe, it, expect } from 'vitest'
import {
  detectAbandonedSession,
  detectAtypicalGap,
  detectTerseEnding,
  detectOpenTimeEvidence,
} from './ruptureDetector'
import type { Session } from '../types'

const HOUR = 3_600_000
const DAY = 24 * HOUR
const NOW = 1_750_000_000_000

// Sessions are passed newest-first (matching db.sessions orderBy startedAt desc).
function makeSession(overrides: Partial<Session>): Session {
  return {
    id: 's',
    startedAt: NOW - DAY,
    endedAt: null,
    status: 'closed',
    messageCount: 10,
    firstLine: '',
    ...overrides,
  } as Session
}

// A closer-habit history: closed sessions on a steady 2-day cadence.
function closedHistory(count: number, newestStart: number, gapMs = 2 * DAY): Session[] {
  return Array.from({ length: count }, (_, i) =>
    makeSession({ id: `h${i}`, startedAt: newestStart - i * gapMs, status: 'closed' }),
  )
}

describe('detectAbandonedSession', () => {
  it('fires for an engaged, stale, active session left by a habitual closer', () => {
    const prior = [
      makeSession({ id: 'p0', status: 'active', messageCount: 6, startedAt: NOW - 8 * HOUR }),
      ...closedHistory(9, NOW - 2 * DAY),
    ]
    expect(detectAbandonedSession(prior, NOW)).toBe(true)
  })

  it('does NOT fire when the user rarely closes sessions (habit guard)', () => {
    const prior = [
      makeSession({ id: 'p0', status: 'active', messageCount: 6, startedAt: NOW - 8 * HOUR }),
      ...Array.from({ length: 9 }, (_, i) =>
        makeSession({ id: `h${i}`, status: 'active', startedAt: NOW - (i + 2) * DAY }),
      ),
    ]
    expect(detectAbandonedSession(prior, NOW)).toBe(false)
  })

  it('does NOT fire below the engagement floor (messageCount < 4)', () => {
    const prior = [
      makeSession({ id: 'p0', status: 'active', messageCount: 3, startedAt: NOW - 8 * HOUR }),
      ...closedHistory(9, NOW - 2 * DAY),
    ]
    expect(detectAbandonedSession(prior, NOW)).toBe(false)
  })

  it('does NOT fire when the active session is fresher than 6h (may still resume)', () => {
    const prior = [
      makeSession({ id: 'p0', status: 'active', messageCount: 6, startedAt: NOW - 5 * HOUR }),
      ...closedHistory(9, NOW - 2 * DAY),
    ]
    expect(detectAbandonedSession(prior, NOW)).toBe(false)
  })

  it('does NOT fire when the newest prior session was closed properly', () => {
    const prior = closedHistory(10, NOW - 8 * HOUR)
    expect(detectAbandonedSession(prior, NOW)).toBe(false)
  })

  it('does NOT fire with no prior sessions', () => {
    expect(detectAbandonedSession([], NOW)).toBe(false)
  })
})

describe('detectAtypicalGap', () => {
  it('fires when the gap dwarfs an established cadence and exceeds 10 days', () => {
    // 2-day cadence, newest session 12 days ago: 12d > 3×2d and > 10d.
    const prior = closedHistory(6, NOW - 12 * DAY)
    expect(detectAtypicalGap(prior, NOW)).toBe(true)
  })

  it('does NOT fire under 10 days even if 3x the cadence', () => {
    // Daily cadence, 8-day gap: 8d > 3×1d but under the absolute floor.
    const prior = closedHistory(6, NOW - 8 * DAY, DAY)
    expect(detectAtypicalGap(prior, NOW)).toBe(false)
  })

  it('does NOT fire for a sparse user whose normal cadence is already long', () => {
    // Monthly cadence, 5-week gap: > 10 days but not > 3× median.
    const prior = closedHistory(6, NOW - 35 * DAY, 30 * DAY)
    expect(detectAtypicalGap(prior, NOW)).toBe(false)
  })

  it('does NOT fire without an established cadence (< 5 prior sessions)', () => {
    const prior = closedHistory(4, NOW - 40 * DAY, 2 * DAY)
    expect(detectAtypicalGap(prior, NOW)).toBe(false)
  })
})

describe('detectTerseEnding', () => {
  // Median of eight 100-char messages is 100; 40% threshold = 40 chars.
  const engaged = [100, 100, 100, 100, 100]

  it('fires when the last 3 messages collapse below 40% of the session median', () => {
    expect(detectTerseEnding([...engaged, 30, 20, 10])).toBe(true)
  })

  it('does NOT fire when only 2 of the last 3 are terse', () => {
    expect(detectTerseEnding([...engaged, 90, 20, 10])).toBe(false)
  })

  it('does NOT fire below the 8-message engagement floor', () => {
    expect(detectTerseEnding([100, 100, 100, 100, 30, 20, 10])).toBe(false)
  })

  it('does NOT fire for a uniformly brief writer (short median)', () => {
    // Median 20 → threshold 8; closing messages of 15 are normal for them.
    expect(detectTerseEnding([20, 20, 20, 20, 20, 15, 15, 15])).toBe(false)
  })
})

describe('detectOpenTimeEvidence', () => {
  it('prefers abandoned over atypical gap when both fire', () => {
    // Active stale engaged newest + a 12-day gap on a 2-day cadence.
    const prior = [
      makeSession({ id: 'p0', status: 'active', messageCount: 6, startedAt: NOW - 12 * DAY }),
      ...closedHistory(9, NOW - 14 * DAY),
    ]
    expect(detectOpenTimeEvidence(prior, NOW)).toBe('abandoned')
  })

  it('returns atypical_gap when only the gap fires', () => {
    const prior = closedHistory(6, NOW - 12 * DAY)
    expect(detectOpenTimeEvidence(prior, NOW)).toBe('atypical_gap')
  })

  it('returns null when nothing fires', () => {
    const prior = closedHistory(6, NOW - 2 * DAY)
    expect(detectOpenTimeEvidence(prior, NOW)).toBe(null)
  })
})
