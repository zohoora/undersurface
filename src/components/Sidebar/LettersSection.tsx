import { useEffect, useState } from 'react'
import { db } from '../../store/db'
import { getLanguageCode, getPartDisplayName, useTranslation } from '../../i18n'
import { useGroundingMode } from '../../hooks/useGroundingMode'
import type { Part, PartLetter } from '../../types'

// Letters from parts (letterEngine writes them after sessions close when the
// lettersFromParts flag is on). A quiet reading shelf: newest first, an unread
// dot, open one to read it. Renders nothing until a letter exists, and nothing
// while grounding is active: a crisis moment is not the time for mail.

interface Signatory {
  id: string
  name: string
  color: string
}

// Module-level: keeps the write out of render-scoped closures (React Compiler
// purity rule) and lets a lost write fail quietly; the next open re-reads.
async function persistRead(id: string): Promise<void> {
  try {
    await db.letters.update(id, { isRead: true })
  } catch { /* optimistic UI */ }
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString(getLanguageCode(), { year: 'numeric', month: 'short', day: 'numeric' })
}

function paragraphs(content: string): string[] {
  return content.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)
}

function PartDots({ signatories }: { signatories: Signatory[] }) {
  return (
    <span aria-hidden="true" style={{ display: 'inline-flex', gap: 3, flexShrink: 0 }}>
      {signatories.map((s) => (
        <span key={s.id} style={{ width: 8, height: 8, borderRadius: '50%', background: s.color }} />
      ))}
    </span>
  )
}

export function LettersSection({ isOpen }: { isOpen: boolean }) {
  const t = useTranslation()
  const grounding = useGroundingMode()
  const [letters, setLetters] = useState<PartLetter[]>([])
  const [parts, setParts] = useState<Map<string, Part>>(new Map())
  const [openId, setOpenId] = useState<string | null>(null)

  useEffect(() => {
    if (!isOpen) return
    let cancelled = false
    Promise.all([db.letters.toArray(), db.parts.toArray()])
      .then(([allLetters, allParts]) => {
        if (cancelled) return
        setLetters([...allLetters].sort((a, b) => b.createdAt - a.createdAt))
        setParts(new Map(allParts.map((p) => [p.id, p])))
      })
      .catch(() => { /* section silently absent on read failure */ })
    return () => { cancelled = true }
  }, [isOpen])

  if (grounding || letters.length === 0) return null

  const signatoriesOf = (letter: PartLetter): Signatory[] =>
    letter.partIds.flatMap((id) => {
      const part = parts.get(id)
      return part ? [{ id, name: getPartDisplayName(part), color: part.color }] : []
    })

  const byline = (signatories: Signatory[]) =>
    signatories.length > 0
      ? t['letters.from'].replace('{names}', signatories.map((s) => s.name).join(', '))
      : t['letters.fromParts']

  const open = (letter: PartLetter) => {
    setOpenId(letter.id)
    if (letter.isRead) return
    setLetters((prev) => prev.map((l) => (l.id === letter.id ? { ...l, isRead: true } : l)))
    void persistRead(letter.id)
  }

  const current = openId ? letters.find((l) => l.id === openId) : undefined

  return (
    <div className="settings-section">
      <div className="settings-section-label">{t['letters.title']}</div>
      {current ? (
        <article aria-label={byline(signatoriesOf(current))}>
          <button
            type="button"
            onClick={() => setOpenId(null)}
            style={{
              minHeight: 44,
              padding: '0 2px',
              border: 0,
              background: 'transparent',
              color: 'var(--text-secondary)',
              fontFamily: "'Inter', sans-serif",
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            ← {t['letters.back']}
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '2px 0 10px' }}>
            <PartDots signatories={signatoriesOf(current)} />
            <span style={{ fontFamily: "'Inter', sans-serif", fontSize: 12, color: 'var(--text-secondary)' }}>
              {byline(signatoriesOf(current))} · {formatDate(current.createdAt)}
            </span>
          </div>
          <div style={{ fontFamily: "'Spectral', serif", fontSize: 15, lineHeight: 1.65, color: 'var(--text-primary)' }}>
            {paragraphs(current.content).map((p, i) => (
              <p key={i} style={{ margin: '0 0 12px', whiteSpace: 'pre-wrap' }}>{p}</p>
            ))}
          </div>
        </article>
      ) : (
        <>
          <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 12, lineHeight: 1.5, color: 'var(--text-ghost)', marginBottom: 6 }}>
            {t['letters.description']}
          </div>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {letters.map((letter) => {
              const signatories = signatoriesOf(letter)
              return (
                <li key={letter.id}>
                  <button
                    type="button"
                    onClick={() => open(letter)}
                    aria-label={`${letter.isRead ? '' : `${t['letters.unread']}: `}${byline(signatories)}, ${formatDate(letter.createdAt)}`}
                    style={{
                      width: '100%',
                      minHeight: 44,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '6px 2px',
                      border: 0,
                      borderTop: '1px solid var(--border-light)',
                      background: 'transparent',
                      color: 'var(--text-primary)',
                      fontFamily: "'Inter', sans-serif",
                      fontSize: 12,
                      textAlign: 'left',
                      cursor: 'pointer',
                    }}
                  >
                    <PartDots signatories={signatories} />
                    <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: letter.isRead ? 400 : 500 }}>
                      {byline(signatories)}
                    </span>
                    <span style={{ color: 'var(--text-ghost)', flexShrink: 0 }}>{formatDate(letter.createdAt)}</span>
                    <span
                      data-testid={letter.isRead ? undefined : 'letter-unread-dot'}
                      aria-hidden="true"
                      style={{ width: 6, height: 6, borderRadius: '50%', flexShrink: 0, background: letter.isRead ? 'transparent' : 'var(--accent-warm)' }}
                    />
                  </button>
                </li>
              )
            })}
          </ul>
        </>
      )}
    </div>
  )
}
