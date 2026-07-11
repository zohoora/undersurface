import { useEffect, useRef, useState } from 'react'
import { blsPan, clampPassMs } from '../../../engine/driftEngine'
import type { DriftBlsChannel } from '../../../types'

interface Props {
  channel: DriftBlsChannel
  running: boolean
  passMs: number
  volume: number
  audioContext?: AudioContext | null
}

function prefersReducedMotion(): boolean {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches } catch { return false }
}

// One bounded rhythm lane and one clock. The visual point and headphone note
// are both driven from the same requestAnimationFrame timeline, so interval
// drift can never make the sound switch sides before/after the point arrives.
// Keeping the lane in normal layout also makes it structurally impossible for
// the point to travel across guidance or controls.
export function BilateralStimulus({ channel, running, passMs, volume, audioContext }: Props) {
  const dotRef = useRef<HTMLDivElement>(null)
  const leftRef = useRef<HTMLDivElement>(null)
  const rightRef = useRef<HTMLDivElement>(null)
  const rafRef = useRef(0)
  const audioContextRef = useRef<AudioContext | null>(null)
  const [audioReady, setAudioReady] = useState(true)
  const reduced = prefersReducedMotion()

  useEffect(() => {
    if (!running) return
    let cancelled = false
    let context: AudioContext | null = null
    let gain: GainNode | null = null
    let panner: StereoPannerNode | null = null
    const pass = clampPassMs(passMs)

    if (channel === 'audio') {
      try {
        context = audioContext ?? audioContextRef.current ?? new AudioContext()
        audioContextRef.current = context
        gain = new GainNode(context, { gain: 0 })
        panner = new StereoPannerNode(context)
        gain.connect(panner).connect(context.destination)
      } catch {
        queueMicrotask(() => setAudioReady(false))
        context = null
      }
    }

    const startTimeline = () => {
      if (cancelled) return
      setAudioReady(true)
      const start = performance.now()
      let lastEndpoint = -1
      const playEndpoint = (side: -1 | 1) => {
        if (!context || !gain || !panner) return
        panner.pan.setValueAtTime(side, context.currentTime)
        const oscillator = new OscillatorNode(context, { type: 'sine', frequency: 246 })
        oscillator.connect(gain)
        gain.gain.cancelScheduledValues(context.currentTime)
        gain.gain.setValueAtTime(0.0001, context.currentTime)
        gain.gain.linearRampToValueAtTime(Math.max(0.025, 0.2 * volume), context.currentTime + 0.04)
        gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.42)
        oscillator.start(context.currentTime)
        oscillator.stop(context.currentTime + 0.44)
      }
      const animate = (now: number) => {
        const elapsed = now - start
        const endpoint = Math.floor(elapsed / pass)
        const side = (endpoint % 2 === 0 ? -1 : 1) as -1 | 1
        if (endpoint !== lastEndpoint) {
          lastEndpoint = endpoint
          if (channel === 'audio') playEndpoint(side)
        }
        const pan = reduced ? side : blsPan(elapsed, pass)
        if (dotRef.current) dotRef.current.style.left = `${50 + pan * 44}%`
        if (leftRef.current) leftRef.current.style.opacity = String(0.08 + Math.max(0, -pan) * 0.28)
        if (rightRef.current) rightRef.current.style.opacity = String(0.08 + Math.max(0, pan) * 0.28)
        rafRef.current = requestAnimationFrame(animate)
      }
      rafRef.current = requestAnimationFrame(animate)
    }

    if (context) {
      void context.resume().then(startTimeline).catch(() => {
        setAudioReady(false)
        startTimeline()
      })
    } else {
      startTimeline()
    }

    return () => {
      cancelled = true
      cancelAnimationFrame(rafRef.current)
      gain?.disconnect()
      panner?.disconnect()
    }
  }, [running, channel, passMs, volume, audioContext, reduced])

  useEffect(() => () => {
    cancelAnimationFrame(rafRef.current)
    const context = audioContextRef.current
    audioContextRef.current = null
    if (context && context !== audioContext) void context.close()
  }, [audioContext])

  if (!running) return null
  return (
    <div
      aria-hidden
      data-testid="drift-rhythm-lane"
      style={{ position: 'relative', width: 'min(620px, calc(100vw - 40px))', height: 'clamp(132px, 22vh, 180px)', pointerEvents: 'none', overflow: 'hidden', borderRadius: 999 }}
    >
      <div ref={leftRef} style={edgeGlow('left')} />
      <div ref={rightRef} style={edgeGlow('right')} />
      <div
        ref={dotRef}
        data-testid="bls-dot"
        style={{
          position: 'absolute', top: '50%', left: '6%', transform: 'translate(-50%, -50%)',
          width: channel === 'visual' ? 18 : 9,
          height: channel === 'visual' ? 18 : 9,
          borderRadius: '50%',
          background: 'var(--text-primary)',
          opacity: channel === 'visual' ? 0.7 : 0.24,
          boxShadow: '0 0 22px 8px color-mix(in srgb, var(--accent-warm) 35%, transparent)',
          transition: reduced ? 'left 0.5s ease' : undefined,
        }}
      />
      {!audioReady && channel === 'audio' && <span data-testid="drift-audio-unavailable" />}
    </div>
  )
}

function edgeGlow(side: 'left' | 'right'): React.CSSProperties {
  return {
    position: 'absolute', top: '12%', bottom: '12%', [side]: '-12%', width: '38%',
    background: `radial-gradient(ellipse at ${side === 'left' ? 'left' : 'right'}, color-mix(in srgb, var(--accent-warm) 42%, transparent), transparent 68%)`,
    opacity: 0.08,
  }
}
