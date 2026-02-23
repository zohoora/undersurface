import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock store/db — must come before any imports that use it
vi.mock('../../store/db', () => ({
  db: {
    parts: {
      toArray: vi.fn().mockResolvedValue([
        {
          id: 'watcher', name: 'The Watcher', color: '#5A7F94', colorLight: '#5A7F9425',
          ifsRole: 'protector', voiceDescription: 'Quiet.', concern: 'Avoidance.',
          systemPrompt: 'test', isSeeded: true, createdAt: 1, memories: [],
        },
      ]),
    },
    memories: {
      where: vi.fn().mockReturnValue({
        equals: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue([]),
        }),
      }),
      add: vi.fn(),
    },
    sessions: { add: vi.fn(), update: vi.fn(), get: vi.fn() },
    userProfile: { toArray: vi.fn().mockResolvedValue([]) },
  },
  sessionMessages: {
    add: vi.fn(),
    getAll: vi.fn().mockResolvedValue([]),
    subscribe: vi.fn().mockReturnValue(() => {}),
  },
  generateId: () => `id-${Date.now()}`,
}))

// Mock openrouter
vi.mock('../../ai/openrouter', () => ({
  streamChatCompletion: vi.fn(
    (_msgs: unknown, callbacks: { onToken: (t: string) => void; onComplete: (t: string) => void }) => {
      callbacks.onToken('Hello ')
      callbacks.onToken('writer.')
      callbacks.onComplete('Hello writer.')
      return Promise.resolve()
    },
  ),
  chatCompletion: vi.fn().mockResolvedValue('Session note.'),
}))

// Mock sessionPrompts
vi.mock('../../ai/sessionPrompts', () => ({
  buildSessionMessages: vi.fn().mockReturnValue([
    { role: 'system', content: 'test' },
    { role: 'user', content: 'test' },
  ]),
  buildSessionNotePrompt: vi.fn().mockReturnValue([
    { role: 'system', content: 'test' },
    { role: 'user', content: 'test' },
  ]),
}))

// Mock analytics
vi.mock('../../services/analytics', () => ({ trackEvent: vi.fn() }))

// Mock grounding mode
vi.mock('../../hooks/useGroundingMode', () => ({ isGroundingActive: () => false }))

// Mock i18n (getPartDisplayName is imported by SessionView)
vi.mock('../../i18n', () => ({
  getPartDisplayName: (part: { name: string }) => part.name,
}))

// Mock settings store (used by i18n module)
vi.mock('../../store/settings', () => ({
  getSettings: () => ({ language: 'en' }),
  useSettings: () => ({ language: 'en' }),
}))

// Mock global config (used by settings)
vi.mock('../../store/globalConfig', () => ({
  getGlobalConfig: () => null,
  useGlobalConfig: () => null,
}))

// Now import — after all mocks are registered
import { SessionView } from './SessionView'
import { SessionOrchestrator } from '../../engine/sessionOrchestrator'
import type { Part, SessionMessage } from '../../types'

describe('SessionView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('exports a function component', () => {
    expect(typeof SessionView).toBe('function')
  })

  it('has the correct function name', () => {
    expect(SessionView.name).toBe('SessionView')
  })

  it('also has a default export', async () => {
    const mod = await import('./SessionView')
    expect(mod.default).toBe(SessionView)
  })
})

describe('SessionOrchestrator (integration with SessionView)', () => {
  const orchestrator = new SessionOrchestrator()

  const makePart = (overrides: Partial<Part> = {}): Part => ({
    id: 'test-part',
    name: 'Test Part',
    color: '#000000',
    colorLight: '#00000025',
    ifsRole: 'protector',
    voiceDescription: 'Test.',
    concern: 'Test concern.',
    systemPrompt: 'test prompt',
    isSeeded: true,
    createdAt: Date.now(),
    memories: [],
    ...overrides,
  } as Part)

  const makeMessage = (overrides: Partial<SessionMessage> = {}): SessionMessage => ({
    id: `msg-${Date.now()}-${Math.random()}`,
    speaker: 'user',
    partId: null,
    partName: null,
    content: 'test message',
    timestamp: Date.now(),
    phase: 'opening',
    isEmergence: false,
    ...overrides,
  })

  describe('detectPhase', () => {
    it('returns opening when fewer than 3 user messages', () => {
      const messages = [
        makeMessage({ speaker: 'part', partId: 'host' }),
        makeMessage({ speaker: 'user' }),
      ]
      expect(orchestrator.detectPhase(messages)).toBe('opening')
    })

    it('returns deepening between 3 and 11 user messages', () => {
      const messages: SessionMessage[] = []
      for (let i = 0; i < 5; i++) {
        messages.push(makeMessage({ speaker: 'user' }))
        messages.push(makeMessage({ speaker: 'part', partId: 'host' }))
      }
      expect(orchestrator.detectPhase(messages)).toBe('deepening')
    })

    it('returns closing at 12+ user messages', () => {
      const messages: SessionMessage[] = []
      for (let i = 0; i < 13; i++) {
        messages.push(makeMessage({ speaker: 'user' }))
        messages.push(makeMessage({ speaker: 'part', partId: 'host' }))
      }
      expect(orchestrator.detectPhase(messages)).toBe('closing')
    })
  })

  describe('getMaxTokens', () => {
    it('returns 100 for opening phase', () => {
      expect(orchestrator.getMaxTokens('opening')).toBe(100)
    })

    it('returns 200 for deepening phase', () => {
      expect(orchestrator.getMaxTokens('deepening')).toBe(200)
    })

    it('returns 250 for closing phase', () => {
      expect(orchestrator.getMaxTokens('closing')).toBe(250)
    })
  })

  describe('selectSpeaker', () => {
    it('returns host during opening phase', () => {
      const host = makePart({ id: 'host', ifsRole: 'self' })
      const other = makePart({ id: 'other', ifsRole: 'exile' })
      const messages = [
        makeMessage({ speaker: 'part', partId: 'host' }),
        makeMessage({ speaker: 'user', content: 'I feel so much pain and hurt' }),
      ]

      const speaker = orchestrator.selectSpeaker([host, other], messages, 'host', 'I feel pain')
      expect(speaker.id).toBe('host')
    })

    it('returns host when no parts available for emergence within cooldown', () => {
      const host = makePart({ id: 'host', ifsRole: 'self' })
      const other = makePart({ id: 'other', ifsRole: 'exile' })

      // Build up past opening phase (3+ user messages) but within emergence cooldown
      const messages: SessionMessage[] = []
      for (let i = 0; i < 4; i++) {
        messages.push(makeMessage({ speaker: 'user', content: 'hello' }))
        messages.push(makeMessage({ speaker: 'part', partId: 'host', partName: 'Host' }))
      }
      // Add an emergence recently (within cooldown of 3 user messages)
      messages.push(makeMessage({ speaker: 'part', partId: 'other', isEmergence: true }))
      messages.push(makeMessage({ speaker: 'user', content: 'I feel hurt' }))

      const speaker = orchestrator.selectSpeaker([host, other], messages, 'host', 'I feel hurt')
      expect(speaker.id).toBe('host')
    })
  })

  describe('generateSessionNote', () => {
    it('calls chatCompletion and returns a note', async () => {
      const messages = [
        makeMessage({ speaker: 'user', content: 'I wrote something today' }),
        makeMessage({ speaker: 'part', partId: 'host', partName: 'The Watcher', content: 'Tell me more' }),
      ]

      const note = await orchestrator.generateSessionNote(messages, ['The Watcher'])
      expect(note).toBe('Session note.')
    })
  })
})
