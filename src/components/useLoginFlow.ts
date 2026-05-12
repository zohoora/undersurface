import { useCallback, useState } from 'react'
import { trackEvent } from '../services/analytics'

// Firebase error messages are shaped like "Firebase: Error (auth/wrong-password)."
// — strip the wrapping so the surface looks human. Falls back to the raw
// message if no parens are found.
function cleanFirebaseError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  const match = msg.match(/\(([^)]+)\)/)
  return match ? match[1].replace('auth/', '').replace(/-/g, ' ') : msg
}

export type LoginMode = 'signin' | 'signup' | 'reset'

export interface LoginFlowDrivers {
  signIn: () => Promise<void>
  signInWithApple: () => Promise<void>
  signInWithEmail: (email: string, password: string) => Promise<void>
  signUpWithEmail: (email: string, password: string) => Promise<void>
  resetPassword: (email: string) => Promise<void>
}

export interface LoginFlowMessages {
  resetSuccess: string
}

// Owns the state + side-effects of the LoginScreen's auth flow. Extracted so
// the mode-branched submit (signin/signup/reset), the isSigningIn lifecycle,
// and the error/success message handling can be tested without rendering the
// 600-line hero/landing JSX in LoginScreen.tsx.
export function useLoginFlow(drivers: LoginFlowDrivers, messages: LoginFlowMessages) {
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [isSigningIn, setIsSigningIn] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState<LoginMode>('signin')

  const runSocialSignIn = useCallback(async (method: 'google' | 'apple', driver: () => Promise<void>) => {
    setError(null)
    setSuccess(null)
    setIsSigningIn(true)
    try {
      await driver()
    } catch (err) {
      trackEvent('auth_error', { method })
      setError(err instanceof Error ? err.message : 'Sign-in failed')
    } finally {
      setIsSigningIn(false)
    }
  }, [])

  const handleGoogleSignIn = useCallback(
    () => runSocialSignIn('google', drivers.signIn),
    [drivers.signIn, runSocialSignIn],
  )
  const handleAppleSignIn = useCallback(
    () => runSocialSignIn('apple', drivers.signInWithApple),
    [drivers.signInWithApple, runSocialSignIn],
  )

  const handleEmailSubmit = useCallback(async (e?: { preventDefault?: () => void }) => {
    e?.preventDefault?.()
    setError(null)
    setSuccess(null)
    setIsSigningIn(true)
    trackEvent('auth_form_submitted', { mode })
    try {
      if (mode === 'reset') {
        await drivers.resetPassword(email)
        setSuccess(messages.resetSuccess)
        setMode('signin')
      } else if (mode === 'signup') {
        await drivers.signUpWithEmail(email, password)
      } else {
        await drivers.signInWithEmail(email, password)
      }
    } catch (err) {
      trackEvent('auth_error', { method: 'email', mode })
      setError(cleanFirebaseError(err))
    } finally {
      setIsSigningIn(false)
    }
  }, [mode, email, password, drivers, messages.resetSuccess])

  const switchMode = useCallback((next: LoginMode) => {
    setMode(next)
    setError(null)
    setSuccess(null)
  }, [])

  return {
    email,
    setEmail,
    password,
    setPassword,
    mode,
    error,
    success,
    isSigningIn,
    handleGoogleSignIn,
    handleAppleSignIn,
    handleEmailSubmit,
    switchMode,
  }
}
