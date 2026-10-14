import { db } from './db'
import type { PersonalProtocol, ResearchArm, ResearchEvent, TransferLevel, TransferStatus } from '../types'
import type { ResearchFinding } from '../engine/personalScience'
import { labelForResearchArm } from '../engine/personalScience'

export async function persistResearchAssignment(event: ResearchEvent): Promise<void> {
  const existing = await db.researchEvents.get(event.id)
  if (existing) return
  await db.researchEvents.add(event)
}

export async function markResearchDelivered(
  event: ResearchEvent,
  sourceId: string,
  deliveredArm: ResearchArm = event.assignedArm,
): Promise<void> {
  const now = Date.now()
  await db.researchEvents.update(event.id, {
    status: 'delivered',
    sourceId,
    deliveredArm,
    deliveredAt: now,
    updatedAt: now,
  })
}

export async function markResearchOverridden(eventId: string, overrideArm: ResearchArm): Promise<void> {
  await db.researchEvents.update(eventId, {
    status: 'overridden',
    overrideArm,
    updatedAt: Date.now(),
  })
}

export async function markResearchCancelled(eventId: string, reason: string): Promise<void> {
  await db.researchEvents.update(eventId, {
    status: 'cancelled',
    cancelReason: reason,
    updatedAt: Date.now(),
  })
}

export async function linkResearchOutcome(eventId: string, outcomeId: string): Promise<void> {
  await db.researchEvents.update(eventId, { outcomeId, updatedAt: Date.now() })
}

/**
 * Undo linkResearchOutcome after the outcome row was deleted (grounding cut a
 * surface arc short). Analysis joins outcomes to events by the outcome's
 * researchEventId, so the event simply has no outcome again; leaving
 * `outcomeId` would point at a row that no longer exists. Only clears the
 * link when it still names this outcome.
 */
export async function unlinkResearchOutcome(eventId: string, outcomeId: string): Promise<void> {
  const event = await db.researchEvents.get(eventId)
  if (!event || event.outcomeId !== outcomeId) return
  await db.researchEvents.deleteFields(eventId, ['outcomeId'], { updatedAt: Date.now() })
}

/**
 * A safety-forced return (grounding) discards a surface arc's outcome row:
 * nobody is asked how an interrupted arc went. The research event linked to it
 * loses its outcomeId in the same step, so nothing dangles.
 */
export async function discardSurfaceArcOutcome(outcomeId: string, researchEventId: string): Promise<void> {
  // Both writes are queued together: offline, a Firestore write promise only
  // settles on server ack, so awaiting the delete first would hold back the
  // unlink until the device reconnects.
  await Promise.all([
    db.interventionOutcomes.delete(outcomeId),
    unlinkResearchOutcome(researchEventId, outcomeId),
  ])
}

export async function reviewFinding(
  finding: ResearchFinding,
  status: PersonalProtocol['status'],
  title?: string,
): Promise<PersonalProtocol> {
  const now = Date.now()
  const protocol: PersonalProtocol = {
    id: `personal-${finding.id.replace(/[^a-z0-9-]/gi, '-').toLowerCase()}`,
    findingKey: finding.id,
    title: title?.trim() || `${labelForResearchArm(finding.preferredArm)} may fit this kind of moment`,
    protocolId: finding.protocolId,
    preferredArm: finding.preferredArm,
    context: finding.context,
    evidenceEventIds: finding.evidenceEventIds,
    confidence: finding.confidence,
    status,
    transferStatus: 'not_started',
    transferLevel: 'companion_led',
    createdAt: now,
    updatedAt: now,
  }
  await db.personalProtocols.add(protocol)
  return protocol
}

async function updateTransfer(
  protocol: PersonalProtocol,
  transferStatus: TransferStatus,
  transferLevel: TransferLevel,
  startedAt = protocol.transferStartedAt,
): Promise<PersonalProtocol> {
  const now = Date.now()
  const patch = {
    transferStatus,
    transferLevel,
    transferStartedAt: startedAt ?? now,
    transferUpdatedAt: now,
    updatedAt: now,
  }
  await db.personalProtocols.update(protocol.id, patch)
  return { ...protocol, ...patch }
}

export function startTransferPractice(protocol: PersonalProtocol): Promise<PersonalProtocol> {
  return updateTransfer(protocol, 'learning', 'companion_led', Date.now())
}

export function pauseTransferPractice(protocol: PersonalProtocol): Promise<PersonalProtocol> {
  return updateTransfer(protocol, 'paused', protocol.transferLevel ?? 'companion_led')
}

export function resumeTransferPractice(protocol: PersonalProtocol): Promise<PersonalProtocol> {
  return updateTransfer(protocol, 'learning', protocol.transferLevel ?? 'companion_led')
}

export function advanceTransferPractice(protocol: PersonalProtocol): Promise<PersonalProtocol> {
  const level = protocol.transferLevel ?? 'companion_led'
  if (level === 'companion_led') return updateTransfer(protocol, 'learning', 'user_first')
  if (level === 'user_first') return updateTransfer(protocol, 'learning', 'minimal_cue')
  return updateTransfer(protocol, 'graduated', 'independent')
}

export function restartTransferPractice(protocol: PersonalProtocol): Promise<PersonalProtocol> {
  return updateTransfer(protocol, 'learning', 'companion_led', Date.now())
}
