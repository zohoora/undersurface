import { describe, expect, it } from 'vitest'
import { isRealtimeVoiceAllowed, isRoomEnabled } from './featureFlags'

describe('isRoomEnabled (cross-agent contract)', () => {
  it.each([
    [{ roomEnabled: true }, true],
    [{ roomEnabled: false, relaxEnabled: true, driftEnabled: true }, false],
    [{ relaxEnabled: true }, true],
    [{ driftEnabled: true }, true],
    [{ relaxEnabled: false, driftEnabled: false }, false],
    [{}, false],
    [null, false],
    [undefined, false],
  ] as const)('%j → %s', (features, expected) => {
    expect(isRoomEnabled(features)).toBe(expected)
  })
})

describe('isRealtimeVoiceAllowed', () => {
  it('allows Speak via voiceEnabled', () => {
    expect(isRealtimeVoiceAllowed({ voiceEnabled: true })).toBe(true)
  })

  it('allows Room voice via an effective Room flag', () => {
    expect(isRealtimeVoiceAllowed({ roomEnabled: true })).toBe(true)
    expect(isRealtimeVoiceAllowed({ relaxEnabled: true })).toBe(true)
  })

  it('denies when neither surface is on, including a missing config', () => {
    expect(isRealtimeVoiceAllowed({ voiceEnabled: false, roomEnabled: false, relaxEnabled: true })).toBe(false)
    expect(isRealtimeVoiceAllowed({})).toBe(false)
    expect(isRealtimeVoiceAllowed(null)).toBe(false)
  })

  it('treats non-boolean truthy values as off (experimental flags are === true)', () => {
    expect(isRealtimeVoiceAllowed({ voiceEnabled: 'true', roomEnabled: 1 })).toBe(false)
  })
})
