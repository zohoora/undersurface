import { getGlobalConfig } from '../store/globalConfig'
import { db } from '../store/db'
import type { EntrySummary } from '../types'

const UNFINISHED_SIGNALS = [
  'unfinished',
  'began to explore',
  'started writing about',
  'trailed off',
  'didn\'t finish',
  'cut short',
  'left off',
  'started to say',
  'almost wrote',
  'stopped before',
  'incomplete',
  'hinted at',
  'touched on',
]

export class ThreadEngine {
  async findUnfinishedThread(
    currentText: string,
  ): Promise<{ theme: string, entryId: string, summary: string } | null> {
    const config = getGlobalConfig()
    if (config?.features.unfinishedThreads !== true) return null

    const threadMaxAge = config.engagement?.threadMaxAge ?? 30
    const threadChance = config.engagement?.threadChance ?? 0.15

    if (Math.random() > threadChance) return null

    try {
      const allSummaries = await db.entrySummaries.orderBy('timestamp').reverse().toArray() as EntrySummary[]

      const now = Date.now()
      const maxAgeMs = threadMaxAge * 24 * 60 * 60 * 1000

      const recent = allSummaries.filter((s) => now - s.timestamp < maxAgeMs)

      if (recent.length < 2) return null

      // Strategy 1: Look for entries with unfinished signals in keyMoments or emotionalArc
      const unfinished = this.findUnfinishedSignals(recent)
      if (unfinished) return unfinished

      // Strategy 2: Look for themes that appear only once (not continued)
      const orphanThread = this.findOrphanThemes(recent, currentText)
      if (orphanThread) return orphanThread

      return null
    } catch (error) {
      console.error('ThreadEngine error:', error)
      return null
    }
  }

  private findUnfinishedSignals(
    summaries: EntrySummary[],
  ): { theme: string, entryId: string, summary: string } | null {
    for (const summary of summaries) {
      // Check keyMoments for unfinished signals
      for (const moment of summary.keyMoments) {
        const lowerMoment = moment.toLowerCase()
        const hasSignal = UNFINISHED_SIGNALS.some((signal) => lowerMoment.includes(signal))
        if (hasSignal) {
          const theme = summary.themes[0] ?? 'an unfinished thought'
          return {
            theme,
            entryId: summary.entryId,
            summary: `${summary.emotionalArc} — ${moment}`,
          }
        }
      }

      // Check emotionalArc for unfinished signals
      const lowerArc = summary.emotionalArc.toLowerCase()
      const arcHasSignal = UNFINISHED_SIGNALS.some((signal) => lowerArc.includes(signal))
      if (arcHasSignal) {
        const theme = summary.themes[0] ?? 'something left unsaid'
        return {
          theme,
          entryId: summary.entryId,
          summary: summary.emotionalArc,
        }
      }
    }

    return null
  }

  private findOrphanThemes(
    summaries: EntrySummary[],
    currentText: string,
  ): { theme: string, entryId: string, summary: string } | null {
    // Count theme occurrences across all summaries
    const themeCounts = new Map<string, { count: number, summary: EntrySummary }>()

    for (const summary of summaries) {
      for (const theme of summary.themes) {
        const lower = theme.toLowerCase()
        const existing = themeCounts.get(lower)
        if (existing) {
          existing.count++
        } else {
          themeCounts.set(lower, { count: 1, summary })
        }
      }
    }

    // Find themes that appeared only once — these are potential unfinished threads
    const orphans = [...themeCounts.entries()]
      .filter(([, data]) => data.count === 1)
      .map(([theme, data]) => ({ theme, summary: data.summary }))

    if (orphans.length === 0) return null

    // Prefer orphans that have some relevance to current text
    const currentWords = new Set(
      currentText
        .toLowerCase()
        .replace(/[^a-z\s]/g, '')
        .split(/\s+/)
        .filter((w) => w.length > 3)
    )

    // Sort by relevance to current text, then by recency
    const scored = orphans.map((o) => {
      const themeWords = o.theme.split(/\s+/).filter((w) => w.length > 3)
      const relevance = themeWords.filter((w) => currentWords.has(w)).length
      return { ...o, relevance }
    })

    scored.sort((a, b) => b.relevance - a.relevance || b.summary.timestamp - a.summary.timestamp)

    const best = scored[0]
    if (!best) return null

    return {
      theme: best.theme,
      entryId: best.summary.entryId,
      summary: best.summary.emotionalArc,
    }
  }
}
