import { db } from './db'
import type { AmbientTurnAssessment, DelayedOutcome, FieldMoment, ImmediateOutcome, OutcomeHorizon, SessionMessage } from '../types'
import { linkResearchOutcome } from './personalScience'

export const AMBIENT_EVALUATOR_PROMPT_VERSION = 'ambient-turn-v1'

export async function writeAmbientTurnOutcome(
  companionMessage: SessionMessage,
  userMessage: SessionMessage,
  sessionId: string,
  assessment: AmbientTurnAssessment,
): Promise<void> {
  const now = Date.now()
  const id = `ambient-${companionMessage.id}-${userMessage.id}`
  const existing = await db.interventionOutcomes.get(id)
  const immediate = assessment.fit === 'landed'
    ? 'helped'
    : assessment.fit === 'missed'
      ? 'not_wanted'
      : assessment.fit === 'partial'
        ? 'nothing'
        : undefined
  const record = {
    ...(immediate ? { immediate: immediate as ImmediateOutcome } : {}),
    assessmentSource: 'ambient_turn' as const,
    assessedUserMessageId: userMessage.id,
    ambientFit: assessment.fit,
    ambientMovement: assessment.movement,
    ambientAgency: assessment.agency,
    ambientConfidence: assessment.confidence,
    ...(assessment.agency !== 'unclear' ? { agency: assessment.agency } : {}),
    evaluatorModel: 'gpt-5.5',
    evaluatorPromptVersion: AMBIENT_EVALUATOR_PROMPT_VERSION,
    updatedAt: now,
  }
  if (existing) await db.interventionOutcomes.update(id, record)
  else await db.interventionOutcomes.add({
    id,
    source: companionMessage.surface ?? 'talk',
    sourceId: companionMessage.id,
    sessionId,
    intervention: companionMessage.responseMode ?? 'reflect',
    ...(companionMessage.researchEventId ? { researchEventId: companionMessage.researchEventId } : {}),
    ...record,
    createdAt: now,
  })
  if (companionMessage.researchEventId) {
    await linkResearchOutcome(companionMessage.researchEventId, id).catch(() => {})
  }
}

export async function writeImmediateMessageOutcome(
  id: string,
  message: SessionMessage,
  sessionId: string,
  immediate: ImmediateOutcome,
) {
  const now = Date.now()
  const existing = await db.interventionOutcomes.get(id)
  const record = {
    immediate,
    updatedAt: now,
  }
  if (existing) {
    await db.interventionOutcomes.update(id, record)
  } else await db.interventionOutcomes.add({
    id,
    source: message.surface ?? 'talk',
    sourceId: message.id,
    sessionId,
    intervention: message.responseMode ?? 'reflect',
    ...record,
    ...(message.researchEventId ? { researchEventId: message.researchEventId } : {}),
    createdAt: now,
  })
  if (message.researchEventId) await linkResearchOutcome(message.researchEventId, id).catch(() => {})
}

export async function writeDelayedOutcome(id: string, delayed?: DelayedOutcome) {
  return writeHorizonOutcome(id, 'later_today', delayed)
}

export async function writeHorizonOutcome(
  id: string,
  horizon: OutcomeHorizon,
  delayed?: DelayedOutcome,
) {
  const now = Date.now()
  const existing = await db.interventionOutcomes.get(id)
  const horizonOutcomes = (existing?.horizonOutcomes ?? []).filter(item => item.horizon !== horizon)
  if (delayed) horizonOutcomes.push({ horizon, outcome: delayed, reportedAt: now })
  await db.interventionOutcomes.update(id, {
    ...(delayed ? { delayed } : {}),
    delayedAskedAt: now,
    horizonOutcomes,
    horizonAskedAt: { ...(existing?.horizonAskedAt ?? {}), [horizon]: now },
    updatedAt: now,
  })
}

export async function writeFieldWindowTimingOutcome(id: string, immediate?: ImmediateOutcome) {
  const now = Date.now()
  await db.interventionOutcomes.update(id, {
    ...(immediate ? { immediate } : {}),
    timingAskedAt: now,
    updatedAt: now,
  })
}

export async function writeAgencyOutcome(id: string, agency: 'more' | 'same' | 'less') {
  await db.interventionOutcomes.update(id, {
    agency,
    updatedAt: Date.now(),
  })
}

export async function writeFieldMomentOutcome(moment: FieldMoment, immediate: ImmediateOutcome) {
  const now = Date.now()
  const id = `field-${moment.id}`
  await db.interventionOutcomes.add({
    id,
    source: moment.source,
    sourceId: moment.sourceId,
    intervention: moment.responseMode ?? 'reflect',
    immediate,
    ...(moment.researchEventId ? { researchEventId: moment.researchEventId } : {}),
    createdAt: now,
    updatedAt: now,
  })
  if (moment.researchEventId) await linkResearchOutcome(moment.researchEventId, id).catch(() => {})
}

export async function recordSessionOutcome(sessionId: string, immediate: ImmediateOutcome) {
  const now = Date.now()
  const id = `session-${sessionId}`
  await db.interventionOutcomes.add({
    id,
    source: 'session',
    sourceId: sessionId,
    sessionId,
    intervention: 'session',
    immediate,
    createdAt: now,
    updatedAt: now,
  })
}

export async function recordSessionNextStep(
  sessionId: string,
  nextStep: 'done' | 'offline_action' | 'human_contact' | 'rest' | 'more_support',
) {
  await db.interventionOutcomes.update(`session-${sessionId}`, {
    nextStep,
    updatedAt: Date.now(),
  })
}
