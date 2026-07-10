import { db } from './db'
import { linkResearchOutcome } from './personalScience'
import type {
  AmbiguityPrismFeedback,
  LivingHypothesis,
  PrismCorrectionEffort,
  PrismHypothesisFeedback,
  SessionMessage,
} from '../types'

export async function recordAmbiguityPrismFeedback(input: {
  message: SessionMessage
  sessionId: string
  hypotheses: PrismHypothesisFeedback[]
  noneFit: boolean
  betterFrame?: string
  correctionEffort?: PrismCorrectionEffort
}): Promise<AmbiguityPrismFeedback> {
  const now = Date.now()
  const feedback: AmbiguityPrismFeedback = {
    hypotheses: input.hypotheses,
    noneFit: input.noneFit,
    ...(input.betterFrame?.trim() ? { betterFrame: input.betterFrame.trim().slice(0, 300) } : {}),
    ...(input.correctionEffort ? { correctionEffort: input.correctionEffort } : {}),
    submittedAt: now,
  }
  const outcomeId = `message-${input.message.id}`
  const existing = await db.interventionOutcomes.get(outcomeId)
  if (existing) {
    await db.interventionOutcomes.update(outcomeId, { prismFeedback: feedback, updatedAt: now })
  } else {
    await db.interventionOutcomes.add({
      id: outcomeId,
      source: input.message.surface ?? 'talk',
      sourceId: input.message.id,
      sessionId: input.sessionId,
      intervention: input.message.responseMode ?? 'reflect',
      prismFeedback: feedback,
      ...(input.message.researchEventId ? { researchEventId: input.message.researchEventId } : {}),
      createdAt: now,
      updatedAt: now,
    })
  }
  if (input.message.researchEventId) {
    await linkResearchOutcome(input.message.researchEventId, outcomeId).catch(() => {})
  }

  const event = input.message.researchEventId
    ? await db.researchEvents.get(input.message.researchEventId)
    : undefined
  const base = {
    sourceMessageId: input.message.id,
    sourceSessionId: input.sessionId,
    ...(input.message.researchEventId ? { researchEventId: input.message.researchEventId } : {}),
    ...(event?.context ? { context: event.context } : {}),
    createdAt: now,
    updatedAt: now,
  }
  const hypotheses: LivingHypothesis[] = feedback.hypotheses.map(item => ({
    id: `hypothesis-${input.message.id}-${item.id}`,
    text: item.text.slice(0, 300),
    status: item.fit === 'fits' ? 'confirmed' : item.fit === 'maybe' ? 'candidate' : 'contested',
    source: 'prism',
    ...base,
  }))
  if (feedback.betterFrame) {
    hypotheses.push({
      id: `hypothesis-${input.message.id}-writer`,
      text: feedback.betterFrame,
      status: 'confirmed',
      source: 'writer_rewrite',
      ...base,
    })
  }
  await db.livingHypotheses.bulkPut(hypotheses)
  return feedback
}
