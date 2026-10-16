// "Talk now, bringing this" (draft 4 §3.9): Folio writes the words the writer
// chose, after they saw them, into a one-time sessionStorage slot; the Talk
// composer of the new Session reads it once and never sends it on its own.
// The slot is bound to the account that wrote it, and cleared on sign-out,
// so it can never surface in another account's composer on a shared tab.

const KEY = 'us.folioHandoff'
const MAX_AGE_MS = 5 * 60 * 1000

export function writeHandoff(uid: string, text: string): void {
  try { sessionStorage.setItem(KEY, JSON.stringify({ uid, text, at: Date.now() })) } catch { /* nothing to do */ }
}

/** The handed-off words, once, and only for the account that wrote them. */
export function takeHandoff(uid: string | null | undefined): string | null {
  try {
    const raw = sessionStorage.getItem(KEY)
    if (!raw) return null
    sessionStorage.removeItem(KEY)
    const v = JSON.parse(raw) as { uid?: unknown; text?: unknown; at?: unknown }
    if (!uid || v.uid !== uid) return null
    if (typeof v.text !== 'string' || typeof v.at !== 'number' || Date.now() - v.at > MAX_AGE_MS) return null
    return v.text
  } catch {
    return null
  }
}

export function clearHandoff(): void {
  try { sessionStorage.removeItem(KEY) } catch { /* nothing to do */ }
}
