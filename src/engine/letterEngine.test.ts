import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Part, PartLetter, PartMemory, EntrySummary, UserProfile } from '../types'

const globalConfigMock = vi.fn(() => null as Record<string, unknown> | null)
vi.mock('../store/globalConfig', () => ({
  getGlobalConfig: () => globalConfigMock(),
}))

const chatCompletionMock = vi.fn()
vi.mock('../ai/openrouter', () => ({
  chatCompletion: (...a: unknown[]) => chatCompletionMock(...a),
}))

vi.mock('../ai/partPrompts', () => ({
  SHARED_INSTRUCTIONS: 'STUB_SHARED',
  languageDirective: () => '',
}))

vi.mock('../ai/promptSafety', () => ({
  sanitizeForPrompt: (s: string) => s,
  UNTRUSTED_CONTENT_PREAMBLE: '',
}))

vi.mock('../i18n', () => ({
  getPartDisplayName: (p: Part) => p.name,
}))

let memoriesByPart: Record<string, PartMemory[]> = {}
let fakeSummaries: EntrySummary[] = []
let fakeProfile: UserProfile | null = null
let fakeLettersCount = 0
const dbLettersAdd = vi.fn()

vi.mock('../store/db', () => ({
  db: {
    memories: {
      where: () => ({
        equals: (partId: string) => ({
          toArray: async () => memoriesByPart[partId] ?? [],
        }),
      }),
    },
    entrySummaries: {
      orderBy: () => ({
        reverse: () => ({
          toArray: async () => [...fakeSummaries].sort((a, b) => b.timestamp - a.timestamp),
        }),
      }),
    },
    userProfile: { get: async () => fakeProfile ?? undefined },
    letters: {
      add: (...a: unknown[]) => dbLettersAdd(...a),
      count: async () => fakeLettersCount,
    },
  },
  generateId: () => 'letter-id',
}))

const { LetterEngine } = await import('./letterEngine')

function makePart(over: Partial<Part>): Part {
  return {
    id: 'p1',
    name: 'Watcher',
    color: '#abc',
    colorLight: '#abc25',
    ifsRole: 'protector',
    voiceDescription: 'quiet',
    concern: 'a',
    systemPrompt: 'be',
    isSeeded: true,
    createdAt: 0,
    ...over,
  } as Part
}

function makeSummary(over: Partial<EntrySummary> = {}): EntrySummary {
  return {
    id: 's',
    entryId: 'e',
    themes: ['t'],
    emotionalArc: 'arc',
    keyMoments: ['moment'],
    timestamp: 1,
    ...over,
  } as EntrySummary
}

beforeEach(() => {
  globalConfigMock.mockReset()
  globalConfigMock.mockReturnValue({
    features: { lettersFromParts: true },
    engagement: { letterTriggerEntries: 10, letterMinParts: 2 },
  })
  chatCompletionMock.mockReset()
  chatCompletionMock.mockResolvedValue('Dear writer,\n\nWe see you...\n\n— Watcher & Tender')
  memoriesByPart = {}
  fakeSummaries = []
  fakeProfile = null
  fakeLettersCount = 0
  dbLettersAdd.mockReset()
})

describe('LetterEngine.checkForLetter — gating', () => {
  it('returns null when the feature flag is off', async () => {
    globalConfigMock.mockReturnValue({ features: { lettersFromParts: false } })
    const result = await new LetterEngine().checkForLetter(10, [makePart({ id: 'p1' }), makePart({ id: 'p2' })])
    expect(result).toBeNull()
    expect(chatCompletionMock).not.toHaveBeenCalled()
  })

  it('returns null when the session count has not reached the trigger threshold', async () => {
    const result = await new LetterEngine().checkForLetter(7, [makePart({ id: 'p1' }), makePart({ id: 'p2' })])
    expect(result).toBeNull()
  })

  it('returns null at session count 0 — regression: the frozen entries counter made 0 % 10 === 0 fire a letter after every close', async () => {
    memoriesByPart['p1'] = [{ id: 'm', partId: 'p1', entryId: 'e', content: 'x', type: 'reflection', timestamp: 1 } as PartMemory]
    memoriesByPart['p2'] = [{ id: 'm', partId: 'p2', entryId: 'e', content: 'x', type: 'reflection', timestamp: 1 } as PartMemory]
    fakeSummaries = [makeSummary()]
    const result = await new LetterEngine().checkForLetter(0, [makePart({ id: 'p1' }), makePart({ id: 'p2' })])
    expect(result).toBeNull()
    expect(chatCompletionMock).not.toHaveBeenCalled()
  })

  it('returns null when the earned quota is already satisfied (count 10, 1 letter exists)', async () => {
    memoriesByPart['p1'] = [{ id: 'm' } as PartMemory]
    memoriesByPart['p2'] = [{ id: 'm' } as PartMemory]
    fakeSummaries = [makeSummary()]
    fakeLettersCount = 1
    const result = await new LetterEngine().checkForLetter(10, [makePart({ id: 'p1' }), makePart({ id: 'p2' })])
    expect(result).toBeNull()
  })

  it('self-heals: fires when a multiple was crossed between checks (count 31, 2 letters → 3 earned)', async () => {
    memoriesByPart['p1'] = [{ id: 'm' } as PartMemory]
    memoriesByPart['p2'] = [{ id: 'm' } as PartMemory]
    fakeSummaries = [makeSummary()]
    fakeLettersCount = 2
    const result = await new LetterEngine().checkForLetter(31, [makePart({ id: 'p1' }), makePart({ id: 'p2' })])
    expect(result).not.toBeNull()
  })

  it('proceeds when entryCount is a multiple of the trigger', async () => {
    memoriesByPart['p1'] = [{ id: 'm', partId: 'p1', entryId: 'e', content: 'x', type: 'reflection', timestamp: 1 } as PartMemory]
    memoriesByPart['p2'] = [{ id: 'm', partId: 'p2', entryId: 'e', content: 'x', type: 'reflection', timestamp: 1 } as PartMemory]
    fakeSummaries = [makeSummary()]
    const result = await new LetterEngine().checkForLetter(20, [makePart({ id: 'p1' }), makePart({ id: 'p2' })])
    expect(result).not.toBeNull()
  })

  it('returns null when fewer parts are available than letterMinParts', async () => {
    const result = await new LetterEngine().checkForLetter(10, [makePart({ id: 'p1' })])
    expect(result).toBeNull()
    expect(chatCompletionMock).not.toHaveBeenCalled()
  })

  it('returns null when no recent summaries exist (no material to write from)', async () => {
    fakeSummaries = []
    memoriesByPart['p1'] = [{ id: 'm', partId: 'p1', entryId: 'e', content: 'x', type: 'reflection', timestamp: 1 } as PartMemory]
    memoriesByPart['p2'] = [{ id: 'm', partId: 'p2', entryId: 'e', content: 'x', type: 'reflection', timestamp: 1 } as PartMemory]
    const result = await new LetterEngine().checkForLetter(10, [makePart({ id: 'p1' }), makePart({ id: 'p2' })])
    expect(result).toBeNull()
  })
})

describe('LetterEngine.checkForLetter — part selection', () => {
  it('selects the top N parts by memory count, where N = letterMinParts', async () => {
    memoriesByPart['high'] = Array.from({ length: 10 }, (_, i) => ({ id: `m${i}` } as PartMemory))
    memoriesByPart['mid'] = Array.from({ length: 5 }, (_, i) => ({ id: `m${i}` } as PartMemory))
    memoriesByPart['low'] = [{ id: 'm0' } as PartMemory]
    fakeSummaries = [makeSummary()]

    const result = await new LetterEngine().checkForLetter(10, [
      makePart({ id: 'low' }),
      makePart({ id: 'high' }),
      makePart({ id: 'mid' }),
    ])

    expect(result?.partIds).toEqual(['high', 'mid'])
  })

  it('honors a customized letterMinParts from globalConfig', async () => {
    globalConfigMock.mockReturnValue({
      features: { lettersFromParts: true },
      engagement: { letterTriggerEntries: 10, letterMinParts: 3 },
    })
    memoriesByPart['a'] = [{ id: 'a' } as PartMemory]
    memoriesByPart['b'] = [{ id: 'b' } as PartMemory]
    memoriesByPart['c'] = [{ id: 'c' } as PartMemory]
    fakeSummaries = [makeSummary()]

    const result = await new LetterEngine().checkForLetter(10, [
      makePart({ id: 'a' }),
      makePart({ id: 'b' }),
      makePart({ id: 'c' }),
    ])

    expect(result?.partIds).toHaveLength(3)
  })
})

describe('LetterEngine.checkForLetter — output shape', () => {
  beforeEach(() => {
    memoriesByPart['p1'] = [{ id: 'm1' } as PartMemory]
    memoriesByPart['p2'] = [{ id: 'm2' } as PartMemory]
    fakeSummaries = [makeSummary({ themes: ['grief'], emotionalArc: 'tender' })]
  })

  it('saves the letter to the db.letters collection with the right shape', async () => {
    const result = await new LetterEngine().checkForLetter(10, [makePart({ id: 'p1' }), makePart({ id: 'p2' })])

    expect(dbLettersAdd).toHaveBeenCalledOnce()
    const [persisted] = dbLettersAdd.mock.calls[0]
    expect(persisted).toEqual(result)
    expect((result as PartLetter).triggerType).toBe('milestone')
    expect((result as PartLetter).isRead).toBe(false)
    expect((result as PartLetter).partIds).toEqual(['p1', 'p2'])
  })

  it('uses the chatCompletion response as the letter content', async () => {
    chatCompletionMock.mockResolvedValue('CUSTOM_LETTER_BODY')
    const result = await new LetterEngine().checkForLetter(10, [makePart({ id: 'p1' }), makePart({ id: 'p2' })])
    expect(result?.content).toBe('CUSTOM_LETTER_BODY')
  })

  it('includes both parts\' display names in the system prompt', async () => {
    await new LetterEngine().checkForLetter(10, [
      makePart({ id: 'p1', name: 'Watcher', ifsRole: 'protector' }),
      makePart({ id: 'p2', name: 'Tender One', ifsRole: 'exile' }),
    ])
    const [messages] = chatCompletionMock.mock.calls[0]
    const sys = (messages as Array<{ role: string; content: string }>).find(m => m.role === 'system')!
    expect(sys.content).toContain('Watcher (protector)')
    expect(sys.content).toContain('Tender One (exile)')
  })

  it('threads profile data into the user message when a profile exists', async () => {
    fakeProfile = {
      id: 'current',
      innerLandscape: 'tangled forest',
      recurringThemes: ['work stress'],
      emotionalPatterns: [],
      growthSignals: ['noticing'],
      lastUpdated: 0,
    } as UserProfile

    await new LetterEngine().checkForLetter(10, [makePart({ id: 'p1' }), makePart({ id: 'p2' })])
    const [messages] = chatCompletionMock.mock.calls[0]
    const user = (messages as Array<{ role: string; content: string }>).find(m => m.role === 'user')!
    expect(user.content).toContain('tangled forest')
    expect(user.content).toContain('work stress')
    expect(user.content).toContain('noticing')
  })
})

describe('LetterEngine.checkForLetter — error path', () => {
  it('returns null and does not throw when chatCompletion fails', async () => {
    memoriesByPart['p1'] = [{ id: 'm' } as PartMemory]
    memoriesByPart['p2'] = [{ id: 'm' } as PartMemory]
    fakeSummaries = [makeSummary()]
    chatCompletionMock.mockRejectedValue(new Error('LLM down'))

    const result = await new LetterEngine().checkForLetter(10, [makePart({ id: 'p1' }), makePart({ id: 'p2' })])
    expect(result).toBeNull()
    expect(dbLettersAdd).not.toHaveBeenCalled()
  })
})
