import { describe, it, expect, vi } from 'vitest'

// Mock i18n (some downstream imports need it)
vi.mock('../i18n', () => ({
  getLanguageCode: vi.fn(() => 'en'),
  getLLMLanguageName: vi.fn(() => 'English'),
}))

import { buildTherapistMessages, buildTherapistSystemPrompt } from '../ai/therapistPrompts'
import { SessionOrchestrator, detectCrisisKeywords } from './sessionOrchestrator'
import type { Session, SessionMessage, SessionMode } from '../types'

/**
 * End-to-end integration tests for the Real Talk mode pipeline.
 *
 * These don't render UI — instead they reproduce the exact call sequence
 * SessionView uses (orchestrator → prompt builder) and verify the right
 * persona reaches the LLM at each branch point.
 *
 * The most important guarantee is the grounding override: a Real Talk
 * session that activates grounding (via crisis keyword or LLM emotion check)
 * must NOT use the calling-out persona. Naming coping patterns is exactly
 * the wrong response to distress.
 */

function makeSession(mode: SessionMode = 'standard'): Session {
  return {
    id: 'sess-1',
    startedAt: Date.now(),
    endedAt: null,
    status: 'active',
    hostPartId: 'therapist',
    participantPartIds: [],
    openingMethod: 'auto',
    sessionNote: null,
    messageCount: 0,
    firstLine: '',
    phase: 'opening',
    favorited: false,
    mode,
  }
}

function makeMessage(speaker: SessionMessage['speaker'], content: string): SessionMessage {
  return {
    id: `msg-${Math.random()}`,
    speaker,
    partId: null,
    partName: null,
    content,
    timestamp: Date.now(),
    phase: 'deepening',
    isEmergence: false,
  }
}

describe('Real Talk end-to-end flow', () => {
  it('standard session generates the warm therapist persona', () => {
    const session = makeSession('standard')
    const orchestrator = new SessionOrchestrator()
    const history: SessionMessage[] = [
      makeMessage('user', 'Whatever, work was fine.'),
      makeMessage('therapist', 'Mm.'),
      makeMessage('user', 'I told my dad I was busy. Whatever.'),
    ]

    const phase = orchestrator.detectPhase(history)
    const messages = buildTherapistMessages(history, {
      phase,
      isGrounding: false,
      mode: session.mode,
    })

    const systemPrompt = messages[0].content
    expect(systemPrompt).toContain('IFS-informed conversational companion')
    expect(systemPrompt).not.toContain('honest, observational companion')
  })

  it('Real Talk session generates the calling-out persona', () => {
    const session = makeSession('real_talk')
    const orchestrator = new SessionOrchestrator()
    const history: SessionMessage[] = [
      makeMessage('user', 'Whatever, work was fine.'),
      makeMessage('therapist', 'Mm.'),
      makeMessage('user', 'I told my dad I was busy. Whatever.'),
    ]

    const phase = orchestrator.detectPhase(history)
    const messages = buildTherapistMessages(history, {
      phase,
      isGrounding: false,
      mode: session.mode,
    })

    const systemPrompt = messages[0].content
    expect(systemPrompt).toContain('honest, observational companion')
    expect(systemPrompt).not.toContain('IFS-informed conversational companion')

    // Pattern taxonomy must be present for the model to use the lens.
    expect(systemPrompt).toContain('Avoidance')
    expect(systemPrompt).toContain('Externalization')
    expect(systemPrompt).toContain('Minimization')
  })

  it('CRITICAL: crisis keyword in Real Talk session reverts to warm persona', () => {
    // The most important behavioral guarantee in the whole feature: distress
    // overrides the user's mode choice. Tests both halves of the chain —
    // crisis detection AND the prompt builder's response to isGrounding=true.
    const session = makeSession('real_talk')

    expect(detectCrisisKeywords('I want to die')).toBe(true)

    const systemPrompt = buildTherapistSystemPrompt({
      phase: 'deepening',
      isGrounding: true,
      mode: session.mode,
    })

    expect(systemPrompt).toContain('IFS-informed conversational companion')
    expect(systemPrompt).not.toContain('honest, observational companion')
    expect(systemPrompt).not.toContain('HOW YOU CALL THINGS OUT')
    expect(systemPrompt).toContain('distress')
    expect(systemPrompt).toContain('gentle')
    expect(systemPrompt).toContain('SAFETY — THIS OVERRIDES ALL OTHER INSTRUCTIONS')
  })

  it('Real Talk session at every phase preserves the persona swap', () => {
    const session = makeSession('real_talk')

    for (const phase of ['opening', 'deepening', 'closing'] as const) {
      const prompt = buildTherapistSystemPrompt({
        phase,
        mode: session.mode,
        isGrounding: false,
      })
      expect(prompt, `phase=${phase}`).toContain('honest, observational companion')
    }
  })

  it('legacy session without mode field is treated as standard', () => {
    // Backward compat — sessions created before the mode field shipped have
    // no mode set. They must use the warm therapist core, not crash.
    const legacySession = makeSession()
    delete legacySession.mode // simulate legacy doc shape

    const prompt = buildTherapistSystemPrompt({
      phase: 'deepening',
      mode: legacySession.mode, // undefined
    })

    expect(prompt).toContain('IFS-informed conversational companion')
    expect(prompt).not.toContain('honest, observational companion')
  })

  it('Real Talk + grounding via emotion check still falls back', () => {
    // Same override applies whether grounding came from the synchronous
    // crisis keyword check or the async LLM emotion check.
    const prompt = buildTherapistSystemPrompt({
      phase: 'deepening',
      mode: 'real_talk',
      isGrounding: true,
      currentEmotion: 'overwhelmed',
    })

    expect(prompt).toContain('IFS-informed conversational companion')
    expect(prompt).toContain('current emotional tone seems: overwhelmed')
    expect(prompt).not.toContain('honest, observational companion')
  })

  it('Real Talk preserves all context blocks (memory, profile, register)', () => {
    const prompt = buildTherapistSystemPrompt({
      phase: 'deepening',
      mode: 'real_talk',
      profile: {
        id: 'current',
        recurringThemes: ['conflict avoidance'],
        emotionalPatterns: [],
        avoidancePatterns: ['shifts to logistics when feelings rise'],
        growthSignals: [],
        innerLandscape: '',
        lastUpdated: Date.now(),
      },
      registerTier: 'plain',
    })

    // Real Talk persona AND user-specific context AND register tier.
    expect(prompt).toContain('honest, observational companion')
    expect(prompt).toContain('conflict avoidance')
    expect(prompt).toContain('shifts to logistics when feelings rise')
    expect(prompt).toContain('Short, simple words') // plain tier marker
  })
})
