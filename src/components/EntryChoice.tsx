import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from '../i18n'
import { db, generateId } from '../store/db'
import { trackEvent } from '../services/analytics'

type ChoiceType = 'journal' | 'conversation' | 'real_talk'

interface Props {
  onJournalCreated: (id: string) => void
  onConversationChosen: () => void
  onRealTalkChosen: () => void
  lastUsedType: ChoiceType | null
}

export function EntryChoice({ onJournalCreated, onConversationChosen, onRealTalkChosen, lastUsedType }: Props) {
  const t = useTranslation()
  const [entered, setEntered] = useState(false)
  const [selectedType, setSelectedType] = useState<ChoiceType | null>(null)

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

  const handleRealTalk = useCallback(() => {
    if (selectedType) return
    setSelectedType('real_talk')

    trackEvent('entry_choice', { type: 'real_talk' })

    setTimeout(() => onRealTalkChosen(), 340)
  }, [selectedType, onRealTalkChosen])

  // Each card uses the same dismissal logic: it dismisses if any *other*
  // card has been selected. Splitting this out keeps the JSX symmetric.
  const cardClasses = (type: ChoiceType, delayClass: string): string => {
    const isSelected = selectedType === type
    const isDismissed = selectedType !== null && selectedType !== type
    return [
      'entry-choice-card',
      entered ? `entered ${delayClass}`.trim() : '',
      isSelected ? 'selected' : '',
      isDismissed ? 'dismissed' : '',
      lastUsedType === type ? 'last-used' : '',
    ].filter(Boolean).join(' ')
  }

  return (
    <div className="entry-choice-backdrop">
      <div className="entry-choice-container">
        <div
          className={cardClasses('journal', '')}
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
          className={cardClasses('conversation', 'entered-delay')}
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

        <div
          className={cardClasses('real_talk', 'entered-delay-2')}
          role="button"
          tabIndex={0}
          aria-label={t['choice.realtalk.aria']}
          onClick={handleRealTalk}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleRealTalk() } }}
        >
          <div className="entry-choice-anim flint-spark" aria-hidden="true" />
          <div className="entry-choice-content">
            <h2 className="entry-choice-title">{t['choice.realtalk.title']}</h2>
            <p className="entry-choice-tagline">{t['choice.realtalk.tagline']}</p>
            <p className="entry-choice-desc">{t['choice.realtalk.desc']}</p>
          </div>
        </div>
      </div>
    </div>
  )
}
