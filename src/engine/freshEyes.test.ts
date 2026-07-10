import { describe, expect, it } from 'vitest'
import { isFreshEyesSession, normalizeSessionMemoryAperture } from './freshEyes'

describe('Fresh eyes memory boundary', () => {
  it('keeps only the binary fresh/pattern product states', () => {
    expect(normalizeSessionMemoryAperture('fresh')).toBe('fresh')
    expect(normalizeSessionMemoryAperture('pattern')).toBe('pattern')
    expect(normalizeSessionMemoryAperture('light')).toBe('pattern')
    expect(normalizeSessionMemoryAperture('counterstory')).toBe('pattern')
    expect(normalizeSessionMemoryAperture(undefined)).toBe('pattern')
  })

  it('recognizes Fresh eyes sessions', () => {
    expect(isFreshEyesSession({ memoryAperture: 'fresh' })).toBe(true)
    expect(isFreshEyesSession({ memoryAperture: 'pattern' })).toBe(false)
    expect(isFreshEyesSession(undefined)).toBe(false)
  })
})
