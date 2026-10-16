import type { FolioPage } from '../../types/folio'
import { classifyChain, inChain, resolveEntry } from './classify'
import type { Chain, ServerCopy } from './classify'
import { removePending, writePending } from './pendingStore'
import type { PendingEntry } from './pendingStore'

// C2: storage without silent loss (draft 4 §5.2). One controller per mounted
// editor and page. Every save writes this editor's pending entry first, then
// a full-page write whose parentRevId is the head of this editor's chain; the
// rules accept it only if the server still holds that revision. A rejection
// stops writing, waits for the SDK to finish with the page, reads the server
// once and classifies the whole chain once.

export type SaveStatus = 'saved' | 'savedLocal' | 'notSaved' | 'couldNotSave' | 'conflict' | 'remoteDeleted'

export interface PageContent {
  doc: string
  checked: string[]
  preview: string
  foldCount: number
}

export class UnavailableError extends Error {
  constructor() { super('unavailable') }
}

export interface PageStoreAdapter {
  /** A full-page write. Resolves on the server's acknowledgement; rejects on a permanent error. */
  write(page: FolioPage): Promise<void>
  /** The server's copy, bypassing the cache. Throws UnavailableError offline. */
  readServer(pageId: string): Promise<ServerCopy>
}

export interface PendingApi {
  write(uid: string, entry: PendingEntry): boolean
  remove(uid: string, pageId: string, editorId: string): void
}

export interface SaveControllerDeps {
  uid: string
  pageId: string
  editorId: string
  adapter: PageStoreAdapter
  now?: () => number
  newRevId: () => string
  newPageId: () => string
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
  pending?: PendingApi
  /** "‹first line› (this device, 15 Oct 14:02)" for a conflict copy's preview. */
  copyPreview?: (preview: string, at: number) => string
  onStatus: (status: SaveStatus) => void
  /** A conflict copy was made; the editor should move to it (draft 4 §5.2). */
  onConflictCopy: (copyPageId: string, content: PageContent) => void
  onRemoteDeleted: (content: PageContent) => void
  onDiagnostic?: (code: string) => void
}

export interface SaveStart {
  /** The server revision this editor builds on; null for a page not yet created. */
  baseRevId: string | null
  created: boolean
  rev: number
  createdAt: number
  content: PageContent
  /** The content the server holds at baseRevId (to know whether it's already saved). */
  serverDoc?: string | null
  /** An adopted orphan's unacknowledged revisions. */
  sentRevIds?: string[]
  /** Until confirm(): saves go only to the pending store (the on-load rule). */
  awaitingConfirmation?: boolean
}

const RETRY_MS = [30_000, 120_000, 600_000]
const DEBOUNCE_SMALL_MS = 1200
const DEBOUNCE_LARGE_MS = 3000
const LARGE_PAGE_CHARS = 50_000
const MAX_WAIT_MS = 10_000

export function debounceFor(docLength: number): number {
  return docLength > LARGE_PAGE_CHARS ? DEBOUNCE_LARGE_MS : DEBOUNCE_SMALL_MS
}

export class PageSaveController {
  private readonly d: Required<Omit<SaveControllerDeps, 'onDiagnostic' | 'copyPreview'>> & Pick<SaveControllerDeps, 'onDiagnostic' | 'copyPreview'>
  private chain: Chain
  private content: PageContent
  private rev: number
  private readonly createdAt: number
  private headRevId: string | null = null
  private readonly sentDocs = new Map<string, string>()
  /** The content the server is known to hold. */
  private savedDoc: string | null
  private pendingDoc: string | null = null
  private lastPendingOk = true
  private inflight = 0
  private halted = false
  private classifying = false
  private notConflict = false
  private resendBase: string | null = null
  private awaiting: boolean
  private ended: 'conflict' | 'remoteDeleted' | null = null
  private disposed = false
  private debounce: unknown = null
  private maxWait: unknown = null
  private retry: unknown = null
  private retryIndex = 0
  private status: SaveStatus | null = null

  constructor(deps: SaveControllerDeps, start: SaveStart) {
    this.d = {
      now: Date.now,
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
      pending: { write: writePending, remove: removePending },
      ...deps,
    }
    this.chain = { baseRevId: start.baseRevId, sentRevIds: [...(start.sentRevIds ?? [])], created: start.created }
    this.content = start.content
    this.rev = start.rev
    this.createdAt = start.createdAt
    this.awaiting = !!start.awaitingConfirmation
    this.savedDoc = start.serverDoc ?? null
    if (this.awaiting) this.writePendingOnly()
    this.emit()
  }

  // ------------------------------------------------------------ public

  /** The editor's content changed. */
  edit(content: PageContent): void {
    if (this.disposed || this.ended) return
    this.content = content
    if (this.notConflict) this.retryIndex = 0 // the next edit retries now
    this.schedule()
  }

  /** Save now: the pending entry synchronously, the server write asynchronously. */
  flush(): void {
    this.clearTimers()
    this.save()
  }

  /** On-load rule: server state is confirmed; resolve this editor's adopted entry. */
  confirm(server: ServerCopy): void {
    if (!this.awaiting || this.disposed) return
    this.awaiting = false
    const r = resolveEntry(server, { ...this.chain, doc: this.content.doc })
    switch (r.kind) {
      case 'clear':
        if (server.exists) this.adoptServer(server.revId, server.doc)
        this.d.pending.remove(this.d.uid, this.d.pageId, this.d.editorId)
        this.pendingDoc = null
        this.emit()
        return
      case 'commit':
        if (server.exists) this.adoptServer(server.revId, server.doc)
        this.save()
        return
      case 'create':
        this.chain = { baseRevId: null, sentRevIds: [], created: false }
        this.save()
        return
      case 'conflictCopy':
        this.makeConflictCopy()
        return
      case 'remoteDeleted':
        this.endRemoteDeleted()
        return
    }
  }

  get currentStatus(): SaveStatus | null { return this.status }
  get chainState(): Readonly<Chain> { return { ...this.chain, sentRevIds: [...this.chain.sentRevIds] } }

  dispose(): void {
    this.flushPendingOnly()
    this.disposed = true
    this.clearTimers()
    if (this.retry) this.d.clearTimer(this.retry)
  }

  // ------------------------------------------------------------ saving

  private schedule() {
    if (this.debounce) this.d.clearTimer(this.debounce)
    this.debounce = this.d.setTimer(() => this.save(), debounceFor(this.content.doc.length))
    if (!this.maxWait) this.maxWait = this.d.setTimer(() => this.save(), MAX_WAIT_MS)
  }

  private clearTimers() {
    if (this.debounce) this.d.clearTimer(this.debounce)
    if (this.maxWait) this.d.clearTimer(this.maxWait)
    this.debounce = null
    this.maxWait = null
  }

  private entry(sentRevIds: string[]): PendingEntry {
    return {
      pageId: this.d.pageId,
      editorId: this.d.editorId,
      baseRevId: this.chain.baseRevId,
      sentRevIds,
      created: this.chain.created,
      doc: this.content.doc,
      checked: this.content.checked,
      preview: this.content.preview,
      foldCount: this.content.foldCount,
      createdAt: this.createdAt,
      updatedAt: this.d.now(),
    }
  }

  private writePendingOnly() {
    if (this.content.doc === this.savedDoc) return
    this.lastPendingOk = this.d.pending.write(this.d.uid, this.entry([...this.chain.sentRevIds]))
    if (this.lastPendingOk) this.pendingDoc = this.content.doc
  }

  private flushPendingOnly() {
    if (this.disposed || this.content.doc === this.savedDoc) return
    this.writePendingOnly()
  }

  private save() {
    this.clearTimers()
    if (this.disposed || this.ended) return
    const nothingNew = this.content.doc === this.savedDoc && this.inflight === 0 && !this.notConflict
    const alreadySent = this.headRevId !== null && this.sentDocs.get(this.headRevId) === this.content.doc
    if (nothingNew || (alreadySent && !this.halted && !this.awaiting)) {
      this.emit()
      return
    }
    if (this.awaiting || this.halted) {
      this.writePendingOnly()
      this.emit()
      return
    }
    const revId = this.d.newRevId()
    const sent = [...this.chain.sentRevIds, revId]
    this.lastPendingOk = this.d.pending.write(this.d.uid, this.entry(sent))
    if (this.lastPendingOk) this.pendingDoc = this.content.doc
    this.send(revId)
  }

  private send(revId: string) {
    const parentRevId = this.headRevId ?? this.chain.baseRevId
    const doc = this.content.doc
    const page: FolioPage = {
      id: this.d.pageId,
      createdAt: this.createdAt,
      updatedAt: this.d.now(),
      doc,
      schemaVersion: 2,
      revId,
      parentRevId,
      rev: ++this.rev,
      editorId: this.d.editorId,
      preview: this.content.preview,
      foldCount: this.content.foldCount,
      safety: { checked: this.content.checked },
    }
    this.chain.sentRevIds.push(revId)
    this.headRevId = revId
    this.sentDocs.set(revId, doc)
    this.inflight++
    this.emit()
    this.d.adapter.write(page).then(
      () => this.onAck(revId),
      (err: unknown) => this.onReject(revId, err),
    ).finally(() => {
      this.inflight--
      if (!this.disposed) this.emit()
      this.maybeClassify()
    })
  }

  private onAck(revId: string) {
    if (this.disposed) return
    // Acknowledgements arrive in order (one batch per write, §5.2).
    const i = this.chain.sentRevIds.indexOf(revId)
    if (i < 0) return
    this.chain = { baseRevId: revId, sentRevIds: this.chain.sentRevIds.slice(i + 1), created: true }
    this.savedDoc = this.sentDocs.get(revId) ?? this.savedDoc
    for (const id of [...this.sentDocs.keys()]) {
      this.sentDocs.delete(id)
      if (id === revId) break
    }
    if (this.headRevId === revId) this.headRevId = null
    if (this.savedDoc === this.content.doc && this.chain.sentRevIds.length === 0) {
      this.d.pending.remove(this.d.uid, this.d.pageId, this.d.editorId)
      this.pendingDoc = null
      this.notConflict = false
      this.retryIndex = 0
    }
    this.emit()
  }

  private onReject(revId: string, err: unknown) {
    if (this.disposed) return
    const code = (err as { code?: string })?.code ?? 'unknown'
    if (!this.halted) {
      this.halted = true
      this.d.onDiagnostic?.(`folio.save.rejected:${code}`)
    } else if (inChain(this.chain, revId)) {
      this.d.onDiagnostic?.('folio.save.rejectedSameChain')
    }
  }

  // ------------------------------------------------------------ classification

  private maybeClassify() {
    if (this.halted && this.inflight === 0 && !this.classifying && !this.disposed) void this.classify()
  }

  private async classify() {
    this.classifying = true
    let server: ServerCopy
    try {
      server = await this.d.adapter.readServer(this.d.pageId)
    } catch {
      // Offline: the status stays; classify again later.
      this.classifying = false
      this.scheduleRetry(() => void this.classify())
      return
    }
    this.classifying = false
    if (this.disposed) return
    const v = classifyChain(server, this.chain)
    switch (v.kind) {
      case 'remoteDeleted':
        this.endRemoteDeleted()
        return
      case 'conflict':
        this.makeConflictCopy()
        return
      case 'notCreated':
        this.markNotConflict()
        return
      case 'inChain': {
        const landedResent = this.headRevId !== null && v.revId !== this.chain.baseRevId
        if (landedResent) this.d.onDiagnostic?.('folio.save.landedResent')
        const sameBaseAgain = this.resendBase === v.revId
        this.adoptServer(v.revId, v.doc)
        this.halted = false
        if (v.doc === this.content.doc) {
          this.d.pending.remove(this.d.uid, this.d.pageId, this.d.editorId)
          this.pendingDoc = null
          this.notConflict = false
          this.resendBase = null
          this.emit()
          return
        }
        if (sameBaseAgain) {
          // Sent on top of this very revision and rejected again: the write
          // itself breaks a rule. Never a conflict copy.
          this.markNotConflict()
          return
        }
        this.resendBase = v.revId
        this.save()
        return
      }
    }
  }

  private adoptServer(revId: string, doc: string) {
    this.chain = { baseRevId: revId, sentRevIds: [], created: true }
    this.headRevId = null
    this.sentDocs.clear()
    this.savedDoc = doc
  }

  private markNotConflict() {
    this.notConflict = true
    this.halted = false
    this.d.onDiagnostic?.('folio.save.rejectedNotConflict')
    this.writePendingOnly()
    this.emit()
    this.scheduleRetry(() => this.save())
  }

  private scheduleRetry(fn: () => void) {
    if (this.retry) this.d.clearTimer(this.retry)
    const ms = RETRY_MS[Math.min(this.retryIndex, RETRY_MS.length - 1)]
    this.retryIndex++
    this.retry = this.d.setTimer(() => { this.retry = null; fn() }, ms)
  }

  private makeConflictCopy() {
    const copyId = this.d.newPageId()
    const at = this.d.now()
    const content: PageContent = {
      ...this.content,
      preview: this.d.copyPreview ? this.d.copyPreview(this.content.preview, at) : `${this.content.preview} (this device)`,
    }
    // The copy's pending entry is written before this page's entry goes, so
    // the words are always held somewhere on the device.
    this.d.pending.write(this.d.uid, {
      pageId: copyId, editorId: this.d.editorId, baseRevId: null, sentRevIds: [], created: false,
      doc: content.doc, checked: content.checked, preview: content.preview, foldCount: content.foldCount,
      createdAt: at, updatedAt: at,
    })
    this.d.pending.remove(this.d.uid, this.d.pageId, this.d.editorId)
    this.ended = 'conflict'
    this.d.onDiagnostic?.('folio.save.conflict')
    this.emit()
    this.d.onConflictCopy(copyId, content)
  }

  private endRemoteDeleted() {
    this.ended = 'remoteDeleted'
    this.writePendingOnly()
    this.d.onDiagnostic?.('folio.save.remoteDeleted')
    this.emit()
    this.d.onRemoteDeleted(this.content)
  }

  // ------------------------------------------------------------ status

  private emit() {
    const next = this.computeStatus()
    if (next !== this.status) {
      this.status = next
      this.d.onStatus(next)
    }
  }

  private computeStatus(): SaveStatus {
    if (this.ended) return this.ended
    if (this.notConflict) return this.lastPendingOk && this.pendingDoc === this.content.doc ? 'couldNotSave' : 'notSaved'
    if (this.savedDoc !== null && this.savedDoc === this.content.doc && this.inflight === 0 && !this.halted && !this.awaiting) return 'saved'
    if (this.lastPendingOk && this.pendingDoc === this.content.doc) return 'savedLocal'
    if (!this.lastPendingOk) return 'notSaved'
    // Typing between saves: nothing new is claimed until the next save runs.
    return this.status ?? 'saved'
  }
}
