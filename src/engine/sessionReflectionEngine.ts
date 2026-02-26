import type { Part, PartMemory, EntrySummary, UserProfile, SessionMessage } from '../types'
import { buildSessionReflectionPrompt } from '../ai/therapistPrompts'
import { chatCompletion } from '../ai/openrouter'
import { wrapUserContent } from '../ai/promptSafety'
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
    // 1. Build transcript (wrap user messages for injection defense)
    const transcriptText = messages
      .map(msg => {
        if (msg.speaker === 'user') return `Writer: ${wrapUserContent(msg.content, 'message')}`
        return `Companion: ${msg.content}`
      })
      .join('\n')

    // 2. Skip short sessions
    if (transcriptText.length < 100) return

    // 3. Load profile + recent summaries
    const [profile, allSummaries] = await Promise.all([
      db.userProfile.get('current') as Promise<UserProfile | undefined>,
      db.entrySummaries.orderBy('timestamp').reverse().toArray() as Promise<EntrySummary[]>,
    ])
    const recentSummaries = allSummaries.slice(0, 5)

    // 4. Call AI
    const partsForPrompt = parts.map(p => ({
      id: p.id,
      name: p.name,
      ifsRole: p.ifsRole,
    }))
    const promptMessages = buildSessionReflectionPrompt(
      transcriptText,
      profile ?? null,
      recentSummaries,
      partsForPrompt,
    )
    const response = await chatCompletion(promptMessages, 15000, 1000)

    // 5. Parse response
    const parsed = parseReflectionResponse(response)
    if (!parsed) return

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
      const current = (profile as UserProfile | undefined) || {
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
  } catch (error) {
    console.error('Session reflection error:', error)
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

function mergeArrays(existing: string[], incoming: unknown, cap: number): string[] {
  if (!Array.isArray(incoming)) return existing
  const validated = incoming.filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
  const merged = [...new Set([...existing, ...validated])]
  return merged.slice(-cap)
}

async function pruneMemories(parts: Part[]): Promise<void> {
  // Prune real part memories
  for (const part of parts) {
    const allMemories = await db.memories.where('partId').equals(part.id).toArray() as unknown as PartMemory[]

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
  const somaticMemories = await db.memories.where('partId').equals('_somatic').toArray() as unknown as PartMemory[]
  const somaticCap = MEMORY_CAPS.somatic ?? 30
  const sorted = somaticMemories.sort((a, b) => b.timestamp - a.timestamp)
  if (sorted.length > somaticCap) {
    for (const mem of sorted.slice(somaticCap)) {
      await db.memories.delete(mem.id)
    }
  }
}
