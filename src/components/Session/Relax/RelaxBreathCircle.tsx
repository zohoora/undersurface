import { useEffect, useRef } from 'react'
import { breathPhase, breathScale, getTargetRespRate } from '../../../engine/relaxEngine'
import type { RelaxSessionType, RelaxVisualMode } from '../../../types'

interface Props {
  sessionType: RelaxSessionType
  visualMode: RelaxVisualMode
  ending: boolean
  // Smoothed cardiac coherence 0..1, or null when unavailable. Used to
  // brighten the halo as the user finds rhythm — the visual *leads* the
  // breath at a fixed target, but the halo *responds* to coherence.
  coherence?: number | null
}

export function RelaxBreathCircle({ sessionType, visualMode, ending, coherence }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // Read coherence/visualMode/ending via refs so prop changes don't tear
  // down the rAF loop and reset the breath phase mid-cycle.
  const coherenceRef = useRef<number | null>(coherence ?? null)
  const visualModeRef = useRef(visualMode)
  const endingRef = useRef(ending)
  useEffect(() => { coherenceRef.current = coherence ?? null }, [coherence])
  useEffect(() => { visualModeRef.current = visualMode }, [visualMode])
  useEffect(() => { endingRef.current = ending }, [ending])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const targetBpm = getTargetRespRate(sessionType)
    let rafId = 0
    let mounted = true

    const resize = () => {
      const dpr = window.devicePixelRatio || 1
      canvas.width = canvas.clientWidth * dpr
      canvas.height = canvas.clientHeight * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    window.addEventListener('resize', resize)

    const draw = () => {
      if (!mounted) return
      const w = canvas.clientWidth
      const h = canvas.clientHeight
      const cx = w / 2
      const cy = h / 2

      const phase = breathPhase(performance.now(), targetBpm)
      const scale = breathScale(phase)
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
