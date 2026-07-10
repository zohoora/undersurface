import { OPENAI_CHAT_MODEL } from '../shared/models.js'
import {
  CRISIS_CLASSIFIER_PROMPT,
  CRISIS_RESPONSE_FORMAT,
} from '../shared/crisisClassifier.js'
import { sanitizeSmsFieldNote, sanitizeSmsReply } from './field.js'
import type { SmsImageInput } from './media.js'
import { buildSmsSystemPrompt, wrapSmsHistory } from './prompts.js'
import {
  COMPANION_RESPONSE_MODES,
  type CompanionResponseMode,
  type SharedCompanionContext,
} from '../shared/companionKernel.js'

const OPENAI_CRISIS_MODEL = 'gpt-5-nano'

export interface SmsHistoryMessage {
  direction: 'inbound' | 'outbound'
  body: string
  createdAt: number
}

export interface CrisisResult {
  risk: 0 | 1 | 2
  reason?: string
}

type FetchLike = typeof fetch

const SMS_TURN_RESPONSE_FORMAT = {
  type: 'json_schema' as const,
  json_schema: {
    name: 'sms_turn',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        reply: { type: 'string' },
        save: { type: 'boolean' },
        field_note: { type: ['string', 'null'] },
        visual_risk: { type: 'integer', enum: [0, 1, 2] },
        response_mode: { type: 'string', enum: COMPANION_RESPONSE_MODES },
      },
      required: ['reply', 'save', 'field_note', 'visual_risk', 'response_mode'],
      additionalProperties: false,
    },
  },
}

export interface SmsTurnResult {
  reply: string
  fieldNote: string | null
  visualRisk: 0 | 1 | 2
  responseMode: CompanionResponseMode
}

export async function classifySmsCrisis(
  text: string,
  apiKey: string,
  fetchImpl: FetchLike = fetch,
): Promise<CrisisResult> {
  try {
    const response = await fetchImpl('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      signal: AbortSignal.timeout(8_000),
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: OPENAI_CRISIS_MODEL,
        messages: [
          { role: 'system', content: CRISIS_CLASSIFIER_PROMPT },
          { role: 'user', content: text.slice(-1600) },
        ],
        max_completion_tokens: 500,
        reasoning_effort: 'minimal',
        response_format: CRISIS_RESPONSE_FORMAT,
      }),
    })
    if (!response.ok) return { risk: 0 }
    const data = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>
    }
    const content = data.choices?.[0]?.message?.content
    if (typeof content !== 'string') return { risk: 0 }
    const parsed = JSON.parse(content) as { risk?: unknown; reason?: unknown }
    if (parsed.risk !== 0 && parsed.risk !== 1 && parsed.risk !== 2) return { risk: 0 }
    return {
      risk: parsed.risk,
      reason: typeof parsed.reason === 'string' ? parsed.reason : undefined,
    }
  } catch {
    return { risk: 0 }
  }
}

export async function generateSmsTurn(opts: {
  text: string
  risk: 0 | 1
  history: SmsHistoryMessage[]
  images?: SmsImageInput[]
  failedImageCount?: number
  companionContext?: SharedCompanionContext
  apiKey: string
  fetchImpl?: FetchLike
}): Promise<SmsTurnResult> {
  const fetchImpl = opts.fetchImpl ?? fetch
  const historyBlock = wrapSmsHistory(opts.history)
  const currentText = opts.text.trim()
    ? opts.text.slice(0, 1600)
    : '[The writer sent image attachment(s) without a caption.]'
  const mediaNotice = opts.images?.length || opts.failedImageCount
    ? `\n\n<untrusted_mms_metadata>\nVisible images attached: ${opts.images?.length ?? 0}. Images that could not be loaded: ${opts.failedImageCount ?? 0}.\n</untrusted_mms_metadata>`
    : ''
  const userText = `${historyBlock ? `${historyBlock}\n\n` : ''}<untrusted_current_sms>\n${currentText}\n</untrusted_current_sms>${mediaNotice}`
  const userContent: Array<
    | { type: 'text'; text: string }
    | { type: 'image_url'; image_url: { url: string; detail: 'auto' } }
  > = [
    { type: 'text', text: userText },
    ...(opts.images ?? []).map(image => ({
      type: 'image_url' as const,
      image_url: { url: image.dataUrl, detail: 'auto' as const },
    })),
  ]

  const response = await fetchImpl('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    signal: AbortSignal.timeout(35_000),
    headers: {
      'Authorization': `Bearer ${opts.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: OPENAI_CHAT_MODEL,
      messages: [
        { role: 'system', content: buildSmsSystemPrompt(opts.risk, opts.companionContext) },
        { role: 'user', content: userContent },
      ],
      max_completion_tokens: 1600,
      reasoning_effort: 'none',
      response_format: SMS_TURN_RESPONSE_FORMAT,
    }),
  })

  if (!response.ok) throw new Error(`openai_${response.status}`)
  const data = await response.json() as {
    choices?: Array<{ message?: { content?: string } }>
  }
  const content = data.choices?.[0]?.message?.content
  if (typeof content !== 'string' || content.trim().length === 0) {
    throw new Error('openai_empty')
  }
  let parsed: { reply?: unknown; save?: unknown; field_note?: unknown; visual_risk?: unknown; response_mode?: unknown }
  try {
    parsed = JSON.parse(content) as typeof parsed
  } catch {
    throw new Error('openai_malformed')
  }
  if (
    typeof parsed.reply !== 'string'
    || typeof parsed.save !== 'boolean'
    || (parsed.field_note !== null && typeof parsed.field_note !== 'string')
    || (parsed.visual_risk !== 0 && parsed.visual_risk !== 1 && parsed.visual_risk !== 2)
    || !COMPANION_RESPONSE_MODES.includes(parsed.response_mode as CompanionResponseMode)
  ) {
    throw new Error('openai_malformed')
  }
  const reply = sanitizeSmsReply(parsed.reply)
  if (!reply) throw new Error('openai_empty')

  const candidate = parsed.save && typeof parsed.field_note === 'string'
    ? sanitizeSmsFieldNote(parsed.field_note)
    : ''
  return {
    reply,
    fieldNote: candidate || null,
    visualRisk: parsed.visual_risk,
    responseMode: parsed.response_mode as CompanionResponseMode,
  }
}
