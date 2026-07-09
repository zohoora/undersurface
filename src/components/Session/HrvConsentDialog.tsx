import { useState, useRef } from 'react'
import { db } from '../../store/db'
import { useModalA11y } from '../../hooks/useModalA11y'
import type { CameraHrvConsent } from '../../types'
import { useTranslation } from '../../i18n'

interface Props {
  onAccept: () => void
  onDecline: () => void
}

export function HrvConsentDialog({ onAccept, onDecline }: Props) {
  const t = useTranslation()
  const [cameraAccepted, setCameraAccepted] = useState(false)
  const [biometricAccepted, setBiometricAccepted] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  useModalA11y(panelRef, onDecline)

  const canAccept = cameraAccepted && biometricAccepted

  const handleAccept = async () => {
    const consent: CameraHrvConsent = {
      id: 'camera-hrv',
      acceptedAt: Date.now(),
      acceptedVersion: '1.0',
      cameraAccepted: true,
      biometricDataAccepted: true,
    }
    await db.consent.add(consent)
    onAccept()
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.5)',
        zIndex: 1100,
        padding: '16px',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onDecline() }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="hrv-consent-title"
        tabIndex={-1}
        style={{
          background: 'var(--bg-primary)',
          borderRadius: 16,
          padding: 'clamp(20px, 5vw, 32px)',
          maxWidth: 480,
          width: '100%',
          boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
        }}
      >
        <h3
          id="hrv-consent-title"
          style={{
            margin: '0 0 12px',
            fontFamily: "'Inter', sans-serif",
            fontSize: 18,
            fontWeight: 600,
            color: 'var(--text-primary)',
          }}
        >
          {t['biometric.camera.title']}
        </h3>

        <p style={{
          fontFamily: "'Inter', sans-serif",
          fontSize: 14,
          lineHeight: 1.6,
          color: 'var(--text-secondary)',
          marginBottom: 20,
        }}>
          {t['biometric.camera.body']}
        </p>

        <label style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 12,
          marginBottom: 12,
          cursor: 'pointer',
          fontFamily: "'Inter', sans-serif",
          fontSize: 14,
          color: 'var(--text-primary)',
          padding: '8px 0',
          WebkitTapHighlightColor: 'transparent',
        }}>
          <input
            type="checkbox"
            checked={cameraAccepted}
            onChange={e => setCameraAccepted(e.target.checked)}
            style={{ marginTop: 2, width: 18, height: 18, flexShrink: 0 }}
          />
          {t['biometric.camera.permission']}
        </label>

        <label style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 12,
          marginBottom: 20,
          cursor: 'pointer',
          fontFamily: "'Inter', sans-serif",
          fontSize: 14,
          color: 'var(--text-primary)',
          padding: '8px 0',
          WebkitTapHighlightColor: 'transparent',
        }}>
          <input
            type="checkbox"
            checked={biometricAccepted}
            onChange={e => setBiometricAccepted(e.target.checked)}
            style={{ marginTop: 2, width: 18, height: 18, flexShrink: 0 }}
          />
          {t['biometric.data.permission']}
        </label>

        <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
          <button
            onClick={onDecline}
            style={{
              padding: '10px 20px',
              border: '1px solid var(--border-subtle)',
              borderRadius: 8,
              background: 'transparent',
              color: 'var(--text-secondary)',
              fontFamily: "'Inter', sans-serif",
              fontSize: 14,
              cursor: 'pointer',
              minHeight: 44,
            }}
          >
            {t['biometric.notNow']}
          </button>
          <button
            onClick={handleAccept}
            disabled={!canAccept}
            style={{
              padding: '10px 20px',
              border: 'none',
              borderRadius: 8,
              background: canAccept ? 'var(--accent-primary, #6b8f71)' : 'var(--border-subtle)',
              color: canAccept ? '#fff' : 'var(--text-tertiary)',
              fontFamily: "'Inter', sans-serif",
              fontSize: 14,
              fontWeight: 600,
              cursor: canAccept ? 'pointer' : 'default',
              opacity: canAccept ? 1 : 0.6,
              minHeight: 44,
            }}
          >
            {t['biometric.enable']}
          </button>
        </div>
      </div>
    </div>
  )
}
