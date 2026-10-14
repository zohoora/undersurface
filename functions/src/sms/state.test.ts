import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeDb, FakeTimestamp } from './testing/fakeFirestore'

const mocks = vi.hoisted(() => ({ getUser: vi.fn() }))

vi.mock('firebase-admin/firestore', async () => (await import('./testing/fakeFirestore')).fakeFirestoreModule())
vi.mock('firebase-admin/auth', () => ({ getAuth: () => ({ getUser: mocks.getUser }) }))

const {
  RECENT_CRISIS_WINDOW_MS,
  isAccountDeleting,
  isRecentCrisis,
  reserveDailySmsTurn,
  revokeFieldWindowConsent,
  smsEnabledFromConfig,
  timestampMs,
  utcDayKey,
} = await import('./state')

const NOW = Date.parse('2026-10-14T12:00:00Z')

beforeEach(() => {
  fakeDb.reset()
  mocks.getUser.mockReset()
  mocks.getUser.mockResolvedValue({ uid: 'u1' })
})

describe('recent crisis window', () => {
  it('uses the later of SMS risk and app grounding, within 72 hours', () => {
    expect(isRecentCrisis({ lastRiskAt: null, lastGroundingAt: null }, NOW)).toBe(false)
    expect(isRecentCrisis({ lastRiskAt: NOW - RECENT_CRISIS_WINDOW_MS + 1, lastGroundingAt: null }, NOW)).toBe(true)
    expect(isRecentCrisis({ lastRiskAt: null, lastGroundingAt: NOW - 1_000 }, NOW)).toBe(true)
    expect(isRecentCrisis({ lastRiskAt: NOW - RECENT_CRISIS_WINDOW_MS, lastGroundingAt: null }, NOW)).toBe(false)
    expect(isRecentCrisis({ lastRiskAt: NOW - 100 * 3_600_000, lastGroundingAt: NOW - 10 * 3_600_000 }, NOW)).toBe(true)
  })

  it('treats a future timestamp (clock skew) as recent, the safe direction', () => {
    expect(isRecentCrisis({ lastRiskAt: null, lastGroundingAt: NOW + 60_000 }, NOW)).toBe(true)
  })

  it('reads epoch numbers and Firestore timestamps alike', () => {
    expect(timestampMs(5)).toBe(5)
    expect(timestampMs(new FakeTimestamp(7))).toBe(7)
    expect(timestampMs('yesterday')).toBeNull()
    expect(timestampMs(Number.NaN)).toBeNull()
  })
})

describe('SMS kill switch', () => {
  it('is enabled unless features.smsEnabled is exactly false', () => {
    expect(smsEnabledFromConfig(null)).toBe(true)
    expect(smsEnabledFromConfig({})).toBe(true)
    expect(smsEnabledFromConfig({ features: {} })).toBe(true)
    expect(smsEnabledFromConfig({ features: { smsEnabled: true } })).toBe(true)
    expect(smsEnabledFromConfig({ features: { smsEnabled: 'false' } })).toBe(true)
    expect(smsEnabledFromConfig({ features: { smsEnabled: false } })).toBe(false)
  })
})

describe('account deletion tombstone', () => {
  it('detects the deleting status written by account deletion', async () => {
    await expect(isAccountDeleting('u1')).resolves.toBe(false)
    fakeDb.seed('users/u1', { status: 'deleting', deletedAt: NOW })
    await expect(isAccountDeleting('u1')).resolves.toBe(true)
  })

  it('treats a missing Auth user as deleted (the tombstone is removed last)', async () => {
    mocks.getUser.mockRejectedValue(Object.assign(new Error('missing'), { code: 'auth/user-not-found' }))
    await expect(isAccountDeleting('u1')).resolves.toBe(true)
  })

  it('does not treat an Auth outage as a deletion', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.getUser.mockRejectedValue(Object.assign(new Error('unavailable'), { code: 'auth/internal-error' }))
    await expect(isAccountDeleting('u1')).resolves.toBe(false)
    error.mockRestore()
  })
})

describe('daily SMS turn budget', () => {
  it('counts turns per UTC day and refuses past the limit', async () => {
    fakeDb.seed('smsInbound/a', { uid: 'u1' })
    fakeDb.seed('smsInbound/b', { uid: 'u1' })
    fakeDb.seed('smsInbound/c', { uid: 'u1' })
    const ref = (id: string) => fakeDb.doc(`smsInbound/${id}`) as unknown as FirebaseFirestore.DocumentReference
    const db = fakeDb as unknown as FirebaseFirestore.Firestore

    await expect(reserveDailySmsTurn('u1', ref('a'), NOW, db, 2)).resolves.toBe(true)
    await expect(reserveDailySmsTurn('u1', ref('b'), NOW, db, 2)).resolves.toBe(true)
    await expect(reserveDailySmsTurn('u1', ref('c'), NOW, db, 2)).resolves.toBe(false)
    // A retry of an already-counted message is free.
    await expect(reserveDailySmsTurn('u1', ref('a'), NOW, db, 2)).resolves.toBe(true)
    expect(fakeDb.read('users/u1/smsSettings/usage')).toMatchObject({ dayKey: utcDayKey(NOW), turns: 2 })

    // A new UTC day resets the count.
    await expect(reserveDailySmsTurn('u1', ref('c'), NOW + 86_400_000, db, 2)).resolves.toBe(true)
    expect(fakeDb.read('users/u1/smsSettings/usage')).toMatchObject({ turns: 1 })
  })
})

describe('consent revocation', () => {
  it('records the opt-out even when there are no field-window preferences', async () => {
    await revokeFieldWindowConsent('u1', NOW)
    expect(fakeDb.read('users/u1/smsSettings/optOut')).toMatchObject({ optedOutAt: NOW })
    expect(fakeDb.read('users/u1/companionPreferences/current')).toBeUndefined()
  })

  it('disables field windows and deletes consent without touching other preferences', async () => {
    fakeDb.seed('users/u1/companionPreferences/current', {
      outcomeSampling: 'off',
      lastGroundingAt: 3,
      fieldWindows: { enabled: true, consentAt: 5, timezone: 'UTC', maxPerWeek: 1, windows: [] },
    })

    await revokeFieldWindowConsent('u1', NOW)

    const preferences = fakeDb.read('users/u1/companionPreferences/current') as Record<string, unknown>
    expect(preferences).toMatchObject({ outcomeSampling: 'off', lastGroundingAt: 3 })
    expect(preferences.fieldWindows).toEqual({ enabled: false, timezone: 'UTC', maxPerWeek: 1, windows: [], updatedAt: NOW })
  })
})
