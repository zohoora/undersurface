import { getGlobalConfig } from '../store/globalConfig'
import { db, generateId } from '../store/db'
import { chatCompletion } from '../ai/openrouter'
import { SHARED_INSTRUCTIONS } from '../ai/partPrompts'
import type { Part, UserProfile, EntryFossil } from '../types'

export class FossilEngine {
  async checkForFossil(
    entryId: string,
    entryCreatedAt: number,
    parts: Part[],
  ): Promise<EntryFossil | null> {
    const config = getGlobalConfig()
    if (config?.features.entryFossils !== true) return null

    const fossilMinAge = config.engagement?.fossilMinAge ?? 14
    const fossilChance = config.engagement?.fossilChance ?? 0.3

    // Check entry age
    const daysSince = Math.floor((Date.now() - entryCreatedAt) / (24 * 60 * 60 * 1000))
    if (daysSince < fossilMinAge) return null

    // Random check
    if (Math.random() > fossilChance) return null

    try {
      // Check if a fossil already exists for this entry
      const existing = await db.fossils.where('entryId').equals(entryId).toArray() as EntryFossil[]
      if (existing.length > 0) return existing[0]!

      // Load the entry text
      const entry = await db.entries.get(entryId) as { plainText: string } | undefined
      if (!entry || !entry.plainText || entry.plainText.trim().length < 50) return null

      // Select the most relevant part by keyword overlap
      const part = this.selectPart(entry.plainText, parts)
      if (!part) return null

      // Load user profile for context
      const profile = await db.userProfile.get('current') as UserProfile | undefined

      let systemContent = `${SHARED_INSTRUCTIONS}\n\nYou are ${part.name}. You are re-reading an old diary entry written ${daysSince} days ago. Write a brief reflection (1-2 sentences) on what you notice now — how things have changed, what stands out, what the writer might not see. Speak as yourself.`

      if (profile) {
        const profileLines: string[] = []
        if (profile.innerLandscape) profileLines.push(profile.innerLandscape)
        if (profile.recurringThemes.length > 0) {
          profileLines.push(`Recurring themes: ${profile.recurringThemes.join(', ')}`)
        }
        if (profileLines.length > 0) {
          systemContent += `\n\nWhat you know about this writer:\n${profileLines.join('\n')}`
        }
      }

      const messages: { role: 'system' | 'user', content: string }[] = [
        { role: 'system', content: systemContent },
        { role: 'user', content: entry.plainText },
      ]

      const commentary = await chatCompletion(messages, 10000, 150)

      const fossil: EntryFossil = {
        id: generateId(),
        entryId,
        partId: part.id,
        commentary,
        createdAt: Date.now(),
      }

      await db.fossils.add(fossil)

      return fossil
    } catch (error) {
      console.error('FossilEngine error:', error)
      return null
    }
  }

  private selectPart(entryText: string, parts: Part[]): Part | null {
    if (parts.length === 0) return null

    const entryWords = new Set(
      entryText
        .toLowerCase()
        .replace(/[^a-z\s]/g, '')
        .split(/\s+/)
        .filter((w) => w.length > 3)
    )

    let bestScore = -1
    let bestPart: Part | null = null

    for (const part of parts) {
      const keywords = [
        ...part.concern.toLowerCase().split(/[\s,]+/).filter((w) => w.length > 3),
        ...(part.learnedKeywords ?? []).map((k) => k.toLowerCase()),
      ]

      const overlap = keywords.filter((k) => entryWords.has(k)).length
      if (overlap > bestScore) {
        bestScore = overlap
        bestPart = part
      }
    }

    // If no keyword overlap, return a random part
    if (bestScore === 0) {
      const index = Math.floor(Math.random() * parts.length)
      return parts[index] ?? null
    }

    return bestPart
  }
}
