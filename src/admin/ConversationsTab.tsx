import { useMemo, useState } from 'react'
import { adminFetch } from './adminApi'
import type { AdminConversation, AdminSessionMessage } from './adminTypes'

interface Props {
  conversations: AdminConversation[]
  uid: string
  parts: Array<{ id: string; name: string; color: string }>
}

export function ConversationsTab({ conversations, uid, parts }: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Record<string, AdminSessionMessage[]>>({})
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const [errorId, setErrorId] = useState<string | null>(null)

  const sorted = useMemo(
    () => [...conversations].sort((a, b) => b.startedAt - a.startedAt),
    [conversations],
  )

  const partMap = useMemo(
    () => new Map(parts.map((p) => [p.id, p])),
    [parts],
  )

  const handleExpand = async (convo: AdminConversation) => {
    if (expandedId === convo.id) {
      setExpandedId(null)
      return
    }
    setExpandedId(convo.id)
    setErrorId(null)
    if (!messages[convo.id]) {
      setLoadingId(convo.id)
      try {
        const result = await adminFetch<{ messages: AdminSessionMessage[] }>('getSessionMessages', { uid, sessionId: convo.id })
        setMessages((prev) => ({ ...prev, [convo.id]: result.messages }))
      } catch {
        setErrorId(convo.id)
      } finally {
        setLoadingId(null)
      }
    }
  }

  const getPartName = (partId: string | null) => {
    if (!partId) return null
    return partMap.get(partId)?.name || partId
  }

  const getPartColor = (partId: string | null) => {
    if (!partId) return undefined
    return partMap.get(partId)?.color
  }

  const formatDuration = (convo: AdminConversation) => {
    if (!convo.endedAt) return 'active'
    const mins = Math.round((convo.endedAt - convo.startedAt) / 60000)
    if (mins < 60) return `${mins}m`
    return `${Math.floor(mins / 60)}h ${mins % 60}m`
  }

  const hostLabel = (convo: AdminConversation) => {
    if (convo.isTherapistSession) return 'Therapist'
    return getPartName(convo.hostPartId) || convo.hostPartId
  }

  if (sorted.length === 0) {
    return <div style={{ fontSize: 13, color: '#A09A94' }}>No conversations</div>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {sorted.map((convo) => (
        <div key={convo.id} style={{
          background: '#FFFFFF',
          borderRadius: 8,
          border: '1px solid #E8E4DF',
          overflow: 'hidden',
        }}>
          <div
            onClick={() => handleExpand(convo)}
            style={{
              padding: '14px 20px',
              cursor: 'pointer',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span style={{ fontSize: 13, fontWeight: 500 }}>{hostLabel(convo)}</span>
                <span style={{
                  fontSize: 10,
                  padding: '1px 6px',
                  borderRadius: 6,
                  background: convo.status === 'active' ? '#E8F5E9' : '#F0EDE9',
                  color: convo.status === 'active' ? '#2E7D32' : '#8B8580',
                }}>
                  {convo.status}
                </span>
                <span style={{ fontSize: 10, color: '#C4BEB8', background: '#F8F6F3', padding: '1px 6px', borderRadius: 6 }}>
                  {convo.phase}
                </span>
                {convo.favorited && (
                  <span style={{ fontSize: 10, color: '#E6A817' }}>&#9733;</span>
                )}
              </div>
              <div style={{ fontSize: 12, color: '#A09A94', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {convo.firstLine || 'No preview'}
              </div>
            </div>
            <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: 16 }}>
              <div style={{ fontSize: 11, color: '#A09A94' }}>
                {convo.messageCount} msgs &middot; {formatDuration(convo)}
              </div>
              <div style={{ fontSize: 11, color: '#C4BEB8' }}>
                {new Date(convo.startedAt).toLocaleDateString()}
              </div>
            </div>
          </div>

          {expandedId === convo.id && (
            <div style={{ borderTop: '1px solid #E8E4DF', padding: '16px 20px' }}>
              {convo.sessionNote && (
                <div style={{
                  fontSize: 12,
                  fontStyle: 'italic',
                  color: '#8B8580',
                  marginBottom: 12,
                  padding: '8px 12px',
                  background: '#FAF8F5',
                  borderRadius: 6,
                }}>
                  {convo.sessionNote}
                </div>
              )}
              {loadingId === convo.id ? (
                <div style={{ fontSize: 12, color: '#A09A94' }}>Loading messages...</div>
              ) : errorId === convo.id ? (
                <div style={{ fontSize: 12, color: '#B91C1C' }}>Failed to load messages. Click to retry.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {(messages[convo.id] || []).map((msg) => {
                    const isUser = msg.speaker === 'user'
                    const speakerColor = isUser
                      ? '#2D2B29'
                      : msg.speaker === 'therapist'
                        ? '#7C5CBA'
                        : getPartColor(msg.partId) || '#8B8580'
                    const speakerLabel = isUser
                      ? 'User'
                      : msg.speaker === 'therapist'
                        ? 'Therapist'
                        : msg.partName || getPartName(msg.partId) || 'Part'

                    return (
                      <div key={msg.id} style={{
                        padding: '8px 12px',
                        borderLeft: `2px solid ${speakerColor}`,
                        background: isUser ? '#FAF8F5' : '#FFFFFF',
                        borderRadius: 4,
                      }}>
                        <div style={{ fontSize: 10, color: '#A09A94', marginBottom: 2 }}>
                          <span style={{ fontWeight: 500, color: speakerColor }}>{speakerLabel}</span>
                          <span style={{ marginLeft: 8 }}>{new Date(msg.timestamp).toLocaleTimeString()}</span>
                          {msg.isEmergence && (
                            <span style={{ marginLeft: 6, background: '#FFF3E0', color: '#E65100', padding: '0 4px', borderRadius: 4, fontSize: 9 }}>
                              emergence
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: 12, color: '#6B6560', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                          {msg.content}
                        </div>
                      </div>
                    )
                  })}
                  {(messages[convo.id] || []).length === 0 && (
                    <div style={{ fontSize: 12, color: '#A09A94' }}>No messages found</div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
