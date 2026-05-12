import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Session, PartMemory, UserProfile, PersonalFacts, RelaxSession } from '../types'

// Per-collection fixtures the tests configure; the db mock pulls from these.
type State = {
  sessions: Session[]
  memoriesByPart: Record<string, PartMemory[]>
  profiles: UserProfile[]
  personalFacts: PersonalFacts | undefined
  relaxSessions: RelaxSession[]
  relaxSessionsByParent: Record<string, RelaxSession[]>
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
  }
}

vi.mock('../store/db', () => ({
  db: {
    sessions: {
      orderBy: () => ({
        reverse: () => ({
          toArray: async () =>
            [...state.sessions].sort((a, b) => b.startedAt - a.startedAt),
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
