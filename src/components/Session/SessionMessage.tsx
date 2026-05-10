import { memo } from 'react'
import type { SessionMessage as SessionMessageType } from '../../types'
import { RecommendationSegments } from './RecommendationSegments'

interface Props {
  message: SessionMessageType
  onRecommendationTap?: (target: string) => void
}

export const SessionMessageBubble = memo(function SessionMessageBubble({
  message,
  onRecommendationTap,
}: Props) {
  const isUser = message.speaker === 'user'
  const showRecommendations =
    !isUser && typeof message.content === 'string' && onRecommendationTap

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
          {showRecommendations
            ? <RecommendationSegments text={message.content} onTap={onRecommendationTap} />
            : message.content}
        </div>
      </div>
    </>
  )
})
