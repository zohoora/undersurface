import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

const startMock = vi.fn()
const stopMock = vi.fn()
const speakMock = vi.fn()
let voiceStateMock: 'idle' | 'connecting' | 'connected' | 'error' = 'connected'

vi.mock('./useVoiceSession', () => ({
  useVoiceSession: () => ({
    state: voiceStateMock,
    assistantSpeaking: false,
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

  it('retries a cue after connecting', () => {
    voiceStateMock = 'connecting'
    const { rerender } = renderHook((options: DriftVoiceOptions) => useDriftVoice(options), { initialProps: base() })
    expect(speakMock).not.toHaveBeenCalled()
    voiceStateMock = 'connected'
    rerender(base())
    expect(speakMock).toHaveBeenCalledWith('Find your anchor.')
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
