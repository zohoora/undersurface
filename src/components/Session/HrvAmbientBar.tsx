import { useState } from 'react'
import type { HrvMeasurement } from '../../types'

interface Props {
  latest: HrvMeasurement | null
  measurementCount: number
  isCalibrating: boolean
  error: string | null
}

export function BiometricsBar({ latest, measurementCount, isCalibrating, error }: Props) {
  const [expanded, setExpanded] = useState(false)

  const stateColor = !latest || isCalibrating ? 'rgba(120,120,120,0.08)'
    : latest.autonomicState === 'calm' ? 'rgba(107,143,113,0.10)'
    : latest.autonomicState === 'activated' ? 'rgba(178,132,93,0.10)'
    : 'rgba(150,140,120,0.08)'

  const confidencePercent = latest ? Math.round(latest.confidence * 100) : 0
  const signalDot = confidencePercent >= 70 ? '#6b8f71'
    : confidencePercent >= 40 ? '#b8a060'
    : '#b07060'

  const statusText = error ? error
    : isCalibrating ? 'Calibrating…'
    : latest?.autonomicState ?? 'Starting…'

  return (
    <div
      onClick={() => setExpanded(e => !e)}
      style={{
        padding: '5px 12px',
        borderRadius: 8,
        background: stateColor,
        transition: 'background 2s ease',
        cursor: 'pointer',
        userSelect: 'none',
      }}
    >
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        fontSize: 12,
        fontFamily: "'Inter', sans-serif",
        color: 'var(--text-secondary, #aaa)',
      }}>
        <span style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: signalDot,
          flexShrink: 0,
        }} />

        <span style={{
          fontWeight: 600,
          color: 'var(--text-primary)',
          fontVariantNumeric: 'tabular-nums',
          fontSize: 13,
        }}>
          {latest ? `${latest.hr}` : '--'}
          <span style={{ fontWeight: 400, fontSize: 10, color: 'var(--text-tertiary, #888)' }}> bpm</span>
        </span>

        <span style={{ fontSize: 11, textTransform: 'capitalize' }}>
          {statusText}
        </span>

        <span style={{ flex: 1 }} />

        {latest?.derived && (
          <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: 11 }}>
            <span style={{ color: 'var(--text-tertiary, #888)', fontSize: 10 }}>SI </span>
            {latest.derived.stressIndex}
          </span>
        )}

        <span style={{ fontSize: 10, opacity: 0.5, transition: 'transform 0.2s', transform: expanded ? 'rotate(180deg)' : 'rotate(0)' }}>
          ▾
        </span>
      </div>

      {expanded && latest && (
        <div style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '4px 14px',
          marginTop: 6,
          paddingTop: 6,
          borderTop: '1px solid var(--border-subtle, rgba(255,255,255,0.08))',
          fontSize: 11,
          fontFamily: "'Inter', sans-serif",
          color: 'var(--text-tertiary, #888)',
        }}>
          <Metric label="RMSSD" value={`${latest.rmssd.toFixed(1)} ms`} />
          {latest.respiratoryRate != null && (
            <Metric label="Breath" value={`${latest.respiratoryRate}/min`} />
          )}
          {latest.derived?.lfHfRatio != null && (
            <Metric label="LF/HF" value={`${latest.derived.lfHfRatio}`} />
          )}
          <Metric label="Signal" value={`${confidencePercent}%`} color={signalDot} />
          <Metric label="Samples" value={`${measurementCount}`} />
        </div>
      )}
    </div>
  )
}

function Metric({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <span>
      <span style={{ fontSize: 10, marginRight: 3 }}>{label}</span>
      <span style={{
        fontWeight: 500,
        color: color ?? 'var(--text-secondary, #aaa)',
        fontVariantNumeric: 'tabular-nums',
      }}>
        {value}
      </span>
    </span>
  )
}
