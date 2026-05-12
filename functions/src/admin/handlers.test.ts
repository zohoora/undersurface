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
  const setMock = vi.fn().mockResolvedValue(undefined)
  let configDoc: Record<string, unknown> | null = null
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

describe('handleUpdateConfig — key allowlist (load-bearing security invariant)', () => {
  // CRITICAL: appConfig/global is readable by every authenticated user. An
  // admin (or compromised admin token) MUST NOT be able to write arbitrary
  // keys — only the four whitelisted top-level keys. If this test breaks,
  // someone weakened the allowlist; review the change.
  it('strips top-level keys that are NOT in the allowlist', async () => {
    firestoreState.setConfigDoc({}) // post-set get
    await handleUpdateConfig(
      {
        features: { partsEnabled: true },
        tuning: { temperature: 0.7 },
        grounding: { enabled: true },
        announcement: 'hello',
        // Below: keys an attacker might want injected — must be dropped.
        secrets: { adminKey: 'pwned' },
        adminEmails: ['attacker@example.com'],
        __proto__: { dangerous: true },
      },
      'zohoora@gmail.com',
    )

    expect(firestoreState.setMock).toHaveBeenCalledOnce()
    const [persisted] = firestoreState.setMock.mock.calls[0]
    const persistedKeys = Object.keys(persisted as Record<string, unknown>).sort()
    expect(persistedKeys).toEqual([
      'announcement',
      'features',
      'grounding',
      'tuning',
      'updatedAt',
      'updatedBy',
    ])
    expect(persisted).not.toHaveProperty('secrets')
    expect(persisted).not.toHaveProperty('adminEmails')
  })

  it('attaches updatedBy = the admin email and a timestamp', async () => {
    firestoreState.setConfigDoc({})
    const before = Date.now()
    await handleUpdateConfig({ features: { x: 1 } }, 'zohoora@gmail.com')
    const after = Date.now()

    const [persisted] = firestoreState.setMock.mock.calls[0] as [Record<string, unknown>]
    expect(persisted.updatedBy).toBe('zohoora@gmail.com')
    expect(typeof persisted.updatedAt).toBe('number')
    expect(persisted.updatedAt as number).toBeGreaterThanOrEqual(before)
    expect(persisted.updatedAt as number).toBeLessThanOrEqual(after)
  })

  it('uses { merge: true } so partial updates do not wipe sibling keys', async () => {
    firestoreState.setConfigDoc({})
    await handleUpdateConfig({ features: { x: 1 } }, 'zohoora@gmail.com')
    const [, options] = firestoreState.setMock.mock.calls[0]
    expect(options).toEqual({ merge: true })
  })

  it('returns an error (no write) when the partial contains zero allowlisted keys', async () => {
    const result = await handleUpdateConfig(
      { secrets: 'x', notARealKey: 'y' },
      'zohoora@gmail.com',
    )
    expect(result).toEqual({ error: 'No valid config keys provided' })
    expect(firestoreState.setMock).not.toHaveBeenCalled()
  })
})
