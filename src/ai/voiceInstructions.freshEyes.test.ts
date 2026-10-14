import { describe, expect, it, vi } from 'vitest'
import type { TherapistContext } from '../engine/sessionContextLoader'
import type { Session, SessionMessage } from '../types'

// Uses the REAL therapist prompt builder: the memory-aperture filtering that
// keeps past sessions out of Fresh eyes lives there.
vi.mock('../store/db', () => ({ db: { companionSignals: { update: vi.fn(async () => {}) } } }))

const { buildVoiceCompanionInstructions } = await import('./voiceInstructions')

const context = {
  recentSessionNotes: [{ note: 'EARLIER_SESSION_FACT: the move to Lisbon fell through.', date: Date.now() - 86_400_000 }],
  relevantMemories: [],
  userProfile: null,
  personalFacts: null,
  recentRelaxBreaks: [],
} as unknown as TherapistContext

const current: SessionMessage[] = [
  { id: 'a1', speaker: 'therapist', partId: null, partName: null, content: 'What is here today?', timestamp: 1, phase: 'opening', isEmergence: false, surface: 'talk' },
  { id: 'u1', speaker: 'user', partId: null, partName: null, content: 'CURRENT_SESSION_FACT: my dog Pepper is sick.', timestamp: 2, phase: 'opening', isEmergence: false, surface: 'talk' },
]

const session = (memoryAperture: Session['memoryAperture']) => ({
  id: 's', startedAt: 1, status: 'active', phase: 'opening', mode: 'standard', memoryAperture,
}) as Session

describe('voice continuity across a change of medium', () => {
  it('Speak/Room instructions carry the current session in Pattern mode', () => {
    const { instructions } = buildVoiceCompanionInstructions({ context, session: session('pattern'), messages: current, grounded: false, features: null })
    expect(instructions).toContain('CURRENT_SESSION_FACT')
    expect(instructions).toContain('EARLIER_SESSION_FACT')
  })

  it('Fresh eyes keeps within-session continuity but no earlier-session material', () => {
    const { instructions } = buildVoiceCompanionInstructions({ context, session: session('fresh'), messages: current, grounded: false, features: null })
    expect(instructions).toContain('CURRENT_SESSION_FACT')
    expect(instructions).not.toContain('EARLIER_SESSION_FACT')
  })

  it('stays well inside the 48k Realtime instruction cap with a long session', () => {
    const long = Array.from({ length: 200 }, (_, index) => ({
      ...current[1], id: `u${index}`, content: `${'words '.repeat(300)}${index}`,
    }))
    const { instructions } = buildVoiceCompanionInstructions({ context, session: session('pattern'), messages: long, grounded: false, features: null })
    expect(instructions.length).toBeLessThan(48_000)
  })
})
