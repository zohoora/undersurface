import { useState } from 'react'
import type { NoticeDirection } from '../../../engine/driftEngine'
import { t } from '../../../i18n'

// The three directional pills. Never a number — Drift has no distress scale.
const PILLS: { dir: Exclude<NoticeDirection, 'skipped'>; key: 'drift.notice.softer' | 'drift.notice.same' | 'drift.notice.stronger' }[] = [
  { dir: 'softer', key: 'drift.notice.softer' },
  { dir: 'same', key: 'drift.notice.same' },
  { dir: 'stronger', key: 'drift.notice.stronger' },
]

interface Props {
  prompt: string
  // Empty text = a tap-only check-in (instant, no LLM turn). Non-empty text =
  // the typed path (the streamed companion + full crisis stack). The pills
  // submit ON TAP — typing is the optional depth, never the requirement.
  onSubmit: (text: string, direction: NoticeDirection) => void
}

// v2 check-in: three big pills that submit immediately, plus an "add a word"
// affordance that reveals a single quiet input. With text present, the pills
// carry the direction for the typed submission; Enter submits as 'skipped'.
export function DriftExchange({ prompt, onSubmit }: Props) {
  const [text, setText] = useState('')
  const [showInput, setShowInput] = useState(false)

  const submit = (direction: NoticeDirection) => {
    onSubmit(text.trim(), direction)
    setText('')
    setShowInput(false)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 22, width: '100%', maxWidth: 460 }}>
      <div style={{ fontSize: 15, lineHeight: 1.6, color: 'var(--text-secondary)', textAlign: 'center' }}>{prompt}</div>
      <div style={{ display: 'flex', gap: 12 }}>
        {PILLS.map(({ dir, key }) => (
          <button
            key={dir}
            type="button"
            onClick={() => submit(dir)}
            style={{
              padding: '12px 22px',
              borderRadius: 999,
              border: '1px solid var(--border-light)',
              background: 'transparent',
              color: 'var(--text-primary)',
              fontSize: 14,
              cursor: 'pointer',
              fontFamily: "'Inter', sans-serif",
              transition: 'all 0.15s ease',
            }}
          >
            {t(key)}
          </button>
        ))}
      </div>
      {!showInput ? (
        <button
          type="button"
          onClick={() => setShowInput(true)}
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--text-tertiary)',
            fontSize: 12,
            cursor: 'pointer',
            fontFamily: "'Inter', sans-serif",
          }}
        >
          + {t('drift.notice.addWord')}
        </button>
      ) : (
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit('skipped') } }}
          placeholder={t('drift.choose.placeholder')}
          aria-label={t('drift.notice.addWord')}
          autoFocus
          style={{
            width: '100%',
            background: 'transparent',
            border: 'none',
            borderBottom: '1px solid var(--border-light)',
            color: 'var(--text-primary)',
            fontSize: 16,
            textAlign: 'center',
            padding: '8px 4px',
            outline: 'none',
            fontFamily: "'Inter', sans-serif",
          }}
        />
      )}
    </div>
  )
}

export default DriftExchange
