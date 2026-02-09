import { useState, useEffect } from 'react'
import { adminFetch } from './adminApi'
import type { AdminUser } from './adminTypes'
import { AdminUserDetail } from './AdminUserDetail'

export function AdminUsers() {
  const [users, setUsers] = useState<AdminUser[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selectedUid, setSelectedUid] = useState<string | null>(null)

  useEffect(() => {
    adminFetch<{ users: AdminUser[] }>('getUserList')
      .then((res) => setUsers(res.users))
      .catch((e) => setError(e.message))
  }, [])

  if (selectedUid) {
    return <AdminUserDetail uid={selectedUid} onBack={() => setSelectedUid(null)} />
  }

  if (error) return <div style={{ color: '#B91C1C', fontSize: 13, padding: 20 }}>Error: {error}</div>
  if (!users) return <div style={{ fontSize: 13, color: '#A09A94', padding: 20 }}>Loading...</div>

  return (
    <div>
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
            {['User', 'Entries', 'Thoughts', 'Interactions', 'Words', 'Last Active'].map((h) => (
              <th key={h} style={{
                padding: '12px 16px',
                textAlign: 'left',
                fontWeight: 500,
                fontSize: 12,
                color: '#A09A94',
              }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr
              key={u.uid}
              onClick={() => setSelectedUid(u.uid)}
              style={{
                borderBottom: '1px solid #F0EDE9',
                cursor: 'pointer',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = '#FAF8F5' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = '' }}
            >
              <td style={{ padding: '12px 16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  {u.photoURL && (
                    <img
                      src={u.photoURL}
                      alt=""
                      style={{ width: 28, height: 28, borderRadius: '50%' }}
                    />
                  )}
                  <div>
                    <div style={{ fontWeight: 500 }}>{u.displayName || 'Unknown'}</div>
                    <div style={{ fontSize: 11, color: '#A09A94' }}>{u.email}</div>
                  </div>
                </div>
              </td>
              <td style={{ padding: '12px 16px' }}>{u.entryCount}</td>
              <td style={{ padding: '12px 16px' }}>{u.thoughtCount}</td>
              <td style={{ padding: '12px 16px' }}>{u.interactionCount}</td>
              <td style={{ padding: '12px 16px' }}>{u.totalWords.toLocaleString()}</td>
              <td style={{ padding: '12px 16px', color: '#A09A94' }}>
                {u.lastActive ? new Date(u.lastActive).toLocaleDateString() : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
