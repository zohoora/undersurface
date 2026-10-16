// Folio's save controller with the real Firestore SDK and the real rules, on
// the emulator (build plan step 2, S4's outcomes 1–9, 12 and 13; outcomes 10
// and 11 need IndexedDB and run in the browser harness). Two modular clients
// signed in as the same writer stand for two devices.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { initializeTestEnvironment } from '@firebase/rules-unit-testing'
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { deleteApp, initializeApp } from 'firebase/app'
import type { FirebaseApp } from 'firebase/app'
import {
  connectFirestoreEmulator, deleteDoc, disableNetwork, doc, enableNetwork, getDocFromServer, getFirestore, setDoc, terminate,
} from 'firebase/firestore'
import type { Firestore } from 'firebase/firestore'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { PageSaveController } from '../src/folio/save/PageSaveController'
import type { PageContent, PageStoreAdapter, SaveStatus } from '../src/folio/save/PageSaveController'
import { firestorePageAdapter } from '../src/folio/save/firestorePageAdapter'
import type { PendingEntry } from '../src/folio/save/pendingStore'
import type { FolioPage } from '../src/types/folio'

const PROJECT = 'demo-folio-save'
const UID = 'writer-1'

function emulatorHost(): { host: string; port: number } {
  const raw = process.env.FIRESTORE_EMULATOR_HOST
  if (!raw) return { host: '127.0.0.1', port: 8080 }
  const [host, port] = raw.split(':')
  return { host: host || '127.0.0.1', port: Number(port) || 8080 }
}

let env: RulesTestEnvironment
const apps: FirebaseApp[] = []
let seq = 0

function client(): Firestore {
  const app = initializeApp({ projectId: PROJECT, apiKey: 'demo' }, `device-${++seq}`)
  apps.push(app)
  const db = getFirestore(app)
  const { host, port } = emulatorHost()
  connectFirestoreEmulator(db, host, port, { mockUserToken: { sub: UID, user_id: UID } })
  return db
}

beforeAll(async () => {
  const { host, port } = emulatorHost()
  env = await initializeTestEnvironment({
    projectId: PROJECT,
    firestore: { rules: readFileSync(resolve(__dirname, '..', 'firestore.rules'), 'utf8'), host, port },
  })
})

afterAll(async () => {
  for (const app of apps) await deleteApp(app).catch(() => {})
  await env.cleanup()
})

beforeEach(async () => {
  await env.clearFirestore()
})

const content = (text: string): PageContent => ({ doc: text, checked: [], preview: text.slice(0, 40), foldCount: 0 })

async function until(cond: () => boolean, ms = 8000): Promise<void> {
  const start = Date.now()
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error('timed out waiting')
    await new Promise((r) => setTimeout(r, 25))
  }
}

interface Device {
  db: Firestore
  controller: PageSaveController
  statuses: SaveStatus[]
  copies: { id: string; content: PageContent }[]
  deleted: PageContent[]
  diagnostics: string[]
  store: Map<string, PendingEntry>
  edit: (text: string) => void
}

let rev = 0
function device(pageId: string, start: Partial<ConstructorParameters<typeof PageSaveController>[1]> = {}, opts: { db?: Firestore; adapter?: (a: PageStoreAdapter) => PageStoreAdapter; store?: Map<string, PendingEntry>; editorId?: string } = {}): Device {
  const db = opts.db ?? client()
  const base = firestorePageAdapter(db, UID)
  const adapter = opts.adapter ? opts.adapter(base) : base
  const statuses: SaveStatus[] = []
  const copies: Device['copies'] = []
  const deleted: PageContent[] = []
  const diagnostics: string[] = []
  const store = opts.store ?? new Map<string, PendingEntry>()
  const controller = new PageSaveController({
    uid: UID, pageId, editorId: opts.editorId ?? `ed-${++seq}`, adapter,
    newRevId: () => `rev-${++rev}`,
    newPageId: () => `copy-${++rev}`,
    pending: {
      write: (_u, e) => { store.set(`${e.pageId}/${e.editorId}`, e); return true },
      remove: (_u, p, ed) => { store.delete(`${p}/${ed}`) },
    },
    onStatus: (s) => statuses.push(s),
    onConflictCopy: (id, c) => copies.push({ id, content: c }),
    onRemoteDeleted: (c) => deleted.push(c),
    onDiagnostic: (c) => diagnostics.push(c),
  }, { baseRevId: null, created: false, rev: 0, createdAt: 1, content: content(''), serverDoc: '', ...start })
  return { db, controller, statuses, copies, deleted, diagnostics, store, edit: (t) => { controller.edit(content(t)); controller.flush() } }
}

async function serverPage(pageId: string): Promise<FolioPage | null> {
  const snap = await getDocFromServer(doc(client(), 'users', UID, 'folioPages', pageId))
  return snap.exists() ? (snap.data() as FolioPage) : null
}

async function seed(pageId: string, text: string): Promise<{ revId: string }> {
  const a = device(pageId)
  a.edit(text)
  await until(() => a.controller.currentStatus === 'saved')
  return { revId: a.controller.chainState.baseRevId as string }
}

const startAt = (revId: string, text: string) => ({ baseRevId: revId, created: true, serverDoc: text, content: content(text) })

describe('S4 on the emulator', () => {
  it('1. concurrent writes online: one is accepted, the other becomes one conflict copy', async () => {
    const { revId } = await seed('p1', 'base')
    const a = device('p1', startAt(revId, 'base'))
    const b = device('p1', startAt(revId, 'base'))
    a.edit('from A')
    await until(() => a.controller.currentStatus === 'saved')
    b.edit('from B')
    await until(() => b.copies.length === 1)
    expect((await serverPage('p1'))?.doc).toBe('from A')
    expect(b.copies[0].content.doc).toBe('from B')
    expect([...b.store.keys()].some((k) => k.startsWith(`${b.copies[0].id}/`))).toBe(true)
  })

  it('2. concurrent writes offline, reconnecting in either order', async () => {
    for (const order of ['AB', 'BA']) {
      const pageId = `p2-${order}`
      const { revId } = await seed(pageId, 'base')
      const a = device(pageId, startAt(revId, 'base'))
      const b = device(pageId, startAt(revId, 'base'))
      await disableNetwork(a.db)
      await disableNetwork(b.db)
      a.edit('A offline')
      b.edit('B offline')
      const [first, second] = order === 'AB' ? [a, b] : [b, a]
      await enableNetwork(first.db)
      await until(() => first.controller.currentStatus === 'saved')
      await enableNetwork(second.db)
      await until(() => second.copies.length === 1)
      expect((await serverPage(pageId))?.doc).toBe(order === 'AB' ? 'A offline' : 'B offline')
      expect(second.copies).toHaveLength(1)
    }
  })

  it('3. a delayed acknowledgement keeps the status and the device store honest', async () => {
    const { revId } = await seed('p3', 'base')
    const a = device('p3', startAt(revId, 'base'))
    await disableNetwork(a.db)
    a.edit('N')
    a.edit('N+1')
    expect(a.controller.currentStatus).toBe('savedLocal')
    expect([...a.store.values()][0]?.doc).toBe('N+1')
    await enableNetwork(a.db)
    await until(() => a.controller.currentStatus === 'saved')
    expect(a.store.size).toBe(0)
    expect((await serverPage('p3'))?.doc).toBe('N+1')
  })

  it('4 and 13. a rejected chain of queued writes makes exactly one copy, and nothing is applied', async () => {
    const { revId } = await seed('p4', 'base')
    const a = device('p4', startAt(revId, 'base'))
    const b = device('p4', startAt(revId, 'base'))
    await disableNetwork(a.db)
    a.edit('a1')
    a.edit('a2')
    a.edit('a3')
    b.edit('B moved on')
    await until(() => b.controller.currentStatus === 'saved')
    await enableNetwork(a.db)
    await until(() => a.copies.length === 1)
    await new Promise((r) => setTimeout(r, 300))
    expect(a.copies).toHaveLength(1)
    expect(a.copies[0].content.doc).toBe('a3')
    expect((await serverPage('p4'))?.doc).toBe('B moved on')
  })

  it('5. edit versus delete: the page is never recreated, and the words are offered back', async () => {
    const { revId } = await seed('p5', 'base')
    const a = device('p5', startAt(revId, 'base'))
    await disableNetwork(a.db)
    a.edit('edited offline')
    await deleteDoc(doc(client(), 'users', UID, 'folioPages', 'p5'))
    await enableNetwork(a.db)
    await until(() => a.deleted.length === 1)
    expect(await serverPage('p5')).toBeNull()
    expect(a.deleted[0].doc).toBe('edited offline')
  })

  it('6. with the device store unavailable, the status never says "Saved on this device"', async () => {
    const { revId } = await seed('p6', 'base')
    const db = client()
    const statuses: SaveStatus[] = []
    const c = new PageSaveController({
      uid: UID, pageId: 'p6', editorId: 'ed-6', adapter: firestorePageAdapter(db, UID),
      newRevId: () => `rev-${++rev}`, newPageId: () => `copy-${++rev}`,
      pending: { write: () => false, remove: () => {} },
      onStatus: (s) => statuses.push(s), onConflictCopy: () => {}, onRemoteDeleted: () => {},
    }, { ...startAt(revId, 'base'), rev: 1, createdAt: 1 })
    await disableNetwork(db)
    c.edit(content('unsaveable'))
    c.flush()
    expect(statuses).not.toContain('savedLocal')
    expect(c.currentStatus).toBe('notSaved')
  })

  it('7 and 8. a reload in the middle of a chain with the memory cache: the entry is committed on top, not copied', async () => {
    const { revId } = await seed('p7', 'base')
    const store = new Map<string, PendingEntry>()
    const a = device('p7', startAt(revId, 'base'), { store, editorId: 'ed-old' })
    await disableNetwork(a.db)
    a.edit('offline 1')
    a.edit('offline 2')
    // "Reload": the memory cache and the SDK's queue are gone.
    a.controller.dispose()
    await terminate(a.db)
    const entry = store.get('p7/ed-old') as PendingEntry
    expect(entry.doc).toBe('offline 2')
    const b = device('p7', {
      baseRevId: entry.baseRevId, sentRevIds: entry.sentRevIds, created: true, content: content(entry.doc), serverDoc: null, awaitingConfirmation: true,
    }, { store, editorId: 'ed-new' })
    b.controller.confirm(await firestorePageAdapter(b.db, UID).waitForConfirmed('p7'))
    await until(() => b.controller.currentStatus === 'saved')
    expect((await serverPage('p7'))?.doc).toBe('offline 2')
    expect(b.copies).toHaveLength(0)
  })

  it('9. a rejection that isn\'t a conflict makes no copy, in both forms', async () => {
    const { revId } = await seed('p9', 'base')
    // Over the rules' cap: permission-denied with the parent matching.
    const a = device('p9', startAt(revId, 'base'))
    a.edit('x'.repeat(960_000))
    await until(() => a.controller.currentStatus === 'couldNotSave', 15000)
    expect(a.copies).toHaveLength(0)
    expect(a.diagnostics.some((d) => d.startsWith('folio.save.rejected:permission-denied'))).toBe(true)
    // Over Firestore's 1 MiB: invalid-argument.
    const b = device('p9', startAt(revId, 'base'))
    b.edit('é'.repeat(600_000))
    await until(() => b.controller.currentStatus === 'couldNotSave', 15000)
    expect(b.copies).toHaveLength(0)
    expect(b.diagnostics.some((d) => d.startsWith('folio.save.rejected:invalid-argument'))).toBe(true)
    expect((await serverPage('p9'))?.doc).toBe('base')
  })

  it('12. a write that landed and was sent again is not a conflict', async () => {
    const { revId } = await seed('p12', 'base')
    // The SDK re-sends unacknowledged writes after a dropped stream; model it
    // by sending the identical write a second time and reporting that result.
    const resend = (a: PageStoreAdapter): PageStoreAdapter => ({
      ...a,
      write: async (page) => { await a.write(page); await a.write(page) },
    })
    const a = device('p12', startAt(revId, 'base'), { adapter: resend })
    a.edit('mine')
    await until(() => a.controller.currentStatus === 'saved')
    expect(a.copies).toHaveLength(0)
    expect(a.diagnostics).toContain('folio.save.landedResent')
    expect((await serverPage('p12'))?.doc).toBe('mine')
  })

  it('rules: a create needs a null parent, and an update must be built on the server\'s revision', async () => {
    const db = client()
    const ref = doc(db, 'users', UID, 'folioPages', 'pr')
    const page = (revId: string, parentRevId: string | null): FolioPage => ({
      id: 'pr', createdAt: 1, updatedAt: 1, doc: 'x', schemaVersion: 2, revId, parentRevId, rev: 1, editorId: 'e', preview: 'x', foldCount: 0, safety: { checked: [] },
    })
    await expect(setDoc(ref, page('r1', 'nope'))).rejects.toMatchObject({ code: 'permission-denied' })
    await setDoc(ref, page('r1', null))
    await expect(setDoc(ref, page('r2', 'stale'))).rejects.toMatchObject({ code: 'permission-denied' })
    await expect(setDoc(ref, page('r1', 'r1'))).rejects.toMatchObject({ code: 'permission-denied' })
    await setDoc(ref, page('r2', 'r1'))
    await expect(setDoc(ref, { ...page('r3', 'r2'), extra: true } as FolioPage)).rejects.toMatchObject({ code: 'permission-denied' })
    const other = initializeApp({ projectId: PROJECT, apiKey: 'demo' }, `other-${++seq}`)
    apps.push(other)
    const odb = getFirestore(other)
    const { host, port } = emulatorHost()
    connectFirestoreEmulator(odb, host, port, { mockUserToken: { sub: 'someone-else', user_id: 'someone-else' } })
    await expect(getDocFromServer(doc(odb, 'users', UID, 'folioPages', 'pr'))).rejects.toMatchObject({ code: 'permission-denied' })
    // The generic owner rule no longer lets a merge write through.
    await expect(setDoc(ref, { doc: 'merged' }, { merge: true })).rejects.toMatchObject({ code: 'permission-denied' })
  })
})
