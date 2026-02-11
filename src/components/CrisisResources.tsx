import { useState } from 'react'
import { useTranslation, getLanguageCode } from '../i18n'

interface CrisisResourcesProps {
  visible: boolean
}

export function CrisisResources({ visible }: CrisisResourcesProps) {
  // When visible goes false, inner component unmounts and dismissed resets
  if (!visible) return null
  return <CrisisResourcesCard />
}

function CrisisResourcesCard() {
  const [dismissed, setDismissed] = useState(false)
  const t = useTranslation()
  const isEnglish = getLanguageCode() === 'en'

  if (dismissed) return null

  return (
    <div
      className="crisis-resources"
      style={{
        position: 'fixed',
        bottom: 24,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 50,
        maxWidth: 400,
        width: 'calc(100% - 32px)',
        background: 'var(--surface-primary)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 12,
        padding: '20px 24px',
        fontFamily: "'Inter', sans-serif",
        boxShadow: '0 4px 12px var(--overlay-medium)',
      }}
    >
      <button
        onClick={() => setDismissed(true)}
        aria-label="Dismiss"
        style={{
          position: 'absolute',
          top: 12,
          right: 12,
          background: 'none',
          border: 'none',
          color: 'var(--text-ghost)',
          cursor: 'pointer',
          fontSize: 16,
          lineHeight: 1,
          padding: '0 4px',
        }}
      >
        &times;
      </button>

      <div style={{
        fontSize: 14,
        fontWeight: 500,
        color: 'var(--text-primary)',
        marginBottom: 14,
      }}>
        {t['crisis.title']}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {isEnglish && (
          <>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              <strong>{t['crisis.988.name']}</strong>
              <br />
              {t['crisis.988.action']}{' '}
              <a
                href="tel:988"
                style={{ color: 'var(--color-still)', textDecoration: 'underline', textUnderlineOffset: 3 }}
              >
                988
              </a>
            </div>

            <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              <strong>{t['crisis.textLine.name']}</strong>
              <br />
              {t['crisis.textLine.action']}{' '}
              <a
                href="sms:741741&body=HOME"
                style={{ color: 'var(--color-still)', textDecoration: 'underline', textUnderlineOffset: 3 }}
              >
                741741
              </a>
            </div>
          </>
        )}

        <div style={{
          fontSize: isEnglish ? 12 : 13,
          color: isEnglish ? 'var(--text-ghost)' : 'var(--text-secondary)',
          lineHeight: 1.5,
          paddingTop: isEnglish ? 4 : 0,
          borderTop: isEnglish ? '1px solid var(--border-light)' : 'none',
        }}>
          {isEnglish ? t['crisis.international'] : t['crisis.internationalOnly']}{' '}
          <a
            href="https://findahelpline.com"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: 'var(--color-still)', textDecoration: 'underline', textUnderlineOffset: 3 }}
          >
            {t['crisis.findHelpline']}
          </a>
        </div>
      </div>

      <button
        onClick={() => setDismissed(true)}
        style={{
          marginTop: 14,
          width: '100%',
          padding: '8px 16px',
          fontSize: 12,
          fontFamily: "'Inter', sans-serif",
          color: 'var(--text-ghost)',
          background: 'none',
          border: '1px solid var(--border-light)',
          borderRadius: 6,
          cursor: 'pointer',
        }}
      >
        {t['crisis.dismiss']}
      </button>
    </div>
  )
}
