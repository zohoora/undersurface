import { useEffect, useState } from 'react'
import { db } from '../../store/db'
import { getGlobalConfig } from '../../store/globalConfig'
import { useTranslation } from '../../i18n'
import type { UserValue } from '../../types'

// Module-level persistence (React Compiler purity rule).
async function persistRename(id: string, name: string): Promise<void> {
  try { await db.userValues.update(id, { name, updatedAt: Date.now() }) } catch { /* optimistic */ }
}
async function persistRetire(id: string): Promise<void> {
  try { await db.userValues.update(id, { status: 'retired', retiredAt: Date.now(), updatedAt: Date.now() }) } catch { /* optimistic */ }
}

// "What matters to you" — rename/retire for confirmed values. Mirrors
// UserPartsSection. Spec: docs/superpowers/specs/2026-07-04-companion-depth-program.md
export function UserValuesSection({ isOpen }: { isOpen: boolean }) {
  const t = useTranslation()
  const [values, setValues] = useState<UserValue[]>([])
  const enabled = getGlobalConfig()?.features?.userValues === true

  useEffect(() => {
    if (!isOpen || !enabled) return
    let cancelled = false
    db.userValues.toArray()
      .then((all) => {
        if (cancelled) return
        setValues(all.filter((v) => v.status === 'active').sort((a, b) => b.lastActiveAt - a.lastActiveAt))
      })
      .catch(() => { /* silently empty */ })
    return () => { cancelled = true }
  }, [isOpen, enabled])

  if (!enabled || values.length === 0) return null

  const rename = (id: string, name: string) => {
    const trimmed = name.trim()
    if (!trimmed) return
    setValues((prev) => prev.map((v) => (v.id === id ? { ...v, name: trimmed } : v)))
    void persistRename(id, trimmed)
  }
  const retire = (id: string) => {
    setValues((prev) => prev.filter((v) => v.id !== id))
    void persistRetire(id)
  }

  return (
    <div className="settings-section">
      <div className="settings-section-label">{t['values.settings.title']}</div>
      {values.map((value) => (
        <div key={value.id} style={{ padding: '4px 0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              defaultValue={value.name}
              aria-label={t['values.settings.title']}
              onBlur={(e) => { if (e.target.value.trim() !== value.name) rename(value.id, e.target.value) }}
              style={{ flex: 1, minWidth: 0, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border-subtle)', background: 'transparent', color: 'var(--text-primary)', fontFamily: "'Inter', sans-serif", fontSize: 11 }}
            />
            <button
              onClick={() => retire(value.id)}
              style={{ fontSize: 10, padding: '3px 8px', borderRadius: 6, border: '1px solid var(--border-subtle)', background: 'transparent', color: 'var(--text-secondary)', fontFamily: "'Inter', sans-serif", cursor: 'pointer', flexShrink: 0 }}
            >
              {t['parts.settings.retire']}
            </button>
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 2, fontFamily: "'Inter', sans-serif" }}>
            {value.description}
          </div>
        </div>
      ))}
    </div>
  )
}
