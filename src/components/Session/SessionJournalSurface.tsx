import { useEffect, useRef } from 'react'
import { useTranslation } from '../../i18n'

interface Props {
  value: string
  onChange: (next: string) => void
}

export function SessionJournalSurface({ value, onChange }: Props) {
  const tr = useTranslation()
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  return (
    <div className="session-journal-surface">
      <div className="session-journal-presence">
        <div className="session-journal-presence__dot" />
        <span>{tr['session.journal.presence']}</span>
      </div>
      <textarea
        ref={textareaRef}
        className="session-journal-textarea"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={tr['session.journal.placeholder']}
        rows={12}
      />
    </div>
  )
}
