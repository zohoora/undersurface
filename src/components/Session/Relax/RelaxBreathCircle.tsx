import { useEffect, useRef } from 'react'
import { breathScale, computeAdaptiveBpm, cycleMs, getTargetRespRate } from '../../../engine/relaxEngine'
import { useLatestRef } from '../../../hooks/useLatestRef'
import type { RelaxSessionType, RelaxVisualMode } from '../../../types'

interface Props {
  sessionType: RelaxSessionType
  visualMode: RelaxVisualMode
  ending: boolean
  // Smoothed cardiac coherence 0..1, or null when unavailable. Brightens
  // the halo as the user finds rhythm — the visual *leads* the pacing target
  // but the halo *responds* to coherence.
  coherence?: number | null
  // Latest raw respiratory rate from the HRV worker. Smoothing, the 5% lead,
  // and the session-target floor all happen inside this component's rAF
  // loop so transient prop changes don't trigger re-renders.
  respiratoryRate?: number | null
  // Live chest-motion getter (Polar H10 accelerometer). When supplied and
  // returning non-null, the circle abandons its internal phase ticker and
  // follows the user's *actual* breath. Polled per rAF; no React churn.
  chestScaleGetter?: () => number | null
}

// Time-weighted EMA: roughly 90% convergence in ~12s of cumulative dt.
const BPM_SMOOTHING_TIME_MS = 12_000

export function RelaxBreathCircle({ sessionType, visualMode, ending, coherence, respiratoryRate, chestScaleGetter }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const coherenceRef = useLatestRef<number | null>(coherence ?? null)
  const visualModeRef = useLatestRef(visualMode)
  const endingRef = useLatestRef(ending)
  const respRateRef = useLatestRef<number | null>(respiratoryRate ?? null)
  const chestScaleGetterRef = useLatestRef(chestScaleGetter ?? null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const defaultBpm = getTargetRespRate(sessionType)
    let rafId = 0
    let mounted = true

    // Delta-accumulated phase. BPM changes only affect the rate of phase
    // advancement going forward; the phase value itself stays continuous.
    let phase = 0
    let smoothedBpm: number | null = null
    let lastTime = performance.now()
    // Smoothed chest-motion scale — only used when a chestScaleGetter is
    // supplied. The 50 ms time constant smooths the engine's 100 ms filter
    // cadence into perceptually-continuous motion without visible lag.
    let smoothedChestScale: number | null = null
    const CHEST_SMOOTHING_TIME_MS = 50

    const resize = () => {
      const dpr = window.devicePixelRatio || 1
      canvas.width = canvas.clientWidth * dpr
      canvas.height = canvas.clientHeight * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    window.addEventListener('resize', resize)

    const draw = (now: number) => {
      if (!mounted) return
      // Cap dt to absorb tab-hidden gaps — rAF pauses when backgrounded.
      const dt = Math.min(now - lastTime, 50)
      lastTime = now

      const target = computeAdaptiveBpm(respRateRef.current, defaultBpm)
      if (target !== null) {
        if (smoothedBpm === null) {
          smoothedBpm = target
        } else {
          const alpha = Math.min(1, dt / BPM_SMOOTHING_TIME_MS)
          smoothedBpm += (target - smoothedBpm) * alpha
        }
      }
      const bpm = smoothedBpm ?? defaultBpm
      const cycle = cycleMs(bpm)
      phase = (phase + dt / cycle) % 1

      const w = canvas.clientWidth
      const h = canvas.clientHeight
      const cx = w / 2
      const cy = h / 2

      const liveChest = chestScaleGetterRef.current?.()
      let scale: number
      if (liveChest != null) {
        const a = Math.min(1, dt / CHEST_SMOOTHING_TIME_MS)
        smoothedChestScale = smoothedChestScale == null
          ? liveChest
          : smoothedChestScale + (liveChest - smoothedChestScale) * a
        scale = smoothedChestScale
      } else {
        smoothedChestScale = null
        scale = breathScale(phase)
      }
      const fadeOut = endingRef.current ? 0.4 : 1.0
      const mode = visualModeRef.current
      const c = Math.max(0, Math.min(1, coherenceRef.current ?? 0))

      ctx.clearRect(0, 0, w, h)

      if (mode === 'off') {
        ctx.fillStyle = `rgba(200,200,220,${0.18 * fadeOut})`
        ctx.beginPath()
        ctx.arc(cx, cy, 4, 0, Math.PI * 2)
        ctx.fill()
        rafId = requestAnimationFrame(draw)
        return
      }

      const baseR = Math.min(w, h) * 0.18
      const r = baseR * (0.7 + 0.5 * scale)

      if (mode === 'full') {
        // Halo intensity rises with coherence — at c=1, halo is ~50% brighter
        // and reaches ~25% further. Subtle, not gamified.
        const haloBoost = 1 + 0.5 * c
        const haloReach = 2.4 + 0.6 * c
        const grad = ctx.createRadialGradient(cx, cy, r * 0.4, cx, cy, r * haloReach)
        grad.addColorStop(0, `rgba(140,170,210,${0.35 * scale * haloBoost * fadeOut})`)
        grad.addColorStop(0.5, `rgba(110,140,190,${0.18 * scale * haloBoost * fadeOut})`)
        grad.addColorStop(1, 'rgba(0,0,0,0)')
        ctx.fillStyle = grad
        ctx.fillRect(0, 0, w, h)
      }

      const coreAlpha = (mode === 'full' ? 0.22 : 0.12) * fadeOut
      ctx.beginPath()
      ctx.arc(cx, cy, r, 0, Math.PI * 2)
      ctx.fillStyle = `rgba(180,200,230,${coreAlpha + 0.06 * scale})`
      ctx.fill()

      const strokeAlpha = (mode === 'full' ? 0.6 : 0.4) * fadeOut
      ctx.lineWidth = 1.5
      ctx.strokeStyle = `rgba(220,230,250,${strokeAlpha * (0.5 + 0.5 * scale)})`
      ctx.stroke()

      rafId = requestAnimationFrame(draw)
    }
    rafId = requestAnimationFrame(draw)

    return () => {
      mounted = false
      cancelAnimationFrame(rafId)
      window.removeEventListener('resize', resize)
    }
    // useLatestRef returns a stable MutableRefObject; ESLint's exhaustive-deps
    // doesn't recognize the helper, so the inferred missing deps are spurious.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionType])

  return (
    <canvas
      ref={canvasRef}
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }}
      aria-hidden
    />
  )
}

export default RelaxBreathCircle
