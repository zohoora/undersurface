import { t } from '../../../i18n'

interface Props {
  elapsedMs: number
  durationMs: number
}

function fmtMinutes(ms: number): string {
  const min = Math.round(ms / 60_000)
  return `${min}`
}

export function RelaxClosingSummary({ elapsedMs, durationMs }: Props) {
  const minutes = fmtMinutes(elapsedMs)
  const completed = elapsedMs >= durationMs

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        fontFamily: "'Inter', sans-serif",
        color: 'rgba(220,220,230,0.78)',
        gap: 14,
        padding: 24,
      }}
    >
      <div style={{ fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(200,200,210,0.45)' }}>
        {t('relax.summary.title')}
      </div>
      <div style={{ fontSize: 22, fontWeight: 300, letterSpacing: '0.02em' }}>
        {minutes} {t('relax.summary.minutes')}
      </div>
      <div style={{ fontSize: 13, color: 'rgba(200,200,210,0.55)', maxWidth: 320 }}>
        {completed ? t('relax.summary.completed') : t('relax.summary.subtitle')}
      </div>
    </div>
  )
}

export default RelaxClosingSummary
