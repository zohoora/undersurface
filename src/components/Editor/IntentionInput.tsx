import { useState, useRef, useEffect } from 'react'
import { useTranslation } from '../../i18n'

interface Props {
  value: string
  onChange: (v: string) => void
}

export function IntentionInput({ value, onChange }: Props) {
  const t = useTranslation()
  const [editing, setEditing] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus()
    }
  }, [editing])

  if (!editing && !value) {
    return (
      <button
        onClick={() => setEditing(true)}
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          fontFamily: "'Inter', sans-serif",
          fontSize: 12,
          color: 'var(--text-ghost)',
          padding: '4px 0',
          opacity: 0.7,
          transition: 'opacity 0.2s ease',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.opacity = '1' }}
        onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.7' }}
      >
        {t['intention.set']}
      </button>
    )
  }

  if (!editing && value) {
    return (
      <div
        onClick={() => setEditing(true)}
        style={{
          fontFamily: "'Inter', sans-serif",
          fontSize: 12,
          color: 'var(--text-ghost)',
          padding: '4px 0',
          cursor: 'pointer',
          fontStyle: 'italic',
          transition: 'color 0.2s ease',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-secondary)' }}
        onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-ghost)' }}
      >
        {value}
      </div>
    )
  }

  return (
    <input
      ref={inputRef}
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value.slice(0, 120))}
      onBlur={() => setEditing(false)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === 'Escape') {
          setEditing(false)
        }
      }}
      placeholder={t['intention.placeholder']}
      maxLength={120}
      style={{
        width: '100%',
        background: 'none',
        border: 'none',
        borderBottom: '1px solid var(--border-light)',
        fontFamily: "'Inter', sans-serif",
        fontSize: 12,
        color: 'var(--text-secondary)',
        padding: '4px 0',
        outline: 'none',
      }}
    />
  )
}
