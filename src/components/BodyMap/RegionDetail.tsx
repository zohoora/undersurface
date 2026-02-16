import type { BodyRegion, HomunculusRegionState } from '../../types'
import { useTranslation } from '../../i18n'

interface Props {
  region: BodyRegion
  state: HomunculusRegionState
  onClose: () => void
}

export function RegionDetail({ region, state, onClose }: Props) {
  const t = useTranslation()
  const regionKey = `bodyMap.region.${region}` as keyof typeof t

  return (
    <div
      style={{
        padding: '12px 8px',
        animation: 'settingsSlideUp 0.2s ease-out',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 10,
      }}>
        <span style={{
          fontSize: 11,
          fontWeight: 500,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: 'var(--text-secondary)',
        }}>
          {t[regionKey] || region}
        </span>
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--text-ghost)',
            cursor: 'pointer',
            fontSize: 14,
            padding: '2px 6px',
            lineHeight: 1,
          }}
          aria-label="Close"
        >
          &times;
        </button>
      </div>

      {state.dominantEmotions.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 10 }}>
          {state.dominantEmotions.map(({ emotion, color }) => (
            <span
              key={emotion}
              style={{
                fontSize: 10,
                padding: '2px 8px',
                borderRadius: 10,
                background: `${color}20`,
                color,
                fontWeight: 500,
              }}
            >
              {emotion}
            </span>
          ))}
        </div>
      )}

      {state.quotes.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {state.quotes.slice(0, 5).map((q, i) => (
            <div key={i} style={{ fontSize: 12, lineHeight: 1.5 }}>
              <span style={{
                fontStyle: 'italic',
                color: 'var(--text-secondary)',
              }}>
                &ldquo;{q.text}&rdquo;
              </span>
              {q.date && (
                <span style={{
                  fontSize: 10,
                  color: 'var(--text-ghost)',
                  marginLeft: 6,
                }}>
                  {q.date}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {state.signalCount === 0 && (
        <div style={{
          fontSize: 12,
          color: 'var(--text-ghost)',
          fontStyle: 'italic',
        }}>
          No signals yet
        </div>
      )}
    </div>
  )
}
