import { useEffect, useRef, useState } from 'react'
import type { EmotionalTone } from '../../types'
import type { VoiceSessionState } from '../../hooks/useVoiceSession'
import {
  getFieldPalette,
  lerpPalette,
  palettesApproxEqual,
  rgba,
  type FieldPalette,
} from '../../engine/voiceFieldColors'

export interface TranscriptEmission {
  id: number
  speaker: 'user' | 'ai'
  text: string
}

interface Props {
  state: VoiceSessionState
  error: string | null
  muted: boolean
  assistantSpeaking: boolean
  userSpeaking: boolean
  remoteStream: MediaStream | null
  // Cumulative emissions list lives in a ref on the parent; emissionVersion
  // bumps on each new emission to trigger this component's effect. Reading from
  // a ref means SessionView doesn't rebuild the array on every emission.
  transcriptEmissions: TranscriptEmission[]
  emissionVersion: number
  dominantEmotion: EmotionalTone
  onToggleMute: () => void
  onEnd: () => void
}

interface WordParticle {
  text: string
  speaker: 'user' | 'ai'
  x: number
  y: number
  vx: number
  vy: number
  enteredAt: number
  lifespanMs: number
}

interface CloudParticle {
  angle: number
  baseRadius: number
  bin: number
  phase: number
}

type WindowWithWebkit = Window & { webkitAudioContext?: typeof AudioContext }

const FFT_SIZE = 256
const SPECTRUM_SIZE = FFT_SIZE / 2
const CLOUD_PARTICLE_COUNT = 220
const WORD_LIFESPAN_MS = 6500
const WORD_LIFESPAN_JITTER_MS = 1200
const WORD_STAGGER_MS = 120
const WORD_MAX_ON_SCREEN = 24
const BREATH_HZ = 0.25
const PALETTE_TRANSITION_MS = 1500

export function VoiceField({
  state,
  error,
  muted,
  assistantSpeaking,
  userSpeaking,
  remoteStream,
  transcriptEmissions,
  emissionVersion,
  dominantEmotion,
  onToggleMute,
  onEnd,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const endButtonRef = useRef<HTMLButtonElement>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const cloudRef = useRef<CloudParticle[]>([])
  const wordsRef = useRef<WordParticle[]>([])
  // Track consumed emissions by id (not index) so the parent can trim the
  // cumulative list without breaking our index tracking.
  const lastEmissionIdRef = useRef(-1)
  const paletteRef = useRef<FieldPalette>(getFieldPalette(dominantEmotion))
  const paletteTargetRef = useRef<FieldPalette>(getFieldPalette(dominantEmotion))
  const paletteDirtyRef = useRef(false)
  const stateRef = useRef({ assistantSpeaking, userSpeaking })
  const amplitudeRef = useRef(0)
  // Cached background gradient; invalidated when size or top/bottom change.
  const bgGradientRef = useRef<{ grad: CanvasGradient; w: number; h: number; top: string; bottom: string } | null>(null)
  // Font string recomputed only when dpr changes.
  const fontStringRef = useRef('500 20px "Spectral", Georgia, serif')

  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    if (state !== 'connected') return
    const startedAt = Date.now()
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000)
    return () => clearInterval(id)
  }, [state])

  // Move focus to the End button once the session is live, and allow Escape
  // to close. Without this the overlay is a focus dead-end for keyboard users.
  useEffect(() => {
    if (state !== 'connected') return
    endButtonRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onEnd()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [state, onEnd])

  useEffect(() => {
    stateRef.current = { assistantSpeaking, userSpeaking }
  }, [assistantSpeaking, userSpeaking])

  useEffect(() => {
    paletteTargetRef.current = getFieldPalette(dominantEmotion)
    paletteDirtyRef.current = true
  }, [dominantEmotion])

  useEffect(() => {
    const cloud: CloudParticle[] = []
    for (let i = 0; i < CLOUD_PARTICLE_COUNT; i++) {
      cloud.push({
        angle: (i / CLOUD_PARTICLE_COUNT) * Math.PI * 2 + Math.random() * 0.15,
        baseRadius: 90 + Math.random() * 70,
        bin: Math.floor((i / CLOUD_PARTICLE_COUNT) * SPECTRUM_SIZE * 0.6) + 4,
        phase: Math.random() * Math.PI * 2,
      })
    }
    cloudRef.current = cloud
  }, [])

  useEffect(() => {
    if (!remoteStream) return
    const w = window as WindowWithWebkit
    const Ctx = window.AudioContext ?? w.webkitAudioContext
    if (!Ctx) {
      console.warn('[VoiceField] AudioContext unavailable')
      return
    }
    const ctx = new Ctx()
    audioCtxRef.current = ctx
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => { /* noop */ })
    }
    const source = ctx.createMediaStreamSource(remoteStream)
    const analyser = ctx.createAnalyser()
    analyser.fftSize = FFT_SIZE
    analyser.smoothingTimeConstant = 0.82
    source.connect(analyser)
    analyser.connect(ctx.destination)
    analyserRef.current = analyser

    return () => {
      analyserRef.current = null
      try { source.disconnect() } catch { /* noop */ }
      try { analyser.disconnect() } catch { /* noop */ }
      try { ctx.close() } catch { /* noop */ }
      audioCtxRef.current = null
    }
  }, [remoteStream])

  useEffect(() => {
    // Reset detection: parent cleared emissions (e.g., new voice session).
    if (transcriptEmissions.length === 0) {
      lastEmissionIdRef.current = -1
      return
    }
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const width = canvas.width / dpr
    const height = canvas.height / dpr
    const cx = width / 2
    const cy = height / 2
    const now = performance.now()

    // Read by id, not index — robust to parent trimming the array.
    let highestId = lastEmissionIdRef.current
    for (const emission of transcriptEmissions) {
      if (emission.id <= lastEmissionIdRef.current) continue
      if (emission.id > highestId) highestId = emission.id
      const tokens = emission.text.trim().split(/\s+/).filter(w => w.length > 0)
      for (const token of tokens) {
        const angle = Math.random() * Math.PI * 2
        const seedRadius = 20 + Math.random() * 70
        const x = cx + Math.cos(angle) * seedRadius
        const seedY = emission.speaker === 'ai'
          ? cy - Math.abs(Math.sin(angle)) * seedRadius * 0.3
          : cy + Math.abs(Math.sin(angle)) * seedRadius * 0.3
        const directionY = emission.speaker === 'ai' ? -1 : 1
        wordsRef.current.push({
          text: token,
          speaker: emission.speaker,
          x,
          y: seedY,
          vx: (Math.random() - 0.5) * 0.12,
          vy: directionY * (0.16 + Math.random() * 0.18),
          enteredAt: now + Math.random() * WORD_STAGGER_MS,
          lifespanMs: WORD_LIFESPAN_MS + Math.random() * WORD_LIFESPAN_JITTER_MS,
        })
      }
    }
    if (wordsRef.current.length > WORD_MAX_ON_SCREEN * 3) {
      wordsRef.current = wordsRef.current.slice(-WORD_MAX_ON_SCREEN * 3)
    }
    lastEmissionIdRef.current = highestId
    // emissionVersion is the trigger; transcriptEmissions ref-content read above.
  }, [emissionVersion, transcriptEmissions])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    fontStringRef.current = `500 ${20 * dpr}px "Spectral", Georgia, serif`

    let rafId = 0
    let cancelled = false

    function resize() {
      if (!canvas) return
      const w = window.innerWidth
      const h = window.innerHeight
      canvas.width = Math.floor(w * dpr)
      canvas.height = Math.floor(h * dpr)
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
      bgGradientRef.current = null
    }
    resize()
    window.addEventListener('resize', resize)

    const ctx2d = canvas.getContext('2d', { alpha: false })
    if (!ctx2d) return
    const spectrum = new Uint8Array(SPECTRUM_SIZE)

    function updatePalette(dt: number) {
      if (!paletteDirtyRef.current) return
      const t = paletteTargetRef.current
      const cur = paletteRef.current
      if (palettesApproxEqual(cur, t)) {
        paletteRef.current = t
        paletteDirtyRef.current = false
        return
      }
      const speed = Math.min(1, dt / PALETTE_TRANSITION_MS)
      paletteRef.current = lerpPalette(cur, t, speed)
    }

    function drawBackground(w: number, h: number) {
      const p = paletteRef.current
      const top = rgba(p.bgTop)
      const bottom = rgba(p.bgBottom)
      const cached = bgGradientRef.current
      if (cached && cached.w === w && cached.h === h && cached.top === top && cached.bottom === bottom) {
        ctx2d!.fillStyle = cached.grad
      } else {
        const grad = ctx2d!.createLinearGradient(0, 0, 0, h)
        grad.addColorStop(0, top)
        grad.addColorStop(1, bottom)
        bgGradientRef.current = { grad, w, h, top, bottom }
        ctx2d!.fillStyle = grad
      }
      ctx2d!.fillRect(0, 0, w, h)
    }

    function drawCloud(cx: number, cy: number, amp: number, breath: number) {
      const p = paletteRef.current
      const cloud = cloudRef.current
      const { assistantSpeaking, userSpeaking } = stateRef.current
      const core = userSpeaking ? p.userCore : p.aiCore

      ctx2d!.save()
      ctx2d!.globalCompositeOperation = 'lighter'

      const haloRadius = 100 + breath * 24 + amp * 140
      const halo = ctx2d!.createRadialGradient(cx, cy, 0, cx, cy, haloRadius)
      halo.addColorStop(0, rgba(core, 0.22))
      halo.addColorStop(0.4, rgba(core, 0.08))
      halo.addColorStop(1, rgba(core, 0))
      ctx2d!.fillStyle = halo
      ctx2d!.fillRect(cx - haloRadius, cy - haloRadius, haloRadius * 2, haloRadius * 2)

      for (let i = 0; i < cloud.length; i++) {
        const particle = cloud[i]
        const bin = spectrum[particle.bin] / 255
        const breathOffset = breath * 10
        let push = 0
        if (assistantSpeaking) {
          push = bin * 70
        } else if (userSpeaking) {
          push = -14 - Math.sin(particle.phase) * 4
        } else {
          push = Math.sin(particle.phase * 0.7 + performance.now() * 0.0004) * 4
        }
        const r = particle.baseRadius + breathOffset + push
        const px = cx + Math.cos(particle.angle) * r
        const py = cy + Math.sin(particle.angle) * r

        particle.angle += 0.00018 + bin * 0.0006
        particle.phase += 0.012

        const alpha = 0.12 + bin * 0.55 + (userSpeaking ? 0.15 : 0)
        const size = 1.4 + bin * 2.6
        ctx2d!.fillStyle = rgba(core, Math.min(alpha, 0.9))
        ctx2d!.beginPath()
        ctx2d!.arc(px, py, size, 0, Math.PI * 2)
        ctx2d!.fill()
      }

      ctx2d!.restore()
    }

    function drawWords(now: number) {
      const p = paletteRef.current
      const words = wordsRef.current
      if (words.length === 0) return

      ctx2d!.save()
      ctx2d!.font = fontStringRef.current
      ctx2d!.textAlign = 'center'
      ctx2d!.textBaseline = 'middle'
      ctx2d!.shadowBlur = 14 * dpr

      let writeIdx = 0
      for (let i = 0; i < words.length; i++) {
        const w = words[i]
        const age = now - w.enteredAt
        if (age < 0) {
          words[writeIdx++] = w
          continue
        }
        if (age > w.lifespanMs) continue

        const inPhase = Math.min(age / 220, 1)
        const lifeFrac = age / w.lifespanMs
        const outPhase = lifeFrac > 0.45 ? 1 - (lifeFrac - 0.45) / 0.55 : 1
        const alpha = inPhase * outPhase

        w.x += w.vx
        w.y += w.vy
        w.vx *= 0.998
        w.vy *= 0.998

        const color = w.speaker === 'ai' ? p.aiText : p.userText
        const rendered = rgba(color, Math.max(0, Math.min(alpha * color.a, 0.95)))
        ctx2d!.fillStyle = rendered
        ctx2d!.shadowColor = rendered
        ctx2d!.fillText(w.text, w.x * dpr, w.y * dpr)

        words[writeIdx++] = w
      }
      words.length = writeIdx
      ctx2d!.restore()
    }

    let lastFrame = performance.now()
    function frame(now: number) {
      if (cancelled) return
      const dt = Math.min(now - lastFrame, 100)
      lastFrame = now

      updatePalette(dt)

      const w = canvas!.width
      const h = canvas!.height
      const cx = w / 2
      const cy = h / 2

      drawBackground(w, h)

      let amp = 0
      if (analyserRef.current) {
        analyserRef.current.getByteFrequencyData(spectrum)
        let sum = 0
        for (let i = 2; i < SPECTRUM_SIZE; i++) sum += spectrum[i]
        amp = sum / ((SPECTRUM_SIZE - 2) * 255)
      }
      amplitudeRef.current = amplitudeRef.current + (amp - amplitudeRef.current) * 0.18

      const phase = (now / 1000) * BREATH_HZ * 2 * Math.PI
      const breath = (Math.sin(phase) + 1) / 2

      drawCloud(cx, cy, amplitudeRef.current, breath)
      drawWords(now)

      rafId = requestAnimationFrame(frame)
    }
    rafId = requestAnimationFrame(frame)

    return () => {
      cancelled = true
      cancelAnimationFrame(rafId)
      window.removeEventListener('resize', resize)
    }
  }, [])

  const statusLine = (() => {
    if (error) return error
    if (state === 'connecting') return 'connecting…'
    if (state === 'error') return 'voice session ended'
    if (assistantSpeaking) return 'speaking'
    if (userSpeaking) return 'listening'
    return 'still'
  })()

  const elapsedLabel = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Voice session"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        overflow: 'hidden',
        background: '#0a0b0e',
      }}
    >
      <canvas
        ref={canvasRef}
        style={{ position: 'absolute', inset: 0, display: 'block', width: '100%', height: '100%' }}
      />

      {state === 'connected' && (
        <span
          aria-hidden
          style={{
            position: 'absolute',
            top: 'calc(18px + env(safe-area-inset-top, 0px))',
            left: 0,
            right: 0,
            textAlign: 'center',
            fontFamily: "'Inter', sans-serif",
            fontSize: 11,
            letterSpacing: '0.1em',
            color: 'rgba(220, 220, 230, 0.35)',
            pointerEvents: 'none',
          }}
        >
          {elapsedLabel}
        </span>
      )}

      <div
        role="status"
        aria-live="polite"
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 'calc(128px + env(safe-area-inset-bottom, 0px))',
          textAlign: 'center',
          fontFamily: "'Inter', sans-serif",
          fontSize: 12,
          letterSpacing: '0.06em',
          color: 'rgba(220, 220, 230, 0.5)',
          pointerEvents: 'none',
        }}
      >
        {statusLine}
      </div>

      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 'calc(40px + env(safe-area-inset-bottom, 0px))',
          display: 'flex',
          justifyContent: 'center',
          gap: 22,
          alignItems: 'center',
        }}
      >
        <button
          onClick={onToggleMute}
          disabled={state !== 'connected'}
          aria-label={muted ? 'Unmute' : 'Mute'}
          aria-pressed={muted}
          style={{
            width: 52,
            height: 52,
            borderRadius: '50%',
            border: '1px solid rgba(255, 255, 255, 0.14)',
            background: muted ? 'rgba(178,93,93,0.22)' : 'rgba(255,255,255,0.04)',
            color: 'rgba(230, 230, 240, 0.85)',
            cursor: state === 'connected' ? 'pointer' : 'default',
            opacity: state === 'connected' ? 1 : 0.35,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backdropFilter: 'blur(8px)',
            transition: 'all 0.2s',
          }}
        >
          {muted ? (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="1" y1="1" x2="23" y2="23" />
              <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
              <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23" />
              <line x1="12" y1="19" x2="12" y2="23" />
            </svg>
          ) : (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="23" />
            </svg>
          )}
        </button>

        <button
          ref={endButtonRef}
          onClick={onEnd}
          aria-label="End voice session"
          style={{
            width: 68,
            height: 68,
            borderRadius: '50%',
            border: 'none',
            background: 'rgba(178,93,93,0.88)',
            color: '#fff',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 4px 24px rgba(178,93,93,0.35)',
            transition: 'transform 0.15s',
          }}
          onMouseDown={(e) => { (e.currentTarget as HTMLButtonElement).style.transform = 'scale(0.96)' }}
          onMouseUp={(e) => { (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1)' }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1)' }}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91" />
            <line x1="23" y1="1" x2="1" y2="23" />
          </svg>
        </button>
      </div>
    </div>
  )
}
