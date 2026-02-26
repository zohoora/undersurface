import { getGlobalConfig } from '../store/globalConfig'
import { db, generateId } from '../store/db'
import { chatCompletion } from '../ai/openrouter'
import { SHARED_INSTRUCTIONS, languageDirective } from '../ai/partPrompts'
import { sanitizeForPrompt, UNTRUSTED_CONTENT_PREAMBLE } from '../ai/promptSafety'
import { getPartDisplayName } from '../i18n'
import type { Part, EntrySummary, UserProfile, PartLetter, PartMemory } from '../types'

export class LetterEngine {
  async checkForLetter(entryCount: number, parts: Part[]): Promise<PartLetter | null> {
    try {
      const config = getGlobalConfig()
      if (config?.features.lettersFromParts !== true) return null

      const letterTriggerEntries = config.engagement?.letterTriggerEntries ?? 10
      const letterMinParts = config.engagement?.letterMinParts ?? 2

      if (entryCount % letterTriggerEntries !== 0) return null

      // Select top parts by memory count (most active)
      const partsWithActivity = await Promise.all(
        parts.map(async (part) => {
          const memories = await db.memories.where('partId').equals(part.id).toArray() as PartMemory[]
          return { part, memoryCount: memories.length }
        })
      )

      const topParts = partsWithActivity
        .sort((a, b) => b.memoryCount - a.memoryCount)
        .slice(0, letterMinParts)
        .map((p) => p.part)

      if (topParts.length < letterMinParts) return null

      // Load recent entry summaries and user profile
      const allSummaries = await db.entrySummaries
        .orderBy('timestamp')
        .reverse()
        .toArray() as EntrySummary[]
      const recentSummaries = allSummaries.slice(0, 10)
      const profile = await db.userProfile.get('current') as UserProfile | undefined

      if (recentSummaries.length === 0) return null

      const partNames = topParts.map((p) => `${getPartDisplayName(p)} (${p.ifsRole})`).join(', ')

      const summaryContext = recentSummaries.map((s) =>
        `- Themes: ${s.themes.map(sanitizeForPrompt).join(', ')} | Arc: ${sanitizeForPrompt(s.emotionalArc)} | Key moments: ${s.keyMoments.map(sanitizeForPrompt).join(', ')}`
      ).join('\n')

      let profileContext = ''
      if (profile) {
        const lines: string[] = []
        if (profile.innerLandscape) lines.push(`Inner landscape: ${sanitizeForPrompt(profile.innerLandscape)}`)
        if (profile.recurringThemes.length > 0) lines.push(`Recurring themes: ${profile.recurringThemes.map(sanitizeForPrompt).join(', ')}`)
        if (profile.growthSignals.length > 0) lines.push(`Growth signals: ${profile.growthSignals.map(sanitizeForPrompt).join(', ')}`)
        if (lines.length > 0) {
          profileContext = `\n\nWriter profile:\n${lines.join('\n')}`
        }
      }

      const messages: { role: 'system' | 'user'; content: string }[] = [
        {
          role: 'system',
          content: `${SHARED_INSTRUCTIONS}

You are writing a letter to a diary writer from the perspective of their inner parts. The letter should be warm, personal, and reference specific things from their writing. Write as a collaborative voice from these parts: ${partNames}. 3-5 paragraphs. Reference specific themes and growth you've witnessed. Sign off with the part names.${languageDirective()}${UNTRUSTED_CONTENT_PREAMBLE}`,
        },
        {
          role: 'user',
          content: `Recent entry summaries:\n${summaryContext}${profileContext}`,
        },
      ]

      const content = await chatCompletion(messages, 20000, 800)

      const letter: PartLetter = {
        id: generateId(),
        partIds: topParts.map((p) => p.id),
        content,
        triggerType: 'milestone',
        createdAt: Date.now(),
        isRead: false,
      }

      await db.letters.add(letter)

      return letter
    } catch (error) {
      console.error('Letter generation error:', error)
      return null
    }
  }
}
