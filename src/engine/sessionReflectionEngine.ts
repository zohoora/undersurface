import type { Part, EntrySummary, UserProfile, PersonalFacts, SessionMessage, CompanionSignals, UserPart } from '../types'
import { buildSessionReflectionPrompt, buildBoundedTranscript } from '../ai/therapistPrompts'
import { chatCompletion } from '../ai/openrouter'
import { db, generateId } from '../store/db'
import { getGlobalConfig } from '../store/globalConfig'
import { LetterEngine } from './letterEngine'
import { pruneGrowthCollections } from './memoryPruner'
import { detectTerseEnding } from './ruptureDetector'
import { applyPartObservations, mergeLexicon } from './userPartTracker'
import { engineLog } from '../services/diagnostics'

const MEMORY_CAPS: Record<string, number> = {
  observation: 20,
  interaction: 15,
  reflection: 20,
  pattern: 10,
  somatic: 30,
}

export async function reflectOnSession(
  sessionId: string,
  messages: SessionMessage[],
  parts: Part[],
): Promise<void> {
  try {
    // 1. Build transcript (wrap user messages for injection defense; bound length to fit
    // backend's 8000-char user-message cap)
    const transcriptText = buildBoundedTranscript(messages)
    if (transcriptText.startsWith('(... ') && messages.length > 0) {
      const omittedMatch = transcriptText.match(/^\(\.\.\. (\d+) earlier turn/)
      const omitted = omittedMatch ? Number(omittedMatch[1]) : 0
      engineLog('info', 'reflect.transcript_truncated', `dropped ${omitted} of ${messages.length} turns`, {
        sessionId,
        extra: { omitted, total: messages.length },
      })
    }

    // 2. Skip short sessions
    if (transcriptText.length < 100) return

    // 3. Load profile + recent summaries + existing personal facts (+ the
    // writer's mapped parts, when the userParts flag is on)
    const userPartsOn = getGlobalConfig()?.features?.userParts === true
    const [profile, allSummaries, existingFacts, existingUserParts] = await Promise.all([
      db.userProfile.get('current'),
      db.entrySummaries.orderBy('timestamp').reverse().toArray(),
      db.personalFacts.get('current'),
      userPartsOn ? db.userParts.toArray() : Promise.resolve([] as UserPart[]),
    ])
    const recentSummaries = allSummaries.slice(0, 5)

    // 4. Call AI
    const partsForPrompt = parts.map(p => ({
      id: p.id,
      name: p.name,
      ifsRole: p.ifsRole,
    }))
    const promptMessages = buildSessionReflectionPrompt({
      transcript: transcriptText,
      profile: profile ?? null,
      recentSummaries,
      parts: partsForPrompt,
      existingFacts: existingFacts ?? null,
      userParts: userPartsOn
        ? existingUserParts
            .filter((p) => p.status !== 'retired')
            .map((p) => ({ id: p.id, name: p.name, description: p.description, stance: p.stance }))
        : undefined,
    })
    // gpt-5.5 with default reasoning was burning the entire token budget on
    // hidden reasoning, leaving zero output. Reflection is structured JSON
    // extraction — it doesn't need deliberation. 'none' reasoning + 2000
    // token headroom keeps output flowing without runaway cost.
    const reflStart = Date.now()
    console.log('[reflect] start', { sessionId, transcriptLen: transcriptText.length })
    let response: string
    try {
      response = await chatCompletion(promptMessages, 240000, 2000, 'none')
    } catch (err) {
      console.error('[reflect] chat failed', { sessionId, ms: Date.now() - reflStart, err: err instanceof Error ? err.message : String(err) })
      return
    }
    console.log('[reflect] response received', { sessionId, ms: Date.now() - reflStart, len: response.length, head: response.slice(0, 120), tail: response.slice(-120) })

    const parsed = parseReflectionResponse(response)
    if (!parsed) {
      console.error('[reflect] parse failed', { sessionId, len: response.length, head: response.slice(0, 200), tail: response.slice(-200) })
      // Heuristic: 2000-token output cap clips JSON near 7000+ chars; parse fails on a clipped tail.
      if (response.length > 7000) {
        engineLog('info', 'reflect.output_truncated', `output likely hit 2000-token cap at ${response.length} chars`, {
          sessionId,
          extra: { len: response.length },
        })
      }
      return
    }
    console.log('[reflect] parsed OK', {
      sessionId,
      hasEntrySummary: !!parsed.entrySummary,
      hasPersonalFacts: !!parsed.personalFacts,
      personalFactsPeople: parsed.personalFacts?.people?.length ?? 0,
    })

    // 6a. Store entry summary (entryId = sessionId)
    if (parsed.entrySummary) {
      const summary: EntrySummary = {
        id: generateId(),
        entryId: sessionId,
        themes: parsed.entrySummary.themes || [],
        emotionalArc: parsed.entrySummary.emotionalArc || '',
        keyMoments: parsed.entrySummary.keyMoments || [],
        timestamp: Date.now(),
      }
      await db.entrySummaries.add(summary)
    }

    // 6b. Create reflection memories for open + weaver (the therapist's source parts)
    if (parsed.partMemories) {
      for (const [partId, content] of Object.entries(parsed.partMemories)) {
        if (typeof content !== 'string' || !content.trim()) continue
        if (!parts.some(p => p.id === partId)) continue
        await db.memories.add({
          id: generateId(),
          partId,
          entryId: sessionId,
          content: content.trim(),
          type: 'reflection',
          timestamp: Date.now(),
          source: 'session',
          sessionId,
        })
      }
    }

    // 6c. Create pattern memories under ONE canonical manager/self part.
    // Writing a copy per manager/self part stored every cross-entry pattern in
    // triplicate (the seeded self/manager parts are exactly the three the
    // context loader reads), so one string could fill 3 of the 4 pattern slots
    // in every prompt. Prefer a Self-role owner; fall back to the first
    // manager/self part.
    if (parsed.crossEntryPatterns && Array.isArray(parsed.crossEntryPatterns)) {
      const patternParts = parts.filter(p => p.ifsRole === 'manager' || p.ifsRole === 'self')
      const patternOwner = patternParts.find(p => p.ifsRole === 'self') ?? patternParts[0]
      if (patternOwner) {
        for (const pattern of parsed.crossEntryPatterns) {
          if (typeof pattern !== 'string' || !pattern.trim()) continue
          await db.memories.add({
            id: generateId(),
            partId: patternOwner.id,
            entryId: sessionId,
            content: pattern.trim(),
            type: 'pattern',
            timestamp: Date.now(),
            source: 'session',
            sessionId,
          })
        }
      }
    }

    // 6d. Update user profile
    if (parsed.profileUpdates) {
      const updates = parsed.profileUpdates
      const current = profile || {
        id: 'current',
        recurringThemes: [],
        emotionalPatterns: [],
        avoidancePatterns: [],
        growthSignals: [],
        innerLandscape: '',
        lastUpdated: 0,
      }

      const merged: UserProfile = {
        id: 'current',
        recurringThemes: mergeArrays(current.recurringThemes, updates.recurringThemes, 15),
        emotionalPatterns: mergeArrays(current.emotionalPatterns, updates.emotionalPatterns, 10),
        avoidancePatterns: mergeArrays(current.avoidancePatterns, updates.avoidancePatterns, 10),
        growthSignals: mergeArrays(current.growthSignals, updates.growthSignals, 10),
        innerLandscape: typeof updates.innerLandscape === 'string' && updates.innerLandscape.trim()
          ? updates.innerLandscape.trim()
          : current.innerLandscape,
        lastUpdated: Date.now(),
      }

      if (profile) {
        await db.userProfile.update('current', merged)
      } else {
        await db.userProfile.add(merged)
      }
    }

    // 6d-bis. Save personal facts. Caps mirror the prompt to defend against runaway output.
    if (parsed.personalFacts) {
      const validated = validatePersonalFacts(parsed.personalFacts, existingFacts ?? null)
      if (!validated) {
        console.log('[reflect] personalFacts validator returned null (no saveable content)', { sessionId })
      } else if (factsContentEqual(validated, existingFacts ?? null)) {
        console.log('[reflect] personalFacts unchanged from existing — skipping write', { sessionId })
      } else {
        const op = existingFacts ? 'update' : 'add'
        console.log('[reflect] personalFacts writing', { sessionId, op, people: validated.people.length, dates: validated.dates.length, context: validated.context.length, threads: validated.currentThreads.length })
        if (existingFacts) {
          await db.personalFacts.update('current', validated)
        } else {
          await db.personalFacts.add(validated)
        }
      }
    } else {
      console.log('[reflect] no personalFacts field in LLM response', { sessionId })
    }

    // 6e. Create somatic memories
    if (parsed.somaticSignals && Array.isArray(parsed.somaticSignals)) {
      const validRegions = ['head', 'eyes', 'throat', 'chest', 'stomach', 'shoulders', 'hands', 'back', 'hips', 'legs']
      const validIntensities = ['low', 'medium', 'high']
      for (const signal of parsed.somaticSignals) {
        if (!validRegions.includes(signal.bodyRegion)) continue
        if (typeof signal.quote !== 'string' || !signal.quote.trim()) continue
        if (typeof signal.emotion !== 'string' || !signal.emotion.trim()) continue
        const intensity = validIntensities.includes(signal.intensity) ? signal.intensity : 'medium'
        await db.memories.add({
          id: generateId(),
          partId: '_somatic',
          entryId: sessionId,
          content: `${signal.bodyRegion}: ${signal.quote} (${signal.emotion}, ${intensity})`,
          type: 'somatic',
          bodyRegion: signal.bodyRegion,
          quote: signal.quote.trim().slice(0, 100),
          emotion: signal.emotion.trim(),
          intensity,
          timestamp: Date.now(),
          source: 'session',
          sessionId,
        })
      }
    }

    // 6e-bis. Rupture/rumination signal state (terse-ending marker + loop
    // streak). Best-effort — never lets a signal failure affect the reflection.
    try {
      await updateCompanionSignals(sessionId, messages, parsed.loopSignal)
    } catch (error) {
      console.error('[reflect] companion signal update error:', error)
    }

    // 6e-ter. User-part observations + shared lexicon (flag-gated inside).
    // Best-effort — never lets a parts failure affect the reflection.
    if (userPartsOn) {
      try {
        await updateUserPartsAndLexicon(sessionId, existingUserParts, parsed.partObservations, parsed.coinedPhrases)
      } catch (error) {
        console.error('[reflect] user parts update error:', error)
      }
    }

    // 6f. Prune old memories
    await pruneMemories(parts)

    // 6g. Check for part growth (every 5 reflections)
    const totalSummaryCount = await db.entrySummaries.count()
    if (totalSummaryCount > 0 && totalSummaryCount % 5 === 0) {
      const { PartGrowthEngine } = await import('./partGrowthEngine')
      const growthEngine = new PartGrowthEngine()
      await growthEngine.growParts(parts, profile ?? null)
    }

    // 6h. Check for letters — keyed to closed-session count (entrySummaries,
    // one per close). The old `entries` collection has no writers since the
    // diary→session pivot; its count is 0 forever and `0 % 10 === 0` fired a
    // letter after every single close.
    try {
      const letterEngine = new LetterEngine()
      await letterEngine.checkForLetter(totalSummaryCount, parts)
    } catch (error) {
      console.error('Letter check error:', error)
    }

    // Trim unbounded growth collections while we're already online. Best-effort
    // and self-contained — never lets a prune failure affect the reflection.
    void pruneGrowthCollections()

    console.log('[reflect] complete', { sessionId, totalMs: Date.now() - reflStart })
  } catch (error) {
    console.error('[reflect] error', { sessionId, err: error instanceof Error ? error.message : String(error) })
  }
}

function parseReflectionResponse(response: string): {
  entrySummary?: { themes: string[]; emotionalArc: string; keyMoments: string[] }
  partMemories?: Record<string, string>
  profileUpdates?: {
    recurringThemes?: string[]; emotionalPatterns?: string[]
    avoidancePatterns?: string[]; growthSignals?: string[]
    innerLandscape?: string
  }
  personalFacts?: {
    people?: Array<{ name?: unknown; relationship?: unknown; notes?: unknown }>
    dates?: Array<{ event?: unknown; date?: unknown }>
    context?: Array<{ category?: unknown; value?: unknown }>
    currentThreads?: Array<{ topic?: unknown }>
  }
  crossEntryPatterns?: string[]
  somaticSignals?: Array<{
    bodyRegion: string; quote: string; emotion: string; intensity: string
  }>
  loopSignal?: { present?: unknown; theme?: unknown; newInformation?: unknown }
  partObservations?: unknown
  coinedPhrases?: unknown
} | null {
  try {
    const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, response]
    return JSON.parse(jsonMatch[1]!.trim())
  } catch {
    console.error('Failed to parse session reflection response:', response.slice(0, 200))
    return null
  }
}

// Rupture/rumination signal state updates from the reflection pass. Exported
// for tests. Spec: docs/superpowers/specs/2026-07-03-rupture-rumination-design.md
//
// Terse-ending: the one rupture marker that needs message lengths, computed
// here where the messages are already in memory (abandonment/gap are computed
// at session open from session docs). Loop streak: the LLM judges recurrence
// against the summaries it was shown; the client only counts consecutive
// no-new-information loop sessions. Consumers treat streak >= 3 as armed.
export async function updateCompanionSignals(
  sessionId: string,
  messages: SessionMessage[],
  loopSignal: { present?: unknown; theme?: unknown; newInformation?: unknown } | undefined,
): Promise<void> {
  const features = getGlobalConfig()?.features
  const repairOn = features?.ruptureRepair === true
  const pivotOn = features?.ruminationPivot === true
  if (!repairOn && !pivotOn) return

  const existing = await db.companionSignals.get('current')
  const current: CompanionSignals = existing ?? {
    id: 'current',
    pendingRepair: null,
    ruminationWatch: null,
    updatedAt: 0,
  }
  let changed = false

  if (repairOn) {
    const lengths = messages
      .filter((m) => m.speaker === 'user')
      .map((m) => (m.content ?? '').length)
    if (detectTerseEnding(lengths)) {
      // Single slot — newest evidence wins.
      current.pendingRepair = { evidence: 'terse_ending', sourceSessionId: sessionId, createdAt: Date.now() }
      changed = true
    }
  }

  if (pivotOn) {
    // Malformed/missing loopSignal is treated as "no loop" (precision-first):
    // present must be literally true and newInformation literally false.
    const looped = loopSignal?.present === true && loopSignal?.newInformation === false
    if (looped) {
      const theme = nonEmptyString(loopSignal?.theme)?.slice(0, 60) ?? ''
      current.ruminationWatch = {
        theme,
        streak: (current.ruminationWatch?.streak ?? 0) + 1,
        lastConfirmedAt: Date.now(),
      }
      changed = true
    } else if (current.ruminationWatch) {
      // A session that breaks the loop clears the watch entirely.
      current.ruminationWatch = null
      changed = true
    }
  }

  if (changed) {
    current.updatedAt = Date.now()
    if (existing) await db.companionSignals.update('current', current)
    else await db.companionSignals.add(current)
  }
}

// User-part observation + lexicon persistence from the reflection pass.
// Exported for tests. The tracker does all judgment (caps, dedup, precision
// rails); this just persists its output and the merged lexicon.
// Spec: docs/superpowers/specs/2026-07-04-user-parts-model-design.md
export async function updateUserPartsAndLexicon(
  sessionId: string,
  existingParts: UserPart[],
  partObservations: unknown,
  coinedPhrases: unknown,
): Promise<void> {
  const { updates, creates } = applyPartObservations(existingParts, partObservations, sessionId, Date.now())
  for (const part of updates) {
    await db.userParts.update(part.id, part)
  }
  for (const part of creates) {
    await db.userParts.add(part)
  }

  const facts = await db.personalFacts.get('current')
  const lexicon = mergeLexicon(facts?.lexicon, coinedPhrases)
  if (lexicon) {
    if (facts) {
      await db.personalFacts.update('current', { lexicon, lastUpdated: Date.now() })
    } else {
      await db.personalFacts.add({
        id: 'current', people: [], dates: [], context: [], currentThreads: [],
        lexicon, lastUpdated: Date.now(),
      })
    }
  }
}

const FACT_CAPS = { people: 30, dates: 20, context: 20, currentThreads: 8 }

function nonEmptyString(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const trimmed = v.trim()
  return trimmed.length > 0 ? trimmed : null
}

function validatePersonalFacts(
  raw: NonNullable<ReturnType<typeof parseReflectionResponse>>['personalFacts'],
  existing: PersonalFacts | null,
): PersonalFacts | null {
  if (!raw || typeof raw !== 'object') return null

  type PersonEntry = PersonalFacts['people'][number]
  const people: PersonEntry[] = []
  for (const p of (Array.isArray(raw.people) ? raw.people : [])) {
    const name = nonEmptyString(p?.name)
    if (!name) continue
    const entry: PersonEntry = { name }
    const relationship = nonEmptyString(p?.relationship)
    if (relationship) entry.relationship = relationship
    const notes = nonEmptyString(p?.notes)
    if (notes) entry.notes = notes
    people.push(entry)
    if (people.length >= FACT_CAPS.people) break
  }

  const dates = (Array.isArray(raw.dates) ? raw.dates : [])
    .map(d => {
      const event = nonEmptyString(d?.event)
      const date = nonEmptyString(d?.date)
      if (!event || !date) return null
      return { event, date }
    })
    .filter((d): d is { event: string; date: string } => d !== null)
    .slice(0, FACT_CAPS.dates)

  const context = (Array.isArray(raw.context) ? raw.context : [])
    .map(c => {
      const category = nonEmptyString(c?.category)
      const value = nonEmptyString(c?.value)
      if (!category || !value) return null
      return { category, value }
    })
    .filter((c): c is { category: string; value: string } => c !== null)
    .slice(0, FACT_CAPS.context)

  // Preserve addedAt for surviving threads so staleness reflects original mention, not last extraction.
  const existingThreadAddedAt = new Map<string, number>()
  for (const t of existing?.currentThreads ?? []) {
    existingThreadAddedAt.set(t.topic, t.addedAt)
  }
  const now = Date.now()
  const currentThreads = (Array.isArray(raw.currentThreads) ? raw.currentThreads : [])
    .map(t => {
      const topic = nonEmptyString(t?.topic)
      if (!topic) return null
      return { topic, addedAt: existingThreadAddedAt.get(topic) ?? now }
    })
    .filter((t): t is { topic: string; addedAt: number } => t !== null)
    .slice(0, FACT_CAPS.currentThreads)

  // If everything came back empty, don't overwrite existing facts with nothing.
  if (people.length === 0 && dates.length === 0 && context.length === 0 && currentThreads.length === 0) {
    return null
  }

  return {
    id: 'current',
    people,
    dates,
    context,
    currentThreads,
    lastUpdated: now,
  }
}

function factsContentEqual(a: PersonalFacts, b: PersonalFacts | null): boolean {
  if (!b) return false
  return (
    JSON.stringify(a.people) === JSON.stringify(b.people) &&
    JSON.stringify(a.dates) === JSON.stringify(b.dates) &&
    JSON.stringify(a.context) === JSON.stringify(b.context) &&
    JSON.stringify(a.currentThreads) === JSON.stringify(b.currentThreads)
  )
}

function mergeArrays(existing: string[], incoming: unknown, cap: number): string[] {
  if (!Array.isArray(incoming)) return existing
  const validated = incoming.filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
  const merged = [...new Set([...existing, ...validated])]
  return merged.slice(-cap)
}

async function pruneMemories(parts: Part[]): Promise<void> {
  // Prune real part memories
  for (const part of parts) {
    const allMemories = await db.memories.where('partId').equals(part.id).toArray()

    for (const [type, cap] of Object.entries(MEMORY_CAPS)) {
      const typed = allMemories
        .filter(m => (m.type ?? 'interaction') === type)
        .sort((a, b) => b.timestamp - a.timestamp)

      if (typed.length > cap) {
        const toDelete = typed.slice(cap)
        for (const mem of toDelete) {
          await db.memories.delete(mem.id)
        }
      }
    }
  }

  // Prune somatic memories (virtual _somatic partId)
  const somaticMemories = await db.memories.where('partId').equals('_somatic').toArray()
  const somaticCap = MEMORY_CAPS.somatic ?? 30
  const sorted = somaticMemories.sort((a, b) => b.timestamp - a.timestamp)
  if (sorted.length > somaticCap) {
    for (const mem of sorted.slice(somaticCap)) {
      await db.memories.delete(mem.id)
    }
  }
}
