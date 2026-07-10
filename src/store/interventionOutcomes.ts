import { db } from './db'
import type { DelayedOutcome, FieldMoment, ImmediateOutcome, OutcomeHorizon, SessionMessage } from '../types'
import { linkResearchOutcome } from './personalScience'

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
