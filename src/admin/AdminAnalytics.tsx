import { useState, useEffect } from 'react'
import { adminFetch } from './adminApi'
import type { AdminAnalyticsResponse } from './adminTypes'

const cardStyle = {
  background: '#FFFFFF',
  borderRadius: 8,
  padding: '20px 24px',
  border: '1px solid #E8E4DF',
}

function BarChart({ items, labelKey, valueKey, colorKey }: {
  items: Array<Record<string, unknown>>
  labelKey: string
  valueKey: string
  colorKey?: string
}) {
  const maxValue = Math.max(...items.map((i) => i[valueKey] as number), 1)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {items.map((item, idx) => (
        <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ fontSize: 12, color: '#A09A94', width: 80, textAlign: 'right', flexShrink: 0 }}>
            {String(item[labelKey])}
          </div>
          <div style={{ flex: 1, height: 24, background: '#F5F2EF', borderRadius: 4, overflow: 'hidden' }}>
            <div style={{
              height: '100%',
              width: `${((item[valueKey] as number) / maxValue) * 100}%`,
              background: colorKey && item[colorKey] ? String(item[colorKey]) : '#C4BEB8',
              borderRadius: 4,
              minWidth: (item[valueKey] as number) > 0 ? 4 : 0,
              transition: 'width 0.3s ease',
            }} />
          </div>
          <div style={{ fontSize: 12, fontWeight: 500, width: 36, flexShrink: 0 }}>
            {item[valueKey] as number}
          </div>
        </div>
      ))}
    </div>
  )
}

export function AdminAnalytics() {
  const [data, setData] = useState<AdminAnalyticsResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    adminFetch<AdminAnalyticsResponse>('getAnalytics')
      .then(setData)
      .catch((e) => setError(e.message))
  }, [])

  if (error) return <div style={{ color: '#B91C1C', fontSize: 13, padding: 20 }}>Error: {error}</div>
  if (!data) return <div style={{ fontSize: 13, color: '#A09A94', padding: 20 }}>Loading analytics...</div>

  const retentionMetrics = [
    { label: 'Daily active', value: data.activeUsers.daily },
    { label: 'Weekly active', value: data.activeUsers.weekly },
    { label: 'Monthly active', value: data.activeUsers.monthly },
  ]

  const engagementMetrics = [
    { label: 'Avg words / entry', value: data.averageWordsPerEntry },
    { label: 'Avg entries / user', value: data.averageEntriesPerUser },
    { label: 'Total words', value: data.totalWords.toLocaleString() },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Retention */}
      <div>
        <h3 style={{ fontSize: 14, fontWeight: 500, marginBottom: 12 }}>Active Users</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
          {retentionMetrics.map((m) => (
            <div key={m.label} style={cardStyle}>
              <div style={{ fontSize: 12, color: '#A09A94', marginBottom: 8 }}>{m.label}</div>
              <div style={{ fontSize: 28, fontWeight: 600 }}>{m.value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Engagement */}
      <div>
        <h3 style={{ fontSize: 14, fontWeight: 500, marginBottom: 12 }}>Engagement</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
          {engagementMetrics.map((m) => (
            <div key={m.label} style={cardStyle}>
              <div style={{ fontSize: 12, color: '#A09A94', marginBottom: 8 }}>{m.label}</div>
              <div style={{ fontSize: 28, fontWeight: 600 }}>{m.value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Entries by day */}
      {data.entriesByDay.length > 0 && (
        <div>
          <h3 style={{ fontSize: 14, fontWeight: 500, marginBottom: 12 }}>Entries (last 14 days)</h3>
          <div style={cardStyle}>
            <BarChart items={data.entriesByDay} labelKey="date" valueKey="count" />
          </div>
        </div>
      )}

      {/* Signups by week */}
      {data.signupsByWeek.length > 0 && (
        <div>
          <h3 style={{ fontSize: 14, fontWeight: 500, marginBottom: 12 }}>Signups (last 12 weeks)</h3>
          <div style={cardStyle}>
            <BarChart items={data.signupsByWeek} labelKey="week" valueKey="count" />
          </div>
        </div>
      )}

      {/* Part usage */}
      {data.partUsage.length > 0 && (
        <div>
          <h3 style={{ fontSize: 14, fontWeight: 500, marginBottom: 12 }}>Part Usage (thoughts by part)</h3>
          <div style={cardStyle}>
            <BarChart items={data.partUsage} labelKey="name" valueKey="count" colorKey="color" />
          </div>
        </div>
      )}
    </div>
  )
}
