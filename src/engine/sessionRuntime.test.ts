import { describe, expect, it, vi } from 'vitest'
import { SessionRuntime } from './sessionRuntime'

describe('SessionRuntime', () => {
  it('invalidates the prior epoch and aborts its work on a session switch', () => {
    const runtime = new SessionRuntime()
    const first = runtime.begin('one')
    const controller = runtime.createAbortController()

    const second = runtime.begin('two')

    expect(controller.signal.aborted).toBe(true)
    expect(runtime.isCurrent(first)).toBe(false)
    expect(runtime.isCurrent(second)).toBe(true)
    expect(runtime.isSessionActive('two')).toBe(true)
  })

  it('adopts the generated id without changing the new-session epoch', () => {
    const runtime = new SessionRuntime()
    const ticket = runtime.begin(null)
    expect(runtime.adoptSessionId('generated', ticket)).toBe(true)
    expect(runtime.isCurrent(ticket)).toBe(true)
    expect(runtime.isSessionActive('generated')).toBe(true)
  })

  it('serializes append jobs even when one rejects', async () => {
    const runtime = new SessionRuntime()
    const order: number[] = []
    const first = runtime.enqueueAppend(async () => {
      order.push(1)
      throw new Error('expected')
    })
    const second = runtime.enqueueAppend(async () => { order.push(2) })

    await expect(first).rejects.toThrow('expected')
    await second
    expect(order).toEqual([1, 2])
  })

  it('provides a synchronous send lock', () => {
    const runtime = new SessionRuntime()
    expect(runtime.acquireSend()).toBe(true)
    expect(runtime.acquireSend()).toBe(false)
    runtime.releaseSend()
    expect(runtime.acquireSend()).toBe(true)
  })

  it('does not end a newer session with a stale cleanup ticket', () => {
    const runtime = new SessionRuntime()
    const stale = runtime.begin('one')
    const current = runtime.begin('two')
    const abortSpy = vi.fn()
    runtime.createAbortController().signal.addEventListener('abort', abortSpy)

    runtime.end(stale)

    expect(runtime.isCurrent(current)).toBe(true)
    expect(abortSpy).not.toHaveBeenCalled()
  })
})
