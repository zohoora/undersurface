import { describe, expect, it } from 'vitest'
import { REALTIME_INSTRUCTIONS_MAX, realtimeInstructionsAllowed } from './realtime.js'

describe('Realtime instruction budget', () => {
  it('accepts a continuity-rich Room prompt at the observed production size', () => {
    expect(realtimeInstructionsAllowed('x'.repeat(24_000))).toBe(true)
  })

  it('keeps a bounded guard with room for live conversation', () => {
    expect(realtimeInstructionsAllowed('x'.repeat(REALTIME_INSTRUCTIONS_MAX))).toBe(true)
    expect(realtimeInstructionsAllowed('x'.repeat(REALTIME_INSTRUCTIONS_MAX + 1))).toBe(false)
    expect(realtimeInstructionsAllowed('')).toBe(false)
  })
})
