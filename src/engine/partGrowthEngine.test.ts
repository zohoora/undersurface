import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Part, PartMemory, UserProfile } from '../types'

const chatCompletionMock = vi.fn()
vi.mock('../ai/openrouter', () => ({
  chatCompletion: (...a: unknown[]) => chatCompletionMock(...a),
}))

vi.mock('../ai/partPrompts', () => ({
  buildGrowthPrompt: () => [{ role: 'system', content: 'stub' }],
}))

const dbPartsUpdate = vi.fn()
let memoriesByPart: Record<string, PartMemory[]> = {}

vi.mock('../store/db', () => ({
  db: {
    memories: {
      where: () => ({
        equals: (partId: string) => ({
          toArray: async () => memoriesByPart[partId] ?? [],
        }),
      }),
    },
    parts: {
      update: (...a: unknown[]) => dbPartsUpdate(...a),
    },
  },
}))

const globalConfigMock = vi.fn(() => null as Record<string, unknown> | null)
vi.mock('../store/globalConfig', () => ({
  getGlobalConfig: () => globalConfigMock(),
}))

const { PartGrowthEngine } = await import('./partGrowthEngine')

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

function makeMemory(partId: string, type: PartMemory['type'], content: string, timestamp = Date.now()): PartMemory {
  return {
    id: `${partId}-${timestamp}`,
    partId,
    entryId: 'e',
    content,
    type,
    timestamp,
  } as PartMemory
}

beforeEach(() => {
  chatCompletionMock.mockReset()
  dbPartsUpdate.mockReset()
  globalConfigMock.mockReset()
  globalConfigMock.mockReturnValue(null)
  memoriesByPart = {}
})

describe('PartGrowthEngine.growParts — gating', () => {
  it('does nothing when no part has accumulated >= 2 reflection/pattern memories', async () => {
    memoriesByPart['p1'] = [makeMemory('p1', 'reflection', 'just one')]
    const engine = new PartGrowthEngine()

    await engine.growParts([makePart({ id: 'p1' })], null)

    expect(chatCompletionMock).not.toHaveBeenCalled()
    expect(dbPartsUpdate).not.toHaveBeenCalled()
  })

  it('does nothing when memories exist but are the wrong type', async () => {
    // 'fact' type is excluded — only 'reflection' and 'pattern' count toward
    // the growth threshold.
    memoriesByPart['p1'] = [
      makeMemory('p1', 'fact', 'a'),
      makeMemory('p1', 'fact', 'b'),
      makeMemory('p1', 'fact', 'c'),
    ]
    const engine = new PartGrowthEngine()

    await engine.growParts([makePart({ id: 'p1' })], null)

    expect(chatCompletionMock).not.toHaveBeenCalled()
  })

  it('proceeds when at least one part has >=2 reflection/pattern memories', async () => {
    memoriesByPart['p1'] = [
      makeMemory('p1', 'reflection', 'a'),
      makeMemory('p1', 'pattern', 'b'),
    ]
    chatCompletionMock.mockResolvedValue('{"partGrowth":{}}')
    const engine = new PartGrowthEngine()

    await engine.growParts([makePart({ id: 'p1' })], null)

    expect(chatCompletionMock).toHaveBeenCalledOnce()
  })
})

describe('PartGrowthEngine.growParts — response parsing', () => {
  it('extracts JSON from a fenced code block', async () => {
    memoriesByPart['p1'] = [
      makeMemory('p1', 'reflection', 'a'),
      makeMemory('p1', 'reflection', 'b'),
    ]
    chatCompletionMock.mockResolvedValue('```json\n{"partGrowth":{"p1":{"keywords":["calm"]}}}\n```')
    const engine = new PartGrowthEngine()

    await engine.growParts([makePart({ id: 'p1' })], null)

    expect(dbPartsUpdate).toHaveBeenCalledOnce()
    const [partId, updates] = dbPartsUpdate.mock.calls[0]
    expect(partId).toBe('p1')
    expect((updates as { learnedKeywords: string[] }).learnedKeywords).toEqual(['calm'])
  })

  it('returns silently on unparseable response (no updates, no throw)', async () => {
    memoriesByPart['p1'] = [
      makeMemory('p1', 'reflection', 'a'),
      makeMemory('p1', 'reflection', 'b'),
    ]
    chatCompletionMock.mockResolvedValue('garbage that is not json')
    const engine = new PartGrowthEngine()

    await expect(engine.growParts([makePart({ id: 'p1' })], null)).resolves.toBeUndefined()
    expect(dbPartsUpdate).not.toHaveBeenCalled()
  })

  it('handles raw (unfenced) JSON', async () => {
    memoriesByPart['p1'] = [
      makeMemory('p1', 'reflection', 'a'),
      makeMemory('p1', 'reflection', 'b'),
    ]
    chatCompletionMock.mockResolvedValue('{"partGrowth":{"p1":{"keywords":["raw"]}}}')
    const engine = new PartGrowthEngine()

    await engine.growParts([makePart({ id: 'p1' })], null)
    expect(dbPartsUpdate).toHaveBeenCalled()
  })
})

describe('PartGrowthEngine.growParts — update shape', () => {
  beforeEach(() => {
    memoriesByPart['p1'] = [
      makeMemory('p1', 'reflection', 'a'),
      makeMemory('p1', 'reflection', 'b'),
    ]
  })

  it('increments growthVersion and stamps lastGrowthAt', async () => {
    chatCompletionMock.mockResolvedValue('{"partGrowth":{"p1":{"keywords":["x"]}}}')
    const before = Date.now()
    const engine = new PartGrowthEngine()

    await engine.growParts([makePart({ id: 'p1', growthVersion: 3 })], null)
    const after = Date.now()

    const [, updates] = dbPartsUpdate.mock.calls[0]
    const u = updates as { growthVersion: number; lastGrowthAt: number }
    expect(u.growthVersion).toBe(4)
    expect(u.lastGrowthAt).toBeGreaterThanOrEqual(before)
    expect(u.lastGrowthAt).toBeLessThanOrEqual(after)
  })

  it('merges learnedKeywords with existing and deduplicates', async () => {
    chatCompletionMock.mockResolvedValue('{"partGrowth":{"p1":{"keywords":["new","kept"]}}}')
    const engine = new PartGrowthEngine()

    await engine.growParts(
      [makePart({ id: 'p1', learnedKeywords: ['existing', 'kept'] })],
      null,
    )
    const [, updates] = dbPartsUpdate.mock.calls[0]
    const u = updates as { learnedKeywords: string[] }
    expect(u.learnedKeywords).toEqual(['existing', 'kept', 'new'])
  })

  it('filters non-string keywords out of the model response', async () => {
    chatCompletionMock.mockResolvedValue('{"partGrowth":{"p1":{"keywords":["valid", 42, null, "ok"]}}}')
    const engine = new PartGrowthEngine()

    await engine.growParts([makePart({ id: 'p1' })], null)
    const [, updates] = dbPartsUpdate.mock.calls[0]
    expect((updates as { learnedKeywords: string[] }).learnedKeywords).toEqual(['valid', 'ok'])
  })

  it('filters learnedEmotions to the VALID_EMOTIONS allowlist (load-bearing — prompt builder relies on this)', async () => {
    chatCompletionMock.mockResolvedValue('{"partGrowth":{"p1":{"emotions":["sad","unicorn","joyful","RAGE"]}}}')
    const engine = new PartGrowthEngine()

    await engine.growParts([makePart({ id: 'p1' })], null)
    const [, updates] = dbPartsUpdate.mock.calls[0]
    expect((updates as { learnedEmotions: string[] }).learnedEmotions).toEqual(['sad', 'joyful'])
  })

  it('truncates promptAddition to 200 chars ONLY for the Quiet One (sparse-voice invariant)', async () => {
    const longAddition = 'A'.repeat(500)
    chatCompletionMock.mockResolvedValue(
      JSON.stringify({ partGrowth: { quiet: { promptAddition: longAddition } } }),
    )
    const engine = new PartGrowthEngine()
    memoriesByPart['quiet'] = [
      makeMemory('quiet', 'reflection', 'a'),
      makeMemory('quiet', 'reflection', 'b'),
    ]

    await engine.growParts([makePart({ id: 'quiet', name: 'The Quiet One' })], null)
    const [, updates] = dbPartsUpdate.mock.calls[0]
    expect((updates as { systemPromptAddition: string }).systemPromptAddition.length).toBe(200)
  })

  it('does NOT truncate promptAddition for other parts', async () => {
    const longAddition = 'B'.repeat(500)
    chatCompletionMock.mockResolvedValue(
      JSON.stringify({ partGrowth: { p1: { promptAddition: longAddition } } }),
    )
    const engine = new PartGrowthEngine()

    await engine.growParts([makePart({ id: 'p1' })], null)
    const [, updates] = dbPartsUpdate.mock.calls[0]
    expect((updates as { systemPromptAddition: string }).systemPromptAddition.length).toBe(500)
  })

  it('caps catchphrases at the configured maxPhrases, newest-first', async () => {
    globalConfigMock.mockReturnValue({ partIntelligence: { catchphraseMaxPerPart: 2 } })
    chatCompletionMock.mockResolvedValue(
      JSON.stringify({ partGrowth: { p1: { catchphrases: ['new1', 'new2', 'new3'] } } }),
    )
    const engine = new PartGrowthEngine()

    await engine.growParts(
      [makePart({ id: 'p1', catchphrases: ['old'] })],
      null,
    )
    const [, updates] = dbPartsUpdate.mock.calls[0]
    expect((updates as { catchphrases: string[] }).catchphrases).toEqual(['new1', 'new2'])
  })

  it('defaults catchphrase cap to 3 when globalConfig is unset', async () => {
    chatCompletionMock.mockResolvedValue(
      JSON.stringify({ partGrowth: { p1: { catchphrases: ['a', 'b', 'c', 'd'] } } }),
    )
    const engine = new PartGrowthEngine()

    await engine.growParts([makePart({ id: 'p1' })], null)
    const [, updates] = dbPartsUpdate.mock.calls[0]
    expect((updates as { catchphrases: string[] }).catchphrases).toHaveLength(3)
  })

  it('drops promptAddition entirely when it is empty/whitespace', async () => {
    chatCompletionMock.mockResolvedValue(
      JSON.stringify({ partGrowth: { p1: { promptAddition: '   ', keywords: ['k'] } } }),
    )
    const engine = new PartGrowthEngine()

    await engine.growParts([makePart({ id: 'p1' })], null)
    const [, updates] = dbPartsUpdate.mock.calls[0]
    expect(updates).not.toHaveProperty('systemPromptAddition')
    expect((updates as { learnedKeywords: string[] }).learnedKeywords).toEqual(['k'])
  })

  it('skips unknown part ids in the response', async () => {
    chatCompletionMock.mockResolvedValue(
      JSON.stringify({ partGrowth: { ghost: { keywords: ['x'] }, p1: { keywords: ['y'] } } }),
    )
    const engine = new PartGrowthEngine()

    await engine.growParts([makePart({ id: 'p1' })], null)
    expect(dbPartsUpdate).toHaveBeenCalledOnce()
    expect(dbPartsUpdate.mock.calls[0][0]).toBe('p1')
  })
})

describe('PartGrowthEngine.growParts — UserProfile passthrough', () => {
  it('passes profile to buildGrowthPrompt (smoke test: doesn\'t throw on a populated profile)', async () => {
    memoriesByPart['p1'] = [
      makeMemory('p1', 'reflection', 'a'),
      makeMemory('p1', 'reflection', 'b'),
    ]
    chatCompletionMock.mockResolvedValue('{"partGrowth":{}}')
    const engine = new PartGrowthEngine()

    const profile: UserProfile = {
      id: 'u',
      innerLandscape: 'busy',
      recurringThemes: ['work'],
      emotionalPatterns: ['anxious'],
      relationshipMap: '',
      avoidancePatterns: [],
      lastUpdated: 0,
    } as UserProfile

    await expect(engine.growParts([makePart({ id: 'p1' })], profile)).resolves.toBeUndefined()
    expect(chatCompletionMock).toHaveBeenCalledOnce()
  })
})
