import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { VoiceSessionOptions } from './useVoiceSession'

const voiceStart = vi.fn(async (options: VoiceSessionOptions) => { voiceMock.lastOptions = options })
const voiceStop = vi.fn()
const promptAssistant = vi.fn<(instructions: string) => boolean>(() => true)
const cancelResponse = vi.fn()
const setMicEnabled = vi.fn()
const dbAdd = vi.fn(async () => {})
const dbUpdate = vi.fn(async () => {})
const acquireWakeLock = vi.fn(async () => {})
const releaseWakeLock = vi.fn(async () => {})
const reacquireWakeLockIfVisible = vi.fn(async () => {})

const voiceMock: {
  state: 'idle' | 'connecting' | 'connected' | 'error'
  error: string | null
  lastOptions: VoiceSessionOptions | null
} = { state: 'idle', error: null, lastOptions: null }

vi.mock('./useVoiceSession', () => ({
  useVoiceSession: () => ({
    state: voiceMock.state,
    error: voiceMock.error,
    muted: false,
    assistantSpeaking: false,
    userSpeaking: false,
    start: voiceStart,
    stop: voiceStop,
    promptAssistant,
    cancelResponse,
    setMicEnabled,
    toggleMute: vi.fn(),
  }),
}))

const idMock = vi.hoisted(() => vi.fn(() => 'room-1'))
vi.mock('../store/db', () => ({
  generateId: () => idMock(),
  db: { roomSessions: { add: dbAdd, update: dbUpdate } },
}))

vi.mock('../store/settings', () => ({ updateSettings: vi.fn() }))

const globalConfigMock = vi.hoisted(() => ({ value: null as { voice?: { defaultVoice?: string } } | null }))
vi.mock('../store/globalConfig', () => ({ getGlobalConfig: () => globalConfigMock.value }))
vi.mock('../native/keepAwake', () => ({ acquireWakeLock, releaseWakeLock, reacquireWakeLockIfVisible }))

const languageMock = vi.hoisted(() => ({ code: 'en' }))
vi.mock('../i18n', () => ({ getLanguageCode: () => languageMock.code }))

const groundingMock = vi.hoisted(() => ({ active: false }))
vi.mock('../store/groundingState', () => ({ isGroundingActive: () => groundingMock.active }))

const authMock = vi.hoisted(() => ({ currentUser: { uid: 'user-1' } as { uid: string } | null }))
vi.mock('firebase/auth', () => ({ getAuth: () => authMock }))

const crisisFloorMock = vi.hoisted(() => vi.fn<(text: string) => boolean>(() => false))
vi.mock('../../functions/src/shared/crisisFloor', () => ({ detectCrisisKeywords: crisisFloorMock }))

const { useRoomSession } = await import('./useRoomSession')

const ARRIVAL = 'warm, simple sentence'

afterEach(() => { cleanup() })

function renderRoom(extra: {
  onEndRequested?: () => void
  onUserTranscript?: (text: string, owner: string | null) => void
  onAssistantTranscript?: (text: string, owner: string | null) => void
} = {}) {
  return renderHook(() => useRoomSession({
    parentSessionId: 'session-1',
    memoryAperture: 'pattern',
    ...extra,
  }))
}

function say(text: string) {
  act(() => { voiceMock.lastOptions?.onUserTranscript?.(text) })
}

describe('useRoomSession', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    voiceMock.state = 'idle'
    voiceMock.error = null
    voiceMock.lastOptions = null
    languageMock.code = 'en'
    groundingMock.active = false
    crisisFloorMock.mockImplementation(() => false)
    promptAssistant.mockImplementation(() => true)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('keeps Quiet company free of microphone and Realtime startup', async () => {
    const { result } = renderRoom()
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
    const { result } = renderRoom()
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
      voice: 'marin',
    }))
    expect(result.current.phase).toBe('threshold')
  })

  it('uses the admin-configured voice, like Speak', async () => {
    globalConfigMock.value = { voice: { defaultVoice: 'cedar' } }
    try {
      const { result } = renderRoom()
      await act(async () => {
        await result.current.start({
          approach: 'lead_me',
          duration: 5,
          voiceDensity: 'sparse',
          audioTrack: 'none',
          audioVolume: 0.4,
        }, 'room instructions')
      })
      expect(voiceStart).toHaveBeenCalledWith(expect.objectContaining({ voice: 'cedar' }))
    } finally {
      globalConfigMock.value = null
    }
  })

  it('moves into return on the score clock and can stay another minute', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(100_000)
    const { result, unmount } = renderRoom()
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

  it('surfaces blocked iOS sound and retries from a fresh tap', async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play')
      .mockRejectedValueOnce(new Error('NotAllowedError'))
      .mockResolvedValue(undefined)
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
    const { result, unmount } = renderRoom()
    await act(async () => {
      await result.current.start({
        approach: 'quiet_company',
        duration: 2,
        voiceDensity: 'quiet',
        audioTrack: 'ocean',
        audioVolume: 0.4,
      }, 'unused')
      await Promise.resolve()
    })
    expect(result.current.audioState).toBe('blocked')
    await act(async () => {
      result.current.retryAudio()
      await Promise.resolve()
    })
    expect(play).toHaveBeenCalledTimes(2)
    expect(result.current.audioState).toBe('playing')
    unmount()
  })
})

describe('useRoomSession — Listen-first "stay" (TECH_ISSUES #11)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    voiceMock.state = 'connected'
    voiceMock.lastOptions = null
    languageMock.code = 'en'
    groundingMock.active = false
    crisisFloorMock.mockImplementation(() => false)
    promptAssistant.mockImplementation(() => true)
  })
  afterEach(() => { vi.useRealTimers() })

  it('saying "stay" at the threshold starts the immersion clock instead of freezing it', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
    const { result, unmount } = renderRoom()
    await act(async () => {
      await result.current.start({ approach: 'listen_first', duration: 2, voiceDensity: 'sparse', audioTrack: 'none', audioVolume: 0.4 }, 'room')
    })
    expect(result.current.phase).toBe('threshold')
    say('another minute')
    expect(result.current.phase).toBe('immersing')
    act(() => { vi.advanceTimersByTime(1_000) })
    expect(result.current.elapsedMs).toBeGreaterThan(0)
    expect(promptAssistant).toHaveBeenCalledTimes(1)
    expect(promptAssistant.mock.calls[0][0]).toContain(ARRIVAL)
    unmount()
  })

  it('a later Room does not replay every cue from a stale timestamp', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
    const { result, unmount } = renderRoom()
    await act(async () => {
      await result.current.start({ approach: 'lead_me', duration: 2, voiceDensity: 'sparse', audioTrack: 'none', audioVolume: 0.4 }, 'room')
    })
    act(() => { vi.advanceTimersByTime(30_000) })
    act(() => { result.current.finish(false) })
    promptAssistant.mockClear()

    // Ten minutes later, a Listen-first Room; the writer says "stay" at the threshold.
    vi.setSystemTime(1_600_000)
    await act(async () => {
      await result.current.start({ approach: 'listen_first', duration: 2, voiceDensity: 'sparse', audioTrack: 'none', audioVolume: 0.4 }, 'room')
    })
    say('stay here')
    act(() => { vi.advanceTimersByTime(1_000) })
    expect(promptAssistant).toHaveBeenCalledTimes(1)
    expect(promptAssistant.mock.calls[0][0]).toContain(ARRIVAL)
    unmount()
  })
})

describe('useRoomSession — spoken controls (TECH_ISSUES #4, #31)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    voiceMock.state = 'connected'
    voiceMock.lastOptions = null
    languageMock.code = 'en'
    groundingMock.active = false
    crisisFloorMock.mockImplementation(() => false)
    promptAssistant.mockImplementation(() => true)
  })

  async function startedRoom(extra: Parameters<typeof renderRoom>[0] = {}) {
    const hook = renderRoom(extra)
    await act(async () => {
      await hook.result.current.start({ approach: 'lead_me', duration: 5, voiceDensity: 'sparse', audioTrack: 'none', audioVolume: 0.4 }, 'room')
    })
    return hook
  }

  it('routes a spoken "end" through onEndRequested back to Talk and persists endedAt', async () => {
    const onEndRequested = vi.fn()
    const { result } = await startedRoom({ onEndRequested })
    say("that's enough")
    expect(onEndRequested).toHaveBeenCalledTimes(1)
    expect(result.current.phase).toBe('choosing')
    await vi.waitFor(() => expect(dbUpdate).toHaveBeenCalledWith('room-1', expect.objectContaining({
      endedAt: expect.any(Number),
      completed: false,
      commands: ['end'],
    })))
  })

  it.each([
    'I want it all to end',
    'At the end of the day I just feel tired',
    "My boss wouldn't stop talking",
  ])('keeps Room open and the mic on for ordinary speech: %j', async (utterance) => {
    const onEndRequested = vi.fn()
    const onUserTranscript = vi.fn()
    const { result } = await startedRoom({ onEndRequested, onUserTranscript })
    say(utterance)
    expect(onUserTranscript).toHaveBeenCalledWith(utterance, 'session-1')
    expect(onEndRequested).not.toHaveBeenCalled()
    expect(setMicEnabled).not.toHaveBeenCalled()
    expect(result.current.phase).toBe('immersing')
  })

  it('skips command detection when the L1 floor fires on the text', async () => {
    const onEndRequested = vi.fn()
    const onUserTranscript = vi.fn()
    crisisFloorMock.mockImplementation(() => true)
    const { result } = await startedRoom({ onEndRequested, onUserTranscript })
    say("that's enough")
    expect(onUserTranscript).toHaveBeenCalled()
    expect(onEndRequested).not.toHaveBeenCalled()
    expect(result.current.phase).toBe('immersing')
  })

  it('skips command detection under grounding', async () => {
    groundingMock.active = true
    const onEndRequested = vi.fn()
    await startedRoom({ onEndRequested })
    say("that's enough")
    expect(onEndRequested).not.toHaveBeenCalled()
  })

  it('leaves spoken controls to the model in non-English sessions', async () => {
    languageMock.code = 'de'
    const { result } = await startedRoom()
    say('be quiet')
    expect(result.current.config?.voiceDensity).toBe('sparse')
    expect(setMicEnabled).not.toHaveBeenCalled()
  })

  it('still applies a short English control', async () => {
    const { result } = await startedRoom()
    say('be quiet')
    expect(result.current.config?.voiceDensity).toBe('quiet')
    expect(cancelResponse).toHaveBeenCalled()
    expect(setMicEnabled).toHaveBeenCalledWith(false)
  })
})

describe('useRoomSession — lifecycle (TECH_ISSUES #31)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    voiceMock.state = 'connected'
    voiceMock.error = null
    voiceMock.lastOptions = null
    languageMock.code = 'en'
    groundingMock.active = false
    crisisFloorMock.mockImplementation(() => false)
    promptAssistant.mockImplementation(() => true)
  })
  afterEach(() => { vi.useRealTimers() })

  it('unmounting a live Room persists endedAt (persist-only finish) and stops voice', async () => {
    const { result, unmount } = renderRoom()
    await act(async () => {
      await result.current.start({ approach: 'lead_me', duration: 5, voiceDensity: 'sparse', audioTrack: 'none', audioVolume: 0.4 }, 'room')
    })
    unmount()
    expect(voiceStop).toHaveBeenCalled()
    await vi.waitFor(() => expect(dbUpdate).toHaveBeenCalledWith('room-1', expect.objectContaining({
      endedAt: expect.any(Number),
      completed: false,
    })))
  })

  it('acquires and releases the wake lock exactly once, and re-acquires on return to the page', async () => {
    const { result, unmount } = renderRoom()
    await act(async () => {
      await result.current.start({ approach: 'quiet_company', duration: 2, voiceDensity: 'quiet', audioTrack: 'none', audioVolume: 0.4 }, 'unused')
    })
    expect(acquireWakeLock).toHaveBeenCalledTimes(1)
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })
    expect(reacquireWakeLockIfVisible).toHaveBeenCalledTimes(1)

    act(() => { result.current.finish(false) })
    unmount()
    expect(releaseWakeLock).toHaveBeenCalledTimes(1)
  })

  it('does not burst past cues when the density changes mid-room', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
    const { result, unmount } = renderRoom()
    await act(async () => {
      await result.current.start({ approach: 'lead_me', duration: 5, voiceDensity: 'sparse', audioTrack: 'none', audioVolume: 0.4 }, 'room')
    })
    act(() => { vi.advanceTimersByTime(120_000) })
    expect(promptAssistant).toHaveBeenCalledTimes(1) // arrival only
    act(() => { result.current.setVoiceDensity('present') })
    act(() => { vi.advanceTimersByTime(1_000) })
    // The "present" score's arrival (0s) and first company (102s) are in the past.
    expect(promptAssistant).toHaveBeenCalledTimes(1)
    unmount()
  })

  it('waits for a quiet moment to deliver a cue, and drops it when too late', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
    promptAssistant.mockImplementation(() => false) // a response is active / writer speaking
    const { result, unmount } = renderRoom()
    await act(async () => {
      await result.current.start({ approach: 'lead_me', duration: 5, voiceDensity: 'sparse', audioTrack: 'none', audioVolume: 0.4 }, 'room')
    })
    act(() => { vi.advanceTimersByTime(2_000) })
    const attemptsWhileBusy = promptAssistant.mock.calls.length
    expect(attemptsWhileBusy).toBeGreaterThan(1)
    promptAssistant.mockImplementation(() => true)
    act(() => { vi.advanceTimersByTime(250) })
    expect(promptAssistant).toHaveBeenCalledTimes(attemptsWhileBusy + 1)
    act(() => { vi.advanceTimersByTime(10_000) })
    expect(promptAssistant).toHaveBeenCalledTimes(attemptsWhileBusy + 1)

    // A cue that never finds a quiet moment within the grace window is dropped.
    promptAssistant.mockClear()
    promptAssistant.mockImplementation(() => false)
    act(() => { vi.advanceTimersByTime(168_000 - 12_250) }) // past company cue (168s) + grace
    act(() => { vi.advanceTimersByTime(20_000) })
    const busyAttempts = promptAssistant.mock.calls.length
    act(() => { vi.advanceTimersByTime(5_000) })
    expect(promptAssistant.mock.calls.length).toBe(busyAttempts)
    unmount()
  })

  it('"continue quietly" clears the voice error by stopping voice and going quiet', async () => {
    voiceMock.state = 'error'
    voiceMock.error = 'voice.error.disconnected'
    const { result } = renderRoom()
    await act(async () => {
      await result.current.start({ approach: 'lead_me', duration: 5, voiceDensity: 'sparse', audioTrack: 'none', audioVolume: 0.4 }, 'room')
    })
    voiceStop.mockClear()
    act(() => { result.current.continueQuietly() })
    expect(voiceStop).toHaveBeenCalledTimes(1)
    expect(result.current.config?.voiceDensity).toBe('quiet')
  })

  it('keeps one clock interval across re-renders', async () => {
    vi.useFakeTimers()
    const setIntervalSpy = vi.spyOn(window, 'setInterval')
    const { result, rerender, unmount } = renderRoom()
    await act(async () => {
      await result.current.start({ approach: 'lead_me', duration: 5, voiceDensity: 'sparse', audioTrack: 'none', audioVolume: 0.4 }, 'room')
    })
    const afterStart = setIntervalSpy.mock.calls.length
    rerender()
    rerender()
    act(() => { vi.advanceTimersByTime(1_000) })
    expect(setIntervalSpy.mock.calls.length).toBe(afterStart)
    unmount()
  })
})

describe('useRoomSession — records keep the real choices (TECH_ISSUES T3)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    voiceMock.state = 'connected'
    voiceMock.lastOptions = null
    authMock.currentUser = { uid: 'user-1' }
    groundingMock.active = false
    crisisFloorMock.mockImplementation(() => false)
    idMock.mockImplementation(() => 'room-1')
    dbAdd.mockImplementation(async () => {})
    dbUpdate.mockImplementation(async () => {})
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
  })
  afterEach(() => { vi.restoreAllMocks() })

  it('a finished present/ocean Room is recorded as present/ocean, not quiet/none', async () => {
    const { result } = renderRoom()
    await act(async () => {
      await result.current.start({ approach: 'lead_me', duration: 5, voiceDensity: 'present', audioTrack: 'ocean', audioVolume: 0.4 }, 'room')
    })
    act(() => { result.current.finish(true) })
    await vi.waitFor(() => expect(dbUpdate).toHaveBeenCalledWith('room-1', expect.objectContaining({
      endedAt: expect.any(Number),
      completed: true,
      voiceDensity: 'present',
      audioTrack: 'ocean',
    })))
  })

  it("Room A's delayed write carries only A's snapshot after Room B has started", async () => {
    let releaseA: () => void = () => {}
    const ids = ['room-a', 'room-b']
    idMock.mockImplementation(() => ids.shift() ?? 'room-x')
    dbAdd.mockImplementationOnce(() => new Promise<void>(resolve => { releaseA = resolve }))
    const { result } = renderRoom()

    await act(async () => {
      await result.current.start({ approach: 'lead_me', duration: 5, voiceDensity: 'present', audioTrack: 'ocean', audioVolume: 0.4 }, 'room')
    })
    say('A: the river')
    act(() => { result.current.finish(false) })

    await act(async () => {
      await result.current.start({ approach: 'lead_me', duration: 2, voiceDensity: 'sparse', audioTrack: 'forest', audioVolume: 0.4 }, 'room')
    })
    say('B: the mountain')
    act(() => { result.current.finish(false) })

    expect(dbUpdate.mock.calls.some(call => call[0] === 'room-a')).toBe(false)
    await act(async () => { releaseA() })
    await vi.waitFor(() => expect(dbUpdate.mock.calls.some(call => call[0] === 'room-a' && 'endedAt' in (call[1] as object))).toBe(true))

    const aFinal = dbUpdate.mock.calls.filter(call => call[0] === 'room-a').at(-1)![1] as Record<string, unknown>
    expect(aFinal).toEqual(expect.objectContaining({ voiceDensity: 'present', audioTrack: 'ocean' }))
    expect(JSON.stringify(aFinal.transcript)).toContain('A: the river')
    expect(JSON.stringify(aFinal.transcript)).not.toContain('B: the mountain')
  })

  it('progress and final writes resolve out of order without stale data winning', async () => {
    let releaseProgress: () => void = () => {}
    dbUpdate.mockImplementationOnce(() => new Promise<void>(resolve => { releaseProgress = resolve }))
    const { result } = renderRoom()
    await act(async () => {
      await result.current.start({ approach: 'lead_me', duration: 5, voiceDensity: 'sparse', audioTrack: 'none', audioVolume: 0.4 }, 'room')
    })
    say('first words') // progress write, held pending
    await act(async () => { await Promise.resolve() })
    act(() => { result.current.finish(true) })
    await act(async () => { await Promise.resolve() })
    // The final write is queued behind the pending progress write.
    expect(dbUpdate).toHaveBeenCalledTimes(1)
    say('a late transcript after finish') // fenced: the Room already ended
    await act(async () => { releaseProgress() })
    await vi.waitFor(() => expect(dbUpdate).toHaveBeenCalledTimes(2))
    const last = dbUpdate.mock.calls[1][1] as Record<string, unknown>
    expect(last).toEqual(expect.objectContaining({ completed: true, endedAt: expect.any(Number) }))
    expect(JSON.stringify(last.transcript)).toContain('first words')
    expect(JSON.stringify(last.transcript)).not.toContain('late transcript')
  })

  it('writes the whole record at the end when the initial create failed', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    dbAdd.mockImplementationOnce(async () => { throw new Error('offline') })
    const { result } = renderRoom()
    await act(async () => {
      await result.current.start({ approach: 'quiet_company', duration: 2, voiceDensity: 'quiet', audioTrack: 'none', audioVolume: 0.4 }, 'unused')
    })
    act(() => { result.current.finish(false) })
    await vi.waitFor(() => expect(dbAdd).toHaveBeenCalledTimes(2))
    expect(dbAdd).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'room-1', endedAt: expect.any(Number), approach: 'quiet_company' }))
    expect(dbUpdate).not.toHaveBeenCalled()
  })

  it('never writes into another account after logout or a user switch', async () => {
    const { result } = renderRoom()
    await act(async () => {
      await result.current.start({ approach: 'lead_me', duration: 5, voiceDensity: 'sparse', audioTrack: 'none', audioVolume: 0.4 }, 'room')
    })
    authMock.currentUser = { uid: 'someone-else' }
    act(() => { result.current.finish(false) })
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(dbUpdate).not.toHaveBeenCalled()
  })
})

describe('useRoomSession — bound to its parent session (TECH_ISSUES T2)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    voiceMock.state = 'connected'
    voiceMock.lastOptions = null
    authMock.currentUser = { uid: 'user-1' }
    groundingMock.active = false
    crisisFloorMock.mockImplementation(() => false)
    idMock.mockImplementation(() => 'room-1')
    dbAdd.mockImplementation(async () => {})
    dbUpdate.mockImplementation(async () => {})
  })

  function renderWithParent(initial: string | null) {
    const onUserTranscript = vi.fn()
    const onAssistantTranscript = vi.fn()
    const onEndRequested = vi.fn()
    const hook = renderHook(({ parent }: { parent: string | null }) => useRoomSession({
      parentSessionId: parent,
      memoryAperture: 'pattern',
      onUserTranscript,
      onAssistantTranscript,
      onEndRequested,
    }), { initialProps: { parent: initial } })
    return { ...hook, onUserTranscript, onAssistantTranscript, onEndRequested }
  }

  const finalWrites = () => dbUpdate.mock.calls.filter(call => 'endedAt' in (call[1] as object))

  it('switching A → B ends the Room once, releases media, and drops late transcripts', async () => {
    const { result, rerender, onUserTranscript, onAssistantTranscript, onEndRequested } = renderWithParent('session-a')
    await act(async () => {
      await result.current.start({ approach: 'lead_me', duration: 5, voiceDensity: 'sparse', audioTrack: 'none', audioVolume: 0.4 }, 'room')
    })
    const callbacks = voiceMock.lastOptions!
    act(() => { callbacks.onUserTranscript?.('still in A') })
    expect(onUserTranscript).toHaveBeenCalledWith('still in A', 'session-a')

    rerender({ parent: 'session-b' })
    expect(onEndRequested).toHaveBeenCalledTimes(1)
    expect(voiceStop).toHaveBeenCalled()
    expect(result.current.phase).toBe('choosing')

    onUserTranscript.mockClear()
    act(() => {
      callbacks.onUserTranscript?.('late words')
      callbacks.onAssistantTranscript?.('late reply')
    })
    expect(onUserTranscript).not.toHaveBeenCalled()
    expect(onAssistantTranscript).not.toHaveBeenCalled()

    await vi.waitFor(() => expect(finalWrites()).toHaveLength(1))
    expect(finalWrites()[0][1]).toEqual(expect.objectContaining({ completed: false, parentSessionId: 'session-a' }))
  })

  it('/session/new adopting its real id is not a change of owner', async () => {
    const { result, rerender, onEndRequested, onUserTranscript } = renderWithParent(null)
    await act(async () => {
      await result.current.start({ approach: 'lead_me', duration: 5, voiceDensity: 'sparse', audioTrack: 'none', audioVolume: 0.4 }, 'room')
    })
    rerender({ parent: 'session-new-id' })
    expect(onEndRequested).not.toHaveBeenCalled()
    expect(result.current.phase).toBe('immersing')
    act(() => { voiceMock.lastOptions?.onUserTranscript?.('hello') })
    expect(onUserTranscript).toHaveBeenCalledWith('hello', 'session-new-id')
  })

  it('ends exactly once even while the voice connection is still starting', async () => {
    voiceStart.mockImplementationOnce((options: VoiceSessionOptions) => {
      voiceMock.lastOptions = options
      return new Promise<void>(() => {}) // never resolves
    })
    const { result, rerender, unmount } = renderWithParent('session-a')
    act(() => {
      void result.current.start({ approach: 'lead_me', duration: 5, voiceDensity: 'sparse', audioTrack: 'none', audioVolume: 0.4 }, 'room')
    })
    rerender({ parent: 'session-b' })
    unmount()
    await vi.waitFor(() => expect(finalWrites()).toHaveLength(1))
    await act(async () => { await Promise.resolve() })
    expect(finalWrites()).toHaveLength(1)
    expect(voiceStop).toHaveBeenCalled()
  })

  it('a grounding-forced unmount saves an interrupted end state', async () => {
    const { result, unmount } = renderWithParent('session-a')
    await act(async () => {
      await result.current.start({ approach: 'lead_me', duration: 5, voiceDensity: 'sparse', audioTrack: 'none', audioVolume: 0.4 }, 'room')
    })
    unmount()
    await vi.waitFor(() => expect(finalWrites()).toHaveLength(1))
    expect(finalWrites()[0][1]).toEqual(expect.objectContaining({ completed: false }))
    expect(voiceStop).toHaveBeenCalled()
  })
})

describe('useRoomSession — conservative spoken controls through the transcript callback (TECH_ISSUES T4)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    voiceMock.state = 'connected'
    voiceMock.lastOptions = null
    authMock.currentUser = { uid: 'user-1' }
    groundingMock.active = false
    languageMock.code = 'en'
    crisisFloorMock.mockImplementation(() => false)
    idMock.mockImplementation(() => 'room-1')
  })

  it.each([
    "Please don't stop now",
    "I'm not yet ready to talk about it",
    'she said "that\'s enough"',
    "don't end this room",
    'I need to finish my story',
  ])('treats %j as conversation', async utterance => {
    const onEndRequested = vi.fn()
    const { result } = renderRoom({ onEndRequested })
    await act(async () => {
      await result.current.start({ approach: 'lead_me', duration: 5, voiceDensity: 'sparse', audioTrack: 'none', audioVolume: 0.4 }, 'room')
    })
    say(utterance)
    expect(onEndRequested).not.toHaveBeenCalled()
    expect(result.current.phase).toBe('immersing')
    expect(result.current.extendedMs).toBe(0)
  })

  it('an explicit "End this room" still ends it', async () => {
    const onEndRequested = vi.fn()
    const { result } = renderRoom({ onEndRequested })
    await act(async () => {
      await result.current.start({ approach: 'lead_me', duration: 5, voiceDensity: 'sparse', audioTrack: 'none', audioVolume: 0.4 }, 'room')
    })
    say('End this room.')
    expect(onEndRequested).toHaveBeenCalledTimes(1)
  })
})
