import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const setDocMock = vi.hoisted(() => vi.fn(async () => {}))
const docMock = vi.hoisted(() => vi.fn((...segments: unknown[]) => ({ path: segments.slice(1).join('/') })))
const authState = vi.hoisted(() => ({ currentUser: { uid: 'user-1' } as { uid: string } | null }))

vi.mock('firebase/firestore', () => ({ doc: docMock, setDoc: setDocMock }))
vi.mock('firebase/auth', () => ({ getAuth: () => authState }))
vi.mock('../firebase', () => ({ firestore: {} }))
vi.mock('../services/diagnostics', () => ({ engineLog: vi.fn() }))
vi.mock('./globalConfig', () => ({ getGlobalConfig: () => null }))

const grounding = await import('./groundingState')
const { installGroundingPersistence, resetGroundingPersistenceForTests } = await import('./groundingPersistence')

describe('lastGroundingAt persistence', () => {
  let uninstall: () => void

  beforeEach(() => {
    vi.useFakeTimers().setSystemTime(1_000_000)
    setDocMock.mockReset()
    setDocMock.mockResolvedValue(undefined)
    authState.currentUser = { uid: 'user-1' }
    resetGroundingPersistenceForTests()
    if (grounding.isGroundingActive()) grounding.deactivateGrounding()
    grounding.clearAutoExitTimer()
    uninstall = installGroundingPersistence()
  })

  afterEach(() => {
    uninstall()
    grounding.deactivateGrounding()
    grounding.clearAutoExitTimer()
    vi.useRealTimers()
  })

  it('merges lastGroundingAt into companionPreferences/current on activation', async () => {
    grounding.activateGrounding('auto')
    await Promise.resolve()
    expect(setDocMock).toHaveBeenCalledTimes(1)
    expect(docMock).toHaveBeenCalledWith(expect.anything(), 'users', 'user-1', 'companionPreferences', 'current')
    expect(setDocMock).toHaveBeenCalledWith(
      expect.anything(),
      { id: 'current', lastGroundingAt: 1_000_000 },
      { merge: true },
    )
  })

  it('refreshes the timestamp on a later re-trigger but coalesces a same-turn burst', async () => {
    grounding.activateGrounding('auto')
    grounding.activateGrounding('auto')
    await Promise.resolve()
    expect(setDocMock).toHaveBeenCalledTimes(1)

    vi.setSystemTime(1_000_000 + 60_000)
    grounding.activateGrounding('auto')
    await Promise.resolve()
    expect(setDocMock).toHaveBeenCalledTimes(2)
    expect(setDocMock).toHaveBeenLastCalledWith(
      expect.anything(),
      { id: 'current', lastGroundingAt: 1_060_000 },
      { merge: true },
    )
  })

  it('never throws into the crisis path when the write fails', async () => {
    setDocMock.mockRejectedValueOnce(new Error('offline'))
    expect(() => grounding.activateGrounding('auto')).not.toThrow()
    expect(grounding.isGroundingActive()).toBe(true)
    await Promise.resolve()
    await Promise.resolve()
    // A failed write does not consume the throttle window.
    grounding.activateGrounding('auto')
    await Promise.resolve()
    expect(setDocMock).toHaveBeenCalledTimes(2)
  })

  it('skips the write without a signed-in user', async () => {
    authState.currentUser = null
    grounding.activateGrounding('auto')
    await Promise.resolve()
    expect(setDocMock).not.toHaveBeenCalled()
    expect(grounding.isGroundingActive()).toBe(true)
  })

  it('a throwing sink cannot break activation', () => {
    const remove = grounding.onGroundingActivated(() => { throw new Error('sink exploded') })
    expect(() => grounding.activateGrounding('auto')).not.toThrow()
    expect(grounding.isGroundingActive()).toBe(true)
    remove()
  })
})
