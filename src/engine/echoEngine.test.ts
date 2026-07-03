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
          limit: () => ({
            toArray: async () => [...fakeSummaries].sort((a, b) => b.timestamp - a.timestamp),
          }),
        }),
      }),
    },
  },
}))

const { EchoEngine } = await import('./echoEngine')

const NOW = Date.parse('2026-05-12T12:00:00Z')
const ONE_DAY = 24 * 60 * 60 * 1000

// A keyMoment long enough to pass the 20–300 char fragment bounds and carrying
// the overlap words the relevance scorer keys on.
const GARDEN_MOMENT = 'I walked through the garden and the roses were blooming in the soft afternoon light.'

function makeSummary(over: Partial<EntrySummary> = {}): EntrySummary {
  return {
    id: 's',
    entryId: 'e',
    themes: ['theme-a'],
    emotionalArc: 'arc',
    keyMoments: [GARDEN_MOMENT],
    timestamp: NOW - 30 * ONE_DAY,
    ...over,
  } as EntrySummary
}

beforeEach(() => {
  vi.useFakeTimers().setSystemTime(NOW)
  globalConfigMock.mockReset()
  globalConfigMock.mockReturnValue({
    features: { echoes: true },
    engagement: { echoChance: 1.0, echoMaxAge: 90, echoMaxPerSession: 3 },
  })
  fakeSummaries = []
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
    fakeSummaries = [makeSummary({ entryId: 'e1', themes: ['garden'] })]

    const engine = new EchoEngine()
    const first = await engine.findEcho('the garden bloomed today')
    expect(first).not.toBeNull()
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
    const result = await new EchoEngine().findEcho('garden today')
    expect(result).toBeNull()
  })
})

describe('EchoEngine.findEcho — relevance + return shape', () => {
  it('returns null when no qualifying summary shares any words with current text', async () => {
    fakeSummaries = [
      makeSummary({ entryId: 'e1', themes: ['mountain'], keyMoments: ['a long hike up the ridge in the cold morning air'] }),
    ]
    const result = await new EchoEngine().findEcho('completely different topic')
    expect(result).toBeNull()
  })

  it('selects the summary with the highest word overlap', async () => {
    fakeSummaries = [
      makeSummary({
        entryId: 'weak',
        themes: ['weather'],
        keyMoments: ['it was a grey and ordinary sort of afternoon nothing special'],
        timestamp: NOW - 30 * ONE_DAY,
      }),
      makeSummary({
        id: 's2',
        entryId: 'strong',
        themes: ['garden roses blooming'],
        keyMoments: [GARDEN_MOMENT],
        timestamp: NOW - 30 * ONE_DAY,
      }),
    ]

    const result = await new EchoEngine().findEcho('I walked through the garden and saw roses blooming on the flowers')
    expect(result?.entryId).toBe('strong')
    expect(result?.text).toBe(GARDEN_MOMENT)
  })

  it('returns the expected shape: {text, entryId, date}', async () => {
    fakeSummaries = [
      makeSummary({ entryId: 'e1', themes: ['garden roses'], timestamp: NOW - 30 * ONE_DAY }),
    ]
    const result = await new EchoEngine().findEcho('garden roses today')
    expect(result).toMatchObject({
      entryId: 'e1',
      date: NOW - 30 * ONE_DAY,
    })
    expect(typeof result?.text).toBe('string')
    expect(result!.text.length).toBeGreaterThanOrEqual(20)
    expect(result!.text.length).toBeLessThanOrEqual(300)
  })

  it('picks the longest keyMoment within bounds when several qualify', async () => {
    const shortMoment = 'the garden was quiet and still' // 30 chars, in-bounds
    fakeSummaries = [
      makeSummary({ entryId: 'e1', themes: ['garden'], keyMoments: [shortMoment, GARDEN_MOMENT] }),
    ]
    const result = await new EchoEngine().findEcho('garden today')
    expect(result?.text).toBe(GARDEN_MOMENT)
  })

  it('returns null when the matched summary has no in-bounds keyMoment (all too short)', async () => {
    fakeSummaries = [makeSummary({ entryId: 'e1', themes: ['garden'], keyMoments: ['tiny', 'brief'] })]
    const result = await new EchoEngine().findEcho('garden today')
    expect(result).toBeNull()
  })

  it('returns null when the matched summary has an empty keyMoments array', async () => {
    fakeSummaries = [makeSummary({ entryId: 'e1', themes: ['garden'], keyMoments: [] })]
    const result = await new EchoEngine().findEcho('garden today')
    expect(result).toBeNull()
  })
})

describe('EchoEngine.findEcho — error path', () => {
  it('returns null when the db query throws', async () => {
    const dbModule = await import('../store/db')
    type OrderByReturn = ReturnType<typeof dbModule.db.entrySummaries.orderBy>
    const spy = vi.spyOn(dbModule.db.entrySummaries, 'orderBy').mockReturnValue({
      reverse: () => ({ limit: () => ({ toArray: async () => { throw new Error('db down') } }) }),
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

    const engine = new EchoEngine()
    expect(await engine.findEcho('garden today')).not.toBeNull()
    expect(await engine.findEcho('garden today')).toBeNull() // hit the cap
    engine.reset()
    expect(await engine.findEcho('garden today')).not.toBeNull() // cap reset
  })
})
