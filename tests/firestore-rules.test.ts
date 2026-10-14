// Runs against the Firestore emulator. @firebase/rules-unit-testing mints
// scoped auth contexts directly — no real Auth emulator needed.
import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest'
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  collection,
  addDoc,
  query,
  where,
} from 'firebase/firestore'

const ALICE = 'alice-uid'
const BOB = 'bob-uid'

let testEnv: RulesTestEnvironment

// Honors FIRESTORE_EMULATOR_HOST set by `firebase emulators:exec`, so the
// emulator port (firebase.json or firebase.test.json) is the source of truth.
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

  it.each(['parts', 'memories', 'thoughts', 'fossils', 'innerWeather', 'hrvSessions'])(
    'owner can write into users/{uid}/%s (wildcard match)',
    async (sub) => {
      const db = testEnv.authenticatedContext(ALICE).firestore()
      await assertSucceeds(
        setDoc(doc(db, `users/${ALICE}/${sub}/doc-1`), { foo: 'bar' }),
      )
    },
  )

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

describe('server-owned SMS docs under users/{uid} — owner read-only', () => {
  it.each(['current', 'riskState', 'optOut', 'usage'])(
    'owner can read but never write smsSettings/%s',
    async (docId) => {
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        await setDoc(doc(ctx.firestore(), `users/${ALICE}/smsSettings/${docId}`), { enabled: true })
      })
      const db = testEnv.authenticatedContext(ALICE).firestore()
      await assertSucceeds(getDoc(doc(db, `users/${ALICE}/smsSettings/${docId}`)))
      await assertFails(setDoc(doc(db, `users/${ALICE}/smsSettings/${docId}`), { phoneHash: 'spoofed' }))
      await assertFails(updateDoc(doc(db, `users/${ALICE}/smsSettings/${docId}`), { lastRiskAt: 0 }))
      await assertFails(deleteDoc(doc(db, `users/${ALICE}/smsSettings/${docId}`)))
    },
  )

  it('owner cannot create a new smsSettings doc (e.g. a forged phone hash)', async () => {
    const db = testEnv.authenticatedContext(ALICE).firestore()
    await assertFails(
      setDoc(doc(db, `users/${ALICE}/smsSettings/current`), { phoneHash: 'victim-hash', enabled: true }),
    )
  })

  it('owner can read and list their SMS transcript but never write it', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), `users/${ALICE}/smsMessages/SM1`), { body: 'hi', risk: 0 })
    })
    const db = testEnv.authenticatedContext(ALICE).firestore()
    await assertSucceeds(getDoc(doc(db, `users/${ALICE}/smsMessages/SM1`)))
    await assertSucceeds(getDocs(collection(db, `users/${ALICE}/smsMessages`)))
    await assertFails(updateDoc(doc(db, `users/${ALICE}/smsMessages/SM1`), { risk: 2 }))
    await assertFails(setDoc(doc(db, `users/${ALICE}/smsMessages/SM2`), { body: 'forged' }))
    await assertFails(deleteDoc(doc(db, `users/${ALICE}/smsMessages/SM1`)))
  })

  it('another user cannot read the SMS transcript or settings', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), `users/${ALICE}/smsMessages/SM1`), { body: 'private' })
      await setDoc(doc(ctx.firestore(), `users/${ALICE}/smsSettings/current`), { phoneLast4: '0123' })
    })
    const db = testEnv.authenticatedContext(BOB).firestore()
    await assertFails(getDoc(doc(db, `users/${ALICE}/smsMessages/SM1`)))
    await assertFails(getDoc(doc(db, `users/${ALICE}/smsSettings/current`)))
  })

  it('owner can read but not write the user root doc (deletion tombstone)', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), `users/${ALICE}`), { status: 'deleting', deletedAt: 1 })
    })
    const db = testEnv.authenticatedContext(ALICE).firestore()
    await assertSucceeds(getDoc(doc(db, `users/${ALICE}`)))
    await assertFails(setDoc(doc(db, `users/${ALICE}`), { status: 'active' }))
    await assertFails(deleteDoc(doc(db, `users/${ALICE}`)))
  })
})

describe('client-owned docs under users/{uid} stay owner-writable', () => {
  it('owner can merge lastGroundingAt and field-window consent into companionPreferences', async () => {
    const db = testEnv.authenticatedContext(ALICE).firestore()
    await assertSucceeds(
      setDoc(doc(db, `users/${ALICE}/companionPreferences/current`), { lastGroundingAt: Date.now() }, { merge: true }),
    )
    await assertSucceeds(
      updateDoc(doc(db, `users/${ALICE}/companionPreferences/current`), {
        fieldWindows: { enabled: true, consentAt: Date.now(), timezone: 'UTC', maxPerWeek: 1, windows: [] },
      }),
    )
  })

  it.each(['fieldMoments', 'researchEvents', 'interventionOutcomes', 'sessions'])(
    'owner can still write %s',
    async (sub) => {
      const db = testEnv.authenticatedContext(ALICE).firestore()
      await assertSucceeds(setDoc(doc(db, `users/${ALICE}/${sub}/doc-1`), { foo: 'bar' }))
    },
  )

  it('Bob cannot write Alice companionPreferences', async () => {
    const db = testEnv.authenticatedContext(BOB).firestore()
    await assertFails(
      setDoc(doc(db, `users/${ALICE}/companionPreferences/current`), { lastGroundingAt: 0 }, { merge: true }),
    )
  })
})

describe('quotas/{uid} — owner read-only', () => {
  it('owner can read their own quota but never write it', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), `quotas/${ALICE}`), { tokensUsed: 10 })
    })
    const db = testEnv.authenticatedContext(ALICE).firestore()
    await assertSucceeds(getDoc(doc(db, `quotas/${ALICE}`)))
    await assertFails(setDoc(doc(db, `quotas/${ALICE}`), { tokensUsed: 0 }))
    await assertFails(deleteDoc(doc(db, `quotas/${ALICE}`)))
  })

  it('another user cannot read someone else\'s quota', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), `quotas/${ALICE}`), { tokensUsed: 10 })
    })
    const db = testEnv.authenticatedContext(BOB).firestore()
    await assertFails(getDoc(doc(db, `quotas/${ALICE}`)))
  })
})

describe('top-level SMS and field-window queues — deny-all', () => {
  it.each(['smsPhoneLinks', 'smsLinkCodes', 'smsInbound', 'fieldWindowDispatches'])(
    '%s cannot be read or written by its own user',
    async (coll) => {
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        await setDoc(doc(ctx.firestore(), `${coll}/doc-1`), { uid: ALICE })
      })
      const db = testEnv.authenticatedContext(ALICE).firestore()
      await assertFails(getDoc(doc(db, `${coll}/doc-1`)))
      await assertFails(getDocs(query(collection(db, coll), where('uid', '==', ALICE))))
      await assertFails(setDoc(doc(db, `${coll}/doc-2`), { uid: ALICE }))
      await assertFails(deleteDoc(doc(db, `${coll}/doc-1`)))
    },
  )
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
