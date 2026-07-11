import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'

const startMock = vi.fn()
const stopMock = vi.fn()
const speakMock = vi.fn()
let voiceStateMock: 'idle' | 'connecting' | 'connected' | 'error' = 'connected'
let assistantSpeakingMock = false

vi.mock('./useVoiceSession', () => ({
  useVoiceSession: () => ({
    state: voiceStateMock,
    assistantSpeaking: assistantSpeakingMock,
    error: voiceStateMock === 'error' ? 'failed' : null,
    start: startMock,
    stop: stopMock,
    speak: speakMock,
  }),
}))
vi.mock('../ai/driftPrompts', () => ({ buildDriftVoiceInstructions: () => 'DRIFT_VOICE_INSTR' }))
vi.mock('../i18n', () => ({ getLanguageCode: () => 'en' }))

import { useDriftVoice, type DriftVoiceOptions } from './useDriftVoice'

const parts: string[] = []
function base(overrides: Partial<DriftVoiceOptions> = {}): DriftVoiceOptions {
  return { enabled: true, cueKey: 'set:0', cueText: 'Find your anchor.', userPartNames: parts, ...overrides }
}

beforeEach(() => {
  vi.clearAllMocks()
  voiceStateMock = 'connected'
  assistantSpeakingMock = false
})

describe('useDriftVoice', () => {
  it('starts in passive mode so Drift never requests microphone access', () => {
    renderHook(() => useDriftVoice(base()))
    expect(startMock).toHaveBeenCalledWith({ instructions: 'DRIFT_VOICE_INSTR', passive: true })
    expect(startMock.mock.calls[0][0]).not.toHaveProperty('onUserTranscript')
  })

  it('does not start when disabled', () => {
    renderHook(() => useDriftVoice(base({ enabled: false })))
    expect(startMock).not.toHaveBeenCalled()
  })

  it('primes device guidance directly from the Begin gesture', async () => {
    class FakeUtterance {
      onend: null | (() => void) = null
      onerror: null | (() => void) = null
      lang = ''
      rate = 1
      pitch = 1
      volume = 1
      constructor(public text: string) {}
    }
    const localSpeech = { cancel: vi.fn(), speak: vi.fn() }
    vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance)
    vi.stubGlobal('speechSynthesis', localSpeech)
    try {
      const { result, rerender } = renderHook((options: DriftVoiceOptions) => useDriftVoice(options), { initialProps: base({ enabled: false, cueKey: 'arrive:0' }) })
      let primed = false
      await act(async () => {
        primed = result.current.primeCue('set:0', 'Picture a calm place.')
        await Promise.resolve()
      })
      expect(primed).toBe(true)
      expect(localSpeech.speak).toHaveBeenCalledTimes(1)
      expect(result.current.cueState).toBe('speaking')
      expect(result.current.usingDeviceVoice).toBe(true)
      expect(startMock).not.toHaveBeenCalled()
      rerender(base({ enabled: true, cueKey: 'set:0', cueText: 'Picture a calm place.' }))
      await act(async () => { await Promise.resolve() })
      expect(result.current.cueState).toBe('speaking')
      expect(startMock).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('retries a cue after connecting', () => {
    voiceStateMock = 'connecting'
    const { rerender } = renderHook((options: DriftVoiceOptions) => useDriftVoice(options), { initialProps: base() })
    expect(speakMock).not.toHaveBeenCalled()
    voiceStateMock = 'connected'
    rerender(base())
    expect(speakMock).toHaveBeenCalledWith('Find your anchor.')
  })

  it('reports waiting, speaking, then complete so the rhythm can follow the voice', async () => {
    const { result, rerender } = renderHook((options: DriftVoiceOptions) => useDriftVoice(options), { initialProps: base() })
    expect(result.current.cueState).toBe('waiting')

    assistantSpeakingMock = true
    rerender(base())
    await waitFor(() => expect(result.current.cueState).toBe('speaking'))

    assistantSpeakingMock = false
    rerender(base())
    await waitFor(() => expect(result.current.cueState).toBe('complete'))
  })

  it('fails open without a late overlapping cue when speech never starts', () => {
    vi.useFakeTimers()
    try {
      const { result, rerender } = renderHook((options: DriftVoiceOptions) => useDriftVoice(options), { initialProps: base() })
      act(() => { vi.advanceTimersByTime(8_001) })
      expect(result.current.cueState).toBe('failed')
      expect(stopMock).toHaveBeenCalled()
      const requestsBefore = speakMock.mock.calls.length
      rerender(base({ cueKey: 'notice:1', cueText: 'What do you notice?' }))
      expect(result.current.cueState).toBe('failed')
      expect(speakMock).toHaveBeenCalledTimes(requestsBefore)
    } finally {
      vi.useRealTimers()
    }
  })

  it('falls back to device speech once, then uses it immediately for later cues', async () => {
    vi.useFakeTimers()
    const spoken: Array<{ onend: null | (() => void) }> = []
    class FakeUtterance {
      onend: null | (() => void) = null
      onerror: null | (() => void) = null
      lang = ''
      rate = 1
      pitch = 1
      volume = 1
      constructor(public text: string) {}
    }
    const localSpeech = { cancel: vi.fn(), speak: vi.fn((utterance: FakeUtterance) => spoken.push(utterance)) }
    vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance)
    vi.stubGlobal('speechSynthesis', localSpeech)
    try {
      const { result, rerender } = renderHook((options: DriftVoiceOptions) => useDriftVoice(options), { initialProps: base() })
      await act(async () => { vi.advanceTimersByTime(8_001); await Promise.resolve() })
      expect(localSpeech.speak).toHaveBeenCalledTimes(1)
      expect(result.current.cueState).toBe('speaking')
      expect(result.current.usingDeviceVoice).toBe(true)
      await act(async () => { spoken[0].onend?.(); await Promise.resolve() })
      expect(result.current.cueState).toBe('complete')

      rerender(base({ cueKey: 'notice:1', cueText: 'What do you notice?' }))
      await act(async () => { await Promise.resolve() })
      expect(localSpeech.speak).toHaveBeenCalledTimes(2)
      expect(result.current.cueState).toBe('speaking')
    } finally {
      vi.useRealTimers()
      vi.unstubAllGlobals()
    }
  })

  it('speaks once per cue key, including repeated set phases', () => {
    const { rerender } = renderHook((options: DriftVoiceOptions) => useDriftVoice(options), { initialProps: base() })
    expect(speakMock).toHaveBeenCalledTimes(1)
    rerender(base({ cueText: 'A changed render.' }))
    expect(speakMock).toHaveBeenCalledTimes(1)
    rerender(base({ cueKey: 'notice:1', cueText: 'Choose softer, same, or stronger.' }))
    expect(speakMock).toHaveBeenLastCalledWith('Choose softer, same, or stronger.')
    rerender(base({ cueKey: 'set:1', cueText: 'Let it loosen.' }))
    expect(speakMock).toHaveBeenLastCalledWith('Let it loosen.')
    expect(speakMock).toHaveBeenCalledTimes(3)
  })

  it('reports the first cue request to operational telemetry', () => {
    const onCueRequested = vi.fn()
    renderHook(() => useDriftVoice(base({ onCueRequested })))
    expect(onCueRequested).toHaveBeenCalledTimes(1)
    expect(speakMock).toHaveBeenCalledWith('Find your anchor.')
  })

  it('surfaces connection errors without blocking the visual practice', () => {
    voiceStateMock = 'error'
    const { result } = renderHook(() => useDriftVoice(base()))
    expect(result.current.error).toBe('failed')
    expect(result.current.voiceState).toBe('error')
  })

  it('stops the one-way session on unmount', () => {
    const { unmount } = renderHook(() => useDriftVoice(base()))
    unmount()
    expect(stopMock).toHaveBeenCalled()
  })
})
