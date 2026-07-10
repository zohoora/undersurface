export const TWILIO_PHONE_NUMBER = '+12897780589'
export const TWILIO_PHONE_DISPLAY = '+1 289-778-0589'
export const TWILIO_WEBHOOK_URL = 'https://undersurface.me/api/sms'
export const UNDERSURFACE_SESSION_URL = 'https://undersurface.me/session/new'

export type ParsedSmsIntent =
  | { kind: 'link'; code: string }
  | { kind: 'invalid_link' }
  | { kind: 'unlink' }
  | { kind: 'help' }
  | { kind: 'opt_out' }
  | { kind: 'message'; text: string }

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

  if (/^LINK\b/i.test(text)) {
    const code = text.replace(/^LINK\s*/i, '').trim().toUpperCase()
    return LINK_CODE_PATTERN.test(code) ? { kind: 'link', code } : { kind: 'invalid_link' }
  }

  if (!text) return { kind: 'help' }
  return { kind: 'message', text }
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

export function sanitizeSmsReply(raw: string): string {
  const maxChars = 1200
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

export function sanitizeSmsFieldNote(raw: string): string {
  return raw
    .replace(/<\/?untrusted[^>]*>/gi, '')
    .replace(/\[([^\]]+)]\([^\s)]+\)/g, '$1')
    .replace(/[*_`#]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 320)
}

export const SMS_HELP =
  `Text naturally or send an image. I'll respond with the amount of space the moment seems to need, and may carry forward a concise note when it could help a later UnderSurface session. Text UNLINK to disconnect.`

export const SMS_CRISIS_RESPONSE =
  `I'm concerned you may be in immediate danger. If you might act now or can't stay safe, call local emergency services now. In Canada or the U.S., call or text 988. If you can, move away from anything you could use to hurt yourself and contact someone who can stay with you.`

export const SMS_UNAVAILABLE_RESPONSE =
  `I couldn't reach the companion just now. Your message is saved. You can continue in UnderSurface: ${UNDERSURFACE_SESSION_URL}`

export const SMS_MEDIA_UNAVAILABLE_RESPONSE =
  `I couldn't read that image. Please try sending it again as a JPEG, PNG, WEBP, or GIF.`
