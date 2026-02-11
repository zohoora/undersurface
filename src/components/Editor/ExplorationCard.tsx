import type { GuidedExploration } from '../../types'
import { useTranslation } from '../../i18n'

interface Props {
  explorations: GuidedExploration[]
  onSelect: (exploration: GuidedExploration) => void
  onDismiss: () => void
}

export function ExplorationCard({ explorations, onSelect, onDismiss }: Props) {
  const t = useTranslation()
  if (explorations.length === 0) return null

  return (
    <div style={{
      position: 'relative',
      zIndex: 2,
      maxWidth: 680,
      margin: '0 auto',
      padding: '0 40px 8px',
    }}>
      <div style={{
        background: 'var(--overlay-subtle)',
        borderRadius: 8,
        padding: '12px 16px',
      }}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 8,
        }}>
          <span style={{
            fontFamily: "'Spectral', Georgia, serif",
            fontSize: 12,
            color: 'var(--text-ghost)',
            fontStyle: 'italic',
          }}>
            {t['exploration.header']}
          </span>
          <button
            onClick={onDismiss}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--text-ghost)',
              fontSize: 14,
              padding: '0 2px',
              lineHeight: 1,
            }}
            aria-label="Dismiss explorations"
          >
            ×
          </button>
        </div>
        {explorations.map((e) => (
          <button
            key={e.id}
            onClick={() => onSelect(e)}
            style={{
              display: 'block',
              width: '100%',
              textAlign: 'left',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontFamily: "'Spectral', Georgia, serif",
              fontSize: 14,
              lineHeight: 1.6,
              color: 'var(--text-secondary)',
              padding: '6px 0',
              transition: 'color 0.2s ease',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)' }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-secondary)' }}
          >
            {e.prompt}
          </button>
        ))}
      </div>
    </div>
  )
}
