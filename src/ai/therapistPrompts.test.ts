import { describe, it, expect, vi } from 'vitest'

vi.mock('../i18n', () => ({
  getLanguageCode: vi.fn(() => 'en'),
  getLLMLanguageName: vi.fn(() => 'English'),
}))

import { buildTherapistSystemPrompt, buildTherapistMessages, buildTherapistSessionNotePrompt, buildSessionReflectionPrompt } from './therapistPrompts'
import type { SessionMessage, PartMemory, UserProfile, EntrySummary } from '../types'

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

describe('buildTherapistSystemPrompt', () => {
  it('includes core therapist instructions', () => {
    const prompt = buildTherapistSystemPrompt({ phase: 'opening' })
    expect(prompt).toContain('IFS-informed conversational companion')
    expect(prompt).toContain('SAFETY')
  })

  it('includes phase hint', () => {
    const prompt = buildTherapistSystemPrompt({ phase: 'deepening' })
    expect(prompt).toContain('SESSION PHASE: deepening')
  })

  it('includes user profile when provided', () => {
    const profile: UserProfile = {
      id: 'current',
      recurringThemes: ['loss', 'identity'],
      emotionalPatterns: ['avoids anger'],
      avoidancePatterns: ['family conflict'],
      growthSignals: ['more honest'],
      innerLandscape: 'A landscape of half-spoken truths',
      lastUpdated: Date.now(),
    }
    const prompt = buildTherapistSystemPrompt({ phase: 'deepening', profile })
    expect(prompt).toContain('loss, identity')
    expect(prompt).toContain('A landscape of half-spoken truths')
    expect(prompt).toContain('family conflict')
  })

  it('includes session notes when provided', () => {
    const notes = [
      { note: 'Writer explored childhood memories', date: Date.now() },
    ]
    const prompt = buildTherapistSystemPrompt({ phase: 'deepening', recentSessionNotes: notes })
    expect(prompt).toContain('childhood memories')
  })

  it('includes memories when provided', () => {
    const memories: PartMemory[] = [
      { id: '1', partId: 'open', entryId: 'e1', content: 'Writer struggles with vulnerability', type: 'reflection', timestamp: Date.now() },
    ]
    const prompt = buildTherapistSystemPrompt({ phase: 'deepening', relevantMemories: memories })
    expect(prompt).toContain('struggles with vulnerability')
  })

  it('includes grounding directive when active', () => {
    const prompt = buildTherapistSystemPrompt({ phase: 'deepening', isGrounding: true })
    expect(prompt).toContain('distress')
    expect(prompt).toContain('gentle')
  })
})

describe('buildTherapistMessages', () => {
  it('returns system + opening prompt for empty history', () => {
    const result = buildTherapistMessages([], { phase: 'opening' })
    expect(result).toHaveLength(2)
    expect(result[0].role).toBe('system')
    expect(result[1].role).toBe('user')
    expect(result[1].content).toContain('start of the session')
  })

  it('returns alternating user/assistant for history', () => {
    const history: SessionMessage[] = [
      makeMessage({ id: '1', speaker: 'therapist', content: 'Hello, how are you?' }),
      makeMessage({ id: '2', speaker: 'user', content: 'Not great' }),
      makeMessage({ id: '3', speaker: 'therapist', content: 'Tell me more' }),
      makeMessage({ id: '4', speaker: 'user', content: 'I feel lost' }),
    ]
    const result = buildTherapistMessages(history, { phase: 'deepening' })
    expect(result).toHaveLength(5) // system + 4 history
    expect(result[0].role).toBe('system')
    expect(result[1].role).toBe('assistant') // therapist -> assistant
    expect(result[2].role).toBe('user')
    expect(result[3].role).toBe('assistant')
    expect(result[4].role).toBe('user')
  })

  it('appends synthetic user message when history ends with therapist', () => {
    const history: SessionMessage[] = [
      makeMessage({ id: '1', speaker: 'user', content: 'Hello' }),
      makeMessage({ id: '2', speaker: 'therapist', content: 'Welcome.' }),
    ]
    const result = buildTherapistMessages(history, { phase: 'closing' })
    expect(result).toHaveLength(4) // system + 2 history + synthetic user
    expect(result[result.length - 1].role).toBe('user')
    expect(result[result.length - 1].content).toContain('closing reflection')
  })
})

describe('buildTherapistSessionNotePrompt', () => {
  it('builds transcript with Companion labels', () => {
    const history: SessionMessage[] = [
      makeMessage({ id: '1', speaker: 'therapist', content: 'Hello' }),
      makeMessage({ id: '2', speaker: 'user', content: 'Hi there' }),
    ]
    const result = buildTherapistSessionNotePrompt(history)
    expect(result).toHaveLength(2)
    expect(result[1].content).toContain('Companion: Hello')
    expect(result[1].content).toContain('Writer: Hi there')
  })
})

describe('buildSessionReflectionPrompt', () => {
  it('builds reflection prompt with transcript and parts', () => {
    const profile: UserProfile = {
      id: 'current',
      recurringThemes: ['isolation'],
      emotionalPatterns: [],
      avoidancePatterns: [],
      growthSignals: [],
      innerLandscape: '',
      lastUpdated: Date.now(),
    }
    const summaries: EntrySummary[] = [
      { id: 's1', entryId: 'e1', themes: ['loss'], emotionalArc: 'sad to hopeful', keyMoments: [], timestamp: Date.now() },
    ]
    const parts = [
      { id: 'open', name: 'The Open', ifsRole: 'self' },
      { id: 'weaver', name: 'The Weaver', ifsRole: 'manager' },
    ]
    const result = buildSessionReflectionPrompt('Writer: hello\nCompanion: hello', profile, summaries, parts)
    expect(result).toHaveLength(2)
    expect(result[0].content).toContain('The Open')
    expect(result[0].content).toContain('isolation')
    expect(result[1].content).toContain('Writer: hello')
  })
})
