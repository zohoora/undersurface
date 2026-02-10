import { getGlobalConfig } from '../store/globalConfig'
import { db } from '../store/db'
import type { EntrySummary } from '../types'

export class QuoteEngine {
  async findQuote(currentText: string): Promise<{ text: string, entryId: string } | null> {
    const config = getGlobalConfig()
    if (config?.features.partsQuoting !== true) return null

    const quoteChance = config.partIntelligence?.quoteChance ?? 0.15
    const quoteMinAge = config.partIntelligence?.quoteMinAge ?? 3

    if (Math.random() > quoteChance) return null

    try {
      const allSummaries = await db.entrySummaries.orderBy('timestamp').reverse().toArray() as EntrySummary[]

      const minAgeMs = quoteMinAge * 24 * 60 * 60 * 1000
      const cutoff = Date.now() - minAgeMs
      const qualifying = allSummaries.filter((s) => s.timestamp < cutoff)

      if (qualifying.length === 0) return null

      // Take up to 5 recent qualifying summaries
      const candidates = qualifying.slice(0, 5)

      // Simple word intersection scoring
      const currentWords = this.extractWords(currentText)
      let bestScore = 0
      let bestSummary: EntrySummary | null = null

      for (const summary of candidates) {
        const summaryWords = new Set([
          ...summary.themes.flatMap((t) => this.extractWords(t)),
          ...summary.keyMoments.flatMap((m) => this.extractWords(m)),
        ])
        const overlap = currentWords.filter((w) => summaryWords.has(w)).length
        if (overlap > bestScore) {
          bestScore = overlap
          bestSummary = summary
        }
      }

      if (!bestSummary || bestScore === 0) return null

      // Load the full entry text
      const entry = await db.entries.get(bestSummary.entryId) as { id: string, plainText: string } | undefined
      if (!entry || !entry.plainText) return null

      const passage = this.extractPassage(entry.plainText)
      if (!passage) return null

      return { text: passage, entryId: entry.id }
    } catch (error) {
      console.error('QuoteEngine error:', error)
      return null
    }
  }

  private extractWords(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^a-z\s]/g, '')
      .split(/\s+/)
      .filter((w) => w.length > 3)
  }

  private extractPassage(text: string): string | null {
    // Split into sentences and pick a 1-2 sentence passage
    const sentences = text.match(/[^.!?]+[.!?]+/g)
    if (!sentences || sentences.length === 0) return null

    // Pick sentences from the middle where the writing tends to be richest
    const midIndex = Math.floor(sentences.length / 2)
    const start = Math.max(0, midIndex - 1)
    const passage = sentences.slice(start, start + 2).join(' ').trim()

    if (passage.length < 20 || passage.length > 300) return null

    return passage
  }
}
