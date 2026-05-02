import { describe, it, expect, vi } from 'vitest'

vi.mock('../i18n', () => ({
  getLanguageCode: vi.fn(() => 'en'),
  getLLMLanguageName: vi.fn(() => 'English'),
}))

import { buildTherapistSystemPrompt, buildTherapistMessages, buildTherapistSessionNotePrompt, buildSessionReflectionPrompt } from './therapistPrompts'
import { REGISTER_TIER_IDS } from './registerTiers'
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

  it('includes HRV context when provided', () => {
    const prompt = buildTherapistSystemPrompt({
      phase: 'deepening',
      hrvContext: '[Biometric context]\nCurrent autonomic state: activated (trend: rising, 45s)\nHeart rate: 82 bpm',
    })
    expect(prompt).toContain('[Biometric context]')
    expect(prompt).toContain('autonomic state: activated')
    expect(prompt).toContain('Heart rate: 82 bpm')
    expect(prompt).toContain('biometric data as fact')
  })

  it('omits HRV section when no context provided', () => {
    const prompt = buildTherapistSystemPrompt({ phase: 'opening' })
    expect(prompt).not.toContain('[Biometric context]')
    expect(prompt).not.toContain('biometric')
  })

  describe('register integration', () => {
    it('defaults to conversational tier when registerTier omitted', () => {
      const prompt = buildTherapistSystemPrompt({ phase: 'opening' })
      expect(prompt).toContain('Plain warm talk')
      expect(prompt).toContain('18 words or fewer')
    })

    it('injects plain tier rules when registerTier=plain', () => {
      const prompt = buildTherapistSystemPrompt({ phase: 'opening', registerTier: 'plain' })
      expect(prompt).toContain('12 words or fewer')
      expect(prompt).toContain('profound') // plain-tier additional ban
    })

    it('injects scholarly tier rules when registerTier=scholarly', () => {
      const prompt = buildTherapistSystemPrompt({ phase: 'opening', registerTier: 'scholarly' })
      expect(prompt).toContain('abstract framing')
      expect(prompt).not.toMatch(/\bwords or fewer\b/) // scholarly has no cap
    })

    it('voice mode caps scholarly down to conversational in the rendered prompt', () => {
      const prompt = buildTherapistSystemPrompt({
        phase: 'opening',
        registerTier: 'scholarly',
        currentInputMode: 'voice',
      })
      expect(prompt).toContain('Plain warm talk')
      expect(prompt).not.toContain('abstract framing')
      expect(prompt).toContain('speaking aloud')
    })

    it('grounding caps literate down to conversational', () => {
      const prompt = buildTherapistSystemPrompt({
        phase: 'deepening',
        registerTier: 'literate',
        isGrounding: true,
      })
      expect(prompt).toContain('Plain warm talk')
      expect(prompt).not.toContain('Comfortable with longer sentences')
    })

    it('grounding does NOT raise plain up', () => {
      const prompt = buildTherapistSystemPrompt({
        phase: 'deepening',
        registerTier: 'plain',
        isGrounding: true,
      })
      expect(prompt).toContain('Short, simple words')
      expect(prompt).toContain('12 words or fewer')
    })

    it('therapy-jargon ban appears regardless of tier', () => {
      for (const tier of REGISTER_TIER_IDS) {
        const prompt = buildTherapistSystemPrompt({ phase: 'opening', registerTier: tier })
        expect(prompt).toContain('dysregulation')
        expect(prompt).toContain('somatic')
      }
    })

    // Regression guards: the hardcoded grade-6 line MUST stay deleted.
    // If a future tweak re-adds it, two competing voice directives will fight.
    it('does not contain the deleted hardcoded grade-6 line', () => {
      const prompt = buildTherapistSystemPrompt({ phase: 'opening' })
      expect(prompt).not.toContain('6th-grade')
      expect(prompt).not.toContain('grade reading level')
    })

    it('SAFETY_RULES block still appears verbatim', () => {
      const prompt = buildTherapistSystemPrompt({ phase: 'opening' })
      expect(prompt).toContain('SAFETY — THIS OVERRIDES ALL OTHER INSTRUCTIONS')
      expect(prompt).toContain('Watch for escalation through metaphor')
    })
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
    expect(result[1].content).toContain('Hi there')
  })

  it('keeps the user-role message under the 8000-char backend cap for very long sessions', () => {
    const history: SessionMessage[] = []
    for (let i = 0; i < 50; i++) {
      history.push(makeMessage({
        id: `m${i}`,
        speaker: i % 2 === 0 ? 'user' : 'therapist',
        content: 'X'.repeat(2000),
      }))
    }
    const result = buildTherapistSessionNotePrompt(history)
    const userMessage = result[1]
    expect(userMessage.role).toBe('user')
    // Backend rejects user messages over 8000 chars (functions/src/index.ts MAX_MESSAGE_CHARS)
    expect(userMessage.content.length).toBeLessThan(8000)
  })

  it('keeps recent turns and marks earlier ones as omitted when truncated', () => {
    const history: SessionMessage[] = []
    for (let i = 0; i < 40; i++) {
      history.push(makeMessage({
        id: `m${i}`,
        speaker: i % 2 === 0 ? 'user' : 'therapist',
        content: `turn-${i}-${'Y'.repeat(400)}`,
      }))
    }
    const userContent = buildTherapistSessionNotePrompt(history)[1].content
    expect(userContent).toContain('omitted')
    expect(userContent).toContain('turn-39-')
    expect(userContent).not.toContain('turn-0-')
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
    const result = buildSessionReflectionPrompt({
      transcript: 'Writer: hello\nCompanion: hello',
      profile,
      recentSummaries: summaries,
      parts,
      existingFacts: null,
    })
    expect(result).toHaveLength(2)
    expect(result[0].content).toContain('The Open')
    expect(result[0].content).toContain('isolation')
    expect(result[1].content).toContain('Writer: hello')
  })

  it('includes existing personal facts in the prompt for consolidation', () => {
    const facts: import('../types').PersonalFacts = {
      id: 'current',
      people: [{ name: 'Sarah', relationship: 'wife' }],
      dates: [{ event: 'anniversary', date: '2024-03-12' }],
      context: [],
      currentThreads: [{ topic: 'job interview Thursday', addedAt: 1000 }],
      lastUpdated: 1000,
    }
    const result = buildSessionReflectionPrompt({
      transcript: 'Writer: hi',
      profile: null,
      recentSummaries: [],
      parts: [],
      existingFacts: facts,
    })
    expect(result[0].content).toContain('Sarah')
    expect(result[0].content).toContain('anniversary')
    expect(result[0].content).toContain('job interview Thursday')
    expect(result[0].content).toContain('PERSONAL FACTS')
  })

  it('signals empty state when no existing facts', () => {
    const result = buildSessionReflectionPrompt({
      transcript: 'Writer: hi',
      profile: null,
      recentSummaries: [],
      parts: [],
      existingFacts: null,
    })
    expect(result[0].content).toContain('No personal facts captured yet')
  })
})

describe('buildTherapistSystemPrompt with personalFacts', () => {
  it('injects facts block when present', () => {
    const facts: import('../types').PersonalFacts = {
      id: 'current',
      people: [{ name: 'Sarah', relationship: 'wife', notes: 'loves hiking' }],
      dates: [{ event: 'anniversary', date: '2024-03-12' }],
      context: [{ category: 'location', value: 'Brooklyn' }],
      currentThreads: [{ topic: 'job interview Thursday', addedAt: 1000 }],
      lastUpdated: 1000,
    }
    const prompt = buildTherapistSystemPrompt({ phase: 'deepening', personalFacts: facts })
    expect(prompt).toContain('Sarah')
    expect(prompt).toContain('(wife)')
    expect(prompt).toContain('loves hiking')
    expect(prompt).toContain('anniversary')
    expect(prompt).toContain('Brooklyn')
    expect(prompt).toContain('job interview Thursday')
    expect(prompt).toContain('weave them in only when relevant')
  })

  it('omits facts block when all categories empty', () => {
    const facts: import('../types').PersonalFacts = {
      id: 'current',
      people: [],
      dates: [],
      context: [],
      currentThreads: [],
      lastUpdated: 1000,
    }
    const prompt = buildTherapistSystemPrompt({ phase: 'deepening', personalFacts: facts })
    expect(prompt).not.toContain('Concrete facts about this writer')
  })

  it('does nothing when personalFacts is null', () => {
    const prompt = buildTherapistSystemPrompt({ phase: 'deepening', personalFacts: null })
    expect(prompt).not.toContain('Concrete facts about this writer')
  })
})
