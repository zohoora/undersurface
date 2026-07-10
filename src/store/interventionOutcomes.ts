import { db, generateId } from './db'
import type { DelayedOutcome, FieldMoment, ImmediateOutcome, SessionMessage } from '../types'

export async function writeImmediateMessageOutcome(
  id: string,
  message: SessionMessage,
  sessionId: string,
  immediate: ImmediateOutcome,
) {
  const now = Date.now()
  await db.interventionOutcomes.add({
    id,
    source: message.surface ?? 'talk',
    sourceId: message.id,
    sessionId,
    intervention: message.responseMode ?? 'reflect',
    immediate,
    createdAt: now,
    updatedAt: now,
  })
}

export async function writeDelayedOutcome(id: string, delayed?: DelayedOutcome) {
  const now = Date.now()
  await db.interventionOutcomes.update(id, {
    ...(delayed ? { delayed } : {}),
    delayedAskedAt: now,
    updatedAt: now,
  })
}

export async function writeFieldMomentOutcome(moment: FieldMoment, immediate: ImmediateOutcome) {
  const now = Date.now()
  await db.interventionOutcomes.add({
    id: `field-${moment.id}`,
    source: moment.source,
    sourceId: moment.sourceId,
    intervention: moment.responseMode ?? 'reflect',
    immediate,
    createdAt: now,
    updatedAt: now,
  })
}

export async function recordSessionOutcome(sessionId: string, immediate: ImmediateOutcome) {
  const now = Date.now()
  await db.interventionOutcomes.add({
    id: generateId(),
    source: 'session',
    sourceId: sessionId,
    sessionId,
    intervention: 'session',
    immediate,
    createdAt: now,
    updatedAt: now,
  })
}
