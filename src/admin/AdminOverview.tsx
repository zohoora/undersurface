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
        marginBottom: 16,
      }}>
        {metrics.map((m) => (
          <div key={m.label} style={{
            background: '#FFFFFF',
            borderRadius: 8,
            padding: '20px 24px',
            border: '1px solid #E8E4DF',
          }}>
            <div style={{ fontSize: 12, color: '#A09A94', marginBottom: 8 }}>{m.label}</div>
            <div style={{ fontSize: 28, fontWeight: 600 }}>{m.value.toLocaleString()}</div>
          </div>
        ))}
      </div>

      {data.refreshedAt && (
        <div style={{ fontSize: 11, color: '#C4BEB8', marginBottom: 24 }}>
          Totals (except users) last refreshed: {new Date(data.refreshedAt).toLocaleString()}
        </div>
      )}

      {data.writingHabits && (
        <MetricSection title="Writing Habits">
          <MetricGrid items={[
            { label: 'Total Sessions', value: data.writingHabits.totalSessions.toLocaleString() },
            { label: 'Avg Duration', value: data.writingHabits.avgSessionDuration > 0 ? formatDuration(data.writingHabits.avgSessionDuration) : '\u2014' },
            { label: 'Avg Sessions / User', value: String(data.writingHabits.avgSessionsPerUser) },
            { label: 'Peak Hour', value: data.writingHabits.peakWritingHour != null ? formatHour(data.writingHabits.peakWritingHour) : '\u2014' },
          ]} />
        </MetricSection>
      )}

      {data.emotionalLandscape && (
        <MetricSection title="Emotional Landscape">
          <MetricGrid items={[
            { label: 'Weather Adoption', value: `${data.emotionalLandscape.weatherAdoptionPercent}%` },
            { label: 'Avg Intensity', value: String(data.emotionalLandscape.avgIntensity) },
          ]} />
          {data.emotionalLandscape.topEmotions.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 12, color: '#A09A94', marginBottom: 8 }}>Top Emotions</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {data.emotionalLandscape.topEmotions.map((e) => (
                  <span key={e.emotion} style={{
                    fontSize: 12,
                    background: '#F5F3F0',
                    padding: '4px 10px',
                    borderRadius: 12,
                    color: '#6B6560',
                  }}>
                    {e.emotion} ({e.count})
                  </span>
                ))}
              </div>
            </div>
          )}
        </MetricSection>
      )}

      {data.featureAdoption && (
        <MetricSection title="Feature Adoption">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <AdoptionBar label="User Profiles" percent={data.featureAdoption.profileAdoptionPercent} />
            <AdoptionBar label="Part Letters" percent={data.featureAdoption.letterAdoptionPercent} />
            <AdoptionBar label="Entry Fossils" percent={data.featureAdoption.fossilAdoptionPercent} />
          </div>
          <div style={{ marginTop: 12, fontSize: 13, color: '#6B6560' }}>
            Avg parts per user: <strong>{data.featureAdoption.avgPartsPerUser}</strong>
          </div>
        </MetricSection>
      )}

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

function MetricSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <h3 style={{ fontSize: 14, fontWeight: 500, marginBottom: 12 }}>{title}</h3>
      <div style={{
        background: '#FFFFFF',
        borderRadius: 8,
        padding: 20,
        border: '1px solid #E8E4DF',
      }}>
        {children}
      </div>
    </div>
  )
}

function MetricGrid({ items }: { items: Array<{ label: string; value: string }> }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(items.length, 4)}, 1fr)`, gap: 16 }}>
      {items.map((item) => (
        <div key={item.label}>
          <div style={{ fontSize: 11, color: '#A09A94', marginBottom: 4 }}>{item.label}</div>
          <div style={{ fontSize: 20, fontWeight: 600 }}>{item.value}</div>
        </div>
      ))}
    </div>
  )
}

function AdoptionBar({ label, percent }: { label: string; percent: number }) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
        <span style={{ color: '#6B6560' }}>{label}</span>
        <span style={{ color: '#A09A94' }}>{percent}%</span>
      </div>
      <div style={{ background: '#F0EDE9', borderRadius: 4, height: 6, overflow: 'hidden' }}>
        <div style={{ background: '#8B8580', borderRadius: 4, height: '100%', width: `${percent}%`, transition: 'width 0.3s' }} />
      </div>
    </div>
  )
}

function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60000)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  return `${hours}h ${mins}m`
}

function formatHour(hour: number): string {
  if (hour === 0) return '12 AM'
  if (hour < 12) return `${hour} AM`
  if (hour === 12) return '12 PM'
  return `${hour - 12} PM`
}
