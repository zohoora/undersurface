import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Session, UserPart, CompanionSignals } from '../types'

const chatMock = vi.fn(async () => '{"partObservations": []}')
vi.mock('../ai/openrouter', () => ({
  chatCompletion: (...a: unknown[]) => chatMock(...a),
}))
vi.mock('../ai/therapistPrompts', () => ({
  buildPartBackfillPrompt: vi.fn(() => [{ role: 'system', content: 'stub' }]),
  buildBoundedTranscript: vi.fn(() =>
    'Writer: a long enough transcript for processing purposes, well past the hundred character floor the engine enforces before spending a model call.',
  ),
}))

type DbState = {
  sessions: Session[]
  signals: CompanionSignals | undefined
  userParts: UserPart[]
  messagesById: Record<string, { id: string; speaker: string; content: string }[]>
  features: Record<string, boolean>
  signalWrites: Partial<CompanionSignals>[]
  partAdds: UserPart[]
  partUpdates: Array<[string, UserPart]>
}
let state: DbState

vi.mock('../store/globalConfig', () => ({
  getGlobalConfig: () => ({ features: state.features }),
}))

const sessionMessagesGetAll = vi.fn(async (id: string) => state.messagesById[id] ?? [])
vi.mock('../store/db', () => {
  return {
    db: {
      sessions: {
        orderBy: () => ({
          reverse: () => ({
            limit: (n: number) => ({
              toArray: async () =>
                [...state.sessions].sort((a, b) => b.startedAt - a.startedAt).slice(0, n),
            }),
          }),
        }),
      },
      companionSignals: {
        get: async () => state.signals,
        add: async (doc: CompanionSignals) => { state.signals = doc; state.signalWrites.push(doc) },
        update: async (_id: string, doc: Partial<CompanionSignals>) => {
          state.signals = { ...(state.signals as CompanionSignals), ...doc }
          state.signalWrites.push(doc)
        },
      },
      userParts: {
        toArray: async () => state.userParts,
        add: async (p: UserPart) => { state.userParts = [...state.userParts, p]; state.partAdds.push(p) },
        update: async (id: string, p: UserPart) => {
          state.userParts = state.userParts.map((x) => (x.id === id ? p : x))
          state.partUpdates.push([id, p])
        },
      },
    },
    sessionMessages: { getAll: (id: string) => sessionMessagesGetAll(id) },
    generateId: (() => { let i = 0; return () => `gen-${++i}` })(),
  }
})

const { maybeBackfillUserParts } = await import('./userPartsBackfill')

const NOW = 1_750_000_000_000
const DAY = 86_400_000

function makeSession(over: Partial<Session>): Session {
  return {
    id: 's', startedAt: NOW - DAY, endedAt: NOW - DAY + 3_600_000, status: 'closed',
    messageCount: 10, firstLine: '', phase: 'closing', favorited: false,
    hostPartId: 'therapist', participantPartIds: [], openingMethod: 'auto', sessionNote: null,
    ...over,
  } as Session
}

function seedMessages(ids: string[]) {
  for (const id of ids) {
    state.messagesById[id] = [
      { id: 'm1', speaker: 'user', content: 'hello there companion friend' },
      { id: 'm2', speaker: 'therapist', content: 'welcome' },
    ]
  }
}

beforeEach(() => {
  state = {
    sessions: [], signals: undefined, userParts: [], messagesById: {},
    features: { userParts: true }, signalWrites: [], partAdds: [], partUpdates: [],
  }
  chatMock.mockReset().mockResolvedValue('{"partObservations": []}')
  sessionMessagesGetAll.mockClear()
})

describe('maybeBackfillUserParts', () => {
  it('claims the marker BEFORE processing and walks closed sessions chronologically', async () => {
    state.sessions = [
      makeSession({ id: 'old', startedAt: NOW - 3 * DAY }),
      makeSession({ id: 'mid', startedAt: NOW - 2 * DAY }),
      makeSession({ id: 'new', startedAt: NOW - 1 * DAY }),
    ]
    seedMessages(['old', 'mid', 'new'])

    await maybeBackfillUserParts()

    // Claim happened (first signal write carries partsBackfillAt)…
    expect(state.signalWrites[0]).toHaveProperty('partsBackfillAt')
    // …and sessions were processed oldest-first.
    expect(sessionMessagesGetAll.mock.calls.map((c) => c[0])).toEqual(['old', 'mid', 'new'])
    expect(chatMock).toHaveBeenCalledTimes(3)
  })

  it('short-circuits with zero calls when already backfilled or flag off', async () => {
    state.sessions = [makeSession({ id: 'a' })]
    seedMessages(['a'])
    state.signals = { id: 'current', pendingRepair: null, ruminationWatch: null, partsBackfillAt: NOW, updatedAt: NOW }

    await maybeBackfillUserParts()
    expect(chatMock).not.toHaveBeenCalled()

    state.signals = undefined
    state.features = {}
    await maybeBackfillUserParts()
    expect(chatMock).not.toHaveBeenCalled()
  })

  it('skips active sessions and thin sessions (messageCount < 4)', async () => {
    state.sessions = [
      makeSession({ id: 'active', status: 'active' }),
      makeSession({ id: 'thin', messageCount: 3 }),
      makeSession({ id: 'good', startedAt: NOW - 2 * DAY }),
    ]
    seedMessages(['active', 'thin', 'good'])

    await maybeBackfillUserParts()

    expect(sessionMessagesGetAll.mock.calls.map((c) => c[0])).toEqual(['good'])
  })

  it('matches incrementally: a candidate seeded from session A is bumped by session B', async () => {
    state.sessions = [
      makeSession({ id: 'a', startedAt: NOW - 2 * DAY }),
      makeSession({ id: 'b', startedAt: NOW - 1 * DAY }),
    ]
    seedMessages(['a', 'b'])
    chatMock
      .mockResolvedValueOnce(JSON.stringify({
        partObservations: [{ tentativeName: 'the bracer', description: 'braces', stance: 'protective', quote: 'braced again' }],
      }))
      .mockResolvedValueOnce(JSON.stringify({
        partObservations: [{ partId: 'gen-1', quote: 'bracing at the toast', stance: 'protective' }],
      }))

    await maybeBackfillUserParts()

    expect(state.partAdds).toHaveLength(1)
    expect(state.partUpdates).toHaveLength(1)
    const [, updated] = state.partUpdates[0]
    expect(updated.sessionsSeen).toBe(2) // distinct sessions a + b
  })

  it('a failing session call is skipped; the walk continues', async () => {
    state.sessions = [
      makeSession({ id: 'a', startedAt: NOW - 2 * DAY }),
      makeSession({ id: 'b', startedAt: NOW - 1 * DAY }),
    ]
    seedMessages(['a', 'b'])
    chatMock
      .mockRejectedValueOnce(new Error('upstream 500'))
      .mockResolvedValueOnce(JSON.stringify({
        partObservations: [{ tentativeName: 'the bracer', description: 'braces', stance: 'protective', quote: 'again' }],
      }))

    await maybeBackfillUserParts()

    expect(chatMock).toHaveBeenCalledTimes(2)
    expect(state.partAdds).toHaveLength(1)
  })

  it('tolerates malformed JSON from a session and writes nothing for it', async () => {
    state.sessions = [makeSession({ id: 'a' })]
    seedMessages(['a'])
    chatMock.mockResolvedValueOnce('not json at all')

    await maybeBackfillUserParts()

    expect(state.partAdds).toHaveLength(0)
    expect(state.partUpdates).toHaveLength(0)
  })
})
