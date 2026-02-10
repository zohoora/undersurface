import type { Part } from '../types'
import { buildEmergenceAnalysis, SHARED_INSTRUCTIONS } from '../ai/partPrompts'
import { chatCompletion } from '../ai/openrouter'
import { db, generateId } from '../store/db'

interface EmergenceResult {
  detected: boolean
  part?: Part
  firstWords?: string
}

export class EmergenceEngine {
  private lastCheck: number = 0
  private checkCount: number = 0
  private readonly CHECK_INTERVAL = 120000 // 2 minutes
  private readonly MIN_TEXT_LENGTH = 300
  private readonly MAX_EMERGED_PARTS = 4

  async checkForEmergence(
    currentText: string,
    existingParts: Part[],
  ): Promise<EmergenceResult> {
    const now = Date.now()

    if (now - this.lastCheck < this.CHECK_INTERVAL) {
      return { detected: false }
    }

    if (currentText.length < this.MIN_TEXT_LENGTH) {
      return { detected: false }
    }

    const emergedCount = existingParts.filter((p) => !p.isSeeded).length
    if (emergedCount >= this.MAX_EMERGED_PARTS) {
      return { detected: false }
    }

    this.lastCheck = now
    this.checkCount++

    // Don't check too early in a session
    if (this.checkCount < 3) {
      return { detected: false }
    }

    try {
      const messages = buildEmergenceAnalysis(currentText, existingParts)
      const response = await chatCompletion(messages)

      const parsed = JSON.parse(response)

      if (!parsed.detected) {
        return { detected: false }
      }

      const newPartId = generateId()
      const newPart: Part = {
        id: newPartId,
        name: parsed.name,
        color: parsed.color,
        colorLight: parsed.color + '25',
        ifsRole: parsed.ifsRole,
        voiceDescription: parsed.voice,
        concern: parsed.concern,
        systemPrompt: buildEmergentPartPrompt(parsed),
        isSeeded: false,
        createdAt: Date.now(),
        memories: [],
      }

      // Persist the new part
      await db.parts.add({
        id: newPart.id,
        name: newPart.name,
        color: newPart.color,
        colorLight: newPart.colorLight,
        ifsRole: newPart.ifsRole,
        voiceDescription: newPart.voiceDescription,
        concern: newPart.concern,
        systemPrompt: newPart.systemPrompt,
        isSeeded: false,
        createdAt: newPart.createdAt,
      })

      return {
        detected: true,
        part: newPart,
        firstWords: parsed.firstWords,
      }
    } catch {
      return { detected: false }
    }
  }
}

function buildEmergentPartPrompt(parsed: {
  name: string
  concern: string
  voice: string
  ifsRole: string
}): string {
  return `${SHARED_INSTRUCTIONS}

You are ${parsed.name}. You are a newly emerged part — you have just been recognized for the first time. You may feel tentative, new, finding your voice.

Your concern: ${parsed.concern}
Your voice: ${parsed.voice}
Your IFS role: ${parsed.ifsRole}

Speak naturally in this voice. You are not performing. You are real.`
}
