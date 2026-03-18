import { useEffect, useRef, useState } from 'react'
import type { HrvMeasurement } from '../../types'

interface Props {
  measurements: HrvMeasurement[]
  stream: MediaStream | null
  isCalibrating: boolean
  error: string | null
}

export function HrvAmbientBar({ measurements, stream, isCalibrating, error }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [, setTick] = useState(0)

  // Attach camera stream to video thumbnail
  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream
      videoRef.current.play().catch(() => {})
    }
  }, [stream])

  // Draw HRV trace on canvas
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || measurements.length < 2) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const w = canvas.width
    const h = canvas.height
    ctx.clearRect(0, 0, w, h)

    // Draw RMSSD trace (last 60 values)
    const recent = measurements.slice(-60)
    const rmssdValues = recent.map(m => m.rmssd)
    const min = Math.min(...rmssdValues) - 5
    const max = Math.max(...rmssdValues) + 5
    const range = max - min || 1

    ctx.strokeStyle = 'rgba(255,255,255,0.6)'
    ctx.lineWidth = 1.5
    ctx.beginPath()

    for (let i = 0; i < recent.length; i++) {
      const x = (i / (recent.length - 1)) * w
      const y = h - ((recent[i].rmssd - min) / range) * h * 0.8 - h * 0.1
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()

    setTick(t => t + 1) // force re-render for color transitions
  }, [measurements])

  const latest = measurements.at(-1)
  const stateColor = !latest || isCalibrating ? 'rgba(120,120,120,0.3)'
    : latest.autonomicState === 'calm' ? 'rgba(107,143,113,0.3)'
    : latest.autonomicState === 'activated' ? 'rgba(178,132,93,0.3)'
    : 'rgba(150,140,120,0.3)'

  const stateLabel = error ? error
    : isCalibrating ? 'Calibrating...'
    : latest ? `${latest.autonomicState} · ${latest.hr} bpm`
    : 'Starting...'

  const confidenceWarn = latest && !isCalibrating && latest.confidence < 0.3

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      padding: '8px 16px',
      borderRadius: 10,
      background: stateColor,
      transition: 'background 2s ease',
      marginBottom: 16,
      minHeight: 48,
    }}>
      {/* State label */}
      <div style={{
        fontFamily: "'Inter', sans-serif",
        fontSize: 11,
        fontWeight: 500,
        color: 'var(--text-secondary)',
        textTransform: 'uppercase' as const,
        letterSpacing: '0.05em',
        whiteSpace: 'nowrap',
        minWidth: 100,
      }}>
        {confidenceWarn ? 'Weak signal' : stateLabel}
      </div>

      {/* HRV trace */}
      <canvas
        ref={canvasRef}
        width={200}
        height={32}
        style={{ flex: 1, maxWidth: 300, opacity: 0.8 }}
      />

      {/* Camera thumbnail */}
      <video
        ref={videoRef}
        muted
        playsInline
        style={{
          width: 48,
          height: 48,
          borderRadius: '50%',
          objectFit: 'cover',
          border: '2px solid var(--border-subtle)',
          flexShrink: 0,
        }}
      />
    </div>
  )
}
