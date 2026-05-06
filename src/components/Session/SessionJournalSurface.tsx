import { useEffect, useRef } from 'react'

interface Props {
  messageCount: number
  value: string
  onChange: (next: string) => void
  placeholder?: string
}

export function SessionJournalSurface({ messageCount, value, onChange, placeholder }: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  return (
    <div className="session-journal-surface">
      <div className="session-journal-presence">
        <div className="session-journal-presence__dot" />
        <span>Therapist · {messageCount} {messageCount === 1 ? 'message' : 'messages'} · listening</span>
      </div>
      <textarea
        ref={textareaRef}
        className="session-journal-textarea"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? 'Write privately. The therapist is here, quiet, while you find what wants to be said.'}
        rows={12}
      />
    </div>
  )
}
