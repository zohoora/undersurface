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
    sessions: { add: vi.fn(), update: vi.fn(), get: vi.fn(), orderBy: vi.fn().mockReturnValue({ reverse: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }) }) },
    userProfile: { toArray: vi.fn().mockResolvedValue([]), get: vi.fn().mockResolvedValue(undefined) },
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
  analyzeEmotionAndDistress: vi.fn().mockResolvedValue({ emotion: 'neutral', distressLevel: 0 }),
}))

// Mock therapistPrompts
vi.mock('../../ai/therapistPrompts', () => ({
  buildTherapistMessages: vi.fn().mockReturnValue([
    { role: 'system', content: 'test' },
    { role: 'user', content: 'test' },
  ]),
  buildTherapistSessionNotePrompt: vi.fn().mockReturnValue([
    { role: 'system', content: 'test' },
    { role: 'user', content: 'test' },
  ]),
}))

// Mock analytics
vi.mock('../../services/analytics', () => ({ trackEvent: vi.fn() }))

// Mock grounding mode
vi.mock('../../hooks/useGroundingMode', () => ({
  isGroundingActive: () => false,
  activateGrounding: vi.fn(),
}))

// Mock i18n
vi.mock('../../i18n', () => ({
  getPartDisplayName: (part: { name: string }) => part.name,
  getLanguageCode: () => 'en',
}))

// Mock settings store
vi.mock('../../store/settings', () => ({
  getSettings: () => ({ language: 'en' }),
  useSettings: () => ({ language: 'en' }),
}))

// Mock global config
vi.mock('../../store/globalConfig', () => ({
  getGlobalConfig: () => null,
  useGlobalConfig: () => null,
}))

// Mock session context loader
vi.mock('../../engine/sessionContextLoader', () => ({
  loadTherapistContext: vi.fn().mockResolvedValue({
    recentSessionNotes: [],
    relevantMemories: [],
    userProfile: null,
  }),
}))

// Mock session reflection engine
vi.mock('../../engine/sessionReflectionEngine', () => ({
  reflectOnSession: vi.fn().mockResolvedValue(undefined),
}))

// Mock weather engine
vi.mock('../../engine/weatherEngine', () => ({
  WeatherEngine: class {
    recordEmotion = vi.fn()
    shouldPersist = vi.fn(() => false)
    persist = vi.fn().mockResolvedValue(undefined)
  },
}))

// Now import — after all mocks are registered
import { SessionView } from './SessionView'
import { SessionOrchestrator } from '../../engine/sessionOrchestrator'
import type { SessionMessage } from '../../types'

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
        makeMessage({ speaker: 'therapist' }),
        makeMessage({ speaker: 'user' }),
      ]
      expect(orchestrator.detectPhase(messages)).toBe('opening')
    })

    it('returns deepening between 3 and 11 user messages', () => {
      const messages: SessionMessage[] = []
      for (let i = 0; i < 5; i++) {
        messages.push(makeMessage({ speaker: 'user' }))
        messages.push(makeMessage({ speaker: 'therapist' }))
      }
      expect(orchestrator.detectPhase(messages)).toBe('deepening')
    })

    it('returns closing at 12+ user messages', () => {
      const messages: SessionMessage[] = []
      for (let i = 0; i < 13; i++) {
        messages.push(makeMessage({ speaker: 'user' }))
        messages.push(makeMessage({ speaker: 'therapist' }))
      }
      expect(orchestrator.detectPhase(messages)).toBe('closing')
    })
  })

  describe('getMaxTokens', () => {
    it('returns 150 for opening phase', () => {
      expect(orchestrator.getMaxTokens('opening')).toBe(150)
    })

    it('returns 250 for deepening phase', () => {
      expect(orchestrator.getMaxTokens('deepening')).toBe(250)
    })

    it('returns 300 for closing phase', () => {
      expect(orchestrator.getMaxTokens('closing')).toBe(300)
    })
  })

  describe('generateSessionNote', () => {
    it('calls chatCompletion and returns a note', async () => {
      const messages = [
        makeMessage({ speaker: 'user', content: 'I wrote something today' }),
        makeMessage({ speaker: 'therapist', content: 'Tell me more' }),
      ]

      const note = await orchestrator.generateSessionNote(messages)
      expect(note).toBe('Session note.')
    })
  })
})
