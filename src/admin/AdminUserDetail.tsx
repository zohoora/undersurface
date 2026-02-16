import { useState, useEffect } from 'react'
import { adminFetch } from './adminApi'
import type { AdminUserDetailResponse } from './adminTypes'

type DetailTab = 'entries' | 'parts' | 'thoughts' | 'profile' | 'sessions' | 'weather' | 'letters' | 'fossils'

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
    { id: 'thoughts', label: `Thoughts (${data.thoughts.length})` },
    { id: 'profile', label: 'Profile' },
    { id: 'sessions', label: `Sessions (${data.sessions.length})` },
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
            <div style={{ fontSize: 13, color: '#A09A94' }}>No sessions recorded</div>
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

function EntryCard({ entry }: { entry: { id: string; plainText: string; createdAt: number; updatedAt: number } }) {
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
