// Folio's save layer in a real browser, with the persistent multi-tab cache
// and IndexedDB, against the Firestore emulator (build plan step 2, S4's
// outcomes 10, 11 and the browser form of 12). Served by Vite in dev only.
import { initializeApp } from 'firebase/app'
import {
  connectFirestoreEmulator, disableNetwork, doc, enableNetwork, getDocFromCache, getDocFromServer,
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
} from 'firebase/firestore'
import { PageSaveController } from '../../src/folio/save/PageSaveController'
import type { PageContent, SaveStatus } from '../../src/folio/save/PageSaveController'
import { firestorePageAdapter } from '../../src/folio/save/firestorePageAdapter'
import { listPending, removePending, writePending } from '../../src/folio/save/pendingStore'
import { acquirePageLock, holdEditorLiveness, liveEditorIds } from '../../src/folio/save/pageLock'
import type { PageLock } from '../../src/folio/save/pageLock'
import { prepareEditable, resolveOtherOrphans } from '../../src/folio/save/pageSession'
import { newId } from '../../src/folio/page/schema'
import type { FolioPage } from '../../src/types/folio'

const params = new URLSearchParams(location.search)
const PROJECT = 'demo-folio-e2e'
const UID = 'writer-e2e'
const PORT = Number(params.get('port') ?? 8087)

const app = initializeApp({ projectId: PROJECT, apiKey: 'demo' })
const db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) })
connectFirestoreEmulator(db, '127.0.0.1', PORT, { mockUserToken: { sub: UID, user_id: UID } })
const adapter = firestorePageAdapter(db, UID)

const state = {
  editorId: newId(),
  status: null as SaveStatus | null,
  holder: false,
  ready: false,
  copies: [] as { id: string; doc: string }[],
  deleted: [] as string[],
  diagnostics: [] as string[],
  readOnlyReason: '' as string,
}
let controller: PageSaveController | null = null
let lock: PageLock | null = null
let releaseLiveness: (() => void) | null = null
let pageId = ''
let latest = ''

const content = (text: string): PageContent => ({ doc: text, checked: [], preview: text.slice(0, 40), foldCount: 0 })

async function snapshotPage(): Promise<FolioPage | null> {
  try {
    const s = await getDocFromCache(doc(db, 'users', UID, 'folioPages', pageId))
    return s.exists() ? (s.data() as FolioPage) : null
  } catch {
    try {
      const s = await getDocFromServer(doc(db, 'users', UID, 'folioPages', pageId))
      return s.exists() ? (s.data() as FolioPage) : null
    } catch {
      return null
    }
  }
}

async function becomeEditable() {
  state.holder = true
  const page = await snapshotPage()
  const deps = { uid: UID, pageId, editorId: state.editorId, listPending, removePending, writePending, liveEditorIds }
  const { start, others, adopted } = await prepareEditable(deps, page, '', Date.now())
  latest = start.content.doc
  controller = new PageSaveController({
    uid: UID, pageId, editorId: state.editorId, adapter,
    newRevId: newId, newPageId: newId,
    copyPreview: (p) => `${p} (this device)`,
    onStatus: (s) => { state.status = s },
    onConflictCopy: (id, c) => { state.copies.push({ id, doc: c.doc }) },
    onRemoteDeleted: (c) => { state.deleted.push(c.doc) },
    onDiagnostic: (c) => { state.diagnostics.push(c) },
  }, start)
  state.ready = true
  if (adopted) {
    const server = await adapter.waitForConfirmed(pageId)
    controller.confirm(server)
    await resolveOtherOrphans(deps, adapter, others, Date.now, (p) => `${p} (this device)`)
  }
}

const api = {
  async open(id: string, opts: { offline?: boolean } = {}) {
    pageId = id
    if (opts.offline) await disableNetwork(db)
    releaseLiveness = holdEditorLiveness(state.editorId)
    lock = acquirePageLock(UID, pageId, state.editorId)
    lock.onHandoverRequest(async () => {
      controller?.flush()
      await new Promise((r) => setTimeout(r, 50))
      controller?.dispose()
      controller = null
      state.ready = false
      state.holder = false
      state.readOnlyReason = 'handedOver'
    })
    void lock.granted.then(() => becomeEditable())
    return state.editorId
  },
  edit(text: string) {
    if (!controller) return false
    latest = text
    controller.edit(content(text))
    controller.flush()
    return true
  },
  async editHere() { return lock ? lock.requestHandover() : false },
  async offline() { await disableNetwork(db) },
  async online() { await enableNetwork(db) },
  async server(id: string) {
    // A tab that just became primary may still be connecting: retry briefly.
    for (let i = 0; ; i++) {
      try {
        const s = await getDocFromServer(doc(db, 'users', UID, 'folioPages', id))
        return s.exists() ? (s.data() as FolioPage).doc : null
      } catch (err) {
        if (i >= 120) throw err
        await new Promise((r) => setTimeout(r, 125))
      }
    }
  },
  pending: () => listPending(UID, pageId).map((e) => ({ editorId: e.editorId, doc: e.doc })),
  state: () => ({ ...state, latest }),
  close() {
    controller?.dispose()
    lock?.release()
    releaseLiveness?.()
  },
}

;(window as unknown as { folioSave: typeof api }).folioSave = api
document.body.dataset.ready = 'true'
