import type { SmsMediaDescriptor } from './media.js'

/**
 * How a failed Twilio `messages.create` should be treated:
 * - `terminal`: a definite 4xx rejection (e.g. 21610 unsubscribed). Nothing was
 *   sent and a retry would fail the same way.
 * - `retryable`: 429 rate limiting. Nothing was sent; a later retry is safe.
 * - `ambiguous`: 5xx, timeouts, network errors. The message may have been
 *   sent, so it must never be re-sent automatically.
 */
export type TwilioSendFailure = 'terminal' | 'retryable' | 'ambiguous'

export function classifyTwilioSendError(error: unknown): TwilioSendFailure {
  const status = (error as { status?: unknown } | null)?.status
  if (typeof status === 'number') {
    if (status === 429) return 'retryable'
    if (status >= 400 && status < 500) return 'terminal'
  }
  return 'ambiguous'
}

/** Category-only description of a Twilio error, safe for logs. */
export function twilioErrorCategory(error: unknown): string {
  const { status, code } = (error ?? {}) as { status?: unknown; code?: unknown }
  if (typeof code === 'number') return `twilio_${code}`
  if (typeof status === 'number') return `twilio_http_${status}`
  return error instanceof Error ? `twilio_${error.name.slice(0, 40)}` : 'twilio_unknown'
}

/** Media SID from a protected Twilio media URL that belongs to this message. */
export function twilioMediaSid(url: string, accountSid: string, messageSid: string): string | null {
  try {
    const parsed = new URL(url)
    const prefix = `/2010-04-01/Accounts/${accountSid}/Messages/${messageSid}/Media/`
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'api.twilio.com' || !parsed.pathname.startsWith(prefix)) {
      return null
    }
    const sid = parsed.pathname.slice(prefix.length).replace(/\.json$/, '')
    return /^ME[A-Za-z0-9]{8,64}$/.test(sid) ? sid : null
  } catch {
    return null
  }
}

interface TwilioMediaClient {
  messages(sid: string): { media(sid: string): { remove(): Promise<boolean> } }
}

/**
 * Best-effort removal of inbound MMS media at Twilio once we no longer need it.
 * Failures are logged by category and never fail the caller.
 */
export async function deleteTwilioMedia(opts: {
  client: TwilioMediaClient
  media: SmsMediaDescriptor[]
  accountSid: string
  messageSid: string
}): Promise<number> {
  let deleted = 0
  for (const item of opts.media) {
    const mediaSid = twilioMediaSid(item.url, opts.accountSid, opts.messageSid)
    if (!mediaSid) continue
    try {
      await opts.client.messages(opts.messageSid).media(mediaSid).remove()
      deleted++
    } catch (error) {
      console.error(`[sms] media delete failed category=${twilioErrorCategory(error)}`)
    }
  }
  return deleted
}
