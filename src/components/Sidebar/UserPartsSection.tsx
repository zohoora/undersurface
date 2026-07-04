import { useEffect, useState } from 'react'
import { db } from '../../store/db'
import { getGlobalConfig } from '../../store/globalConfig'
import { useTranslation } from '../../i18n'
import type { UserPart } from '../../types'

// Minimal management surface for the writer's confirmed parts: see them,
// rename them (their words, always), or retire them. Candidates are invisible
// here — a part doesn't exist to the user until it's been offered and kept.
// The full constellation view is SP4.
// Spec: docs/superpowers/specs/2026-07-04-user-parts-model-design.md
export function UserPartsSection({ isOpen }: { isOpen: boolean }) {
  const t = useTranslation()
  const [parts, setParts] = useState<UserPart[]>([])
  const enabled = getGlobalConfig()?.features?.userParts === true

  useEffect(() => {
    if (!isOpen || !enabled) return
    let cancelled = false
    db.userParts.toArray()
      .then((all) => {
        if (cancelled) return
        setParts(all.filter((p) => p.status === 'active').sort((a, b) => b.lastActiveAt - a.lastActiveAt))
      })
      .catch(() => { /* section silently empty on read failure */ })
    return () => { cancelled = true }
  }, [isOpen, enabled])

  if (!enabled || parts.length === 0) return null

  const rename = async (id: string, name: string) => {
    const trimmed = name.trim()
    if (!trimmed) return
    setParts((prev) => prev.map((p) => (p.id === id ? { ...p, name: trimmed } : p)))
    try {
      await db.userParts.update(id, { name: trimmed, updatedAt: Date.now() })
    } catch { /* optimistic; next open re-reads truth */ }
  }

  const retire = async (id: string) => {
    setParts((prev) => prev.filter((p) => p.id !== id))
    try {
      await db.userParts.update(id, { status: 'retired', retiredAt: Date.now(), updatedAt: Date.now() })
    } catch { /* optimistic; next open re-reads truth */ }
  }

  return (
    <div className="settings-section">
      <div className="settings-section-label">{t['parts.settings.title']}</div>
      {parts.map((part) => (
        <div key={part.id} style={{ padding: '4px 0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              defaultValue={part.name}
              aria-label={t['parts.settings.title']}
              onBlur={(e) => { if (e.target.value.trim() !== part.name) void rename(part.id, e.target.value) }}
              style={{
                flex: 1,
                minWidth: 0,
                padding: '4px 8px',
                borderRadius: 6,
                border: '1px solid var(--border-subtle)',
                background: 'transparent',
                color: 'var(--text-primary)',
                fontFamily: "'Inter', sans-serif",
                fontSize: 11,
              }}
            />
            <button
              onClick={() => void retire(part.id)}
              style={{
                fontSize: 10,
                padding: '3px 8px',
                borderRadius: 6,
                border: '1px solid var(--border-subtle)',
                background: 'transparent',
                color: 'var(--text-secondary)',
                fontFamily: "'Inter', sans-serif",
                cursor: 'pointer',
                flexShrink: 0,
              }}
            >
              {t['parts.settings.retire']}
            </button>
          </div>
          <div style={{
            fontSize: 10,
            color: 'var(--text-secondary)',
            marginTop: 2,
            fontFamily: "'Inter', sans-serif",
          }}>
            {part.description}
          </div>
        </div>
      ))}
    </div>
  )
}
