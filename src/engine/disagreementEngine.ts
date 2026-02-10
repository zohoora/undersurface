import { getGlobalConfig } from '../store/globalConfig'
import { chatCompletion } from '../ai/openrouter'
import type { Part } from '../types'
import type { IFSRole } from '../types'

const ROLE_OPPOSITION: Record<IFSRole, IFSRole[]> = {
  protector: ['exile'],
  exile: ['protector'],
  manager: ['firefighter'],
  firefighter: ['manager'],
  self: [],
}

export class DisagreementEngine {
  private lastDisagreementTime: number = 0

  shouldDisagree(originalPart: Part, allParts: Part[]): Part | null {
    const config = getGlobalConfig()
    if (config?.features.partsDisagreeing !== true) return null

    const disagreeChance = config.partIntelligence?.disagreeChance ?? 0.1
    const disagreeMinParts = config.partIntelligence?.disagreeMinParts ?? 3

    if (Math.random() > disagreeChance) return null

    if (allParts.length < disagreeMinParts) return null

    // Rate limit: max 1 per 15 minutes
    const now = Date.now()
    const fifteenMinutes = 15 * 60 * 1000
    if (now - this.lastDisagreementTime < fifteenMinutes) return null

    // Find a part with an opposing role
    const opposingRoles = ROLE_OPPOSITION[originalPart.ifsRole] || []
    if (opposingRoles.length === 0) return null

    const candidates = allParts.filter(
      (p) => p.id !== originalPart.id && opposingRoles.includes(p.ifsRole)
    )

    if (candidates.length === 0) return null

    // Pick a random opposing part
    const index = Math.floor(Math.random() * candidates.length)
    return candidates[index] ?? null
  }

  async generateDisagreement(
    disagreePart: Part,
    originalThought: string,
    currentText: string,
  ): Promise<string> {
    const messages: { role: 'system' | 'user', content: string }[] = [
      {
        role: 'system',
        content: `${disagreePart.systemPrompt}\n\nAnother part just said: "${originalThought}"\n\nYou see things differently. Offer your perspective — not to argue, but because you genuinely see something the other part missed. Be brief and true to your voice. 1-2 sentences only.`,
      },
      {
        role: 'user',
        content: `The writer is journaling. Here is what they have written:\n\n---\n${currentText}\n---\n\nRespond with your different perspective on what the other part said.`,
      },
    ]

    try {
      const response = await chatCompletion(messages, 10000, 150)
      this.lastDisagreementTime = Date.now()
      return response
    } catch (error) {
      console.error('DisagreementEngine error:', error)
      return ''
    }
  }
}
