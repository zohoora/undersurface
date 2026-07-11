import { describe, expect, it } from 'vitest'
import { CONDUCTOR_SHADOW_FLOOR, planAdaptiveConductor } from './adaptiveConductor'
import type { PersonalProtocol, ResearchEvent, Session, SessionMessage } from '../types'

const session = (overrides: Partial<Session> = {}): Session => ({
  id: 'session-1', startedAt: 1, endedAt: null, status: 'active', hostPartId: 'therapist',
  participantPartIds: [], openingMethod: 'open_invitation', sessionNote: null, messageCount: 4,
  firstLine: 'start', phase: 'deepening', memoryAperture: 'pattern',
  researchContext: { state: 'open', capacity: 'few_minutes', need: 'witness', capturedAt: 2 },
  ...overrides,
})

const messages = (text = 'I keep thinking about what happened and I want to understand it.', lastId = 'u2'): SessionMessage[] => [
  { id: 'u1', speaker: 'user', partId: null, partName: null, content: 'A first turn', timestamp: 1, phase: 'opening', isEmergence: false },
  { id: 'a1', speaker: 'therapist', partId: null, partName: null, content: 'I am here.', timestamp: 2, phase: 'opening', isEmergence: false },
  { id: lastId, speaker: 'user', partId: null, partName: null, content: text, timestamp: 3, phase: 'deepening', isEmergence: false },
]

const shadowHistory = (count = CONDUCTOR_SHADOW_FLOOR): ResearchEvent[] => Array.from({ length: count }, (_, index) => ({
  id: `conductor-old-${index}`, protocolId: 'adaptive-conductor-v1', protocolVersion: 1,
  assignmentKind: 'observational', status: 'shadow', source: 'talk', sessionId: `old-${index}`,
  eligibilityPoint: 'user-turn-2', assignmentSeed: `seed-${index}`, assignedArm: 'witness',
  responseMode: 'witness', provider: 'openai', deliveryFidelity: 'prompt_assigned',
  promptVersion: 'adaptive-conductor-v1', appVersion: 'test', createdAt: index + 1, updatedAt: index + 1,
}))

const options = { availableSurfaces: ['talk', 'journal', 'speak', 'relax', 'drift'] as const }

describe('adaptive conductor', () => {
  it('suppresses every decision during grounding and Fresh eyes', () => {
    expect(planAdaptiveConductor(session(), messages(), { ...options, grounding: true })).toBeNull()
    expect(planAdaptiveConductor(session({ memoryAperture: 'fresh' }), messages(), options)).toBeNull()
  })

  it('does not orchestrate the opening user turn', () => {
    expect(planAdaptiveConductor(session(), messages().slice(0, 2), options)).toBeNull()
  })

  it('keeps the initial calibration decisions in shadow mode with no assignment', () => {
    const plan = planAdaptiveConductor(session(), messages(), options)
    expect(plan?.event.status).toBe('shadow')
    expect(plan?.event.assignmentKind).toBe('observational')
    expect(plan?.assignment).toBeNull()
    expect(plan?.event.conductorDecision?.shadowDecisionsBefore).toBe(0)
  })

  it('ranks an explicit wish to write as a Journal arc and stores no message text', () => {
    const plan = planAdaptiveConductor(session(), messages('I need to write this privately in a journal.'), options)
    expect(plan?.event.conductorDecision?.candidates[0].arm).toBe('journal_arc')
    expect(plan?.event.conductorDecision?.candidates[0].reasons).toContain('explicit_writing')
    expect(JSON.stringify(plan?.event)).not.toContain('write this privately')
  })

  it('never ranks a surface that is not actually available', () => {
    const plan = planAdaptiveConductor(
      session({ researchContext: { state: 'stirred', capacity: 'few_minutes', need: 'settle', capturedAt: 2 } }),
      messages('My chest feels tense and I need to calm down.'),
      { availableSurfaces: ['talk', 'journal'] },
    )
    const arms = plan?.event.conductorDecision?.candidates.map(candidate => candidate.arm) ?? []
    expect(arms).not.toContain('drift_arc')
    expect(arms).not.toContain('relax_arc')
  })

  it('can move into a sparse randomized live comparison after the shadow floor', () => {
    const plan = planAdaptiveConductor(session(), messages(), {
      ...options,
      recentEvents: shadowHistory(),
      forcePhase: 'live',
    })
    expect(plan?.event.status).toBe('assigned')
    expect(plan?.event.assignmentKind).toBe('randomized')
    expect(plan?.assignment).not.toBeNull()
  })

  it('produces a deterministic decision for the same stored seed', () => {
    const args = { ...options, recentEvents: shadowHistory(), forcePhase: 'live' as const }
    const first = planAdaptiveConductor(session(), messages('I need to write this privately.', 'stable-id'), args)
    const second = planAdaptiveConductor(session(), messages('I need to write this privately.', 'stable-id'), args)
    expect(second?.event.assignedArm).toBe(first?.event.assignedArm)
    expect(second?.event.assignmentSeed).toBe(first?.event.assignmentSeed)
  })

  it('does not stack with a conductor move on the previous companion turn', () => {
    const rows = messages()
    rows[1] = { ...rows[1], researchEventId: 'conductor-previous', researchArm: 'journal_arc' }
    expect(planAdaptiveConductor(session(), rows, { ...options, recentEvents: shadowHistory() })).toBeNull()
  })

  it('allows at most one live conductor move and two total decisions per session', () => {
    const delivered = { ...shadowHistory(1)[0], id: 'conductor-live', sessionId: 'session-1', status: 'delivered' as const }
    expect(planAdaptiveConductor(session(), messages(), { ...options, recentEvents: [...shadowHistory(), delivered] })).toBeNull()
    const twoShadows = shadowHistory(2).map((event, index) => ({ ...event, sessionId: 'session-1', id: `conductor-current-${index}` }))
    expect(planAdaptiveConductor(session(), messages(), { ...options, recentEvents: twoShadows })).toBeNull()
  })

  it('turns a graduated protocol into lighter self-led candidates', () => {
    const protocol: PersonalProtocol = {
      id: 'p1', findingKey: 'f1', title: 'Find my own next sentence', protocolId: 'response-grammar-v1',
      preferredArm: 'reflect', context: { state: 'open', capacity: 'few_minutes', need: 'witness' },
      evidenceEventIds: ['e1'], confidence: 'repeated', status: 'active', transferStatus: 'graduated',
      transferLevel: 'independent', createdAt: 1, updatedAt: 2,
    }
    const plan = planAdaptiveConductor(session(), messages(), { ...options, protocols: [protocol] })
    const fading = plan?.event.conductorDecision?.candidates.filter(candidate => candidate.reasons.includes('transfer_fading')) ?? []
    expect(fading.map(candidate => candidate.arm)).toEqual(expect.arrayContaining(['user_first', 'offer_quiet']))
  })

  it('leaves an active Transfer Ladder comparison in shadow so the ladder keeps authority', () => {
    const protocol: PersonalProtocol = {
      id: 'p1', findingKey: 'f1', title: 'A concise reflection', protocolId: 'response-grammar-v1',
      preferredArm: 'reflect', context: { state: 'open', capacity: 'few_minutes', need: 'witness' },
      evidenceEventIds: ['e1'], confidence: 'emerging', status: 'active', transferStatus: 'learning',
      transferLevel: 'companion_led', createdAt: 1, updatedAt: 2,
    }
    const plan = planAdaptiveConductor(session(), messages(), { ...options, protocols: [protocol], recentEvents: shadowHistory() })
    expect(plan?.event.status).toBe('shadow')
    expect(plan?.assignment).toBeNull()
  })
})
