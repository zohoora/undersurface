import { collection, deleteDoc, doc, getDocs, limit, onSnapshot, orderBy, query, setDoc } from 'firebase/firestore'
import { firestore } from '../firebase'
import type { FolioPage, FolioPreferences } from '../types/folio'
import { firestorePageAdapter } from './save/firestorePageAdapter'
import type { FirestorePageAdapter } from './save/firestorePageAdapter'

// Folio's reads and writes outside the save controller: the pages list,
// deleting a page, and preferences. Paths are under users/{uid}/.

export const PAGES_LIST_LIMIT = 50

export function pagesCollection(uid: string) {
  return collection(firestore, 'users', uid, 'folioPages')
}

export function pageAdapter(uid: string): FirestorePageAdapter {
  return firestorePageAdapter(firestore, uid)
}

export function subscribePages(uid: string, onPages: (pages: FolioPage[]) => void, onError?: (err: unknown) => void): () => void {
  const q = query(pagesCollection(uid), orderBy('updatedAt', 'desc'), limit(PAGES_LIST_LIMIT))
  return onSnapshot(q, (snap) => onPages(snap.docs.map((d) => d.data() as FolioPage)), (err) => onError?.(err))
}

/** The page edited most recently, if any. */
export async function mostRecentPage(uid: string): Promise<FolioPage | null> {
  const snap = await getDocs(query(pagesCollection(uid), orderBy('updatedAt', 'desc'), limit(1)))
  return snap.empty ? null : (snap.docs[0].data() as FolioPage)
}

export async function deletePage(uid: string, pageId: string): Promise<void> {
  await deleteDoc(doc(firestore, 'users', uid, 'folioPages', pageId))
}

export function subscribePreferences(uid: string, cb: (prefs: FolioPreferences | null) => void): () => void {
  return onSnapshot(doc(firestore, 'users', uid, 'folioPreferences', 'current'), (snap) => cb(snap.exists() ? (snap.data() as FolioPreferences) : null), () => cb(null))
}

export async function updatePreferences(uid: string, patch: Partial<FolioPreferences>): Promise<void> {
  await setDoc(doc(firestore, 'users', uid, 'folioPreferences', 'current'), { id: 'current', ...patch }, { merge: true })
}

/** The empty page, serialized as the controller stores it. */
export const EMPTY_DOC = JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', attrs: { pid: null } }] })
