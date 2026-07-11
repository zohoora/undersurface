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

// A sensory field that never goes visually blank. Visual mode sweeps a soft
// point; audio mode alternates two edge glows so silent-mode/headphone problems
// are visible rather than feeling like a frozen screen. One AudioContext lives
// for the mounted practice and is resumed explicitly for iOS/WebKit.
export function BilateralStimulus({ channel, running, passMs, volume, audioContext }: Props) {
  const dotRef = useRef<HTMLDivElement>(null)
  const leftRef = useRef<HTMLDivElement>(null)
  const rightRef = useRef<HTMLDivElement>(null)
  const rafRef = useRef(0)
  const audioContextRef = useRef<AudioContext | null>(null)
  const [audioReady, setAudioReady] = useState(true)
  const reduced = prefersReducedMotion()

  useEffect(() => () => {
    cancelAnimationFrame(rafRef.current)
    const context = audioContextRef.current
    audioContextRef.current = null
    if (context && context !== audioContext) void context.close()
  }, [audioContext])

  useEffect(() => {
    if (!running) return
    const start = performance.now()
    const animate = (now: number) => {
      const pan = reduced ? (Math.floor((now - start) / clampPassMs(passMs)) % 2 === 0 ? -1 : 1) : blsPan(now - start, passMs)
      if (dotRef.current) dotRef.current.style.transform = `translate3d(${pan * 38}vw, 0, 0)`
      if (leftRef.current) leftRef.current.style.opacity = String(0.08 + Math.max(0, -pan) * 0.28)
      if (rightRef.current) rightRef.current.style.opacity = String(0.08 + Math.max(0, pan) * 0.28)
      rafRef.current = requestAnimationFrame(animate)
    }
    rafRef.current = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(rafRef.current)
  }, [running, passMs, reduced])

  useEffect(() => {
    if (!running || channel !== 'audio') return
    let context = audioContext ?? audioContextRef.current
    try {
      context ??= new AudioContext()
      audioContextRef.current = context
      void context.resume().then(() => setAudioReady(true)).catch(() => setAudioReady(false))
    } catch {
      setAudioReady(false)
      return
    }
    const gain = new GainNode(context, { gain: 0 })
    const panner = new StereoPannerNode(context)
    gain.connect(panner).connect(context.destination)
    let side = -1
    const tick = () => {
      if (!context) return
      panner.pan.setValueAtTime(side, context.currentTime)
      const oscillator = new OscillatorNode(context, { type: 'sine', frequency: 246 })
      oscillator.connect(gain)
      gain.gain.cancelScheduledValues(context.currentTime)
      gain.gain.setValueAtTime(0.0001, context.currentTime)
      gain.gain.linearRampToValueAtTime(Math.max(0.025, 0.2 * volume), context.currentTime + 0.04)
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.42)
      oscillator.start()
      oscillator.stop(context.currentTime + 0.44)
      side = -side
    }
    tick()
    const id = window.setInterval(tick, clampPassMs(passMs))
    return () => {
      window.clearInterval(id)
      gain.disconnect()
      panner.disconnect()
    }
  }, [running, channel, passMs, volume, audioContext])

  if (!running) return null
  return (
    <div aria-hidden style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
      <div ref={leftRef} style={edgeGlow('left')} />
      <div ref={rightRef} style={edgeGlow('right')} />
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div
          ref={dotRef}
          data-testid="bls-dot"
          style={{
            width: channel === 'visual' ? 18 : 9,
            height: channel === 'visual' ? 18 : 9,
            borderRadius: '50%',
            background: 'var(--text-primary)',
            opacity: channel === 'visual' ? 0.7 : 0.24,
            boxShadow: '0 0 22px 8px color-mix(in srgb, var(--accent-warm) 35%, transparent)',
            transition: reduced ? 'transform 0.5s ease' : undefined,
          }}
        />
      </div>
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
