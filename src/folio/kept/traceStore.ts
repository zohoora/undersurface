import { collection, doc, getDocs, onSnapshot, orderBy, query, setDoc, updateDoc, where, writeBatch } from 'firebase/firestore'
import { firestore } from '../../firebase'
import type { FolioTrace, FolioTraceEntry } from '../../types/folio'

// Kept things in Firestore (draft 4 §6.6): users/{uid}/folioTraces/{traceId}
// and its entries. The rules reject any change to a kept field or an entry's
// text; these helpers only ever create, delete, or update the fields the
// rules allow (title, the come-back fields and the checked set).

export type TracePatch = Partial<Pick<FolioTrace, 'title' | 'titleBy' | 'comeBackAt' | 'comeBackTz' | 'comeBackSetAt' | 'lastComeBackShownAt' | 'returnEligible' | 'lastReturnShownAt'>>

export function tracesCollection(uid: string) {
  return collection(firestore, 'users', uid, 'folioTraces')
}

function traceRef(uid: string, traceId: string) {
  return doc(firestore, 'users', uid, 'folioTraces', traceId)
}

function entriesCollection(uid: string, traceId: string) {
  return collection(firestore, 'users', uid, 'folioTraces', traceId, 'entries')
}

/** Every trace, newest first. Traces are few; the floor and the slip share this. */
export function subscribeTraces(uid: string, onTraces: (traces: FolioTrace[]) => void, onError?: (err: unknown) => void): () => void {
  const q = query(tracesCollection(uid), orderBy('keptAt', 'desc'))
  return onSnapshot(q, (snap) => onTraces(snap.docs.map((d) => d.data() as FolioTrace)), (err) => onError?.(err))
}

export function subscribeEntries(uid: string, traceId: string, onEntries: (entries: FolioTraceEntry[]) => void, onError?: (err: unknown) => void): () => void {
  const q = query(entriesCollection(uid, traceId), orderBy('addedAt', 'asc'))
  return onSnapshot(q, (snap) => onEntries(snap.docs.map((d) => d.data() as FolioTraceEntry)), (err) => onError?.(err))
}

/** Resolves when the server accepts it; the local cache shows it at once. */
export function createTrace(uid: string, trace: FolioTrace): Promise<void> {
  return setDoc(traceRef(uid, trace.id), trace)
}

export function updateTrace(uid: string, traceId: string, patch: TracePatch): Promise<void> {
  return updateDoc(traceRef(uid, traceId), patch)
}

export function saveTraceChecked(uid: string, traceId: string, checked: string[]): Promise<void> {
  return updateDoc(traceRef(uid, traceId), { 'safety.checked': checked })
}

export function addEntry(uid: string, traceId: string, entry: FolioTraceEntry): Promise<void> {
  return setDoc(doc(entriesCollection(uid, traceId), entry.id), entry)
}

export async function deleteEntry(uid: string, traceId: string, entryId: string): Promise<void> {
  const batch = writeBatch(firestore)
  batch.delete(doc(entriesCollection(uid, traceId), entryId))
  await batch.commit()
}

/** Firestore doesn't cascade: a trace's entries go first, in the same batch. */
export async function deleteTrace(uid: string, traceId: string): Promise<void> {
  const entries = await getDocs(entriesCollection(uid, traceId))
  const batch = writeBatch(firestore)
  for (const e of entries.docs) batch.delete(e.ref)
  batch.delete(traceRef(uid, traceId))
  await batch.commit()
}

/** Traces kept from a page (a single-field query; no composite index). */
export async function tracesFromPage(uid: string, pageId: string): Promise<FolioTrace[]> {
  const snap = await getDocs(query(tracesCollection(uid), where('source.pageId', '==', pageId)))
  return snap.docs.map((d) => d.data() as FolioTrace)
}

/** The newest trace kept from this fold, for previousTraceId. */
export async function latestTraceOfFold(uid: string, foldId: string): Promise<FolioTrace | null> {
  const snap = await getDocs(query(tracesCollection(uid), where('source.foldId', '==', foldId)))
  const traces = snap.docs.map((d) => d.data() as FolioTrace).sort((a, b) => b.keptAt - a.keptAt)
  return traces[0] ?? null
}
