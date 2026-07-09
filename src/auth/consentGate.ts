export const CURRENT_CONSENT_VERSION = '1.0'

export function hasRequiredConsent(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const consent = value as { acceptedVersion?: unknown; adultOnlyAcknowledged?: unknown }
  return consent.acceptedVersion === CURRENT_CONSENT_VERSION
    && consent.adultOnlyAcknowledged === true
}
