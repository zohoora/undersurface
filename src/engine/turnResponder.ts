import type { ResearchArm, ResearchEvent, Session, SessionMessage, SessionSurface } from '../types'
import type { TherapistContext } from './sessionContextLoader'
import { planAdaptiveConductor } from './adaptiveConductor'
import { planResearchTurn, type ResearchAssignment } from './personalScience'
import { markResearchCancelled, persistResearchAssignment } from '../store/personalScience'
import { isGroundingActive } from '../store/groundingState'
import { engineLog } from '../services/diagnostics'

type ConductorOfferArm = Extract<ResearchArm, 'journal_arc' | 'speak_arc' | 'relax_arc' | 'drift_arc' | 'room_arc'>

export interface TurnResponderCopy {
  conductorOffer: Record<ConductorOfferArm, string>
  journalOffer: string
  transferUserFirst: string
  transferMinimalCue: string
  transferIndependent: string
}

export interface TurnResponderDeps {
  context: TherapistContext | null
  availableSurfaces: SessionSurface[]
  copy: TurnResponderCopy
  appendDeterministicCompanionMessage: (content: string, event: ResearchEvent) => Promise<SessionMessage[] | null>
  generateTherapistMessage: (
    messages: SessionMessage[],
    session: Session,
    assignment?: ResearchAssignment,
  ) => Promise<SessionMessage[]>
}

// Grounding can activate DURING the awaited user append (L1 runs synchronously
// at its end) or while provenance is being persisted (the raced L2 classifier).
// React state captured at render time is stale in both windows, so every gate
// here reads the live module flag at the moment it decides. A crisis turn must
// always reach the model, which rebuilds its prompt with isGrounding=true.
async function groundedTurn(
  deps: TurnResponderDeps,
  messages: SessionMessage[],
  session: Session,
  event?: ResearchEvent,
): Promise<SessionMessage[]> {
  if (event) {
    void markResearchCancelled(event.id, 'grounding').catch(() => { /* telemetry only */ })
  }
  return deps.generateTherapistMessage(messages, session)
}

export async function respondToUserTurn(
  deps: TurnResponderDeps,
  updatedMessages: SessionMessage[],
  currentSession: Session,
): Promise<SessionMessage[]> {
  const { context } = deps
  if (isGroundingActive()) return deps.generateTherapistMessage(updatedMessages, currentSession)

  const conductor = planAdaptiveConductor(currentSession, updatedMessages, {
    grounding: isGroundingActive(),
    availableSurfaces: deps.availableSurfaces,
    recentEvents: context?.recentConductorEvents,
    protocols: context?.activePersonalProtocols,
  })
  if (conductor) {
    let persisted = false
    try {
      await persistResearchAssignment(conductor.event)
      persisted = true
    } catch {
      engineLog('warn', 'conductor.persistence_failed', 'conductor provenance could not be persisted', { sessionId: currentSession.id })
    }
    if (persisted && context) {
      context.recentConductorEvents = [
        conductor.event,
        ...(context.recentConductorEvents ?? []).filter(event => event.id !== conductor.event.id),
      ].slice(0, 40)
    }
    if (persisted && conductor.assignment) {
      if (isGroundingActive()) return groundedTurn(deps, updatedMessages, currentSession, conductor.event)
      if (conductor.assignment.delivery === 'fixed_surface_offer') {
        const content = deps.copy.conductorOffer[conductor.event.assignedArm as ConductorOfferArm]
        if (content) {
          return await deps.appendDeterministicCompanionMessage(content, conductor.event) ?? updatedMessages
        }
      }
      return deps.generateTherapistMessage(updatedMessages, currentSession, conductor.assignment)
    }
  }

  if (isGroundingActive()) return deps.generateTherapistMessage(updatedMessages, currentSession)
  const assignment = planResearchTurn(currentSession, updatedMessages, context?.companionPreferences ?? undefined, {
    grounding: isGroundingActive(),
    protocols: context?.activePersonalProtocols,
  })
  if (!assignment) return deps.generateTherapistMessage(updatedMessages, currentSession)

  try {
    await persistResearchAssignment(assignment.event)
  } catch {
    // Never deliver an experimental arm without its provenance record.
    return deps.generateTherapistMessage(updatedMessages, currentSession)
  }
  if (isGroundingActive()) return groundedTurn(deps, updatedMessages, currentSession, assignment.event)

  // Designed silence is retired. Old persisted assignments can still carry
  // its legacy delivery value, so degrade them to an ordinary model turn.
  if (assignment.delivery === 'fixed_silence') {
    return deps.generateTherapistMessage(updatedMessages, currentSession)
  }
  if (assignment.delivery === 'fixed_journal_offer') {
    return await deps.appendDeterministicCompanionMessage(
      `[${deps.copy.journalOffer}](#switch:journal-arc).`,
      assignment.event,
    ) ?? updatedMessages
  }
  if (assignment.delivery === 'fixed_transfer') {
    const content = assignment.event.transferLevel === 'user_first'
      ? deps.copy.transferUserFirst
      : assignment.event.transferLevel === 'minimal_cue'
        ? deps.copy.transferMinimalCue
        : deps.copy.transferIndependent
    return await deps.appendDeterministicCompanionMessage(content, assignment.event) ?? updatedMessages
  }
  return deps.generateTherapistMessage(updatedMessages, currentSession, assignment)
}
