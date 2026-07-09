import { describe, expect, it } from 'vitest'
import { hasRequiredConsent } from './consentGate'

describe('hasRequiredConsent', () => {
  it('requires both the current version and the adult acknowledgement', () => {
    expect(hasRequiredConsent({ acceptedVersion: '1.0', adultOnlyAcknowledged: true })).toBe(true)
    expect(hasRequiredConsent({ acceptedVersion: '1.0' })).toBe(false)
    expect(hasRequiredConsent({ acceptedVersion: '0.9', adultOnlyAcknowledged: true })).toBe(false)
    expect(hasRequiredConsent(null)).toBe(false)
  })
})
