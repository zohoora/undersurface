import { useState, useRef, useMemo } from 'react'
import { Capacitor } from '@capacitor/core'
import { useAuth } from '../auth/useAuth'
import PolicyModal from './PolicyModal'
import { useTranslation, SUPPORTED_LANGUAGES } from '../i18n'
import { getSettings, updateSettings } from '../store/settings'
import { useLoginFlow } from './useLoginFlow'

function getSubmitLabel(
  t: Record<string, string>,
  mode: 'signin' | 'signup' | 'reset',
  isSigningIn: boolean,
): string {
  if (isSigningIn) return t['login.pleaseWait']
  if (mode === 'reset') return t['login.reset']
  if (mode === 'signup') return t['login.signUp']
  return t['login.signIn']
}

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
  boxSizing: 'border-box' as const,
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

function DemoEditor() {
  const t = useTranslation()

  return (
    <div className="landing-session-preview" aria-label={t['landing.previewLabel']}>
      <div className="landing-preview-toolbar">
        <span className="active">{t['session.bottomBar.talk']}</span>
        <span>{t['session.bottomBar.journal']}</span>
        <span>{t['session.bottomBar.speak']}</span>
        <span>{t['session.bottomBar.room']}</span>
      </div>
      <div className="landing-preview-message landing-preview-message--writer">{t['landing.previewWriter']}</div>
      <div className="landing-preview-message landing-preview-message--companion">{t['landing.previewCompanion']}</div>
      <div className="landing-preview-thread"><span aria-hidden="true">↳</span>{t['landing.previewThread']}</div>
      <div className="landing-preview-composer">{t['landing.previewComposer']}<span aria-hidden="true">↑</span></div>
      </div>
  )
}

// --- Main component ---

const showAppleSignIn = Capacitor.getPlatform() === 'ios'

export function LoginScreen() {
  const auth = useAuth()
  const t = useTranslation()
  const drivers = useMemo(() => ({
    signIn: auth.signIn,
    signInWithApple: auth.signInWithApple,
    signInWithEmail: auth.signInWithEmail,
    signUpWithEmail: auth.signUpWithEmail,
    resetPassword: auth.resetPassword,
  }), [auth.signIn, auth.signInWithApple, auth.signInWithEmail, auth.signUpWithEmail, auth.resetPassword])
  const messages = useMemo(() => ({ resetSuccess: t['login.resetSuccess'] }), [t])
  const {
    email, setEmail, password, setPassword, mode, error, success, isSigningIn,
    handleGoogleSignIn, handleAppleSignIn, handleEmailSubmit, switchMode,
  } = useLoginFlow(drivers, messages)
  const [policyOpen, setPolicyOpen] = useState<'privacy' | 'disclaimer' | null>(null)
  const authRef = useRef<HTMLDivElement>(null)

  const scrollToAuth = () => {
    authRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  return (
    <div className="landing-page">
      <style>{`
        @keyframes landingFadeIn { from { opacity: 0 } to { opacity: 1 } }
        @keyframes breathe { 0%, 100% { opacity: 0.15 } 50% { opacity: 0.3 } }
        @keyframes cursorBlink { 0%, 100% { opacity: 1 } 50% { opacity: 0 } }
        @keyframes bounceDown { 0%, 100% { transform: translateY(0) } 50% { transform: translateY(4px) } }
      `}</style>

      {/* Subtle breathing circle — shared background */}
      <div className="landing-breath" />

      {/* ─── HERO SECTION ─── */}
      <div className="landing-hero">
        {/* Title */}
        <div className="landing-wordmark">
          UnderSurface
        </div>

        {/* Headline */}
        <div className="landing-headline">
          {t['landing.headline']}
        </div>

        {/* Demo editor */}
        <DemoEditor />

        {/* Feature points */}
        <div className="landing-features">
          {(['landing.feature1', 'landing.feature2', 'landing.feature3'] as const).map(key => (
            <div key={key}>
              <span style={{ color: 'var(--text-ghost)', flexShrink: 0 }}>✦</span>
              <span>{t[key]}</span>
            </div>
          ))}
        </div>

        {/* CTA button */}
        <button
          onClick={() => { switchMode('signup'); scrollToAuth() }}
          className="landing-cta"
        >
          {t['landing.cta']}
        </button>

        <button onClick={() => { switchMode('signin'); scrollToAuth() }} className="landing-signin-link">
          {t['login.alreadyHaveAccount']}
        </button>

        {/* Scroll hint */}
        <div className="landing-scroll-hint">
          ↓
        </div>
      </div>

      {/* ─── AUTH SECTION ─── */}
      <div
        ref={authRef}
        id="auth-section"
        className="landing-auth"
      >
        <div className="landing-auth-card">
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
            whiteSpace: 'pre-line',
          }}>
            {t['login.tagline']}
          </div>

          {/* Language selector */}
          <select
            value={getSettings().language}
            onChange={(e) => updateSettings({ language: e.target.value })}
            style={{
              fontFamily: "'Inter', sans-serif",
              fontSize: 12,
              color: 'var(--text-ghost)',
              background: 'none',
              border: '1px solid var(--border-subtle)',
              borderRadius: 6,
              padding: '4px 8px',
              cursor: 'pointer',
              outline: 'none',
              marginBottom: 8,
            }}
          >
            {SUPPORTED_LANGUAGES.map((lang) => (
              <option key={lang.code} value={lang.code}>{lang.nativeName}</option>
            ))}
          </select>

          {/* Auth form */}
          <form onSubmit={handleEmailSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <input
              type="email"
              placeholder={t['login.email']}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              style={inputStyle}
            />
            {mode !== 'reset' && (
              <input
                type="password"
                placeholder={t['login.password']}
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
              {getSubmitLabel(t, mode, isSigningIn)}
            </button>
            <div style={{
              display: 'flex',
              justifyContent: mode === 'reset' ? 'center' : 'space-between',
              padding: '0 2px',
            }}>
              {mode === 'signin' && (
                <>
                  <button type="button" onClick={() => switchMode('signup')} style={{ ...policyLinkStyle, fontSize: 12, textDecoration: 'none' }}>
                    {t['login.signUp']}
                  </button>
                  <button type="button" onClick={() => switchMode('reset')} style={{ ...policyLinkStyle, fontSize: 12, textDecoration: 'none' }}>
                    {t['login.forgotPassword']}
                  </button>
                </>
              )}
              {mode === 'signup' && (
                <button type="button" onClick={() => switchMode('signin')} style={{ ...policyLinkStyle, fontSize: 12, textDecoration: 'none', width: '100%', textAlign: 'center' }}>
                  {t['login.alreadyHaveAccount']}
                </button>
              )}
              {mode === 'reset' && (
                <button type="button" onClick={() => switchMode('signin')} style={{ ...policyLinkStyle, fontSize: 12, textDecoration: 'none' }}>
                  {t['login.backToSignIn']}
                </button>
              )}
            </div>
          </form>

          {/* Divider */}
          {mode !== 'reset' && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, width: FORM_WIDTH, margin: '4px 0' }}>
                <div style={{ flex: 1, height: 1, background: 'var(--border-subtle)' }} />
                <span style={{ fontFamily: "'Inter', sans-serif", fontSize: 11, color: 'var(--text-ghost)' }}>{t['login.or']}</span>
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
                {t['login.signInWithGoogle']}
              </button>

              {showAppleSignIn && (
                <button
                  onClick={handleAppleSignIn}
                  disabled={isSigningIn}
                  style={{
                    fontFamily: "'Inter', sans-serif",
                    fontSize: 14,
                    padding: '10px 24px',
                    border: 'none',
                    borderRadius: 8,
                    background: '#000',
                    color: '#fff',
                    cursor: isSigningIn ? 'wait' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                    opacity: isSigningIn ? 0.6 : 1,
                    width: FORM_WIDTH,
                  }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="#fff" aria-hidden="true">
                    <path d="M16.365 1.43c0 1.14-.493 2.27-1.177 3.08-.744.9-1.99 1.57-2.987 1.57-.12-1.06.396-2.18 1.103-2.95.825-.9 2.124-1.6 3.061-1.7zm4.565 17.18c-.622 1.456-.92 2.105-1.722 3.39-1.121 1.793-2.7 4.026-4.66 4.05-1.74.022-2.187-1.135-4.55-1.122-2.362.013-2.853 1.143-4.595 1.122-1.96-.024-3.456-2.04-4.577-3.832-3.13-5.012-3.46-10.892-1.527-14.022 1.373-2.222 3.541-3.521 5.578-3.521 2.073 0 3.376 1.135 5.092 1.135 1.665 0 2.679-1.137 5.075-1.137 1.812 0 3.731.987 5.097 2.692-4.479 2.452-3.749 8.872 1.789 11.245z"/>
                  </svg>
                  Sign in with Apple
                </button>
              )}
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
              {t['login.privacyPolicy']}
            </button>
            <button onClick={() => setPolicyOpen('disclaimer')} style={policyLinkStyle}>
              {t['login.disclaimer']}
            </button>
          </div>
          <PolicyModal
            isOpen={policyOpen !== null}
            onClose={() => setPolicyOpen(null)}
            initialSection={policyOpen ?? undefined}
          />
        </div>
      </div>
    </div>
  )
}
