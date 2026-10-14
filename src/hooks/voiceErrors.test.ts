import { describe, it, expect, vi } from 'vitest'

// t() just echoes the key so we assert on the resolved category key.
vi.mock('../i18n', () => ({ t: (k: string) => k }))

const { classifyVoiceError, friendlyVoiceError, isFatalRealtimeServerError, VoiceConnectionLostError } = await import('./voiceErrors')

describe('classifyVoiceError', () => {
  it('maps a blocked-mic DOMException to micDenied', () => {
    expect(classifyVoiceError({ name: 'NotAllowedError', message: 'Permission denied' })).toBe('micDenied')
  })

  it('maps a missing-mic DOMException to micMissing', () => {
    expect(classifyVoiceError({ name: 'NotFoundError', message: 'Requested device not found' })).toBe('micMissing')
  })

  it('maps SDP / token / 5xx failures to service', () => {
    expect(classifyVoiceError(new Error('SDP exchange failed: 500'))).toBe('service')
    expect(classifyVoiceError(new Error('token request failed'))).toBe('service')
    expect(classifyVoiceError({ message: 'network error' })).toBe('service')
  })

  it('reads .message from a plain server-error object (not an Error instance)', () => {
    expect(classifyVoiceError({ message: 'server 503 unavailable' })).toBe('service')
  })

  it('falls back to generic for an unrecognized error', () => {
    expect(classifyVoiceError(new Error('something odd happened'))).toBe('generic')
    expect(classifyVoiceError(null)).toBe('generic')
  })
})

describe('classifyVoiceError — realtime-token contract', () => {
  const tokenError = (status: number, body: Record<string, string>) =>
    new Error(`POST /api/realtime-token failed: ${status} ${JSON.stringify(body)}`)

  it('maps the daily voice budget 429 to budget', () => {
    expect(classifyVoiceError(tokenError(429, {
      code: 'voice_daily_budget_exceeded',
      error: "You have reached today's voice limit. It resets at midnight UTC.",
    }))).toBe('budget')
  })

  it('maps the per-minute limiter 429 to rateLimited', () => {
    expect(classifyVoiceError(tokenError(429, {
      code: 'voice_rate_limited',
      error: 'Too many voice sessions. Please wait a moment.',
    }))).toBe('rateLimited')
    // Older deployments without a code still read as a rate limit.
    expect(classifyVoiceError(tokenError(429, { error: 'Too many voice sessions.' }))).toBe('rateLimited')
  })

  it('maps voice/Room disabled 403 to disabled, even if the body says "denied"', () => {
    expect(classifyVoiceError(tokenError(403, { code: 'voice_disabled', error: 'Voice is not available right now.' }))).toBe('disabled')
    expect(classifyVoiceError(tokenError(403, { error: 'Access denied' }))).toBe('disabled')
  })

  it('maps config and upstream failures to service', () => {
    expect(classifyVoiceError(tokenError(503, { code: 'voice_config_unavailable', error: 'x' }))).toBe('service')
    expect(classifyVoiceError(tokenError(502, { code: 'voice_upstream_error', error: 'x' }))).toBe('service')
  })

  it('maps a dropped live connection to disconnected', () => {
    expect(classifyVoiceError(new VoiceConnectionLostError('ice failed'))).toBe('disconnected')
  })
})

describe('isFatalRealtimeServerError', () => {
  it('treats session expiry and bad credentials as fatal', () => {
    expect(isFatalRealtimeServerError({ code: 'session_expired', message: 'Your session hit the maximum duration of 60 minutes.' })).toBe(true)
    expect(isFatalRealtimeServerError({ code: 'invalid_client_secret' })).toBe(true)
    expect(isFatalRealtimeServerError({ type: 'authentication_error' })).toBe(true)
  })

  it('keeps the known recoverable events recoverable', () => {
    expect(isFatalRealtimeServerError({ code: 'response_cancel_not_active', type: 'invalid_request_error', message: 'Cancellation failed: no active response found' })).toBe(false)
    expect(isFatalRealtimeServerError({ code: 'invalid_event', type: 'invalid_request_error', message: 'Recoverable event problem' })).toBe(false)
    expect(isFatalRealtimeServerError({ code: 'conversation_already_has_active_response' })).toBe(false)
    expect(isFatalRealtimeServerError(undefined)).toBe(false)
  })
})

describe('friendlyVoiceError', () => {
  it('resolves to the localized key for the category', () => {
    expect(friendlyVoiceError({ name: 'NotAllowedError' })).toBe('voice.error.micDenied')
    expect(friendlyVoiceError(new Error('unknown'))).toBe('voice.error.generic')
  })
})
