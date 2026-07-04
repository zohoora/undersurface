import { useState } from 'react'
import { db } from '../../store/db'
import { useTranslation } from '../../i18n'
import type { Session } from '../../types'

type Feeling = NonNullable<Session['leavingFeeling']>

interface Props {
  sessionId: string
  onDone: () => void
}

// Module level per the React Compiler purity rule.
async function persistFeeling(sessionId: string, feeling: Feeling): Promise<void> {
  try {
    await db.sessions.update(sessionId, { leavingFeeling: feeling })
  } catch { /* one lost tap costs nothing */ }
}

// One-tap "How are you leaving?" at session close. Skippable, never blocks —
// onDone fires immediately on tap or skip; closing continues regardless.
// Feeds the N-of-1 stance learner as its ground-truth outcome signal.
// Spec: docs/superpowers/specs/2026-07-04-intentions-and-stance-design.md
export function ClosingCheckIn({ sessionId, onDone }: Props) {
  const tr = useTranslation()
  const [done, setDone] = useState(false)

  if (done) return null

  const options: { feeling: Feeling; label: string }[] = [
    { feeling: 'heavier', label: tr['checkin.heavier'] },
    { feeling: 'same', label: tr['checkin.same'] },
    { feeling: 'shade_lighter', label: tr['checkin.shadeLighter'] },
    { feeling: 'lighter', label: tr['checkin.lighter'] },
    { feeling: 'much_lighter', label: tr['checkin.muchLighter'] },
  ]

  const pick = (feeling: Feeling) => {
    setDone(true)
    void persistFeeling(sessionId, feeling)
    onDone()
  }

  const skip = () => {
    setDone(true)
    onDone()
  }

  return (
    <div
      role="group"
      aria-label={tr['checkin.prompt']}
      style={{
        margin: '12px 0',
        padding: '12px 14px',
        borderRadius: 12,
        border: '1px solid var(--border-subtle)',
        maxWidth: 480,
      }}
    >
      <div style={{
        fontFamily: "'Inter', sans-serif",
        fontSize: 12,
        color: 'var(--text-secondary)',
        marginBottom: 10,
      }}>
        {tr['checkin.prompt']}
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        {options.map((o) => (
          <button
            key={o.feeling}
            onClick={() => pick(o.feeling)}
            style={{
              padding: '5px 10px',
              borderRadius: 999,
              border: '1px solid var(--border-subtle)',
              background: 'transparent',
              color: 'var(--text-primary)',
              fontFamily: "'Inter', sans-serif",
              fontSize: 11,
              cursor: 'pointer',
            }}
          >
            {o.label}
          </button>
        ))}
        <button
          onClick={skip}
          aria-label={tr['common.dismiss']}
          style={{
            padding: '5px 10px',
            borderRadius: 999,
            border: '1px solid transparent',
            background: 'transparent',
            color: 'var(--text-secondary)',
            fontFamily: "'Inter', sans-serif",
            fontSize: 12,
            cursor: 'pointer',
          }}
        >
          ×
        </button>
      </div>
    </div>
  )
}
