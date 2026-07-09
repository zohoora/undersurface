import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SessionMessage } from '../types'

vi.mock('../ai/openrouter', () => ({
  chatCompletion: vi.fn().mockResolvedValue('Session note here.'),
  analyzeEmotionAndDistress: vi.fn().mockResolvedValue({ emotion: 'neutral', distressLevel: 0 }),
}))
vi.mock('../ai/therapistPrompts', () => ({
  buildTherapistSessionNotePrompt: vi.fn().mockReturnValue([
    { role: 'system', content: 'test' },
    { role: 'user', content: 'test' },
  ]),
}))
vi.mock('../store/groundingState', () => ({
  activateGrounding: vi.fn(),
  isGroundingActive: vi.fn(() => false),
}))
vi.mock('../store/globalConfig', () => ({
  getGlobalConfig: vi.fn(() => null),
}))

import { SessionOrchestrator, detectCrisisKeywords } from './sessionOrchestrator'
import { chatCompletion, analyzeEmotionAndDistress } from '../ai/openrouter'
import { buildTherapistSessionNotePrompt } from '../ai/therapistPrompts'
import { activateGrounding } from '../store/groundingState'
import { getGlobalConfig } from '../store/globalConfig'

const mockAnalyze = vi.mocked(analyzeEmotionAndDistress)
const mockActivateGrounding = vi.mocked(activateGrounding)
const mockGetGlobalConfig = vi.mocked(getGlobalConfig)

function makeMessage(overrides: Partial<SessionMessage> = {}): SessionMessage {
  return {
    id: 'msg',
    speaker: 'user',
    partId: null,
    partName: null,
    content: 'test',
    timestamp: Date.now(),
    phase: 'opening',
    isEmergence: false,
    ...overrides,
  }
}

function makeUserMessages(count: number): SessionMessage[] {
  return Array.from({ length: count }, (_, i) =>
    makeMessage({ id: `msg-${i}`, speaker: 'user', content: `message ${i}` }),
  )
}

describe('SessionOrchestrator', () => {
  let orch: SessionOrchestrator

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetGlobalConfig.mockReturnValue(null)
    orch = new SessionOrchestrator()
  })

  describe('detectPhase', () => {
    it('returns "opening" for < 3 user messages', () => {
      expect(orch.detectPhase(makeUserMessages(2))).toBe('opening')
    })

    it('returns "opening" for 0 messages', () => {
      expect(orch.detectPhase([])).toBe('opening')
    })

    it('returns "deepening" for 3-11 user messages', () => {
      expect(orch.detectPhase(makeUserMessages(3))).toBe('deepening')
      expect(orch.detectPhase(makeUserMessages(7))).toBe('deepening')
      expect(orch.detectPhase(makeUserMessages(11))).toBe('deepening')
    })

    it('returns "closing" for >= 12 user messages', () => {
      expect(orch.detectPhase(makeUserMessages(12))).toBe('closing')
      expect(orch.detectPhase(makeUserMessages(20))).toBe('closing')
    })

    it('only counts user messages, not therapist messages', () => {
      const messages: SessionMessage[] = [
        makeMessage({ id: '1', speaker: 'user' }),
        makeMessage({ id: '2', speaker: 'therapist' }),
        makeMessage({ id: '3', speaker: 'user' }),
        makeMessage({ id: '4', speaker: 'therapist' }),
      ]
      expect(orch.detectPhase(messages)).toBe('opening')
    })
  })

  describe('getMaxTokens', () => {
    // Doubled (was 150/250/300) to give reasoning models headroom — see
    // sessionOrchestrator.ts comment block above getMaxTokens.
    it('returns 300 for opening', () => {
      expect(orch.getMaxTokens('opening')).toBe(300)
    })

    it('returns 500 for deepening', () => {
      expect(orch.getMaxTokens('deepening')).toBe(500)
    })

    it('returns 600 for closing', () => {
      expect(orch.getMaxTokens('closing')).toBe(600)
    })
  })

  describe('checkEmotionAfterMessage', () => {
    it('analyzes emotion and returns result', async () => {
      mockAnalyze.mockResolvedValue({ emotion: 'sad', distressLevel: 0 })

      const result = await orch.checkEmotionAfterMessage('I feel sad today')

      expect(result).toEqual({ emotion: 'sad', distressLevel: 0 })
      expect(analyzeEmotionAndDistress).toHaveBeenCalledWith('I feel sad today')
    })

    it('does NOT activate grounding regardless of distressLevel', async () => {
      // Regression guard: L3 was previously a grounding driver via threshold.
      // L2 (classifyCrisisRisk) now owns grounding decisions; L3 is purely
      // informational. distressLevel = 3 must NOT flip grounding here.
      mockAnalyze.mockResolvedValue({ emotion: 'fearful', distressLevel: 3 })
      mockGetGlobalConfig.mockReturnValue({
        features: { emergencyGrounding: true },
        grounding: { intensityThreshold: 3 },
      } as unknown as ReturnType<typeof getGlobalConfig>)

      await orch.checkEmotionAfterMessage('intense feelings')

      expect(mockActivateGrounding).not.toHaveBeenCalled()
    })

    it('throttles: a second call within the interval returns null without a new LLM call', async () => {
      // The no-throttle behavior existed only while L3 emotion drove grounding
      // (every message had to be analyzed for safety). L3 is now purely
      // informational — L2 owns grounding — so the wasteful per-turn LLM call
      // is throttled to match the diary path. The weather UI polls every 30s
      // anyway, so no visible degradation.
      mockAnalyze.mockResolvedValue({ emotion: 'neutral', distressLevel: 0 })

      const first = await orch.checkEmotionAfterMessage('first message')
      expect(first).not.toBeNull()

      const second = await orch.checkEmotionAfterMessage('second message')
      expect(second).toBeNull()
      expect(mockAnalyze).toHaveBeenCalledTimes(1)
    })
  })

  describe('checkCrisisKeywords', () => {
    it('defers contextual "I want to die" language to L2', () => {
      expect(orch.checkCrisisKeywords('I want to die')).toBe(false)
      expect(mockActivateGrounding).not.toHaveBeenCalled()
    })

    it('detects "kill myself"', () => {
      expect(orch.checkCrisisKeywords('I want to kill myself')).toBe(true)
    })

    it('detects "end my life"', () => {
      expect(orch.checkCrisisKeywords('I should end my life')).toBe(true)
    })

    it('defers "I should die" to L2', () => {
      expect(orch.checkCrisisKeywords('I should die?')).toBe(false)
    })

    it('defers "don\'t want to be alive" to L2', () => {
      expect(orch.checkCrisisKeywords("I don't want to be alive anymore")).toBe(false)
    })

    it('does not flag normal text', () => {
      mockActivateGrounding.mockClear()
      expect(orch.checkCrisisKeywords('I am tired today')).toBe(false)
      expect(mockActivateGrounding).not.toHaveBeenCalled()
    })

    it('does not flag normal rest', () => {
      expect(orch.checkCrisisKeywords('I need to rest')).toBe(false)
    })

    // Precision calibration: L1 is the high-precision EXPLICIT floor. Ambiguous
    // euphemisms that over-call on grief/hyperbole are deferred to the
    // context-aware L2 classifier (which now runs in session mode too). History
    // of over-calling grief/metaphor/hyperbole — see project memory.
    it('does NOT flag religious grief idiom (deferred to L2)', () => {
      mockActivateGrounding.mockClear()
      expect(orch.checkCrisisKeywords('She passed last year. She is with Jesus now, at peace.')).toBe(false)
      expect(orch.checkCrisisKeywords('May she rest forever in the garden she loved.')).toBe(false)
      expect(mockActivateGrounding).not.toHaveBeenCalled()
    })

    it('does NOT flag mundane "can\'t do this anymore" hyperbole (deferred to L2)', () => {
      mockActivateGrounding.mockClear()
      expect(orch.checkCrisisKeywords("I can't do this job anymore, I need to quit.")).toBe(false)
      expect(orch.checkCrisisKeywords("Ugh, I can't do this diet anymore.")).toBe(false)
      expect(mockActivateGrounding).not.toHaveBeenCalled()
    })

    it('still fires on an explicit method embedded in longer text', () => {
      expect(orch.checkCrisisKeywords("I keep thinking I want to kill myself and I don't know what to do")).toBe(true)
    })

    it('has no cooldown — always runs', () => {
      mockActivateGrounding.mockClear()
      orch.checkCrisisKeywords('I want to kill myself')
      orch.checkCrisisKeywords('I want to kill myself')
      expect(mockActivateGrounding).toHaveBeenCalledTimes(2)
    })
  })

  describe('detectCrisisKeywords', () => {
    it('is a pure function that does not activate grounding', () => {
      mockActivateGrounding.mockClear()
      expect(detectCrisisKeywords('I want to kill myself')).toBe(true)
      expect(mockActivateGrounding).not.toHaveBeenCalled()
    })

    // Slang and abbreviations require surrounding context.
    it('defers "kms" abbreviation to L2', () => {
      expect(detectCrisisKeywords('i just wanna kms')).toBe(false)
    })

    it('defers "kys" abbreviation to L2', () => {
      expect(detectCrisisKeywords('sometimes I think kys')).toBe(false)
    })

    it('defers "ctb" abbreviation to L2', () => {
      expect(detectCrisisKeywords('thinking about ctb tonight')).toBe(false)
    })

    // New expanded patterns
    it('defers "wanna die" to L2', () => {
      expect(detectCrisisKeywords('I wanna die')).toBe(false)
    })

    it('defers "ready to die" to L2', () => {
      expect(detectCrisisKeywords('I feel ready to die')).toBe(false)
    })

    it('defers non-specific "hurt myself" to L2', () => {
      expect(detectCrisisKeywords('I want to hurt myself')).toBe(false)
    })

    it('defers "self-harm" to L2', () => {
      expect(detectCrisisKeywords('thoughts of self-harm')).toBe(false)
    })

    it('defers "self harm" without hyphen to L2', () => {
      expect(detectCrisisKeywords('thinking about self harm')).toBe(false)
    })

    it('defers "overdose" without first-person method detail to L2', () => {
      expect(detectCrisisKeywords('thinking about overdose')).toBe(false)
    })

    it('detects "slit wrists"', () => {
      expect(detectCrisisKeywords('I could slit my wrists')).toBe(true)
    })

    it('defers "no point in living" to L2', () => {
      expect(detectCrisisKeywords('there is no point in living')).toBe(false)
    })

    it('defers "can\'t do this anymore" to L2', () => {
      expect(detectCrisisKeywords("I can't do this anymore")).toBe(false)
    })

    it('defers "don\'t want to wake up" to L2', () => {
      expect(detectCrisisKeywords("I don't want to wake up")).toBe(false)
    })

    it('detects "drown myself"', () => {
      expect(detectCrisisKeywords('I could drown myself')).toBe(true)
    })

    // Unicode bypass resistance
    it('detects crisis through non-breaking spaces', () => {
      // Using \u00A0 (non-breaking space) instead of regular space
      expect(detectCrisisKeywords('want\u00A0to\u00A0kill\u00A0myself')).toBe(true)
    })

    it('detects crisis through zero-width characters', () => {
      // Inserting zero-width spaces (\u200B) into "kill myself"
      expect(detectCrisisKeywords('kill\u200Bmyself')).toBe(true)
    })

    it('detects crisis with fullwidth characters (NFKC normalization)', () => {
      // Fullwidth "kill myself" — NFKC normalizes to ASCII
      expect(detectCrisisKeywords('Ｉ ｗａｎｔ ｔｏ ｋｉｌｌ ｍｙｓｅｌｆ')).toBe(true)
    })

    // False positive guards
    it('does not flag "I am okay"', () => {
      expect(detectCrisisKeywords('I am okay, just tired')).toBe(false)
    })

    it('does not flag "I overdosed on sugar" (word boundary)', () => {
      // "overdosed" doesn't match \boverdose\b (extra 'd' breaks boundary)
      expect(detectCrisisKeywords('I overdosed on sugar')).toBe(false)
    })

    it('does not flag "I can\'t do this math problem anymore"', () => {
      // extra words between "this" and "anymore" break the pattern
      expect(detectCrisisKeywords("I can't do this math problem anymore")).toBe(false)
    })
  })

  describe('generateSessionNote', () => {
    it('calls buildTherapistSessionNotePrompt and chatCompletion', async () => {
      const messages = makeUserMessages(3)

      const note = await orch.generateSessionNote(messages)

      expect(buildTherapistSessionNotePrompt).toHaveBeenCalledWith(messages)
      expect(chatCompletion).toHaveBeenCalledWith(
        expect.any(Array),
        30000,
        400,
        'low',
      )
      expect(note).toBe('Session note here.')
    })
  })
})
