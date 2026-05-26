import type { IFSRole, Part } from '../types'
import { buildEmergenceAnalysis, SHARED_INSTRUCTIONS } from '../ai/partPrompts'
import { chatCompletion } from '../ai/openrouter'
import { db, generateId } from '../store/db'
import { engineLog } from '../services/diagnostics'

interface EmergenceResult {
  detected: boolean
  part?: Part
  firstWords?: string
}

// All fields optional because the LLM is the source of truth for this shape
// and we can't trust it to populate every field. Caller checks `detected`
// first and only reads the rest when true.
interface ParsedEmergence {
  detected?: boolean
  name?: string
  color?: string
  ifsRole?: string
  voice?: string
  concern?: string
  firstWords?: string
}

const VALID_IFS_ROLES: ReadonlySet<IFSRole> = new Set(['protector', 'exile', 'manager', 'firefighter', 'self'])

function isValidIfsRole(value: string | undefined): value is IFSRole {
  return typeof value === 'string' && (VALID_IFS_ROLES as ReadonlySet<string>).has(value)
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
      // JSON output (detected/name/color/ifsRole/voice/concern/firstWords) — bumped
      // budget from default 150 (too tight for full part definition).
      const response = await chatCompletion(messages, 30000, 500, 'none')

      const parsed = parseEmergenceResponse(response)
      if (!parsed || !parsed.detected) {
        return { detected: false }
      }

      // The LLM said `detected: true` — require the minimum fields needed to
      // build a Part. If any are missing or `ifsRole` is outside the IFS
      // taxonomy, treat as no-emergence rather than creating a malformed
      // Part. Logged so we can see how often the model claims detection
      // without supplying a usable payload.
      if (!parsed.name || !parsed.color || !parsed.voice || !parsed.concern || !isValidIfsRole(parsed.ifsRole)) {
        engineLog('warn', 'emergence.parse_failed', 'emergence detected=true but payload is incomplete or invalid', {
          extra: {
            hasName: Boolean(parsed.name),
            hasColor: Boolean(parsed.color),
            hasVoice: Boolean(parsed.voice),
            hasConcern: Boolean(parsed.concern),
            validIfsRole: isValidIfsRole(parsed.ifsRole),
          },
        })
        return { detected: false }
      }

      const ifsRole: IFSRole = parsed.ifsRole
      const newPartId = generateId()
      const newPart: Part = {
        id: newPartId,
        name: parsed.name,
        color: parsed.color,
        colorLight: parsed.color + '25',
        ifsRole,
        voiceDescription: parsed.voice,
        concern: parsed.concern,
        systemPrompt: buildEmergentPartPrompt({
          name: parsed.name,
          concern: parsed.concern,
          voice: parsed.voice,
          ifsRole,
        }),
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

// Strip optional ```json ... ``` markdown fence (gpt-5.5 wraps JSON in code
// blocks by default — same defensive pattern as sessionReflectionEngine and
// partGrowthEngine). Returns null + logs telemetry on parse failure so we
// can see how often the model misbehaves rather than silently dropping
// emergence candidates as the previous bare `JSON.parse` did.
function parseEmergenceResponse(response: string): ParsedEmergence | null {
  try {
    const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, response]
    return JSON.parse(jsonMatch[1]!.trim()) as ParsedEmergence
  } catch {
    engineLog('warn', 'emergence.parse_failed', 'failed to parse emergence response as JSON', {
      extra: { responseLength: response.length },
    })
    return null
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
