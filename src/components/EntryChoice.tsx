import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from '../i18n'
import { db, generateId } from '../store/db'
import { trackEvent } from '../services/analytics'

interface Props {
  onJournalCreated: (id: string) => void
  onConversationChosen: () => void
  lastUsedType: 'journal' | 'conversation' | null
}

export function EntryChoice({ onJournalCreated, onConversationChosen, lastUsedType }: Props) {
  const t = useTranslation()
  const [entered, setEntered] = useState(false)
  const [selectedType, setSelectedType] = useState<'journal' | 'conversation' | null>(null)

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

  return (
    <div className="entry-choice-backdrop">
      <div className="entry-choice-container">
        <div
          className={[
            'entry-choice-card',
            entered ? 'entered' : '',
            selectedType === 'journal' ? 'selected' : '',
            selectedType === 'conversation' ? 'dismissed' : '',
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
            selectedType === 'journal' ? 'dismissed' : '',
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
      </div>
    </div>
  )
}
