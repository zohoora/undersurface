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
vi.mock('../hooks/useGroundingMode', () => ({
  activateGrounding: vi.fn(),
  isGroundingActive: vi.fn(() => false),
}))
vi.mock('../store/globalConfig', () => ({
  getGlobalConfig: vi.fn(() => null),
}))

import { SessionOrchestrator, detectCrisisKeywords } from './sessionOrchestrator'
import { chatCompletion, analyzeEmotionAndDistress } from '../ai/openrouter'
import { buildTherapistSessionNotePrompt } from '../ai/therapistPrompts'
import { activateGrounding } from '../hooks/useGroundingMode'
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
    it('returns 150 for opening', () => {
      expect(orch.getMaxTokens('opening')).toBe(150)
    })

    it('returns 250 for deepening', () => {
      expect(orch.getMaxTokens('deepening')).toBe(250)
    })

    it('returns 300 for closing', () => {
      expect(orch.getMaxTokens('closing')).toBe(300)
    })
  })

  describe('checkEmotionAfterMessage', () => {
    it('analyzes emotion and returns result', async () => {
      mockAnalyze.mockResolvedValue({ emotion: 'sad', distressLevel: 0 })

      const result = await orch.checkEmotionAfterMessage('I feel sad today')

      expect(result).toEqual({ emotion: 'sad', distressLevel: 0 })
      expect(analyzeEmotionAndDistress).toHaveBeenCalledWith('I feel sad today')
    })

    it('activates grounding when distress >= threshold and feature enabled', async () => {
      mockAnalyze.mockResolvedValue({ emotion: 'fearful', distressLevel: 3 })
      mockGetGlobalConfig.mockReturnValue({ features: { emergencyGrounding: true }, grounding: { intensityThreshold: 3 } } as unknown as ReturnType<typeof getGlobalConfig>)

      await orch.checkEmotionAfterMessage('I want to hurt myself')

      expect(mockActivateGrounding).toHaveBeenCalledWith('auto')
    })

    it('does not activate grounding when distress < threshold', async () => {
      mockAnalyze.mockResolvedValue({ emotion: 'sad', distressLevel: 1 })
      mockGetGlobalConfig.mockReturnValue({ features: { emergencyGrounding: true }, grounding: { intensityThreshold: 3 } } as unknown as ReturnType<typeof getGlobalConfig>)

      await orch.checkEmotionAfterMessage('I feel down')

      expect(mockActivateGrounding).not.toHaveBeenCalled()
    })

    it('does not activate grounding when feature is disabled', async () => {
      mockAnalyze.mockResolvedValue({ emotion: 'fearful', distressLevel: 5 })
      mockGetGlobalConfig.mockReturnValue({ grounding: { intensityThreshold: 2 } } as unknown as ReturnType<typeof getGlobalConfig>)

      await orch.checkEmotionAfterMessage('I want to hurt myself')

      expect(mockActivateGrounding).not.toHaveBeenCalled()
    })

    it('respects cooldown — returns null on rapid successive calls', async () => {
      mockAnalyze.mockResolvedValue({ emotion: 'neutral', distressLevel: 0 })

      const first = await orch.checkEmotionAfterMessage('first message')
      expect(first).not.toBeNull()

      const second = await orch.checkEmotionAfterMessage('second message')
      expect(second).toBeNull()
    })
  })

  describe('checkCrisisKeywords', () => {
    it('detects "I want to die"', () => {
      expect(orch.checkCrisisKeywords('I want to die')).toBe(true)
      expect(mockActivateGrounding).toHaveBeenCalledWith('auto')
    })

    it('detects "kill myself"', () => {
      expect(orch.checkCrisisKeywords('I want to kill myself')).toBe(true)
    })

    it('detects "rest forever" and "be with Jesus"', () => {
      expect(orch.checkCrisisKeywords('My body wants to rest forever. To be with Jesus.')).toBe(true)
    })

    it('detects "end my life"', () => {
      expect(orch.checkCrisisKeywords('I should end my life')).toBe(true)
    })

    it('detects "I should die"', () => {
      expect(orch.checkCrisisKeywords('I should die?')).toBe(true)
    })

    it('detects "don\'t want to be alive"', () => {
      expect(orch.checkCrisisKeywords("I don't want to be alive anymore")).toBe(true)
    })

    it('does not flag normal text', () => {
      mockActivateGrounding.mockClear()
      expect(orch.checkCrisisKeywords('I am tired today')).toBe(false)
      expect(mockActivateGrounding).not.toHaveBeenCalled()
    })

    it('does not flag normal rest', () => {
      expect(orch.checkCrisisKeywords('I need to rest')).toBe(false)
    })

    it('has no cooldown — always runs', () => {
      mockActivateGrounding.mockClear()
      orch.checkCrisisKeywords('I want to die')
      orch.checkCrisisKeywords('I want to die')
      expect(mockActivateGrounding).toHaveBeenCalledTimes(2)
    })
  })

  describe('detectCrisisKeywords', () => {
    it('is a pure function that does not activate grounding', () => {
      mockActivateGrounding.mockClear()
      expect(detectCrisisKeywords('I want to die')).toBe(true)
      expect(mockActivateGrounding).not.toHaveBeenCalled()
    })

    // New abbreviation patterns
    it('detects "kms" abbreviation', () => {
      expect(detectCrisisKeywords('i just wanna kms')).toBe(true)
    })

    it('detects "kys" abbreviation', () => {
      expect(detectCrisisKeywords('sometimes I think kys')).toBe(true)
    })

    it('detects "ctb" abbreviation', () => {
      expect(detectCrisisKeywords('thinking about ctb tonight')).toBe(true)
    })

    // New expanded patterns
    it('detects "wanna die"', () => {
      expect(detectCrisisKeywords('I wanna die')).toBe(true)
    })

    it('detects "ready to die"', () => {
      expect(detectCrisisKeywords('I feel ready to die')).toBe(true)
    })

    it('detects "hurt myself"', () => {
      expect(detectCrisisKeywords('I want to hurt myself')).toBe(true)
    })

    it('detects "self-harm"', () => {
      expect(detectCrisisKeywords('thoughts of self-harm')).toBe(true)
    })

    it('detects "self harm" without hyphen', () => {
      expect(detectCrisisKeywords('thinking about self harm')).toBe(true)
    })

    it('detects "overdose"', () => {
      expect(detectCrisisKeywords('thinking about overdose')).toBe(true)
    })

    it('detects "slit wrists"', () => {
      expect(detectCrisisKeywords('I could slit my wrists')).toBe(true)
    })

    it('detects "no point in living"', () => {
      expect(detectCrisisKeywords('there is no point in living')).toBe(true)
    })

    it('detects "can\'t do this anymore"', () => {
      expect(detectCrisisKeywords("I can't do this anymore")).toBe(true)
    })

    it('detects "don\'t want to wake up"', () => {
      expect(detectCrisisKeywords("I don't want to wake up")).toBe(true)
    })

    it('detects "drown myself"', () => {
      expect(detectCrisisKeywords('I could drown myself')).toBe(true)
    })

    // Unicode bypass resistance
    it('detects crisis through non-breaking spaces', () => {
      // Using \u00A0 (non-breaking space) instead of regular space
      expect(detectCrisisKeywords('want\u00A0to\u00A0die')).toBe(true)
    })

    it('detects crisis through zero-width characters', () => {
      // Inserting zero-width spaces (\u200B) into "kill myself"
      expect(detectCrisisKeywords('kill\u200Bmyself')).toBe(true)
    })

    it('detects crisis with fullwidth characters (NFKC normalization)', () => {
      // Fullwidth "suicide" — NFKC normalizes to ASCII
      expect(detectCrisisKeywords('\uFF53\uFF55\uFF49\uFF43\uFF49\uFF44\uFF45')).toBe(true)
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
        15000,
        300,
      )
      expect(note).toBe('Session note here.')
    })
  })
})
