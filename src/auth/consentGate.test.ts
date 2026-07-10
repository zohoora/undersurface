import { describe, expect, it } from 'vitest'
import { hasRequiredConsent } from './consentGate'

describe('hasRequiredConsent', () => {
  it('requires only the current consent version', () => {
    expect(hasRequiredConsent({ acceptedVersion: '1.0' })).toBe(true)
    expect(hasRequiredConsent({ acceptedVersion: '1.0', adultOnlyAcknowledged: false })).toBe(true)
    expect(hasRequiredConsent({ acceptedVersion: '0.9' })).toBe(false)
    expect(hasRequiredConsent(null)).toBe(false)
  })
})
