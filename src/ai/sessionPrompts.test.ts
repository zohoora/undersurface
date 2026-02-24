import { describe, it, expect, vi } from 'vitest'

vi.mock('../i18n', () => ({
  getLanguageCode: () => 'en',
  getLLMLanguageName: () => 'English',
}))

import { buildSessionMessages, SESSION_INSTRUCTIONS, buildSessionNotePrompt } from './sessionPrompts'
import type { Part, PartMemory, SessionMessage } from '../types'

const mockPart: Part = {
  id: 'watcher',
  name: 'The Watcher',
  color: '#5A7F94',
  colorLight: '#5A7F9425',
  ifsRole: 'protector',
  voiceDescription: 'Quiet, patient, observant.',
  concern: 'Avoidance patterns.',
  systemPrompt: 'You are The Watcher.',
  isSeeded: true,
  createdAt: Date.now(),
  memories: [],
}

describe('SESSION_INSTRUCTIONS', () => {
  it('contains key session-mode directives', () => {
    expect(SESSION_INSTRUCTIONS).toContain('sustained conversation')
    expect(SESSION_INSTRUCTIONS).toContain('1-3 sentences')
    expect(SESSION_INSTRUCTIONS).toContain('not a therapist')
    expect(SESSION_INSTRUCTIONS).not.toContain('5-25 words')
  })
})

describe('buildSessionMessages', () => {
  it('returns system and user messages', () => {
    const result = buildSessionMessages(mockPart, [], { phase: 'opening', memories: [] })
    expect(result.length).toBeGreaterThanOrEqual(2)
    expect(result[0].role).toBe('system')
  })

  it('includes conversation history in user message', () => {
    const history: SessionMessage[] = [
      { id: 'm1', speaker: 'part', partId: 'watcher', partName: 'The Watcher', content: 'Hello', timestamp: 1, phase: 'opening', isEmergence: false },
      { id: 'm2', speaker: 'user', partId: null, partName: null, content: 'Hi there', timestamp: 2, phase: 'opening', isEmergence: false },
    ]
    const result = buildSessionMessages(mockPart, history, { phase: 'opening', memories: [] })
    const userMsg = result.find(m => m.role === 'user')
    expect(userMsg?.content).toContain('Hello')
    expect(userMsg?.content).toContain('Hi there')
  })

  it('includes phase hint in system message', () => {
    const result = buildSessionMessages(mockPart, [], { phase: 'deepening', memories: [] })
    expect(result[0].content).toContain('deepening')
  })

  it('includes emergence context when provided', () => {
    const result = buildSessionMessages(mockPart, [], {
      phase: 'deepening', memories: [],
      emergenceContext: 'The writer expressed a contradiction.',
    })
    expect(result[0].content).toContain('contradiction')
  })

  it('includes other parts present', () => {
    const result = buildSessionMessages(mockPart, [], {
      phase: 'deepening', memories: [],
      otherParts: ['The Quiet One', 'The Spark'],
    })
    expect(result[0].content).toContain('The Quiet One')
  })

  it('includes user profile when provided', () => {
    const result = buildSessionMessages(mockPart, [], {
      phase: 'opening', memories: [],
      profile: { id: 'current', innerLandscape: 'Tends to intellectualize feelings', recurringThemes: [], emotionalPatterns: [], avoidancePatterns: [], growthSignals: [], lastUpdated: 0 },
    })
    expect(result[0].content).toContain('intellectualize')
  })

  it('includes recent entry context when provided', () => {
    const result = buildSessionMessages(mockPart, [], {
      phase: 'opening', memories: [],
      recentEntryContext: 'Wrote about a difficult conversation with their partner.',
    })
    const userMsg = result.find(m => m.role === 'user')
    expect(userMsg?.content).toContain('difficult conversation')
  })

  it('includes part voice and concern', () => {
    const result = buildSessionMessages(mockPart, [], { phase: 'opening', memories: [] })
    expect(result[0].content).toContain('Quiet, patient, observant')
    expect(result[0].content).toContain('Avoidance patterns')
  })

  it('includes memories', () => {
    const memories: PartMemory[] = [
      { id: 'm1', partId: 'watcher', entryId: '', content: 'Writer avoids talking about father', type: 'observation', timestamp: 1 },
    ]
    const result = buildSessionMessages(mockPart, [], { phase: 'opening', memories })
    expect(result[0].content).toContain('Writer avoids talking about father')
  })
})

describe('buildSessionNotePrompt', () => {
  it('includes transcript and part names', () => {
    const history: SessionMessage[] = [
      { id: 'm1', speaker: 'part', partId: 'watcher', partName: 'The Watcher', content: 'Hello', timestamp: 1, phase: 'opening', isEmergence: false },
      { id: 'm2', speaker: 'user', partId: null, partName: null, content: 'Hi', timestamp: 2, phase: 'opening', isEmergence: false },
    ]
    const result = buildSessionNotePrompt(history, ['The Watcher'])
    expect(result[1].content).toContain('The Watcher')
    expect(result[1].content).toContain('Hello')
    expect(result[1].content).toContain('Hi')
  })
})
