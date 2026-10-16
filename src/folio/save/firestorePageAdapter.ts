import { doc, getDocFromServer, onSnapshot, setDoc } from 'firebase/firestore'
import type { Firestore } from 'firebase/firestore'
import type { FolioPage } from '../../types/folio'
import type { ServerCopy } from './classify'
import { UnavailableError } from './PageSaveController'
import type { PageStoreAdapter } from './PageSaveController'

// The production adapter for C2: full-page writes (no merge), server reads
// that bypass the cache, and a metadata-aware listener for the on-load rule.

export interface PageSnapshot {
  exists: boolean
  page: FolioPage | null
  fromCache: boolean
  hasPendingWrites: boolean
}

export interface FirestorePageAdapter extends PageStoreAdapter {
  subscribe(pageId: string, onSnapshot: (snap: PageSnapshot) => void, onError?: (err: unknown) => void): () => void
  /** Resolves with the first server-confirmed snapshot: not from the cache, no pending writes. */
  waitForConfirmed(pageId: string): Promise<ServerCopy>
}

export function firestorePageAdapter(db: Firestore, uid: string): FirestorePageAdapter {
  const ref = (pageId: string) => doc(db, 'users', uid, 'folioPages', pageId)

  const toServerCopy = (page: FolioPage | null): ServerCopy =>
    page ? { exists: true, revId: page.revId, doc: page.doc } : { exists: false }

  const adapter: FirestorePageAdapter = {
    async write(page) {
      await setDoc(ref(page.id), page)
    },

    async readServer(pageId) {
      try {
        const snap = await getDocFromServer(ref(pageId))
        return toServerCopy(snap.exists() ? (snap.data() as FolioPage) : null)
      } catch (err) {
        const code = (err as { code?: string })?.code
        if (code === 'unavailable' || code === 'failed-precondition' || code === 'deadline-exceeded') throw new UnavailableError()
        throw err
      }
    },

    subscribe(pageId, cb, onError) {
      return onSnapshot(ref(pageId), { includeMetadataChanges: true }, (snap) => {
        cb({
          exists: snap.exists(),
          page: snap.exists() ? (snap.data() as FolioPage) : null,
          fromCache: snap.metadata.fromCache,
          hasPendingWrites: snap.metadata.hasPendingWrites,
        })
      }, (err) => onError?.(err))
    },

    waitForConfirmed(pageId) {
      return new Promise((resolve, reject) => {
        let done = false
        const unsubscribe = adapter.subscribe(pageId, (snap) => {
          if (done || snap.fromCache || snap.hasPendingWrites) return
          done = true
          queueMicrotask(() => unsubscribe())
          resolve(toServerCopy(snap.page))
        }, (err) => { if (!done) { done = true; reject(err) } })
      })
    },
  }
  return adapter
}
