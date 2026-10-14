import { describe, it, expect } from 'vitest'
import { effectiveRoomEnabled, effectiveSmsEnabled, withoutRetiredFeatures } from './featureFlags'

describe('effectiveRoomEnabled', () => {
  it.each([
    [{}, false],
    [{ relaxEnabled: true }, true],
    [{ driftEnabled: true }, true],
    [{ relaxEnabled: false, driftEnabled: false }, false],
    [{ roomEnabled: true }, true],
    [{ roomEnabled: true, relaxEnabled: false, driftEnabled: false }, true],
    // An explicit off wins over the legacy flags.
    [{ roomEnabled: false, relaxEnabled: true, driftEnabled: true }, false],
  ])('%j -> %s', (features, expected) => {
    expect(effectiveRoomEnabled(features)).toBe(expected)
  })

  it('treats a missing features object as off', () => {
    expect(effectiveRoomEnabled(null)).toBe(false)
    expect(effectiveRoomEnabled(undefined)).toBe(false)
  })
})

describe('effectiveSmsEnabled', () => {
  it('is on unless explicitly false', () => {
    expect(effectiveSmsEnabled({})).toBe(true)
    expect(effectiveSmsEnabled(null)).toBe(true)
    expect(effectiveSmsEnabled({ smsEnabled: true })).toBe(true)
    expect(effectiveSmsEnabled({ smsEnabled: false })).toBe(false)
  })
})

describe('withoutRetiredFeatures', () => {
  it('drops retired keys and keeps the rest', () => {
    const features = { partsEnabled: true, customSoundscapesEnabled: false, roomEnabled: true }
    expect(withoutRetiredFeatures(features)).toEqual({ partsEnabled: true, roomEnabled: true })
    // Input is not mutated.
    expect(features).toHaveProperty('customSoundscapesEnabled')
  })
})
