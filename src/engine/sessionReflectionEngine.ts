import type { Part, EntrySummary, UserProfile, PersonalFacts, SessionMessage } from '../types'
import { buildSessionReflectionPrompt, buildBoundedTranscript } from '../ai/therapistPrompts'
import { chatCompletion } from '../ai/openrouter'
import { db, generateId } from '../store/db'
import { LetterEngine } from './letterEngine'

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

    // 2. Skip short sessions
    if (transcriptText.length < 100) return

    // 3. Load profile + recent summaries + existing personal facts
    const [profile, allSummaries, existingFacts] = await Promise.all([
      db.userProfile.get('current'),
      db.entrySummaries.orderBy('timestamp').reverse().toArray(),
      db.personalFacts.get('current'),
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

    // 6c. Create pattern memories for manager/self-role parts
    if (parsed.crossEntryPatterns && Array.isArray(parsed.crossEntryPatterns)) {
      const patternParts = parts.filter(p => p.ifsRole === 'manager' || p.ifsRole === 'self')
      for (const pattern of parsed.crossEntryPatterns) {
        if (typeof pattern !== 'string' || !pattern.trim()) continue
        for (const pp of patternParts) {
          await db.memories.add({
            id: generateId(),
            partId: pp.id,
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

    // 6f. Prune old memories
    await pruneMemories(parts)

    // 6g. Check for part growth (every 5 reflections)
    const totalSummaryCount = await db.entrySummaries.count()
    if (totalSummaryCount > 0 && totalSummaryCount % 5 === 0) {
      const { PartGrowthEngine } = await import('./partGrowthEngine')
      const growthEngine = new PartGrowthEngine()
      await growthEngine.growParts(parts, profile ?? null)
    }

    // 6h. Check for letters
    try {
      const totalEntries = await db.entries.count()
      const letterEngine = new LetterEngine()
      await letterEngine.checkForLetter(totalEntries, parts)
    } catch (error) {
      console.error('Letter check error:', error)
    }

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
} | null {
  try {
    const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, response]
    return JSON.parse(jsonMatch[1]!.trim())
  } catch {
    console.error('Failed to parse session reflection response:', response.slice(0, 200))
    return null
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
