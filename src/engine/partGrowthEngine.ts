import type { Part, PartMemory, UserProfile, EmotionalTone } from '../types'
import { buildGrowthPrompt } from '../ai/partPrompts'
import { chatCompletion } from '../ai/openrouter'
import { db } from '../store/db'

const VALID_EMOTIONS: EmotionalTone[] = [
  'neutral', 'tender', 'anxious', 'angry', 'sad',
  'joyful', 'contemplative', 'fearful', 'hopeful', 'conflicted',
]

export class PartGrowthEngine {
  async growParts(parts: Part[], profile: UserProfile | null): Promise<void> {
    try {
      // Load last 10 reflection+pattern memories per part
      const partsForPrompt = await Promise.all(
        parts.map(async (p) => {
          const allMemories = await db.memories.where('partId').equals(p.id).toArray() as PartMemory[]
          const relevant = allMemories
            .filter((m) => m.type === 'reflection' || m.type === 'pattern')
            .sort((a, b) => b.timestamp - a.timestamp)
            .slice(0, 10)
            .map((m) => m.content)

          return {
            id: p.id,
            name: p.name,
            ifsRole: p.ifsRole,
            concern: p.concern,
            memories: relevant,
          }
        }),
      )

      // Only grow parts that have accumulated enough experience
      const partsWithExperience = partsForPrompt.filter((p) => p.memories.length >= 2)
      if (partsWithExperience.length === 0) return

      const messages = buildGrowthPrompt(partsWithExperience, profile)
      const response = await chatCompletion(messages, 15000, 600)

      const parsed = this.parseGrowthResponse(response)
      if (!parsed?.partGrowth) return

      for (const [partId, growth] of Object.entries(parsed.partGrowth)) {
        const part = parts.find((p) => p.id === partId)
        if (!part) continue

        const updates: Record<string, unknown> = {
          growthVersion: (part.growthVersion || 0) + 1,
          lastGrowthAt: Date.now(),
        }

        if (typeof growth.promptAddition === 'string' && growth.promptAddition.trim()) {
          updates.systemPromptAddition = growth.promptAddition.trim()
        }

        if (Array.isArray(growth.keywords)) {
          const existing = part.learnedKeywords || []
          const newKw = growth.keywords.filter((k): k is string => typeof k === 'string')
          updates.learnedKeywords = [...new Set([...existing, ...newKw])]
        }

        if (Array.isArray(growth.emotions)) {
          const existing = part.learnedEmotions || []
          const newEm = growth.emotions.filter(
            (e): e is EmotionalTone => typeof e === 'string' && VALID_EMOTIONS.includes(e as EmotionalTone),
          )
          updates.learnedEmotions = [...new Set([...existing, ...newEm])]
        }

        await db.parts.update(partId, updates)
      }
    } catch (error) {
      console.error('Part growth error:', error)
    }
  }

  private parseGrowthResponse(response: string): {
    partGrowth: Record<string, {
      promptAddition?: string
      keywords?: string[]
      emotions?: string[]
    }>
  } | null {
    try {
      const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, response]
      return JSON.parse(jsonMatch[1]!.trim())
    } catch {
      console.error('Failed to parse growth response:', response.slice(0, 200))
      return null
    }
  }
}
