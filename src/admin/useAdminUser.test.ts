import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import type { AdminUserDetailResponse } from './adminTypes'

const adminFetchMock = vi.fn()
vi.mock('./adminApi', () => ({
  adminFetch: (...a: unknown[]) => adminFetchMock(...a),
}))

const { useAdminUser } = await import('./useAdminUser')

function makeUserDetail(over: Partial<AdminUserDetailResponse> = {}): AdminUserDetailResponse {
  return {
    user: {
      uid: 'u1',
      email: 'u1@example.com',
      displayName: 'User One',
      photoURL: null,
      entryCount: 0,
      thoughtCount: 0,
      interactionCount: 0,
      partCount: 0,
      sessionCount: 0,
      totalWords: 0,
      lastActive: null,
      createdAt: 0,
    },
    entries: [],
    parts: [],
    thoughts: [],
    interactions: [],
    memories: [],
    userProfile: null,
    entrySummaries: [],
    sessions: [],
    conversations: [],
    weather: [],
    letters: [],
    fossils: [],
    ...over,
  } as AdminUserDetailResponse
}

beforeEach(() => {
  adminFetchMock.mockReset()
})

describe('useAdminUser', () => {
  it('fetches getUserDetail with the supplied uid on mount', async () => {
    adminFetchMock.mockResolvedValue(makeUserDetail())
    const { result } = renderHook(() => useAdminUser('alice'))
    await waitFor(() => expect(result.current.data).not.toBeNull())
    expect(adminFetchMock).toHaveBeenCalledWith('getUserDetail', { uid: 'alice' })
  })

  it('reports loading=true until the fetch resolves', async () => {
    let resolveFn!: (v: AdminUserDetailResponse) => void
    adminFetchMock.mockReturnValue(new Promise<AdminUserDetailResponse>((r) => { resolveFn = r }))
    const { result } = renderHook(() => useAdminUser('u1'))
    expect(result.current.loading).toBe(true)
    expect(result.current.data).toBeNull()
    expect(result.current.error).toBeNull()
    resolveFn(makeUserDetail())
    await waitFor(() => expect(result.current.loading).toBe(false))
  })

  it('exposes an error message when the fetch rejects', async () => {
    adminFetchMock.mockRejectedValue(new Error('Forbidden'))
    const { result } = renderHook(() => useAdminUser('u1'))
    await waitFor(() => expect(result.current.error).toBe('Forbidden'))
    expect(result.current.data).toBeNull()
    expect(result.current.loading).toBe(false)
  })

  it('re-fetches when uid changes', async () => {
    adminFetchMock.mockResolvedValue(makeUserDetail())
    const { result, rerender } = renderHook(({ uid }) => useAdminUser(uid), {
      initialProps: { uid: 'u1' },
    })
    await waitFor(() => expect(result.current.data).not.toBeNull())
    rerender({ uid: 'u2' })
    await waitFor(() => expect(adminFetchMock).toHaveBeenCalledTimes(2))
    expect(adminFetchMock.mock.calls[1]).toEqual(['getUserDetail', { uid: 'u2' }])
  })

  it('ignores a stale response after uid changed (race protection)', async () => {
    let resolveFirst!: (v: AdminUserDetailResponse) => void
    adminFetchMock.mockImplementationOnce(
      () => new Promise<AdminUserDetailResponse>((r) => { resolveFirst = r }),
    )
    adminFetchMock.mockResolvedValueOnce(makeUserDetail({
      user: { ...makeUserDetail().user, uid: 'u2', displayName: 'User Two' },
    }))

    const { result, rerender } = renderHook(({ uid }) => useAdminUser(uid), {
      initialProps: { uid: 'u1' },
    })
    rerender({ uid: 'u2' })
    await waitFor(() => expect(result.current.data?.user.uid).toBe('u2'))

    // The first request's late resolve must NOT overwrite the u2 data.
    resolveFirst(makeUserDetail({
      user: { ...makeUserDetail().user, uid: 'u1', displayName: 'STALE' },
    }))
    await new Promise((r) => setTimeout(r, 10))
    expect(result.current.data?.user.uid).toBe('u2')
  })

  it('clears a previous error on a successful refetch', async () => {
    adminFetchMock.mockRejectedValueOnce(new Error('first failed'))
    adminFetchMock.mockResolvedValueOnce(makeUserDetail())

    const { result, rerender } = renderHook(({ uid }) => useAdminUser(uid), {
      initialProps: { uid: 'u1' },
    })
    await waitFor(() => expect(result.current.error).toBe('first failed'))

    rerender({ uid: 'u2' })
    await waitFor(() => expect(result.current.data).not.toBeNull())
    expect(result.current.error).toBeNull()
  })
})
