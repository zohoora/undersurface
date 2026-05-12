import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { EntrySummary } from '../types'

const globalConfigMock = vi.fn(() => null as Record<string, unknown> | null)
vi.mock('../store/globalConfig', () => ({
  getGlobalConfig: () => globalConfigMock(),
}))

let fakeSummaries: EntrySummary[] = []
let fakeEntries: Record<string, { id: string, plainText: string, createdAt: number }> = {}

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

const { EchoEngine } = await import('./echoEngine')

const NOW = Date.parse('2026-05-12T12:00:00Z')
const ONE_DAY = 24 * 60 * 60 * 1000

function makeSummary(over: Partial<EntrySummary> = {}): EntrySummary {
  return {
    id: 's',
    entryId: 'e',
    themes: ['theme-a'],
    emotionalArc: 'arc',
    keyMoments: ['moment'],
    timestamp: NOW - 30 * ONE_DAY,
    ...over,
  } as EntrySummary
}

/** Build a multi-sentence string that, when extractFragment runs, will yield a fragment between 20 and 300 chars. */
function richEntryText(): string {
  return [
    'I walked through the garden today.',
    'The roses were beginning to bloom in shades I had not seen before.',
    'It reminded me of something I had almost forgotten.',
    'A memory from years ago, sharp and slow at once.',
    'I sat on the bench and let the time pass.',
  ].join(' ')
}

beforeEach(() => {
  vi.useFakeTimers().setSystemTime(NOW)
  globalConfigMock.mockReset()
  globalConfigMock.mockReturnValue({
    features: { echoes: true },
    engagement: { echoChance: 1.0, echoMaxAge: 90, echoMaxPerSession: 3 },
  })
  fakeSummaries = []
  fakeEntries = {}
})

afterEach(() => {
  vi.useRealTimers()
})

describe('EchoEngine.findEcho — gating', () => {
  it('returns null when the echoes feature flag is off', async () => {
    globalConfigMock.mockReturnValue({ features: { echoes: false } })
    const result = await new EchoEngine().findEcho('garden today')
    expect(result).toBeNull()
  })

  it('returns null when globalConfig is missing', async () => {
    globalConfigMock.mockReturnValue(null)
    const result = await new EchoEngine().findEcho('garden today')
    expect(result).toBeNull()
  })

  it('returns null when the per-session echo cap has been hit', async () => {
    globalConfigMock.mockReturnValue({
      features: { echoes: true },
      engagement: { echoChance: 1.0, echoMaxAge: 90, echoMaxPerSession: 1 },
    })
    fakeSummaries = [
      makeSummary({ entryId: 'e1', themes: ['garden'] }),
    ]
    fakeEntries['e1'] = { id: 'e1', plainText: richEntryText(), createdAt: NOW - 30 * ONE_DAY }

    const engine = new EchoEngine()
    // First call should succeed and increment counter
    const first = await engine.findEcho('the garden bloomed today')
    expect(first).not.toBeNull()
    // Second call hits the cap
    const second = await engine.findEcho('the garden bloomed today')
    expect(second).toBeNull()
  })

  it('returns null on probabilistic skip (Math.random() > echoChance)', async () => {
    globalConfigMock.mockReturnValue({
      features: { echoes: true },
      engagement: { echoChance: 0.1, echoMaxAge: 90, echoMaxPerSession: 3 },
    })
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0.5)
    fakeSummaries = [makeSummary({ themes: ['garden'] })]
    fakeEntries['e'] = { id: 'e', plainText: richEntryText(), createdAt: NOW - 30 * ONE_DAY }

    const result = await new EchoEngine().findEcho('garden today')
    expect(result).toBeNull()
    spy.mockRestore()
  })
})

describe('EchoEngine.findEcho — age window', () => {
  it('excludes summaries newer than 3 days (the minAge floor)', async () => {
    fakeSummaries = [
      makeSummary({ entryId: 'recent', themes: ['garden'], timestamp: NOW - 1 * ONE_DAY }),
    ]
    fakeEntries['recent'] = { id: 'recent', plainText: richEntryText(), createdAt: NOW - 1 * ONE_DAY }

    const result = await new EchoEngine().findEcho('garden today')
    expect(result).toBeNull()
  })

  it('excludes summaries older than echoMaxAge', async () => {
    globalConfigMock.mockReturnValue({
      features: { echoes: true },
      engagement: { echoChance: 1.0, echoMaxAge: 7, echoMaxPerSession: 3 },
    })
    fakeSummaries = [
      makeSummary({ entryId: 'ancient', themes: ['garden'], timestamp: NOW - 30 * ONE_DAY }),
    ]
    fakeEntries['ancient'] = { id: 'ancient', plainText: richEntryText(), createdAt: NOW - 30 * ONE_DAY }

    const result = await new EchoEngine().findEcho('garden today')
    expect(result).toBeNull()
  })
})

describe('EchoEngine.findEcho — relevance + return shape', () => {
  it('returns null when no qualifying summary shares any words with current text', async () => {
    fakeSummaries = [
      makeSummary({ entryId: 'e1', themes: ['mountain'], keyMoments: ['hiking'] }),
    ]
    fakeEntries['e1'] = { id: 'e1', plainText: richEntryText(), createdAt: NOW - 30 * ONE_DAY }
    const result = await new EchoEngine().findEcho('completely different topic')
    expect(result).toBeNull()
  })

  it('selects the summary with the highest word overlap', async () => {
    fakeSummaries = [
      makeSummary({
        entryId: 'weak',
        themes: ['garden'],
        keyMoments: [],
        timestamp: NOW - 30 * ONE_DAY,
      }),
      makeSummary({
        id: 's2',
        entryId: 'strong',
        themes: ['garden roses blooming'],
        keyMoments: ['flowers walking'],
        timestamp: NOW - 30 * ONE_DAY,
      }),
    ]
    fakeEntries['weak'] = { id: 'weak', plainText: richEntryText(), createdAt: NOW - 30 * ONE_DAY }
    fakeEntries['strong'] = { id: 'strong', plainText: richEntryText(), createdAt: NOW - 30 * ONE_DAY }

    const result = await new EchoEngine().findEcho('I walked through the garden and saw roses blooming on the flowers')
    expect(result?.entryId).toBe('strong')
  })

  it('returns the expected shape: {text, entryId, date}', async () => {
    fakeSummaries = [
      makeSummary({ entryId: 'e1', themes: ['garden roses'], timestamp: NOW - 30 * ONE_DAY }),
    ]
    fakeEntries['e1'] = { id: 'e1', plainText: richEntryText(), createdAt: NOW - 30 * ONE_DAY }
    const result = await new EchoEngine().findEcho('garden roses today')
    expect(result).toMatchObject({
      entryId: 'e1',
      date: NOW - 30 * ONE_DAY,
    })
    expect(typeof result?.text).toBe('string')
    expect(result!.text.length).toBeGreaterThanOrEqual(20)
    expect(result!.text.length).toBeLessThanOrEqual(300)
  })

  it('returns null when the matched entry has no plainText', async () => {
    fakeSummaries = [makeSummary({ entryId: 'e1', themes: ['garden'] })]
    fakeEntries['e1'] = { id: 'e1', plainText: '', createdAt: NOW - 30 * ONE_DAY }
    const result = await new EchoEngine().findEcho('garden today')
    expect(result).toBeNull()
  })

  it('returns null when the matched entry is missing entirely from the db', async () => {
    fakeSummaries = [makeSummary({ entryId: 'ghost', themes: ['garden'] })]
    // No fakeEntries['ghost'] populated
    const result = await new EchoEngine().findEcho('garden today')
    expect(result).toBeNull()
  })

  it('returns null when the extracted fragment is too short (< 20 chars)', async () => {
    fakeSummaries = [makeSummary({ entryId: 'short', themes: ['garden'] })]
    fakeEntries['short'] = { id: 'short', plainText: 'Hi. Yo.', createdAt: NOW - 30 * ONE_DAY }
    const result = await new EchoEngine().findEcho('garden today')
    expect(result).toBeNull()
  })

  it('returns null when extractFragment cannot find sentence-ended sentences', async () => {
    fakeSummaries = [makeSummary({ entryId: 'unpunct', themes: ['garden'] })]
    fakeEntries['unpunct'] = {
      id: 'unpunct',
      plainText: 'no sentence-ending punctuation here at all',
      createdAt: NOW - 30 * ONE_DAY,
    }
    const result = await new EchoEngine().findEcho('garden today')
    expect(result).toBeNull()
  })
})

describe('EchoEngine.findEcho — error path', () => {
  it('returns null when the db query throws', async () => {
    const dbModule = await import('../store/db')
    type OrderByReturn = ReturnType<typeof dbModule.db.entrySummaries.orderBy>
    const spy = vi.spyOn(dbModule.db.entrySummaries, 'orderBy').mockReturnValue({
      reverse: () => ({ toArray: async () => { throw new Error('db down') } }),
    } as unknown as OrderByReturn)

    const result = await new EchoEngine().findEcho('anything')
    expect(result).toBeNull()
    spy.mockRestore()
  })
})

describe('EchoEngine.reset', () => {
  it('resets the per-session counter so subsequent echoes can fire after the cap', async () => {
    globalConfigMock.mockReturnValue({
      features: { echoes: true },
      engagement: { echoChance: 1.0, echoMaxAge: 90, echoMaxPerSession: 1 },
    })
    fakeSummaries = [makeSummary({ entryId: 'e1', themes: ['garden'] })]
    fakeEntries['e1'] = { id: 'e1', plainText: richEntryText(), createdAt: NOW - 30 * ONE_DAY }

    const engine = new EchoEngine()
    expect(await engine.findEcho('garden today')).not.toBeNull()
    expect(await engine.findEcho('garden today')).toBeNull() // hit the cap
    engine.reset()
    expect(await engine.findEcho('garden today')).not.toBeNull() // cap reset
  })
})
