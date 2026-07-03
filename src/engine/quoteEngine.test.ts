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
          toArray: async () => [...fakeSummaries].sort((a, b) => b.timestamp - a.timestamp),
        }),
      }),
    },
  },
}))

const { QuoteEngine } = await import('./quoteEngine')

const NOW = Date.parse('2026-05-12T12:00:00Z')
const ONE_DAY = 24 * 60 * 60 * 1000

// A keyMoment long enough to clear the 20–300 char bounds and carrying the
// overlap words the relevance scorer keys on.
const GARDEN_MOMENT = 'I sat by the window and watched the garden roses open in the morning light.'

function makeSummary(over: Partial<EntrySummary> = {}): EntrySummary {
  return {
    id: 's',
    entryId: 'e',
    themes: ['theme-a'],
    emotionalArc: 'arc',
    keyMoments: [GARDEN_MOMENT],
    timestamp: NOW - 10 * ONE_DAY,
    ...over,
  } as EntrySummary
}

beforeEach(() => {
  vi.useFakeTimers().setSystemTime(NOW)
  globalConfigMock.mockReset()
  globalConfigMock.mockReturnValue({
    features: { partsQuoting: true },
    partIntelligence: { quoteChance: 1.0, quoteMinAge: 3 },
  })
  fakeSummaries = []
})

afterEach(() => {
  vi.useRealTimers()
})

describe('QuoteEngine.findQuote — gating', () => {
  it('returns null when the partsQuoting feature flag is off', async () => {
    globalConfigMock.mockReturnValue({ features: { partsQuoting: false } })
    const result = await new QuoteEngine().findQuote('garden today')
    expect(result).toBeNull()
  })

  it('returns null when globalConfig is null', async () => {
    globalConfigMock.mockReturnValue(null)
    expect(await new QuoteEngine().findQuote('garden today')).toBeNull()
  })

  it('returns null when Math.random() > quoteChance (probabilistic gate)', async () => {
    globalConfigMock.mockReturnValue({
      features: { partsQuoting: true },
      partIntelligence: { quoteChance: 0.15, quoteMinAge: 3 },
    })
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0.5)
    fakeSummaries = [makeSummary({ themes: ['garden'] })]

    const result = await new QuoteEngine().findQuote('garden today')
    expect(result).toBeNull()
    spy.mockRestore()
  })

  it('proceeds when Math.random() <= quoteChance', async () => {
    globalConfigMock.mockReturnValue({
      features: { partsQuoting: true },
      partIntelligence: { quoteChance: 0.5, quoteMinAge: 3 },
    })
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0.3)
    fakeSummaries = [makeSummary({ entryId: 'e1', themes: ['garden'] })]

    const result = await new QuoteEngine().findQuote('walking in the garden today')
    expect(result).not.toBeNull()
    spy.mockRestore()
  })
})

describe('QuoteEngine.findQuote — quoteMinAge', () => {
  it('excludes summaries newer than quoteMinAge days', async () => {
    // Default quoteMinAge=3; summary at 1 day old is too new.
    fakeSummaries = [
      makeSummary({ entryId: 'recent', themes: ['garden'], timestamp: NOW - 1 * ONE_DAY }),
    ]
    const result = await new QuoteEngine().findQuote('garden today')
    expect(result).toBeNull()
  })

  it('respects a custom quoteMinAge', async () => {
    globalConfigMock.mockReturnValue({
      features: { partsQuoting: true },
      partIntelligence: { quoteChance: 1.0, quoteMinAge: 30 },
    })
    // 10 days old is recent by a 30-day min — should be excluded.
    fakeSummaries = [
      makeSummary({ entryId: 'recent', themes: ['garden'], timestamp: NOW - 10 * ONE_DAY }),
    ]
    expect(await new QuoteEngine().findQuote('garden today')).toBeNull()
  })

  it('only considers up to the 5 most recent qualifying summaries', async () => {
    // Create 7 qualifying summaries. The earliest (oldest) two should be ignored
    // entirely because `.slice(0, 5)` truncates after the reverse-chronological sort.
    fakeSummaries = []
    for (let i = 0; i < 7; i++) {
      const isTarget = i === 6
      fakeSummaries.push(
        makeSummary({
          id: `s${i}`,
          entryId: `e${i}`,
          themes: isTarget ? ['garden'] : ['unrelated'],
          // Only the target carries garden words; the rest must not match the
          // query on themes OR keyMoments, or a top-5 summary would win.
          keyMoments: isTarget ? [GARDEN_MOMENT] : ['a quiet grey afternoon with nothing much happening at all'],
          timestamp: NOW - (10 + i) * ONE_DAY, // index 6 is the OLDEST
        }),
      )
    }
    // The only summary matching 'garden' is the oldest (index 6) — outside the
    // top-5 window, so no quote should fire.
    const result = await new QuoteEngine().findQuote('walking through the garden today')
    expect(result).toBeNull()
  })
})

describe('QuoteEngine.findQuote — relevance + output shape', () => {
  it('returns null when no summary has any word overlap', async () => {
    fakeSummaries = [makeSummary({ entryId: 'e1', themes: ['mountain'], keyMoments: ['a long hike up the cold ridge at dawn'] })]
    expect(await new QuoteEngine().findQuote('completely different text')).toBeNull()
  })

  it('selects the summary with the highest word overlap', async () => {
    fakeSummaries = [
      makeSummary({
        entryId: 'weak',
        themes: ['mountain'],
        keyMoments: ['a quiet grey afternoon with nothing much happening at all'],
        timestamp: NOW - 10 * ONE_DAY,
      }),
      makeSummary({
        id: 's2',
        entryId: 'strong',
        themes: ['garden roses'],
        keyMoments: [GARDEN_MOMENT],
        timestamp: NOW - 10 * ONE_DAY,
      }),
    ]

    const result = await new QuoteEngine().findQuote('walking through the garden among roses in the morning light')
    expect(result?.entryId).toBe('strong')
    expect(result?.text).toBe(GARDEN_MOMENT)
  })

  it('returns the {text, entryId} shape with a passage between 20 and 300 chars', async () => {
    fakeSummaries = [makeSummary({ entryId: 'e1', themes: ['garden roses'] })]
    const result = await new QuoteEngine().findQuote('garden roses today')
    expect(result?.entryId).toBe('e1')
    expect(result!.text.length).toBeGreaterThanOrEqual(20)
    expect(result!.text.length).toBeLessThanOrEqual(300)
  })

  it('returns null when the matched summary has no in-bounds keyMoment', async () => {
    fakeSummaries = [makeSummary({ entryId: 'tiny', themes: ['garden'], keyMoments: ['hi', 'yo'] })]
    expect(await new QuoteEngine().findQuote('garden today')).toBeNull()
  })

  it('returns null when the matched summary has an empty keyMoments array', async () => {
    fakeSummaries = [makeSummary({ entryId: 'empty', themes: ['garden'], keyMoments: [] })]
    expect(await new QuoteEngine().findQuote('garden today')).toBeNull()
  })
})

describe('QuoteEngine.findQuote — error path', () => {
  it('returns null and swallows db errors', async () => {
    const dbModule = await import('../store/db')
    type OrderByReturn = ReturnType<typeof dbModule.db.entrySummaries.orderBy>
    const spy = vi.spyOn(dbModule.db.entrySummaries, 'orderBy').mockReturnValue({
      reverse: () => ({ toArray: async () => { throw new Error('db down') } }),
    } as unknown as OrderByReturn)

    expect(await new QuoteEngine().findQuote('anything')).toBeNull()
    spy.mockRestore()
  })
})
