import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

const adminFetchMock = vi.fn()
vi.mock('./adminApi', () => ({
  adminFetch: (...a: unknown[]) => adminFetchMock(...a),
}))

const { useAdminQuery } = await import('./useAdminQuery')

beforeEach(() => {
  adminFetchMock.mockReset()
})

describe('useAdminQuery', () => {
  it('fetches the supplied action on mount', async () => {
    adminFetchMock.mockResolvedValue({ x: 1 })
    const { result } = renderHook(() => useAdminQuery<{ x: number }>('getOverview'))
    await waitFor(() => expect(result.current.data).toEqual({ x: 1 }))
    expect(adminFetchMock).toHaveBeenCalledWith('getOverview', undefined)
  })

  it('forwards params to adminFetch', async () => {
    adminFetchMock.mockResolvedValue({ uid: 'a' })
    renderHook(() => useAdminQuery('getUserDetail', { uid: 'alice' }))
    await waitFor(() => expect(adminFetchMock).toHaveBeenCalled())
    expect(adminFetchMock).toHaveBeenCalledWith('getUserDetail', { uid: 'alice' })
  })

  it('starts in loading state (data===null && error===null) until resolve', async () => {
    let resolveFn!: (v: unknown) => void
    adminFetchMock.mockReturnValue(new Promise((r) => { resolveFn = r }))
    const { result } = renderHook(() => useAdminQuery('getOverview'))
    expect(result.current.loading).toBe(true)
    expect(result.current.data).toBeNull()
    expect(result.current.error).toBeNull()
    resolveFn({})
    await waitFor(() => expect(result.current.loading).toBe(false))
  })

  it('surfaces an error message and clears loading on reject', async () => {
    adminFetchMock.mockRejectedValue(new Error('Forbidden'))
    const { result } = renderHook(() => useAdminQuery('getOverview'))
    await waitFor(() => expect(result.current.error).toBe('Forbidden'))
    expect(result.current.loading).toBe(false)
  })

  it('does NOT refetch when a new params object has the same JSON shape (identity-stable via paramsKey)', async () => {
    adminFetchMock.mockResolvedValue({ ok: true })
    const { rerender } = renderHook(({ p }) => useAdminQuery('getUserDetail', p), {
      initialProps: { p: { uid: 'a' } as Record<string, unknown> },
    })
    await waitFor(() => expect(adminFetchMock).toHaveBeenCalledTimes(1))

    // Fresh object, same content — should NOT trigger a refetch.
    rerender({ p: { uid: 'a' } })
    await new Promise((r) => setTimeout(r, 20))
    expect(adminFetchMock).toHaveBeenCalledTimes(1)
  })

  it('refetches when params actually change', async () => {
    adminFetchMock.mockResolvedValue({ ok: true })
    const { rerender } = renderHook(({ p }) => useAdminQuery('getUserDetail', p), {
      initialProps: { p: { uid: 'a' } as Record<string, unknown> },
    })
    await waitFor(() => expect(adminFetchMock).toHaveBeenCalledTimes(1))
    rerender({ p: { uid: 'b' } })
    await waitFor(() => expect(adminFetchMock).toHaveBeenCalledTimes(2))
  })

  it('exposes setData for mutating after a side-effect (e.g. refresh button)', async () => {
    adminFetchMock.mockResolvedValue({ v: 1 })
    const { result } = renderHook(() => useAdminQuery<{ v: number }>('getAnalytics'))
    await waitFor(() => expect(result.current.data).toEqual({ v: 1 }))

    // Caller swaps in a new value (typical for AdminAnalytics' refresh path).
    await waitFor(() => expect(typeof result.current.setData).toBe('function'))
    // setData is a useState setter — just assert it's the expected shape.
    expect(typeof result.current.setData).toBe('function')
  })

  it('ignores a late response after the action/params changed (race protection)', async () => {
    let resolveFirst!: (v: unknown) => void
    adminFetchMock.mockImplementationOnce(() => new Promise((r) => { resolveFirst = r }))
    adminFetchMock.mockResolvedValueOnce({ from: 'b' })

    const { result, rerender } = renderHook(({ p }) => useAdminQuery<{ from: string }>('getUserDetail', p), {
      initialProps: { p: { uid: 'a' } as Record<string, unknown> },
    })
    rerender({ p: { uid: 'b' } })
    await waitFor(() => expect(result.current.data).toEqual({ from: 'b' }))

    // First (stale) request now resolves — must NOT overwrite.
    resolveFirst({ from: 'a-stale' })
    await new Promise((r) => setTimeout(r, 10))
    expect(result.current.data).toEqual({ from: 'b' })
  })
})
