import { useState, useRef } from 'react'
import { db } from '../../store/db'
import { useModalA11y } from '../../hooks/useModalA11y'
import type { PolarH10Consent } from '../../types'

interface Props {
  onAccept: () => void
  onDecline: () => void
}

/**
 * One-time consent for Bluetooth-based HRV. Mirrors HrvConsentDialog so both
 * device paths feel consistent, but distinguishes the *device-pairing*
 * concern (Bluetooth permission) from the *data-processing* concern (storing
 * derived HRV metrics) — the user can deny either independently.
 */
export function PolarH10ConsentDialog({ onAccept, onDecline }: Props) {
  const [bluetoothAccepted, setBluetoothAccepted] = useState(false)
  const [biometricAccepted, setBiometricAccepted] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  useModalA11y(panelRef, onDecline)

  const canAccept = bluetoothAccepted && biometricAccepted

  const handleAccept = async () => {
    const consent: PolarH10Consent = {
      id: 'polar-h10',
      acceptedAt: Date.now(),
      acceptedVersion: '1.0',
      bluetoothAccepted: true,
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
        aria-labelledby="polar-consent-title"
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
          id="polar-consent-title"
          style={{
            margin: '0 0 12px',
            fontFamily: "'Inter', sans-serif",
            fontSize: 18,
            fontWeight: 600,
            color: 'var(--text-primary)',
          }}
        >
          Connect a Heart-Rate Monitor
        </h3>

        <p style={{
          fontFamily: "'Inter', sans-serif",
          fontSize: 14,
          lineHeight: 1.6,
          color: 'var(--text-secondary)',
          marginBottom: 20,
        }}>
          This feature pairs your browser with a Polar H10 (or any standard Bluetooth
          heart-rate monitor) to measure heart rate and heart rate variability while
          you write. The strap streams beat-to-beat intervals over Bluetooth — only
          derived metrics are saved to your account.
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
            checked={bluetoothAccepted}
            onChange={e => setBluetoothAccepted(e.target.checked)}
            style={{ marginTop: 2, width: 18, height: 18, flexShrink: 0 }}
          />
          I understand my browser will connect to a Bluetooth heart-rate monitor
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
          I agree to the collection of biometric data (heart rate, HRV metrics)
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
            Not now
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
            Connect
          </button>
        </div>
      </div>
    </div>
  )
}
