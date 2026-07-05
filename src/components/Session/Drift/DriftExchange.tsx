import { useState } from 'react'
import type { NoticeDirection } from '../../../engine/driftEngine'
import { t } from '../../../i18n'

// The three directional pills. Unset at submit → 'skipped' (never a number —
// Drift has no distress scale). Pills render only on the notice exchange.
const PILLS: { dir: Exclude<NoticeDirection, 'skipped'>; key: 'drift.notice.softer' | 'drift.notice.same' | 'drift.notice.stronger' }[] = [
  { dir: 'softer', key: 'drift.notice.softer' },
  { dir: 'same', key: 'drift.notice.same' },
  { dir: 'stronger', key: 'drift.notice.stronger' },
]

interface Props {
  prompt: string
  onSubmit: (text: string, direction: NoticeDirection) => void
  showPills: boolean
}

// A single quiet exchange: a centered prompt, a transparent single-line input,
// and (on notice turns) the softer/same/stronger pills. Enter submits.
export function DriftExchange({ prompt, onSubmit, showPills }: Props) {
  const [text, setText] = useState('')
  const [direction, setDirection] = useState<NoticeDirection | null>(null)

  const submit = () => {
    const trimmed = text.trim()
    if (!trimmed) return
    onSubmit(trimmed, showPills ? (direction ?? 'skipped') : 'skipped')
    setText('')
    setDirection(null)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20, width: '100%', maxWidth: 460 }}>
      <div style={{ fontSize: 15, lineHeight: 1.6, color: 'var(--text-secondary)', textAlign: 'center' }}>{prompt}</div>
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit() } }}
        placeholder={t('drift.choose.placeholder')}
        aria-label={prompt}
        autoFocus
        style={{
          width: '100%',
          background: 'transparent',
          border: 'none',
          borderBottom: '1px solid var(--border-light)',
          color: 'var(--text-primary)',
          fontSize: 17,
          textAlign: 'center',
          padding: '8px 4px',
          outline: 'none',
          fontFamily: "'Inter', sans-serif",
        }}
      />
      {showPills && (
        <div style={{ display: 'flex', gap: 10 }}>
          {PILLS.map(({ dir, key }) => {
            const active = direction === dir
            return (
              <button
                key={dir}
                type="button"
                onClick={() => setDirection(dir)}
                aria-pressed={active}
                style={{
                  padding: '7px 16px',
                  borderRadius: 999,
                  border: `1px solid ${active ? 'var(--accent-warm)' : 'var(--border-light)'}`,
                  background: active ? 'var(--accent-warm)' : 'transparent',
                  color: active ? '#fff' : 'var(--text-secondary)',
                  fontSize: 13,
                  cursor: 'pointer',
                  fontFamily: "'Inter', sans-serif",
                  transition: 'all 0.15s ease',
                }}
              >
                {t(key)}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default DriftExchange
