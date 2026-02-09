import { useState, useEffect } from 'react'
import { adminFetch } from './adminApi'
import type { AdminUserDetailResponse } from './adminTypes'

type DetailTab = 'entries' | 'parts' | 'thoughts' | 'profile'

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
        </div>
      </div>

      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid #E8E4DF', marginBottom: 20 }}>
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
            <div key={entry.id} style={{
              background: '#FFFFFF',
              borderRadius: 8,
              padding: '14px 20px',
              border: '1px solid #E8E4DF',
            }}>
              <div style={{ fontSize: 11, color: '#C4BEB8', marginBottom: 6 }}>
                {new Date(entry.createdAt).toLocaleDateString()} &middot; {new Date(entry.updatedAt).toLocaleTimeString()}
              </div>
              <div style={{ fontSize: 13, color: '#6B6560', lineHeight: 1.6 }}>
                {entry.plainText.slice(0, 300)}{entry.plainText.length > 300 ? '...' : ''}
              </div>
            </div>
          ))}
          {data.entries.length === 0 && <div style={{ fontSize: 13, color: '#A09A94' }}>No entries</div>}
        </div>
      )}

      {tab === 'parts' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280, 1fr))', gap: 12 }}>
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
