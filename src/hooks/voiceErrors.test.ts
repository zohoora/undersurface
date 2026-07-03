import { describe, it, expect, vi } from 'vitest'

// t() just echoes the key so we assert on the resolved category key.
vi.mock('../i18n', () => ({ t: (k: string) => k }))

const { classifyVoiceError, friendlyVoiceError } = await import('./voiceErrors')

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

describe('friendlyVoiceError', () => {
  it('resolves to the localized key for the category', () => {
    expect(friendlyVoiceError({ name: 'NotAllowedError' })).toBe('voice.error.micDenied')
    expect(friendlyVoiceError(new Error('unknown'))).toBe('voice.error.generic')
  })
})
