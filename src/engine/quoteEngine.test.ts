import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { EntrySummary } from '../types'

const globalConfigMock = vi.fn(() => null as Record<string, unknown> | null)
vi.mock('../store/globalConfig', () => ({
  getGlobalConfig: () => globalConfigMock(),
}))

let fakeSummaries: EntrySummary[] = []
let fakeEntries: Record<string, { id: string, plainText: string }> = {}

vi.mock('../store/db', () => ({
  db: {
    entrySummaries: {
      orderBy: () => ({
        reverse: () => ({
          toArray: async () => [...fakeSummaries].sort((a, b) => b.timestamp - a.timestamp),
        }),
      }),
    },
    entries: {
      get: async (id: string) => fakeEntries[id],
    },
  },
}))

const { QuoteEngine } = await import('./quoteEngine')

const NOW = Date.parse('2026-05-12T12:00:00Z')
const ONE_DAY = 24 * 60 * 60 * 1000

function makeSummary(over: Partial<EntrySummary> = {}): EntrySummary {
  return {
    id: 's',
    entryId: 'e',
    themes: ['theme-a'],
    emotionalArc: 'arc',
    keyMoments: ['moment'],
    timestamp: NOW - 10 * ONE_DAY,
    ...over,
  } as EntrySummary
}

function richEntryText(): string {
  return [
    'I sat by the window for a long time today.',
    'The garden outside was beginning to wake from winter.',
    'A small bird landed on the sill and watched me write.',
    'It reminded me of something I had not thought about in years.',
    'Then it flew away and I kept writing.',
  ].join(' ')
}

beforeEach(() => {
  vi.useFakeTimers().setSystemTime(NOW)
  globalConfigMock.mockReset()
  globalConfigMock.mockReturnValue({
    features: { partsQuoting: true },
    partIntelligence: { quoteChance: 1.0, quoteMinAge: 3 },
  })
  fakeSummaries = []
  fakeEntries = {}
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
    fakeEntries['e'] = { id: 'e', plainText: richEntryText() }

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
    fakeEntries['e1'] = { id: 'e1', plainText: richEntryText() }

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
    fakeEntries['recent'] = { id: 'recent', plainText: richEntryText() }
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
    fakeEntries['recent'] = { id: 'recent', plainText: richEntryText() }
    expect(await new QuoteEngine().findQuote('garden today')).toBeNull()
  })

  it('only considers up to the 5 most recent qualifying summaries', async () => {
    // Create 7 qualifying summaries. The earliest (oldest) two should be ignored
    // entirely because `.slice(0, 5)` truncates after the reverse-chronological sort.
    fakeSummaries = []
    for (let i = 0; i < 7; i++) {
      fakeSummaries.push(
        makeSummary({
          id: `s${i}`,
          entryId: `e${i}`,
          themes: i === 6 ? ['garden'] : ['unrelated'],
          timestamp: NOW - (10 + i) * ONE_DAY, // index 6 is the OLDEST
        }),
      )
      fakeEntries[`e${i}`] = { id: `e${i}`, plainText: richEntryText() }
    }
    // The only summary matching 'garden' is the oldest (index 6) — outside the
    // top-5 window, so no quote should fire.
    const result = await new QuoteEngine().findQuote('walking through the garden today')
    expect(result).toBeNull()
  })
})

describe('QuoteEngine.findQuote — relevance + output shape', () => {
  it('returns null when no summary has any word overlap', async () => {
    fakeSummaries = [makeSummary({ entryId: 'e1', themes: ['mountain'], keyMoments: ['hiking'] })]
    fakeEntries['e1'] = { id: 'e1', plainText: richEntryText() }
    expect(await new QuoteEngine().findQuote('completely different text')).toBeNull()
  })

  it('selects the summary with the highest word overlap', async () => {
    fakeSummaries = [
      makeSummary({ entryId: 'weak', themes: ['mountain'], timestamp: NOW - 10 * ONE_DAY }),
      makeSummary({
        id: 's2',
        entryId: 'strong',
        themes: ['garden roses'],
        keyMoments: ['flowers blooming'],
        timestamp: NOW - 10 * ONE_DAY,
      }),
    ]
    fakeEntries['weak'] = { id: 'weak', plainText: richEntryText() }
    fakeEntries['strong'] = { id: 'strong', plainText: richEntryText() }

    const result = await new QuoteEngine().findQuote('walking through the garden among roses and flowers blooming')
    expect(result?.entryId).toBe('strong')
  })

  it('returns the {text, entryId} shape with a passage between 20 and 300 chars', async () => {
    fakeSummaries = [makeSummary({ entryId: 'e1', themes: ['garden roses'] })]
    fakeEntries['e1'] = { id: 'e1', plainText: richEntryText() }
    const result = await new QuoteEngine().findQuote('garden roses today')
    expect(result?.entryId).toBe('e1')
    expect(result!.text.length).toBeGreaterThanOrEqual(20)
    expect(result!.text.length).toBeLessThanOrEqual(300)
  })

  it('returns null when the matched entry is missing from the db', async () => {
    fakeSummaries = [makeSummary({ entryId: 'ghost', themes: ['garden'] })]
    expect(await new QuoteEngine().findQuote('garden today')).toBeNull()
  })

  it('returns null when the matched entry has empty plainText', async () => {
    fakeSummaries = [makeSummary({ entryId: 'empty', themes: ['garden'] })]
    fakeEntries['empty'] = { id: 'empty', plainText: '' }
    expect(await new QuoteEngine().findQuote('garden today')).toBeNull()
  })

  it('returns null when extractPassage cannot form a 20–300 char passage', async () => {
    fakeSummaries = [makeSummary({ entryId: 'tiny', themes: ['garden'] })]
    fakeEntries['tiny'] = { id: 'tiny', plainText: 'Hi. Yo.' }
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
