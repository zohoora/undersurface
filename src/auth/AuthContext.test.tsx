import React, { useContext } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

void React

// Node's own localStorage global shadows jsdom's here (as in settings.test.ts).
class MemoryStorage {
  private map = new Map<string, string>()
  get length() { return this.map.size }
  clear() { this.map.clear() }
  getItem(key: string) { return this.map.get(key) ?? null }
  key(index: number) { return [...this.map.keys()][index] ?? null }
  removeItem(key: string) { this.map.delete(key) }
  setItem(key: string, value: string) { this.map.set(key, String(value)) }
}
vi.stubGlobal('localStorage', new MemoryStorage())

const fakeAuth: { currentUser: { uid: string } | null } = { currentUser: null }
vi.mock('../firebase', () => ({ auth: fakeAuth }))
vi.mock('firebase/auth', () => ({
  onAuthStateChanged: (_auth: unknown, callback: (user: unknown) => void) => {
    callback(fakeAuth.currentUser)
    return () => {}
  },
  getRedirectResult: () => Promise.resolve(null),
  signInWithEmailAndPassword: vi.fn(),
  createUserWithEmailAndPassword: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
}))
const signOutEverywhereMock = vi.fn(async () => { fakeAuth.currentUser = null })
vi.mock('./socialSignInDriver', () => ({
  signInWithGoogle: vi.fn(),
  signInWithApple: vi.fn(),
  signOutEverywhere: () => signOutEverywhereMock(),
}))
vi.mock('@sentry/react', () => ({ captureException: vi.fn(), setUser: vi.fn() }))
vi.mock('../services/analytics', () => ({
  trackEvent: vi.fn(),
  setAnalyticsUser: vi.fn(),
  clearAnalyticsUser: vi.fn(),
}))

// Explicit extension: on a case-insensitive filesystem './AuthContext'
// resolves to authContext.ts first (main.tsx imports it the same way).
const { AuthProvider } = await import('./AuthContext.tsx')
const { AuthContext } = await import('./authContext')
const { readJournalDraft, writeJournalDraft } = await import('../store/journalDrafts')
type AuthContextValue = import('./authContext').AuthContextValue

function renderProvider(): { readonly value: AuthContextValue | null } {
  const { result } = renderHook(() => useContext(AuthContext), {
    wrapper: ({ children }: { children: React.ReactNode }) => <AuthProvider>{children}</AuthProvider>,
  })
  return { get value() { return result.current } }
}

beforeEach(() => {
  localStorage.clear()
  signOutEverywhereMock.mockClear()
  fakeAuth.currentUser = { uid: 'uid-signing-out' }
})

describe('AuthProvider sign-out', () => {
  it("clears the signed-out user's Journal drafts and leaves other users' alone", async () => {
    writeJournalDraft('uid-signing-out', 'session-a', { text: 'marker-a' })
    writeJournalDraft('uid-signing-out', 'session-b', { text: 'marker-b' })
    writeJournalDraft('uid-other', 'session-c', { text: 'not mine' })

    const ctx = renderProvider()
    await act(async () => { await ctx.value?.signOut() })

    expect(signOutEverywhereMock).toHaveBeenCalledOnce()
    expect(readJournalDraft('uid-signing-out', 'session-a')).toBeNull()
    expect(readJournalDraft('uid-signing-out', 'session-b')).toBeNull()
    expect(readJournalDraft('uid-other', 'session-c')?.text).toBe('not mine')
  })

  it('keeps the drafts when sign-out itself fails', async () => {
    writeJournalDraft('uid-signing-out', 'session-a', { text: 'marker-a' })
    signOutEverywhereMock.mockImplementationOnce(async () => { throw new Error('network') })

    const ctx = renderProvider()
    await act(async () => {
      await expect(ctx.value?.signOut()).rejects.toThrow('network')
    })

    expect(readJournalDraft('uid-signing-out', 'session-a')?.text).toBe('marker-a')
  })
})
