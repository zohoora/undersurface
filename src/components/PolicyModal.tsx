import { useEffect, useRef } from 'react'
import { PolicyContent } from './PolicyContent'

interface PolicyModalProps {
  isOpen: boolean
  onClose: () => void
  initialSection?: 'privacy' | 'disclaimer'
}

export function PolicyModal({ isOpen, onClose, initialSection }: PolicyModalProps) {
  const privacyRef = useRef<HTMLDivElement>(null)
  const disclaimerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isOpen) return
    const target = initialSection === 'disclaimer' ? disclaimerRef.current : privacyRef.current
    target?.scrollIntoView({ behavior: 'instant', block: 'start' })
  }, [isOpen, initialSection])

  useEffect(() => {
    if (!isOpen) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [isOpen, onClose])

  if (!isOpen) return null

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9998,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--overlay-medium)',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 560,
          maxHeight: '85vh',
          margin: 16,
          background: 'var(--bg-primary)',
          borderRadius: 12,
          border: '1px solid var(--border-subtle)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '16px 20px',
          borderBottom: '1px solid var(--border-light)',
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', gap: 16 }}>
            <button
              onClick={() => privacyRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
              style={{
                fontFamily: "'Inter', sans-serif",
                fontSize: 12,
                fontWeight: 500,
                color: 'var(--text-secondary)',
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
              onClick={() => disclaimerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
              style={{
                fontFamily: "'Inter', sans-serif",
                fontSize: 12,
                fontWeight: 500,
                color: 'var(--text-secondary)',
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
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              fontFamily: "'Inter', sans-serif",
              fontSize: 18,
              color: 'var(--text-ghost)',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: '0 4px',
              lineHeight: 1,
            }}
          >
            &times;
          </button>
        </div>

        {/* Content */}
        <div style={{
          overflowY: 'auto',
          padding: '24px 20px',
        }}>
          <div ref={privacyRef}>
            <PolicyContent section="privacy" />
          </div>
          <hr style={{ border: 'none', borderTop: '1px solid var(--border-light)', margin: '28px 0' }} />
          <div ref={disclaimerRef}>
            <PolicyContent section="disclaimer" />
          </div>
        </div>
      </div>
    </div>
  )
}
