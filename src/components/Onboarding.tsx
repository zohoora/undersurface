import { useState } from 'react'
import { db } from '../store/db'
import PolicyModal from './PolicyModal'
import { useTranslation } from '../i18n'

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
  const t = useTranslation()
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
            <div style={headingStyle}>{t['onboarding.welcome']}</div>
            <div style={{ ...bodyStyle, maxWidth: 340 }}>
              {t['onboarding.step1.body']}
            </div>
            <button onClick={() => setStep(2)} style={primaryButtonStyle}>
              {t['onboarding.step1.button']}
            </button>
          </>
        )}

        {step === 2 && (
          <>
            <div style={headingStyle}>{t['onboarding.step2.title']}</div>
            <div style={bodyStyle}>
              {t['onboarding.step2.body1']}
            </div>
            <div style={bodyStyle}>
              {t['onboarding.step2.body2']}
            </div>
            <button onClick={() => setStep(3)} style={primaryButtonStyle}>
              {t['onboarding.step2.button']}
            </button>
            <button onClick={() => setStep(1)} style={backButtonStyle}>
              {t['onboarding.back']}
            </button>
          </>
        )}

        {step === 3 && (
          <>
            <div style={headingStyle}>{t['onboarding.step3.title']}</div>
            <div style={bodyStyle}>
              {t['onboarding.step3.body']}
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
                {t['onboarding.step3.disclaimer']}
              </label>
              <label style={checkboxLabelStyle}>
                <input
                  type="checkbox"
                  checked={privacyChecked}
                  onChange={(e) => setPrivacyChecked(e.target.checked)}
                  style={checkboxStyle}
                />
                <span>
                  {t['onboarding.step3.privacy']}{' '}
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
                    {t['onboarding.step3.privacyLink']}
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
              {saving ? t['onboarding.step3.starting'] : t['onboarding.step3.begin']}
            </button>
            <button onClick={() => setStep(2)} style={backButtonStyle}>
              {t['onboarding.back']}
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
