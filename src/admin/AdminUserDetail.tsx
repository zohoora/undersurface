import { useState, useEffect, useMemo } from 'react'
import { adminFetch } from './adminApi'
import type { AdminUserDetailResponse, AdminConversation, AdminSessionMessage } from './adminTypes'

type DetailTab = 'entries' | 'parts' | 'conversations' | 'thoughts' | 'memories' | 'profile' | 'sessions' | 'weather' | 'letters' | 'fossils'

interface Props {
  uid: string
  onBack: () => void
}

export function AdminUserDetail({ uid, onBack }: Props) {
  const [data, setData] = useState<AdminUserDetailResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<DetailTab>('entries')

  useEffect(() => {
    adminFetch<AdminUserDetailResponse>('getUserDetail', { uid })
      .then(setData)
      .catch((e) => setError(e.message))
  }, [uid])

  if (error) return <div style={{ color: '#B91C1C', fontSize: 13, padding: 20 }}>Error: {error}</div>
  if (!data) return <div style={{ fontSize: 13, color: '#A09A94', padding: 20 }}>Loading...</div>

  const detailTabs: { id: DetailTab; label: string }[] = [
    { id: 'entries', label: `Entries (${data.entries.length})` },
    { id: 'parts', label: `Parts (${data.parts.length})` },
    { id: 'conversations', label: `Conversations (${data.conversations.length})` },
    { id: 'thoughts', label: `Thoughts (${data.thoughts.length})` },
    { id: 'memories', label: `Memories (${data.memories.length})` },
    { id: 'profile', label: 'Profile' },
    { id: 'sessions', label: `Writing Log (${data.sessions.length})` },
    { id: 'weather', label: `Weather (${data.weather.length})` },
    { id: 'letters', label: `Letters (${data.letters.length})` },
    { id: 'fossils', label: `Fossils (${data.fossils.length})` },
  ]

  return (
    <div>
      <button
        onClick={onBack}
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          fontSize: 13,
          color: '#A09A94',
          padding: '0 0 16px',
          fontFamily: 'inherit',
        }}
      >
        &larr; Back to users
      </button>

      <div style={{
        background: '#FFFFFF',
        borderRadius: 8,
        padding: 20,
        border: '1px solid #E8E4DF',
        marginBottom: 20,
        display: 'flex',
        alignItems: 'center',
        gap: 16,
      }}>
        {data.user.photoURL && (
          <img src={data.user.photoURL} alt="" style={{ width: 48, height: 48, borderRadius: '50%' }} />
        )}
        <div>
          <div style={{ fontSize: 16, fontWeight: 500 }}>{data.user.displayName || 'Unknown'}</div>
          <div style={{ fontSize: 13, color: '#A09A94' }}>{data.user.email}</div>
          {data.user.createdAt && (
            <div style={{ fontSize: 11, color: '#C4BEB8', marginTop: 2 }}>
              Joined {new Date(data.user.createdAt).toLocaleDateString()}
            </div>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid #E8E4DF', marginBottom: 20, flexWrap: 'wrap' }}>
        {detailTabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              padding: '10px 16px',
              fontSize: 12,
              background: 'none',
              border: 'none',
              borderBottom: tab === t.id ? '2px solid #2D2B29' : '2px solid transparent',
              color: tab === t.id ? '#2D2B29' : '#A09A94',
              cursor: 'pointer',
              fontFamily: 'inherit',
              fontWeight: tab === t.id ? 500 : 400,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'entries' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {data.entries.map((entry) => (
            <EntryCard key={entry.id} entry={entry} />
          ))}
          {data.entries.length === 0 && <div style={{ fontSize: 13, color: '#A09A94' }}>No entries</div>}
        </div>
      )}

      {tab === 'parts' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
          {data.parts.map((part) => (
            <div key={part.id} style={{
              background: '#FFFFFF',
              borderRadius: 8,
              padding: '16px 20px',
              border: '1px solid #E8E4DF',
              borderLeft: `3px solid ${part.color}`,
            }}>
              <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 4 }}>{part.name}</div>
              <div style={{ fontSize: 12, color: '#A09A94', marginBottom: 8 }}>{part.ifsRole}</div>
              <div style={{ fontSize: 12, color: '#6B6560' }}>{part.concern}</div>
              {part.learnedKeywords && part.learnedKeywords.length > 0 && (
                <div style={{ fontSize: 11, color: '#C4BEB8', marginTop: 8 }}>
                  Keywords: {part.learnedKeywords.join(', ')}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {tab === 'conversations' && (
        <ConversationsTab conversations={data.conversations} uid={uid} parts={data.parts} />
      )}

      {tab === 'thoughts' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {data.thoughts.slice(0, 50).map((t) => (
            <div key={t.id} style={{
              background: '#FFFFFF',
              borderRadius: 6,
              padding: '10px 16px',
              border: '1px solid #E8E4DF',
              fontSize: 13,
            }}>
              <span style={{ color: '#A09A94', fontSize: 11, marginRight: 8 }}>
                {new Date(t.timestamp).toLocaleDateString()}
              </span>
              {t.content}
            </div>
          ))}
          {data.thoughts.length === 0 && <div style={{ fontSize: 13, color: '#A09A94' }}>No thoughts</div>}
          {data.thoughts.length > 50 && (
            <div style={{ fontSize: 12, color: '#A09A94' }}>Showing first 50 of {data.thoughts.length}</div>
          )}
        </div>
      )}

      {tab === 'memories' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {data.memories.length === 0 ? (
            <div style={{ fontSize: 13, color: '#A09A94' }}>No memories</div>
          ) : (
            [...data.memories]
              .sort((a, b) => b.timestamp - a.timestamp)
              .slice(0, 50)
              .map((m) => (
                <div key={m.id} style={{
                  background: '#FFFFFF',
                  borderRadius: 6,
                  padding: '10px 16px',
                  border: '1px solid #E8E4DF',
                  fontSize: 13,
                }}>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 4 }}>
                    <span style={{ color: '#A09A94', fontSize: 11 }}>
                      {new Date(m.timestamp).toLocaleDateString()}
                    </span>
                    {m.type && (
                      <span style={{
                        fontSize: 10,
                        background: '#F0EDE9',
                        color: '#8B8580',
                        padding: '1px 6px',
                        borderRadius: 6,
                      }}>
                        {m.type}
                      </span>
                    )}
                  </div>
                  <div style={{ color: '#6B6560', lineHeight: 1.5 }}>{m.content}</div>
                </div>
              ))
          )}
          {data.memories.length > 50 && (
            <div style={{ fontSize: 12, color: '#A09A94', marginTop: 4 }}>Showing first 50 of {data.memories.length}</div>
          )}
        </div>
      )}

      {tab === 'profile' && data.userProfile && (
        <div style={{
          background: '#FFFFFF',
          borderRadius: 8,
          padding: 20,
          border: '1px solid #E8E4DF',
          fontSize: 13,
        }}>
          <ProfileSection label="Inner Landscape" value={data.userProfile.innerLandscape} />
          <ProfileSection label="Recurring Themes" items={data.userProfile.recurringThemes} />
          <ProfileSection label="Emotional Patterns" items={data.userProfile.emotionalPatterns} />
          <ProfileSection label="Avoidance Patterns" items={data.userProfile.avoidancePatterns} />
          <ProfileSection label="Growth Signals" items={data.userProfile.growthSignals} />
        </div>
      )}
      {tab === 'profile' && !data.userProfile && (
        <div style={{ fontSize: 13, color: '#A09A94' }}>No profile data yet</div>
      )}

      {tab === 'sessions' && (
        <div>
          {data.sessions.length === 0 ? (
            <div style={{ fontSize: 13, color: '#A09A94' }}>No writing sessions recorded</div>
          ) : (
            <table style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: 13,
              background: '#FFFFFF',
              borderRadius: 8,
              overflow: 'hidden',
              border: '1px solid #E8E4DF',
            }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #E8E4DF' }}>
                  {['Date', 'Time of Day', 'Duration', 'Words'].map((h) => (
                    <th key={h} style={{
                      padding: '10px 16px',
                      textAlign: 'left',
                      fontWeight: 500,
                      fontSize: 12,
                      color: '#A09A94',
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...data.sessions]
                  .sort((a, b) => b.startedAt - a.startedAt)
                  .slice(0, 50)
                  .map((s) => (
                    <tr key={s.id} style={{ borderBottom: '1px solid #F0EDE9' }}>
                      <td style={{ padding: '10px 16px' }}>{new Date(s.startedAt).toLocaleDateString()}</td>
                      <td style={{ padding: '10px 16px', color: '#A09A94' }}>{s.timeOfDay}</td>
                      <td style={{ padding: '10px 16px' }}>
                        {s.duration ? `${Math.round(s.duration / 60000)}m` : '\u2014'}
                      </td>
                      <td style={{ padding: '10px 16px' }}>{s.wordCount}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )}
          {data.sessions.length > 50 && (
            <div style={{ fontSize: 12, color: '#A09A94', marginTop: 8 }}>Showing first 50 of {data.sessions.length}</div>
          )}
        </div>
      )}

      {tab === 'weather' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {data.weather.length === 0 ? (
            <div style={{ fontSize: 13, color: '#A09A94' }}>No weather data</div>
          ) : (
            [...data.weather]
              .sort((a, b) => b.updatedAt - a.updatedAt)
              .slice(0, 30)
              .map((w) => (
                <div key={w.id} style={{
                  background: '#FFFFFF',
                  borderRadius: 8,
                  padding: '12px 20px',
                  border: '1px solid #E8E4DF',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}>
                  <div>
                    <span style={{ fontSize: 13, fontWeight: 500 }}>{w.dominantEmotion}</span>
                    {w.secondaryEmotion && (
                      <span style={{ fontSize: 12, color: '#A09A94', marginLeft: 8 }}>+ {w.secondaryEmotion}</span>
                    )}
                    <span style={{ fontSize: 11, color: '#C4BEB8', marginLeft: 12 }}>
                      intensity {w.intensity} &middot; {w.trend}
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: '#C4BEB8' }}>
                    {new Date(w.updatedAt).toLocaleDateString()}
                  </div>
                </div>
              ))
          )}
        </div>
      )}

      {tab === 'letters' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {data.letters.length === 0 ? (
            <div style={{ fontSize: 13, color: '#A09A94' }}>No letters</div>
          ) : (
            [...data.letters]
              .sort((a, b) => b.createdAt - a.createdAt)
              .map((l) => (
                <div key={l.id} style={{
                  background: '#FFFFFF',
                  borderRadius: 8,
                  padding: '14px 20px',
                  border: '1px solid #E8E4DF',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                    <span style={{
                      fontSize: 11,
                      background: l.isRead ? '#E8F5E9' : '#FFF3E0',
                      color: l.isRead ? '#2E7D32' : '#E65100',
                      padding: '2px 8px',
                      borderRadius: 8,
                    }}>
                      {l.isRead ? 'Read' : 'Unread'}
                    </span>
                    <span style={{ fontSize: 11, color: '#C4BEB8' }}>
                      {l.triggerType} &middot; {new Date(l.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                  <div style={{ fontSize: 13, color: '#6B6560', lineHeight: 1.6 }}>
                    {l.content.slice(0, 300)}{l.content.length > 300 ? '...' : ''}
                  </div>
                </div>
              ))
          )}
        </div>
      )}

      {tab === 'fossils' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {data.fossils.length === 0 ? (
            <div style={{ fontSize: 13, color: '#A09A94' }}>No fossils</div>
          ) : (
            [...data.fossils]
              .sort((a, b) => b.createdAt - a.createdAt)
              .map((f) => (
                <div key={f.id} style={{
                  background: '#FFFFFF',
                  borderRadius: 8,
                  padding: '14px 20px',
                  border: '1px solid #E8E4DF',
                }}>
                  <div style={{ fontSize: 11, color: '#C4BEB8', marginBottom: 6 }}>
                    {new Date(f.createdAt).toLocaleDateString()}
                  </div>
                  <div style={{ fontSize: 13, color: '#6B6560', lineHeight: 1.6 }}>
                    {f.commentary}
                  </div>
                </div>
              ))
          )}
        </div>
      )}
    </div>
  )
}

function ConversationsTab({ conversations, uid, parts }: {
  conversations: AdminConversation[]
  uid: string
  parts: Array<{ id: string; name: string; color: string }>
}) {
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

function EntryCard({ entry }: { entry: { id: string; plainText: string; createdAt: number; updatedAt: number; intention?: string | null } }) {
  const [expanded, setExpanded] = useState(false)
  const truncated = entry.plainText.length > 300

  return (
    <div
      onClick={truncated ? () => setExpanded((e) => !e) : undefined}
      style={{
        background: '#FFFFFF',
        borderRadius: 8,
        padding: '14px 20px',
        border: '1px solid #E8E4DF',
        cursor: truncated ? 'pointer' : 'default',
      }}
    >
      <div style={{ fontSize: 11, color: '#C4BEB8', marginBottom: 6 }}>
        {new Date(entry.createdAt).toLocaleDateString()} &middot; {new Date(entry.updatedAt).toLocaleTimeString()}
      </div>
      {entry.intention && (
        <div style={{ fontSize: 12, fontStyle: 'italic', color: '#8B8580', marginBottom: 6 }}>
          {entry.intention}
        </div>
      )}
      <div style={{ fontSize: 13, color: '#6B6560', lineHeight: 1.6, whiteSpace: expanded ? 'pre-wrap' : undefined }}>
        {expanded ? entry.plainText : entry.plainText.slice(0, 300)}{!expanded && truncated ? '...' : ''}
      </div>
      {truncated && (
        <div style={{ fontSize: 11, color: '#A09A94', marginTop: 6 }}>
          {expanded ? 'Click to collapse' : 'Click to expand'}
        </div>
      )}
    </div>
  )
}

function ProfileSection({ label, value, items }: { label: string; value?: string; items?: string[] }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 12, fontWeight: 500, color: '#A09A94', marginBottom: 6 }}>{label}</div>
      {value && <div style={{ color: '#6B6560', lineHeight: 1.6 }}>{value}</div>}
      {items && items.length > 0 && (
        <ul style={{ margin: 0, paddingLeft: 20, color: '#6B6560', lineHeight: 1.8 }}>
          {items.map((item, i) => <li key={i}>{item}</li>)}
        </ul>
      )}
      {items && items.length === 0 && <div style={{ color: '#C4BEB8' }}>None yet</div>}
    </div>
  )
}
