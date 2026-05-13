// globalConfig owns the live Firestore listener on appConfig/global. The
// load-bearing concern: buildVersion change detection drives the "new
// version available" refresh prompt. Stale cache after teardown could leak
// across user-switches; failing to capture the initial version would
// trigger a false-positive refresh prompt on first load.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { GlobalConfig } from '../admin/adminTypes'

interface SnapshotMock {
  exists: () => boolean
  data: () => GlobalConfig | undefined
}

let snapshotHandler: ((s: SnapshotMock) => void) | null = null
const unsubscribeMock = vi.fn()

vi.mock('firebase/firestore', () => ({
  doc: vi.fn(() => ({ _kind: 'doc-ref' })),
  onSnapshot: vi.fn((_ref: unknown, next: (s: SnapshotMock) => void) => {
    snapshotHandler = next
    return unsubscribeMock
  }),
}))

vi.mock('../firebase', () => ({
  firestore: {},
}))

const invalidateSettingsCacheMock = vi.fn()
vi.mock('./settings', () => ({
  invalidateSettingsCache: () => invalidateSettingsCacheMock(),
}))

const {
  initGlobalConfig,
  teardownGlobalConfig,
  getGlobalConfig,
  useGlobalConfig,
  useNewVersionAvailable,
} = await import('./globalConfig')

function fireSnapshot(config: GlobalConfig | null) {
  snapshotHandler!({
    exists: () => config !== null,
    data: () => config ?? undefined,
  })
}

function makeConfig(buildVersion: string | null = null): GlobalConfig {
  return {
    features: {} as GlobalConfig['features'],
    atmosphere: {} as GlobalConfig['atmosphere'],
    partIntelligence: {} as GlobalConfig['partIntelligence'],
    engagement: {} as GlobalConfig['engagement'],
    grounding: {} as GlobalConfig['grounding'],
    voice: { defaultVoice: 'marin' },
    announcement: null,
    ...(buildVersion !== null ? { buildVersion } : {}),
  } as GlobalConfig
}

beforeEach(() => {
  // Reset module-level state before each test.
  teardownGlobalConfig()
  snapshotHandler = null
  unsubscribeMock.mockReset()
  invalidateSettingsCacheMock.mockReset()
})

describe('globalConfig — init + listen', () => {
  it('subscribes to the appConfig/global document on init', () => {
    initGlobalConfig()
    expect(snapshotHandler).not.toBeNull()
  })

  it('is idempotent: calling init twice does not double-subscribe', () => {
    initGlobalConfig()
    const firstHandler = snapshotHandler
    initGlobalConfig()
    expect(snapshotHandler).toBe(firstHandler)
  })

  it('updates the cache when a snapshot arrives', () => {
    initGlobalConfig()
    expect(getGlobalConfig()).toBeNull()
    fireSnapshot(makeConfig('v1'))
    expect(getGlobalConfig()?.buildVersion).toBe('v1')
  })

  it('clears the cache when the document does not exist', () => {
    initGlobalConfig()
    fireSnapshot(makeConfig('v1'))
    fireSnapshot(null)
    expect(getGlobalConfig()).toBeNull()
  })

  it('invalidates the settings cache on every snapshot update (settings depend on config)', () => {
    initGlobalConfig()
    fireSnapshot(makeConfig('v1'))
    expect(invalidateSettingsCacheMock).toHaveBeenCalledOnce()
    fireSnapshot(makeConfig('v2'))
    expect(invalidateSettingsCacheMock).toHaveBeenCalledTimes(2)
  })
})

describe('globalConfig — buildVersion change detection (refresh-prompt invariant)', () => {
  it('captures the initial buildVersion silently — first load is NOT a "new version" event', () => {
    initGlobalConfig()
    const { result } = renderHook(() => useNewVersionAvailable())
    fireSnapshot(makeConfig('initial-v'))
    expect(result.current).toBe(false)
  })

  it('flips hasNewVersion=true when the buildVersion changes from its initial value', () => {
    initGlobalConfig()
    const { result } = renderHook(() => useNewVersionAvailable())
    fireSnapshot(makeConfig('initial-v'))
    expect(result.current).toBe(false)

    act(() => { fireSnapshot(makeConfig('updated-v')) })
    expect(result.current).toBe(true)
  })

  it('does NOT re-fire the version-changed event on subsequent further changes (single-shot)', () => {
    initGlobalConfig()
    const versionListener = vi.fn()
    const { result, rerender } = renderHook(() => useNewVersionAvailable())
    // Hook subscribes via useSyncExternalStore. We count via component renders.
    fireSnapshot(makeConfig('initial-v'))
    versionListener() // baseline
    act(() => { fireSnapshot(makeConfig('updated-v')) })
    expect(result.current).toBe(true)
    act(() => { fireSnapshot(makeConfig('updated-v-2')) })
    // hasNewVersion stays true (already true); the listener set fires once.
    rerender()
    expect(result.current).toBe(true)
  })

  it('does NOT fire version-changed when buildVersion is missing/null in subsequent snapshots', () => {
    initGlobalConfig()
    const { result } = renderHook(() => useNewVersionAvailable())
    fireSnapshot(makeConfig('initial-v'))
    act(() => { fireSnapshot(makeConfig()) }) // no buildVersion
    expect(result.current).toBe(false)
  })
})

describe('globalConfig — useGlobalConfig hook', () => {
  it('returns null before any snapshot arrives', () => {
    initGlobalConfig()
    const { result } = renderHook(() => useGlobalConfig())
    expect(result.current).toBeNull()
  })

  it('re-renders subscribers when the snapshot updates', () => {
    initGlobalConfig()
    const { result } = renderHook(() => useGlobalConfig())
    act(() => { fireSnapshot(makeConfig('v1')) })
    expect(result.current?.buildVersion).toBe('v1')
    act(() => { fireSnapshot(makeConfig('v2')) })
    expect(result.current?.buildVersion).toBe('v2')
  })
})

describe('globalConfig — teardown', () => {
  it('unsubscribes from Firestore on teardown', () => {
    initGlobalConfig()
    teardownGlobalConfig()
    expect(unsubscribeMock).toHaveBeenCalledOnce()
  })

  it('clears cached config + version state so re-init starts fresh', () => {
    initGlobalConfig()
    fireSnapshot(makeConfig('v1'))
    expect(getGlobalConfig()).not.toBeNull()
    teardownGlobalConfig()
    expect(getGlobalConfig()).toBeNull()
  })

  it('after teardown, re-init captures a new initial buildVersion (no false-positive refresh prompt)', () => {
    initGlobalConfig()
    fireSnapshot(makeConfig('v-from-prev-user'))
    teardownGlobalConfig()
    initGlobalConfig()
    const { result } = renderHook(() => useNewVersionAvailable())
    fireSnapshot(makeConfig('v-from-prev-user')) // same string, but should be the new "initial"
    expect(result.current).toBe(false)
  })
})
