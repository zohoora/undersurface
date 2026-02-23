import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Part, SessionMessage, SessionPhase } from '../types'

// Mock all external dependencies
vi.mock('../ai/openrouter', () => ({
  chatCompletion: vi.fn().mockResolvedValue('Session note here.'),
}))
vi.mock('../ai/sessionPrompts', () => ({
  buildSessionNotePrompt: vi.fn().mockReturnValue([
    { role: 'system', content: 'test' },
    { role: 'user', content: 'test' },
  ]),
}))
vi.mock('../hooks/useGroundingMode', () => ({
  isGroundingActive: vi.fn(() => false),
}))

import { SessionOrchestrator } from './sessionOrchestrator'
import { isGroundingActive } from '../hooks/useGroundingMode'
import { chatCompletion } from '../ai/openrouter'
import { buildSessionNotePrompt } from '../ai/sessionPrompts'

const mockIsGroundingActive = vi.mocked(isGroundingActive)

function makePart(overrides: Partial<Part> = {}): Part {
  return {
    id: 'watcher',
    name: 'The Watcher',
    color: '#5A7F94',
    colorLight: '#5A7F9425',
    ifsRole: 'protector',
    voiceDescription: 'Quiet.',
    concern: 'Avoidance.',
    systemPrompt: 'test',
    isSeeded: true,
    createdAt: Date.now(),
    memories: [],
    ...overrides,
  }
}

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
    mockIsGroundingActive.mockReturnValue(false)
    orch = new SessionOrchestrator()
  })

  // --- detectPhase ---

  describe('detectPhase', () => {
    it('returns "opening" for < 3 user messages', () => {
      const messages = makeUserMessages(2)
      expect(orch.detectPhase(messages)).toBe('opening')
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

    it('only counts user messages, not part messages', () => {
      const messages: SessionMessage[] = [
        makeMessage({ id: '1', speaker: 'user' }),
        makeMessage({ id: '2', speaker: 'part', partId: 'host', partName: 'Host' }),
        makeMessage({ id: '3', speaker: 'user' }),
        makeMessage({ id: '4', speaker: 'part', partId: 'host', partName: 'Host' }),
      ]
      // Only 2 user messages → opening
      expect(orch.detectPhase(messages)).toBe('opening')
    })
  })

  // --- getMaxTokens ---

  describe('getMaxTokens', () => {
    it('returns 100 for opening', () => {
      expect(orch.getMaxTokens('opening')).toBe(100)
    })

    it('returns 200 for deepening', () => {
      expect(orch.getMaxTokens('deepening')).toBe(200)
    })

    it('returns 250 for closing', () => {
      expect(orch.getMaxTokens('closing')).toBe(250)
    })
  })

  // --- selectSpeaker ---

  describe('selectSpeaker', () => {
    const host = makePart({ id: 'host', name: 'Host', ifsRole: 'self' })
    const exile = makePart({ id: 'exile-1', name: 'Exile', ifsRole: 'exile' })
    const firefighter = makePart({ id: 'ff-1', name: 'Firefighter', ifsRole: 'firefighter' })
    const parts = [host, exile, firefighter]

    it('returns host in opening phase (< 3 user messages)', () => {
      const messages = makeUserMessages(1)
      const speaker = orch.selectSpeaker(parts, messages, 'host', 'i feel hurt and alone')
      expect(speaker.id).toBe('host')
    })

    it('returns host when grounding is active', () => {
      mockIsGroundingActive.mockReturnValue(true)
      const messages = makeUserMessages(5)
      const speaker = orch.selectSpeaker(parts, messages, 'host', 'i feel hurt and alone')
      expect(speaker.id).toBe('host')
    })

    it('returns host when emergence cooldown not met', () => {
      // 5 user messages to get past opening, but only 1 since last emergence
      const messages: SessionMessage[] = [
        ...makeUserMessages(4),
        makeMessage({ id: 'emerge', speaker: 'part', partId: 'exile-1', partName: 'Exile', isEmergence: true }),
        makeMessage({ id: 'after-1', speaker: 'user', content: 'i feel hurt' }),
      ]
      const speaker = orch.selectSpeaker(parts, messages, 'host', 'i feel hurt')
      expect(speaker.id).toBe('host')
    })

    it('does not allow new parts when max parts reached', () => {
      // Add a 4th part that has NOT spoken yet
      const manager = makePart({ id: 'mgr-1', name: 'Manager', ifsRole: 'manager' })
      const allParts = [...parts, manager]

      // 3 unique part speakers already (host, exile, firefighter)
      const messages: SessionMessage[] = [
        ...makeUserMessages(5),
        makeMessage({ id: 'p1', speaker: 'part', partId: 'host', partName: 'Host' }),
        makeMessage({ id: 'p2', speaker: 'part', partId: 'exile-1', partName: 'Exile' }),
        makeMessage({ id: 'p3', speaker: 'part', partId: 'ff-1', partName: 'Firefighter' }),
        // Enough user messages after to pass cooldown
        ...Array.from({ length: 4 }, (_, i) =>
          makeMessage({ id: `late-${i}`, speaker: 'user', content: 'again the same pattern repeats every time' }),
        ),
      ]
      // Manager keywords: again, always, every time, pattern, same, repeat
      // Even with strongly matching content, manager should never be selected (max parts reached)
      for (let i = 0; i < 20; i++) {
        const s = orch.selectSpeaker(allParts, messages, 'host', 'again the same pattern repeats every time always')
        expect(s.id).not.toBe('mgr-1')
      }
    })

    it('can select a non-host part when content strongly matches (emergence)', () => {
      // Enough user messages past opening, no emergence yet
      const messages = makeUserMessages(5)
      // Exile keywords: hurt, miss, wish, love, feel, heart, pain, alone, cry
      const text = 'i hurt so much, i miss them, i feel pain and cry alone'

      // Run multiple times — exile should win often with strongly matching text
      let exileWins = 0
      for (let i = 0; i < 30; i++) {
        const speaker = orch.selectSpeaker(parts, messages, 'host', text)
        if (speaker.id === 'exile-1') exileWins++
      }
      // Exile should emerge at least sometimes with such strongly matching text
      expect(exileWins).toBeGreaterThan(5)
    })
  })

  // --- userMessagesSinceLastEmergence (via selectSpeaker behavior) ---

  describe('emergence cooldown behavior', () => {
    const host = makePart({ id: 'host', ifsRole: 'self' })
    const exile = makePart({ id: 'exile-1', ifsRole: 'exile' })

    it('allows emergence after enough user messages since last emergence', () => {
      const messages: SessionMessage[] = [
        ...makeUserMessages(3),
        makeMessage({ id: 'emerge', speaker: 'part', partId: 'host', partName: 'Host', isEmergence: true }),
        // 3 user messages after emergence — meets cooldown
        makeMessage({ id: 'u1', speaker: 'user', content: 'i hurt' }),
        makeMessage({ id: 'u2', speaker: 'user', content: 'i cry alone' }),
        makeMessage({ id: 'u3', speaker: 'user', content: 'i feel pain and miss them' }),
      ]
      const text = 'i hurt so much and feel pain and cry alone and miss them'

      // With exile keywords, exile should be able to emerge now
      let nonHostSelected = 0
      for (let i = 0; i < 30; i++) {
        const speaker = orch.selectSpeaker([host, exile], messages, 'host', text)
        if (speaker.id !== 'host') nonHostSelected++
      }
      // Should sometimes select exile (emergence is possible now)
      expect(nonHostSelected).toBeGreaterThan(0)
    })
  })

  // --- generateSessionNote ---

  describe('generateSessionNote', () => {
    it('calls buildSessionNotePrompt and chatCompletion', async () => {
      const messages = makeUserMessages(3)
      const partNames = ['The Watcher', 'The Exile']

      const note = await orch.generateSessionNote(messages, partNames)

      expect(buildSessionNotePrompt).toHaveBeenCalledWith(messages, partNames)
      expect(chatCompletion).toHaveBeenCalledWith(
        expect.any(Array),
        15000,
        300,
      )
      expect(note).toBe('Session note here.')
    })
  })
})
