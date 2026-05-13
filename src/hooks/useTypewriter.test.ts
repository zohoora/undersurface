import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

const { useTypewriter } = await import('./useTypewriter')

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

// The reveal loop schedules itself with `25 + Math.random()*30` ms timeouts.
// Pinning Math.random keeps the cadence deterministic; advancing the clock by
// 60ms is always enough to fire one tick.
function lockRandom(v: number) {
  vi.spyOn(Math, 'random').mockReturnValue(v)
}

async function drainReveal() {
  // 8 ticks × 60ms covers up to ~24 chars in burst-1 mode (more than enough
  // for any string used in these tests).
  for (let i = 0; i < 8; i++) {
    await vi.advanceTimersByTimeAsync(60)
  }
}

describe('useTypewriter — appendToken + reveal', () => {
  it('starts empty', () => {
    const { result } = renderHook(() => useTypewriter())
    expect(result.current.displayedContent).toBe('')
  })

  it('reveals appended tokens character-by-character over time', async () => {
    lockRandom(0)
    const { result } = renderHook(() => useTypewriter())

    await act(async () => {
      result.current.appendToken('hi')
      await drainReveal()
    })

    expect(result.current.displayedContent).toBe('hi')
  })

  it('accumulates multiple appendToken calls into a single buffer', async () => {
    lockRandom(0)
    const { result } = renderHook(() => useTypewriter())

    await act(async () => {
      result.current.appendToken('Hello ')
      result.current.appendToken('writer.')
      await drainReveal()
    })

    expect(result.current.displayedContent).toBe('Hello writer.')
  })

  it('uses the 3-char burst when remaining is >20 (faster reveal under backlog)', async () => {
    lockRandom(0)
    const { result } = renderHook(() => useTypewriter())

    // appendToken runs the FIRST reveal synchronously (no setTimeout). So a
    // 30-char buffer produces 3 chars immediately before any timer fires.
    const longString = 'abcdefghijklmnopqrstuvwxyz0123' // 30 chars
    await act(async () => { result.current.appendToken(longString) })
    expect(result.current.displayedContent.length).toBe(3)
  })

  it('uses 1-char burst when remaining is <=5 (slows down for last few chars)', async () => {
    lockRandom(0)
    const { result } = renderHook(() => useTypewriter())

    // 4-char string ≤ 5 ⇒ burst=1. Sync reveal yields exactly 1 char.
    await act(async () => { result.current.appendToken('abcd') })
    expect(result.current.displayedContent.length).toBe(1)
  })
})

describe('useTypewriter — setOnComplete (finalize)', () => {
  it('fires onComplete with the full buffer once display catches up', async () => {
    lockRandom(0)
    const { result } = renderHook(() => useTypewriter())
    const onDone = vi.fn()

    await act(async () => {
      result.current.appendToken('done')
      result.current.setOnComplete(onDone)
      await drainReveal()
    })

    expect(onDone).toHaveBeenCalledOnce()
    expect(onDone).toHaveBeenCalledWith('done')
  })

  it('fires onComplete immediately with empty buffer when no tokens were appended', async () => {
    const { result } = renderHook(() => useTypewriter())
    const onDone = vi.fn()

    await act(async () => {
      result.current.setOnComplete(onDone)
      // No timers to advance — completion runs synchronously inside reveal.
    })

    expect(onDone).toHaveBeenCalledOnce()
    expect(onDone).toHaveBeenCalledWith('')
  })

  it('clears the onComplete handler after firing (does not double-fire on later append)', async () => {
    lockRandom(0)
    const { result } = renderHook(() => useTypewriter())
    const onDone = vi.fn()

    await act(async () => {
      result.current.appendToken('first')
      result.current.setOnComplete(onDone)
      await drainReveal()
    })
    expect(onDone).toHaveBeenCalledTimes(1)

    await act(async () => {
      result.current.appendToken(' second')
      await drainReveal()
    })
    // Adding more content after completion does NOT re-invoke the (cleared) cb.
    expect(onDone).toHaveBeenCalledTimes(1)
  })
})

describe('useTypewriter — reset', () => {
  it('clears displayedContent, buffer, and pending timer', async () => {
    lockRandom(0)
    const { result } = renderHook(() => useTypewriter())

    await act(async () => {
      result.current.appendToken('partial')
      // Drain one tick so something is displayed.
      await vi.advanceTimersByTimeAsync(60)
    })
    expect(result.current.displayedContent.length).toBeGreaterThan(0)

    await act(async () => { result.current.reset() })
    expect(result.current.displayedContent).toBe('')
  })

  it('drops a pending onComplete handler set before reset', async () => {
    lockRandom(0)
    const { result } = renderHook(() => useTypewriter())
    const onDone = vi.fn()

    await act(async () => {
      result.current.appendToken('xxxxxxxxxxxxxxxxxxxxxxx')
      result.current.setOnComplete(onDone)
      // Don't drain — leave the reveal mid-flight.
      result.current.reset()
      await drainReveal()
    })

    expect(onDone).not.toHaveBeenCalled()
  })
})

describe('useTypewriter — cleanup', () => {
  it('clears the pending timer without resetting displayed state', async () => {
    lockRandom(0)
    const { result } = renderHook(() => useTypewriter())

    await act(async () => {
      result.current.appendToken('mid')
      await vi.advanceTimersByTimeAsync(60)
    })
    const snapshotBefore = result.current.displayedContent

    await act(async () => { result.current.cleanup() })

    // cleanup() does NOT reset displayedContent — it only kills the timer.
    expect(result.current.displayedContent).toBe(snapshotBefore)
    // After cleanup, advancing the clock should not produce more characters
    // because the next-tick timer was cancelled.
    await act(async () => { await vi.advanceTimersByTimeAsync(500) })
    expect(result.current.displayedContent).toBe(snapshotBefore)
  })
})
