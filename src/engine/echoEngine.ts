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
      const allSummaries = await db.entrySummaries.orderBy('timestamp').reverse().toArray()

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

      // Source the fragment from the summary's own keyMoments. Summaries store
      // the SESSION id in entryId, and the diary `entries` collection is no
      // longer written to — the previous `db.entries.get(entryId)` was always
      // undefined, which is why echoes were silently dead. keyMoments are the
      // LLM-distilled emotional highlights of that past session, so they make a
      // more resonant echo than raw text would, with no extra read.
      const fragment = this.pickFragment(bestSummary.keyMoments)
      if (!fragment) return null

      this.echoesThisSession++

      return {
        text: fragment,
        entryId: bestSummary.entryId,
        date: bestSummary.timestamp,
      }
    } catch (error) {
      console.error('EchoEngine error:', error)
      return null
    }
  }

  // Choose the richest keyMoment within display bounds: prefer the longest that
  // fits, so a one-word moment doesn't win over a full resonant sentence.
  private pickFragment(keyMoments: string[]): string | null {
    const candidates = keyMoments
      .map((m) => m.trim())
      .filter((m) => m.length >= 20 && m.length <= 300)
    if (candidates.length === 0) return null
    return candidates.reduce((longest, m) => (m.length > longest.length ? m : longest))
  }
}
