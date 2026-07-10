export const TWILIO_PHONE_NUMBER = '+12897780589'
export const TWILIO_PHONE_DISPLAY = '+1 289-778-0589'
export const TWILIO_WEBHOOK_URL = 'https://undersurface.me/api/sms'
export const UNDERSURFACE_SESSION_URL = 'https://undersurface.me/session/new'

export type SmsMode = 'exchange' | 'deep' | 'capture'

export type ParsedSmsIntent =
  | { kind: 'link'; code: string }
  | { kind: 'invalid_link' }
  | { kind: 'unlink' }
  | { kind: 'help' }
  | { kind: 'open' }
  | { kind: 'opt_out' }
  | { kind: 'capture'; text: string }
  | { kind: 'message'; mode: 'exchange' | 'deep'; text: string }

const LINK_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{6}$/
const OPT_OUT_WORDS = new Set(['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT'])

export function normalizePhone(value: string): string | null {
  const trimmed = value.trim()
  if (!/^\+[1-9]\d{7,14}$/.test(trimmed)) return null
  return trimmed
}

export function parseSmsBody(raw: string): ParsedSmsIntent {
  const text = raw.replace(/\r\n/g, '\n').trim()
  const upper = text.toUpperCase()

  if (OPT_OUT_WORDS.has(upper)) return { kind: 'opt_out' }
  if (upper === 'UNLINK') return { kind: 'unlink' }
  if (upper === 'HELP' || upper === 'START') return { kind: 'help' }
  if (upper === 'OPEN') return { kind: 'open' }

  if (/^LINK\b/i.test(text)) {
    const code = text.replace(/^LINK\s*/i, '').trim().toUpperCase()
    return LINK_CODE_PATTERN.test(code) ? { kind: 'link', code } : { kind: 'invalid_link' }
  }

  const capture = text.match(/^SAVE(?:\s*:|\s+)\s*([\s\S]+)$/i)
  if (capture?.[1]?.trim()) return { kind: 'capture', text: capture[1].trim() }

  const deep = text.match(/^DEEP(?:\s*:|\s+)\s*([\s\S]+)$/i)
  if (deep?.[1]?.trim()) return { kind: 'message', mode: 'deep', text: deep[1].trim() }

  if (!text) return { kind: 'help' }
  return { kind: 'message', mode: 'exchange', text }
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

export function renderTwiml(message?: string): string {
  const body = message ? `<Message>${escapeXml(message)}</Message>` : ''
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`
}

export function sanitizeSmsReply(raw: string, mode: 'exchange' | 'deep'): string {
  const maxChars = mode === 'deep' ? 1200 : 480
  const cleaned = raw
    .replace(/^\s*<<RISK:[^>]+>>\s*/i, '')
    .replace(/\[([^\]]+)]\([^\s)]+\)/g, '$1')
    .replace(/[*_`#]+/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  if (cleaned.length <= maxChars) return cleaned
  const slice = cleaned.slice(0, maxChars - 1)
  const boundary = Math.max(slice.lastIndexOf('. '), slice.lastIndexOf('? '), slice.lastIndexOf('! '))
  const cut = boundary >= Math.floor(maxChars * 0.55) ? slice.slice(0, boundary + 1) : slice.replace(/\s+\S*$/, '')
  return `${cut.trimEnd()}…`
}

export const SMS_HELP =
  `Text normally for one small response. Start with SAVE: to capture without a conversation, DEEP: for more space, OPEN to continue in UnderSurface, or UNLINK to disconnect.`

export const SMS_CRISIS_RESPONSE =
  `I'm concerned you may be in immediate danger. If you might act now or can't stay safe, call local emergency services now. In Canada or the U.S., call or text 988. If you can, move away from anything you could use to hurt yourself and contact someone who can stay with you.`

export const SMS_UNAVAILABLE_RESPONSE =
  `I couldn't reach the companion just now. Your message is saved. You can continue in UnderSurface: ${UNDERSURFACE_SESSION_URL}`
