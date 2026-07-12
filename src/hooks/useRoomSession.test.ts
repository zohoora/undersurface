import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const voiceStart = vi.fn(async () => {})
const voiceStop = vi.fn()
const dbAdd = vi.fn(async () => {})
const dbUpdate = vi.fn(async () => {})

vi.mock('./useVoiceSession', () => ({
  useVoiceSession: () => ({
    state: 'idle',
    error: null,
    muted: false,
    assistantSpeaking: false,
    userSpeaking: false,
    start: voiceStart,
    stop: voiceStop,
    promptAssistant: vi.fn(),
    cancelResponse: vi.fn(),
    setMicEnabled: vi.fn(),
    toggleMute: vi.fn(),
  }),
}))

vi.mock('../store/db', () => ({
  generateId: () => 'room-1',
  db: { roomSessions: { add: dbAdd, update: dbUpdate } },
}))

vi.mock('../store/settings', () => ({ updateSettings: vi.fn() }))
vi.mock('../native/keepAwake', () => ({
  acquireWakeLock: vi.fn(async () => {}),
  releaseWakeLock: vi.fn(async () => {}),
}))

const { useRoomSession } = await import('./useRoomSession')

describe('useRoomSession', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('keeps Quiet company free of microphone and Realtime startup', async () => {
    const { result } = renderHook(() => useRoomSession({
      parentSessionId: 'session-1',
      memoryAperture: 'pattern',
    }))
    await act(async () => {
      await result.current.start({
        approach: 'quiet_company',
        duration: 2,
        voiceDensity: 'quiet',
        audioTrack: 'none',
        audioVolume: 0.4,
      }, 'unused')
    })
    expect(voiceStart).not.toHaveBeenCalled()
    expect(result.current.phase).toBe('immersing')
    expect(dbAdd).toHaveBeenCalledWith(expect.objectContaining({ approach: 'quiet_company' }))
  })

  it('starts organic managed playback for a conversational Room', async () => {
    const { result } = renderHook(() => useRoomSession({
      parentSessionId: 'session-1',
      memoryAperture: 'pattern',
    }))
    await act(async () => {
      await result.current.start({
        approach: 'listen_first',
        duration: 5,
        voiceDensity: 'sparse',
        audioTrack: 'none',
        audioVolume: 0.4,
      }, 'organic room instructions')
    })
    expect(voiceStart).toHaveBeenCalledWith(expect.objectContaining({
      instructions: 'organic room instructions',
      managePlayback: true,
    }))
    expect(result.current.phase).toBe('threshold')
  })

  it('moves into return on the score clock and can stay another minute', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(100_000)
    const { result, unmount } = renderHook(() => useRoomSession({
      parentSessionId: 'session-1',
      memoryAperture: 'pattern',
    }))
    await act(async () => {
      await result.current.start({
        approach: 'quiet_company',
        duration: 2,
        voiceDensity: 'quiet',
        audioTrack: 'none',
        audioVolume: 0.4,
      }, 'unused')
    })
    act(() => {
      vi.advanceTimersByTime(120_250)
    })
    expect(result.current.phase).toBe('returning')
    act(() => result.current.stay())
    expect(result.current.phase).toBe('immersing')
    expect(result.current.extendedMs).toBe(60_000)
    unmount()
  })
})
