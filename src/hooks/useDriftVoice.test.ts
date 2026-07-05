import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

const startMock = vi.fn()
const stopMock = vi.fn()
const speakMock = vi.fn()
const setMicEnabledMock = vi.fn()
const cancelResponseMock = vi.fn()
let capturedOnUserTranscript: ((t: string) => void) | undefined
vi.mock('./useVoiceSession', () => ({
  useVoiceSession: () => ({
    state: 'connected',
    assistantSpeaking: false,
    start: (o: { onUserTranscript?: (t: string) => void }) => { capturedOnUserTranscript = o.onUserTranscript; return startMock(o) },
    stop: stopMock,
    speak: speakMock,
    setMicEnabled: setMicEnabledMock,
    cancelResponse: cancelResponseMock,
  }),
}))

vi.mock('../ai/driftPrompts', () => ({ buildDriftVoiceInstructions: () => 'DRIFT_VOICE_INSTR' }))
const detectCrisisKeywordsMock = vi.fn(() => false)
vi.mock('../engine/sessionOrchestrator', () => ({ detectCrisisKeywords: (...a: unknown[]) => detectCrisisKeywordsMock(...(a as [])) }))
const activateGroundingMock = vi.fn()
vi.mock('../store/groundingState', () => ({ activateGrounding: (...a: unknown[]) => activateGroundingMock(...a) }))
const classifyCrisisRiskMock = vi.fn(async () => ({ risk: 0 as 0 | 1 | 2 }))
vi.mock('../ai/openrouter', () => ({ classifyCrisisRisk: (...a: unknown[]) => classifyCrisisRiskMock(...(a as [])) }))
vi.mock('../i18n', () => ({ getLanguageCode: () => 'en' }))

import { useDriftVoice, type DriftVoiceOptions } from './useDriftVoice'

function base(over: Partial<DriftVoiceOptions> = {}): DriftVoiceOptions {
  return { enabled: true, phase: 'anchor', cueText: null, userPartNames: [], onUtterance: vi.fn(), onCrisis: vi.fn(), ...over }
}

beforeEach(() => {
  vi.clearAllMocks()
  detectCrisisKeywordsMock.mockReturnValue(false)
  classifyCrisisRiskMock.mockResolvedValue({ risk: 0 })
  capturedOnUserTranscript = undefined
})

describe('useDriftVoice', () => {
  it('starts the Realtime session with the Drift voice instructions when enabled', () => {
    renderHook(() => useDriftVoice(base({ enabled: true })))
    expect(startMock).toHaveBeenCalledWith(expect.objectContaining({ instructions: 'DRIFT_VOICE_INSTR' }))
  })

  it('does not start when disabled', () => {
    renderHook(() => useDriftVoice(base({ enabled: false })))
    expect(startMock).not.toHaveBeenCalled()
  })

  it('gates the mic: closed during set, open during notice', () => {
    const { rerender } = renderHook((p: DriftVoiceOptions) => useDriftVoice(p), { initialProps: base({ phase: 'set' }) })
    expect(setMicEnabledMock).toHaveBeenLastCalledWith(false)
    rerender(base({ phase: 'notice' }))
    expect(setMicEnabledMock).toHaveBeenLastCalledWith(true)
  })

  it('speaks a cue once per phase entry', () => {
    const { rerender } = renderHook((p: DriftVoiceOptions) => useDriftVoice(p), { initialProps: base({ phase: 'anchor', cueText: 'anchor cue' }) })
    expect(speakMock).toHaveBeenCalledWith('anchor cue')
    expect(speakMock).toHaveBeenCalledTimes(1)
    rerender(base({ phase: 'anchor', cueText: 'anchor cue' }))
    expect(speakMock).toHaveBeenCalledTimes(1) // same phase → not re-spoken
    rerender(base({ phase: 'settle', cueText: 'settle cue' }))
    expect(speakMock).toHaveBeenCalledWith('settle cue')
    expect(speakMock).toHaveBeenCalledTimes(2)
  })

  it('a crisis-keyword transcript cancels the response and fires onCrisis (no utterance)', () => {
    detectCrisisKeywordsMock.mockReturnValue(true)
    const onCrisis = vi.fn()
    const onUtterance = vi.fn()
    renderHook(() => useDriftVoice(base({ onCrisis, onUtterance })))
    act(() => { capturedOnUserTranscript?.('i want to die') })
    expect(cancelResponseMock).toHaveBeenCalled()
    expect(activateGroundingMock).toHaveBeenCalled()
    expect(onCrisis).toHaveBeenCalled()
    expect(onUtterance).not.toHaveBeenCalled()
  })

  it('an ordinary transcript is passed through as an utterance', () => {
    const onUtterance = vi.fn()
    renderHook(() => useDriftVoice(base({ onUtterance })))
    act(() => { capturedOnUserTranscript?.('the tightness before a call') })
    expect(onUtterance).toHaveBeenCalledWith('the tightness before a call')
  })
})
