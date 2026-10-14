import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ResearchEvent, Session, SessionMessage } from '../types'
import type { TherapistContext } from './sessionContextLoader'

// P0 regression (TECH_ISSUES_2026-10-14 #1): a crisis turn must never be
// answered by a canned conductor/research message. These tests use the REAL
// grounding module so the "L1 fires during the awaited append" window is
// reproduced exactly as SessionView experiences it.

const planConductorMock = vi.hoisted(() => vi.fn())
const planResearchMock = vi.hoisted(() => vi.fn())
const persistMock = vi.hoisted(() => vi.fn(async () => {}))
const cancelMock = vi.hoisted(() => vi.fn(async () => {}))

vi.mock('./adaptiveConductor', () => ({ planAdaptiveConductor: planConductorMock }))
vi.mock('./personalScience', () => ({ planResearchTurn: planResearchMock }))
vi.mock('../store/personalScience', () => ({
  persistResearchAssignment: persistMock,
  markResearchCancelled: cancelMock,
}))
vi.mock('../services/diagnostics', () => ({ engineLog: vi.fn() }))
vi.mock('../store/globalConfig', () => ({ getGlobalConfig: () => null }))

const grounding = await import('../store/groundingState')
const { respondToUserTurn } = await import('./turnResponder')

function event(over: Partial<ResearchEvent> = {}): ResearchEvent {
  return {
    id: 'conductor-u2',
    protocolId: 'adaptive-conductor-v1',
    protocolVersion: 1,
    assignmentKind: 'randomized',
    status: 'assigned',
    source: 'talk',
    sessionId: 'sess-1',
    eligibilityPoint: 'user-turn-2',
    assignmentSeed: 'seed',
    assignedArm: 'room_arc',
    responseMode: 'handoff',
    provider: 'deterministic',
    promptVersion: 'adaptive-conductor-v1',
    appVersion: 'test',
    createdAt: 1,
    updatedAt: 1,
    ...over,
  } as ResearchEvent
}

const session: Session = {
  id: 'sess-1',
  startedAt: 1,
  endedAt: null,
  status: 'active',
  hostPartId: 'therapist',
  participantPartIds: [],
  openingMethod: 'auto',
  sessionNote: null,
  messageCount: 3,
  firstLine: 'x',
  phase: 'opening',
  favorited: false,
  mode: 'standard',
}

const messages: SessionMessage[] = [
  { id: 'a1', speaker: 'therapist', partId: null, partName: null, content: 'Hello.', timestamp: 1, phase: 'opening', isEmergence: false },
  { id: 'u1', speaker: 'user', partId: null, partName: null, content: 'My chest is tight.', timestamp: 2, phase: 'opening', isEmergence: false },
  { id: 'u2', speaker: 'user', partId: null, partName: null, content: 'crisis-level text', timestamp: 3, phase: 'opening', isEmergence: false },
]

function deps() {
  return {
    context: { recentConductorEvents: [], activePersonalProtocols: [], companionPreferences: null } as unknown as TherapistContext,
    availableSurfaces: ['talk', 'journal', 'room'] as const,
    copy: {
      conductorOffer: {
        journal_arc: 'journal offer',
        speak_arc: 'speak offer',
        relax_arc: 'relax offer',
        drift_arc: 'drift offer',
        room_arc: 'Your body may need a change of atmosphere. [Open Room](#switch:room-arc).',
      },
      journalOffer: 'Continue in Journal',
      transferUserFirst: 'user first',
      transferMinimalCue: 'minimal cue',
      transferIndependent: 'independent',
    },
    appendDeterministicCompanionMessage: vi.fn(async (content: string) => [...messages, { ...messages[0], id: 'det', content }]),
    generateTherapistMessage: vi.fn(async (current: SessionMessage[]) => [...current, { ...messages[0], id: 'model' }]),
  }
}

// The fixed offer exists only for a turn the planners consider ungrounded —
// exactly the planners' real contract.
function conductorPlansFixedOfferUnlessGrounded() {
  planConductorMock.mockImplementation((_s: Session, _m: SessionMessage[], options: { grounding?: boolean }) => (
    options.grounding
      ? null
      : { event: event(), assignment: { event: event(), delivery: 'fixed_surface_offer', responseMode: 'handoff' } }
  ))
}

beforeEach(() => {
  vi.clearAllMocks()
  if (grounding.isGroundingActive()) grounding.deactivateGrounding()
  grounding.clearAutoExitTimer()
  planResearchMock.mockReturnValue(null)
})

afterEach(() => {
  grounding.deactivateGrounding()
  grounding.clearAutoExitTimer()
})

describe('respondToUserTurn — grounding is read at call time', () => {
  it('L1 firing during the append suppresses a fixed conductor offer and produces a model turn', async () => {
    conductorPlansFixedOfferUnlessGrounded()
    const d = deps()
    // Simulates handleSend: `await appendUserMessage(...)` runs L1, which
    // activates grounding synchronously after the closure was created.
    const appendUserMessage = async () => {
      grounding.activateGrounding('auto')
      return { updatedMessages: messages }
    }
    const result = await appendUserMessage()
    await respondToUserTurn(d, result.updatedMessages, session)

    expect(d.appendDeterministicCompanionMessage).not.toHaveBeenCalled()
    expect(d.generateTherapistMessage).toHaveBeenCalledTimes(1)
    expect(d.generateTherapistMessage).toHaveBeenCalledWith(messages, session)
    expect(persistMock).not.toHaveBeenCalled()
  })

  it('grounding raced in while provenance persisted still yields a model turn and cancels the arm', async () => {
    conductorPlansFixedOfferUnlessGrounded()
    persistMock.mockImplementationOnce(async () => { grounding.activateGrounding('auto') })
    const d = deps()

    await respondToUserTurn(d, messages, session)

    expect(d.appendDeterministicCompanionMessage).not.toHaveBeenCalled()
    expect(d.generateTherapistMessage).toHaveBeenCalledWith(messages, session)
    expect(cancelMock).toHaveBeenCalledWith('conductor-u2', 'grounding')
  })

  it('suppresses a fixed research Journal offer when grounding activates mid-persist', async () => {
    planConductorMock.mockReturnValue(null)
    const researchEvent = event({ id: 'research-u2', protocolId: 'personal-science-v1', assignedArm: 'offer_journal_arc' })
    planResearchMock.mockImplementation((_s: Session, _m: SessionMessage[], _p: unknown, options: { grounding?: boolean }) => (
      options.grounding ? null : { event: researchEvent, delivery: 'fixed_journal_offer', responseMode: 'handoff' }
    ))
    persistMock.mockImplementationOnce(async () => { grounding.activateGrounding('auto') })
    const d = deps()

    await respondToUserTurn(d, messages, session)

    expect(d.appendDeterministicCompanionMessage).not.toHaveBeenCalled()
    expect(d.generateTherapistMessage).toHaveBeenCalledWith(messages, session)
    expect(cancelMock).toHaveBeenCalledWith('research-u2', 'grounding')
  })

  it('still delivers the fixed offer on an ordinary (ungrounded) turn', async () => {
    conductorPlansFixedOfferUnlessGrounded()
    const d = deps()

    await respondToUserTurn(d, messages, session)

    expect(d.appendDeterministicCompanionMessage).toHaveBeenCalledWith(
      d.copy.conductorOffer.room_arc,
      expect.objectContaining({ id: 'conductor-u2' }),
    )
    expect(d.generateTherapistMessage).not.toHaveBeenCalled()
  })
})
