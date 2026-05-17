import type { PolarH10Status } from '../../engine/polarH10Engine'

interface Props {
  supported: boolean
  enabled: boolean
  status: PolarH10Status
  deviceName: string | null
  onClick: () => void
}

const STATUS_LABELS: Record<PolarH10Status, string> = {
  idle: 'Connect H10',
  requesting: 'Pairing…',
  connecting: 'Connecting…',
  streaming: 'Connect H10',
  reconnecting: 'Reconnecting…',
  disconnected: 'Connect H10',
  error: 'Retry connection',
}

const STATUS_ACCENTS: Record<PolarH10Status, string> = {
  idle: 'transparent',
  requesting: 'transparent',
  connecting: 'transparent',
  streaming: 'rgba(107,143,113,0.18)',
  reconnecting: 'transparent',
  disconnected: 'transparent',
  error: 'rgba(178,93,93,0.15)',
}

export function PolarH10ConnectButton({ supported, enabled, status, deviceName, onClick }: Props) {
  if (!supported) return null

  const label = enabled ? `Disconnect ${deviceName ?? 'H10'}` : STATUS_LABELS[status]
  const accent = enabled ? STATUS_ACCENTS.streaming : STATUS_ACCENTS[status]

  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
      <button
        onClick={onClick}
        aria-label={label}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '6px 12px',
          borderRadius: 8,
          border: '1px solid var(--border-subtle)',
          background: accent,
          color: 'var(--text-secondary)',
          fontFamily: "'Inter', sans-serif",
          fontSize: 12,
          cursor: 'pointer',
          transition: 'background 0.2s ease',
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M7 7l10 10-5 5V2l5 5L7 17" />
        </svg>
        {label}
      </button>
    </div>
  )
}
