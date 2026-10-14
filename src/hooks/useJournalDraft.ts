import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import {
  getJournalDraftEpoch,
  readJournalDraft,
  writeJournalDraft,
} from '../store/journalDrafts'

export const JOURNAL_DRAFT_DEBOUNCE_MS = 500

/**
 * 'sent'   — the words are now a message in the owning session.
 * 'empty'  — nothing to contribute.
 * 'held'   — the session has no id yet (`/session/new`); the words stay a
 *            draft and are contributed once the real id is adopted.
 * 'failed' — the append was refused or rejected; the words stay a draft.
 */
export type JournalDraftCommitOutcome = 'sent' | 'empty' | 'held' | 'failed'

export interface JournalDraftOwner {
  sessionId: string
  messageId: string
}

/** Contribute `text` to `owner.sessionId` only. Resolve false (or throw) to keep the draft. */
export type JournalDraftAppend = (text: string, owner: JournalDraftOwner) => Promise<boolean>

export interface JournalDraftSnapshot {
  readonly text: string
  /** A contribution is in flight. */
  readonly sending: boolean
  /** The last contribution failed; stays true through a retry until one succeeds. */
  readonly failed: boolean
  /**
   * Changes whenever the words under the editor are replaced from outside it
   * (another session's draft, or a contribution clearing them). Key the
   * editor on it; an editor rendered for an older scope can no longer write.
   */
  readonly scope: number
}

function ownerKeyOf(uid: string | null, sessionId: string | null): string {
  return `${uid ?? ''}/${sessionId ?? ''}`
}

/**
 * Owns one SessionView's Journal draft: which (uid, sessionId) it belongs to,
 * debounced persistence, restore, and the single in-flight contribution to
 * the conversation. Persistence and contribution are separate: typing only
 * ever saves; only `commit` adds the words to the transcript, exactly once,
 * and only to the session that owned them when the commit began.
 */
export class JournalDraftController {
  private uid: string | null = null
  private sessionId: string | null = null
  private text = ''
  private messageId: string | undefined
  private sending = false
  private failed = false
  private scope = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  // One contribution at a time per owner; keyed so a send still running for
  // the previous session never absorbs a commit for the current one.
  private readonly inFlight = new Map<string, Promise<JournalDraftCommitOutcome>>()
  private commitOnAdopt = false
  private readonly epoch = getJournalDraftEpoch()
  private readonly listeners = new Set<() => void>()
  private snapshot: JournalDraftSnapshot = { text: '', sending: false, failed: false, scope: 0 }
  private append: JournalDraftAppend
  private readonly createMessageId: () => string

  constructor(append: JournalDraftAppend, createMessageId: () => string = () => crypto.randomUUID()) {
    this.append = append
    this.createMessageId = createMessageId
  }

  setAppend(append: JournalDraftAppend): void {
    this.append = append
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  getSnapshot = (): JournalDraftSnapshot => this.snapshot

  /** Point the draft at the session now on screen. */
  bind(uid: string | null, sessionId: string | null): void {
    if (uid === this.uid && sessionId === this.sessionId) return

    // `/session/new` adopting its real id: the same draft, now with a durable
    // owner; the editor is not remounted.
    if (uid === this.uid && this.sessionId === null && sessionId !== null) {
      this.sessionId = sessionId
      // A reloaded `/session/:id` also arrives here once its session loads:
      // restore its saved draft, and never let words typed while it loaded
      // overwrite that draft — keep both. (A brand-new id has nothing saved.)
      const stored = uid !== null ? readJournalDraft(uid, sessionId) : null
      if (stored && stored.text !== this.text) {
        this.text = this.text.trim() ? `${stored.text}\n\n${this.text}` : stored.text
        this.messageId = stored.messageId
        this.scope++
      }
      this.persistNow()
      this.emit()
      if (this.commitOnAdopt) {
        this.commitOnAdopt = false
        void this.commit()
      }
      return
    }

    // A different session (or user): the previous owner's words stay with it.
    this.persistNow()
    this.uid = uid
    this.sessionId = sessionId
    const stored = uid !== null && sessionId !== null ? readJournalDraft(uid, sessionId) : null
    this.text = stored?.text ?? ''
    this.messageId = stored?.messageId
    this.sending = this.inFlight.has(ownerKeyOf(uid, sessionId))
    this.failed = false
    this.commitOnAdopt = false
    this.scope++
    this.emit()
  }

  /** Editor change. Ignored when it comes from an editor of an older scope. */
  setText(text: string, scope: number = this.scope): void {
    if (scope !== this.scope || text === this.text) return
    this.text = text
    // Writing again means the writer is back in the Journal; the next exit
    // contributes the words, so a held commit must not fire mid-sentence.
    this.commitOnAdopt = false
    if (!text.trim()) this.failed = false
    this.schedulePersist()
    this.emit()
  }

  /** Write any pending change now (page hide, unmount, owner change). */
  flush(): void {
    if (this.timer === null) return
    this.persistNow()
  }

  /**
   * Contribute the draft to its owning session. Concurrent calls share one
   * attempt. The draft is cleared only after the append succeeds.
   */
  commit(): Promise<JournalDraftCommitOutcome> {
    const { uid, sessionId } = this
    const ownerKey = ownerKeyOf(uid, sessionId)
    const pending = this.inFlight.get(ownerKey)
    if (pending) return pending
    const raw = this.text
    const content = raw.trim()
    if (!content) return Promise.resolve('empty')
    if (sessionId === null) {
      this.commitOnAdopt = true
      return Promise.resolve('held')
    }
    if (!this.messageId) this.messageId = this.createMessageId()
    const messageId = this.messageId
    // Durable before the network attempt: a tab closed mid-send keeps them.
    this.persistNow()
    this.sending = true
    this.emit()
    const attempt = this.runCommit(raw, content, uid, { sessionId, messageId }, ownerKey)
    this.inFlight.set(ownerKey, attempt)
    return attempt
  }

  private async runCommit(
    raw: string,
    content: string,
    uid: string | null,
    owner: JournalDraftOwner,
    ownerKey: string,
  ): Promise<JournalDraftCommitOutcome> {
    let ok = false
    try {
      ok = await this.append(content, owner)
    } catch (error) {
      console.error('Journal draft could not be added; keeping it:', error)
    }
    this.inFlight.delete(ownerKey)
    const stillOwned = this.uid === uid && this.sessionId === owner.sessionId

    if (!ok) {
      if (stillOwned) {
        this.sending = false
        this.failed = true
        this.emit()
      }
      return 'failed'
    }

    if (stillOwned) {
      this.sending = false
      this.failed = false
      if (this.text === raw) {
        this.text = ''
        this.messageId = undefined
        this.scope++
      } else if (this.text.startsWith(raw)) {
        // Words added while the append was in flight stay as the next draft.
        this.text = this.text.slice(raw.length)
        this.messageId = undefined
        this.scope++
      } else {
        // Edited mid-flight: keep the newer words as a fresh draft rather
        // than risk losing any of them.
        this.messageId = undefined
      }
      this.persistNow()
      this.emit()
    } else if (uid !== null) {
      // The writer moved to another session while this was sending; tidy the
      // owner's stored copy without touching the draft now on screen.
      const stored = readJournalDraft(uid, owner.sessionId)
      if (stored?.text === raw) {
        writeJournalDraft(uid, owner.sessionId, { text: '' }, this.epoch)
      } else if (stored?.text.startsWith(raw)) {
        writeJournalDraft(uid, owner.sessionId, { text: stored.text.slice(raw.length) }, this.epoch)
      }
    }
    return 'sent'
  }

  private schedulePersist(): void {
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      this.persistNow()
    }, JOURNAL_DRAFT_DEBOUNCE_MS)
  }

  private persistNow(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (this.uid === null || this.sessionId === null) return
    writeJournalDraft(this.uid, this.sessionId, { text: this.text, messageId: this.messageId }, this.epoch)
  }

  private emit(): void {
    const { text, sending, failed, scope } = this
    const prev = this.snapshot
    if (text === prev.text && sending === prev.sending && failed === prev.failed && scope === prev.scope) return
    this.snapshot = { text, sending, failed, scope }
    for (const listener of this.listeners) listener()
  }
}

export interface JournalDraft extends JournalDraftSnapshot {
  setText: (text: string, scope: number) => void
  commit: () => Promise<JournalDraftCommitOutcome>
}

/**
 * The Journal draft for the session on screen. `sessionId` null means a new
 * session whose id has not been created yet; its words are adopted by the
 * real id. A change to another session never carries the words across.
 */
export function useJournalDraft({ uid, sessionId, append }: {
  uid: string | null
  sessionId: string | null
  append: JournalDraftAppend
}): JournalDraft {
  const [controller] = useState(() => new JournalDraftController(append))

  useEffect(() => { controller.setAppend(append) }, [controller, append])
  useEffect(() => { controller.bind(uid, sessionId) }, [controller, uid, sessionId])

  // Refresh or tab close inside the debounce window must not lose the last
  // words. pagehide covers unload/bfcache; hidden covers mobile tab kills.
  useEffect(() => {
    const flush = () => controller.flush()
    const onVisibility = () => { if (document.visibilityState === 'hidden') flush() }
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', onVisibility)
      flush()
    }
  }, [controller])

  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  const setText = useCallback((text: string, scope: number) => controller.setText(text, scope), [controller])
  const commit = useCallback(() => controller.commit(), [controller])

  return { ...snapshot, setText, commit }
}
