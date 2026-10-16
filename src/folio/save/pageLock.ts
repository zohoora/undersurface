// Tabs and Folio pages (draft 4 §5.2; build plan §3.4). One tab edits a page
// at a time: it holds a Web Lock named for the page. Another tab queues for
// the lock and is read-only until it's granted, or asks the holder to hand
// over ("Edit here"). Each mounted editor also holds a lock named for itself,
// so another tab can tell a live editor's pending entry from an orphan's.
// Without the Web Locks API, a BroadcastChannel courtesy lock stands in;
// correctness never depends on either (compare-and-swap does).

interface LockManagerLike {
  request(name: string, options: { signal?: AbortSignal; ifAvailable?: boolean }, cb: (lock: unknown) => Promise<void>): Promise<void>
  query(): Promise<{ held?: { name?: string }[] }>
}

function locks(): LockManagerLike | null {
  const nav = typeof navigator === 'undefined' ? null : (navigator as unknown as { locks?: LockManagerLike })
  return nav?.locks ?? null
}

const EDITOR_PREFIX = 'folio-editor:'
const HANDOVER_TIMEOUT_MS = 2000
const PING_TIMEOUT_MS = 500

export function pageLockName(uid: string, pageId: string): string {
  return `folio:${uid}:${pageId}`
}

/** Hold a lock named for this editor for as long as it's mounted. */
export function holdEditorLiveness(editorId: string): () => void {
  const lm = locks()
  let release: () => void = () => {}
  const released = new Promise<void>((r) => { release = r })
  if (lm) {
    void lm.request(`${EDITOR_PREFIX}${editorId}`, {}, () => released).catch(() => {})
  }
  const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('folio-editors')
  if (channel) {
    channel.onmessage = (e: MessageEvent<{ type: string; nonce?: string }>) => {
      if (e.data?.type === 'alive?') channel.postMessage({ type: 'alive', editorId, nonce: e.data.nonce })
    }
  }
  return () => {
    release()
    channel?.close()
  }
}

/** The editors alive in any tab of this browser profile. */
export async function liveEditorIds(): Promise<Set<string>> {
  const lm = locks()
  if (lm) {
    try {
      const snapshot = await lm.query()
      return new Set((snapshot.held ?? []).map((l) => l.name ?? '').filter((n) => n.startsWith(EDITOR_PREFIX)).map((n) => n.slice(EDITOR_PREFIX.length)))
    } catch {
      // fall through to the ping
    }
  }
  if (typeof BroadcastChannel === 'undefined') return new Set()
  const channel = new BroadcastChannel('folio-editors')
  const nonce = Math.random().toString(36).slice(2)
  const alive = new Set<string>()
  channel.onmessage = (e: MessageEvent<{ type: string; editorId?: string; nonce?: string }>) => {
    if (e.data?.type === 'alive' && e.data.nonce === nonce && e.data.editorId) alive.add(e.data.editorId)
  }
  channel.postMessage({ type: 'alive?', nonce })
  await new Promise((r) => setTimeout(r, PING_TIMEOUT_MS))
  channel.close()
  return alive
}

export interface PageLock {
  /** Resolves when this tab holds the page's edit lock. */
  granted: Promise<void>
  isHolder(): boolean
  /** Edit here: ask the holder to hand over. True when the lock arrived within 2 s. */
  requestHandover(): Promise<boolean>
  /** Called in the holder when another tab asks; it should flush and go read-only. */
  onHandoverRequest(handler: () => Promise<void> | void): void
  release(): void
}

type ChannelMessage = { type: 'handover'; from: string } | { type: 'holder?' } | { type: 'holder' }

export function acquirePageLock(uid: string, pageId: string, editorId: string): PageLock {
  const name = pageLockName(uid, pageId)
  const lm = locks()
  const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(name)
  const abort = new AbortController()
  let holder = false
  let handoverHandler: (() => Promise<void> | void) | null = null
  let releaseHeld: () => void = () => {}
  let grantedResolve: () => void = () => {}
  const granted = new Promise<void>((r) => { grantedResolve = r })

  const onGrant = () => {
    holder = true
    grantedResolve()
  }

  if (lm) {
    void lm.request(name, { signal: abort.signal }, () => new Promise<void>((resolve) => {
      releaseHeld = () => { holder = false; resolve() }
      onGrant()
    })).catch(() => {})
  } else if (channel) {
    // Courtesy lock: become the holder when nobody answers.
    let answered = false
    const probe = (e: MessageEvent<ChannelMessage>) => { if (e.data?.type === 'holder') answered = true }
    channel.addEventListener('message', probe)
    channel.postMessage({ type: 'holder?' } satisfies ChannelMessage)
    setTimeout(() => {
      channel.removeEventListener('message', probe)
      if (!answered) {
        releaseHeld = () => { holder = false }
        onGrant()
      }
    }, PING_TIMEOUT_MS)
  } else {
    releaseHeld = () => { holder = false }
    onGrant()
  }

  channel?.addEventListener('message', (e: MessageEvent<ChannelMessage>) => {
    const msg = e.data
    if (!msg) return
    if (msg.type === 'holder?' && holder) channel.postMessage({ type: 'holder' } satisfies ChannelMessage)
    if (msg.type === 'handover' && holder && msg.from !== editorId) {
      void (async () => {
        try { await handoverHandler?.() } finally { releaseHeld() }
      })()
    }
  })

  return {
    granted,
    isHolder: () => holder,
    async requestHandover() {
      if (holder) return true
      channel?.postMessage({ type: 'handover', from: editorId } satisfies ChannelMessage)
      if (!lm) {
        // Courtesy lock: take over once the holder stops answering.
        await new Promise((r) => setTimeout(r, PING_TIMEOUT_MS))
        releaseHeld = () => { holder = false }
        onGrant()
        return true
      }
      const timeout = new Promise<boolean>((r) => setTimeout(() => r(false), HANDOVER_TIMEOUT_MS))
      return Promise.race([granted.then(() => true), timeout])
    },
    onHandoverRequest(handler) { handoverHandler = handler },
    release() {
      abort.abort()
      releaseHeld()
      channel?.close()
    },
  }
}
