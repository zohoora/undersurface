import { t } from '../i18n'
import type { TranslationKey } from '../i18n/translations/en'

// Voice sessions fail in a few distinct, user-actionable ways (mic blocked, no
// mic, service unreachable) plus an unknown bucket. Raw errors like
// "SDP exchange failed: 500" or a DOMException name mean nothing to a writer,
// so classify into a category the UI can phrase kindly and actionably.
export type VoiceErrorCategory = 'micDenied' | 'micMissing' | 'service' | 'generic'

export function classifyVoiceError(e: unknown): VoiceErrorCategory {
  const obj = typeof e === 'object' && e ? (e as { name?: unknown; message?: unknown }) : null
  const name = obj ? String(obj.name ?? '') : ''
  const rawMsg = e instanceof Error
    ? e.message
    : typeof obj?.message === 'string' ? obj.message : String(e ?? '')
  const msg = rawMsg.toLowerCase()

  if (name === 'NotAllowedError' || name === 'SecurityError' || msg.includes('permission') || msg.includes('denied')) {
    return 'micDenied'
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError' || msg.includes('no microphone') || msg.includes('requested device not found')) {
    return 'micMissing'
  }
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
  generic: 'voice.error.generic',
}

// Resolve an error to a friendly, localized, actionable message.
export function friendlyVoiceError(e: unknown): string {
  return t(CATEGORY_KEY[classifyVoiceError(e)])
}
