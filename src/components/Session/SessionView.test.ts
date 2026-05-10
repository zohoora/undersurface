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
  SAFETY_RULES: 'SAFETY — test stub',
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
  useTranslation: () => new Proxy({}, { get: (_, key: string) => `t:${key}` }),
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

// Mock weather store singleton
vi.mock('../../store/weatherStore', () => ({
  getWeatherEngine: () => ({
    recordEmotion: vi.fn(),
    shouldPersist: vi.fn(() => false),
    persist: vi.fn().mockResolvedValue(undefined),
  }),
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

describe('SessionView — unified mode bar (only path)', () => {
  it('imports SessionBottomBar from ./SessionBottomBar', async () => {
    const mod = await import('./SessionBottomBar')
    expect(typeof mod.SessionBottomBar).toBe('function')
  })

  it('SessionView no longer references the legacy unifiedSessionUI flag', async () => {
    // The flag was removed when unified became the only path. If this fails,
    // someone resurrected the old branching — collapse it again.
    const src = await import('./SessionView?raw')
    expect(src.default).not.toContain('unifiedSessionUI')
    expect(src.default).not.toContain('unifiedUI')
  })

  it('SessionView source renders SessionBottomBar', async () => {
    const src = await import('./SessionView?raw')
    expect(src.default).toContain('SessionBottomBar')
  })

  it('SessionView no longer renders the legacy session-mode-badge', async () => {
    // Real Talk now lives only as a switch in the mode bar; the legacy
    // standalone badge in the header is gone.
    const src = await import('./SessionView?raw')
    expect(src.default).not.toContain('session-mode-badge')
  })
})

describe('SessionView — recommendation rendering integration', () => {
  it('SessionView source passes onRecommendationTap to SessionMessageBubble', async () => {
    const src = await import('./SessionView?raw')
    expect(src.default).toContain('onRecommendationTap')
  })

  it('SessionView source contains handleRecommendationTap', async () => {
    const src = await import('./SessionView?raw')
    expect(src.default).toContain('handleRecommendationTap')
  })

  it('SessionView source handles real-talk-on target', async () => {
    const src = await import('./SessionView?raw')
    expect(src.default).toContain('real-talk-on')
  })

  it('SessionView source warns on unknown targets', async () => {
    const src = await import('./SessionView?raw')
    expect(src.default).toContain('Unknown recommendation target')
  })

  it('SessionMessageBubble delegates recommendation rendering to RecommendationSegments', async () => {
    const src = await import('./SessionMessage?raw')
    expect(src.default).toContain('RecommendationSegments')
  })

  it('SessionMessageBubble no longer takes the legacy unifiedUI prop', async () => {
    // Recommendation rendering is now unconditional for therapist messages
    // since the unified UI is the only path.
    const src = await import('./SessionMessage?raw')
    expect(src.default).not.toContain('unifiedUI')
  })

  it('handleRecommendationTap dispatches real-talk-on to handleRealTalkToggle(true)', async () => {
    const src = await import('./SessionView?raw')
    expect(src.default).toMatch(/real-talk-on[\s\S]{0,120}handleRealTalkToggle\(true\)/)
  })

  it('streaming block renders raw text — parsing happens once in SessionMessageBubble after commit', async () => {
    const src = await import('./SessionView?raw')
    expect(src.default).toContain('typewriter.displayedContent')
    expect(src.default).not.toContain('parseRecommendations(typewriter')
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
    it('returns 300 for opening phase', () => {
      expect(orchestrator.getMaxTokens('opening')).toBe(300)
    })

    it('returns 500 for deepening phase', () => {
      expect(orchestrator.getMaxTokens('deepening')).toBe(500)
    })

    it('returns 600 for closing phase', () => {
      expect(orchestrator.getMaxTokens('closing')).toBe(600)
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

describe('SessionView — surface switching (Journal & Speak)', () => {
  it('SessionView source contains handleSurfaceChange wrapper function', async () => {
    const src = await import('./SessionView?raw')
    expect(src.default).toContain('const handleSurfaceChange = useCallback')
  })

  it('handleRecommendationTap journal case dispatches to handleSurfaceChange', async () => {
    const src = await import('./SessionView?raw')
    expect(src.default).toMatch(/case\s+'journal'[\s\S]{0,80}handleSurfaceChange\('journal'\)/)
  })

  it('handleRecommendationTap speak case dispatches to handleSurfaceChange', async () => {
    const src = await import('./SessionView?raw')
    expect(src.default).toMatch(/case\s+'speak'[\s\S]{0,80}handleSurfaceChange\('speak'\)/)
  })

  it('handleSurfaceChange flushes journal text via appendUserMessage on exit', async () => {
    const src = await import('./SessionView?raw')
    expect(src.default).toContain('appendUserMessage(journalDraft.trim()')
  })

  it('handleSurfaceChange starts voice on Speak entry via handleStartVoice', async () => {
    const src = await import('./SessionView?raw')
    expect(src.default).toContain('void handleStartVoice()')
  })

  it('handleSurfaceChange stops voice on Speak exit', async () => {
    const src = await import('./SessionView?raw')
    expect(src.default).toContain('voice.stop()')
  })

  it('voice-idle effect auto-reverts surface to talk', async () => {
    const src = await import('./SessionView?raw')
    expect(src.default).toMatch(/voice\.state[\s\S]{0,60}setSurface\('talk'\)/)
  })
})
