import { useState } from 'react'
import { useAuth } from '../auth/useAuth'
import PolicyModal from './PolicyModal'

const FORM_WIDTH = 280

const inputStyle = {
  fontFamily: "'Inter', sans-serif",
  fontSize: 14,
  padding: '10px 14px',
  border: '1px solid var(--border-subtle)',
  borderRadius: 8,
  background: 'var(--surface-primary)',
  color: 'var(--text-primary)',
  width: FORM_WIDTH,
  outline: 'none',
}

const policyLinkStyle = {
  fontFamily: "'Inter', sans-serif",
  fontSize: 11,
  color: 'var(--text-ghost)',
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  textDecoration: 'underline',
  textUnderlineOffset: 3,
} as const

function cleanFirebaseError(err: unknown): string {
  const message = err instanceof Error ? err.message : 'Sign-in failed'
  return message.replace('Firebase: ', '').replace(/\(auth\/.*\)/, '').trim()
}

export function LoginScreen() {
  const { signIn, signInWithEmail, signUpWithEmail, resetPassword } = useAuth()
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [isSigningIn, setIsSigningIn] = useState(false)
  const [policyOpen, setPolicyOpen] = useState<'privacy' | 'disclaimer' | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState<'signin' | 'signup' | 'reset'>('signin')

  const handleGoogleSignIn = async () => {
    setError(null)
    setSuccess(null)
    setIsSigningIn(true)
    try {
      await signIn()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed')
    } finally {
      setIsSigningIn(false)
    }
  }

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSuccess(null)
    setIsSigningIn(true)
    try {
      if (mode === 'reset') {
        await resetPassword(email)
        setSuccess('Password reset email sent. Check your inbox.')
        setMode('signin')
      } else if (mode === 'signup') {
        await signUpWithEmail(email, password)
      } else {
        await signInWithEmail(email, password)
      }
    } catch (err) {
      setError(cleanFirebaseError(err))
    } finally {
      setIsSigningIn(false)
    }
  }

  const switchMode = (newMode: 'signin' | 'signup' | 'reset') => {
    setMode(newMode)
    setError(null)
    setSuccess(null)
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
      overflow: 'auto',
      animation: 'landingFadeIn 1s ease-out',
    }}>
      <style>{`
        @keyframes landingFadeIn { from { opacity: 0 } to { opacity: 1 } }
        @keyframes breathe { 0%, 100% { opacity: 0.15 } 50% { opacity: 0.3 } }
      `}</style>

      {/* Subtle breathing circle */}
      <div style={{
        position: 'fixed',
        width: 300,
        height: 300,
        borderRadius: '50%',
        background: 'radial-gradient(circle, var(--text-ghost) 0%, transparent 70%)',
        opacity: 0.08,
        animation: 'breathe 8s ease-in-out infinite',
        pointerEvents: 'none',
      }} />

      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 16,
        padding: '40px 20px',
        position: 'relative',
        zIndex: 1,
      }}>
        {/* Title */}
        <div style={{
          fontFamily: "'Spectral', serif",
          fontSize: 36,
          fontWeight: 400,
          color: 'var(--text-primary)',
          letterSpacing: '0.02em',
          marginBottom: 4,
        }}>
          UnderSurface
        </div>

        {/* Poetic description */}
        <div style={{
          fontFamily: "'Spectral', serif",
          fontSize: 16,
          fontStyle: 'italic',
          color: 'var(--text-secondary)',
          maxWidth: 340,
          textAlign: 'center',
          lineHeight: 1.7,
          marginBottom: 24,
        }}>
          Write freely. When you pause,
          <br />
          an inner voice stirs &mdash;
          <br />
          not to judge, but to sit beside you
          <br />
          in the words.
        </div>

        {/* Auth form */}
        <form onSubmit={handleEmailSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            style={inputStyle}
          />
          {mode !== 'reset' && (
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              style={inputStyle}
            />
          )}
          <button
            type="submit"
            disabled={isSigningIn}
            style={{
              fontFamily: "'Inter', sans-serif",
              fontSize: 14,
              padding: '10px 24px',
              border: 'none',
              borderRadius: 8,
              background: 'var(--text-primary)',
              color: 'var(--bg-primary)',
              cursor: isSigningIn ? 'wait' : 'pointer',
              opacity: isSigningIn ? 0.6 : 1,
              width: FORM_WIDTH,
            }}
          >
            {isSigningIn ? 'Please wait...' : mode === 'reset' ? 'Send reset link' : mode === 'signup' ? 'Create account' : 'Sign in'}
          </button>
          <div style={{
            display: 'flex',
            justifyContent: mode === 'reset' ? 'center' : 'space-between',
            padding: '0 2px',
          }}>
            {mode === 'signin' && (
              <>
                <button type="button" onClick={() => switchMode('signup')} style={{ ...policyLinkStyle, fontSize: 12, textDecoration: 'none' }}>
                  Create account
                </button>
                <button type="button" onClick={() => switchMode('reset')} style={{ ...policyLinkStyle, fontSize: 12, textDecoration: 'none' }}>
                  Forgot password?
                </button>
              </>
            )}
            {mode === 'signup' && (
              <button type="button" onClick={() => switchMode('signin')} style={{ ...policyLinkStyle, fontSize: 12, textDecoration: 'none', width: '100%', textAlign: 'center' }}>
                Already have an account? Sign in
              </button>
            )}
            {mode === 'reset' && (
              <button type="button" onClick={() => switchMode('signin')} style={{ ...policyLinkStyle, fontSize: 12, textDecoration: 'none' }}>
                Back to sign in
              </button>
            )}
          </div>
        </form>

        {/* Divider */}
        {mode !== 'reset' && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, width: FORM_WIDTH, margin: '4px 0' }}>
              <div style={{ flex: 1, height: 1, background: 'var(--border-subtle)' }} />
              <span style={{ fontFamily: "'Inter', sans-serif", fontSize: 11, color: 'var(--text-ghost)' }}>or</span>
              <div style={{ flex: 1, height: 1, background: 'var(--border-subtle)' }} />
            </div>

            <button
              onClick={handleGoogleSignIn}
              disabled={isSigningIn}
              style={{
                fontFamily: "'Inter', sans-serif",
                fontSize: 14,
                padding: '10px 24px',
                border: '1px solid var(--border-subtle)',
                borderRadius: 8,
                background: 'var(--surface-primary)',
                color: 'var(--text-primary)',
                cursor: isSigningIn ? 'wait' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                opacity: isSigningIn ? 0.6 : 1,
                width: FORM_WIDTH,
              }}
            >
              <svg width="18" height="18" viewBox="0 0 48 48">
                <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
                <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
                <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
                <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
              </svg>
              Sign in with Google
            </button>
          </>
        )}

        {/* Messages */}
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
        {success && (
          <div style={{
            fontFamily: "'Inter', sans-serif",
            fontSize: 12,
            color: 'var(--text-secondary)',
            maxWidth: 300,
            textAlign: 'center',
          }}>
            {success}
          </div>
        )}

        {/* Policy links */}
        <div style={{ display: 'flex', gap: 16, marginTop: 12 }}>
          <button onClick={() => setPolicyOpen('privacy')} style={policyLinkStyle}>
            Privacy Policy
          </button>
          <button onClick={() => setPolicyOpen('disclaimer')} style={policyLinkStyle}>
            Disclaimer
          </button>
        </div>
        <PolicyModal
          isOpen={policyOpen !== null}
          onClose={() => setPolicyOpen(null)}
          initialSection={policyOpen ?? undefined}
        />
      </div>
    </div>
  )
}
