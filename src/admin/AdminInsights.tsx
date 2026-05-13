import { useAdminMutation } from './useAdminMutation'
import type { AdminInsightsResponse } from './adminTypes'

export function AdminInsights() {
  const { run, data, error, loading } = useAdminMutation<AdminInsightsResponse>('generateInsights')
  const handleGenerate = () => { void run() }

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <button
          onClick={handleGenerate}
          disabled={loading}
          style={{
            padding: '10px 24px',
            fontSize: 13,
            fontFamily: "'Inter', sans-serif",
            background: loading ? '#E8E4DF' : '#2D2B29',
            color: loading ? '#A09A94' : '#FFFFFF',
            border: 'none',
            borderRadius: 6,
            cursor: loading ? 'default' : 'pointer',
          }}
        >
          {loading ? 'Generating...' : 'Generate Insights'}
        </button>
        {loading && (
          <span style={{ fontSize: 12, color: '#A09A94', marginLeft: 12 }}>
            This may take 10-30 seconds
          </span>
        )}
      </div>

      {error && <div style={{ color: '#B91C1C', fontSize: 13, marginBottom: 16 }}>Error: {error}</div>}

      {data && (
        <div style={{
          background: '#FFFFFF',
          borderRadius: 8,
          padding: 24,
          border: '1px solid #E8E4DF',
        }}>
          <div style={{ fontSize: 14, lineHeight: 1.8, color: '#2D2B29', marginBottom: 24, whiteSpace: 'pre-wrap' }}>
            {data.narrative}
          </div>

          {data.highlights.length > 0 && (
            <>
              <h4 style={{ fontSize: 13, fontWeight: 500, marginBottom: 12, color: '#6B6560' }}>Highlights</h4>
              <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13, color: '#6B6560', lineHeight: 1.8 }}>
                {data.highlights.map((h, i) => <li key={i}>{h}</li>)}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  )
}
