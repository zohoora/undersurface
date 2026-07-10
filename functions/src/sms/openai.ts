import { OPENAI_CHAT_MODEL } from '../shared/models.js'
import {
  CRISIS_CLASSIFIER_PROMPT,
  CRISIS_RESPONSE_FORMAT,
} from '../shared/crisisClassifier.js'
import { sanitizeSmsReply, type SmsMode } from './field.js'
import { buildSmsSystemPrompt, wrapSmsHistory } from './prompts.js'

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

export async function generateSmsReply(opts: {
  text: string
  mode: Exclude<SmsMode, 'capture'>
  risk: 0 | 1
  history: SmsHistoryMessage[]
  apiKey: string
  fetchImpl?: FetchLike
}): Promise<string> {
  const fetchImpl = opts.fetchImpl ?? fetch
  const historyBlock = wrapSmsHistory(opts.history)
  const userContent = `${historyBlock ? `${historyBlock}\n\n` : ''}<untrusted_current_sms>\n${opts.text.slice(0, 1600)}\n</untrusted_current_sms>`

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
        { role: 'system', content: buildSmsSystemPrompt(opts.mode, opts.risk) },
        { role: 'user', content: userContent },
      ],
      max_completion_tokens: opts.mode === 'deep' ? 1400 : 700,
      reasoning_effort: 'none',
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
  return sanitizeSmsReply(content, opts.mode)
}
