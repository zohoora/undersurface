import { db } from '../store/db'
import { getGlobalConfig } from '../store/globalConfig'
import { chatCompletion } from '../ai/openrouter'
import { buildStoryArcPrompt } from '../ai/therapistPrompts'
import { detectAtypicalGap } from './ruptureDetector'
import type { PersonalFacts } from '../types'

// Story-arc trigger + generation: fired void from session init (like the
// parts backfill). Generates at most one arc per 30 days, only at pivotal
// moments, only with enough history to trace. The arc waits as pendingArc
// and is delivered consume-once by the stream.
// Spec: docs/superpowers/specs/2026-07-04-companion-depth-program.md

const ARC_COOLDOWN_MS = 30 * 24 * 3_600_000
const MIN_SUMMARIES = 8
const ANNIVERSARY_WINDOW_DAYS = 2

// Pure: is any fully-dated personal date within ±2 days (month/day) of now?
export function isNearAnniversary(dates: PersonalFacts['dates'] | undefined, now: number): boolean {
  if (!dates) return false
  const d = new Date(now)
  for (const entry of dates) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(entry.date)
    if (!m) continue
    const target = new Date(d.getFullYear(), Number(m[2]) - 1, Number(m[3]))
    const diff = Math.abs(target.getTime() - now)
    const wrapped = Math.min(diff, Math.abs(diff - 365 * 24 * 3_600_000))
    if (wrapped <= ANNIVERSARY_WINDOW_DAYS * 24 * 3_600_000) return true
  }
  return false
}

export async function maybeGenerateStoryArc(currentSessionId?: string): Promise<void> {
  try {
    if (getGlobalConfig()?.features?.storyArcs !== true) return

    const signals = await db.companionSignals.get('current')
    if (signals?.pendingArc) return
    if (signals?.lastArcAt && Date.now() - signals.lastArcAt < ARC_COOLDOWN_MS) return

    const [sessions, facts, summaries] = await Promise.all([
      db.sessions.orderBy('startedAt').reverse().limit(50).toArray(),
      db.personalFacts.get('current'),
      db.entrySummaries.orderBy('timestamp').reverse().toArray(),
    ])
    if (summaries.length < MIN_SUMMARIES) return

    const prior = sessions.filter((s) => s.id !== currentSessionId)
    const longGap = detectAtypicalGap(prior, Date.now())
    const anniversary = isNearAnniversary(facts?.dates, Date.now())
    if (!longGap && !anniversary) return

    const history = [...summaries].reverse().slice(-24).map((s) => ({
      themes: s.themes, emotionalArc: s.emotionalArc, timestamp: s.timestamp,
    }))
    const response = await chatCompletion(
      buildStoryArcPrompt(history, longGap ? 'long_gap_return' : 'anniversary'),
      60_000, 400, 'none',
    )
    const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, response]
    const parsed = JSON.parse(jsonMatch[1]!.trim()) as { arc?: unknown }
    const arc = typeof parsed.arc === 'string' ? parsed.arc.trim() : ''

    // Stamp the cooldown even on a decline — the pivotal moment was assessed.
    const base = signals ?? { id: 'current' as const, pendingRepair: null, ruminationWatch: null, updatedAt: 0 }
    const updated = {
      ...base,
      lastArcAt: Date.now(),
      pendingArc: arc ? { text: arc.slice(0, 600), createdAt: Date.now() } : null,
      updatedAt: Date.now(),
    }
    if (signals) await db.companionSignals.update('current', updated)
    else await db.companionSignals.add(updated)
  } catch (error) {
    console.warn('[story-arc] skipped:', error)
  }
}
