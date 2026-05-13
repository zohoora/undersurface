import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'

const adminFetchMock = vi.fn()
vi.mock('./adminApi', () => ({
  adminFetch: (...a: unknown[]) => adminFetchMock(...a),
}))

const { useAdminMutation } = await import('./useAdminMutation')

beforeEach(() => {
  adminFetchMock.mockReset()
})

describe('useAdminMutation — idle state', () => {
  it('starts with data=null, error=null, loading=false (no auto-fire)', () => {
    adminFetchMock.mockResolvedValue({})
    const { result } = renderHook(() => useAdminMutation('generateInsights'))
    expect(result.current.data).toBeNull()
    expect(result.current.error).toBeNull()
    expect(result.current.loading).toBe(false)
    expect(adminFetchMock).not.toHaveBeenCalled()
  })
})

describe('useAdminMutation — run()', () => {
  it('calls adminFetch with the configured action when invoked', async () => {
    adminFetchMock.mockResolvedValue({ ok: 1 })
    const { result } = renderHook(() => useAdminMutation<{ ok: number }>('generateInsights'))
    await act(async () => { await result.current.run() })
    expect(adminFetchMock).toHaveBeenCalledWith('generateInsights', undefined)
    expect(result.current.data).toEqual({ ok: 1 })
  })

  it('forwards params (per-row fetches)', async () => {
    adminFetchMock.mockResolvedValue({ messages: [] })
    const { result } = renderHook(() => useAdminMutation<{ messages: unknown[] }, { uid: string; sessionId: string }>('getSessionMessages'))
    await act(async () => { await result.current.run({ uid: 'u', sessionId: 's' }) })
    expect(adminFetchMock).toHaveBeenCalledWith('getSessionMessages', { uid: 'u', sessionId: 's' })
  })

  it('flips loading true while in flight, back to false after', async () => {
    let resolveFn!: (v: unknown) => void
    adminFetchMock.mockReturnValue(new Promise((r) => { resolveFn = r }))
    const { result } = renderHook(() => useAdminMutation('refreshAnalytics'))

    let runPromise!: Promise<unknown>
    await act(async () => {
      runPromise = result.current.run()
      await Promise.resolve()
    })
    expect(result.current.loading).toBe(true)

    await act(async () => {
      resolveFn({})
      await runPromise
    })
    expect(result.current.loading).toBe(false)
  })

  it('captures the error message and re-throws (caller can catch if needed)', async () => {
    adminFetchMock.mockRejectedValue(new Error('quota exceeded'))
    const { result } = renderHook(() => useAdminMutation('generateInsights'))

    await act(async () => {
      await expect(result.current.run()).rejects.toThrow('quota exceeded')
    })
    expect(result.current.error).toBe('quota exceeded')
    expect(result.current.data).toBeNull()
    expect(result.current.loading).toBe(false)
  })

  it('falls back to a default error message when the thrown value is not an Error', async () => {
    adminFetchMock.mockRejectedValue('weird string')
    const { result } = renderHook(() => useAdminMutation('generateInsights'))
    await act(async () => {
      await expect(result.current.run()).rejects.toBe('weird string')
    })
    expect(result.current.error).toBe('Failed: generateInsights')
  })

  it('clears any previous error on a fresh successful run', async () => {
    adminFetchMock.mockRejectedValueOnce(new Error('first'))
    adminFetchMock.mockResolvedValueOnce({ ok: true })

    const { result } = renderHook(() => useAdminMutation('refreshAnalytics'))
    await act(async () => {
      await expect(result.current.run()).rejects.toThrow()
    })
    expect(result.current.error).toBe('first')

    await act(async () => { await result.current.run() })
    expect(result.current.error).toBeNull()
    expect(result.current.data).toEqual({ ok: true })
  })

  it('returns the resolved value (callers can await the data inline)', async () => {
    adminFetchMock.mockResolvedValue({ id: 'abc' })
    const { result } = renderHook(() => useAdminMutation<{ id: string }>('generateInsights'))

    let returned: { id: string } | null = null
    await act(async () => { returned = await result.current.run() })
    expect(returned).toEqual({ id: 'abc' })
  })
})

describe('useAdminMutation — reset', () => {
  it('clears data and error without invoking the server', async () => {
    adminFetchMock.mockResolvedValue({ x: 1 })
    const { result } = renderHook(() => useAdminMutation<{ x: number }>('generateInsights'))
    await act(async () => { await result.current.run() })
    expect(result.current.data).toEqual({ x: 1 })

    adminFetchMock.mockClear()
    act(() => { result.current.reset() })
    expect(result.current.data).toBeNull()
    expect(result.current.error).toBeNull()
    expect(adminFetchMock).not.toHaveBeenCalled()
  })
})

describe('useAdminMutation — sequential calls', () => {
  it('overwrites stored data with the result of the latest run', async () => {
    adminFetchMock.mockResolvedValueOnce({ v: 'first' })
    adminFetchMock.mockResolvedValueOnce({ v: 'second' })

    const { result } = renderHook(() => useAdminMutation<{ v: string }>('refreshAnalytics'))
    await act(async () => { await result.current.run() })
    expect(result.current.data?.v).toBe('first')
    await act(async () => { await result.current.run() })
    expect(result.current.data?.v).toBe('second')
  })

  it('action identity is captured stably across renders (no surprise refetches from action churn)', async () => {
    adminFetchMock.mockResolvedValue({ x: 1 })
    const { result, rerender } = renderHook(() => useAdminMutation('generateInsights'))
    const firstRun = result.current.run
    rerender()
    expect(result.current.run).toBe(firstRun)
  })
})

describe('useAdminMutation — wiring fits AdminAnalytics refresh', () => {
  it("a run() that succeeds returns the result for callers to copy elsewhere", async () => {
    // AdminAnalytics' refresh-button pattern: useAdminQuery holds the
    // displayed data; useAdminMutation produces a fresh value to copy in.
    adminFetchMock.mockResolvedValue({ totalEntries: 999 })
    const { result } = renderHook(() => useAdminMutation<{ totalEntries: number }>('refreshAnalytics'))

    let captured: { totalEntries: number } | null = null
    await act(async () => { captured = await result.current.run() })

    expect(captured).toEqual({ totalEntries: 999 })
    await waitFor(() => expect(result.current.loading).toBe(false))
  })
})
