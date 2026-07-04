import { useEffect, useState } from 'react'
import { db } from '../../store/db'
import { useTranslation } from '../../i18n'
import type { UserValue } from '../../types'

// Consent card for value proposals — same grammar as PartProposalCard:
// editable name in the writer's words, Keep / Not quite (2nd dismissal
// retires), self-hides once the value isn't a candidate.
// Spec: docs/superpowers/specs/2026-07-04-companion-depth-program.md
export function ValueProposalCard({ valueId }: { valueId: string }) {
  const tr = useTranslation()
  const [value, setValue] = useState<UserValue | null>(null)
  const [name, setName] = useState('')
  const [settled, setSettled] = useState<'kept' | 'dismissed' | null>(null)

  useEffect(() => {
    let cancelled = false
    db.userValues.get(valueId)
      .then((v) => {
        if (cancelled || !v || v.status !== 'candidate') return
        setValue(v)
        setName(v.name)
      })
      .catch(() => { /* silently absent on read failure */ })
    return () => { cancelled = true }
  }, [valueId])

  if (!value || settled === 'dismissed') return null
  if (settled === 'kept') {
    return (
      <div style={{ margin: '4px 0 20px', fontFamily: "'Inter', sans-serif", fontSize: 12, color: 'var(--text-secondary)', fontStyle: 'italic' }}>
        ✓ {name}
      </div>
    )
  }

  const keep = async () => {
    const finalName = name.trim() || value.name
    setSettled('kept')
    setName(finalName)
    try {
      await db.userValues.update(value.id, { name: finalName, status: 'active', confirmedAt: Date.now(), updatedAt: Date.now() })
    } catch { /* optimistic; reflection re-arms if lost */ }
  }

  const dismiss = async () => {
    setSettled('dismissed')
    try {
      const dismissedCount = value.dismissedCount + 1
      await db.userValues.update(value.id, {
        dismissedCount,
        ...(dismissedCount >= 2 ? { status: 'retired' as const, retiredAt: Date.now() } : {}),
        updatedAt: Date.now(),
      })
    } catch { /* best-effort */ }
  }

  return (
    <div role="group" aria-label={tr['values.card.hint']} style={{ margin: '4px 0 20px', padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border-subtle)', background: 'transparent', maxWidth: 420 }}>
      <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 11, color: 'var(--text-secondary)', marginBottom: 8 }}>
        {tr['values.card.hint']}
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-label={tr['values.card.hint']}
          style={{ flex: 1, minWidth: 160, padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border-subtle)', background: 'transparent', color: 'var(--text-primary)', fontFamily: "'Inter', sans-serif", fontSize: 13 }}
        />
        <button onClick={keep} style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid var(--border-subtle)', background: 'rgba(176,142,96,0.12)', color: 'var(--text-primary)', fontFamily: "'Inter', sans-serif", fontSize: 12, cursor: 'pointer' }}>
          {tr['parts.card.keep']}
        </button>
        <button onClick={dismiss} style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid transparent', background: 'transparent', color: 'var(--text-secondary)', fontFamily: "'Inter', sans-serif", fontSize: 12, cursor: 'pointer' }}>
          {tr['parts.card.notQuite']}
        </button>
      </div>
    </div>
  )
}
