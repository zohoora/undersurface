import { describe, it, expect } from 'vitest'
import type { Session, SessionMessage, PartMemory } from './index'

describe('Session types', () => {
  it('Session has required fields', () => {
    const session: Session = {
      id: 'test',
      startedAt: Date.now(),
      endedAt: null,
      status: 'active',
      hostPartId: 'watcher',
      participantPartIds: ['watcher'],
      openingMethod: 'auto',
      sessionNote: null,
      messageCount: 0,
      firstLine: '',
      phase: 'opening',
    }
    expect(session.status).toBe('active')
    expect(session.endedAt).toBeNull()
  })

  it('SessionMessage supports part and user speakers', () => {
    const partMsg: SessionMessage = {
      id: 'm1',
      speaker: 'part',
      partId: 'watcher',
      partName: 'The Watcher',
      content: 'Hello',
      timestamp: Date.now(),
      phase: 'opening',
      isEmergence: false,
    }
    const userMsg: SessionMessage = {
      id: 'm2',
      speaker: 'user',
      partId: null,
      partName: null,
      content: 'Hi',
      timestamp: Date.now(),
      phase: 'opening',
      isEmergence: false,
    }
    expect(partMsg.speaker).toBe('part')
    expect(userMsg.partId).toBeNull()
  })

  it('PartMemory supports session source', () => {
    const mem: PartMemory = {
      id: 'mem1',
      partId: 'watcher',
      entryId: '',
      content: 'Observed something',
      type: 'reflection',
      timestamp: Date.now(),
      source: 'session',
      sessionId: 'sess1',
    }
    expect(mem.source).toBe('session')
  })
})
