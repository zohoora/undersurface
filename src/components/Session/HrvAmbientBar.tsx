import { useEffect, useRef, useState } from 'react'
import type { HrvMeasurement } from '../../types'

interface FaceROI {
  x: number
  y: number
  width: number
  height: number
}

interface Props {
  measurements: HrvMeasurement[]
  stream: MediaStream | null
  isCalibrating: boolean
  error: string | null
  faceROI: FaceROI | null
  videoWidth: number
  videoHeight: number
}

const labelStyle: React.CSSProperties = {
  fontFamily: "'Inter', sans-serif",
  fontSize: 10,
  color: 'var(--text-tertiary, #999)',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
}

const valueStyle: React.CSSProperties = {
  fontFamily: "'Inter', sans-serif",
  fontSize: 13,
  fontWeight: 600,
  color: 'var(--text-primary)',
  fontVariantNumeric: 'tabular-nums',
}

export function HrvAmbientBar({ measurements, stream, isCalibrating, error, faceROI, videoWidth, videoHeight }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const faceCanvasRef = useRef<HTMLCanvasElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [, setTick] = useState(0)

  // Attach camera stream to hidden video element
  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream
      videoRef.current.play().catch(() => {})
    }
  }, [stream])

  // Draw cropped face region onto the face thumbnail canvas
  useEffect(() => {
    if (!videoRef.current || !faceCanvasRef.current || !stream || !faceROI) return

    const video = videoRef.current
    const canvas = faceCanvasRef.current
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Face ROI is in 320x240 space — scale to actual video dimensions
    const scaleX = videoWidth / 320
    const scaleY = videoHeight / 240
    const sx = faceROI.x * scaleX
    const sy = faceROI.y * scaleY
    const sw = faceROI.width * scaleX
    const sh = faceROI.height * scaleY

    let animId: number
    const drawFace = () => {
      if (video.readyState >= 2 && sw > 0 && sh > 0) {
        ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height)
      }
      animId = requestAnimationFrame(drawFace)
    }
    drawFace()

    return () => cancelAnimationFrame(animId)
  }, [stream, faceROI, videoWidth, videoHeight])

  // Draw HRV trace on canvas
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || measurements.length < 2) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const w = canvas.width
    const h = canvas.height
    ctx.clearRect(0, 0, w, h)

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

    setTick(t => t + 1)
  }, [measurements])

  const latest = measurements.at(-1)
  const stateColor = !latest || isCalibrating ? 'rgba(120,120,120,0.15)'
    : latest.autonomicState === 'calm' ? 'rgba(107,143,113,0.15)'
    : latest.autonomicState === 'activated' ? 'rgba(178,132,93,0.15)'
    : 'rgba(150,140,120,0.15)'

  const confidencePercent = latest ? Math.round(latest.confidence * 100) : 0
  const confidenceColor = confidencePercent >= 70 ? '#6b8f71'
    : confidencePercent >= 40 ? '#b8a060'
    : '#b07060'

  const elapsed = measurements.length > 0
    ? Math.round((Date.now() - measurements[0].timestamp) / 1000)
    : 0

  return (
    <div style={{
      padding: '10px 16px',
      borderRadius: 10,
      background: stateColor,
      transition: 'background 2s ease',
      border: '1px solid var(--border-subtle, rgba(255,255,255,0.1))',
    }}>
      {/* Top row: state + metrics */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        marginBottom: 8,
      }}>
        {/* Hidden video element for face cropping */}
        <video
          ref={videoRef}
          muted
          playsInline
          style={{ display: 'none' }}
        />

        {/* Face ROI thumbnail */}
        <canvas
          ref={faceCanvasRef}
          width={96}
          height={96}
          style={{
            width: 48,
            height: 48,
            borderRadius: '50%',
            objectFit: 'cover',
            border: `2px solid ${faceROI ? 'rgba(107,143,113,0.6)' : 'var(--border-subtle)'}`,
            flexShrink: 0,
            background: '#222',
          }}
        />

        {/* State */}
        <div style={{ minWidth: 90 }}>
          <div style={labelStyle}>State</div>
          <div style={valueStyle}>
            {error ? error
              : isCalibrating ? 'Calibrating'
              : latest?.autonomicState ?? 'Starting'}
          </div>
        </div>

        {/* Heart Rate */}
        <div style={{ minWidth: 50 }}>
          <div style={labelStyle}>HR</div>
          <div style={valueStyle}>
            {latest ? `${latest.hr}` : '--'}
            <span style={{ fontSize: 10, fontWeight: 400, color: 'var(--text-tertiary, #999)' }}> bpm</span>
          </div>
        </div>

        {/* Respiratory Rate */}
        <div style={{ minWidth: 50 }}>
          <div style={labelStyle}>Breath</div>
          <div style={valueStyle}>
            {latest?.respiratoryRate ? `${latest.respiratoryRate}` : '--'}
            <span style={{ fontSize: 10, fontWeight: 400, color: 'var(--text-tertiary, #999)' }}> /min</span>
          </div>
        </div>

        {/* RMSSD */}
        <div style={{ minWidth: 50 }}>
          <div style={labelStyle}>RMSSD</div>
          <div style={valueStyle}>
            {latest ? `${latest.rmssd.toFixed(1)}` : '--'}
            <span style={{ fontSize: 10, fontWeight: 400, color: 'var(--text-tertiary, #999)' }}> ms</span>
          </div>
        </div>

        {/* Trend */}
        <div style={{ minWidth: 50 }}>
          <div style={labelStyle}>Trend</div>
          <div style={valueStyle}>
            {latest ? `${latest.trend === 'rising' ? '\u2197' : latest.trend === 'falling' ? '\u2198' : '\u2192'} ${latest.trend}` : '--'}
          </div>
        </div>

        {/* Confidence */}
        <div style={{ minWidth: 60 }}>
          <div style={labelStyle}>Signal</div>
          <div style={{ ...valueStyle, color: confidenceColor }}>
            {latest ? `${confidencePercent}%` : '--'}
          </div>
        </div>

        {/* Samples */}
        <div style={{ minWidth: 50 }}>
          <div style={labelStyle}>Samples</div>
          <div style={valueStyle}>
            {measurements.length}
          </div>
        </div>

        {/* Elapsed */}
        <div style={{ minWidth: 40 }}>
          <div style={labelStyle}>Time</div>
          <div style={valueStyle}>
            {elapsed > 0 ? `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}` : '--'}
          </div>
        </div>
      </div>

      {/* Bottom row: RMSSD trace */}
      <canvas
        ref={canvasRef}
        width={500}
        height={32}
        style={{ width: '100%', height: 32, opacity: 0.8, borderRadius: 4 }}
      />
    </div>
  )
}
