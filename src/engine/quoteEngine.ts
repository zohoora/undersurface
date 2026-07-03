import { getGlobalConfig } from '../store/globalConfig'
import { db } from '../store/db'
import { extractWords } from '../utils/text'
import type { EntrySummary } from '../types'

export class QuoteEngine {
  async findQuote(currentText: string): Promise<{ text: string, entryId: string } | null> {
    const config = getGlobalConfig()
    if (config?.features.partsQuoting !== true) return null

    const quoteChance = config.partIntelligence?.quoteChance ?? 0.15
    const quoteMinAge = config.partIntelligence?.quoteMinAge ?? 3

    if (Math.random() > quoteChance) return null

    try {
      // Bounded read: only the 5 most-recent qualifying summaries are used, and
      // this runs on every pause. 120 newest is far more than enough while
      // avoiding a full-collection scan.
      const allSummaries = await db.entrySummaries.orderBy('timestamp').reverse().limit(120).toArray()

      const minAgeMs = quoteMinAge * 24 * 60 * 60 * 1000
      const cutoff = Date.now() - minAgeMs
      const qualifying = allSummaries.filter((s) => s.timestamp < cutoff)

      if (qualifying.length === 0) return null

      // Take up to 5 recent qualifying summaries
      const candidates = qualifying.slice(0, 5)

      // Simple word intersection scoring
      const currentWords = extractWords(currentText)
      let bestScore = 0
      let bestSummary: EntrySummary | null = null

      for (const summary of candidates) {
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

      // Quote from the summary's keyMoments. entryId holds a SESSION id and the
      // diary `entries` collection is no longer written, so the old
      // `db.entries.get(entryId)` was always undefined — part-quoting was dead.
      const passage = this.pickPassage(bestSummary.keyMoments)
      if (!passage) return null

      return { text: passage, entryId: bestSummary.entryId }
    } catch (error) {
      console.error('QuoteEngine error:', error)
      return null
    }
  }

  // Prefer the longest keyMoment within display bounds.
  private pickPassage(keyMoments: string[]): string | null {
    const candidates = keyMoments
      .map((m) => m.trim())
      .filter((m) => m.length >= 20 && m.length <= 300)
    if (candidates.length === 0) return null
    return candidates.reduce((longest, m) => (m.length > longest.length ? m : longest))
  }
}
