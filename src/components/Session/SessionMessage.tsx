import type { SessionMessage as SessionMessageType } from '../../types'

interface Props {
  message: SessionMessageType
}

export function SessionMessageBubble({ message }: Props) {
  const isUser = message.speaker === 'user'

  return (
    <>
      {message.isEmergence && !isUser && (
        <div style={{
          height: 1,
          background: 'linear-gradient(to right, transparent, var(--border-subtle), transparent)',
          margin: '24px 0',
        }} />
      )}
      <div style={{ marginBottom: 20, opacity: isUser ? 1 : 0.88 }}>
        {!isUser && message.partName && (
          <div style={{
            fontSize: 11,
            fontFamily: "'Inter', sans-serif",
            fontWeight: 500,
            color: 'var(--text-secondary)',
            marginBottom: 4,
            letterSpacing: '0.02em',
          }}>
            {message.partName}
          </div>
        )}
        <div style={{
          fontFamily: "'Spectral', serif",
          fontSize: isUser ? 17 : 16,
          lineHeight: 1.7,
          color: isUser ? 'var(--text-primary)' : 'var(--text-secondary)',
          fontStyle: isUser ? 'normal' : 'italic',
        }}>
          {message.content}
        </div>
      </div>
    </>
  )
}
