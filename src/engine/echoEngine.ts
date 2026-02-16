import { getGlobalConfig } from '../store/globalConfig'
import { db } from '../store/db'
import { extractWords } from '../utils/text'
import type { EntrySummary } from '../types'

export class EchoEngine {
  private echoesThisSession: number = 0

  reset(): void {
    this.echoesThisSession = 0
  }

  async findEcho(currentText: string): Promise<{ text: string, entryId: string, date: number } | null> {
    const config = getGlobalConfig()
    if (config?.features.echoes !== true) return null

    const echoChance = config.engagement?.echoChance ?? 0.1
    const echoMaxAge = config.engagement?.echoMaxAge ?? 90
    const echoMaxPerSession = config.engagement?.echoMaxPerSession ?? 3

    if (this.echoesThisSession >= echoMaxPerSession) return null

    if (Math.random() > echoChance) return null

    try {
      const allSummaries = await db.entrySummaries.orderBy('timestamp').reverse().toArray() as EntrySummary[]

      const now = Date.now()
      const minAgeMs = 3 * 24 * 60 * 60 * 1000
      const maxAgeMs = echoMaxAge * 24 * 60 * 60 * 1000

      const qualifying = allSummaries.filter((s) => {
        const age = now - s.timestamp
        return age > minAgeMs && age < maxAgeMs
      })

      if (qualifying.length === 0) return null

      // Find thematic overlap with currentText
      const currentWords = extractWords(currentText)
      let bestScore = 0
      let bestSummary: EntrySummary | null = null

      for (const summary of qualifying) {
        const summaryWords = new Set([
          ...summary.themes.flatMap((t) => extractWords(t)),
          ...summary.keyMoments.flatMap((m) => extractWords(m)),
        ])
        const overlap = currentWords.filter((w) => summaryWords.has(w)).length
        if (overlap > bestScore) {
          bestScore = overlap
          bestSummary = summary
        }
      }

      if (!bestSummary || bestScore === 0) return null

      // Load the full entry
      const entry = await db.entries.get(bestSummary.entryId) as {
        id: string
        plainText: string
        createdAt: number
      } | undefined

      if (!entry || !entry.plainText) return null

      const fragment = this.extractFragment(entry.plainText)
      if (!fragment) return null

      this.echoesThisSession++

      return {
        text: fragment,
        entryId: entry.id,
        date: entry.createdAt,
      }
    } catch (error) {
      console.error('EchoEngine error:', error)
      return null
    }
  }

  private extractFragment(text: string): string | null {
    const sentences = text.match(/[^.!?]+[.!?]+/g)
    if (!sentences || sentences.length === 0) return null

    // Pick 1-2 sentences from the text — prefer emotionally rich areas (middle-to-end)
    const startIndex = Math.min(
      Math.floor(sentences.length * 0.4),
      sentences.length - 1,
    )
    const fragment = sentences.slice(startIndex, startIndex + 2).join(' ').trim()

    if (fragment.length < 20 || fragment.length > 300) return null

    return fragment
  }
}
