import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest'
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ALICE = 'alice-uid'
const BOB = 'bob-uid'
let testEnv: RulesTestEnvironment

function parseStorageHost(): { host: string; port: number } {
  const raw = process.env.FIREBASE_STORAGE_EMULATOR_HOST
    ?? process.env.STORAGE_EMULATOR_HOST
    ?? '127.0.0.1:9199'
  const [host, port] = raw.split(':')
  return { host: host || '127.0.0.1', port: Number(port) || 9199 }
}

beforeAll(async () => {
  const { host, port } = parseStorageHost()
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-storage-rules-test',
    storage: {
      rules: readFileSync(resolve(__dirname, '..', 'storage.rules'), 'utf8'),
      host,
      port,
    },
  })
})

afterAll(async () => testEnv.cleanup())
beforeEach(async () => testEnv.clearStorage())

async function seed(path: string) {
  await testEnv.withSecurityRulesDisabled(async context => {
    await context.storage().ref(path).putString('private bytes')
  })
}

describe('private field-moment images', () => {
  it('allows only the owning authenticated user to read', async () => {
    const path = `field-moments/${ALICE}/moment/0.jpg`
    await seed(path)
    await assertSucceeds(testEnv.authenticatedContext(ALICE).storage().ref(path).getDownloadURL())
    await assertFails(testEnv.authenticatedContext(BOB).storage().ref(path).getDownloadURL())
    await assertFails(testEnv.unauthenticatedContext().storage().ref(path).getDownloadURL())
  })

  it('keeps client writes server-only, including for the owner', async () => {
    const ref = testEnv.authenticatedContext(ALICE).storage().ref(`field-moments/${ALICE}/moment/0.jpg`)
    await assertFails(ref.putString('client bytes'))
  })
})

describe('shared soundscape cache', () => {
  it('allows authenticated reads but blocks unauthenticated reads and all client writes', async () => {
    const path = 'soundscapes/content.mp3'
    await seed(path)
    await assertSucceeds(testEnv.authenticatedContext(ALICE).storage().ref(path).getDownloadURL())
    await assertFails(testEnv.unauthenticatedContext().storage().ref(path).getDownloadURL())
    await assertFails(testEnv.authenticatedContext(ALICE).storage().ref(path).putString('replacement'))
  })
})
