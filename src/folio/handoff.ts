// "Talk now, bringing this" (draft 4 §3.9): Folio writes the words the writer
// chose, after they saw them, into a one-time sessionStorage slot; the Talk
// composer of the new Session reads it once and never sends it on its own.

const KEY = 'us.folioHandoff'
const MAX_AGE_MS = 5 * 60 * 1000

export function writeHandoff(text: string): void {
  try { sessionStorage.setItem(KEY, JSON.stringify({ text, at: Date.now() })) } catch { /* nothing to do */ }
}

/** The handed-off words, once. */
export function takeHandoff(): string | null {
  try {
    const raw = sessionStorage.getItem(KEY)
    if (!raw) return null
    sessionStorage.removeItem(KEY)
    const v = JSON.parse(raw) as { text?: unknown; at?: unknown }
    if (typeof v.text !== 'string' || typeof v.at !== 'number' || Date.now() - v.at > MAX_AGE_MS) return null
    return v.text
  } catch {
    return null
  }
}
