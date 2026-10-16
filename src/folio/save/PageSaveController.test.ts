import { describe, expect, it } from 'vitest'
import { PageSaveController, UnavailableError } from './PageSaveController'
import type { PageContent, PageStoreAdapter, SaveStatus } from './PageSaveController'
import type { ServerCopy } from './classify'
import type { PendingEntry } from './pendingStore'
import type { FolioPage } from '../../types/folio'

// C2's controller against a fake server that enforces the same
// compare-and-swap as firestore.rules. The emulator suite runs the real SDK.

type Mode = 'online' | 'offline'

class FakeServer implements PageStoreAdapter {
  page: { revId: string; doc: string } | null = null
  mode: Mode = 'online'
  queued: { page: FolioPage; resolve: () => void; reject: (e: unknown) => void }[] = []
  /** Writes whose acknowledgement is lost; the SDK re-sends them (B1). */
  loseAckFor = new Set<string>()
  /** Writes that break another rule (size, schema): rejected with the parent matching. */
  breakRule = false
  writes: FolioPage[] = []

  write(page: FolioPage): Promise<void> {
    return new Promise((resolve, reject) => {
      this.queued.push({ page, resolve, reject })
      if (this.mode === 'online') this.drain()
    })
  }

  private apply(page: FolioPage): boolean {
    if (this.breakRule) return false
    const ok = this.page === null ? page.parentRevId === null : page.parentRevId === this.page.revId && page.revId !== this.page.revId
    if (ok) { this.page = { revId: page.revId, doc: page.doc }; this.writes.push(page) }
    return ok
  }

  drain() {
    const q = this.queued
    this.queued = []
    for (const w of q) {
      const ok = this.apply(w.page)
      if (ok && this.loseAckFor.has(w.page.revId)) {
        // Committed, but the stream dropped before the ack: the SDK re-sends
        // the identical write, which now fails the compare-and-swap.
        const resend = this.apply(w.page)
        if (!resend) w.reject({ code: 'permission-denied' })
        continue
      }
      if (ok) w.resolve()
      else w.reject({ code: 'permission-denied' })
    }
  }

  async readServer(): Promise<ServerCopy> {
    if (this.mode === 'offline') throw new UnavailableError()
    return this.page ? { exists: true, revId: this.page.revId, doc: this.page.doc } : { exists: false }
  }
}

class Timers {
  list: { fn: () => void; ms: number; id: number }[] = []
  private next = 1
  set = (fn: () => void, ms: number) => { const id = this.next++; this.list.push({ fn, ms, id }); return id }
  clear = (h: unknown) => { this.list = this.list.filter((t) => t.id !== h) }
  runAll() { const l = this.list; this.list = []; for (const t of l) t.fn() }
}

const flush = () => new Promise((r) => setTimeout(r, 0))

function content(doc: string): PageContent {
  return { doc, checked: [], preview: doc.slice(0, 20), foldCount: 0 }
}

function setup(opts: { server?: FakeServer; start?: Partial<ConstructorParameters<typeof PageSaveController>[1]>; pendingOk?: boolean } = {}) {
  const server = opts.server ?? new FakeServer()
  const timers = new Timers()
  const statuses: SaveStatus[] = []
  const copies: { id: string; content: PageContent }[] = []
  const deleted: PageContent[] = []
  const diagnostics: string[] = []
  const store = new Map<string, PendingEntry>()
  let rev = 0
  let page = 0
  const controller = new PageSaveController({
    uid: 'u', pageId: 'pg', editorId: 'ed', adapter: server,
    now: () => 1000,
    newRevId: () => `r${++rev}`,
    newPageId: () => `copy${++page}`,
    setTimer: timers.set, clearTimer: timers.clear,
    pending: {
      write: (_uid, e) => { if (opts.pendingOk === false) return false; store.set(`${e.pageId}/${e.editorId}`, e); return true },
      remove: (_uid, pageId, editorId) => { store.delete(`${pageId}/${editorId}`) },
    },
    onStatus: (s) => statuses.push(s),
    onConflictCopy: (id, c) => copies.push({ id, content: c }),
    onRemoteDeleted: (c) => deleted.push(c),
    onDiagnostic: (c) => diagnostics.push(c),
  }, { baseRevId: null, created: false, rev: 0, createdAt: 1, content: content(''), serverDoc: '', ...opts.start })
  return { server, timers, statuses, copies, deleted, diagnostics, store, controller }
}

describe('PageSaveController', () => {
  it('creates the page on the first save, then chains revisions, and says Saved only after the server acknowledges', async () => {
    const t = setup()
    t.controller.edit(content('One.'))
    t.timers.runAll()
    expect(t.controller.currentStatus).toBe('savedLocal')
    await flush()
    expect(t.controller.currentStatus).toBe('saved')
    expect(t.server.page?.doc).toBe('One.')
    expect(t.store.size).toBe(0)
    t.controller.edit(content('One. Two.'))
    t.timers.runAll()
    await flush()
    expect(t.server.writes.map((w) => w.parentRevId)).toEqual([null, 'r1'])
  })

  it('never claims "Saved on this device" when the device store fails', async () => {
    const t = setup({ pendingOk: false })
    t.server.mode = 'offline'
    t.controller.edit(content('Words.'))
    t.timers.runAll()
    expect(t.controller.currentStatus).toBe('notSaved')
  })

  it('a delayed acknowledgement keeps the newer revision pending', async () => {
    const t = setup()
    t.server.mode = 'offline'
    t.controller.edit(content('A'))
    t.timers.runAll()
    t.controller.edit(content('AB'))
    t.timers.runAll()
    expect(t.store.get('pg/ed')?.doc).toBe('AB')
    t.server.mode = 'online'
    t.server.drain()
    await flush()
    expect(t.server.page?.doc).toBe('AB')
    expect(t.controller.currentStatus).toBe('saved')
    expect(t.store.size).toBe(0)
  })

  it('a real conflict makes exactly one copy, however many queued writes were rejected (B2)', async () => {
    const t = setup({ start: { baseRevId: 'r0', created: true, serverDoc: 'base', content: content('base') } })
    t.server.page = { revId: 'r0', doc: 'base' }
    t.server.mode = 'offline'
    for (const d of ['x1', 'x2', 'x3']) { t.controller.edit(content(d)); t.timers.runAll() }
    t.server.page = { revId: 'other', doc: 'from another device' }
    t.server.mode = 'online'
    t.server.drain()
    for (let i = 0; i < 5; i++) await flush()
    expect(t.copies).toHaveLength(1)
    expect(t.copies[0].content.doc).toBe('x3')
    expect(t.server.page?.doc).toBe('from another device')
    expect(t.controller.currentStatus).toBe('conflict')
    expect(t.store.has('copy1/ed')).toBe(true)
    expect(t.store.has('pg/ed')).toBe(false)
  })

  it('a write that landed but was re-sent and rejected is not a conflict (B1)', async () => {
    const t = setup({ start: { baseRevId: 'r0', created: true, serverDoc: 'base', content: content('base') } })
    t.server.page = { revId: 'r0', doc: 'base' }
    t.server.loseAckFor.add('r1')
    t.controller.edit(content('mine'))
    t.timers.runAll()
    for (let i = 0; i < 5; i++) await flush()
    expect(t.copies).toHaveLength(0)
    expect(t.controller.currentStatus).toBe('saved')
    expect(t.diagnostics).toContain('folio.save.landedResent')
    expect(t.store.size).toBe(0)
  })

  it('a rejection that breaks another rule is never a conflict copy; it retries with backoff', async () => {
    const t = setup({ start: { baseRevId: 'r0', created: true, serverDoc: 'base', content: content('base') } })
    t.server.page = { revId: 'r0', doc: 'base' }
    t.server.breakRule = true
    t.controller.edit(content('too big'))
    t.timers.runAll()
    for (let i = 0; i < 6; i++) await flush()
    expect(t.copies).toHaveLength(0)
    expect(t.controller.currentStatus).toBe('couldNotSave')
    expect(t.diagnostics).toContain('folio.save.rejectedNotConflict')
    t.server.breakRule = false
    t.timers.runAll() // the backoff retry
    for (let i = 0; i < 4; i++) await flush()
    expect(t.server.page?.doc).toBe('too big')
    expect(t.controller.currentStatus).toBe('saved')
  })

  it('a page deleted on another device is never recreated', async () => {
    const t = setup({ start: { baseRevId: 'r0', created: true, serverDoc: 'base', content: content('base') } })
    t.server.page = null
    t.controller.edit(content('edit after delete'))
    t.timers.runAll()
    for (let i = 0; i < 4; i++) await flush()
    expect(t.deleted).toHaveLength(1)
    expect(t.server.page).toBeNull()
    expect(t.controller.currentStatus).toBe('remoteDeleted')
    expect(t.store.get('pg/ed')?.doc).toBe('edit after delete')
  })

  it('classification waits while the server can\'t be read', async () => {
    const t = setup({ start: { baseRevId: 'r0', created: true, serverDoc: 'base', content: content('base') } })
    t.server.page = { revId: 'other', doc: 'theirs' }
    t.controller.edit(content('mine'))
    t.server.mode = 'offline'
    t.timers.runAll()
    t.server.mode = 'online'
    t.server.drain()
    t.server.mode = 'offline'
    for (let i = 0; i < 4; i++) await flush()
    expect(t.copies).toHaveLength(0)
    t.server.mode = 'online'
    t.timers.runAll() // retry
    for (let i = 0; i < 4; i++) await flush()
    expect(t.copies).toHaveLength(1)
  })

  describe('confirm(): the on-load rule', () => {
    const adopted = (server: FakeServer, doc: string, base: string | null, sent: string[], created: boolean) => setup({
      server,
      start: { baseRevId: base, sentRevIds: sent, created, content: content(doc), serverDoc: null, awaitingConfirmation: true },
    })

    it('sends nothing before confirmation; writes go to the device only', () => {
      const s = new FakeServer()
      const t = adopted(s, 'offline words', 'r0', ['r1'], true)
      t.controller.edit(content('offline words, more'))
      t.timers.runAll()
      expect(s.writes).toHaveLength(0)
      expect(t.store.get('pg/ed')?.doc).toBe('offline words, more')
    })

    it('commits on top when the server holds a revision of the entry\'s own chain', async () => {
      const s = new FakeServer()
      s.page = { revId: 'r1', doc: 'offline words' }
      const t = adopted(s, 'offline words, more', 'r0', ['r1'], true)
      t.controller.confirm({ exists: true, revId: 'r1', doc: 'offline words' })
      await flush()
      expect(s.page?.doc).toBe('offline words, more')
      expect(s.writes[0].parentRevId).toBe('r1')
      expect(t.copies).toHaveLength(0)
    })

    it('commits on top of the base when the SDK\'s queue was lost (memory cache)', async () => {
      const s = new FakeServer()
      s.page = { revId: 'r0', doc: 'base' }
      const t = adopted(s, 'lost queue words', 'r0', ['r1', 'r2'], true)
      t.controller.confirm({ exists: true, revId: 'r0', doc: 'base' })
      await flush()
      expect(s.page?.doc).toBe('lost queue words')
      expect(t.copies).toHaveLength(0)
    })

    it('clears when the server already has exactly these words', () => {
      const s = new FakeServer()
      const t = adopted(s, 'same', 'r0', ['r1'], true)
      t.controller.confirm({ exists: true, revId: 'r1', doc: 'same' })
      expect(t.store.size).toBe(0)
      expect(t.controller.currentStatus).toBe('saved')
    })

    it('makes a conflict copy when another device wrote', () => {
      const s = new FakeServer()
      const t = adopted(s, 'mine', 'r0', ['r1'], true)
      t.controller.confirm({ exists: true, revId: 'zz', doc: 'theirs' })
      expect(t.copies).toHaveLength(1)
    })

    it('creates a page that was written offline and never created', async () => {
      const s = new FakeServer()
      const t = adopted(s, 'brand new', null, ['r1'], false)
      t.controller.confirm({ exists: false })
      await flush()
      expect(s.page?.doc).toBe('brand new')
      expect(s.writes[0].parentRevId).toBeNull()
    })

    it('offers the remote-delete prompt for a created page that is gone', () => {
      const s = new FakeServer()
      const t = adopted(s, 'words', 'r0', [], true)
      t.controller.confirm({ exists: false })
      expect(t.deleted).toHaveLength(1)
      expect(s.writes).toHaveLength(0)
    })
  })
})
