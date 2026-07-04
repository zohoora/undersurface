import { useEffect, useRef } from 'react'
import { blsPan, clampPassMs } from '../../../engine/driftEngine'
import type { DriftBlsChannel } from '../../../types'

interface Props {
  channel: DriftBlsChannel
  running: boolean
  passMs: number
  volume: number
}

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

// Slow bilateral stimulation for Drift. Auditory (default): a soft sine tick
// alternating full-left/full-right via a StereoPanner. Visual: a dot swept
// left↔right by blsPan. One clock; pass duration is clamped to 1500–2500ms in
// the engine. Reduced-motion users get the auditory channel only.
export function BilateralStimulus({ channel, running, passMs, volume }: Props) {
  const dotRef = useRef<HTMLDivElement>(null)
  const rafRef = useRef(0)
  const audioRef = useRef<{ ctx: AudioContext; panner: StereoPannerNode; gain: GainNode } | null>(null)
  const effectiveChannel: DriftBlsChannel = channel === 'visual' && prefersReducedMotion() ? 'audio' : channel

  // Audio: soft tick alternating sides. One oscillator burst per side-arrival.
  useEffect(() => {
    if (!running || effectiveChannel !== 'audio') return
    const ctx = new AudioContext()
    const panner = new StereoPannerNode(ctx)
    const gain = new GainNode(ctx, { gain: 0 })
    gain.connect(panner).connect(ctx.destination)
    audioRef.current = { ctx, panner, gain }
    const p = clampPassMs(passMs)
    let side = -1
    const tick = () => {
      const { ctx: c, panner: pan, gain: g } = audioRef.current ?? {}
      if (!c || !pan || !g) return
      pan.pan.setValueAtTime(side, c.currentTime)
      const osc = new OscillatorNode(c, { type: 'sine', frequency: 220 })
      osc.connect(g)
      g.gain.cancelScheduledValues(c.currentTime)
      g.gain.setValueAtTime(0, c.currentTime)
      g.gain.linearRampToValueAtTime(0.18 * volume, c.currentTime + 0.03)
      g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.28)
      osc.start()
      osc.stop(c.currentTime + 0.3)
      side = -side
    }
    tick()
    const id = setInterval(tick, p)
    return () => {
      clearInterval(id)
      void ctx.close()
      audioRef.current = null
    }
  }, [running, effectiveChannel, passMs, volume])

  // Visual: dot swept by blsPan on rAF.
  useEffect(() => {
    if (!running || effectiveChannel !== 'visual') return
    const start = performance.now()
    const animate = (now: number) => {
      const pan = blsPan(now - start, passMs)
      if (dotRef.current) dotRef.current.style.transform = `translateX(${pan * 42}vw)`
      rafRef.current = requestAnimationFrame(animate)
    }
    rafRef.current = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(rafRef.current)
  }, [running, effectiveChannel, passMs])

  if (!running || effectiveChannel !== 'visual') return null
  return (
    <div aria-hidden style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
      <div ref={dotRef} data-testid="bls-dot" style={{ width: 14, height: 14, borderRadius: '50%', background: 'var(--text-primary)', opacity: 0.55 }} />
    </div>
  )
}
