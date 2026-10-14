import { useCallback, useEffect, useRef, useState } from 'react'
import { authedPost } from '../api/authedFetch'
import { friendlyVoiceError, isFatalRealtimeServerError, VoiceConnectionLostError } from './voiceErrors'

export type VoiceSessionState = 'idle' | 'connecting' | 'connected' | 'error'

export interface VoiceSessionOptions {
  instructions: string
  voice?: string
  // Passive (one-way assistant → user) mode for relaxation/hypnotherapy.
  // Skips getUserMedia entirely (no mic prompt), uses a recvonly transceiver,
  // and skips the user-pace adaptation logic. Caller still receives assistant
  // transcripts.
  passive?: boolean
  // Active voice normally leaves playback to VoiceField's analyser graph.
  // Room has no VoiceField, so it asks this hook to play the remote stream.
  managePlayback?: boolean
  onUserTranscript?: (text: string) => void
  onAssistantTranscript?: (text: string) => void
  // Raw character-level deltas, for callers that want unbuffered output.
  onAssistantTranscriptDelta?: (delta: string) => void
  // Buffered fragments — fires only when accumulated deltas cross a word/punctuation
  // boundary. Use this for visualization; avoids per-character render churn.
  onAssistantWordFragment?: (fragment: string) => void
  onAssistantSpeakingChange?: (speaking: boolean) => void
  onUserSpeakingChange?: (speaking: boolean) => void
}

interface TokenResponse {
  clientSecret: string
  expiresAt?: number
  model: string
  voice: string
}

// Reference: ~12 chars/sec ≈ 150 wpm, a conversational baseline.
const BASE_SPEED = 0.88
const MIN_SPEED = 0.75
const MAX_SPEED = 1.0
const REFERENCE_RATE = 12
// AI should speak ~15% slower than the user's implied pace.
const MATCH_FACTOR = 0.85
// Short utterances skew the rolling average — filler words, VAD misfires.
const MIN_UTTERANCE_MS = 600
// Only push a session.update when the target speed actually moved.
const SPEED_UPDATE_THRESHOLD = 0.02
const RATE_HISTORY_SIZE = 6

export function useVoiceSession() {
  const [state, setState] = useState<VoiceSessionState>('idle')
  const [error, setError] = useState<string | null>(null)
  const [muted, setMuted] = useState(false)
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null)
  const [assistantSpeaking, setAssistantSpeaking] = useState(false)
  const [userSpeaking, setUserSpeaking] = useState(false)

  const pcRef = useRef<RTCPeerConnection | null>(null)
  const dcRef = useRef<RTCDataChannel | null>(null)
  const localStreamRef = useRef<MediaStream | null>(null)
  // Silent AudioContext used in passive mode to synthesize a muted audio
  // track. The Realtime API rejects recvonly SDP, so we send a silent
  // sendrecv track instead and close the context on teardown.
  const silentCtxRef = useRef<AudioContext | null>(null)
  const audioElRef = useRef<HTMLAudioElement | null>(null)
  const optsRef = useRef<VoiceSessionOptions | null>(null)
  const assistantBufferRef = useRef<string>('')
  // Un-emitted tail for word-fragment buffering (separate from the full-response
  // buffer above, which is used as a fallback when the API's `done` event lacks
  // a transcript). Cleared whenever a boundary fragment is flushed.
  const assistantWordBufferRef = useRef<string>('')
  // `response.cancel` is valid only while a response is in progress. The
  // Realtime API deliberately reports "nothing to cancel" as a recoverable
  // error, so keep the response lifecycle locally instead of turning a quiet
  // Room control tap into a fatal-looking voice failure.
  const responseActiveRef = useRef(false)
  const pendingCancelEventIdsRef = useRef(new Set<string>())
  const clientEventSequenceRef = useRef(0)
  // Writer currently speaking (server VAD) and a just-sent prompt whose
  // response.created has not arrived yet. promptAssistant never talks over
  // either: an app-timed cue must not interrupt the writer or a live reply.
  const userSpeakingRef = useRef(false)
  const promptInFlightUntilRef = useRef(0)

  const speechStartedAtRef = useRef<number | null>(null)
  const lastUserDurationRef = useRef<number | null>(null)
  const userRatesRef = useRef<number[]>([])
  const currentSpeedRef = useRef<number>(BASE_SPEED)
  const handleServerEventRef = useRef<(event: Record<string, unknown>) => void>(() => {})
  // Monotonic epoch. start() claims one at entry and checks it after every
  // await; teardown() bumps it so a stop()/unmount during the connect handshake
  // aborts the in-flight start before it establishes a live mic + peer
  // connection + billed realtime session with no owning UI.
  const startEpochRef = useRef(0)

  function computeTargetSpeed(): number {
    const rates = userRatesRef.current
    if (rates.length === 0) return BASE_SPEED
    const recent = rates.slice(-3)
    const avg = recent.reduce((a, b) => a + b, 0) / recent.length
    const userPace = avg / REFERENCE_RATE
    return Math.max(MIN_SPEED, Math.min(MAX_SPEED, userPace * MATCH_FACTOR))
  }

  function sendSessionUpdate(update: Record<string, unknown>): void {
    const dc = dcRef.current
    if (!dc || dc.readyState !== 'open') return
    try {
      // OpenAI Realtime API requires the session object to carry its `type`
      // discriminator on every session.update — same value used at mint time
      // (see realtimeTokenApi). Without it the server rejects with
      // "Missing required parameter: 'session.type'".
      dc.send(JSON.stringify({ type: 'session.update', session: { type: 'realtime', ...update } }))
    } catch (e) {
      console.warn('[useVoiceSession] session.update failed', e)
    }
  }

  const teardown = useCallback(() => {
    // Invalidate any in-flight start(): it will bail at its next await-check.
    startEpochRef.current++
    try { dcRef.current?.close() } catch { /* noop */ }
    dcRef.current = null

    try { pcRef.current?.close() } catch { /* noop */ }
    pcRef.current = null

    if (localStreamRef.current) {
      for (const track of localStreamRef.current.getTracks()) track.stop()
      localStreamRef.current = null
    }

    if (silentCtxRef.current) {
      try { void silentCtxRef.current.close() } catch { /* noop */ }
      silentCtxRef.current = null
    }

    if (audioElRef.current) {
      audioElRef.current.pause()
      audioElRef.current.srcObject = null
      audioElRef.current.remove()
      audioElRef.current = null
    }

    assistantBufferRef.current = ''
    assistantWordBufferRef.current = ''
    responseActiveRef.current = false
    pendingCancelEventIdsRef.current.clear()
    userSpeakingRef.current = false
    promptInFlightUntilRef.current = 0
    speechStartedAtRef.current = null
    lastUserDurationRef.current = null
    userRatesRef.current = []
    currentSpeedRef.current = BASE_SPEED
    setRemoteStream(null)
    setAssistantSpeaking(false)
    setUserSpeaking(false)
  }, [])

  const stop = useCallback(() => {
    teardown()
    setState('idle')
    setMuted(false)
    setError(null)
  }, [teardown])

  // A live connection was lost without the user stopping it: ICE/peer
  // connection failed or closed, the data channel closed or errored, or the
  // server reported a fatal error (expired session, bad client secret). Tear
  // everything down (mic tracks included) and surface a friendly error so the
  // UI stops saying "listening" and Room can offer its retry.
  const failConnection = useCallback((detail: string) => {
    console.warn('[useVoiceSession] connection lost:', detail)
    teardown()
    setMuted(false)
    setError(friendlyVoiceError(new VoiceConnectionLostError(detail)))
    setState('error')
  }, [teardown])
  const failConnectionRef = useRef(failConnection)
  failConnectionRef.current = failConnection

  const start = useCallback(async (options: VoiceSessionOptions) => {
    if (state === 'connecting' || state === 'connected') return
    // Claim this start. If teardown() bumps the epoch (stop/unmount) while we
    // await below, `cancelled()` becomes true and we release and bail.
    const myEpoch = ++startEpochRef.current
    const cancelled = () => startEpochRef.current !== myEpoch
    optsRef.current = options
    setState('connecting')
    setError(null)

    try {
      const passive = options.passive === true

      // Ask for active-session microphone access BEFORE the first network
      // await. iOS Safari ties media permission to the initiating tap; doing
      // token minting first can lose that activation and silently skip the
      // prompt in an installed PWA. Passive callers still never request it.
      if (!passive) {
        const localStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        })
        localStreamRef.current = localStream
        // The mic just went hot — if we were cancelled mid-prompt, stop it now.
        if (cancelled()) { teardown(); return }
      }

      const token = await authedPost<TokenResponse>('/api/realtime-token', {
        instructions: options.instructions,
        voice: options.voice,
      })
      if (cancelled()) { teardown(); return }

      const pc = new RTCPeerConnection()
      pcRef.current = pc
      // Local teardown bumps the epoch first, so these only fire for drops
      // the user did not ask for. `disconnected` is transient (ICE may
      // recover on its own); `failed`/`closed` are terminal.
      pc.onconnectionstatechange = () => {
        if (cancelled()) return
        const connectionState = pc.connectionState
        if (connectionState === 'failed' || connectionState === 'closed') {
          failConnectionRef.current(`peer connection ${connectionState}`)
        }
      }
      pc.oniceconnectionstatechange = () => {
        if (cancelled()) return
        const iceState = pc.iceConnectionState
        if (iceState === 'failed' || iceState === 'closed') {
          failConnectionRef.current(`ice ${iceState}`)
        }
      }

      // The <audio> element receives the remote stream. In active (two-way)
      // mode it stays muted because VoiceField's Web Audio graph handles
      // playback and the analyser tap (single playback path, lossless
      // analyser). In passive mode there is no VoiceField rendering — the
      // element must play the stream directly or the user hears nothing.
      const audioEl = document.createElement('audio')
      audioEl.autoplay = true
      audioEl.muted = !passive && options.managePlayback !== true
      audioEl.setAttribute('playsinline', 'true')
      audioEl.style.display = 'none'
      // Detached media elements are unreliable for WebRTC playback in iOS
      // Safari. Keep one hidden, attached element for the session lifetime.
      document.body.appendChild(audioEl)
      audioElRef.current = audioEl
      pc.ontrack = (event) => {
        const stream = event.streams[0]
        audioEl.srcObject = stream
        setRemoteStream(stream)
        if (passive || options.managePlayback === true) {
          void audioEl.play().catch(() => { /* browser may complete autoplay on the next packet */ })
        }
      }

      if (passive) {
        // The Realtime API rejects recvonly SDP — it expects bidirectional
        // (sendrecv) audio negotiation. We synthesize a silent track and
        // send that, so the SDP exchange succeeds but no real audio leaves
        // the device. No mic permission prompt either.
        const w = window as Window & { webkitAudioContext?: typeof AudioContext }
        const Ctx = window.AudioContext ?? w.webkitAudioContext
        if (Ctx) {
          const ctx = new Ctx()
          silentCtxRef.current = ctx
          const dst = ctx.createMediaStreamDestination()
          const osc = ctx.createOscillator()
          const gain = ctx.createGain()
          gain.gain.value = 0
          osc.connect(gain).connect(dst)
          osc.start()
          localStreamRef.current = dst.stream
          for (const track of dst.stream.getTracks()) {
            pc.addTrack(track, dst.stream)
          }
        }
        setMuted(true)
      } else {
        for (const track of localStreamRef.current!.getTracks()) {
          pc.addTrack(track, localStreamRef.current!)
        }
      }

      const dc = pc.createDataChannel('oai-events')
      dcRef.current = dc

      dc.onopen = () => {
        if (cancelled()) return
        setState('connected')
      }
      dc.onclose = () => {
        if (cancelled()) return
        failConnectionRef.current('data channel closed')
      }
      dc.onerror = () => {
        if (cancelled()) return
        failConnectionRef.current('data channel error')
      }

      dc.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data)
          // Through-ref dispatch so `handleServerEvent` doesn't have to be a
          // dependency of `start`. The handler closes over only refs/setters,
          // so a single instance is fine for the session's lifetime.
          handleServerEventRef.current(msg)
        } catch (err) {
          console.warn('Voice session: ignoring malformed datachannel event', err)
        }
      }

      const offer = await pc.createOffer()
      if (cancelled()) { teardown(); return }
      await pc.setLocalDescription(offer)
      if (cancelled()) { teardown(); return }

      const sdpResponse = await fetch(
        `https://api.openai.com/v1/realtime/calls?model=${encodeURIComponent(token.model)}`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token.clientSecret}`,
            'Content-Type': 'application/sdp',
          },
          body: offer.sdp ?? '',
        },
      )

      if (!sdpResponse.ok) {
        const body = await sdpResponse.text().catch(() => '')
        throw new Error(`SDP exchange failed: ${sdpResponse.status} ${body}`)
      }

      const answerSdp = await sdpResponse.text()
      if (cancelled()) { teardown(); return }
      await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp })
      if (cancelled()) { teardown(); return }
    } catch (e) {
      // Keep the raw error in the console for debugging, but show the user a
      // friendly, actionable message (mic blocked / no mic / service down).
      console.error('[useVoiceSession] start failed', e)
      setError(friendlyVoiceError(e))
      setState('error')
      teardown()
    }
  }, [state, teardown])

  handleServerEventRef.current = function handleServerEvent(event: Record<string, unknown>) {
    const opts = optsRef.current
    if (!opts) return
    const type = event.type as string | undefined

    switch (type) {
      case 'response.created': {
        responseActiveRef.current = true
        promptInFlightUntilRef.current = 0
        break
      }
      case 'input_audio_buffer.speech_started': {
        speechStartedAtRef.current = performance.now()
        userSpeakingRef.current = true
        setUserSpeaking(true)
        opts.onUserSpeakingChange?.(true)
        break
      }
      case 'input_audio_buffer.speech_stopped': {
        const startedAt = speechStartedAtRef.current
        if (startedAt !== null) {
          lastUserDurationRef.current = performance.now() - startedAt
          speechStartedAtRef.current = null
        }
        userSpeakingRef.current = false
        setUserSpeaking(false)
        opts.onUserSpeakingChange?.(false)
        break
      }
      case 'conversation.item.input_audio_transcription.completed': {
        const text = typeof event.transcript === 'string' ? event.transcript.trim() : ''
        if (!text) break
        opts.onUserTranscript?.(text)

        const durationMs = lastUserDurationRef.current
        if (durationMs && durationMs > MIN_UTTERANCE_MS) {
          const rate = text.length / (durationMs / 1000)
          userRatesRef.current.push(rate)
          if (userRatesRef.current.length > RATE_HISTORY_SIZE) userRatesRef.current.shift()
          const next = computeTargetSpeed()
          if (Math.abs(next - currentSpeedRef.current) >= SPEED_UPDATE_THRESHOLD) {
            currentSpeedRef.current = next
            sendSessionUpdate({ audio: { output: { speed: next } } })
          }
        }
        lastUserDurationRef.current = null
        break
      }
      case 'response.output_audio.delta':
      case 'response.audio.delta': {
        responseActiveRef.current = true
        setAssistantSpeaking(true)
        opts.onAssistantSpeakingChange?.(true)
        break
      }
      case 'response.output_audio_transcript.delta':
      case 'response.audio_transcript.delta': {
        const delta = typeof event.delta === 'string' ? event.delta : ''
        if (!delta) break
        assistantBufferRef.current += delta
        opts.onAssistantTranscriptDelta?.(delta)
        // Boundary-buffer for visualization callers: emit complete words/phrases
        // when whitespace or terminal punctuation arrives. Saves consumers from
        // per-character render churn.
        if (opts.onAssistantWordFragment) {
          assistantWordBufferRef.current += delta
          const buf = assistantWordBufferRef.current
          const lastBoundary = Math.max(
            buf.lastIndexOf(' '),
            buf.lastIndexOf('.'),
            buf.lastIndexOf('!'),
            buf.lastIndexOf('?'),
            buf.lastIndexOf(','),
            buf.lastIndexOf('\n'),
          )
          if (lastBoundary > 0) {
            const ready = buf.slice(0, lastBoundary + 1).trim()
            assistantWordBufferRef.current = buf.slice(lastBoundary + 1)
            if (ready) opts.onAssistantWordFragment(ready)
          }
        }
        break
      }
      case 'response.output_audio_transcript.done':
      case 'response.audio_transcript.done': {
        const finalText = (typeof event.transcript === 'string' && event.transcript.trim())
          ? event.transcript.trim()
          : assistantBufferRef.current.trim()
        if (finalText) opts.onAssistantTranscript?.(finalText)
        assistantBufferRef.current = ''
        // Whole-message transcript supersedes any partial word-buffer tail.
        assistantWordBufferRef.current = ''
        break
      }
      case 'response.done':
      case 'response.output_audio.done':
      case 'response.audio.done': {
        responseActiveRef.current = false
        promptInFlightUntilRef.current = 0
        pendingCancelEventIdsRef.current.clear()
        setAssistantSpeaking(false)
        opts.onAssistantSpeakingChange?.(false)
        break
      }
      case 'error': {
        const err = event.error as { message?: string; code?: string; type?: string; event_id?: string } | undefined
        if (err?.event_id && pendingCancelEventIdsRef.current.delete(err.event_id)) {
          // A response can finish in the few milliseconds between our local
          // lifecycle check and the server receiving response.cancel. OpenAI
          // documents this error as recoverable and the session remains live.
          console.info('[useVoiceSession] response already quiet at cancel time')
          break
        }
        console.error('[useVoiceSession] server error:', err?.message ?? '(no message)', err?.code ?? '', err?.type ?? '', event)
        // Realtime `error` events are generally recoverable and leave the
        // session connected. Log them for diagnosis; a recoverable event must
        // not replace a still-live conversation with a fatal-looking error.
        // The exceptions mean the session itself is gone (expired, revoked
        // credentials): treat those as a lost connection.
        if (isFatalRealtimeServerError(err)) {
          failConnectionRef.current(`server error ${err?.code ?? err?.type ?? ''}`.trim())
        }
        break
      }
    }
  }

  const toggleMute = useCallback(() => {
    const stream = localStreamRef.current
    if (!stream) return
    const nextMuted = !muted
    for (const track of stream.getAudioTracks()) {
      track.enabled = !nextMuted
    }
    setMuted(nextMuted)
  }, [muted])

  // Deterministic mic gate for Drift (unlike toggleMute's flip): disables/enables
  // all local audio tracks and forces `muted` to match, regardless of prior state.
  const setMicEnabled = useCallback((enabled: boolean) => {
    const stream = localStreamRef.current
    if (!stream) return
    for (const track of stream.getAudioTracks()) track.enabled = enabled
    setMuted(!enabled)
  }, [])

  // Interrupt an in-flight assistant response (Drift mic gating + transcript
  // crisis floor). No-op when the data channel isn't open.
  const cancelResponse = useCallback(() => {
    const dc = dcRef.current
    if (!dc || dc.readyState !== 'open' || !responseActiveRef.current) return
    const eventId = `cancel_${Date.now()}_${++clientEventSequenceRef.current}`
    pendingCancelEventIdsRef.current.add(eventId)
    try {
      dc.send(JSON.stringify({ type: 'response.cancel', event_id: eventId }))
    } catch {
      pendingCancelEventIdsRef.current.delete(eventId)
    }
  }, [])

  // Tell the connected assistant to vocalize a specific phrase. The
  // `instructions` override scopes to this single response — the session-level
  // persona stays intact. Used by passive (one-way) callers like Relax mode
  // to pace pre-scripted hypnotherapy cues.
  const speak = useCallback((text: string) => {
    const dc = dcRef.current
    if (!dc || dc.readyState !== 'open') return
    try {
      const escaped = text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
      // Realtime API default output_modalities is ["audio"]; omit the field
      // and rely on the session-level audio config. The old `modalities`
      // shape was rejected by gpt-realtime as an unknown parameter.
      dc.send(JSON.stringify({
        type: 'response.create',
        response: {
          instructions: `Say exactly this, slowly and softly with natural pauses, in a calm hypnotic voice. Add nothing. Phrase to speak: "${escaped}"`,
        },
      }))
    } catch (err) {
      console.warn('[useVoiceSession] speak failed', err)
    }
  }, [])

  // Ask the connected model for an organic response scoped to one purpose.
  // Unlike speak(), this deliberately does not prescribe exact wording or a
  // vocal performance. Room uses it for sparse score cues while the model
  // retains the conversation and its ordinary voice.
  //
  // The cue travels as a system-role conversation item followed by a bare
  // response.create. Per the Realtime API reference, `response.instructions`
  // on response.create OVERRIDES the session instructions for that response,
  // which would generate the cue without SAFETY_RULES, the language
  // directive, Fresh-eyes boundaries or the Room rules. A conversation item
  // adds to the context instead of replacing it.
  //
  // Returns false (nothing sent) while a response is active, a prompt is in
  // flight, or the writer is speaking; the caller may retry on a later tick.
  const promptAssistant = useCallback((instructions: string): boolean => {
    const dc = dcRef.current
    if (!dc || dc.readyState !== 'open') return false
    if (responseActiveRef.current || userSpeakingRef.current || Date.now() < promptInFlightUntilRef.current) return false
    try {
      dc.send(JSON.stringify({
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'system',
          content: [{ type: 'input_text', text: instructions }],
        },
      }))
      dc.send(JSON.stringify({ type: 'response.create' }))
      // Until response.created lands, treat the channel as busy so two ticks
      // cannot stack prompts.
      promptInFlightUntilRef.current = Date.now() + 5_000
      return true
    } catch (err) {
      console.warn('[useVoiceSession] promptAssistant failed', err)
      return false
    }
  }, [])

  useEffect(() => {
    return () => {
      teardown()
    }
  }, [teardown])

  return {
    state,
    error,
    muted,
    remoteStream,
    assistantSpeaking,
    userSpeaking,
    start,
    stop,
    speak,
    promptAssistant,
    toggleMute,
    setMicEnabled,
    cancelResponse,
    sendSessionUpdate,
  }
}
