// Folio's own record of unsaved words on this device (draft 4 §5.2, C2).
// One entry per mounted editor, so two tabs never overwrite each other's
// entry. localStorage rather than IndexedDB because the flush on `pagehide`
// must be synchronous. Every write reports whether it succeeded, so the save
// status never claims local safety it doesn't have.

export interface PendingEntry {
  pageId: string
  editorId: string
  /** The server revision this chain was built on (null: the page isn't created yet). */
  baseRevId: string | null
  /** Every revision this editor has sent since its base, acknowledged or not. */
  sentRevIds: string[]
  /** The server has acknowledged the page's creation. */
  created: boolean
  /** The editor's content: ProseMirror JSON, stringified. */
  doc: string
  /** The checked set for exactly this content (§5.4). */
  checked: string[]
  preview: string
  foldCount: number
  createdAt: number
  updatedAt: number
}

const PREFIX = 'us.folioPending.'

export function pendingKey(uid: string, pageId: string, editorId: string): string {
  return `${PREFIX}${uid}.${pageId}.${editorId}`
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

/** Returns false when the device couldn't store it (quota, private mode, disabled). */
export function writePending(uid: string, entry: PendingEntry): boolean {
  const s = storage()
  if (!s) return false
  try {
    s.setItem(pendingKey(uid, entry.pageId, entry.editorId), JSON.stringify(entry))
    return true
  } catch {
    return false
  }
}

function parse(raw: string | null): PendingEntry | null {
  if (!raw) return null
  try {
    const e = JSON.parse(raw) as PendingEntry
    if (typeof e?.pageId !== 'string' || typeof e.editorId !== 'string' || typeof e.doc !== 'string' || !Array.isArray(e.sentRevIds)) return null
    return { ...e, checked: Array.isArray(e.checked) ? e.checked : [], created: e.created === true || e.baseRevId !== null }
  } catch {
    return null
  }
}

export function readPending(uid: string, pageId: string, editorId: string): PendingEntry | null {
  const s = storage()
  if (!s) return null
  try {
    return parse(s.getItem(pendingKey(uid, pageId, editorId)))
  } catch {
    return null
  }
}

/** Every entry for a page, from every editor that ever had it open here. */
export function listPending(uid: string, pageId: string): PendingEntry[] {
  const s = storage()
  if (!s) return []
  const prefix = `${PREFIX}${uid}.${pageId}.`
  const out: PendingEntry[] = []
  try {
    for (let i = 0; i < s.length; i++) {
      const key = s.key(i)
      if (!key || !key.startsWith(prefix)) continue
      const e = parse(s.getItem(key))
      if (e) out.push(e)
    }
  } catch {
    return out
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt)
}

/** One entry per page (the newest), across every page this user has pending here. */
export function listPendingForUser(uid: string): PendingEntry[] {
  const s = storage()
  if (!s) return []
  const prefix = `${PREFIX}${uid}.`
  const byPage = new Map<string, PendingEntry>()
  try {
    for (let i = 0; i < s.length; i++) {
      const key = s.key(i)
      if (!key || !key.startsWith(prefix)) continue
      const e = parse(s.getItem(key))
      if (e && (!byPage.has(e.pageId) || (byPage.get(e.pageId) as PendingEntry).updatedAt < e.updatedAt)) byPage.set(e.pageId, e)
    }
  } catch {
    return [...byPage.values()]
  }
  return [...byPage.values()].sort((a, b) => b.updatedAt - a.updatedAt)
}

export function removePending(uid: string, pageId: string, editorId: string): void {
  const s = storage()
  if (!s) return
  try {
    s.removeItem(pendingKey(uid, pageId, editorId))
  } catch {
    // nothing to do
  }
}

/** Sign-out and account deletion: every Folio key for this user on this device. */
export function clearFolioLocalForUser(uid: string): void {
  // The Talk handoff lives in sessionStorage for one navigation; it goes too.
  try { sessionStorage.removeItem('us.folioHandoff') } catch { /* nothing to do */ }
  const s = storage()
  if (!s) return
  const prefixes = [`${PREFIX}${uid}.`, `us.folioView.${uid}.`, `us.folioActivation.${uid}`, `us.folioSound.${uid}`]
  try {
    const doomed: string[] = []
    for (let i = 0; i < s.length; i++) {
      const key = s.key(i)
      if (key && prefixes.some((p) => key.startsWith(p))) doomed.push(key)
    }
    for (const key of doomed) s.removeItem(key)
  } catch {
    // nothing to do
  }
}
