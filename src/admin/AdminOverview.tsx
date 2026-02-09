import { useState, useEffect } from 'react'
import { adminFetch } from './adminApi'
import type { AdminOverviewResponse } from './adminTypes'

export function AdminOverview() {
  const [data, setData] = useState<AdminOverviewResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    adminFetch<AdminOverviewResponse>('getOverview')
      .then(setData)
      .catch((e) => setError(e.message))
  }, [])

  if (error) return <div style={{ color: '#B91C1C', fontSize: 13, padding: 20 }}>Error: {error}</div>
  if (!data) return <div style={{ fontSize: 13, color: '#A09A94', padding: 20 }}>Loading...</div>

  const metrics = [
    { label: 'Users', value: data.userCount },
    { label: 'Entries', value: data.totalEntries },
    { label: 'Thoughts', value: data.totalThoughts },
    { label: 'Interactions', value: data.totalInteractions },
  ]

  return (
    <div>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: 16,
        marginBottom: 32,
      }}>
        {metrics.map((m) => (
          <div key={m.label} style={{
            background: '#FFFFFF',
            borderRadius: 8,
            padding: '20px 24px',
            border: '1px solid #E8E4DF',
          }}>
            <div style={{ fontSize: 12, color: '#A09A94', marginBottom: 8 }}>{m.label}</div>
            <div style={{ fontSize: 28, fontWeight: 600 }}>{m.value}</div>
          </div>
        ))}
      </div>

      <h3 style={{ fontSize: 14, fontWeight: 500, marginBottom: 16 }}>Recent Activity</h3>
      {data.recentActivity.length === 0 ? (
        <div style={{ fontSize: 13, color: '#A09A94' }}>No recent activity</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {data.recentActivity.map((item) => (
            <div key={item.entryId} style={{
              background: '#FFFFFF',
              borderRadius: 8,
              padding: '14px 20px',
              border: '1px solid #E8E4DF',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}>
              <div>
                <span style={{ fontSize: 13, fontWeight: 500 }}>{item.displayName}</span>
                <span style={{ fontSize: 12, color: '#A09A94', marginLeft: 12 }}>
                  {item.preview.slice(0, 80)}{item.preview.length > 80 ? '...' : ''}
                </span>
              </div>
              <div style={{ fontSize: 11, color: '#C4BEB8', whiteSpace: 'nowrap' }}>
                {new Date(item.updatedAt).toLocaleDateString()}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
