import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, sendPasswordResetEmail, getRedirectResult } from 'firebase/auth'
import type { User } from 'firebase/auth'
import { auth } from '../firebase'
import { AuthContext } from './authContext'
import * as Sentry from '@sentry/react'
import { trackEvent, setAnalyticsUser, clearAnalyticsUser } from '../services/analytics'
import { signInWithGoogle, signInWithApple as nativeSignInWithApple, signOutEverywhere } from './socialSignInDriver'

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void
  }
}

function trackAdConversion() {
  window.gtag?.('event', 'conversion', {
    send_to: 'AW-17954082823/TuxaCPeu0vgbEIeglvFC',
    value: 1.0,
    currency: 'CAD',
  })
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Capture the result of any pending signInWithRedirect (mobile path).
    // Resolves to null on cold load with no pending redirect; resolves to
    // a UserCredential when the user is returning from the Google flow.
    // Errors here are surfaced to Sentry; onAuthStateChanged still fires
    // for the actual auth state.
    void getRedirectResult(auth)
      .then(result => {
        if (result?.user) {
          trackEvent('sign_in', { method: 'google' })
          if (result.user.metadata.creationTime === result.user.metadata.lastSignInTime) {
            trackAdConversion()
          }
        }
      })
      .catch(err => {
        Sentry.captureException(err, { tags: { area: 'auth_redirect' } })
      })

    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u)
      setLoading(false)
      if (u) {
        setAnalyticsUser(u.uid)
        Sentry.setUser({ id: u.uid, email: u.email ?? undefined })
      } else {
        clearAnalyticsUser()
        Sentry.setUser(null)
      }
    })
    return unsubscribe
  }, [])

  // Social sign-in auto-creates accounts on first use; track those as conversions.
  const runSocialSignIn = async (method: 'google' | 'apple', driver: typeof signInWithGoogle) => {
    const result = await driver()
    trackEvent('sign_in', { method })
    if (result.user.metadata.creationTime === result.user.metadata.lastSignInTime) {
      trackAdConversion()
    }
  }

  const signIn = () => runSocialSignIn('google', signInWithGoogle)
  const signInWithApple = () => runSocialSignIn('apple', nativeSignInWithApple)

  const signInWithEmail = async (email: string, password: string) => {
    await signInWithEmailAndPassword(auth, email, password)
    trackEvent('sign_in', { method: 'email' })
  }

  const signUpWithEmail = async (email: string, password: string) => {
    await createUserWithEmailAndPassword(auth, email, password)
    trackEvent('sign_up', { method: 'email' })
    trackAdConversion()
  }

  const resetPassword = async (email: string) => {
    await sendPasswordResetEmail(auth, email)
  }

  const signOut = async () => {
    await signOutEverywhere()
  }

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signInWithApple, signInWithEmail, signUpWithEmail, resetPassword, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}
