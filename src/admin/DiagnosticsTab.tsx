import { useMemo, useState } from 'react'
import { useAdminQuery } from './useAdminQuery'
import type { DiagnosticEvent, Severity } from '../services/diagnostics'

export function DiagnosticsTab({ uid }: { uid: string }) {
  const diagnosticsParams = useMemo(() => ({ uid, limit: 200 }), [uid])
  const { data, error } = useAdminQuery<{ events: DiagnosticEvent[] }>('getDiagnostics', diagnosticsParams)
  const events = data?.events ?? null
  const [expanded, setExpanded] = useState<string | null>(null)

  if (error) return <div style={{ color: '#B91C1C', fontSize: 13 }}>Error: {error}</div>
  if (!events) return <div style={{ fontSize: 13, color: '#A09A94' }}>Loading...</div>
  if (events.length === 0) return <div style={{ fontSize: 13, color: '#A09A94' }}>No diagnostic events</div>

  const severityStyle = (s: Severity) =>
    s === 'error' ? { bg: '#FEE2E2', fg: '#991B1B' }
    : s === 'warn' ? { bg: '#FEF3C7', fg: '#92400E' }
    : { bg: '#F0EDE9', fg: '#8B8580' }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {events.map((ev) => {
        const sev = severityStyle(ev.severity)
        const isExpanded = expanded === ev.id
        const hasContext = ev.context && Object.keys(ev.context).length > 0
        return (
          <div
            key={ev.id}
            onClick={hasContext ? () => setExpanded((p) => p === ev.id ? null : ev.id) : undefined}
            style={{
              background: '#FFFFFF',
              borderRadius: 6,
              padding: '10px 14px',
              border: '1px solid #E8E4DF',
              cursor: hasContext ? 'pointer' : 'default',
              fontSize: 13,
            }}
          >
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 4 }}>
              <span style={{ fontSize: 11, color: '#A09A94', fontFamily: 'monospace' }}>
                {new Date(ev.timestamp).toLocaleString()}
              </span>
              <span style={{
                fontSize: 10, padding: '1px 6px', borderRadius: 4,
                background: sev.bg, color: sev.fg, fontWeight: 500,
              }}>
                {ev.severity}
              </span>
              <span style={{ fontSize: 11, color: '#6B6560', fontFamily: 'monospace' }}>{ev.code}</span>
              {ev.repeatCount && ev.repeatCount > 1 && (
                <span style={{
                  fontSize: 10, padding: '1px 6px', borderRadius: 4,
                  background: '#E8E4DF', color: '#6B6560',
                }}>
                  ×{ev.repeatCount}
                </span>
              )}
            </div>
            <div style={{ color: '#6B6560' }}>{ev.msg}</div>
            {isExpanded && hasContext && (
              <pre style={{
                marginTop: 8, fontSize: 11, color: '#8B8580',
                background: '#F8F6F4', padding: 8, borderRadius: 4,
                overflowX: 'auto',
              }}>
                {JSON.stringify(ev.context, null, 2)}
              </pre>
            )}
          </div>
        )
      })}
    </div>
  )
}
