import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

const authedPostMock = vi.fn(async () => ({ clientSecret: 'sk', model: 'gpt-realtime-2', voice: 'marin' }))
vi.mock('../api/authedFetch', () => ({ authedPost: (...a: unknown[]) => authedPostMock(...a) }))
// t() echoes the key so assertions read the resolved category.
vi.mock('../i18n', () => ({ t: (k: string) => k }))

import { useVoiceSession } from './useVoiceSession'

// Mutable per-test WebRTC doubles — start() wires localStreamRef + dcRef through
// these, which is the only way to reach the private refs the new methods touch.
let track: { enabled: boolean; stop: () => void; kind: string }
let dcMock: {
  send: ReturnType<typeof vi.fn>
  close: () => void
  readyState: string
  onopen: (() => void) | null
  onmessage: ((event: { data: string }) => void) | null
  onclose?: (() => void) | null
  onerror?: (() => void) | null
}
let lastPc: MockPeerConnection | null = null
function registerPc(pc: MockPeerConnection) { lastPc = pc }

class MockPeerConnection {
  constructor() { registerPc(this) }
  ontrack: ((e: unknown) => void) | null = null
  connectionState = 'new'
  iceConnectionState = 'new'
  onconnectionstatechange: (() => void) | null = null
  oniceconnectionstatechange: (() => void) | null = null
  createDataChannel = vi.fn(() => dcMock)
  createOffer = vi.fn(async () => ({ type: 'offer', sdp: 'offer-sdp' }))
  setLocalDescription = vi.fn(async () => {})
  setRemoteDescription = vi.fn(async () => {})
  addTrack = vi.fn()
  close = vi.fn()
}

beforeEach(() => {
  track = { enabled: true, stop: vi.fn(), kind: 'audio' }
  dcMock = { send: vi.fn(), close: vi.fn(), readyState: 'open', onopen: null, onmessage: null }
  const stream = { getAudioTracks: () => [track], getTracks: () => [track] }
  vi.stubGlobal('RTCPeerConnection', MockPeerConnection)
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, text: async () => 'answer-sdp' })))
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia: vi.fn(async () => stream) },
    configurable: true,
  })
  authedPostMock.mockClear()
})

afterEach(() => { vi.unstubAllGlobals() })

async function connected() {
  const hook = renderHook(() => useVoiceSession())
  await act(async () => { await hook.result.current.start({ instructions: 'test' }) })
  act(() => { dcMock.onopen?.() })
  return hook
}

function receiveServerEvent(event: Record<string, unknown>) {
  act(() => { dcMock.onmessage?.({ data: JSON.stringify(event) }) })
}

describe('useVoiceSession — Drift additions', () => {
  it('requests the microphone before token minting so iOS keeps the initiating tap', async () => {
    await connected()
    const getUserMedia = navigator.mediaDevices.getUserMedia as ReturnType<typeof vi.fn>
    expect(getUserMedia).toHaveBeenCalledOnce()
    expect(authedPostMock).toHaveBeenCalledOnce()
    expect(getUserMedia.mock.invocationCallOrder[0]).toBeLessThan(authedPostMock.mock.invocationCallOrder[0])
  })

  it('setMicEnabled(false) disables all audio tracks and mutes deterministically', async () => {
    const { result } = await connected()
    act(() => { result.current.setMicEnabled(false) })
    expect(track.enabled).toBe(false)
    expect(result.current.muted).toBe(true)
    // Idempotent — unlike toggleMute, a repeat call does not flip back.
    act(() => { result.current.setMicEnabled(false) })
    expect(result.current.muted).toBe(true)
    act(() => { result.current.setMicEnabled(true) })
    expect(track.enabled).toBe(true)
    expect(result.current.muted).toBe(false)
  })

  it('cancelResponse() only sends response.cancel while a response is active', async () => {
    const { result } = await connected()
    act(() => { result.current.cancelResponse() })
    expect(dcMock.send).not.toHaveBeenCalled()

    receiveServerEvent({ type: 'response.created', response: { id: 'response-1' } })
    act(() => { result.current.cancelResponse() })
    expect(dcMock.send).toHaveBeenCalledOnce()
    expect(JSON.parse(dcMock.send.mock.calls[0][0])).toEqual(expect.objectContaining({
      type: 'response.cancel',
      event_id: expect.stringMatching(/^cancel_/),
    }))
  })

  it('keeps a healthy session intact when a raced cancel returns a recoverable error', async () => {
    const { result } = await connected()
    receiveServerEvent({ type: 'response.created', response: { id: 'response-1' } })
    act(() => { result.current.cancelResponse() })
    const cancelEvent = JSON.parse(dcMock.send.mock.calls[0][0]) as { event_id: string }

    receiveServerEvent({
      type: 'error',
      error: {
        type: 'invalid_request_error',
        code: 'response_cancel_not_active',
        message: 'Cancellation failed: no active response found',
        event_id: cancelEvent.event_id,
      },
    })

    expect(result.current.error).toBeNull()
    expect(track.enabled).toBe(true)
  })

  it('logs an unrelated recoverable server event without presenting a fatal voice error', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { result } = await connected()
    receiveServerEvent({
      type: 'error',
      error: { type: 'invalid_request_error', code: 'invalid_event', message: 'Recoverable event problem' },
    })
    expect(consoleError).toHaveBeenCalled()
    expect(result.current.error).toBeNull()
  })

  it('cancelResponse() is a no-op (no throw) when the channel is closed', async () => {
    const { result } = await connected()
    dcMock.readyState = 'closed'
    dcMock.send.mockClear()
    expect(() => act(() => { result.current.cancelResponse() })).not.toThrow()
    expect(dcMock.send).not.toHaveBeenCalled()
  })
})

describe('useVoiceSession — dropped connections (TECH_ISSUES #7)', () => {
  it('a failed peer connection tears down the mic and surfaces a friendly error', async () => {
    const { result } = await connected()
    expect(result.current.state).toBe('connected')
    act(() => {
      lastPc!.connectionState = 'failed'
      lastPc!.onconnectionstatechange?.()
    })
    expect(result.current.state).toBe('error')
    expect(result.current.error).toBe('voice.error.disconnected')
    expect(track.stop).toHaveBeenCalled()
  })

  it('ICE failure is treated the same way', async () => {
    const { result } = await connected()
    act(() => {
      lastPc!.iceConnectionState = 'failed'
      lastPc!.oniceconnectionstatechange?.()
    })
    expect(result.current.state).toBe('error')
    expect(result.current.error).toBe('voice.error.disconnected')
  })

  it('ignores a transient ICE disconnect', async () => {
    const { result } = await connected()
    act(() => {
      lastPc!.iceConnectionState = 'disconnected'
      lastPc!.oniceconnectionstatechange?.()
    })
    expect(result.current.state).toBe('connected')
    expect(result.current.error).toBeNull()
  })

  it('a remote data-channel close or error ends the session with an error', async () => {
    const { result } = await connected()
    act(() => { dcMock.onclose?.() })
    expect(result.current.state).toBe('error')
    expect(result.current.error).toBe('voice.error.disconnected')
    expect(track.stop).toHaveBeenCalled()

    const second = await connected()
    act(() => { dcMock.onerror?.() })
    expect(second.result.current.state).toBe('error')
  })

  it('a user-initiated stop never reports a dropped connection', async () => {
    const { result } = await connected()
    const closeHandler = dcMock.onclose
    act(() => { result.current.stop() })
    act(() => { closeHandler?.() })
    expect(result.current.state).toBe('idle')
    expect(result.current.error).toBeNull()
  })

  it('treats a fatal server error (expired session) as a lost connection', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { result } = await connected()
    receiveServerEvent({
      type: 'error',
      error: { type: 'invalid_request_error', code: 'session_expired', message: 'Your session hit the maximum duration of 60 minutes.' },
    })
    expect(result.current.state).toBe('error')
    expect(result.current.error).toBe('voice.error.disconnected')
    expect(track.stop).toHaveBeenCalled()
  })

  it('maps the realtime-token daily budget 429 to a friendly limit message', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    authedPostMock.mockRejectedValueOnce(new Error('POST /api/realtime-token failed: 429 {"error":"limit","code":"voice_daily_budget_exceeded"}'))
    const hook = renderHook(() => useVoiceSession())
    await act(async () => { await hook.result.current.start({ instructions: 'test' }) })
    expect(hook.result.current.state).toBe('error')
    expect(hook.result.current.error).toBe('voice.error.budget')
  })

  it('maps the voice-disabled 403 to a friendly unavailable message', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    authedPostMock.mockRejectedValueOnce(new Error('POST /api/realtime-token failed: 403 {"error":"Voice is not available right now.","code":"voice_disabled"}'))
    const hook = renderHook(() => useVoiceSession())
    await act(async () => { await hook.result.current.start({ instructions: 'test' }) })
    expect(hook.result.current.error).toBe('voice.error.disabled')
  })
})

describe('useVoiceSession — promptAssistant (TECH_ISSUES #6, #31)', () => {
  it('sends the cue as a system item plus a bare response.create (never overriding session instructions)', async () => {
    const { result } = await connected()
    let sent = false
    act(() => { sent = result.current.promptAssistant('Offer one warm sentence.') })
    expect(sent).toBe(true)
    const events = dcMock.send.mock.calls.map(call => JSON.parse(call[0] as string))
    expect(events).toEqual([
      {
        type: 'conversation.item.create',
        item: { type: 'message', role: 'system', content: [{ type: 'input_text', text: 'Offer one warm sentence.' }] },
      },
      { type: 'response.create' },
    ])
    expect(JSON.stringify(events)).not.toContain('"instructions"')
  })

  it('does not fire while a response is active, a prompt is in flight, or the writer is speaking', async () => {
    const { result } = await connected()
    receiveServerEvent({ type: 'response.created' })
    expect(result.current.promptAssistant('cue')).toBe(false)
    receiveServerEvent({ type: 'response.done' })

    receiveServerEvent({ type: 'input_audio_buffer.speech_started' })
    expect(result.current.promptAssistant('cue')).toBe(false)
    receiveServerEvent({ type: 'input_audio_buffer.speech_stopped' })

    expect(result.current.promptAssistant('cue')).toBe(true)
    // The first prompt's response.created has not arrived yet.
    expect(result.current.promptAssistant('cue again')).toBe(false)
    expect(dcMock.send).toHaveBeenCalledTimes(2)
  })
})

describe('useVoiceSession — no session-prompt override path', () => {
  it('exposes no speak(): a response.instructions override would replace the session prompt and its safety rules', async () => {
    const { result } = await connected()
    expect(result.current).not.toHaveProperty('speak')
    expect(Object.keys(result.current)).toContain('promptAssistant')
  })

  it('always negotiates the real microphone track (the passive silent-track mode is gone)', async () => {
    await connected()
    expect(lastPc?.addTrack).toHaveBeenCalledWith(track, expect.anything())
  })
})
