import type { GuidedExploration, UserProfile, EntrySummary } from '../types'
import { chatCompletion } from '../ai/openrouter'
import { db, generateId } from '../store/db'
import { getGlobalConfig } from '../store/globalConfig'
import { isGroundingActive } from '../hooks/useGroundingMode'

export class ExplorationEngine {
  private hasSuggested = false

  reset() {
    this.hasSuggested = false
  }

  shouldSuggest(): boolean {
    const config = getGlobalConfig()
    if (config?.features?.guidedExplorations !== true) return false
    if (this.hasSuggested) return false
    if (isGroundingActive()) return false
    if (config.explorations?.triggerOnNewEntry === false) return false
    return true
  }

  async generateExplorations(): Promise<GuidedExploration[]> {
    this.hasSuggested = true

    try {
      const config = getGlobalConfig()
      const maxPrompts = config?.explorations?.maxPrompts ?? 3

      // Load context
      const profile = await db.userProfile.get('current') as UserProfile | undefined
      const allSummaries = await db.entrySummaries.orderBy('timestamp').reverse().toArray() as EntrySummary[]
      const recentSummaries = allSummaries.slice(0, 5)

      // Need at least some context to generate meaningful prompts
      if (!profile && recentSummaries.length === 0) return []

      let context = ''
      if (profile) {
        const lines: string[] = []
        if (profile.innerLandscape) lines.push(`Inner landscape: ${profile.innerLandscape}`)
        if (profile.recurringThemes.length > 0) lines.push(`Recurring themes: ${profile.recurringThemes.join(', ')}`)
        if (profile.avoidancePatterns.length > 0) lines.push(`Avoidance patterns: ${profile.avoidancePatterns.join(', ')}`)
        if (profile.growthSignals.length > 0) lines.push(`Growth signals: ${profile.growthSignals.join(', ')}`)
        if (lines.length > 0) context += `Writer profile:\n${lines.join('\n')}\n\n`
      }

      if (recentSummaries.length > 0) {
        const summaryLines = recentSummaries.map((s) =>
          `- Themes: ${s.themes.join(', ')} | Arc: ${s.emotionalArc}`
        ).join('\n')
        context += `Recent entries:\n${summaryLines}`
      }

      const messages: { role: 'system' | 'user'; content: string }[] = [
        {
          role: 'system',
          content: `You generate personalized writing prompts for a diary writer. Based on their profile and recent entries, suggest ${maxPrompts} prompts that would be meaningful for them right now.

Each prompt should be a single sentence — an invitation, not a command. Aim for specificity over generality. Reference their actual themes, patterns, or avoidances when possible.

Respond with valid JSON only:
[
  {"prompt": "...", "source": "theme|thread|pattern|avoidance", "sourceDetail": "brief note on what inspired this prompt"}
]

Sources:
- "theme": inspired by a recurring theme
- "thread": inspired by an unfinished thread from a past entry
- "pattern": inspired by an emotional or behavioral pattern
- "avoidance": gently approaching something the writer tends to skip past`,
        },
        {
          role: 'user',
          content: context,
        },
      ]

      const response = await chatCompletion(messages, 10000, 300)

      // Parse JSON
      const jsonMatch = response.match(/\[[\s\S]*\]/)
      if (!jsonMatch) return []

      const parsed = JSON.parse(jsonMatch[0]) as { prompt: string; source: string; sourceDetail?: string }[]
      if (!Array.isArray(parsed)) return []

      return parsed.slice(0, maxPrompts).map((item) => ({
        id: generateId(),
        prompt: typeof item.prompt === 'string' ? item.prompt : '',
        source: (['theme', 'thread', 'pattern', 'avoidance'].includes(item.source)
          ? item.source
          : 'theme') as GuidedExploration['source'],
        sourceDetail: typeof item.sourceDetail === 'string' ? item.sourceDetail : undefined,
      })).filter((e) => e.prompt.length > 0)
    } catch (error) {
      console.error('Exploration generation error:', error)
      return []
    }
  }
}
