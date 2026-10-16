import { describe, expect, it, vi } from 'vitest'
import type { CrisisCheck } from '../../ai/openrouter'
import { askForNote } from './askContract'
import type { AskDeps } from './askContract'

// The Ask contract (draft 4 §5.4; build plan §4, H2).

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

function harness(over: Partial<AskDeps> = {}) {
  const calls: { grounded: boolean; signal: AbortSignal }[] = []
  const replies: ReturnType<typeof deferred<string>>[] = []
  const check = deferred<CrisisCheck>()
  const deps: AskDeps = {
    selection: 'The soup was cold by the time anyone ate.',
    language: 'en',
    l1: () => false,
    check: vi.fn(() => check.promise),
    generate: vi.fn((grounded: boolean, signal: AbortSignal) => {
      calls.push({ grounded, signal })
      const r = deferred<string>()
      replies.push(r)
      signal.addEventListener('abort', () => r.reject(new Error('aborted')))
      return r.promise
    }),
    isGrounding: () => false,
    isRecent: () => false,
    activate: vi.fn(),
    ...over,
  }
  return { deps, calls, replies, check }
}

const flush = () => new Promise((r) => setTimeout(r, 0))

describe('askForNote', () => {
  it('an L1 hit grounds and sends nothing', async () => {
    const h = harness({ l1: () => true })
    expect(await askForNote(h.deps)).toEqual({ kind: 'grounded' })
    expect(h.deps.activate).toHaveBeenCalledTimes(1)
    expect(h.deps.generate).not.toHaveBeenCalled()
    expect(h.deps.check).not.toHaveBeenCalled()
  })

  it('races the reply and L2, and shows the reply only once L2 clears it', async () => {
    const h = harness()
    let settled = false
    const result = askForNote(h.deps).then((r) => { settled = true; return r })
    await flush()
    expect(h.deps.check).toHaveBeenCalledTimes(1)
    expect(h.calls).toHaveLength(1)
    h.replies[0].resolve('A cold soup, and everyone still sitting there.')
    await flush()
    expect(settled).toBe(false) // the display waits for L2
    h.check.resolve({ status: 'classified', risk: 0 })
    expect(await result).toEqual({ kind: 'note', text: 'A cold soup, and everyone still sitting there.', grounded: false })
  })

  it('an unavailable check shows the reply (the shared fail-open)', async () => {
    const h = harness()
    const result = askForNote(h.deps)
    h.check.resolve({ status: 'unavailable', cause: 'timeout' })
    await flush()
    h.replies[0].resolve('A note.')
    expect(await result).toMatchObject({ kind: 'note', text: 'A note.' })
    expect(h.deps.activate).not.toHaveBeenCalled()
  })

  it('risk 2 before display discards the reply, grounds, and regenerates grounded', async () => {
    const h = harness()
    const result = askForNote(h.deps)
    await flush()
    h.check.resolve({ status: 'classified', risk: 2 })
    await flush()
    expect(h.calls[0].signal.aborted).toBe(true)
    expect(h.deps.activate).toHaveBeenCalledTimes(1)
    expect(h.calls).toHaveLength(2)
    expect(h.calls[1].grounded).toBe(true)
    h.replies[1].resolve('A steady note.')
    expect(await result).toEqual({ kind: 'note', text: 'A steady note.', grounded: true })
  })

  it('risk 1 is shown in the normal register (only 2 grounds)', async () => {
    const h = harness()
    const result = askForNote(h.deps)
    h.check.resolve({ status: 'classified', risk: 1 })
    await flush()
    h.replies[0].resolve('A note.')
    expect(await result).toMatchObject({ kind: 'note', grounded: false })
    expect(h.deps.activate).not.toHaveBeenCalled()
  })

  it('grounding and Recent are read at call time: the grounded register', async () => {
    for (const over of [{ isGrounding: () => true }, { isRecent: () => true }]) {
      const h = harness(over)
      const result = askForNote(h.deps)
      h.check.resolve({ status: 'classified', risk: 0 })
      await flush()
      expect(h.calls[0].grounded).toBe(true)
      h.replies[0].resolve('A steady note.')
      expect(await result).toMatchObject({ grounded: true })
    }
  })

  it('grounding that begins while the reply is generated is read again before display', async () => {
    let grounding = false
    const h = harness({ isGrounding: () => grounding })
    const result = askForNote(h.deps)
    h.check.resolve({ status: 'classified', risk: 0 })
    await flush()
    grounding = true // elsewhere on the page, a paragraph settled into shore
    h.replies[0].resolve('A note in the normal register.')
    await flush()
    expect(h.calls).toHaveLength(2)
    expect(h.calls[1].grounded).toBe(true)
    h.replies[1].resolve('A steady note.')
    expect(await result).toEqual({ kind: 'note', text: 'A steady note.', grounded: true })
  })

  it('a failed or empty generation is a failure, and cancelling aborts the reply', async () => {
    const h = harness()
    const result = askForNote(h.deps)
    h.check.resolve({ status: 'classified', risk: 0 })
    await flush()
    h.replies[0].resolve('   ')
    expect(await result).toEqual({ kind: 'failed' })

    const c = new AbortController()
    const h2 = harness({ signal: c.signal })
    const r2 = askForNote(h2.deps)
    await flush()
    c.abort()
    h2.check.resolve({ status: 'classified', risk: 0 })
    expect(await r2).toEqual({ kind: 'cancelled' })
    expect(h2.calls[0].signal.aborted).toBe(true)
  })
})
