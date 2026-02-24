import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Part, SessionMessage } from '../types'

vi.mock('../ai/openrouter', () => ({
  chatCompletion: vi.fn(),
}))
vi.mock('../ai/therapistPrompts', () => ({
  buildSessionReflectionPrompt: vi.fn().mockReturnValue([
    { role: 'system', content: 'test' },
    { role: 'user', content: 'test' },
  ]),
}))
vi.mock('../store/db', () => ({
  db: {
    userProfile: { get: vi.fn(async () => undefined), add: vi.fn(), update: vi.fn() },
    entrySummaries: {
      add: vi.fn(),
      count: vi.fn(async () => 1),
      orderBy: vi.fn(() => ({ reverse: vi.fn(() => ({ toArray: vi.fn(async () => []) })) })),
    },
    memories: { add: vi.fn(), where: vi.fn(() => ({ equals: vi.fn(() => ({ toArray: vi.fn(async () => []) })) })), delete: vi.fn() },
    entries: { count: vi.fn(async () => 5) },
    parts: { toArray: vi.fn(async () => []) },
  },
  generateId: vi.fn(() => 'gen-id'),
}))
vi.mock('./letterEngine', () => ({
  LetterEngine: class { checkForLetter = vi.fn(async () => null) },
}))

import { reflectOnSession } from './sessionReflectionEngine'
import { chatCompletion } from '../ai/openrouter'
import { db } from '../store/db'

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
