import { describe, expect, it } from 'vitest'
import { deriveSmsCompanionContext, type SmsContextDocuments } from './context'

const NOW = Date.UTC(2026, 6, 9)

function documents(): SmsContextDocuments {
  return {
    sessions: [
      { status: 'closed', sessionNote: 'The job decision remains open.', startedAt: NOW - 3_000, endedAt: NOW - 2_000 },
      { status: 'closed', sessionNote: 'Do not include Fresh eyes.', memoryAperture: 'fresh', startedAt: NOW - 2_500, endedAt: NOW - 1_500 },
      { status: 'active', sessionNote: 'Do not include active.', startedAt: NOW - 1_000 },
    ],
    memories: [
      { partId: 'open', content: 'Directness helped.', type: 'reflection', timestamp: NOW - 100 },
      { partId: 'weaver', content: 'Directness helped.', type: 'reflection', timestamp: NOW - 200 },
      { partId: 'other', content: 'Wrong source.', type: 'pattern', timestamp: NOW },
    ],
    profile: { innerLandscape: 'Careful around conflict', recurringThemes: ['belonging'], lastUpdated: NOW },
    personalFacts: {
      people: [{ name: 'Sam', relationship: 'friend' }],
      dates: [],
      context: [],
      currentThreads: [{ topic: 'job offer' }],
      lexicon: ['the gray hour'],
    },
    smsMessages: [
      { direction: 'inbound', carryForward: true, fieldNote: 'Presentation is Friday.', createdAt: NOW - 1_000 },
      { direction: 'inbound', carryForward: true, fieldNote: 'Expired note.', createdAt: NOW - 15 * 86_400_000 },
    ],
    userParts: [{ status: 'active', name: 'the planner', description: 'prevents surprises', stance: 'slow down', lastActiveAt: NOW }],
    intentions: [
      { id: 'i1', status: 'open', text: 'call Sam', notYetCount: 1, createdAt: NOW - 100, valueId: 'v1' },
      { id: 'i2', status: 'open', text: 'book the visit', notYetCount: 3, createdAt: NOW - 50 },
    ],
    stanceProfile: { entries: ['Concrete questions help.'] },
    values: [{ id: 'v1', status: 'active', name: 'friendship', description: 'showing up' }],
    promises: [
      { id: 'next', status: 'active', text: 'ask about the interview', dueKind: 'next_session' },
      { id: 'missed', status: 'active', text: 'remember the anniversary', dueKind: 'date', dueDate: '2026-06-01' },
    ],
    personalProtocols: [{
      id: 'p1', status: 'active', title: 'Find the first concrete step',
      preferredArm: 'make_concrete', context: { state: 'looping' },
      transferStatus: 'graduated', transferLevel: 'independent', updatedAt: NOW,
    }],
    livingHypotheses: [
      { status: 'confirmed', text: 'I may be buying time because it matters.', updatedAt: NOW },
      { status: 'candidate', text: 'Do not load candidates.', updatedAt: NOW },
      { status: 'contested', text: 'It is not simply indecision.', updatedAt: NOW },
    ],
  }
}

describe('SMS shared context derivation', () => {
  it('loads the same stable memory categories used by the app', () => {
    const result = deriveSmsCompanionContext(documents(), {
      userParts: true,
      sessionIntentions: true,
      stanceAdaptation: true,
      userValues: true,
      companionInteriority: true,
    }, NOW)

    expect(result.recentSessionNotes).toEqual([{ note: 'The job decision remains open.', date: NOW - 2_000 }])
    expect(result.relevantMemories).toHaveLength(1)
    expect(result.profile?.recurringThemes).toEqual(['belonging'])
    expect(result.personalFacts?.people?.[0]?.name).toBe('Sam')
    expect(result.recentFieldNotes).toEqual([{ text: 'Presentation is Friday.', date: NOW - 1_000 }])
    expect(result.activeUserParts?.[0]?.name).toBe('the planner')
    expect(result.lexicon).toEqual(['the gray hour'])
    expect(result.openIntentions?.map(item => item.text)).toEqual(['book the visit', 'call Sam'])
    expect(result.openIntentions?.[1]?.serves).toBe('friendship')
    expect(result.stanceContext).toEqual(['Concrete questions help.'])
    expect(result.activeValues?.[0]?.name).toBe('friendship')
    expect(result.duePromises?.map(item => item.id)).toEqual(['next'])
    expect(result.missedPromise?.id).toBe('missed')
    expect(result.activePersonalProtocols?.[0]).toMatchObject({
      title: 'Find the first concrete step', transferStatus: 'graduated', transferLevel: 'independent',
    })
    expect(result.livingHypotheses).toEqual([
      { text: 'I may be buying time because it matters.', status: 'confirmed' },
      { text: 'It is not simply indecision.', status: 'contested' },
    ])
  })

  it('keeps foundational memory while feature-gating optional companion programs', () => {
    const result = deriveSmsCompanionContext(documents(), {}, NOW)
    expect(result.recentSessionNotes).toHaveLength(1)
    expect(result.relevantMemories).toHaveLength(1)
    expect(result.profile).not.toBeNull()
    expect(result.personalFacts).not.toBeNull()
    expect(result.activeUserParts).toEqual([])
    expect(result.openIntentions).toEqual([])
    expect(result.stanceContext).toEqual([])
    expect(result.activeValues).toEqual([])
    expect(result.duePromises).toEqual([])
  })
})
