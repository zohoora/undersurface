import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Session, PartMemory, UserProfile, PersonalFacts, RelaxSession, CompanionSignals, SmsMessage, CompanionPreferences } from '../types'

// Per-collection fixtures the tests configure; the db mock pulls from these.
type State = {
  sessions: Session[]
  memoriesByPart: Record<string, PartMemory[]>
  profiles: UserProfile[]
  personalFacts: PersonalFacts | undefined
  relaxSessions: RelaxSession[]
  relaxSessionsByParent: Record<string, RelaxSession[]>
  companionSignals: CompanionSignals | undefined
  companionSignalWrites: CompanionSignals[]
  features: Record<string, boolean>
  // Records the limit the loader applied to the sessions query, so tests can
  // assert the scan is bounded.
  sessionsQueryLimit: number | null
  smsMessages: SmsMessage[]
  companionPreferences: CompanionPreferences | undefined
}

let state: State

function freshState(): State {
  return {
    sessions: [],
    memoriesByPart: {},
    profiles: [],
    personalFacts: undefined,
    relaxSessions: [],
    relaxSessionsByParent: {},
    companionSignals: undefined,
    companionSignalWrites: [],
    features: {},
    sessionsQueryLimit: null,
    smsMessages: [],
    companionPreferences: undefined,
  }
}

vi.mock('../store/globalConfig', () => ({
  getGlobalConfig: () => ({ features: state.features }),
}))

vi.mock('../store/db', () => ({
  db: {
    sessions: {
      orderBy: () => ({
        reverse: () => ({
          limit: (n: number) => {
            state.sessionsQueryLimit = n
            return {
              toArray: async () =>
                [...state.sessions]
                  .sort((a, b) => b.startedAt - a.startedAt)
                  .slice(0, n),
            }
          },
        }),
      }),
    },
    memories: {
      where: () => ({
        equals: (partId: string) => ({
          toArray: async () => state.memoriesByPart[partId] ?? [],
        }),
      }),
    },
    userProfile: {
      toArray: async () => state.profiles,
    },
    personalFacts: {
      get: async () => state.personalFacts,
    },
    relaxSessions: {
      orderBy: () => ({
        reverse: () => ({
          limit: (n: number) => ({
            toArray: async () =>
              [...state.relaxSessions]
                .sort((a, b) => b.startedAt - a.startedAt)
                .slice(0, n),
          }),
        }),
      }),
      where: () => ({
        equals: (parentId: string) => ({
          toArray: async () => state.relaxSessionsByParent[parentId] ?? [],
        }),
      }),
    },
    companionSignals: {
      get: async () => state.companionSignals,
      add: async (doc: CompanionSignals) => { state.companionSignalWrites.push(doc) },
      update: async (_id: string, doc: CompanionSignals) => { state.companionSignalWrites.push(doc) },
    },
    smsMessages: {
      orderBy: () => ({
        reverse: () => ({
          limit: (n: number) => ({
            toArray: async () => [...state.smsMessages]
              .sort((a, b) => b.createdAt - a.createdAt)
              .slice(0, n),
          }),
        }),
      }),
    },
    companionPreferences: {
      get: async () => state.companionPreferences,
    },
  },
}))

const { loadTherapistContext, loadInSessionRelaxBreaks } = await import('./sessionContextLoader')

function makeSession(over: Partial<Session>): Session {
  return {
    id: 'id',
    startedAt: 0,
    endedAt: null,
    status: 'closed',
    hostPartId: 'therapist',
    participantPartIds: [],
    openingMethod: 'auto',
    sessionNote: 'a note',
    messageCount: 0,
    firstLine: '',
    phase: 'opening',
    favorited: false,
    ...over,
  }
}

function makeRelax(over: Partial<RelaxSession>): RelaxSession {
  return {
    id: 'r',
    startedAt: 0,
    endedAt: 1,
    duration: 1,
    practice: 'breathwork',
    parentSessionId: null,
    ...over,
  } as RelaxSession
}

beforeEach(() => {
  state = freshState()
})

describe('loadTherapistContext', () => {
  it('returns nulls/empties when the user has no history', async () => {
    const ctx = await loadTherapistContext()
    expect(ctx.recentSessionNotes).toEqual([])
    expect(ctx.relevantMemories).toEqual([])
    expect(ctx.userProfile).toBeNull()
    expect(ctx.personalFacts).toBeNull()
    expect(ctx.recentRelaxBreaks).toEqual([])
    expect(ctx.recentFieldNotes).toEqual([])
  })

  it('always starts new sessions with normal continuity even if a legacy default says fresh', async () => {
    state.companionPreferences = {
      id: 'current',
      defaultMemoryAperture: 'fresh',
      fieldMosaicEnabled: true,
      outcomeSampling: 'light',
      updatedAt: 1,
    }

    expect((await loadTherapistContext()).memoryAperture).toBe('pattern')
  })

  it('loads only recent model-selected SMS notes as weak field-note context', async () => {
    const now = Date.now()
    state.smsMessages = [
      { id: 'selected', channel: 'sms', direction: 'inbound', body: 'The presentation is tomorrow and I am dreading it', mode: 'natural', createdAt: now - 1000, status: 'processed', carryForward: true, fieldNote: 'Presentation tomorrow is causing dread.' },
      { id: 'unsaved', channel: 'sms', direction: 'inbound', body: 'Hi there', mode: 'natural', createdAt: now - 950, status: 'processed', carryForward: false, fieldNote: null },
      { id: 'reply', channel: 'sms', direction: 'outbound', body: 'Try both feet', mode: 'natural', createdAt: now - 900, status: 'sent' },
      { id: 'old', channel: 'sms', direction: 'inbound', body: 'Too old', mode: 'natural', createdAt: now - 15 * 86_400_000, status: 'processed', carryForward: true, fieldNote: 'Old note' },
      { id: 'legacy', channel: 'sms', direction: 'inbound', body: 'Legacy explicit capture', mode: 'capture', createdAt: now - 800, status: 'captured' },
    ]

    const ctx = await loadTherapistContext()

    expect(ctx.recentFieldNotes).toEqual([
      { text: 'Legacy explicit capture', date: now - 800 },
      { text: 'Presentation tomorrow is causing dread.', date: now - 1000 },
    ])
  })

  it('bounds the sessions query instead of scanning the full collection', async () => {
    await loadTherapistContext()
    expect(state.sessionsQueryLimit).not.toBeNull()
    expect(state.sessionsQueryLimit as number).toBeLessThanOrEqual(50)
  })

  it('takes only the 5 most recent CLOSED sessions with notes (active or note-less ones excluded)', async () => {
    state.sessions = [
      makeSession({ id: 's1', startedAt: 100, endedAt: 110, status: 'closed', sessionNote: 'one' }),
      makeSession({ id: 's2', startedAt: 200, endedAt: null, status: 'active', sessionNote: 'two' }),
      makeSession({ id: 's3', startedAt: 300, endedAt: 310, status: 'closed', sessionNote: null }),
      ...Array.from({ length: 6 }, (_, i) =>
        makeSession({
          id: `recent-${i}`,
          startedAt: 1000 + i,
          endedAt: 2000 + i,
          status: 'closed',
          sessionNote: `note-${i}`,
        }),
      ),
    ]

    const ctx = await loadTherapistContext()
    expect(ctx.recentSessionNotes).toHaveLength(5)
    // Most recent first; the active and note-less ones must not appear.
    expect(ctx.recentSessionNotes.map(n => n.note)).toEqual(['note-5', 'note-4', 'note-3', 'note-2', 'note-1'])
  })

  it('excludes Fresh eyes session notes and their parent Relax history', async () => {
    state.sessions = [
      makeSession({ id: 'fresh', startedAt: 200, endedAt: 210, sessionNote: 'private learning boundary', memoryAperture: 'fresh' }),
      makeSession({ id: 'normal', startedAt: 100, endedAt: 110, sessionNote: 'continuity note', memoryAperture: 'pattern' }),
    ]
    state.relaxSessions = [
      makeRelax({ id: 'fresh-relax', parentSessionId: 'fresh', startedAt: 300, endedAt: 310 }),
      makeRelax({ id: 'normal-relax', parentSessionId: 'normal', startedAt: 200, endedAt: 210 }),
    ]

    const ctx = await loadTherapistContext()
    expect(ctx.recentSessionNotes.map(note => note.note)).toEqual(['continuity note'])
    expect(ctx.recentRelaxBreaks.map(relax => relax.id)).toEqual(['normal-relax'])
  })

  it('uses endedAt as the date when present, falling back to startedAt', async () => {
    state.sessions = [
      makeSession({ id: 's1', startedAt: 100, endedAt: 999, status: 'closed', sessionNote: 'ended' }),
      makeSession({ id: 's2', startedAt: 200, endedAt: null, status: 'closed', sessionNote: 'no-end' }),
    ]
    const ctx = await loadTherapistContext()
    const byNote = Object.fromEntries(ctx.recentSessionNotes.map(n => [n.note, n.date]))
    expect(byNote['ended']).toBe(999)
    expect(byNote['no-end']).toBe(200)
  })

  it('flattens memories from open + weaver + still parts, sorts newest-first, caps at 12', async () => {
    const mk = (partId: string, t: number): PartMemory => ({
      id: `${partId}-${t}`,
      partId,
      entryId: 'e',
      content: `${partId}@${t}`,
      type: 'fact',
      timestamp: t,
    } as PartMemory)

    state.memoriesByPart = {
      open: Array.from({ length: 10 }, (_, i) => mk('open', i * 100)),
      weaver: Array.from({ length: 10 }, (_, i) => mk('weaver', i * 100 + 50)),
      still: Array.from({ length: 10 }, (_, i) => mk('still', i * 100 + 25)),
      // Should NOT be sourced: memories from other parts.
      watcher: [mk('watcher', 99999)],
    }

    const ctx = await loadTherapistContext()
    expect(ctx.relevantMemories).toHaveLength(12)
    // newest-first
    for (let i = 1; i < ctx.relevantMemories.length; i++) {
      expect(ctx.relevantMemories[i - 1].timestamp).toBeGreaterThanOrEqual(ctx.relevantMemories[i].timestamp)
    }
    // No watcher memories — only open/weaver/still are sourced.
    expect(ctx.relevantMemories.some(m => m.partId === 'watcher')).toBe(false)
  })

  it('dedups identical memory content across parts (legacy triplicated patterns)', async () => {
    const mk = (partId: string, content: string, t: number): PartMemory => ({
      id: `${partId}-${t}`,
      partId,
      entryId: 'e',
      content,
      type: 'pattern',
      timestamp: t,
    } as PartMemory)

    // Same pattern string stored once per manager/self part, as the old
    // reflection engine did. It must collapse to a single entry.
    state.memoriesByPart = {
      open: [mk('open', 'You retreat when things get close.', 300)],
      weaver: [mk('weaver', 'You retreat when things get close.', 300)],
      still: [mk('still', 'You retreat when things get close.', 300), mk('still', 'A distinct observation.', 200)],
    }

    const ctx = await loadTherapistContext()
    const patternCount = ctx.relevantMemories.filter(m => m.content === 'You retreat when things get close.').length
    expect(patternCount).toBe(1)
    expect(ctx.relevantMemories).toHaveLength(2)
  })

  it('filters relax breaks to completed sessions only and limits to 5', async () => {
    state.relaxSessions = [
      makeRelax({ id: 'r1', startedAt: 100, endedAt: 200 }),
      makeRelax({ id: 'r2', startedAt: 50, endedAt: null as unknown as number }),  // unfinished
      ...Array.from({ length: 6 }, (_, i) => makeRelax({
        id: `r-recent-${i}`,
        startedAt: 1000 + i,
        endedAt: 2000 + i,
      })),
    ]

    const ctx = await loadTherapistContext()
    expect(ctx.recentRelaxBreaks).toHaveLength(5)
    expect(ctx.recentRelaxBreaks.every(r => r.endedAt !== null)).toBe(true)
  })

  it('returns the first userProfile when multiple exist (db quirk)', async () => {
    state.profiles = [
      { id: 'p1', innerLandscape: 'first' } as unknown as UserProfile,
      { id: 'p2', innerLandscape: 'second' } as unknown as UserProfile,
    ]
    const ctx = await loadTherapistContext()
    expect(ctx.userProfile).toEqual({ id: 'p1', innerLandscape: 'first' })
  })
})

describe('loadInSessionRelaxBreaks', () => {
  it('returns only completed relax breaks under the given parent session, oldest-first', async () => {
    state.relaxSessionsByParent = {
      'chat-A': [
        makeRelax({ id: 'r1', startedAt: 100, endedAt: 300 }),
        makeRelax({ id: 'r2', startedAt: 50, endedAt: 150 }),
        makeRelax({ id: 'r3', startedAt: 200, endedAt: null as unknown as number }), // unfinished
      ],
      'chat-B': [makeRelax({ id: 'should-not-appear', startedAt: 10, endedAt: 20 })],
    }

    const result = await loadInSessionRelaxBreaks('chat-A')
    expect(result.map(r => r.id)).toEqual(['r2', 'r1']) // sorted by endedAt asc
    expect(result.every(r => r.parentSessionId !== 'chat-B')).toBe(true)
  })

  it('returns [] when the parent session has no relax breaks', async () => {
    const result = await loadInSessionRelaxBreaks('unknown')
    expect(result).toEqual([])
  })
})

describe('loadTherapistContext — rupture evidence + rumination watch', () => {
  const DAY = 86_400_000
  const NOW = Date.now()

  // A habitual closer's history on a 2-day cadence, newest 12 days old —
  // fires the atypical-gap marker (12d > 3×2d and > 10d floor).
  function seedGapHistory() {
    state.sessions = Array.from({ length: 6 }, (_, i) =>
      makeSession({ id: `h${i}`, startedAt: NOW - (12 + i * 2) * DAY, status: 'closed' }),
    )
  }

  it('computes open-time evidence, persists it as pendingRepair, and returns repairContext', async () => {
    state.features = { ruptureRepair: true }
    seedGapHistory()

    const ctx = await loadTherapistContext()

    expect(ctx.repairContext).toEqual({ evidence: 'atypical_gap' })
    expect(state.companionSignalWrites).toHaveLength(1)
    expect(state.companionSignalWrites[0].pendingRepair?.evidence).toBe('atypical_gap')
  })

  it('excludes the session being resumed from the prior list', async () => {
    state.features = { ruptureRepair: true }
    seedGapHistory()
    // The resumed session is brand-new; if it were counted, the gap would be ~0.
    state.sessions.push(makeSession({ id: 'current-one', startedAt: NOW - 1000, status: 'active' }))

    const ctx = await loadTherapistContext('current-one')

    expect(ctx.repairContext).toEqual({ evidence: 'atypical_gap' })
  })

  it('does not use Fresh eyes sessions as rupture or cadence evidence', async () => {
    state.features = { ruptureRepair: true }
    seedGapHistory()
    state.sessions = state.sessions.map(session => ({ ...session, memoryAperture: 'fresh' as const }))

    const ctx = await loadTherapistContext()
    expect(ctx.repairContext).toBeNull()
    expect(state.companionSignalWrites).toHaveLength(0)
  })

  it('falls back to stored pendingRepair (terse ending from reflection) when nothing fires at open', async () => {
    state.features = { ruptureRepair: true }
    state.sessions = [makeSession({ id: 's1', startedAt: NOW - DAY, status: 'closed' })]
    state.companionSignals = {
      id: 'current',
      pendingRepair: { evidence: 'terse_ending', sourceSessionId: 's1', createdAt: NOW - DAY },
      ruminationWatch: null,
      updatedAt: NOW - DAY,
    }

    const ctx = await loadTherapistContext()

    expect(ctx.repairContext).toEqual({ evidence: 'terse_ending' })
    expect(state.companionSignalWrites).toHaveLength(0) // read-only path
  })

  it('returns no repairContext when the flag is off, even with evidence everywhere', async () => {
    state.features = {}
    seedGapHistory()
    state.companionSignals = {
      id: 'current',
      pendingRepair: { evidence: 'abandoned', sourceSessionId: 'x', createdAt: NOW },
      ruminationWatch: null,
      updatedAt: NOW,
    }

    const ctx = await loadTherapistContext()

    expect(ctx.repairContext).toBeNull()
    expect(state.companionSignalWrites).toHaveLength(0)
  })

  it('arms ruminationWatch only at streak >= 3 and only under its flag', async () => {
    state.features = { ruminationPivot: true }
    state.companionSignals = {
      id: 'current',
      pendingRepair: null,
      ruminationWatch: { theme: 'the job decision', streak: 3, lastConfirmedAt: NOW },
      updatedAt: NOW,
    }
    expect((await loadTherapistContext()).ruminationWatch).toEqual({ theme: 'the job decision' })

    state.companionSignals.ruminationWatch = { theme: 'the job decision', streak: 2, lastConfirmedAt: NOW }
    expect((await loadTherapistContext()).ruminationWatch).toBeNull()

    state.features = {}
    state.companionSignals.ruminationWatch = { theme: 'the job decision', streak: 5, lastConfirmedAt: NOW }
    expect((await loadTherapistContext()).ruminationWatch).toBeNull()
  })
})
