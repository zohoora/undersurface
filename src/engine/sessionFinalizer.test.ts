import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Session, SessionMessage } from '../types'

const state = vi.hoisted(() => ({
  sessions: [] as Session[],
  messages: {} as Record<string, SessionMessage[]>,
}))

const update = vi.hoisted(() => vi.fn(async () => {}))
const deleteSession = vi.hoisted(() => vi.fn(async () => {}))
const deleteMessage = vi.hoisted(() => vi.fn(async () => {}))
const reflect = vi.hoisted(() => vi.fn(async () => {}))

vi.mock('../store/db', () => ({
  db: {
    sessions: {
      orderBy: vi.fn(() => ({
        reverse: vi.fn(() => ({
          limit: vi.fn(() => ({ toArray: vi.fn(async () => state.sessions) })),
        })),
      })),
      update,
      delete: deleteSession,
    },
    parts: { toArray: vi.fn(async () => []) },
  },
  sessionMessages: {
    getAll: vi.fn(async (id: string) => state.messages[id] ?? []),
    delete: deleteMessage,
  },
}))

vi.mock('./sessionReflectionEngine', () => ({ reflectOnSession: reflect }))

import { finalizePreviousActiveSessions } from './sessionFinalizer'

function session(id: string, overrides: Partial<Session> = {}): Session {
  return {
    id,
    startedAt: 100,
    mode: 'standard',
    status: 'active',
    phase: 'opening',
    ...overrides,
  }
}

function message(id: string, speaker: 'user' | 'therapist', timestamp: number): SessionMessage {
  return {
    id,
    speaker,
    partId: null,
    partName: null,
    content: speaker === 'user' ? 'A substantive writer turn.' : 'A companion response.',
    timestamp,
    phase: 'exploration',
    isEmergence: false,
  }
}

describe('finalizePreviousActiveSessions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.sessions = []
    state.messages = {}
  })

  it('deletes opener-only navigation shells', async () => {
    state.sessions = [session('empty')]
    state.messages.empty = [message('opener', 'therapist', 110)]

    await finalizePreviousActiveSessions()

    expect(deleteMessage).toHaveBeenCalledWith('empty', 'opener')
    expect(deleteSession).toHaveBeenCalledWith('empty')
    expect(reflect).not.toHaveBeenCalled()
  })

  it('closes a real conversation and starts its whole-session reflection', async () => {
    const messages = [message('u1', 'user', 120), message('a1', 'therapist', 130)]
    state.sessions = [session('previous')]
    state.messages.previous = messages

    await finalizePreviousActiveSessions()
    await vi.waitFor(() => expect(reflect).toHaveBeenCalledWith('previous', messages, []))

    expect(update).toHaveBeenCalledWith('previous', expect.objectContaining({
      status: 'closed', endedAt: 130, phase: 'closing', reflectionStatus: 'pending',
    }))
  })

  it('closes Fresh eyes without reflection or longitudinal writes', async () => {
    state.sessions = [session('fresh', { memoryAperture: 'fresh' })]
    state.messages.fresh = [message('u1', 'user', 120), message('a1', 'therapist', 130)]

    await finalizePreviousActiveSessions()

    expect(update).toHaveBeenCalledWith('fresh', expect.objectContaining({
      status: 'closed', reflectionStatus: 'complete', reflectedAt: expect.any(Number),
    }))
    expect(reflect).not.toHaveBeenCalled()
  })

  it('leaves the explicitly excluded active session alone', async () => {
    state.sessions = [session('current')]
    state.messages.current = [message('u1', 'user', 120)]

    await finalizePreviousActiveSessions('current')

    expect(update).not.toHaveBeenCalled()
    expect(deleteSession).not.toHaveBeenCalled()
  })
})
