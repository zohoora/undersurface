import { useEffect, useState, type CSSProperties } from 'react'
import { useTranslation } from '../../i18n'

interface Props {
  // 'failed': the session is open but the words could not be added yet.
  // 'closed': the session closed first; the words can only be copied out.
  mode: 'failed' | 'closed'
  text: string
  sending: boolean
  onRetry: () => void
}

const buttonStyle: CSSProperties = {
  padding: '4px 10px',
  border: '1px solid var(--border-subtle)',
  borderRadius: 4,
  background: 'transparent',
  color: 'var(--text-secondary)',
  cursor: 'pointer',
  fontSize: 12,
  flexShrink: 0,
}

// A Journal draft that has not reached the conversation. The words are never
// discarded here: they stay saved on this device until they are added.
export function JournalDraftNotice({ mode, text, sending, onRetry }: Props) {
  const tr = useTranslation()
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const id = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(id)
  }, [copied])

  const copy = () => {
    try {
      void navigator.clipboard?.writeText(text).then(() => setCopied(true), () => {})
    } catch {
      // Clipboard unavailable: the words remain in the Journal.
    }
  }

  return (
    <div
      role="status"
      style={{
        margin: '12px 0',
        padding: 12,
        border: '1px solid var(--border-subtle)',
        borderRadius: 6,
        background: 'var(--overlay-subtle)',
        fontSize: 13,
        color: 'var(--text-secondary)',
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 8,
      }}
    >
      <span style={{ flex: '1 1 200px' }}>
        {mode === 'closed' ? tr['session.journal.draftClosed'] : tr['session.journal.draftNotAdded']}
      </span>
      {mode === 'failed' && (
        <button type="button" onClick={onRetry} disabled={sending} style={{ ...buttonStyle, opacity: sending ? 0.5 : 1 }}>
          {tr['session.journal.draftRetry']}
        </button>
      )}
      <button type="button" onClick={copy} style={buttonStyle}>
        {copied ? tr['session.journal.draftCopied'] : tr['session.journal.draftCopy']}
      </button>
    </div>
  )
}
