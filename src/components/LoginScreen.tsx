import { useState, useEffect, useRef, useCallback } from 'react'
import { useAuth } from '../auth/useAuth'
import PolicyModal from './PolicyModal'
import { useTranslation, SUPPORTED_LANGUAGES } from '../i18n'
import { getSettings, updateSettings } from '../store/settings'
import { trackEvent } from '../services/analytics'

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

// --- Demo content ---

interface Demo {
  text: string
  partName: string
  partColor: string
  thought: string
}

const DEMOS: Demo[] = [
  {
    text: 'I smiled and said it was fine. But driving home, my hands were shaking on the wheel...',
    partName: 'The Watcher',
    partColor: '#5A7F94',
    thought: "You\u2019re noticing the gap between what you showed them and what was actually happening inside.",
  },
  {
    text: 'Every time something good starts, I find a way to ruin it. I did it again last week...',
    partName: 'The Tender One',
    partColor: '#B58548',
    thought: "What if that\u2019s not you ruining things \u2014 but a part of you trying to leave before it gets left?",
  },
  {
    text: 'I drove past her house today. The garden looks different now. Someone painted the door red...',
    partName: 'The Weaver',
    partColor: '#7E6BA0',
    thought: "You\u2019re still mapping the world by where she used to be.",
  },
  {
    text: "I can\u2019t stop running through tomorrow\u2019s conversation in my head. Every version ends badly...",
    partName: 'The Still',
    partColor: '#628E66',
    thought: "You\u2019re not in that room yet. You\u2019re here, writing. Stay a moment.",
  },
  {
    text: 'I keep almost saying it. At dinner, in the car, last night before bed. The words are right there...',
    partName: 'The Spark',
    partColor: '#A06A7A',
    thought: "The words are ready. Maybe you\u2019re not looking for courage \u2014 you\u2019re looking for permission you already have.",
  },
]

// --- Typing animation ---

const CHAR_DELAY = 40
const PAUSE_AFTER_TYPING = 800
const THOUGHT_HOLD = 4000
const FADE_DURATION = 600
const RESET_DELAY = 1000

function useDemoCarousel() {
  const [demoIndex, setDemoIndex] = useState(0)
  const [charIndex, setCharIndex] = useState(0)
  const [phase, setPhase] = useState<'typing' | 'paused' | 'thought' | 'fadeout' | 'reset'>('typing')
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const demo = DEMOS[demoIndex]

  const cleanup = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    if (intervalRef.current) clearInterval(intervalRef.current)
  }, [])

  useEffect(() => {
    cleanup()

    if (phase === 'typing') {
      intervalRef.current = setInterval(() => {
        setCharIndex(prev => {
          if (prev >= demo.text.length) {
            if (intervalRef.current) clearInterval(intervalRef.current)
            setPhase('paused')
            return prev
          }
          return prev + 1
        })
      }, CHAR_DELAY)
    } else if (phase === 'paused') {
      timerRef.current = setTimeout(() => setPhase('thought'), PAUSE_AFTER_TYPING)
    } else if (phase === 'thought') {
      timerRef.current = setTimeout(() => setPhase('fadeout'), THOUGHT_HOLD)
    } else if (phase === 'fadeout') {
      timerRef.current = setTimeout(() => setPhase('reset'), FADE_DURATION)
    } else if (phase === 'reset') {
      timerRef.current = setTimeout(() => {
        setDemoIndex(prev => (prev + 1) % DEMOS.length)
        setCharIndex(0)
        setPhase('typing')
      }, RESET_DELAY)
    }

    return cleanup
  }, [phase, demo.text.length, cleanup])

  useEffect(() => cleanup, [cleanup])

  return {
    demo,
    displayText: demo.text.slice(0, charIndex),
    showCursor: phase === 'typing' || phase === 'paused',
    showThought: phase === 'thought' || phase === 'fadeout',
    isFadingOut: phase === 'fadeout' || phase === 'reset',
  }
}

function DemoEditor() {
  const { demo, displayText, showCursor, showThought, isFadingOut } = useDemoCarousel()

  return (
    <div style={{
      width: '100%',
      maxWidth: 420,
      opacity: isFadingOut ? 0 : 1,
      transition: `opacity ${FADE_DURATION}ms ease`,
    }}>
      {/* Simulated editor box */}
      <div style={{
        background: 'var(--bg-warm)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 12,
        padding: '20px 24px',
        minHeight: 160,
        position: 'relative',
      }}>
        {/* Typed text */}
        <div style={{
          fontFamily: "'Spectral', serif",
          fontSize: 16,
          lineHeight: 1.7,
          color: 'var(--text-primary)',
        }}>
          {displayText}
          {showCursor && (
            <span style={{
              display: 'inline-block',
              width: 1.5,
              height: '1.1em',
              background: 'var(--text-primary)',
              marginLeft: 1,
              verticalAlign: 'text-bottom',
              animation: 'cursorBlink 1.06s step-end infinite',
            }} />
          )}
        </div>

        {/* Thought bubble */}
        <div style={{
          marginTop: 16,
          borderLeft: `3px solid ${demo.partColor}`,
          background: `${demo.partColor}15`,
          borderRadius: '0 8px 8px 0',
          padding: '12px 16px',
          opacity: showThought ? 1 : 0,
          transform: showThought ? 'translateY(0)' : 'translateY(8px)',
          transition: 'opacity 600ms ease, transform 600ms ease',
        }}>
          <div style={{
            fontFamily: "'Inter', sans-serif",
            fontSize: 11,
            fontWeight: 600,
            textTransform: 'uppercase' as const,
            letterSpacing: '0.05em',
            color: demo.partColor,
            marginBottom: 6,
          }}>
            {demo.partName}
          </div>
          <div style={{
            fontFamily: "'Inter', sans-serif",
            fontSize: 14,
            lineHeight: 1.6,
            color: 'var(--text-secondary)',
          }}>
            {demo.thought}
          </div>
        </div>
      </div>
    </div>
  )
}

// --- Main component ---

export function LoginScreen() {
  const { signIn, signInWithEmail, signUpWithEmail, resetPassword } = useAuth()
  const t = useTranslation()
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [isSigningIn, setIsSigningIn] = useState(false)
  const [policyOpen, setPolicyOpen] = useState<'privacy' | 'disclaimer' | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState<'signin' | 'signup' | 'reset'>('signin')
  const authRef = useRef<HTMLDivElement>(null)

  const handleGoogleSignIn = async () => {
    setError(null)
    setSuccess(null)
    setIsSigningIn(true)
    try {
      await signIn()
    } catch (err) {
      trackEvent('auth_error', { method: 'google' })
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
    trackEvent('auth_form_submitted', { mode })
    try {
      if (mode === 'reset') {
        await resetPassword(email)
        setSuccess(t['login.resetSuccess'])
        setMode('signin')
      } else if (mode === 'signup') {
        await signUpWithEmail(email, password)
      } else {
        await signInWithEmail(email, password)
      }
    } catch (err) {
      trackEvent('auth_error', { method: 'email', mode })
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

  const scrollToAuth = () => {
    authRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      display: 'flex',
      flexDirection: 'column',
      background: 'var(--bg-primary)',
      overflow: 'auto',
      animation: 'landingFadeIn 1s ease-out',
    }}>
      <style>{`
        @keyframes landingFadeIn { from { opacity: 0 } to { opacity: 1 } }
        @keyframes breathe { 0%, 100% { opacity: 0.15 } 50% { opacity: 0.3 } }
        @keyframes cursorBlink { 0%, 100% { opacity: 1 } 50% { opacity: 0 } }
        @keyframes bounceDown { 0%, 100% { transform: translateY(0) } 50% { transform: translateY(4px) } }
      `}</style>

      {/* Subtle breathing circle — shared background */}
      <div style={{
        position: 'fixed',
        width: 300,
        height: 300,
        borderRadius: '50%',
        background: 'radial-gradient(circle, var(--text-ghost) 0%, transparent 70%)',
        opacity: 0.08,
        animation: 'breathe 8s ease-in-out infinite',
        pointerEvents: 'none',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
      }} />

      {/* ─── HERO SECTION ─── */}
      <div style={{
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '40px 24px',
        position: 'relative',
        zIndex: 1,
        gap: 32,
      }}>
        {/* Title */}
        <div style={{
          fontFamily: "'Spectral', serif",
          fontSize: 42,
          fontWeight: 400,
          color: 'var(--text-primary)',
          letterSpacing: '0.02em',
        }}>
          UnderSurface
        </div>

        {/* Headline */}
        <div style={{
          fontFamily: "'Inter', sans-serif",
          fontSize: 18,
          color: 'var(--text-secondary)',
          textAlign: 'center',
          marginTop: -16,
        }}>
          {t['landing.headline']}
        </div>

        {/* Demo editor */}
        <DemoEditor />

        {/* Feature points */}
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          maxWidth: 400,
        }}>
          {(['landing.feature1', 'landing.feature2', 'landing.feature3'] as const).map(key => (
            <div key={key} style={{
              fontFamily: "'Inter', sans-serif",
              fontSize: 14,
              lineHeight: 1.5,
              color: 'var(--text-secondary)',
              display: 'flex',
              gap: 10,
            }}>
              <span style={{ color: 'var(--text-ghost)', flexShrink: 0 }}>✦</span>
              <span>{t[key]}</span>
            </div>
          ))}
        </div>

        {/* CTA button */}
        <button
          onClick={scrollToAuth}
          style={{
            fontFamily: "'Inter', sans-serif",
            fontSize: 16,
            padding: '14px 36px',
            border: 'none',
            borderRadius: 10,
            background: 'var(--text-primary)',
            color: 'var(--bg-primary)',
            cursor: 'pointer',
            letterSpacing: '0.01em',
          }}
        >
          {t['landing.cta']}
        </button>

        {/* Scroll hint */}
        <div style={{
          position: 'absolute',
          bottom: 24,
          left: '50%',
          transform: 'translateX(-50%)',
          animation: 'bounceDown 2s ease-in-out infinite',
          color: 'var(--text-ghost)',
          fontSize: 20,
          opacity: 0.5,
        }}>
          ↓
        </div>
      </div>

      {/* ─── AUTH SECTION ─── */}
      <div
        ref={authRef}
        id="auth-section"
        style={{
          minHeight: '100dvh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '40px 20px',
          position: 'relative',
          zIndex: 1,
        }}
      >
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 16,
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
              {isSigningIn ? t['login.pleaseWait'] : mode === 'reset' ? t['login.reset'] : mode === 'signup' ? t['login.signUp'] : t['login.signIn']}
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
