import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { onAuthStateChanged, signInWithPopup, signOut as firebaseSignOut, signInWithEmailAndPassword, createUserWithEmailAndPassword, sendPasswordResetEmail } from 'firebase/auth'
import type { User } from 'firebase/auth'
import { auth, googleProvider } from '../firebase'
import { AuthContext } from './authContext'
import * as Sentry from '@sentry/react'
import { trackEvent, setAnalyticsUser, clearAnalyticsUser } from '../services/analytics'

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

  const signIn = async () => {
    const result = await signInWithPopup(auth, googleProvider)
    trackEvent('sign_in', { method: 'google' })
    // Google sign-in auto-creates accounts — track as conversion for new users
    if (result.user.metadata.creationTime === result.user.metadata.lastSignInTime) {
      trackAdConversion()
    }
  }

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
    await firebaseSignOut(auth)
  }

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signInWithEmail, signUpWithEmail, resetPassword, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}
