import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Part, Session, SessionMessage } from '../types'

vi.mock('../ai/openrouter', () => ({
  chatCompletion: vi.fn(),
}))
vi.mock('../ai/therapistPrompts', () => ({
  buildSessionReflectionPrompt: vi.fn().mockReturnValue([
    { role: 'system', content: 'test' },
    { role: 'user', content: 'test' },
  ]),
  buildBoundedTranscript: vi.fn((messages: SessionMessage[]) =>
    messages.map(m => `${m.speaker}: ${m.content}`).join('\n'),
  ),
  buildStanceConsolidationPrompt: vi.fn().mockReturnValue([
    { role: 'system', content: 'consolidate' },
    { role: 'user', content: 'observations' },
  ]),
}))
vi.mock('../store/db', () => ({
  db: {
    userProfile: { get: vi.fn(async () => undefined), add: vi.fn(), update: vi.fn() },
    personalFacts: { get: vi.fn(async () => undefined), add: vi.fn(), update: vi.fn() },
    entrySummaries: {
      add: vi.fn(),
      count: vi.fn(async () => 1),
      orderBy: vi.fn(() => ({ reverse: vi.fn(() => ({ toArray: vi.fn(async () => []) })) })),
    },
    memories: { add: vi.fn(), where: vi.fn(() => ({ equals: vi.fn(() => ({ toArray: vi.fn(async () => []) })) })), delete: vi.fn() },
    entries: { count: vi.fn(async () => 5) },
    parts: { toArray: vi.fn(async () => []) },
    companionSignals: { get: vi.fn(async () => undefined), add: vi.fn(), update: vi.fn() },
    userParts: { toArray: vi.fn(async () => []), add: vi.fn(), update: vi.fn() },
    sessionIntentions: { toArray: vi.fn(async () => []), add: vi.fn(), update: vi.fn() },
    stanceProfile: { get: vi.fn(async () => undefined), add: vi.fn(), update: vi.fn() },
    sessions: {
      get: vi.fn(async (id: string) => ({ id, memoryAperture: 'pattern' } as Session)),
      update: vi.fn(),
    },
    companionPreferences: { get: vi.fn(async () => ({ id: 'current', fieldMosaicEnabled: true })) },
    fieldMoments: { add: vi.fn() },
  },
  generateId: vi.fn(() => 'gen-id'),
}))
vi.mock('../store/globalConfig', () => ({
  getGlobalConfig: vi.fn(() => ({ features: { ruptureRepair: true, ruminationPivot: true, userParts: true } })),
}))
vi.mock('./letterEngine', () => ({
  LetterEngine: class { checkForLetter = vi.fn(async () => null) },
}))

import { reflectOnSession, updateCompanionSignals, updateUserPartsAndLexicon, updateSessionIntentions, updateStance } from './sessionReflectionEngine'
import { chatCompletion } from '../ai/openrouter'
import { db } from '../store/db'
import { getGlobalConfig } from '../store/globalConfig'

const mockChatCompletion = vi.mocked(chatCompletion)

function makeMessage(overrides: Partial<SessionMessage> = {}): SessionMessage {
  return {
    id: 'msg',
    speaker: 'user',
    partId: null,
    partName: null,
    content: 'test',
    timestamp: Date.now(),
    phase: 'opening',
    isEmergence: false,
    ...overrides,
  }
}

function makePart(overrides: Partial<Part> = {}): Part {
  return {
    id: 'open',
    name: 'The Open',
    color: '#B08E60',
    colorLight: '#B08E6025',
    ifsRole: 'self',
    voiceDescription: 'Warm.',
    concern: 'Joy.',
    systemPrompt: 'test',
    isSeeded: true,
    createdAt: Date.now(),
    memories: [],
    ...overrides,
  }
}

describe('reflectOnSession', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does not derive or write memory from a Fresh eyes session', async () => {
    vi.mocked(db.sessions.get).mockResolvedValueOnce({ memoryAperture: 'fresh' } as Session)
    await reflectOnSession('fresh-session', [
      makeMessage({ content: 'I am writing enough detail for the reflection threshold to be crossed without ambiguity.' }),
      makeMessage({ id: 'msg-2', content: 'This second sentence makes the synthetic transcript comfortably longer than one hundred characters.' }),
    ], [makePart()])
    expect(mockChatCompletion).not.toHaveBeenCalled()
    expect(db.entrySummaries.add).not.toHaveBeenCalled()
    expect(db.memories.add).not.toHaveBeenCalled()
    expect(db.fieldMoments.add).not.toHaveBeenCalled()
  })

  it('skips short transcripts (< 100 chars)', async () => {
    const messages = [makeMessage({ content: 'Hi' })]
    await reflectOnSession('session-1', messages, [makePart()])
    expect(chatCompletion).not.toHaveBeenCalled()
  })

  it('calls AI with transcript and stores results', async () => {
    const longContent = 'I have been thinking about my childhood and how it shaped me. There is so much to unpack about those early years and the patterns that emerged.'
    const messages: SessionMessage[] = [
      makeMessage({ id: '1', speaker: 'therapist', content: 'What brings you here today?' }),
      makeMessage({ id: '2', speaker: 'user', content: longContent }),
      makeMessage({ id: '3', speaker: 'therapist', content: 'That sounds meaningful. Tell me more.' }),
    ]

    mockChatCompletion.mockResolvedValue(JSON.stringify({
      entrySummary: {
        themes: ['childhood', 'patterns'],
        emotionalArc: 'reflective to insightful',
        keyMoments: ['realization about early years'],
      },
      partMemories: {
        open: 'Writer is exploring childhood patterns with openness',
      },
      profileUpdates: {
        recurringThemes: ['childhood'],
        innerLandscape: 'A landscape of excavated memories',
      },
      ambientAssessment: {
        flow: 'deepening', overallFit: 'landed', agencyTrajectory: 'more',
        ending: 'open', confidence: 'medium', synthesis: 'The writer increasingly authored the direction.',
      },
    }))

    const parts = [makePart({ id: 'open' }), makePart({ id: 'weaver', name: 'The Weaver', ifsRole: 'manager' })]
    await reflectOnSession('session-1', messages, parts)

    expect(chatCompletion).toHaveBeenCalled()
    expect(db.entrySummaries.add).toHaveBeenCalledWith(expect.objectContaining({
      entryId: 'session-1',
      themes: ['childhood', 'patterns'],
    }))
    expect(db.memories.add).toHaveBeenCalledWith(expect.objectContaining({
      partId: 'open',
      content: 'Writer is exploring childhood patterns with openness',
      source: 'session',
      sessionId: 'session-1',
    }))
    expect(db.sessions.update).toHaveBeenCalledWith('session-1', expect.objectContaining({
      ambientAssessment: expect.objectContaining({ flow: 'deepening', overallFit: 'landed' }),
      reflectionStatus: 'complete',
      reflectedAt: expect.any(Number),
    }))
  })

  it('stores only exact writer quotes as field moments', async () => {
    const exact = 'I decided I will ask for the role change on Monday.'
    const messages = [makeMessage({ id: 'writer-1', content: `${exact} This gives us enough transcript length to run the reflection pipeline and validate the extracted moment safely.`, surface: 'talk' })]
    mockChatCompletion.mockResolvedValue(JSON.stringify({
      fieldMoments: [
        { quote: exact, source: 'talk' },
        { quote: 'The writer finally chose courage.', source: 'talk' },
      ],
    }))

    await reflectOnSession('session-1', messages, [makePart()])

    expect(db.fieldMoments.add).toHaveBeenCalledTimes(1)
    expect(db.fieldMoments.add).toHaveBeenCalledWith(expect.objectContaining({
      source: 'talk', sourceId: 'writer-1', text: exact, status: 'unreviewed',
    }))
  })

  it('saves new personalFacts when extracted and none existed', async () => {
    const longContent = 'My wife Sarah and I just adopted a dog named Max. We live in Brooklyn and our anniversary is March 12.'
    const messages: SessionMessage[] = [
      makeMessage({ id: '1', speaker: 'therapist', content: 'Tell me what is going on for you.' }),
      makeMessage({ id: '2', speaker: 'user', content: longContent }),
    ]

    mockChatCompletion.mockResolvedValue(JSON.stringify({
      entrySummary: { themes: ['family'], emotionalArc: 'warm', keyMoments: [] },
      personalFacts: {
        people: [
          { name: 'Sarah', relationship: 'wife' },
          { name: 'Max', relationship: 'dog' },
        ],
        dates: [{ event: 'anniversary', date: '2024-03-12' }],
        context: [{ category: 'location', value: 'Brooklyn' }],
        currentThreads: [],
      },
    }))

    await reflectOnSession('session-1', messages, [makePart()])

    expect(db.personalFacts.add).toHaveBeenCalledWith(expect.objectContaining({
      id: 'current',
      people: [
        { name: 'Sarah', relationship: 'wife' },
        { name: 'Max', relationship: 'dog' },
      ],
      dates: [{ event: 'anniversary', date: '2024-03-12' }],
      context: [{ category: 'location', value: 'Brooklyn' }],
      currentThreads: [],
    }))
    expect(db.personalFacts.update).not.toHaveBeenCalled()
  })

  it('updates personalFacts when one already exists', async () => {
    vi.mocked(db.personalFacts.get).mockResolvedValueOnce({
      id: 'current',
      people: [{ name: 'Sarah', relationship: 'wife' }],
      dates: [],
      context: [],
      currentThreads: [{ topic: 'job interview Thursday', addedAt: 1000 }],
      lastUpdated: 1000,
    })

    const longContent = 'The interview went well. Sarah was supportive. We got my promotion confirmed.'
    const messages: SessionMessage[] = [
      makeMessage({ id: '1', speaker: 'therapist', content: 'How did the interview go?' }),
      makeMessage({ id: '2', speaker: 'user', content: longContent }),
    ]

    mockChatCompletion.mockResolvedValue(JSON.stringify({
      personalFacts: {
        people: [{ name: 'Sarah', relationship: 'wife', notes: 'supportive' }],
        dates: [],
        context: [],
        currentThreads: [], // interview thread dropped — resolved
      },
    }))

    await reflectOnSession('session-1', messages, [makePart()])

    expect(db.personalFacts.update).toHaveBeenCalledWith(
      'current',
      expect.objectContaining({
        people: [{ name: 'Sarah', relationship: 'wife', notes: 'supportive' }],
        currentThreads: [],
      }),
    )
  })

  it('preserves addedAt timestamps on existing currentThreads', async () => {
    vi.mocked(db.personalFacts.get).mockResolvedValueOnce({
      id: 'current',
      people: [],
      dates: [],
      context: [],
      currentThreads: [{ topic: 'mom in hospital', addedAt: 5000 }],
      lastUpdated: 5000,
    })

    const longContent = 'Mom is still in the hospital. We adopted a new dog named Max yesterday and she has been a bright spot.'
    const messages: SessionMessage[] = [
      makeMessage({ id: '1', speaker: 'therapist', content: 'How is your mom doing?' }),
      makeMessage({ id: '2', speaker: 'user', content: longContent }),
    ]

    mockChatCompletion.mockResolvedValue(JSON.stringify({
      personalFacts: {
        people: [{ name: 'Max', relationship: 'dog' }],
        dates: [],
        context: [],
        currentThreads: [{ topic: 'mom in hospital' }], // same topic — addedAt should carry over
      },
    }))

    await reflectOnSession('session-1', messages, [makePart()])

    expect(db.personalFacts.update).toHaveBeenCalledWith(
      'current',
      expect.objectContaining({
        currentThreads: [{ topic: 'mom in hospital', addedAt: 5000 }],
      }),
    )
  })

  it('skips personalFacts write when content is unchanged from existing', async () => {
    vi.mocked(db.personalFacts.get).mockResolvedValueOnce({
      id: 'current',
      people: [{ name: 'Sarah', relationship: 'wife' }],
      dates: [],
      context: [{ category: 'location', value: 'Brooklyn' }],
      currentThreads: [],
      lastUpdated: 1000,
    })

    const longContent = 'Today was uneventful. I worked from home and made tea. Just sat with the quiet for a while.'
    const messages: SessionMessage[] = [
      makeMessage({ id: '1', speaker: 'therapist', content: 'How was today?' }),
      makeMessage({ id: '2', speaker: 'user', content: longContent }),
    ]

    mockChatCompletion.mockResolvedValue(JSON.stringify({
      personalFacts: {
        people: [{ name: 'Sarah', relationship: 'wife' }],
        dates: [],
        context: [{ category: 'location', value: 'Brooklyn' }],
        currentThreads: [],
      },
    }))

    await reflectOnSession('session-1', messages, [makePart()])

    expect(db.personalFacts.add).not.toHaveBeenCalled()
    expect(db.personalFacts.update).not.toHaveBeenCalled()
  })

  it('does not write personalFacts when AI returns empty arrays for everything', async () => {
    const longContent = 'I do not want to talk about specifics today. Just feeling unsettled and want to sit with it.'
    const messages: SessionMessage[] = [
      makeMessage({ id: '1', speaker: 'therapist', content: 'What is here right now?' }),
      makeMessage({ id: '2', speaker: 'user', content: longContent }),
    ]

    mockChatCompletion.mockResolvedValue(JSON.stringify({
      personalFacts: { people: [], dates: [], context: [], currentThreads: [] },
    }))

    await reflectOnSession('session-1', messages, [makePart()])

    expect(db.personalFacts.add).not.toHaveBeenCalled()
    expect(db.personalFacts.update).not.toHaveBeenCalled()
  })

  it('handles malformed AI response gracefully', async () => {
    const messages: SessionMessage[] = [
      makeMessage({ id: '1', speaker: 'therapist', content: 'What brings you here today? I want to understand what is on your mind.' }),
      makeMessage({ id: '2', speaker: 'user', content: 'I am feeling lost and confused about my path in life and where I should go from here.' }),
    ]

    mockChatCompletion.mockResolvedValue('This is not JSON at all.')

    await reflectOnSession('session-1', messages, [makePart()])

    // Should not throw, should not store anything
    expect(db.entrySummaries.add).not.toHaveBeenCalled()
    expect(db.memories.add).not.toHaveBeenCalled()
  })
})

describe('updateCompanionSignals', () => {
  beforeEach(() => {
    vi.mocked(db.companionSignals.get).mockReset().mockResolvedValue(undefined)
    vi.mocked(db.companionSignals.add).mockReset()
    vi.mocked(db.companionSignals.update).mockReset()
    vi.mocked(getGlobalConfig).mockReturnValue(
      { features: { ruptureRepair: true, ruminationPivot: true } } as never,
    )
  })

  // 8+ engaged user messages then a collapsing tail (< 40% of median).
  const terseMessages = [
    ...Array.from({ length: 6 }, (_, i) => makeMessage({ id: `m${i}`, content: 'x'.repeat(100) })),
    makeMessage({ id: 't1', content: 'ok' }),
    makeMessage({ id: 't2', content: 'sure' }),
    makeMessage({ id: 't3', content: 'fine' }),
  ]

  it('writes a terse_ending pendingRepair when the session tail collapses', async () => {
    await updateCompanionSignals('sess-9', terseMessages, undefined)

    expect(db.companionSignals.add).toHaveBeenCalledWith(expect.objectContaining({
      pendingRepair: expect.objectContaining({ evidence: 'terse_ending', sourceSessionId: 'sess-9' }),
    }))
  })

  it('increments the loop streak on present && !newInformation', async () => {
    vi.mocked(db.companionSignals.get).mockResolvedValue({
      id: 'current', pendingRepair: null, updatedAt: 0,
      ruminationWatch: { theme: 'old', streak: 2, lastConfirmedAt: 1 },
    } as never)

    await updateCompanionSignals('sess-9', [makeMessage()], { present: true, theme: 'the job decision', newInformation: false })

    expect(db.companionSignals.update).toHaveBeenCalledWith('current', expect.objectContaining({
      ruminationWatch: expect.objectContaining({ streak: 3, theme: 'the job decision' }),
    }))
  })

  it('clears the watch when the loop breaks (newInformation: true)', async () => {
    vi.mocked(db.companionSignals.get).mockResolvedValue({
      id: 'current', pendingRepair: null, updatedAt: 0,
      ruminationWatch: { theme: 'old', streak: 2, lastConfirmedAt: 1 },
    } as never)

    await updateCompanionSignals('sess-9', [makeMessage()], { present: true, theme: 'old', newInformation: true })

    expect(db.companionSignals.update).toHaveBeenCalledWith('current', expect.objectContaining({
      ruminationWatch: null,
    }))
  })

  it('treats malformed loopSignal as no loop (precision-first) and writes nothing when no watch exists', async () => {
    await updateCompanionSignals('sess-9', [makeMessage()], { present: 'yes', newInformation: 'no' } as never)

    expect(db.companionSignals.add).not.toHaveBeenCalled()
    expect(db.companionSignals.update).not.toHaveBeenCalled()
  })

  it('does nothing when both flags are off', async () => {
    vi.mocked(getGlobalConfig).mockReturnValue({ features: {} } as never)

    await updateCompanionSignals('sess-9', terseMessages, { present: true, theme: 't', newInformation: false })

    expect(db.companionSignals.get).not.toHaveBeenCalled()
    expect(db.companionSignals.add).not.toHaveBeenCalled()
  })

  it('gates each behavior on its own flag', async () => {
    // Only ruminationPivot on: terse ending must NOT be written.
    vi.mocked(getGlobalConfig).mockReturnValue({ features: { ruminationPivot: true } } as never)

    await updateCompanionSignals('sess-9', terseMessages, undefined)

    expect(db.companionSignals.add).not.toHaveBeenCalled()
  })
})

describe('updateUserPartsAndLexicon', () => {
  beforeEach(() => {
    vi.mocked(db.userParts.add).mockReset()
    vi.mocked(db.userParts.update).mockReset()
    vi.mocked(db.personalFacts.get).mockReset().mockResolvedValue(undefined)
    vi.mocked(db.personalFacts.add).mockReset()
    vi.mocked(db.personalFacts.update).mockReset()
  })

  it('persists new candidates and match updates from observations', async () => {
    const existing = [{
      id: 'up1', name: 'the bracer', description: 'braces', stance: 'protective',
      status: 'candidate', evidence: [], sessionsSeen: 1, dismissedCount: 0,
      lastActiveAt: 1, createdAt: 1, updatedAt: 1,
    }] as never

    await updateUserPartsAndLexicon('sess-1', existing, [
      { partId: 'up1', quote: 'I braced again', stance: 'protective — softening' },
      { tentativeName: 'the list-maker', description: 'turns feelings into tasks', stance: 'managerial', quote: 'made another list' },
    ], undefined)

    expect(db.userParts.update).toHaveBeenCalledWith('up1', expect.objectContaining({ sessionsSeen: 2 }))
    expect(db.userParts.add).toHaveBeenCalledWith(expect.objectContaining({ name: 'the list-maker', status: 'candidate' }))
  })

  it('merges coined phrases into personalFacts.lexicon (creates the doc when absent)', async () => {
    await updateUserPartsAndLexicon('sess-1', [], undefined, ['the basement'])

    expect(db.personalFacts.add).toHaveBeenCalledWith(expect.objectContaining({
      id: 'current', lexicon: ['the basement'],
    }))
  })

  it('updates lexicon on an existing facts doc without touching other fields', async () => {
    vi.mocked(db.personalFacts.get).mockResolvedValue({
      id: 'current', people: [], dates: [], context: [], currentThreads: [],
      lexicon: ['gray days'], lastUpdated: 1,
    } as never)

    await updateUserPartsAndLexicon('sess-1', [], undefined, ['the basement'])

    expect(db.personalFacts.update).toHaveBeenCalledWith('current', expect.objectContaining({
      lexicon: ['gray days', 'the basement'],
    }))
  })

  it('writes nothing for malformed observations and phrases', async () => {
    await updateUserPartsAndLexicon('sess-1', [], 'garbage', 42)

    expect(db.userParts.add).not.toHaveBeenCalled()
    expect(db.userParts.update).not.toHaveBeenCalled()
    expect(db.personalFacts.add).not.toHaveBeenCalled()
    expect(db.personalFacts.update).not.toHaveBeenCalled()
  })
})

describe('updateSessionIntentions', () => {
  beforeEach(() => {
    vi.mocked(db.sessionIntentions.add).mockReset()
    vi.mocked(db.sessionIntentions.update).mockReset()
  })

  const openOne = {
    id: 'i1', text: 'call him thursday', sessionId: 's0', status: 'open',
    askedCount: 0, notYetCount: 0, patternNamed: false, createdAt: 1, updatedAt: 1,
  } as never

  it('applies outcomes then creates a volunteered intention', async () => {
    await updateSessionIntentions('s9', [openOne], { present: true, text: 'take the walk before work' }, [
      { id: 'i1', outcome: 'kept', note: 'called, went well' },
    ])

    expect(db.sessionIntentions.update).toHaveBeenCalledWith('i1', expect.objectContaining({ status: 'kept' }))
    expect(db.sessionIntentions.add).toHaveBeenCalledWith(expect.objectContaining({
      text: 'take the walk before work', status: 'open', sessionId: 's9',
    }))
  })

  it('writes nothing for malformed statedIntention and unknown outcome ids', async () => {
    await updateSessionIntentions('s9', [openOne], { present: 'yes', text: 42 } as never, [
      { id: 'ghost', outcome: 'kept' },
    ])
    expect(db.sessionIntentions.add).not.toHaveBeenCalled()
    expect(db.sessionIntentions.update).not.toHaveBeenCalled()
  })
})

describe('updateStance', () => {
  beforeEach(() => {
    vi.mocked(db.stanceProfile.get).mockReset().mockResolvedValue(undefined)
    vi.mocked(db.stanceProfile.add).mockReset()
    vi.mocked(db.stanceProfile.update).mockReset()
    mockChatCompletion.mockReset()
  })

  it('appends a valid observation (creates the profile when absent)', async () => {
    await updateStance('s1', { observation: 'short warm replies landed', direction: 'helped' })

    expect(db.stanceProfile.add).toHaveBeenCalledWith(expect.objectContaining({
      id: 'current',
      rawObservations: [expect.objectContaining({ observation: 'short warm replies landed', direction: 'helped' })],
    }))
    expect(mockChatCompletion).not.toHaveBeenCalled() // 1 obs — no consolidation yet
  })

  it('consolidates every 5th observation into capped entries', async () => {
    vi.mocked(db.stanceProfile.get).mockResolvedValue({
      id: 'current',
      rawObservations: Array.from({ length: 4 }, (_, i) => ({
        observation: `obs ${i}`, direction: 'helped', sessionId: `s${i}`, createdAt: i,
      })),
      entries: [],
      updatedAt: 1,
    } as never)
    mockChatCompletion.mockResolvedValue(JSON.stringify({
      entries: ['challenge lands well once warmed up', 42, '  short replies in the evening  '],
    }))

    await updateStance('s5', { observation: 'obs 5', direction: 'hindered' })

    expect(mockChatCompletion).toHaveBeenCalledTimes(1)
    expect(db.stanceProfile.update).toHaveBeenCalledWith('current', expect.objectContaining({
      entries: ['challenge lands well once warmed up', 'short replies in the evening'],
    }))
  })

  it('a failed consolidation keeps previous entries and still appends the observation', async () => {
    vi.mocked(db.stanceProfile.get).mockResolvedValue({
      id: 'current',
      rawObservations: Array.from({ length: 4 }, (_, i) => ({
        observation: `obs ${i}`, direction: 'helped', sessionId: `s${i}`, createdAt: i,
      })),
      entries: ['existing tendency'],
      updatedAt: 1,
    } as never)
    mockChatCompletion.mockRejectedValue(new Error('boom'))

    await updateStance('s5', { observation: 'obs 5', direction: 'helped' })

    expect(db.stanceProfile.update).toHaveBeenCalledWith('current', expect.objectContaining({
      entries: ['existing tendency'],
    }))
  })

  it('drops invalid observations entirely', async () => {
    await updateStance('s1', { observation: '', direction: 'helped' })
    await updateStance('s1', { observation: 'x', direction: 'sideways' } as never)
    await updateStance('s1', undefined)
    expect(db.stanceProfile.add).not.toHaveBeenCalled()
    expect(db.stanceProfile.update).not.toHaveBeenCalled()
  })
})
