import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

const authedPostMock = vi.fn(async () => ({ clientSecret: 'sk', model: 'gpt-realtime-2', voice: 'marin' }))
vi.mock('../api/authedFetch', () => ({ authedPost: (...a: unknown[]) => authedPostMock(...a) }))

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
}

class MockPeerConnection {
  ontrack: ((e: unknown) => void) | null = null
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
