// Focused tests for admin handlers. The full adminApi wrapper is exercised in
// functions/src/index.test.ts (allowlist gate). This file tests the per-action
// handlers directly — particularly handleUpdateConfig, which writes to
// appConfig/global and affects every user, so its sanitization is a load-
// bearing security invariant.

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock initializeApp at module load to silence Firebase Admin warnings.
vi.mock('firebase-admin/app', () => ({ initializeApp: vi.fn() }))

// Build a chainable Firestore mock. Each test gets a fresh instance with
// configurable get/set behavior so we can assert WHAT gets persisted.
function makeFirestoreMock() {
  let configDoc: Record<string, unknown> | null = null
  const setMock = vi.fn().mockImplementation(async (value: Record<string, unknown>, options?: { merge?: boolean }) => {
    configDoc = options?.merge ? { ...(configDoc ?? {}), ...value } : value
  })
  const getMock = vi.fn().mockImplementation(() => ({
    exists: configDoc !== null,
    data: () => configDoc,
  }))
  const docMock = vi.fn(() => ({ set: setMock, get: getMock }))
  const collectionMock = vi.fn(() => ({ doc: docMock }))

  return {
    setMock,
    setConfigDoc: (d: Record<string, unknown> | null) => { configDoc = d },
    firestore: { collection: collectionMock },
  }
}

let firestoreState: ReturnType<typeof makeFirestoreMock>

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => firestoreState.firestore,
}))

// Auth is unused by handleGetConfig/handleUpdateConfig but the module imports it.
vi.mock('firebase-admin/auth', () => ({
  getAuth: () => ({}),
}))

const { handleGetConfig, handleUpdateConfig } = await import('./handlers')

beforeEach(() => {
  firestoreState = makeFirestoreMock()
})

describe('handleGetConfig', () => {
  it('returns { config: null } when the global config doc has never been written', async () => {
    firestoreState.setConfigDoc(null)
    const result = await handleGetConfig()
    expect(result).toEqual({ config: null })
  })

  it('returns the doc data when present', async () => {
    firestoreState.setConfigDoc({ features: { foo: true } })
    const result = await handleGetConfig()
    expect(result).toEqual({ config: { features: { foo: true } } })
  })
})

describe('handleUpdateConfig — schema and round trip', () => {
  it('rejects unsupported top-level fields instead of reporting a false success', async () => {
    await expect(handleUpdateConfig(
      { features: { partsEnabled: true }, tuning: { temperature: 0.7 } },
      'zohoora@gmail.com',
    )).rejects.toThrow('Unsupported config field: tuning')
    expect(firestoreState.setMock).not.toHaveBeenCalled()
  })

  it('rejects unsupported nested fields', async () => {
    await expect(handleUpdateConfig(
      { grounding: { enabled: true } },
      'zohoora@gmail.com',
    )).rejects.toThrow('Unsupported grounding field: enabled')
    expect(firestoreState.setMock).not.toHaveBeenCalled()
  })

  it('round-trips every settings section rendered by the admin UI', async () => {
    firestoreState.setConfigDoc({ quota: { enabled: false } })
    const update = {
      defaultResponseSpeed: 1.4,
      features: {
        partsEnabled: true,
        visualEffectsEnabled: false,
        autocorrectEnabled: true,
        driftEnabled: true,
        roomEnabled: true,
        smsEnabled: false,
      },
      atmosphere: {
        timeShiftIntensity: 0.4,
        seasonalIntensity: 0.2,
        seasonOverride: 'autumn',
        flowThresholdSeconds: 80,
        flowGlowIntensity: 0.6,
        handwritingFont: 'Caveat',
        handwritingEffectBoost: 1.2,
      },
      partIntelligence: {
        quoteMinAge: 4,
        quoteChance: 0.2,
        disagreeChance: 0.1,
        disagreeMinParts: 3,
        quietThresholdDays: 5,
        returnBonusMultiplier: 2,
        catchphraseMaxPerPart: 3,
        silenceFlowThreshold: 120,
        silenceChance: 0.2,
      },
      engagement: {
        echoMaxAge: 90,
        echoChance: 0.1,
        echoMaxPerSession: 3,
        weatherUpdateInterval: 5,
        letterTriggerEntries: 10,
        letterMinParts: 2,
        ritualDetectionWindow: 14,
        threadMaxAge: 30,
        threadChance: 0.15,
      },
      grounding: {
        autoExitMinutes: 5,
        selfRoleScoreBonus: 40,
        otherRolePenalty: 30,
        intensityThreshold: 3,
      },
      voice: { defaultVoice: 'marin' },
      announcement: { message: 'Hello', type: 'info', dismissible: true },
      buildVersion: 'release-2026-07-09',
    }

    const result = await handleUpdateConfig(update, 'zohoora@gmail.com')

    expect(result.config).toMatchObject(update)
    expect(result.config).toMatchObject({ quota: { enabled: false } })
    expect(result.config).toMatchObject({ updatedBy: 'zohoora@gmail.com' })
  })

  it('accepts the Room and SMS flags the admin UI renders (2026-10-14 contract)', async () => {
    firestoreState.setConfigDoc({})
    const result = await handleUpdateConfig(
      { features: { roomEnabled: false, smsEnabled: true, relaxEnabled: true, driftEnabled: false } },
      'zohoora@gmail.com',
    )
    expect(result.config).toMatchObject({
      features: { roomEnabled: false, smsEnabled: true, relaxEnabled: true, driftEnabled: false },
    })
  })

  it('rejects non-boolean Room/SMS flags', async () => {
    await expect(handleUpdateConfig({ features: { roomEnabled: 'yes' } }, 'zohoora@gmail.com'))
      .rejects.toThrow('features.roomEnabled must be a boolean')
    await expect(handleUpdateConfig({ features: { smsEnabled: 1 } }, 'zohoora@gmail.com'))
      .rejects.toThrow('features.smsEnabled must be a boolean')
    expect(firestoreState.setMock).not.toHaveBeenCalled()
  })

  it('drops the retired customSoundscapesEnabled key instead of failing the save', async () => {
    // Older admin bundles and the stored live doc still carry it; soundscapeApi
    // was removed, so the key is ignored rather than persisted or rejected.
    firestoreState.setConfigDoc({})
    await handleUpdateConfig(
      { features: { partsEnabled: true, customSoundscapesEnabled: false } },
      'zohoora@gmail.com',
    )
    const [persisted] = firestoreState.setMock.mock.calls[0] as [Record<string, unknown>]
    expect(persisted.features).toEqual({ partsEnabled: true })
  })

  it('still rejects genuinely unknown feature keys', async () => {
    await expect(handleUpdateConfig({ features: { madeUpFlag: true } }, 'zohoora@gmail.com'))
      .rejects.toThrow('Unsupported features field: madeUpFlag')
    expect(firestoreState.setMock).not.toHaveBeenCalled()
  })

  it('attaches updatedBy = the admin email and a timestamp', async () => {
    firestoreState.setConfigDoc({})
    const before = Date.now()
    await handleUpdateConfig({ features: { partsEnabled: true } }, 'zohoora@gmail.com')
    const after = Date.now()

    const [persisted] = firestoreState.setMock.mock.calls[0] as [Record<string, unknown>]
    expect(persisted.updatedBy).toBe('zohoora@gmail.com')
    expect(typeof persisted.updatedAt).toBe('number')
    expect(persisted.updatedAt as number).toBeGreaterThanOrEqual(before)
    expect(persisted.updatedAt as number).toBeLessThanOrEqual(after)
  })

  it('uses { merge: true } so partial updates do not wipe sibling keys', async () => {
    firestoreState.setConfigDoc({})
    await handleUpdateConfig({ features: { partsEnabled: true } }, 'zohoora@gmail.com')
    const [, options] = firestoreState.setMock.mock.calls[0]
    expect(options).toEqual({ merge: true })
  })

  it('rejects an empty update', async () => {
    await expect(handleUpdateConfig({}, 'zohoora@gmail.com'))
      .rejects.toThrow('at least one field')
    expect(firestoreState.setMock).not.toHaveBeenCalled()
  })
})
