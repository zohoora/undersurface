import { useId, useState } from 'react'
import { db } from '../../store/db'
import { createIntention } from '../../engine/intentionTracker'
import { useTranslation } from '../../i18n'
import { CARD_TAP_TARGET } from './cardControls'

interface Props {
  phrase: string
  sessionId: string
}

// Persistence at module level (React Compiler purity rule: no Date.now() in
// render-scoped functions). Creating the 4th open intention releases the
// oldest — the tracker owns that rule.
async function persistIntention(text: string, sessionId: string): Promise<boolean> {
  try {
    const all = await db.sessionIntentions.toArray()
    const result = createIntention(all, text, sessionId, Date.now())
    if (!result) return true // duplicate/empty — treat as settled
    if (result.release) await db.sessionIntentions.update(result.release.id, result.release)
    await db.sessionIntentions.add(result.create)
    return true
  } catch {
    return false
  }
}

// Per-tab skip memory so a skipped offer doesn't reappear on re-render.
function skipKey(sessionId: string, phrase: string): string {
  return `us:intention-skip:${sessionId}:${phrase.slice(0, 40)}`
}

// The closing-offer consent card. Keep = the intention exists, in the
// writer's (editable) words; skip = remembered for this tab. Renders only in
// the active session (gated by the caller), so history never grows cards.
// Spec: docs/superpowers/specs/2026-07-04-intentions-and-stance-design.md
export function IntentionCard({ phrase, sessionId }: Props) {
  const tr = useTranslation()
  const inputId = useId()
  const [text, setText] = useState(phrase)
  const [settled, setSettled] = useState<'kept' | 'skipped' | null>(() =>
    sessionStorage.getItem(skipKey(sessionId, phrase)) ? 'skipped' : null,
  )

  if (settled === 'skipped') return null
  if (settled === 'kept') {
    return (
      <div style={{
        margin: '4px 0 20px',
        fontFamily: "'Inter', sans-serif",
        fontSize: 12,
        color: 'var(--text-secondary)',
        fontStyle: 'italic',
      }}>
        ✓ {text}
      </div>
    )
  }

  const keep = () => {
    setSettled('kept')
    void persistIntention(text.trim() || phrase, sessionId)
  }

  const skip = () => {
    setSettled('skipped')
    try { sessionStorage.setItem(skipKey(sessionId, phrase), '1') } catch { /* per-tab nicety only */ }
  }

  return (
    <div
      role="group"
      aria-labelledby={`${inputId}-label`}
      style={{
        margin: '4px 0 20px',
        padding: '10px 12px',
        borderRadius: 10,
        border: '1px solid var(--border-subtle)',
        background: 'transparent',
        maxWidth: 420,
      }}
    >
      <label id={`${inputId}-label`} htmlFor={inputId} style={{
        display: 'block',
        fontFamily: "'Inter', sans-serif",
        fontSize: 12,
        color: 'var(--text-secondary)',
        marginBottom: 8,
      }}>
        {tr['intentions.card.hint']}
      </label>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          id={inputId}
          style={{
            flex: 1,
            minWidth: 160,
            minHeight: CARD_TAP_TARGET,
            boxSizing: 'border-box',
            padding: '0 10px',
            borderRadius: 8,
            border: '1px solid var(--border-subtle)',
            background: 'transparent',
            color: 'var(--text-primary)',
            fontFamily: "'Inter', sans-serif",
            fontSize: 13,
          }}
        />
        <button
          type="button"
          onClick={keep}
          style={{
            minHeight: CARD_TAP_TARGET,
            padding: '0 14px',
            borderRadius: 8,
            border: '1px solid var(--border-subtle)',
            background: 'rgba(176,142,96,0.12)',
            color: 'var(--text-primary)',
            fontFamily: "'Inter', sans-serif",
            fontSize: 12,
            cursor: 'pointer',
          }}
        >
          {tr['intentions.card.keep']}
        </button>
        <button
          type="button"
          onClick={skip}
          style={{
            minHeight: CARD_TAP_TARGET,
            padding: '0 14px',
            borderRadius: 8,
            border: '1px solid transparent',
            background: 'transparent',
            color: 'var(--text-secondary)',
            fontFamily: "'Inter', sans-serif",
            fontSize: 12,
            cursor: 'pointer',
          }}
        >
          {tr['intentions.card.skip']}
        </button>
      </div>
    </div>
  )
}
