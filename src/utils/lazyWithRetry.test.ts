import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { importWithRetry, reloadOnce } from './lazyWithRetry'

const noDelay = async () => {}

describe('importWithRetry', () => {
  let reload: ReturnType<typeof vi.fn>

  beforeEach(() => {
    window.sessionStorage.clear()
    reload = vi.fn()
    Object.defineProperty(window, 'location', {
      value: { ...window.location, reload },
      configurable: true,
      writable: true,
    })
  })

  afterEach(() => {
    window.sessionStorage.clear()
  })

  it('returns the module when the first import succeeds', async () => {
    const factory = vi.fn(async () => ({ default: 'ok' }))
    await expect(importWithRetry(factory, 'room', noDelay)).resolves.toEqual({ default: 'ok' })
    expect(factory).toHaveBeenCalledTimes(1)
    expect(reload).not.toHaveBeenCalled()
  })

  it('retries a failed chunk import once before giving up', async () => {
    const factory = vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch dynamically imported module'))
      .mockResolvedValueOnce({ default: 'ok' })
    await expect(importWithRetry(factory, 'room', noDelay)).resolves.toEqual({ default: 'ok' })
    expect(factory).toHaveBeenCalledTimes(2)
    expect(reload).not.toHaveBeenCalled()
  })

  it('reloads the page once when the stale chunk is really gone', async () => {
    const factory = vi.fn().mockRejectedValue(new TypeError('Failed to fetch dynamically imported module'))
    const pending = importWithRetry(factory, 'room', noDelay)
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1))
    // The promise never settles while the page reloads.
    const settled = await Promise.race([pending.then(() => 'settled', () => 'settled'), Promise.resolve('pending')])
    expect(settled).toBe('pending')
  })

  it('does not loop: a second failure within the guard window surfaces the error', async () => {
    const error = new TypeError('Failed to fetch dynamically imported module')
    const factory = vi.fn().mockRejectedValue(error)
    void importWithRetry(factory, 'room', noDelay)
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1))
    await expect(importWithRetry(factory, 'room', noDelay)).rejects.toBe(error)
    expect(reload).toHaveBeenCalledTimes(1)
  })
})

describe('reloadOnce', () => {
  it('allows another reload after the guard window', () => {
    window.sessionStorage.clear()
    const reload = vi.fn()
    Object.defineProperty(window, 'location', { value: { ...window.location, reload }, configurable: true, writable: true })
    expect(reloadOnce('preload', 1_000)).toBe(true)
    expect(reloadOnce('preload', 2_000)).toBe(false)
    expect(reloadOnce('preload', 1_000 + 61_000)).toBe(true)
    expect(reload).toHaveBeenCalledTimes(2)
  })
})
