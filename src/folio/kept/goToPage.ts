// "Go to the page" (draft 4 §3.7): opens the source page at the fold. The
// fold to open is handed to the page once, through a short-lived slot bound
// to the account and the page.

const KEY = 'us.folioOpenFold'
const MAX_AGE_MS = 60 * 1000

export function writeOpenFoldIntent(uid: string, pageId: string, foldId: string): void {
  try { sessionStorage.setItem(KEY, JSON.stringify({ uid, pageId, foldId, at: Date.now() })) } catch { /* nothing to do */ }
}

export function takeOpenFoldIntent(uid: string, pageId: string, now: number = Date.now()): string | null {
  try {
    const raw = sessionStorage.getItem(KEY)
    if (!raw) return null
    const v = JSON.parse(raw) as { uid?: string; pageId?: string; foldId?: string; at?: number }
    if (v.uid !== uid || v.pageId !== pageId) return null
    sessionStorage.removeItem(KEY)
    if (typeof v.foldId !== 'string' || typeof v.at !== 'number' || now - v.at > MAX_AGE_MS) return null
    return v.foldId
  } catch {
    return null
  }
}
