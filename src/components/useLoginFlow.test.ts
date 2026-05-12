import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { LoginFlowDrivers } from './useLoginFlow'

const trackEventMock = vi.fn()
vi.mock('../services/analytics', () => ({
  trackEvent: (...a: unknown[]) => trackEventMock(...a),
}))

const { useLoginFlow } = await import('./useLoginFlow')

function makeDrivers(over: Partial<LoginFlowDrivers> = {}): LoginFlowDrivers {
  return {
    signIn: vi.fn(async () => {}),
    signInWithApple: vi.fn(async () => {}),
    signInWithEmail: vi.fn(async () => {}),
    signUpWithEmail: vi.fn(async () => {}),
    resetPassword: vi.fn(async () => {}),
    ...over,
  }
}

const messages = { resetSuccess: 'Check your inbox.' }

beforeEach(() => {
  trackEventMock.mockReset()
})

describe('useLoginFlow — initial state', () => {
  it('starts with empty inputs, signin mode, and no messages', () => {
    const { result } = renderHook(() => useLoginFlow(makeDrivers(), messages))
    expect(result.current.email).toBe('')
    expect(result.current.password).toBe('')
    expect(result.current.mode).toBe('signin')
    expect(result.current.error).toBeNull()
    expect(result.current.success).toBeNull()
    expect(result.current.isSigningIn).toBe(false)
  })
})

describe('useLoginFlow — handleGoogleSignIn', () => {
  it('calls drivers.signIn and tracks no error on success', async () => {
    const drivers = makeDrivers()
    const { result } = renderHook(() => useLoginFlow(drivers, messages))
    await act(async () => { await result.current.handleGoogleSignIn() })
    expect(drivers.signIn).toHaveBeenCalledOnce()
    expect(trackEventMock).not.toHaveBeenCalledWith('auth_error', expect.anything())
    expect(result.current.error).toBeNull()
    expect(result.current.isSigningIn).toBe(false)
  })

  it('captures the error message and tracks auth_error when signIn rejects', async () => {
    const drivers = makeDrivers({ signIn: vi.fn(async () => { throw new Error('popup blocked') }) })
    const { result } = renderHook(() => useLoginFlow(drivers, messages))
    await act(async () => { await result.current.handleGoogleSignIn() })
    expect(result.current.error).toBe('popup blocked')
    expect(trackEventMock).toHaveBeenCalledWith('auth_error', { method: 'google' })
  })

  it('handleAppleSignIn routes through drivers.signInWithApple', async () => {
    const drivers = makeDrivers()
    const { result } = renderHook(() => useLoginFlow(drivers, messages))
    await act(async () => { await result.current.handleAppleSignIn() })
    expect(drivers.signInWithApple).toHaveBeenCalledOnce()
    expect(drivers.signIn).not.toHaveBeenCalled()
  })
})

describe('useLoginFlow — handleEmailSubmit branches by mode', () => {
  it('default mode (signin) calls signInWithEmail with current email + password', async () => {
    const drivers = makeDrivers()
    const { result } = renderHook(() => useLoginFlow(drivers, messages))

    act(() => { result.current.setEmail('a@b.com') })
    act(() => { result.current.setPassword('hunter2') })
    await act(async () => { await result.current.handleEmailSubmit() })

    expect(drivers.signInWithEmail).toHaveBeenCalledWith('a@b.com', 'hunter2')
    expect(drivers.signUpWithEmail).not.toHaveBeenCalled()
    expect(drivers.resetPassword).not.toHaveBeenCalled()
  })

  it('signup mode calls signUpWithEmail', async () => {
    const drivers = makeDrivers()
    const { result } = renderHook(() => useLoginFlow(drivers, messages))
    act(() => { result.current.switchMode('signup') })
    act(() => { result.current.setEmail('new@b.com') })
    act(() => { result.current.setPassword('p') })
    await act(async () => { await result.current.handleEmailSubmit() })
    expect(drivers.signUpWithEmail).toHaveBeenCalledWith('new@b.com', 'p')
  })

  it('reset mode calls resetPassword, surfaces success, and returns to signin', async () => {
    const drivers = makeDrivers()
    const { result } = renderHook(() => useLoginFlow(drivers, messages))
    act(() => { result.current.switchMode('reset') })
    act(() => { result.current.setEmail('lost@b.com') })
    await act(async () => { await result.current.handleEmailSubmit() })

    expect(drivers.resetPassword).toHaveBeenCalledWith('lost@b.com')
    expect(result.current.success).toBe('Check your inbox.')
    expect(result.current.mode).toBe('signin')
  })

  it('cleans Firebase error format ("auth/wrong-password" → "wrong password")', async () => {
    const err = new Error('Firebase: Error (auth/wrong-password).')
    const drivers = makeDrivers({ signInWithEmail: vi.fn(async () => { throw err }) })
    const { result } = renderHook(() => useLoginFlow(drivers, messages))
    act(() => { result.current.setEmail('a') })
    act(() => { result.current.setPassword('b') })
    await act(async () => { await result.current.handleEmailSubmit() })
    expect(result.current.error).toBe('wrong password')
    expect(trackEventMock).toHaveBeenCalledWith('auth_error', { method: 'email', mode: 'signin' })
  })

  it('calls preventDefault on the form event when provided', async () => {
    const drivers = makeDrivers()
    const { result } = renderHook(() => useLoginFlow(drivers, messages))
    const preventDefault = vi.fn()
    await act(async () => { await result.current.handleEmailSubmit({ preventDefault }) })
    expect(preventDefault).toHaveBeenCalledOnce()
  })

  it('tolerates being called without a form event (e.g. programmatic submit)', async () => {
    const drivers = makeDrivers()
    const { result } = renderHook(() => useLoginFlow(drivers, messages))
    await expect(act(async () => { await result.current.handleEmailSubmit() })).resolves.toBeUndefined()
  })
})

describe('useLoginFlow — isSigningIn lifecycle', () => {
  it('flips true during the in-flight request, back to false after', async () => {
    let resolveFn!: () => void
    const drivers = makeDrivers({
      signInWithEmail: vi.fn(() => new Promise<void>((r) => { resolveFn = r })),
    })
    const { result } = renderHook(() => useLoginFlow(drivers, messages))

    let submitPromise!: Promise<void>
    await act(async () => {
      submitPromise = result.current.handleEmailSubmit()
      await Promise.resolve()
    })
    expect(result.current.isSigningIn).toBe(true)

    await act(async () => {
      resolveFn()
      await submitPromise
    })
    expect(result.current.isSigningIn).toBe(false)
  })
})

describe('useLoginFlow — switchMode', () => {
  it('updates mode and clears any prior error / success', async () => {
    const drivers = makeDrivers({ signInWithEmail: vi.fn(async () => { throw new Error('Firebase: Error (auth/invalid).') }) })
    const { result } = renderHook(() => useLoginFlow(drivers, messages))
    await act(async () => { await result.current.handleEmailSubmit() })
    expect(result.current.error).not.toBeNull()

    act(() => { result.current.switchMode('reset') })
    expect(result.current.mode).toBe('reset')
    expect(result.current.error).toBeNull()
    expect(result.current.success).toBeNull()
  })
})
