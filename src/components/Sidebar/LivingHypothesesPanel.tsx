import { useEffect, useState } from 'react'
import { useTranslation } from '../../i18n'
import { db } from '../../store/db'
import type { LivingHypothesis, LivingHypothesisStatus } from '../../types'
import { currentTimestamp } from '../../store/timestamp'

export function LivingHypothesesPanel({ isOpen }: { isOpen: boolean }) {
  const tr = useTranslation()
  const [items, setItems] = useState<LivingHypothesis[]>([])

  useEffect(() => {
    if (!isOpen) return
    void db.livingHypotheses.orderBy('updatedAt').reverse().limit(30).toArray().then(setItems)
  }, [isOpen])

  if (items.length === 0) return null
  const update = async (item: LivingHypothesis, patch: Partial<LivingHypothesis>) => {
    const updatedAt = currentTimestamp()
    await db.livingHypotheses.update(item.id, { ...patch, updatedAt })
    setItems(current => current.map(value => value.id === item.id ? { ...value, ...patch, updatedAt } : value))
  }

  return (
    <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 8, marginTop: 2 }}>
      <div style={{ color: 'var(--text-primary)', fontSize: 10 }}>{tr['ps.hypotheses.title']}</div>
      <div style={{ color: 'var(--text-ghost)', fontSize: 9, lineHeight: 1.4, marginTop: 2 }}>{tr['ps.hypotheses.note']}</div>
      <div style={{ display: 'grid', gap: 7, marginTop: 7 }}>
        {items.map(item => (
          <div key={item.id} style={{ border: '1px solid var(--border-light)', borderRadius: 6, padding: 7, opacity: item.status === 'dormant' ? 0.6 : 1 }}>
            <input
              aria-label={tr['ps.hypotheses.text']}
              defaultValue={item.text}
              maxLength={300}
              onBlur={event => {
                const text = event.target.value.trim()
                if (text && text !== item.text) void update(item, { text })
              }}
              style={{ width: '100%', boxSizing: 'border-box', border: 0, borderBottom: '1px solid var(--border-light)', background: 'transparent', color: 'var(--text-primary)', padding: '2px 0 4px', fontSize: 10 }}
            />
            <select aria-label={tr['ps.hypotheses.status']} value={item.status} onChange={event => void update(item, { status: event.target.value as LivingHypothesisStatus })} style={{ marginTop: 5, width: '100%', border: '1px solid var(--border-light)', borderRadius: 4, padding: '3px 5px', background: 'var(--surface-primary)', color: 'var(--text-secondary)', fontSize: 9 }}>
              <option value="candidate">{tr['ps.hypotheses.candidate']}</option>
              <option value="confirmed">{tr['ps.hypotheses.confirmed']}</option>
              <option value="contested">{tr['ps.hypotheses.contested']}</option>
              <option value="dormant">{tr['ps.hypotheses.dormant']}</option>
            </select>
          </div>
        ))}
      </div>
    </div>
  )
}
