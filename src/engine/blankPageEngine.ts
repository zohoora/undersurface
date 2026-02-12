import { getGlobalConfig } from '../store/globalConfig'
import { db } from '../store/db'
import { chatCompletion } from '../ai/openrouter'
import { SHARED_INSTRUCTIONS, languageDirective } from '../ai/partPrompts'
import { getPartDisplayName } from '../i18n'
import type { Part, UserProfile } from '../types'

export class BlankPageEngine {
  private hasTriggeredThisEntry: boolean = false

  reset(): void {
    this.hasTriggeredThisEntry = false
  }

  shouldSpeak(): boolean {
    const config = getGlobalConfig()
    if (config?.features.blankPageSpeaks !== true) return false
    if (this.hasTriggeredThisEntry) return false
    return true
  }

  async speak(parts: Part[]): Promise<{
    partId: string
    partName: string
    partColor: string
    partColorLight: string
    content: string
  } | null> {
    if (this.hasTriggeredThisEntry) return null

    this.hasTriggeredThisEntry = true

    if (parts.length === 0) return null

    // Select a part, weighted toward recently active ones
    const part = this.selectPart(parts)

    try {
      // Load user profile for context
      const profile = await db.userProfile.get('current') as UserProfile | undefined

      let systemContent = `${SHARED_INSTRUCTIONS}\n\nYou are ${part.name}. The page is empty — the writer hasn't started yet. Say something gentle and brief to invite them to begin writing. One sentence only. Don't be cliche. Don't say "the page is blank" or "start anywhere". Be specific to your character.${languageDirective()}`

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
        { role: 'user', content: 'The writer is staring at a blank page.' },
      ]

      const content = await chatCompletion(messages, 8000, 100)

      return {
        partId: part.id,
        partName: getPartDisplayName(part),
        partColor: part.color,
        partColorLight: part.colorLight,
        content,
      }
    } catch (error) {
      console.error('BlankPageEngine error:', error)
      return null
    }
  }

  private selectPart(parts: Part[]): Part {
    // Weight by recency — more recently active parts are slightly favored
    const now = Date.now()
    const weighted = parts.map((p) => {
      const age = now - (p.lastActiveAt ?? p.createdAt)
      // Inverse age: more recent = higher weight, but with a floor
      const weight = 1 / (1 + age / (24 * 60 * 60 * 1000))
      return { part: p, weight }
    })

    const totalWeight = weighted.reduce((sum, w) => sum + w.weight, 0)
    let roll = Math.random() * totalWeight

    for (const { part, weight } of weighted) {
      roll -= weight
      if (roll <= 0) return part
    }

    // Fallback — should not normally reach here
    return parts[0]!
  }
}
