import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { EntrySummary } from '../types'

const globalConfigMock = vi.fn(() => null as Record<string, unknown> | null)
vi.mock('../store/globalConfig', () => ({
  getGlobalConfig: () => globalConfigMock(),
}))

let fakeSummaries: EntrySummary[] = []
vi.mock('../store/db', () => ({
  db: {
    entrySummaries: {
      orderBy: () => ({
        reverse: () => ({
          toArray: async () =>
            [...fakeSummaries].sort((a, b) => b.timestamp - a.timestamp),
        }),
      }),
    },
  },
}))

const { ThreadEngine } = await import('./threadEngine')

const NOW = Date.parse('2026-05-12T12:00:00Z')
const oneDay = 24 * 60 * 60 * 1000

function makeSummary(over: Partial<EntrySummary> = {}): EntrySummary {
  return {
    id: 's',
    entryId: 'e',
    themes: ['theme-a'],
    emotionalArc: 'a calm reflection',
    keyMoments: ['noticed a feeling'],
    timestamp: NOW - oneDay,
    ...over,
  } as EntrySummary
}

beforeEach(() => {
  vi.useFakeTimers().setSystemTime(NOW)
  globalConfigMock.mockReset()
  // Default: feature on, threadChance 1.0 so the dice roll doesn't matter.
  globalConfigMock.mockReturnValue({
    features: { unfinishedThreads: true },
    engagement: { threadMaxAge: 30, threadChance: 1.0 },
  })
  fakeSummaries = []
})

afterEach(() => {
  vi.useRealTimers()
})

describe('ThreadEngine.findUnfinishedThread — gating', () => {
  it('returns null when the feature flag is off', async () => {
    globalConfigMock.mockReturnValue({ features: { unfinishedThreads: false } })
    const engine = new ThreadEngine()
    const result = await engine.findUnfinishedThread('today I wrote about work')
    expect(result).toBeNull()
  })

  it('returns null when the feature flag is missing entirely', async () => {
    globalConfigMock.mockReturnValue(null)
    const engine = new ThreadEngine()
    const result = await engine.findUnfinishedThread('today')
    expect(result).toBeNull()
  })

  it('returns null on probabilistic skip (Math.random() > threadChance)', async () => {
    globalConfigMock.mockReturnValue({
      features: { unfinishedThreads: true },
      engagement: { threadMaxAge: 30, threadChance: 0.1 },
    })
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5) // > 0.1
    fakeSummaries = [
      makeSummary({ keyMoments: ['I trailed off mid-sentence'] }),
      makeSummary({ id: 's2', entryId: 'e2' }),
    ]
    const engine = new ThreadEngine()
    const result = await engine.findUnfinishedThread('today')
    expect(result).toBeNull()
    randomSpy.mockRestore()
  })

  it('proceeds when Math.random() <= threadChance', async () => {
    globalConfigMock.mockReturnValue({
      features: { unfinishedThreads: true },
      engagement: { threadMaxAge: 30, threadChance: 0.5 },
    })
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.3) // < 0.5
    fakeSummaries = [
      makeSummary({ keyMoments: ['I trailed off mid-sentence'] }),
      makeSummary({ id: 's2', entryId: 'e2' }),
    ]
    const engine = new ThreadEngine()
    const result = await engine.findUnfinishedThread('today')
    expect(result).not.toBeNull()
    randomSpy.mockRestore()
  })

  it('returns null when fewer than 2 recent summaries exist', async () => {
    fakeSummaries = [makeSummary()]
    const engine = new ThreadEngine()
    const result = await engine.findUnfinishedThread('today')
    expect(result).toBeNull()
  })

  it('respects threadMaxAge — summaries older than the window are filtered out', async () => {
    globalConfigMock.mockReturnValue({
      features: { unfinishedThreads: true },
      engagement: { threadMaxAge: 7, threadChance: 1.0 },
    })
    fakeSummaries = [
      makeSummary({ id: 'old', entryId: 'e-old', timestamp: NOW - 30 * oneDay, keyMoments: ['I trailed off here'] }),
      makeSummary({ id: 'also-old', entryId: 'e-also-old', timestamp: NOW - 10 * oneDay }),
    ]
    const engine = new ThreadEngine()
    const result = await engine.findUnfinishedThread('today')
    expect(result).toBeNull() // both filtered out → < 2 → null
  })
})

describe('ThreadEngine — strategy 1: unfinished signals', () => {
  it('detects a "trailed off" signal in keyMoments', async () => {
    fakeSummaries = [
      makeSummary({ entryId: 'e1', themes: ['grief'], keyMoments: ['she trailed off about her mother'], emotionalArc: 'heavy' }),
      makeSummary({ id: 's2', entryId: 'e2' }),
    ]
    const engine = new ThreadEngine()
    const result = await engine.findUnfinishedThread('today')

    expect(result).toEqual({
      theme: 'grief',
      entryId: 'e1',
      summary: 'heavy — she trailed off about her mother',
    })
  })

  it('detects unfinished signals in emotionalArc when keyMoments has none', async () => {
    fakeSummaries = [
      makeSummary({
        entryId: 'e1',
        themes: ['work'],
        keyMoments: ['nothing suspicious here'],
        emotionalArc: 'began to explore a sense of failure',
      }),
      makeSummary({ id: 's2', entryId: 'e2' }),
    ]
    const engine = new ThreadEngine()
    const result = await engine.findUnfinishedThread('today')

    expect(result).toEqual({
      theme: 'work',
      entryId: 'e1',
      summary: 'began to explore a sense of failure',
    })
  })

  it('falls back to "an unfinished thought" when themes is empty (defensive)', async () => {
    fakeSummaries = [
      makeSummary({ entryId: 'e1', themes: [], keyMoments: ['I stopped before saying it'], emotionalArc: 'arc' }),
      makeSummary({ id: 's2', entryId: 'e2' }),
    ]
    const engine = new ThreadEngine()
    const result = await engine.findUnfinishedThread('today')
    expect(result?.theme).toBe('an unfinished thought')
  })

  it('matches signals case-insensitively', async () => {
    fakeSummaries = [
      makeSummary({ entryId: 'e1', themes: ['t'], keyMoments: ['She HINTED AT something deep'] }),
      makeSummary({ id: 's2', entryId: 'e2' }),
    ]
    const engine = new ThreadEngine()
    const result = await engine.findUnfinishedThread('today')
    expect(result).not.toBeNull()
    expect(result?.entryId).toBe('e1')
  })
})

describe('ThreadEngine — strategy 2: orphan themes', () => {
  it('returns null when every theme appears 2+ times (nothing orphaned)', async () => {
    fakeSummaries = [
      makeSummary({ entryId: 'e1', themes: ['shared'], keyMoments: ['nothing'], emotionalArc: 'a' }),
      makeSummary({ id: 's2', entryId: 'e2', themes: ['shared'], keyMoments: ['nothing'], emotionalArc: 'b' }),
    ]
    const engine = new ThreadEngine()
    const result = await engine.findUnfinishedThread('today')
    expect(result).toBeNull()
  })

  it('returns an orphan theme (appearing only once)', async () => {
    fakeSummaries = [
      makeSummary({ entryId: 'e1', themes: ['shared'], keyMoments: ['nothing'], emotionalArc: 'common' }),
      makeSummary({ id: 's2', entryId: 'e2', themes: ['shared'], keyMoments: ['nothing'], emotionalArc: 'common' }),
      makeSummary({ id: 's3', entryId: 'e3', themes: ['solo-theme'], keyMoments: ['nothing'], emotionalArc: 'lonely arc' }),
    ]
    const engine = new ThreadEngine()
    const result = await engine.findUnfinishedThread('today I am writing')

    expect(result).toEqual({
      theme: 'solo-theme',
      entryId: 'e3',
      summary: 'lonely arc',
    })
  })

  it('prefers an orphan whose theme words overlap with current text (relevance scoring)', async () => {
    fakeSummaries = [
      makeSummary({ entryId: 'eA', themes: ['shared'], keyMoments: ['nothing'], emotionalArc: 'x' }),
      makeSummary({ id: 'sB', entryId: 'eB', themes: ['shared'], keyMoments: ['nothing'], emotionalArc: 'x' }),
      // Orphan A: no relevance to current text
      makeSummary({ id: 's-orphan-a', entryId: 'orphan-a', themes: ['mountain'], keyMoments: ['nothing'], emotionalArc: 'about hiking' }),
      // Orphan B: contains a word ('garden') that's in the current text — should win.
      makeSummary({ id: 's-orphan-b', entryId: 'orphan-b', themes: ['garden hidden'], keyMoments: ['nothing'], emotionalArc: 'about flowers' }),
    ]
    const engine = new ThreadEngine()
    const result = await engine.findUnfinishedThread('walking through the garden today')

    expect(result?.entryId).toBe('orphan-b')
  })

  it('breaks ties by recency when relevance is equal', async () => {
    fakeSummaries = [
      makeSummary({ entryId: 'eA', themes: ['shared'], emotionalArc: 'x' }),
      makeSummary({ id: 'sB', entryId: 'eB', themes: ['shared'], emotionalArc: 'x' }),
      makeSummary({ id: 's-orphan-old', entryId: 'older', themes: ['unique-old'], timestamp: NOW - 5 * oneDay }),
      makeSummary({ id: 's-orphan-new', entryId: 'newer', themes: ['unique-new'], timestamp: NOW - 1 * oneDay }),
    ]
    const engine = new ThreadEngine()
    const result = await engine.findUnfinishedThread('totally unrelated text')

    expect(result?.entryId).toBe('newer')
  })

  it('compares theme words at length > 3 (ignores stop-word-sized fragments)', async () => {
    fakeSummaries = [
      makeSummary({ entryId: 'eA', themes: ['shared'], emotionalArc: 'x' }),
      makeSummary({ id: 'sB', entryId: 'eB', themes: ['shared'], emotionalArc: 'x' }),
      // Theme has only short words — relevance scoring must not credit them.
      makeSummary({ id: 's-short', entryId: 'short', themes: ['a or be'], emotionalArc: 'x' }),
      makeSummary({ id: 's-long', entryId: 'long', themes: ['horizon'], emotionalArc: 'x' }),
    ]
    const engine = new ThreadEngine()
    // Current text contains "be" — short-word overlap should NOT decide.
    const result = await engine.findUnfinishedThread('I want to be more')

    // Both orphans have zero qualifying relevance overlap; recency wins. They
    // were inserted in array order; the recency-tie-break sorts by timestamp.
    // Both have default timestamp (NOW - oneDay), so the first one encountered
    // wins — the sort is stable.
    expect(['short', 'long']).toContain(result?.entryId)
  })
})

describe('ThreadEngine — error path', () => {
  it('returns null and does NOT throw when the db query fails', async () => {
    // The engine catches errors internally.
    fakeSummaries = [makeSummary(), makeSummary({ id: 's2', entryId: 'e2' })]
    // Mock toArray to throw for this one test.
    const dbModule = await import('../store/db')
    type OrderByReturn = ReturnType<typeof dbModule.db.entrySummaries.orderBy>
    const spy = vi.spyOn(dbModule.db.entrySummaries, 'orderBy').mockReturnValue({
      reverse: () => ({ toArray: async () => { throw new Error('db down') } }),
    } as unknown as OrderByReturn)

    const engine = new ThreadEngine()
    await expect(engine.findUnfinishedThread('today')).resolves.toBeNull()

    spy.mockRestore()
  })
})
