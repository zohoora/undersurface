import type { Part, PartMemory, EntrySummary, UserProfile } from '../types'
import { buildReflectionPrompt } from '../ai/partPrompts'
import { chatCompletion } from '../ai/openrouter'
import { db, generateId } from '../store/db'
import { LetterEngine } from './letterEngine'

interface ReflectionResult {
  entrySummary?: EntrySummary
  memoriesCreated: number
  profileUpdated: boolean
  quotablePassages?: string[]
  unfinishedThreads?: string[]
}

const MEMORY_CAPS: Record<string, number> = {
  observation: 20,
  interaction: 15,
  reflection: 20,
  pattern: 10,
}

export class ReflectionEngine {
  private simpleHash(text: string): string {
    let hash = 0
    for (let i = 0; i < text.length; i++) {
      hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0
    }
    return hash.toString(36)
  }

  async reflect(entryId: string, parts: Part[]): Promise<ReflectionResult> {
    const result: ReflectionResult = { memoriesCreated: 0, profileUpdated: false }

    try {
      // 1. Load entry
      const entry = await db.entries.get(entryId) as { plainText: string; intention?: string } | undefined
      if (!entry || entry.plainText.trim().length < 100) return result

      // 1b. Dedup check — skip if entry already reflected with same content
      const contentHash = this.simpleHash(entry.plainText)
      const existingSummaries = await db.entrySummaries.where('entryId').equals(entryId).toArray() as EntrySummary[]
      if (existingSummaries.length > 0) {
        const lastSummary = existingSummaries[existingSummaries.length - 1] as EntrySummary & { contentHash?: string }
        if (lastSummary.contentHash === contentHash) return result
      }

      // 2. Load thoughts + interactions for this entry
      const thoughts = await db.thoughts.where('entryId').equals(entryId).toArray() as { partId: string; content: string }[]
      const interactions = await db.interactions.where('entryId').equals(entryId).toArray() as {
        partId: string; partOpening: string; userResponse: string | null; partReply: string | null; status: string
      }[]

      // 3. Load existing profile
      const profile = await db.userProfile.get('current') as UserProfile | undefined

      // 4. Load recent summaries
      const allSummaries = await db.entrySummaries.orderBy('timestamp').reverse().toArray() as EntrySummary[]
      const recentSummaries = allSummaries.slice(0, 5)

      // 5. Build prompt context
      const thoughtsForPrompt = thoughts.map((t) => ({
        partName: parts.find((p) => p.id === t.partId)?.name || 'Unknown',
        content: t.content,
      }))

      const interactionsForPrompt = interactions
        .filter((i) => i.status === 'complete' && i.userResponse && i.partReply)
        .map((i) => ({
          partName: parts.find((p) => p.id === i.partId)?.name || 'Unknown',
          opening: i.partOpening,
          userResponse: i.userResponse!,
          reply: i.partReply!,
        }))

      const partsForPrompt = parts.map((p) => ({
        id: p.id,
        name: p.name,
        ifsRole: p.ifsRole,
      }))

      const entryTextForReflection = entry.intention
        ? `[Writer's intention: "${entry.intention}"]\n\n${entry.plainText}`
        : entry.plainText

      const messages = buildReflectionPrompt(
        entryTextForReflection,
        thoughtsForPrompt,
        interactionsForPrompt,
        profile ?? null,
        recentSummaries,
        partsForPrompt,
      )

      // 6. Single AI call (15s timeout for larger input)
      const response = await chatCompletion(messages, 15000, 800)

      // 7. Parse response
      const parsed = this.parseReflectionResponse(response)
      if (!parsed) return result

      // 8a. Save entry summary (with content hash for dedup)
      if (parsed.entrySummary) {
        const summary: EntrySummary = {
          id: generateId(),
          entryId,
          themes: parsed.entrySummary.themes || [],
          emotionalArc: parsed.entrySummary.emotionalArc || '',
          keyMoments: parsed.entrySummary.keyMoments || [],
          timestamp: Date.now(),
        }
        await db.entrySummaries.add({ ...summary, contentHash })
        result.entrySummary = summary
      }

      // 8b. Create reflection memories for parts that spoke
      if (parsed.partMemories) {
        for (const [partId, content] of Object.entries(parsed.partMemories)) {
          if (typeof content !== 'string' || !content.trim()) continue
          if (!parts.some((p) => p.id === partId)) continue
          await db.memories.add({
            id: generateId(),
            partId,
            entryId,
            content: content.trim(),
            type: 'reflection',
            timestamp: Date.now(),
          })
          result.memoriesCreated++
        }
      }

      // 8c. Create pattern memories for manager/self-role parts
      if (parsed.crossEntryPatterns && Array.isArray(parsed.crossEntryPatterns)) {
        const patternParts = parts.filter((p) => p.ifsRole === 'manager' || p.ifsRole === 'self')
        for (const pattern of parsed.crossEntryPatterns) {
          if (typeof pattern !== 'string' || !pattern.trim()) continue
          for (const pp of patternParts) {
            await db.memories.add({
              id: generateId(),
              partId: pp.id,
              entryId,
              content: pattern.trim(),
              type: 'pattern',
              timestamp: Date.now(),
            })
            result.memoriesCreated++
          }
        }
      }

      // 8d. Merge keyword suggestions into parts
      if (parsed.partKeywordSuggestions) {
        for (const [partId, keywords] of Object.entries(parsed.partKeywordSuggestions)) {
          if (!Array.isArray(keywords)) continue
          const part = parts.find((p) => p.id === partId)
          if (!part) continue
          const existing = part.learnedKeywords || []
          const merged = [...new Set([...existing, ...keywords.filter((k): k is string => typeof k === 'string')])]
          if (merged.length > existing.length) {
            await db.parts.update(partId, { learnedKeywords: merged })
          }
        }
      }

      // 8e. Update user profile
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
        result.profileUpdated = true
      }

      // 8f. Prune old memories per part
      await this.pruneMemories(parts)

      // 8g. Store quotable passages in entry summary
      if (parsed.quotablePassages && Array.isArray(parsed.quotablePassages) && result.entrySummary) {
        // We'll add quotable passages to the entry summary's keyMoments
        // (reusing existing field to avoid a schema change)
        const validPassages = parsed.quotablePassages.filter(
          (p): p is string => typeof p === 'string' && p.trim().length > 10
        )
        if (validPassages.length > 0 && result.entrySummary) {
          const updatedMoments = [...result.entrySummary.keyMoments, ...validPassages.map(p => `[quotable] ${p}`)]
          await db.entrySummaries.update(result.entrySummary.id, { keyMoments: updatedMoments })
          result.entrySummary.keyMoments = updatedMoments
        }
      }

      // 8h. Store unfinished threads in entry summary
      if (parsed.unfinishedThreads && Array.isArray(parsed.unfinishedThreads) && result.entrySummary) {
        const validThreads = parsed.unfinishedThreads.filter(
          (t): t is string => typeof t === 'string' && t.trim().length > 5
        )
        if (validThreads.length > 0) {
          const updatedMoments = [...(result.entrySummary.keyMoments || []), ...validThreads.map(t => `[thread] ${t}`)]
          await db.entrySummaries.update(result.entrySummary.id, { keyMoments: updatedMoments })
          result.entrySummary.keyMoments = updatedMoments
        }
      }

      // Set new fields on result
      if (parsed.quotablePassages) result.quotablePassages = parsed.quotablePassages
      if (parsed.unfinishedThreads) result.unfinishedThreads = parsed.unfinishedThreads

      // 9. Check if it's time for part growth
      const summaryCount = allSummaries.length + 1 // +1 for the one we just created
      if (summaryCount % 5 === 0) {
        // Dynamically import to avoid circular dependencies
        const { PartGrowthEngine } = await import('./partGrowthEngine')
        const growthEngine = new PartGrowthEngine()
        await growthEngine.growParts(parts, profile ?? null)
      }

      // 10. Check if it's time for a letter
      try {
        const totalEntries = await db.entries.count()
        const letterEngine = new LetterEngine()
        await letterEngine.checkForLetter(totalEntries, parts)
      } catch (error) {
        console.error('Letter check error:', error)
      }

      return result
    } catch (error) {
      console.error('Reflection error:', error)
      return result
    }
  }

  private parseReflectionResponse(response: string): {
    entrySummary?: { themes: string[]; emotionalArc: string; keyMoments: string[] }
    partMemories?: Record<string, string>
    profileUpdates?: {
      recurringThemes?: string[]; emotionalPatterns?: string[]
      avoidancePatterns?: string[]; growthSignals?: string[]
      innerLandscape?: string
    }
    crossEntryPatterns?: string[]
    partKeywordSuggestions?: Record<string, string[]>
    quotablePassages?: string[]
    unfinishedThreads?: string[]
  } | null {
    try {
      // Extract JSON from potential markdown code blocks
      const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, response]
      return JSON.parse(jsonMatch[1]!.trim())
    } catch {
      console.error('Failed to parse reflection response:', response.slice(0, 200))
      return null
    }
  }

  private async pruneMemories(parts: Part[]): Promise<void> {
    for (const part of parts) {
      const allMemories = await db.memories.where('partId').equals(part.id).toArray() as PartMemory[]

      for (const [type, cap] of Object.entries(MEMORY_CAPS)) {
        const typed = allMemories
          .filter((m) => (m.type ?? 'interaction') === type)
          .sort((a, b) => b.timestamp - a.timestamp)

        if (typed.length > cap) {
          const toDelete = typed.slice(cap)
          for (const mem of toDelete) {
            await db.memories.delete(mem.id)
          }
        }
      }
    }
  }
}

function mergeArrays(existing: string[], incoming: unknown, cap: number): string[] {
  if (!Array.isArray(incoming)) return existing
  const validated = incoming.filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
  const merged = [...new Set([...existing, ...validated])]
  return merged.slice(-cap)
}
