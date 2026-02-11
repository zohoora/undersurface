import { useState } from 'react'
import { useAuth } from '../auth/useAuth'
import { PolicyModal } from './PolicyModal'

export function LoginScreen() {
  const { signIn, signInWithApple } = useAuth()
  const [error, setError] = useState<string | null>(null)
  const [isSigningIn, setIsSigningIn] = useState(false)
  const [policyOpen, setPolicyOpen] = useState<'privacy' | 'disclaimer' | null>(null)

  const handleGoogleSignIn = async () => {
    setError(null)
    setIsSigningIn(true)
    try {
      await signIn()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed')
    } finally {
      setIsSigningIn(false)
    }
  }

  const handleAppleSignIn = async () => {
    setError(null)
    setIsSigningIn(true)
    try {
      await signInWithApple()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed')
    } finally {
      setIsSigningIn(false)
    }
  }

  const buttonStyle = {
    fontFamily: "'Inter', sans-serif",
    fontSize: 14,
    padding: '10px 24px',
    border: '1px solid var(--border-subtle)',
    borderRadius: 8,
    background: 'var(--surface-primary)',
    color: 'var(--text-primary)',
    cursor: isSigningIn ? 'wait' as const : 'pointer' as const,
    display: 'flex' as const,
    alignItems: 'center' as const,
    gap: 8,
    opacity: isSigningIn ? 0.6 : 1,
    width: 220,
    justifyContent: 'center' as const,
  }

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--bg-primary)',
      gap: 24,
    }}>
      <div style={{
        fontFamily: "'Spectral', serif",
        fontSize: 28,
        fontWeight: 400,
        color: 'var(--text-primary)',
        letterSpacing: '0.02em',
      }}>
        UnderSurface
      </div>
      <div style={{
        fontFamily: "'Inter', sans-serif",
        fontSize: 13,
        color: 'var(--text-ghost)',
        maxWidth: 280,
        textAlign: 'center',
        lineHeight: 1.5,
      }}>
        A diary where inner voices respond as you write
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 }}>
        <button
          onClick={handleGoogleSignIn}
          disabled={isSigningIn}
          style={buttonStyle}
        >
          <svg width="18" height="18" viewBox="0 0 48 48">
            <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
            <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
            <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
            <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
          </svg>
          {isSigningIn ? 'Signing in...' : 'Sign in with Google'}
        </button>
        <button
          onClick={handleAppleSignIn}
          disabled={isSigningIn}
          style={buttonStyle}
        >
          <svg width="18" height="18" viewBox="0 0 24 24">
            <path fill="currentColor" d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/>
          </svg>
          {isSigningIn ? 'Signing in...' : 'Sign in with Apple'}
        </button>
      </div>
      {error && (
        <div style={{
          fontFamily: "'Inter', sans-serif",
          fontSize: 12,
          color: 'var(--color-tender)',
          maxWidth: 300,
          textAlign: 'center',
        }}>
          {error}
        </div>
      )}
      <div style={{
        display: 'flex',
        gap: 16,
        marginTop: 8,
      }}>
        <button
          onClick={() => setPolicyOpen('privacy')}
          style={{
            fontFamily: "'Inter', sans-serif",
            fontSize: 11,
            color: 'var(--text-ghost)',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            textDecoration: 'underline',
            textUnderlineOffset: 3,
          }}
        >
          Privacy Policy
        </button>
        <button
          onClick={() => setPolicyOpen('disclaimer')}
          style={{
            fontFamily: "'Inter', sans-serif",
            fontSize: 11,
            color: 'var(--text-ghost)',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            textDecoration: 'underline',
            textUnderlineOffset: 3,
          }}
        >
          Disclaimer
        </button>
      </div>
      <PolicyModal
        isOpen={policyOpen !== null}
        onClose={() => setPolicyOpen(null)}
        initialSection={policyOpen ?? undefined}
      />
    </div>
  )
}
