import { describe, expect, it } from 'vitest'
import { buildExperimentDirective, deriveHalfLifeEvidence, deriveResearchFindings, deriveTransferEvidence, planResearchTurn, validateResearchDelivery } from './personalScience'
import type { CompanionPreferences, InterventionOutcome, PersonalProtocol, ResearchEvent, Session, SessionMessage, TransferLevel } from '../types'

const preferences: CompanionPreferences = {
  id: 'current',
  fieldMosaicEnabled: true,
  outcomeSampling: 'light',
  personalScienceEnabled: true,
  personalScienceConsentAt: 1,
  updatedAt: 1,
}

const session: Session = {
  id: 's1', startedAt: 1, endedAt: null, status: 'active', hostPartId: 'therapist',
  participantPartIds: [], openingMethod: 'auto', sessionNote: null, messageCount: 3,
  firstLine: 'hello', phase: 'exploration',
  researchContext: { state: 'looping', capacity: 'few_minutes', need: 'perspective', capturedAt: 2 },
}

const messages: SessionMessage[] = [
  { id: 'u1', speaker: 'user', partId: null, partName: null, content: 'first', timestamp: 1, phase: 'opening', isEmergence: false },
  { id: 'a1', speaker: 'therapist', partId: null, partName: null, content: 'here', timestamp: 2, phase: 'opening', isEmergence: false },
  { id: 'u2', speaker: 'user', partId: null, partName: null, content: 'again', timestamp: 3, phase: 'exploration', isEmergence: false },
]

describe('personal science assignment', () => {
  it('is deterministic, versioned, and stores no message content', () => {
    const first = planResearchTurn(session, messages, preferences, { forceEligible: true, now: 100 })
    const second = planResearchTurn(session, messages, preferences, { forceEligible: true, now: 100 })
    expect(first).toEqual(second)
    expect(first?.event).toMatchObject({
      id: 'research-u2',
      assignmentKind: 'randomized',
      status: 'assigned',
      protocolVersion: 1,
      promptVersion: 'personal-science-v2',
    })
    expect(JSON.stringify(first)).not.toContain('again')
  })

  it('never assigns during grounding, Fresh eyes, without opt-in, after a skipped handshake, or on consecutive research turns', () => {
    expect(planResearchTurn(session, messages, preferences, { forceEligible: true, grounding: true })).toBeNull()
    expect(planResearchTurn({ ...session, memoryAperture: 'fresh' }, messages, preferences, { forceEligible: true })).toBeNull()
    expect(planResearchTurn(session, messages, { ...preferences, personalScienceEnabled: false }, { forceEligible: true })).toBeNull()
    expect(planResearchTurn({ ...session, researchContext: { capturedAt: 1, skipped: true } }, messages, preferences, { forceEligible: true })).toBeNull()
    expect(planResearchTurn(session, [
      ...messages.slice(0, -1),
      { ...messages[1], id: 'a-research', researchEventId: 'r1' },
      messages.at(-1)!,
    ], preferences, { forceEligible: true })).toBeNull()
  })

  it('builds a bounded directive without exposing it to the writer', () => {
    expect(buildExperimentDirective('make_concrete')).toContain('single primary response move')
    expect(buildExperimentDirective('make_concrete')).toContain('without naming it')
    expect(buildExperimentDirective('designed_silence')).toBeUndefined()
  })

  it('reuses a writer-approved matching protocol without calling it randomized evidence', () => {
    const assignment = planResearchTurn(session, messages, {
      ...preferences,
      protocolPolicy: 'use_what_helped',
    }, {
      forceEligible: true,
      protocols: [{
        id: 'p1', findingKey: 'f1', title: 'Quiet first', protocolId: 'subtraction-v1',
        preferredArm: 'designed_silence',
        context: { state: 'looping', capacity: 'few_minutes', need: 'perspective' },
        evidenceEventIds: ['old'], confidence: 'early', status: 'active', createdAt: 1, updatedAt: 1,
      }],
    })
    expect(assignment?.event.assignmentKind).toBe('personalized')
    expect(assignment?.event.assignedArm).toBe('designed_silence')
  })

  it('prioritizes an explicitly enrolled transfer ladder and compares only adjacent rungs', () => {
    const protocol: PersonalProtocol = {
      id: 'p-transfer', findingKey: 'f-transfer', title: 'Find one concrete scene',
      protocolId: 'response-grammar-v1', preferredArm: 'make_concrete',
      context: { state: 'looping', capacity: 'few_minutes', need: 'perspective' },
      evidenceEventIds: ['old'], confidence: 'emerging', status: 'active',
      transferStatus: 'learning', transferLevel: 'user_first', createdAt: 1, updatedAt: 1,
    }
    const first = planResearchTurn(session, messages, preferences, { forceEligible: true, now: 100, protocols: [protocol] })
    const retry = planResearchTurn(session, messages, preferences, { forceEligible: true, now: 100, protocols: [protocol] })
    expect(first).toEqual(retry)
    expect(first?.event).toMatchObject({
      protocolId: 'transfer-ladder-v1',
      personalProtocolId: 'p-transfer',
      assignmentKind: 'randomized',
    })
    expect(['transfer_user_first', 'transfer_minimal_cue']).toContain(first?.event.assignedArm)
    expect(['user_first', 'minimal_cue']).toContain(first?.event.transferLevel)
  })

  it('keeps fixed lighter rungs deterministic and companion-led practice prompt-assigned', () => {
    expect(buildExperimentDirective('transfer_user_first', 'make_concrete')).toBeUndefined()
    expect(buildExperimentDirective('transfer_companion_led', 'make_concrete')).toContain('perform make_concrete')
  })

  it('compares one interpretation with a prism only for perspective-seeking moments', () => {
    let prismAssignment: ReturnType<typeof planResearchTurn> = null
    const observedArms = new Set<string>()
    for (let index = 0; index < 240; index++) {
      const candidate = planResearchTurn(session, [
        ...messages.slice(0, -1),
        { ...messages.at(-1)!, id: `perspective-${index}` },
      ], preferences, { forceEligible: true, now: 100 })
      if (candidate?.event.protocolId === 'ambiguity-prism-v1') {
        prismAssignment ??= candidate
        observedArms.add(candidate.event.assignedArm)
      }
    }
    expect(prismAssignment?.event.assignedArm).toMatch(/^(single_hypothesis|ambiguity_prism)$/)
    expect(observedArms).toEqual(new Set(['single_hypothesis', 'ambiguity_prism']))
    expect(prismAssignment?.directive).toContain('AMBIGUITY')
    const actionSession = { ...session, researchContext: { ...session.researchContext!, need: 'action' as const } }
    for (let index = 0; index < 20; index++) {
      const candidate = planResearchTurn(actionSession, [
        ...messages.slice(0, -1),
        { ...messages.at(-1)!, id: `action-${index}` },
      ], preferences, { forceEligible: true })
      expect(candidate?.event.protocolId).not.toBe('ambiguity-prism-v1')
    }
  })

  it('counts a prism as delivered only when all three finalized markers survived', () => {
    const base = planResearchTurn(session, messages, preferences, { forceEligible: true, now: 100 })!
    const assignment = {
      ...base,
      event: { ...base.event, protocolId: 'ambiguity-prism-v1' as const, assignedArm: 'ambiguity_prism' as const },
    }
    expect(validateResearchDelivery(assignment, 'Only prose.')).toEqual({
      delivered: false, reason: 'prism_marker_contract_failed',
    })
    expect(validateResearchDelivery(assignment, '[A.](#prism:h1)\n[B.](#prism:h2)\n[C.](#prism:h3)')).toEqual({ delivered: true })
  })

  it('does not turn a graduated writer-owned capacity back into a full personalized intervention', () => {
    const assignment = planResearchTurn(session, messages, { ...preferences, protocolPolicy: 'use_what_helped' }, {
      forceEligible: true,
      protocols: [{
        id: 'graduated', findingKey: 'g', title: 'Concrete first', protocolId: 'response-grammar-v1',
        preferredArm: 'make_concrete', evidenceEventIds: ['old'], confidence: 'emerging', status: 'active',
        transferStatus: 'graduated', transferLevel: 'independent', createdAt: 1, updatedAt: 1,
      }],
    })
    expect(assignment?.event.assignmentKind).toBe('randomized')
    expect(assignment?.event.personalProtocolId).toBeUndefined()
  })
})

function event(id: string, arm: ResearchEvent['assignedArm']): ResearchEvent {
  return {
    id,
    protocolId: 'subtraction-v1',
    protocolVersion: 1,
    assignmentKind: 'randomized',
    status: 'delivered',
    source: 'talk',
    sessionId: 's1',
    sourceId: `m-${id}`,
    eligibilityPoint: id,
    assignmentSeed: id,
    assignedArm: arm,
    deliveredArm: arm,
    context: { state: 'looping', capacity: 'few_minutes', need: 'perspective' },
    provider: arm === 'designed_silence' ? 'deterministic' : 'openai',
    promptVersion: 'personal-science-v1',
    appVersion: 'test',
    createdAt: 1,
    updatedAt: 1,
  }
}

function outcome(id: string, immediate: InterventionOutcome['immediate']): InterventionOutcome {
  return {
    id: `o-${id}`, source: 'talk', sourceId: `m-${id}`, intervention: 'reflect',
    immediate, researchEventId: id, createdAt: 1, updatedAt: 1,
  }
}

describe('personal science findings', () => {
  it('derives a tentative comparison only from rated, delivered randomized events with at least two arms', () => {
    const events = [event('r1', 'designed_silence'), event('r2', 'designed_silence'), event('r3', 'generated_response')]
    const outcomes = [outcome('r1', 'helped'), outcome('r2', 'helped'), outcome('r3', 'worse')]
    const findings = deriveResearchFindings(events, outcomes)
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({ preferredArm: 'designed_silence', confidence: 'early', ratedEvents: 3, helpedCount: 2 })
  })

  it('excludes observational, overridden, unrated, and writer-reviewed groups', () => {
    const base = [event('r1', 'designed_silence'), event('r2', 'designed_silence'), event('r3', 'generated_response')]
    const outcomes = [outcome('r1', 'helped'), outcome('r2', 'helped'), outcome('r3', 'worse')]
    expect(deriveResearchFindings([{ ...base[0], assignmentKind: 'observational' }, ...base.slice(1)], outcomes)).toHaveLength(0)
    expect(deriveResearchFindings([{ ...base[0], status: 'overridden' }, ...base.slice(1)], outcomes)).toHaveLength(0)
    expect(deriveResearchFindings(base, outcomes.slice(0, 2))).toHaveLength(0)
    const finding = deriveResearchFindings(base, outcomes)[0]
    expect(deriveResearchFindings(base, outcomes, [{ findingKey: finding.id } as never])).toHaveLength(0)
  })
})

function transferEvent(id: string, level: TransferLevel): ResearchEvent {
  return {
    ...event(id, `transfer_${level}` as ResearchEvent['assignedArm']),
    protocolId: 'transfer-ladder-v1',
    personalProtocolId: 'p1',
    transferLevel: level,
  }
}

function transferOutcome(
  id: string,
  immediate: InterventionOutcome['immediate'],
  agency: InterventionOutcome['agency'],
  delayed?: InterventionOutcome['delayed'],
): InterventionOutcome {
  return { ...outcome(id, immediate), agency, ...(delayed ? { delayed } : {}) }
}

const transferProtocol: PersonalProtocol = {
  id: 'p1', findingKey: 'f1', title: 'Concrete first', protocolId: 'response-grammar-v1',
  preferredArm: 'make_concrete', evidenceEventIds: ['seed'], confidence: 'emerging',
  status: 'active', transferStatus: 'learning', transferLevel: 'companion_led',
  createdAt: 1, updatedAt: 1,
}

describe('transfer ladder evidence', () => {
  it('recommends a lighter rung only after balanced rated evidence preserves benefit and increases agency', () => {
    const events = [
      transferEvent('c1', 'companion_led'), transferEvent('c2', 'companion_led'), transferEvent('c3', 'companion_led'),
      transferEvent('u1', 'user_first'), transferEvent('u2', 'user_first'), transferEvent('u3', 'user_first'),
    ]
    const outcomes = [
      transferOutcome('c1', 'helped', 'same'), transferOutcome('c2', 'helped', 'same'), transferOutcome('c3', 'nothing', 'same'),
      transferOutcome('u1', 'helped', 'more', 'used'), transferOutcome('u2', 'helped', 'more'), transferOutcome('u3', 'nothing', 'same'),
    ]
    expect(deriveTransferEvidence(transferProtocol, events, outcomes)).toMatchObject({
      status: 'ready', ratedEvents: 6, currentSamples: 3, nextSamples: 3, nextAgencyMore: 2,
    })
  })

  it('holds advancement when the lighter rung has regret or negative outcomes', () => {
    const events = [
      transferEvent('c1', 'companion_led'), transferEvent('c2', 'companion_led'), transferEvent('c3', 'companion_led'),
      transferEvent('u1', 'user_first'), transferEvent('u2', 'user_first'), transferEvent('u3', 'user_first'),
    ]
    const outcomes = [
      transferOutcome('c1', 'helped', 'same'), transferOutcome('c2', 'helped', 'same'), transferOutcome('c3', 'helped', 'same'),
      transferOutcome('u1', 'worse', 'less', 'regret'), transferOutcome('u2', 'worse', 'less'), transferOutcome('u3', 'nothing', 'same'),
    ]
    expect(deriveTransferEvidence(transferProtocol, events, outcomes).status).toBe('hold')
  })

  it('never treats transfer events as new preferred-move findings', () => {
    const events = [transferEvent('c1', 'companion_led'), transferEvent('c2', 'companion_led'), transferEvent('u1', 'user_first')]
    const outcomes = [transferOutcome('c1', 'helped', 'same'), transferOutcome('c2', 'helped', 'same'), transferOutcome('u1', 'worse', 'less')]
    expect(deriveResearchFindings(events, outcomes)).toEqual([])
  })
})

describe('intervention half-life evidence', () => {
  const protocol = { ...transferProtocol, transferStatus: undefined, evidenceEventIds: ['h1', 'h2', 'h3'] }
  const events = [event('h1', 'reflect'), event('h2', 'reflect'), event('h3', 'reflect')]
  const withHorizon = (
    id: string,
    horizonOutcomes: NonNullable<InterventionOutcome['horizonOutcomes']>,
  ): InterventionOutcome => ({ ...outcome(id, 'helped'), horizonOutcomes })

  it('calls evidence carried only after two useful next-day reports and no regret', () => {
    const outcomes = [
      withHorizon('h1', [{ horizon: 'next_day', outcome: 'used', reportedAt: 10 }]),
      withHorizon('h2', [{ horizon: 'next_day', outcome: 'stayed', reportedAt: 10 }]),
      withHorizon('h3', [{ horizon: 'later_today', outcome: 'used', reportedAt: 10 }]),
    ]
    expect(deriveHalfLifeEvidence(protocol, events, outcomes)).toMatchObject({
      status: 'carried', nextDayReports: 2, nextDayUseful: 2, regretCount: 0,
    })
  })

  it('distinguishes an early lift that faded by the next day', () => {
    const outcomes = [
      withHorizon('h1', [{ horizon: 'later_today', outcome: 'used', reportedAt: 10 }]),
      withHorizon('h2', [{ horizon: 'next_day', outcome: 'nothing', reportedAt: 10 }]),
      withHorizon('h3', [{ horizon: 'next_day', outcome: 'changed_mind', reportedAt: 10 }]),
    ]
    expect(deriveHalfLifeEvidence(protocol, events, outcomes).status).toBe('faded')
  })

  it('keeps sparse and regretted evidence conservative', () => {
    expect(deriveHalfLifeEvidence(protocol, events, [
      withHorizon('h1', [{ horizon: 'next_day', outcome: 'used', reportedAt: 10 }]),
    ]).status).toBe('early')
    expect(deriveHalfLifeEvidence(protocol, events, [
      withHorizon('h1', [{ horizon: 'next_day', outcome: 'used', reportedAt: 10 }]),
      withHorizon('h2', [{ horizon: 'next_day', outcome: 'stayed', reportedAt: 10 }]),
      withHorizon('h3', [{ horizon: 'later_today', outcome: 'regret', reportedAt: 10 }]),
    ]).status).toBe('mixed')
  })
})
