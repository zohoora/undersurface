import { useState } from 'react'
import { db } from '../../store/db'
import { useTranslation } from '../../i18n'
import type { Session } from '../../types'
import { recordSessionNextStep, recordSessionOutcome } from '../../store/interventionOutcomes'

type Feeling = NonNullable<Session['leavingFeeling']>

interface Props {
  sessionId: string
  onDone: () => void
  showNextStep?: boolean
}

// Module level per the React Compiler purity rule.
async function persistFeeling(sessionId: string, feeling: Feeling): Promise<void> {
  try {
    await db.sessions.update(sessionId, { leavingFeeling: feeling })
    const outcome = feeling === 'heavier'
      ? 'worse'
      : feeling === 'same'
        ? 'nothing'
        : 'helped'
    await recordSessionOutcome(sessionId, outcome)
  } catch { /* one lost tap costs nothing */ }
}

// One-tap "How are you leaving?" at session close. Skippable, never blocks —
// onDone fires immediately on tap or skip; closing continues regardless.
// Feeds the N-of-1 stance learner as its ground-truth outcome signal.
// Spec: docs/superpowers/specs/2026-07-04-intentions-and-stance-design.md
export function ClosingCheckIn({ sessionId, onDone, showNextStep = false }: Props) {
  const tr = useTranslation()
  const [done, setDone] = useState(false)
  const [nextStep, setNextStep] = useState(false)

  if (done) return null

  const options: { feeling: Feeling; label: string }[] = [
    { feeling: 'heavier', label: tr['checkin.heavier'] },
    { feeling: 'same', label: tr['checkin.same'] },
    { feeling: 'shade_lighter', label: tr['checkin.shadeLighter'] },
    { feeling: 'lighter', label: tr['checkin.lighter'] },
    { feeling: 'much_lighter', label: tr['checkin.muchLighter'] },
  ]

  const pick = (feeling: Feeling) => {
    if (!showNextStep) {
      setDone(true)
      void persistFeeling(sessionId, feeling)
      onDone()
      return
    }
    void persistFeeling(sessionId, feeling).then(() => setNextStep(true))
  }

  const skip = () => {
    setDone(true)
    onDone()
  }

  const pickNext = (value: 'done' | 'offline_action' | 'human_contact' | 'rest' | 'more_support') => {
    setDone(true)
    void recordSessionNextStep(sessionId, value)
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
        {nextStep ? tr['ps.closing.next'] : tr['checkin.prompt']}
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        {!nextStep && options.map((o) => (
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
        {nextStep && ([
          ['done', tr['ps.closing.done']],
          ['offline_action', tr['ps.closing.offline']],
          ['human_contact', tr['ps.closing.human']],
          ['rest', tr['ps.closing.rest']],
          ['more_support', tr['ps.closing.moreSupport']],
        ] as const).map(([value, label]) => (
          <button
            key={value}
            onClick={() => pickNext(value)}
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
            {label}
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
