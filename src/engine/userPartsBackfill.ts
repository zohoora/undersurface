import { db, sessionMessages } from '../store/db'
import { getGlobalConfig } from '../store/globalConfig'
import { chatCompletion } from '../ai/openrouter'
import { buildPartBackfillPrompt, buildBoundedTranscript } from '../ai/therapistPrompts'
import { applyPartObservations } from './userPartTracker'
import type { UserPart, CompanionSignals } from '../types'

// One-time, best-effort history backfill: walks past sessions through the
// lean part-observation prompt so veteran accounts don't start from zero.
// Seeds CANDIDATES only — the consent posture is untouched (nothing surfaces
// until the companion offers it in-session and the user names it).
// Spec: docs/superpowers/specs/2026-07-04-user-parts-backfill-design.md

const BACKFILL_SESSION_LIMIT = 20
const MIN_MESSAGE_COUNT = 4
const PER_CALL_TIMEOUT_MS = 60_000
const PER_CALL_MAX_TOKENS = 600

export async function maybeBackfillUserParts(): Promise<void> {
  try {
    if (getGlobalConfig()?.features?.userParts !== true) return

    const signals = await db.companionSignals.get('current')
    if (signals?.partsBackfillAt) return

    // Claim FIRST: an interrupted run never repeats. Partial seeding is fine —
    // forward detection continues from wherever the walk got to.
    const claimed: CompanionSignals = {
      id: 'current',
      pendingRepair: signals?.pendingRepair ?? null,
      ruminationWatch: signals?.ruminationWatch ?? null,
      partsBackfillAt: Date.now(),
      updatedAt: Date.now(),
    }
    if (signals) await db.companionSignals.update('current', claimed)
    else await db.companionSignals.add(claimed)

    // Newest N eligible sessions, then walk them OLDEST-first so incremental
    // matching accumulates the way live reflection would have.
    const recent = await db.sessions.orderBy('startedAt').reverse().limit(BACKFILL_SESSION_LIMIT * 2).toArray()
    const eligible = recent
      .filter((s) => s.status === 'closed' && (s.messageCount ?? 0) >= MIN_MESSAGE_COUNT)
      .slice(0, BACKFILL_SESSION_LIMIT)
      .sort((a, b) => a.startedAt - b.startedAt)
    if (eligible.length === 0) return

    let parts: UserPart[] = await db.userParts.toArray()

    for (const session of eligible) {
      try {
        const messages = await sessionMessages.getAll(session.id)
        if (messages.length === 0) continue
        const transcript = buildBoundedTranscript(messages)
        if (transcript.length < 100) continue

        const prompt = buildPartBackfillPrompt({
          transcript,
          userParts: parts
            .filter((p) => p.status !== 'retired')
            .map((p) => ({ id: p.id, name: p.name, description: p.description, stance: p.stance })),
        })
        // Sequential on purpose — 20 calls trickling keeps us far under the
        // chat rate limit and off the session's critical path.
        const response = await chatCompletion(prompt, PER_CALL_TIMEOUT_MS, PER_CALL_MAX_TOKENS, 'none')

        const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, response]
        let observations: unknown
        try {
          observations = (JSON.parse(jsonMatch[1]!.trim()) as { partObservations?: unknown }).partObservations
        } catch {
          continue // malformed output for this session — skip it
        }

        // Evidence is stamped with the session's own era, not "now".
        const observedAt = session.endedAt ?? session.startedAt
        const { updates, creates } = applyPartObservations(parts, observations, session.id, observedAt)
        for (const part of updates) {
          await db.userParts.update(part.id, part)
          parts = parts.map((p) => (p.id === part.id ? part : p))
        }
        for (const part of creates) {
          await db.userParts.add(part)
          parts = [...parts, part]
        }
      } catch (error) {
        // One bad session (network blip, oversized transcript) never stops
        // the walk.
        console.warn('[parts-backfill] session skipped:', session.id, error)
      }
    }
    console.log('[parts-backfill] complete', { sessions: eligible.length })
  } catch (error) {
    console.warn('[parts-backfill] aborted:', error)
  }
}
