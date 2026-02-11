import { useState } from 'react'
import { db } from '../store/db'
import PolicyModal from './PolicyModal'

const headingStyle = {
  fontFamily: "'Spectral', serif",
  fontSize: 24,
  color: 'var(--text-primary)',
} as const

const bodyStyle = {
  fontFamily: "'Inter', sans-serif",
  fontSize: 13,
  color: 'var(--text-secondary)',
  textAlign: 'center',
  lineHeight: 1.7,
  maxWidth: 360,
} as const

const primaryButtonStyle = {
  width: '100%',
  padding: '10px 20px',
  fontFamily: "'Inter', sans-serif",
  fontSize: 14,
  border: '1px solid var(--border-subtle)',
  borderRadius: 8,
  background: 'var(--text-primary)',
  color: 'var(--bg-primary)',
  cursor: 'pointer',
} as const

const backButtonStyle = {
  fontFamily: "'Inter', sans-serif",
  fontSize: 12,
  color: 'var(--text-ghost)',
  background: 'none',
  border: 'none',
  cursor: 'pointer',
} as const

const checkboxLabelStyle = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 10,
  cursor: 'pointer',
  fontFamily: "'Inter', sans-serif",
  fontSize: 13,
  color: 'var(--text-secondary)',
  lineHeight: 1.5,
} as const

const checkboxStyle = {
  marginTop: 3,
  flexShrink: 0,
  accentColor: 'var(--color-still)',
} as const

interface OnboardingProps {
  onComplete: () => void
}

export function Onboarding({ onComplete }: OnboardingProps) {
  const [step, setStep] = useState(1)
  const [disclaimerChecked, setDisclaimerChecked] = useState(false)
  const [privacyChecked, setPrivacyChecked] = useState(false)
  const [policyOpen, setPolicyOpen] = useState(false)
  const [saving, setSaving] = useState(false)

  const canFinish = disclaimerChecked && privacyChecked

  const handleComplete = async () => {
    if (!canFinish || saving) return
    setSaving(true)
    try {
      await db.consent.add({
        id: 'terms',
        acceptedAt: Date.now(),
        acceptedVersion: '1.0',
        disclaimerAccepted: true,
        privacyAccepted: true,
      })
      onComplete()
    } catch (err) {
      console.error('Failed to save consent:', err)
      setSaving(false)
    }
  }

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--bg-primary)',
    }}>
      <div style={{
        maxWidth: 420,
        padding: 32,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 20,
      }}>
        {step === 1 && (
          <>
            <div style={headingStyle}>Welcome to UnderSurface</div>
            <div style={{ ...bodyStyle, maxWidth: 340 }}>
              This is a diary — but not just a diary. As you write, inner voices will appear on
              the page. They notice what you're writing about, and they respond — gently, honestly,
              sometimes in ways you don't expect.
            </div>
            <button onClick={() => setStep(2)} style={primaryButtonStyle}>
              How does it work?
            </button>
          </>
        )}

        {step === 2 && (
          <>
            <div style={headingStyle}>Your inner voices</div>
            <div style={bodyStyle}>
              As you write, different voices may appear — The Watcher, The Tender One, The Still
              Point, and others. Each notices different things: patterns in your words, emotions
              beneath the surface, what you might be avoiding.
            </div>
            <div style={bodyStyle}>
              They learn from your writing and evolve over time. They're not therapists — they're
              companions to the writing process.
            </div>
            <button onClick={() => setStep(3)} style={primaryButtonStyle}>
              One more thing
            </button>
            <button onClick={() => setStep(1)} style={backButtonStyle}>
              Back
            </button>
          </>
        )}

        {step === 3 && (
          <>
            <div style={headingStyle}>Before you begin</div>
            <div style={bodyStyle}>
              UnderSurface is a writing tool, not a therapeutic service. The inner voices are AI
              writing companions — they're not therapists, and they can't replace professional care.
            </div>

            <div style={{
              width: '100%',
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
              padding: '4px 0',
            }}>
              <label style={checkboxLabelStyle}>
                <input
                  type="checkbox"
                  checked={disclaimerChecked}
                  onChange={(e) => setDisclaimerChecked(e.target.checked)}
                  style={checkboxStyle}
                />
                I understand this is not a therapeutic service
              </label>
              <label style={checkboxLabelStyle}>
                <input
                  type="checkbox"
                  checked={privacyChecked}
                  onChange={(e) => setPrivacyChecked(e.target.checked)}
                  style={checkboxStyle}
                />
                <span>
                  I've read and accept the{' '}
                  <button
                    onClick={(e) => { e.preventDefault(); setPolicyOpen(true) }}
                    style={{
                      fontFamily: "'Inter', sans-serif",
                      fontSize: 13,
                      color: 'var(--color-still)',
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      textDecoration: 'underline',
                      textUnderlineOffset: 3,
                      padding: 0,
                    }}
                  >
                    Privacy Policy
                  </button>
                </span>
              </label>
            </div>

            <button
              onClick={handleComplete}
              disabled={!canFinish || saving}
              style={{
                ...primaryButtonStyle,
                background: canFinish ? 'var(--text-primary)' : 'var(--border-light)',
                color: canFinish ? 'var(--bg-primary)' : 'var(--text-ghost)',
                cursor: canFinish ? 'pointer' : 'default',
                opacity: saving ? 0.6 : 1,
              }}
            >
              {saving ? 'Starting...' : 'Begin writing'}
            </button>
            <button onClick={() => setStep(2)} style={backButtonStyle}>
              Back
            </button>
          </>
        )}

        {/* Step indicator */}
        <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
          {[1, 2, 3].map((s) => (
            <div
              key={s}
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: s === step ? 'var(--text-secondary)' : 'var(--border-subtle)',
                transition: 'background 0.3s ease',
              }}
            />
          ))}
        </div>
      </div>

      <PolicyModal isOpen={policyOpen} onClose={() => setPolicyOpen(false)} />
    </div>
  )
}
