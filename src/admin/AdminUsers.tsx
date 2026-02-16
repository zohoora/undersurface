import { useState, useEffect, useMemo } from 'react'
import { adminFetch } from './adminApi'
import type { AdminUser } from './adminTypes'
import { AdminUserDetail } from './AdminUserDetail'

type SortKey = 'displayName' | 'entryCount' | 'thoughtCount' | 'interactionCount' | 'totalWords' | 'partCount' | 'sessionCount' | 'createdAt' | 'lastActive'

const columns: { key: SortKey; label: string }[] = [
  { key: 'displayName', label: 'User' },
  { key: 'entryCount', label: 'Entries' },
  { key: 'thoughtCount', label: 'Thoughts' },
  { key: 'interactionCount', label: 'Interactions' },
  { key: 'totalWords', label: 'Words' },
  { key: 'partCount', label: 'Parts' },
  { key: 'sessionCount', label: 'Sessions' },
  { key: 'createdAt', label: 'Signup' },
  { key: 'lastActive', label: 'Last Active' },
]

export function AdminUsers() {
  const [users, setUsers] = useState<AdminUser[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selectedUid, setSelectedUid] = useState<string | null>(null)
  const [sortBy, setSortBy] = useState<SortKey>('lastActive')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  useEffect(() => {
    adminFetch<{ users: AdminUser[] }>('getUserList')
      .then((res) => setUsers(res.users))
      .catch((e) => setError(e.message))
  }, [])

  const sortedUsers = useMemo(() => {
    if (!users) return null
    return [...users].sort((a, b) => {
      const aVal = a[sortBy]
      const bVal = b[sortBy]
      if (aVal == null && bVal == null) return 0
      if (aVal == null) return 1
      if (bVal == null) return -1
      let cmp: number
      if (typeof aVal === 'string' && typeof bVal === 'string') {
        cmp = aVal.localeCompare(bVal)
      } else {
        cmp = (aVal as number) < (bVal as number) ? -1 : (aVal as number) > (bVal as number) ? 1 : 0
      }
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [users, sortBy, sortDir])

  function handleSort(key: SortKey) {
    if (sortBy === key) {
      setSortDir((d) => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortBy(key)
      setSortDir(key === 'displayName' ? 'asc' : 'desc')
    }
  }

  if (selectedUid) {
    return <AdminUserDetail uid={selectedUid} onBack={() => setSelectedUid(null)} />
  }

  if (error) return <div style={{ color: '#B91C1C', fontSize: 13, padding: 20 }}>Error: {error}</div>
  if (!sortedUsers) return <div style={{ fontSize: 13, color: '#A09A94', padding: 20 }}>Loading...</div>

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
            {columns.map((col) => (
              <th
                key={col.key}
                onClick={() => handleSort(col.key)}
                style={{
                  padding: '12px 16px',
                  textAlign: 'left',
                  fontWeight: 500,
                  fontSize: 12,
                  color: sortBy === col.key ? '#2D2B29' : '#A09A94',
                  cursor: 'pointer',
                  userSelect: 'none',
                  whiteSpace: 'nowrap',
                }}
              >
                {col.label}{' '}
                {sortBy === col.key ? (sortDir === 'asc' ? '\u2191' : '\u2193') : ''}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sortedUsers.map((u) => (
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
              <td style={{ padding: '12px 16px' }}>{u.partCount}</td>
              <td style={{ padding: '12px 16px' }}>{u.sessionCount}</td>
              <td style={{ padding: '12px 16px', color: '#A09A94' }}>
                {u.createdAt ? new Date(u.createdAt).toLocaleDateString() : '\u2014'}
              </td>
              <td style={{ padding: '12px 16px', color: '#A09A94' }}>
                {u.lastActive ? new Date(u.lastActive).toLocaleDateString() : '\u2014'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
