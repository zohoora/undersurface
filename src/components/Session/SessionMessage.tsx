import type { SessionMessage as SessionMessageType } from '../../types'
import { parseRecommendations } from '../../ai/therapistRecommendationParser'

interface Props {
  message: SessionMessageType
  unifiedUI?: boolean
  onRecommendationTap?: (target: string) => void
}

export function SessionMessageBubble({ message, unifiedUI, onRecommendationTap }: Props) {
  const isUser = message.speaker === 'user'

  // Plan 1: only therapist messages get recommendation parsing, only when flag is on.
  const shouldParse = unifiedUI === true && !isUser && typeof message.content === 'string'
  const segments = shouldParse ? parseRecommendations(message.content) : null

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
        <div
          className="session-message-text"
          style={{
            color: isUser ? 'var(--text-primary)' : 'var(--text-secondary)',
            fontStyle: isUser ? 'normal' : 'italic',
          }}
        >
          {segments
            ? segments.map((seg, i) =>
                seg.type === 'text' ? (
                  <span key={i}>{seg.text}</span>
                ) : (
                  <button
                    key={i}
                    type="button"
                    className="session-recommendation"
                    onClick={() => onRecommendationTap?.(seg.target)}
                  >
                    {seg.phrase}
                  </button>
                )
              )
            : message.content}
        </div>
      </div>
    </>
  )
}
