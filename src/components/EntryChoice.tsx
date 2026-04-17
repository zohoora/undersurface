import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from '../i18n'
import { db, generateId } from '../store/db'
import { trackEvent } from '../services/analytics'
import { useFutureSelfUnlock } from '../hooks/useFutureSelfUnlock'

interface Props {
  onJournalCreated: (id: string) => void
  onConversationChosen: () => void
  onFutureSelfChosen?: () => void
  lastUsedType: 'journal' | 'conversation' | null
}

export function EntryChoice({ onJournalCreated, onConversationChosen, onFutureSelfChosen, lastUsedType }: Props) {
  const t = useTranslation()
  const futureSelf = useFutureSelfUnlock()
  const [entered, setEntered] = useState(false)
  const [selectedType, setSelectedType] = useState<'journal' | 'conversation' | 'futureSelf' | null>(null)
  const [lockedHintOpen, setLockedHintOpen] = useState(false)

  // Staggered entrance animation
  useEffect(() => {
    const timer = requestAnimationFrame(() => setEntered(true))
    return () => cancelAnimationFrame(timer)
  }, [])

  const handleJournal = useCallback(async () => {
    if (selectedType) return
    setSelectedType('journal')

    const id = generateId()
    await db.entries.add({
      id,
      content: '',
      plainText: '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })

    trackEvent('entry_choice', { type: 'journal' })

    // Let exit animation play before navigating
    setTimeout(() => onJournalCreated(id), 340)
  }, [selectedType, onJournalCreated])

  const handleConversation = useCallback(() => {
    if (selectedType) return
    setSelectedType('conversation')

    trackEvent('entry_choice', { type: 'conversation' })

    setTimeout(() => onConversationChosen(), 340)
  }, [selectedType, onConversationChosen])

  const handleFutureSelf = useCallback(() => {
    if (selectedType) return
    if (!futureSelf.unlocked) {
      setLockedHintOpen(true)
      trackEvent('future_self_locked_click', {
        entries_have: futureSelf.progress.entries.have,
        entries_need: futureSelf.progress.entries.need,
        sessions_have: futureSelf.progress.sessions.have,
        sessions_need: futureSelf.progress.sessions.need,
      })
      return
    }
    setSelectedType('futureSelf')
    trackEvent('entry_choice', { type: 'futureSelf' })
    setTimeout(() => onFutureSelfChosen?.(), 340)
  }, [selectedType, futureSelf, onFutureSelfChosen])

  return (
    <div className="entry-choice-backdrop">
      <div className="entry-choice-container">
        <div
          className={[
            'entry-choice-card',
            entered ? 'entered' : '',
            selectedType === 'journal' ? 'selected' : '',
            (selectedType === 'conversation' || selectedType === 'futureSelf') ? 'dismissed' : '',
            lastUsedType === 'journal' ? 'last-used' : '',
          ].filter(Boolean).join(' ')}
          role="button"
          tabIndex={0}
          aria-label={t['choice.journal.aria']}
          onClick={handleJournal}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleJournal() } }}
        >
          <div className="entry-choice-anim ink-ripple" aria-hidden="true" />
          <div className="entry-choice-content">
            <h2 className="entry-choice-title">{t['choice.journal.title']}</h2>
            <p className="entry-choice-tagline">{t['choice.journal.tagline']}</p>
            <p className="entry-choice-desc">{t['choice.journal.desc']}</p>
          </div>
        </div>

        <div
          className={[
            'entry-choice-card',
            entered ? 'entered entered-delay' : '',
            selectedType === 'conversation' ? 'selected' : '',
            (selectedType === 'journal' || selectedType === 'futureSelf') ? 'dismissed' : '',
            lastUsedType === 'conversation' ? 'last-used' : '',
          ].filter(Boolean).join(' ')}
          role="button"
          tabIndex={0}
          aria-label={t['choice.conversation.aria']}
          onClick={handleConversation}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleConversation() } }}
        >
          <div className="entry-choice-anim breath-glow" aria-hidden="true" />
          <div className="entry-choice-content">
            <h2 className="entry-choice-title">{t['choice.conversation.title']}</h2>
            <p className="entry-choice-tagline">{t['choice.conversation.tagline']}</p>
            <p className="entry-choice-desc">{t['choice.conversation.desc']}</p>
          </div>
        </div>

        {futureSelf.enabled && (
          <div
            className={[
              'entry-choice-card',
              'future-self',
              entered ? 'entered entered-delay-2' : '',
              selectedType === 'futureSelf' ? 'selected' : '',
              (selectedType === 'journal' || selectedType === 'conversation') ? 'dismissed' : '',
              futureSelf.unlocked ? '' : 'locked',
            ].filter(Boolean).join(' ')}
            role="button"
            tabIndex={0}
            aria-label={futureSelf.unlocked ? t['choice.futureSelf.aria'] : t['choice.futureSelf.locked.aria']}
            aria-disabled={!futureSelf.unlocked}
            onClick={handleFutureSelf}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleFutureSelf() } }}
            style={futureSelf.unlocked ? undefined : {
              opacity: 0.55,
              cursor: 'pointer',
            }}
          >
            <div className="entry-choice-anim future-glow" aria-hidden="true" />
            <div className="entry-choice-content">
              <h2 className="entry-choice-title">
                {t['choice.futureSelf.title']}
                {!futureSelf.unlocked && (
                  <span style={{ marginLeft: 8, fontSize: '0.7em', opacity: 0.6 }} aria-hidden="true">
                    {'\u{1F512}'}
                  </span>
                )}
              </h2>
              <p className="entry-choice-tagline">{t['choice.futureSelf.tagline']}</p>
              <p className="entry-choice-desc">{t['choice.futureSelf.desc']}</p>
              {!futureSelf.unlocked && (
                <p className="entry-choice-desc" style={{ marginTop: 10, fontSize: 11, opacity: 0.7 }}>
                  {t['choice.futureSelf.locked.progress']
                    .replace('{entriesHave}', String(futureSelf.progress.entries.have))
                    .replace('{entriesNeed}', String(futureSelf.progress.entries.need))
                    .replace('{sessionsHave}', String(futureSelf.progress.sessions.have))
                    .replace('{sessionsNeed}', String(futureSelf.progress.sessions.need))}
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {lockedHintOpen && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setLockedHintOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'var(--overlay-medium, rgba(0,0,0,0.4))',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
            padding: 24,
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              maxWidth: 380,
              background: 'var(--surface-primary)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 12,
              padding: 28,
              fontFamily: "'Spectral', serif",
              color: 'var(--text-primary)',
              fontSize: 15,
              lineHeight: 1.6,
              textAlign: 'center' as const,
            }}
          >
            <p style={{ margin: 0, marginBottom: 16 }}>{t['choice.futureSelf.locked.hint']}</p>
            <button
              onClick={() => setLockedHintOpen(false)}
              style={{
                marginTop: 4,
                padding: '8px 20px',
                fontFamily: "'Inter', sans-serif",
                fontSize: 12,
                background: 'transparent',
                color: 'var(--text-secondary)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 6,
                cursor: 'pointer',
              }}
            >
              {t['choice.futureSelf.locked.dismiss']}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
