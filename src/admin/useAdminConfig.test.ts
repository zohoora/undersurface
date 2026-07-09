import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import type { GlobalConfig } from './adminTypes'

const adminFetchMock = vi.fn()
vi.mock('./adminApi', () => ({
  adminFetch: (...a: unknown[]) => adminFetchMock(...a),
}))

const { useAdminConfig } = await import('./useAdminConfig')

const MIN_DEFAULTS = {
  defaultResponseSpeed: 1.0,
  features: { partsEnabled: true, autocorrectEnabled: true },
  atmosphere: {},
  partIntelligence: {},
  engagement: {},
  grounding: {},
  voice: { defaultVoice: 'marin' },
  announcement: null,
} as unknown as GlobalConfig

function fetchResolvesTo(action: string, payload: unknown) {
  adminFetchMock.mockImplementation((a: string) => {
    if (a === action) return Promise.resolve(payload)
    return Promise.resolve({ config: null })
  })
}

beforeEach(() => {
  adminFetchMock.mockReset()
})

describe('useAdminConfig — load', () => {
  it('fetches getConfig on mount and stores the result', async () => {
    fetchResolvesTo('getConfig', { config: { ...MIN_DEFAULTS, defaultResponseSpeed: 1.5 } })

    const { result } = renderHook(() => useAdminConfig(MIN_DEFAULTS))

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(adminFetchMock).toHaveBeenCalledWith('getConfig')
    expect(result.current.config?.defaultResponseSpeed).toBe(1.5)
  })

  it('falls back to defaults when the server returns no config', async () => {
    fetchResolvesTo('getConfig', { config: null })

    const { result } = renderHook(() => useAdminConfig(MIN_DEFAULTS))

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.config).toEqual(MIN_DEFAULTS)
  })

  it('surfaces an error message when getConfig fails', async () => {
    adminFetchMock.mockRejectedValue(new Error('network down'))

    const { result } = renderHook(() => useAdminConfig(MIN_DEFAULTS))

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.message).toEqual({ type: 'error', text: 'network down' })
    expect(result.current.config).toBeNull()
  })
})

describe('useAdminConfig — save', () => {
  it('persists the current config and sets a success message', async () => {
    const initial = { ...MIN_DEFAULTS, defaultResponseSpeed: 1.5 }
    const persisted = { ...initial, defaultResponseSpeed: 1.7, updatedAt: 999 } as GlobalConfig
    adminFetchMock.mockImplementation((action: string, params?: { config?: GlobalConfig }) => {
      if (action === 'getConfig') return Promise.resolve({ config: initial })
      if (action === 'updateConfig') return Promise.resolve({ config: persisted, _echo: params?.config })
      return Promise.resolve(null)
    })

    const { result } = renderHook(() => useAdminConfig(MIN_DEFAULTS))
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => { await result.current.save() })

    expect(adminFetchMock).toHaveBeenCalledWith('updateConfig', {
      config: expect.objectContaining({
        defaultResponseSpeed: 1.5,
        features: initial.features,
        atmosphere: initial.atmosphere,
        partIntelligence: initial.partIntelligence,
        engagement: initial.engagement,
        grounding: initial.grounding,
        voice: initial.voice,
        announcement: initial.announcement,
      }),
    })
    await waitFor(() => expect(result.current.message?.type).toBe('success'))
    expect(result.current.config).toEqual(persisted) // server-returned shape wins
  })

  it('surfaces an error message when save fails', async () => {
    adminFetchMock.mockImplementation((action: string) => {
      if (action === 'getConfig') return Promise.resolve({ config: MIN_DEFAULTS })
      if (action === 'updateConfig') return Promise.reject(new Error('forbidden'))
      return Promise.resolve(null)
    })

    const { result } = renderHook(() => useAdminConfig(MIN_DEFAULTS))
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => { await result.current.save() })
    await waitFor(() => expect(result.current.message?.type).toBe('error'))
    expect(result.current.message?.text).toBe('forbidden')
  })
})

describe('useAdminConfig — signalUpdate', () => {
  it('stamps buildVersion to now-as-string and persists', async () => {
    adminFetchMock.mockImplementation((action: string, params?: { config: GlobalConfig }) => {
      if (action === 'getConfig') return Promise.resolve({ config: { ...MIN_DEFAULTS, buildVersion: 'old' } })
      if (action === 'updateConfig') return Promise.resolve({ config: params!.config })
      return Promise.resolve(null)
    })

    const { result } = renderHook(() => useAdminConfig(MIN_DEFAULTS))
    await waitFor(() => expect(result.current.loading).toBe(false))

    const before = Date.now()
    await act(async () => { await result.current.signalUpdate() })
    const after = Date.now()

    await waitFor(() => expect(result.current.message?.type).toBe('success'))
    const persistedCall = adminFetchMock.mock.calls.find(c => c[0] === 'updateConfig')!
    const persisted = (persistedCall[1] as { config: GlobalConfig }).config
    const version = parseInt(persisted.buildVersion as string, 10)
    expect(version).toBeGreaterThanOrEqual(before)
    expect(version).toBeLessThanOrEqual(after)
    expect(Object.keys(persisted)).toEqual(['buildVersion'])
  })
})

describe('useAdminConfig — resetDefaults', () => {
  it('replaces the editable surface but preserves audit fields (buildVersion, updatedAt, updatedBy, announcement)', async () => {
    const current = {
      ...MIN_DEFAULTS,
      defaultResponseSpeed: 1.9,
      buildVersion: 'keep-me',
      announcement: 'keep-me-too',
      updatedAt: 12345,
      updatedBy: 'zohoora@gmail.com',
    } as GlobalConfig
    fetchResolvesTo('getConfig', { config: current })

    const { result } = renderHook(() => useAdminConfig(MIN_DEFAULTS))
    await waitFor(() => expect(result.current.loading).toBe(false))

    act(() => { result.current.resetDefaults() })

    expect(result.current.config!.defaultResponseSpeed).toBe(MIN_DEFAULTS.defaultResponseSpeed)
    expect(result.current.config!.buildVersion).toBe('keep-me')
    expect(result.current.config!.announcement).toBe('keep-me-too')
    expect(result.current.config!.updatedAt).toBe(12345)
    expect(result.current.config!.updatedBy).toBe('zohoora@gmail.com')
    expect(result.current.message?.type).toBe('success')
  })

  it('does NOT write to the server — save is explicit', async () => {
    fetchResolvesTo('getConfig', { config: MIN_DEFAULTS })
    const { result } = renderHook(() => useAdminConfig(MIN_DEFAULTS))
    await waitFor(() => expect(result.current.loading).toBe(false))

    adminFetchMock.mockClear()
    act(() => { result.current.resetDefaults() })

    expect(adminFetchMock).not.toHaveBeenCalled()
  })
})

describe('useAdminConfig — updateSection', () => {
  it('merges a single key into a nested section without touching others', async () => {
    fetchResolvesTo('getConfig', { config: MIN_DEFAULTS })
    const { result } = renderHook(() => useAdminConfig(MIN_DEFAULTS))
    await waitFor(() => expect(result.current.loading).toBe(false))

    act(() => { result.current.updateSection('features', 'partsEnabled', false) })
    expect(result.current.config?.features.partsEnabled).toBe(false)
    // Sibling key untouched.
    expect(result.current.config?.features.autocorrectEnabled).toBe(true)
  })

  it('does NOT auto-save — save is explicit', async () => {
    fetchResolvesTo('getConfig', { config: MIN_DEFAULTS })
    const { result } = renderHook(() => useAdminConfig(MIN_DEFAULTS))
    await waitFor(() => expect(result.current.loading).toBe(false))

    adminFetchMock.mockClear()
    act(() => { result.current.updateSection('features', 'partsEnabled', false) })
    expect(adminFetchMock).not.toHaveBeenCalled()
  })
})
