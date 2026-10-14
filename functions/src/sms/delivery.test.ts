import { describe, expect, it, vi } from 'vitest'
import {
  classifyTwilioSendError,
  deleteTwilioMedia,
  twilioErrorCategory,
  twilioMediaSid,
} from './delivery'

describe('Twilio send failure classification', () => {
  it('treats definite 4xx rejections (e.g. 21610 unsubscribed) as terminal', () => {
    expect(classifyTwilioSendError({ status: 400, code: 21610 })).toBe('terminal')
    expect(classifyTwilioSendError({ status: 404, code: 20404 })).toBe('terminal')
  })

  it('retries only rate limiting, which is definitely not sent', () => {
    expect(classifyTwilioSendError({ status: 429, code: 20429 })).toBe('retryable')
  })

  it('treats 5xx, timeouts, and unknown errors as ambiguous (never resend)', () => {
    expect(classifyTwilioSendError({ status: 503 })).toBe('ambiguous')
    expect(classifyTwilioSendError(new Error('socket hang up'))).toBe('ambiguous')
    expect(classifyTwilioSendError(null)).toBe('ambiguous')
  })

  it('logs categories, never message text', () => {
    expect(twilioErrorCategory(Object.assign(new Error('To +14165550123 unsubscribed'), { status: 400, code: 21610 }))).toBe('twilio_21610')
    expect(twilioErrorCategory({ status: 503 })).toBe('twilio_http_503')
  })
})

describe('Twilio media cleanup', () => {
  const account = 'ACtest'
  const message = 'MM0123456789abcdef'
  const url = `https://api.twilio.com/2010-04-01/Accounts/${account}/Messages/${message}/Media/ME0123456789abcdef`

  it('extracts the media SID only from this message\'s protected media URL', () => {
    expect(twilioMediaSid(url, account, message)).toBe('ME0123456789abcdef')
    expect(twilioMediaSid(url, account, 'MMother')).toBeNull()
    expect(twilioMediaSid(url.replace('api.twilio.com', 'evil.example'), account, message)).toBeNull()
    expect(twilioMediaSid('not a url', account, message)).toBeNull()
  })

  it('deletes each media item and survives individual failures', async () => {
    const remove = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('gone'), { status: 404, code: 20404 }))
      .mockResolvedValueOnce(true)
    const client = { messages: () => ({ media: () => ({ remove }) }) }
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    const deleted = await deleteTwilioMedia({
      client,
      media: [{ url, contentType: 'image/jpeg' }, { url: url.replace(/ME\w+$/, 'ME0123456789abcdee'), contentType: 'image/png' }],
      accountSid: account,
      messageSid: message,
    })

    expect(deleted).toBe(1)
    expect(error).toHaveBeenCalledWith('[sms] media delete failed category=twilio_20404')
    error.mockRestore()
  })
})
