import { useEffect, useState } from 'react'
import { db } from '../../store/db'
import { useTranslation } from '../../i18n'
import type { UserPart } from '../../types'

interface Props {
  partId: string
}

// The quiet consent card rendered beneath a therapist message that carried a
// part-proposal marker. Consent is a deterministic UI event — never inferred
// from prose. Renders nothing once the part is no longer a candidate (covers
// history re-renders and already-acted proposals).
// Spec: docs/superpowers/specs/2026-07-04-user-parts-model-design.md
export function PartProposalCard({ partId }: Props) {
  const tr = useTranslation()
  const [part, setPart] = useState<UserPart | null>(null)
  const [name, setName] = useState('')
  const [settled, setSettled] = useState<'kept' | 'dismissed' | null>(null)

  useEffect(() => {
    let cancelled = false
    db.userParts.get(partId)
      .then((p) => {
        if (cancelled || !p || p.status !== 'candidate') return
        setPart(p)
        setName(p.name)
      })
      .catch(() => { /* card silently absent on read failure */ })
    return () => { cancelled = true }
  }, [partId])

  if (!part || settled === 'dismissed') return null

  if (settled === 'kept') {
    return (
      <div style={{
        margin: '4px 0 20px',
        fontFamily: "'Inter', sans-serif",
        fontSize: 12,
        color: 'var(--text-secondary)',
        fontStyle: 'italic',
      }}>
        ✓ {name}
      </div>
    )
  }

  const keep = async () => {
    const finalName = name.trim() || part.name
    setSettled('kept')
    setName(finalName)
    try {
      await db.userParts.update(part.id, {
        name: finalName,
        status: 'active',
        confirmedAt: Date.now(),
        updatedAt: Date.now(),
      })
    } catch { /* optimistic UI; reflection re-arms if the write was lost */ }
  }

  const dismiss = async () => {
    setSettled('dismissed')
    try {
      const dismissedCount = part.dismissedCount + 1
      await db.userParts.update(part.id, {
        dismissedCount,
        // A second "not quite" retires the candidate permanently.
        ...(dismissedCount >= 2 ? { status: 'retired' as const, retiredAt: Date.now() } : {}),
        updatedAt: Date.now(),
      })
    } catch { /* best-effort */ }
  }

  return (
    <div
      role="group"
      aria-label={tr['parts.card.hint']}
      style={{
        margin: '4px 0 20px',
        padding: '10px 12px',
        borderRadius: 10,
        border: '1px solid var(--border-subtle)',
        background: 'transparent',
        maxWidth: 420,
      }}
    >
      <div style={{
        fontFamily: "'Inter', sans-serif",
        fontSize: 11,
        color: 'var(--text-secondary)',
        marginBottom: 8,
      }}>
        {tr['parts.card.hint']}
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-label={tr['parts.card.hint']}
          style={{
            flex: 1,
            minWidth: 160,
            padding: '6px 10px',
            borderRadius: 8,
            border: '1px solid var(--border-subtle)',
            background: 'transparent',
            color: 'var(--text-primary)',
            fontFamily: "'Inter', sans-serif",
            fontSize: 13,
          }}
        />
        <button
          onClick={keep}
          style={{
            padding: '6px 12px',
            borderRadius: 8,
            border: '1px solid var(--border-subtle)',
            background: 'rgba(176,142,96,0.12)',
            color: 'var(--text-primary)',
            fontFamily: "'Inter', sans-serif",
            fontSize: 12,
            cursor: 'pointer',
          }}
        >
          {tr['parts.card.keep']}
        </button>
        <button
          onClick={dismiss}
          style={{
            padding: '6px 12px',
            borderRadius: 8,
            border: '1px solid transparent',
            background: 'transparent',
            color: 'var(--text-secondary)',
            fontFamily: "'Inter', sans-serif",
            fontSize: 12,
            cursor: 'pointer',
          }}
        >
          {tr['parts.card.notQuite']}
        </button>
      </div>
    </div>
  )
}
