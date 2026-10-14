import { t } from '../i18n'
import type { TranslationKey } from '../i18n/translations/en'

// Voice sessions fail in a few distinct, user-actionable ways (mic blocked, no
// mic, service unreachable, connection dropped mid-session, voice limits) plus
// an unknown bucket. Raw errors like "SDP exchange failed: 500" or a
// DOMException name mean nothing to a writer, so classify into a category the
// UI can phrase kindly and actionably.
export type VoiceErrorCategory =
  | 'micDenied'
  | 'micMissing'
  | 'service'
  | 'disconnected'
  | 'budget'
  | 'rateLimited'
  | 'disabled'
  | 'generic'

/**
 * Raised by useVoiceSession when a live Realtime connection is lost (ICE or
 * peer connection failed/closed, data channel closed or errored, or a fatal
 * server error such as an expired session).
 */
export class VoiceConnectionLostError extends Error {
  constructor(detail: string) {
    super(`Voice connection lost: ${detail}`)
    this.name = 'VoiceConnectionLostError'
  }
}

// realtimeTokenApi error contract: every error body is JSON
// `{ error: string, code: string }`. Codes are matched exactly; the HTTP status
// is only a fallback for older deployments without codes.
const TOKEN_ERROR_CODES: Array<[string, VoiceErrorCategory]> = [
  ['voice_daily_budget_exceeded', 'budget'],
  ['voice_rate_limited', 'rateLimited'],
  ['voice_disabled', 'disabled'],
  ['voice_config_unavailable', 'service'],
  ['voice_upstream_error', 'service'],
]

function tokenEndpointCategory(msg: string): VoiceErrorCategory | null {
  for (const [code, category] of TOKEN_ERROR_CODES) {
    if (msg.includes(`"${code}"`) || msg.includes(`code: ${code}`)) return category
  }
  const status = /\bpost \S*realtime-token\S* failed: (\d{3})\b/.exec(msg)?.[1]
  if (status === '429') return 'rateLimited'
  if (status === '403') return 'disabled'
  if (status) return 'service'
  return null
}

export function classifyVoiceError(e: unknown): VoiceErrorCategory {
  const obj = typeof e === 'object' && e ? (e as { name?: unknown; message?: unknown }) : null
  const name = obj ? String(obj.name ?? '') : ''
  const rawMsg = e instanceof Error
    ? e.message
    : typeof obj?.message === 'string' ? obj.message : String(e ?? '')
  const msg = rawMsg.toLowerCase()

  if (name === 'NotAllowedError' || name === 'SecurityError') return 'micDenied'
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'micMissing'
  if (name === 'VoiceConnectionLostError') return 'disconnected'

  // Token-endpoint failures carry a JSON body that can contain words like
  // "denied"; classify them before the message heuristics below.
  const tokenCategory = tokenEndpointCategory(msg)
  if (tokenCategory) return tokenCategory

  if (msg.includes('permission') || msg.includes('denied')) return 'micDenied'
  if (msg.includes('no microphone') || msg.includes('requested device not found')) return 'micMissing'
  if (
    msg.includes('sdp') || msg.includes('token') || msg.includes('network') ||
    msg.includes('fetch') || msg.includes('failed to start') || /\b[45]\d\d\b/.test(msg)
  ) {
    return 'service'
  }
  return 'generic'
}

const CATEGORY_KEY: Record<VoiceErrorCategory, TranslationKey> = {
  micDenied: 'voice.error.micDenied',
  micMissing: 'voice.error.micMissing',
  service: 'voice.error.service',
  disconnected: 'voice.error.disconnected',
  budget: 'voice.error.budget',
  rateLimited: 'voice.error.rateLimited',
  disabled: 'voice.error.disabled',
  generic: 'voice.error.generic',
}

// Resolve an error to a friendly, localized, actionable message.
export function friendlyVoiceError(e: unknown): string {
  return t(CATEGORY_KEY[classifyVoiceError(e)])
}

// Realtime server `error` events are recoverable by default (the session stays
// connected). Only these codes mean the session itself is gone.
const FATAL_SERVER_ERROR_CODES = new Set([
  'session_expired',
  'session_expired_error',
  'session_not_found',
  'session_closed',
  'invalid_client_secret',
  'invalid_api_key',
  'expired_client_secret',
  'client_secret_expired',
  'insufficient_quota',
  'account_deactivated',
])

export function isFatalRealtimeServerError(error: { code?: string; type?: string; message?: string } | undefined): boolean {
  if (!error) return false
  const code = (error.code ?? '').toLowerCase()
  if (FATAL_SERVER_ERROR_CODES.has(code)) return true
  if (error.type === 'authentication_error') return true
  const message = (error.message ?? '').toLowerCase()
  return /session (?:has )?expired|maximum (?:session )?duration|client secret (?:has )?expired|invalid client secret/.test(message)
}
