import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

const authedPostMock = vi.fn(async () => ({ clientSecret: 'sk', model: 'gpt-realtime-2', voice: 'marin' }))
vi.mock('../api/authedFetch', () => ({ authedPost: (...a: unknown[]) => authedPostMock(...a) }))

import { useVoiceSession } from './useVoiceSession'

// Mutable per-test WebRTC doubles — start() wires localStreamRef + dcRef through
// these, which is the only way to reach the private refs the new methods touch.
let track: { enabled: boolean; stop: () => void; kind: string }
let dcMock: { send: ReturnType<typeof vi.fn>; close: () => void; readyState: string; onopen: null; onmessage: null }

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

describe('useVoiceSession — Drift additions', () => {
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

  it('cancelResponse() sends response.cancel when the channel is open', async () => {
    const { result } = await connected()
    act(() => { result.current.cancelResponse() })
    expect(dcMock.send).toHaveBeenCalledWith(JSON.stringify({ type: 'response.cancel' }))
  })

  it('cancelResponse() is a no-op (no throw) when the channel is closed', async () => {
    const { result } = await connected()
    dcMock.readyState = 'closed'
    dcMock.send.mockClear()
    expect(() => act(() => { result.current.cancelResponse() })).not.toThrow()
    expect(dcMock.send).not.toHaveBeenCalled()
  })
})
