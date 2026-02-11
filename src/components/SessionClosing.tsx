import { useState, useEffect } from 'react'
import { useTranslation } from '../i18n'

interface Props {
  phrase: string | null
  loading: boolean
  onClose: () => void
}

export function SessionClosing({ phrase, loading, onClose }: Props) {
  const t = useTranslation()
  const [visible, setVisible] = useState(false)
  const [textVisible, setTextVisible] = useState(false)

  // Fade in the backdrop
  useEffect(() => {
    requestAnimationFrame(() => setVisible(true))
  }, [])

  // Fade in the text once phrase arrives
  useEffect(() => {
    if (phrase) {
      const t = setTimeout(() => setTextVisible(true), 300)
      return () => clearTimeout(t)
    }
  }, [phrase])

  const handleClose = () => {
    setVisible(false)
    setTextVisible(false)
    setTimeout(onClose, 500)
  }

  return (
    <div
      onClick={phrase ? handleClose : undefined}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10000,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg-primary)',
        opacity: visible ? 1 : 0,
        transition: 'opacity 0.5s ease',
        cursor: phrase ? 'pointer' : 'default',
        padding: 40,
      }}
    >
      {loading && !phrase && (
        <div style={{
          fontFamily: "'Spectral', serif",
          fontSize: 18,
          color: 'var(--color-weaver)',
          opacity: 0.4,
          animation: 'closingBreath 3s ease-in-out infinite',
        }}>
          . . .
        </div>
      )}

      {phrase && (
        <div style={{
          maxWidth: 440,
          textAlign: 'center',
          opacity: textVisible ? 1 : 0,
          transform: textVisible ? 'translateY(0)' : 'translateY(8px)',
          transition: 'opacity 0.8s ease, transform 0.8s ease',
        }}>
          <div style={{
            fontFamily: "'Spectral', serif",
            fontSize: 20,
            lineHeight: 1.7,
            color: 'var(--text-primary)',
            letterSpacing: '0.01em',
          }}>
            {phrase}
          </div>
          <div style={{
            marginTop: 24,
            fontFamily: "'Inter', sans-serif",
            fontSize: 11,
            color: 'var(--color-weaver)',
            opacity: 0.6,
            letterSpacing: '0.05em',
          }}>
            — {t['session.attribution']}
          </div>
          <div style={{
            marginTop: 40,
            fontFamily: "'Inter', sans-serif",
            fontSize: 11,
            color: 'var(--text-ghost)',
            opacity: textVisible ? 0.4 : 0,
            transition: 'opacity 1.2s ease 1s',
          }}>
            {t['session.tapToClose']}
          </div>
        </div>
      )}

      <style>{`
        @keyframes closingBreath {
          0%, 100% { opacity: 0.3; }
          50% { opacity: 0.6; }
        }
      `}</style>
    </div>
  )
}
