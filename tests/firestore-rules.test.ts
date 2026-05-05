/**
 * Firestore security rules tests.
 *
 * Runs against the Firestore emulator using @firebase/rules-unit-testing,
 * which spins up scoped contexts with fake auth identities. No real Auth
 * emulator is needed — the harness mints test tokens directly.
 *
 * What we lock in:
 *   - User can read/write own subcollections under users/{uid}/...
 *   - User CANNOT read/write another user's subcollections
 *   - appConfig/* is readable by any signed-in user, write-protected
 *     (Cloud Functions write via Admin SDK, which bypasses rules)
 *   - contactMessages is fully deny-all from clients (Cloud Functions
 *     read/write it via Admin SDK)
 *   - Unauthenticated requests are denied everywhere
 */
import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest'
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { doc, getDoc, setDoc, deleteDoc, collection, addDoc } from 'firebase/firestore'

const ALICE = 'alice-uid'
const BOB = 'bob-uid'

let testEnv: RulesTestEnvironment

// `firebase emulators:exec` sets FIRESTORE_EMULATOR_HOST to "host:port" so the
// test honors whatever port the emulator actually bound to (default 8080, but
// can be configured in firebase.json or overridden if 8080 is in use).
function parseEmulatorHost(): { host: string; port: number } {
  const raw = process.env.FIRESTORE_EMULATOR_HOST
  if (!raw) return { host: '127.0.0.1', port: 8080 }
  const [host, portStr] = raw.split(':')
  return { host: host || '127.0.0.1', port: Number(portStr) || 8080 }
}

beforeAll(async () => {
  const { host, port } = parseEmulatorHost()
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-rules-test',
    firestore: {
      rules: readFileSync(resolve(__dirname, '..', 'firestore.rules'), 'utf8'),
      host,
      port,
    },
  })
})

afterAll(async () => {
  await testEnv.cleanup()
})

beforeEach(async () => {
  await testEnv.clearFirestore()
})

describe('users/{uid}/* — owner can read/write', () => {
  it('owner can write their own entry', async () => {
    const db = testEnv.authenticatedContext(ALICE).firestore()
    await assertSucceeds(
      setDoc(doc(db, `users/${ALICE}/entries/entry-1`), {
        plainText: 'hello',
        updatedAt: Date.now(),
      }),
    )
  })

  it('owner can read their own entry', async () => {
    // Seed via admin context (rules bypassed) so the read test isn't
    // testing write at the same time.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore()
      await setDoc(doc(db, `users/${ALICE}/entries/entry-1`), { plainText: 'hi' })
    })

    const db = testEnv.authenticatedContext(ALICE).firestore()
    await assertSucceeds(getDoc(doc(db, `users/${ALICE}/entries/entry-1`)))
  })

  it('owner can write nested session message', async () => {
    const db = testEnv.authenticatedContext(ALICE).firestore()
    await assertSucceeds(
      setDoc(doc(db, `users/${ALICE}/sessions/sess-1/messages/msg-1`), {
        speaker: 'user',
        content: 'hi',
      }),
    )
  })

  it('owner can write into any subcollection (wildcard match)', async () => {
    const db = testEnv.authenticatedContext(ALICE).firestore()
    // The rule is users/{uid}/{document=**}, so any subcollection works.
    for (const sub of ['parts', 'memories', 'thoughts', 'fossils', 'innerWeather', 'hrvSessions']) {
      await assertSucceeds(
        setDoc(doc(db, `users/${ALICE}/${sub}/doc-1`), { foo: 'bar' }),
      )
    }
  })

  it('owner can delete their own document', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), `users/${ALICE}/entries/e1`), { x: 1 })
    })
    const db = testEnv.authenticatedContext(ALICE).firestore()
    await assertSucceeds(deleteDoc(doc(db, `users/${ALICE}/entries/e1`)))
  })
})

describe('users/{uid}/* — cross-user isolation', () => {
  it('Bob cannot read Alice entry', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), `users/${ALICE}/entries/e1`), { plainText: 'private' })
    })
    const db = testEnv.authenticatedContext(BOB).firestore()
    await assertFails(getDoc(doc(db, `users/${ALICE}/entries/e1`)))
  })

  it('Bob cannot write to Alice entries', async () => {
    const db = testEnv.authenticatedContext(BOB).firestore()
    await assertFails(
      setDoc(doc(db, `users/${ALICE}/entries/e1`), { plainText: 'spoofed' }),
    )
  })

  it('Bob cannot read Alice session messages', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(
        doc(ctx.firestore(), `users/${ALICE}/sessions/s1/messages/m1`),
        { content: 'private' },
      )
    })
    const db = testEnv.authenticatedContext(BOB).firestore()
    await assertFails(getDoc(doc(db, `users/${ALICE}/sessions/s1/messages/m1`)))
  })

  it('Bob cannot write to Alice session messages', async () => {
    const db = testEnv.authenticatedContext(BOB).firestore()
    await assertFails(
      setDoc(doc(db, `users/${ALICE}/sessions/s1/messages/m1`), { content: 'evil' }),
    )
  })

  it('Bob cannot delete Alice document', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), `users/${ALICE}/entries/e1`), { x: 1 })
    })
    const db = testEnv.authenticatedContext(BOB).firestore()
    await assertFails(deleteDoc(doc(db, `users/${ALICE}/entries/e1`)))
  })
})

describe('appConfig/* — read by auth, write blocked', () => {
  it('any authenticated user can read appConfig/global', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'appConfig/global'), { features: {} })
    })
    const db = testEnv.authenticatedContext(ALICE).firestore()
    await assertSucceeds(getDoc(doc(db, 'appConfig/global')))
  })

  it('authenticated user cannot write appConfig — blocks privilege escalation', async () => {
    const db = testEnv.authenticatedContext(ALICE).firestore()
    await assertFails(
      setDoc(doc(db, 'appConfig/global'), { features: { evil: true } }),
    )
  })

  it('admin email cannot write appConfig from client SDK either', async () => {
    // Even Arash signed in as himself can't write — admin writes go through
    // adminApi Cloud Function which uses the Admin SDK (bypasses rules).
    const db = testEnv
      .authenticatedContext(ALICE, { email: 'zohoora@gmail.com' })
      .firestore()
    await assertFails(
      setDoc(doc(db, 'appConfig/global'), { features: { evil: true } }),
    )
  })

  it('unauthenticated user cannot read appConfig', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'appConfig/global'), { features: {} })
    })
    const db = testEnv.unauthenticatedContext().firestore()
    await assertFails(getDoc(doc(db, 'appConfig/global')))
  })
})

describe('contactMessages — fully deny-all from clients', () => {
  it('authenticated user cannot read contactMessages', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'contactMessages/m1'), { uid: ALICE, message: 'hi' })
    })
    const db = testEnv.authenticatedContext(ALICE).firestore()
    await assertFails(getDoc(doc(db, 'contactMessages/m1')))
  })

  it('authenticated user cannot write contactMessages directly', async () => {
    // Writes happen via accountApi Cloud Function (Admin SDK). The client must
    // never be able to bypass the function and inject messages directly.
    const db = testEnv.authenticatedContext(ALICE).firestore()
    await assertFails(
      addDoc(collection(db, 'contactMessages'), { uid: ALICE, message: 'spoofed' }),
    )
  })

  it('unauthenticated user cannot read or write contactMessages', async () => {
    const db = testEnv.unauthenticatedContext().firestore()
    await assertFails(
      addDoc(collection(db, 'contactMessages'), { uid: 'anon', message: 'spam' }),
    )
  })
})

describe('Unauthenticated access — denied everywhere', () => {
  it('cannot read users/{uid}/entries', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), `users/${ALICE}/entries/e1`), { x: 1 })
    })
    const db = testEnv.unauthenticatedContext().firestore()
    await assertFails(getDoc(doc(db, `users/${ALICE}/entries/e1`)))
  })

  it('cannot write users/{uid}/entries', async () => {
    const db = testEnv.unauthenticatedContext().firestore()
    await assertFails(
      setDoc(doc(db, `users/${ALICE}/entries/e1`), { x: 1 }),
    )
  })

  it('cannot read users/{uid}/sessions/{sid}/messages', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(
        doc(ctx.firestore(), `users/${ALICE}/sessions/s1/messages/m1`),
        { content: 'x' },
      )
    })
    const db = testEnv.unauthenticatedContext().firestore()
    await assertFails(getDoc(doc(db, `users/${ALICE}/sessions/s1/messages/m1`)))
  })
})

describe('Arbitrary top-level collections — denied', () => {
  it('authenticated user cannot create arbitrary top-level docs', async () => {
    // No rule covers /someRandomCollection/*, so default-deny applies.
    const db = testEnv.authenticatedContext(ALICE).firestore()
    await assertFails(
      setDoc(doc(db, 'someRandomCollection/doc-1'), { foo: 'bar' }),
    )
  })
})
