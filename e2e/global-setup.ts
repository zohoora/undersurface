import { initializeTestEnvironment } from '@firebase/rules-unit-testing'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Load firestore.rules into the emulator for the save harness's project, and
// start each run from an empty database.
export default async function globalSetup() {
  const env = await initializeTestEnvironment({
    projectId: 'demo-folio-e2e',
    firestore: { rules: readFileSync(resolve(process.cwd(), 'firestore.rules'), 'utf8'), host: '127.0.0.1', port: 8087 },
  })
  await env.clearFirestore()
  await env.cleanup()
}
