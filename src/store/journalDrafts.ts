import type { JSONContent } from '@tiptap/core'

// Journal drafts are the writer's unsent words on the Journal surface. Each
// draft is owned by an immutable (uid, sessionId) pair and lives in this
// device's localStorage until it is deliberately contributed to that
// session's transcript. Every storage access is wrapped: storage can be
// missing, full or blocked (private windows, disabled site data), and a draft
// must never break the session around it.

const PREFIX = 'us.journalDraft.'

export interface StoredJournalDraft {
  text: string
  /**
   * The transcript message id this draft becomes. Stable across retries so a
   * re-sent append overwrites its own earlier partial write instead of
   * storing the words twice.
   */
  messageId?: string
  updatedAt: number
}

// Bumped whenever a user's drafts are cleared (sign-out, account deletion).
// A writer that captured an older epoch is stale: a SessionView unmounting
// after sign-out must not flush the signed-out user's words back to disk.
let epoch = 0

export function getJournalDraftEpoch(): number {
  return epoch
}

export function journalDraftKey(uid: string, sessionId: string): string {
  return `${PREFIX}${uid}.${sessionId}`
}

export function readJournalDraft(uid: string, sessionId: string): StoredJournalDraft | null {
  try {
    const raw = localStorage.getItem(journalDraftKey(uid, sessionId))
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    const { text, messageId, updatedAt } = parsed as Record<string, unknown>
    if (typeof text !== 'string' || !text.trim()) return null
    return {
      text,
      ...(typeof messageId === 'string' && messageId ? { messageId } : {}),
      updatedAt: typeof updatedAt === 'number' ? updatedAt : 0,
    }
  } catch {
    return null
  }
}

/**
 * Persist (or, for blank text, remove) one session's draft. Returns false when
 * the write was refused (stale epoch) or storage is unavailable; the caller
 * keeps the words in memory either way.
 */
export function writeJournalDraft(
  uid: string,
  sessionId: string,
  draft: { text: string; messageId?: string },
  writerEpoch: number = epoch,
): boolean {
  if (writerEpoch !== epoch) return false
  try {
    const key = journalDraftKey(uid, sessionId)
    if (!draft.text.trim()) {
      localStorage.removeItem(key)
      return true
    }
    const stored: StoredJournalDraft = {
      text: draft.text,
      ...(draft.messageId ? { messageId: draft.messageId } : {}),
      updatedAt: Date.now(),
    }
    localStorage.setItem(key, JSON.stringify(stored))
    return true
  } catch {
    return false
  }
}

export function clearJournalDraft(uid: string, sessionId: string, writerEpoch: number = epoch): void {
  writeJournalDraft(uid, sessionId, { text: '' }, writerEpoch)
}

/** Remove every draft belonging to `uid` on this device (sign-out, deletion). */
export function clearJournalDraftsForUser(uid: string): void {
  epoch++
  try {
    const prefix = `${PREFIX}${uid}.`
    const keys: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key?.startsWith(prefix)) keys.push(key)
    }
    for (const key of keys) localStorage.removeItem(key)
  } catch {
    // Storage unavailable: nothing could have been stored either.
  }
}

/**
 * Plain draft text (as produced by TipTap's getText: blocks joined by a blank
 * line, hard breaks as single newlines) back into an editor document. Passing
 * the raw string as content would parse it as HTML, so a restored "<word"
 * could silently swallow the rest of the draft.
 */
export function journalDraftToDoc(text: string): JSONContent {
  return {
    type: 'doc',
    content: text.split('\n\n').map(block => {
      const content: JSONContent[] = []
      block.split('\n').forEach((line, index) => {
        if (index > 0) content.push({ type: 'hardBreak' })
        if (line) content.push({ type: 'text', text: line })
      })
      return content.length > 0 ? { type: 'paragraph', content } : { type: 'paragraph' }
    }),
  }
}
