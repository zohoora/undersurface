import { useState, type ReactNode } from 'react'
import type { HrvMeasurement, HrvRespiratoryDiagnostics, LandmarkerState, RespiratoryEstimate } from '../../types'

const LANDMARKER_STATE_TEXT: Record<LandmarkerState, string> = {
  loading: 'loading…',
  detecting: 'face ok',
  no_face: 'no face seen',
  failed: 'detector failed',
}

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

        {latest?.respiratoryRate != null && (
          <span style={{
            fontWeight: 600,
            color: 'var(--text-primary)',
            fontVariantNumeric: 'tabular-nums',
            fontSize: 13,
          }}>
            {latest.respiratoryRate}
            <span style={{ fontWeight: 400, fontSize: 10, color: 'var(--text-tertiary, #888)' }}> br/m</span>
          </span>
        )}

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
          marginTop: 6,
          paddingTop: 6,
          borderTop: '1px solid var(--border-subtle, rgba(255,255,255,0.08))',
        }}>
          <div style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '4px 14px',
            fontSize: 11,
            fontFamily: "'Inter', sans-serif",
            color: 'var(--text-tertiary, #888)',
          }}>
            <Metric label="RMSSD" value={`${latest.rmssd.toFixed(1)} ms`} />
            {latest.derived?.lfHfRatio != null && (
              <Metric label="LF/HF" value={`${latest.derived.lfHfRatio}`} />
            )}
            <Metric label="Signal" value={`${confidencePercent}%`} color={signalDot} />
            <Metric label="Samples" value={`${measurementCount}`} />
          </div>
          {latest.respiratoryDiagnostics && (
            <RespiratoryDiagnostics
              smoothed={latest.respiratoryRate}
              diag={latest.respiratoryDiagnostics}
            />
          )}
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

function RespiratoryDiagnostics({
  smoothed,
  diag,
}: {
  smoothed: number | null
  diag: HrvRespiratoryDiagnostics
}) {
  return (
    <div style={{
      marginTop: 8,
      paddingTop: 6,
      borderTop: '1px dashed var(--border-subtle, rgba(255,255,255,0.06))',
      fontSize: 10,
      fontFamily: "'Inter', sans-serif",
      color: 'var(--text-tertiary, #888)',
    }}>
      <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.5, opacity: 0.7, marginBottom: 4 }}>
        Breath sources — rPPG
      </div>
      <RrRow label="Pulse" source={diag.pulse} />
      <RrRow label="RIAV" source={diag.riav} />
      <RrRow label="RIIV" source={diag.riiv} />
      <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.5, opacity: 0.7, margin: '6px 0 4px' }}>
        Motion
      </div>
      <RrRow
        label="Face"
        source={diag.face}
        trailing={
          <span style={{
            opacity: 0.5,
            fontSize: 9,
            color: diag.landmarkerState === 'failed' ? 'var(--accent-warning, #b07060)' : undefined,
          }}>
            {LANDMARKER_STATE_TEXT[diag.landmarkerState]}
          </span>
        }
      />
      <RrRow
        label="Chest"
        source={diag.chest}
        trailing={
          <span style={{ opacity: 0.5, fontSize: 9 }}>
            {diag.chestPresent ? 'in frame' : 'not in frame'}
          </span>
        }
      />
      <RrRow
        label="Fused"
        source={diag.fused}
        topBorder
        trailing={smoothed != null && (
          <span style={{ opacity: 0.6 }}>smoothed {smoothed} br/m</span>
        )}
      />
    </div>
  )
}

function RrRow({
  label,
  source,
  trailing,
  topBorder,
}: {
  label: string
  source: RespiratoryEstimate | null
  trailing?: ReactNode
  topBorder?: boolean
}) {
  return (
    <div style={{
      display: 'flex',
      gap: 8,
      alignItems: 'baseline',
      fontVariantNumeric: 'tabular-nums',
      ...(topBorder ? {
        marginTop: 3,
        paddingTop: 3,
        borderTop: '1px dotted rgba(255,255,255,0.05)',
      } : null),
    }}>
      <span style={{ width: 36, fontSize: 9, opacity: 0.7 }}>{label}</span>
      <span style={{ width: 56 }}>{source ? `${source.rr} br/m` : '—'}</span>
      <span style={{ width: 70 }}>{source ? `conf ${source.confidence.toFixed(2)}` : ''}</span>
      {trailing}
    </div>
  )
}
