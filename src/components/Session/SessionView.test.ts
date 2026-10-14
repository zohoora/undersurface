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

  it('keeps ambient science invisible in the conversation flow', async () => {
    const src = await import('./SessionView?raw')
    expect(src.default).not.toContain('ResearchMomentNotice')
    expect(src.default).not.toContain('OutcomePulse')
    expect(src.default).not.toContain('ReceptivityHandshake')
    expect(src.default).not.toContain('ClosingCheckIn')
  })

  it('SessionView no longer renders the legacy session-mode-badge', async () => {
    // Real Talk now lives only as a switch in the mode bar; the legacy
    // standalone badge in the header is gone.
    const src = await import('./SessionView?raw')
    expect(src.default).not.toContain('session-mode-badge')
  })

  it('rebuilds the automatic opener when Fresh eyes changes before the first user turn', async () => {
    const src = await import('./SessionView?raw')
    expect(src.default).toContain('sessionMessagesDb.delete(currentSession.id, message.id)')
    expect(src.default).toContain('generateTherapistMessage([], sessionRef.current)')
    expect(src.default).toContain("messages.some(message => message.speaker === 'user')")
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
    it('returns 1600 for opening phase', () => {
      expect(orchestrator.getMaxTokens('opening')).toBe(1600)
    })

    it('returns 2000 for deepening phase', () => {
      expect(orchestrator.getMaxTokens('deepening')).toBe(2000)
    })

    it('returns 2400 for closing phase', () => {
      expect(orchestrator.getMaxTokens('closing')).toBe(2400)
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

  it('handleSurfaceChange contributes the journal draft on exit (exactly once, owner-bound)', async () => {
    const src = await import('./SessionView?raw')
    expect(src.default).toMatch(/surface === 'journal' && next !== 'journal'\) void commitJournalDraft\(\)/)
  })

  it('handleSurfaceChange starts voice on Speak entry via useSessionVoice', async () => {
    const src = await import('./SessionView?raw')
    expect(src.default).toContain('void voiceHandleStart()')
  })

  it('handleSurfaceChange stops voice on Speak exit', async () => {
    const src = await import('./SessionView?raw')
    expect(src.default).toContain('voiceStop()')
  })

  it('voice-idle effect auto-reverts surface to talk', async () => {
    const src = await import('./SessionView?raw')
    expect(src.default).toMatch(/voice\.state[\s\S]{0,60}setSurface\('talk'\)/)
  })
})

describe('SessionView — 2026-10-14 audit regressions (source contracts)', () => {
  it('delegates turn planning to turnResponder, which reads grounding at call time (#1)', async () => {
    const src = (await import('./SessionView?raw')).default
    expect(src).toContain("from '../../engine/turnResponder'")
    // The render-time grounding value must not gate conductor/research planning.
    expect(src).not.toMatch(/planAdaptiveConductor\(/)
    expect(src).not.toMatch(/planResearchTurn\(/)
  })

  it('gates Speak/Room in BOTH the surface switch and the recommendation tap (#12)', async () => {
    const src = (await import('./SessionView?raw')).default
    expect(src).toMatch(/const handleSurfaceChange = useCallback\(\(next: SessionSurface\) => \{[\s\S]{0,400}canOpenSurface\(next,/)
    expect(src).toMatch(/const handleRecommendationTap = useCallback\(\(target: string\) => \{[\s\S]{0,400}canOpenSurface\(target,/)
  })

  it('renders VoiceField for any live voice state, independent of the flag (#12)', async () => {
    const src = (await import('./SessionView?raw')).default
    expect(src).toContain("{voice.state !== 'idle' && (")
    expect(src).not.toContain("voiceEnabled && voice.state !== 'idle'")
  })

  it('loads Room and Voice with lazyWithRetry inside local error boundaries (#14)', async () => {
    const src = (await import('./SessionView?raw')).default
    expect(src).toMatch(/const VoiceField = lazyWithRetry\(/)
    expect(src).toMatch(/const RoomField = lazyWithRetry\(/)
    expect(src).not.toMatch(/= lazy\(/)
    expect(src).toContain('<SurfaceErrorBoundary surface="voice"')
    expect(src).toContain('<SurfaceErrorBoundary surface="room"')
  })

  it('builds Room voice instructions from the shared builder with live grounding (#35)', async () => {
    const src = (await import('./SessionView?raw')).default
    expect(src).toContain('buildVoiceCompanionInstructions(')
    expect(src).toContain('grounded: isGroundingActive()')
    expect(src).not.toContain('isGrounding: false')
  })

  it('derives Room availability from the effective roomEnabled formula', async () => {
    const src = (await import('./SessionView?raw')).default
    expect(src).toContain('isRoomEnabled(globalConfig?.features)')
    expect(src).not.toContain('relaxEnabled || driftEnabled')
  })

  it('seeds Room voice with the current session turns (T5)', async () => {
    const src = (await import('./SessionView?raw')).default
    expect(src).toMatch(/buildVoiceCompanionInstructions\(\{[\s\S]{0,200}messages: messagesRef\.current/)
  })

  it('fences Room transcripts to the session the Room started in and ends voice on a session change (T2)', async () => {
    const src = (await import('./SessionView?raw')).default
    expect(src).toContain('onUserTranscript={handleRoomUserTranscript}')
    expect(src).toContain('onAssistantTranscript={handleRoomAssistantTranscript}')
    expect(src).toMatch(/isRoomOwnerCurrent\(ownerSessionId\)\) return\s+void appendUserMessage\(text, 'voice', 'room'\)/)
    expect(src).toMatch(/previous === null \|\| currentSessionId === null \|\| previous === currentSessionId\) return/)
  })

  it('makes the Talk composer inert while Room or Speak is open (#32)', async () => {
    const src = (await import('./SessionView?raw')).default
    expect(src).toContain('inert={overlayOpen || undefined}')
  })
})

describe('SessionView — journal drafts are session-owned and durable (T1)', () => {
  it('keeps the draft in the owner-bound hook, not in bare React state', async () => {
    const src = (await import('./SessionView?raw')).default
    expect(src).toContain('useJournalDraft({ uid, sessionId: session?.id ?? null, append: appendJournalDraft })')
    expect(src).not.toContain("useState<string>('')")
    // The draft is never cleared before its append succeeds.
    expect(src).not.toContain("setJournalDraft('')")
  })

  it('appends only to the owning session, re-reading a remote close first', async () => {
    const src = (await import('./SessionView?raw')).default
    expect(src).toMatch(/current\.id !== owner\.sessionId \|\| current\.status !== 'active'\) return false/)
    expect(src).toContain('db.sessions.get(owner.sessionId)')
    expect(src).toMatch(/appendUserMessage\(text, 'text', 'journal', \{\s+ownerSessionId: owner\.sessionId,\s+messageId: owner\.messageId,/)
  })

  it('remounts the Journal editor per draft owner and fences stale editor writes', async () => {
    const src = (await import('./SessionView?raw')).default
    expect(src).toContain('key={journalScope}')
    expect(src).toContain('onChange={text => setJournalText(text, journalScope)}')
  })

  it('contributes the draft before closing, and grounding still flushes journal words as user text', async () => {
    const src = (await import('./SessionView?raw')).default
    expect(src).toMatch(/const handleEndSession = useCallback\(async \(\) => \{[\s\S]{0,600}await commitJournalDraft\(\)[\s\S]{0,300}const currentMessages = messagesRef\.current/)
    expect(src).toContain("if (activeArc.surface === 'journal') void commitJournalDraft()")
  })

  it('offers retry and copy when a draft has not reached the conversation', async () => {
    const src = (await import('./SessionView?raw')).default
    expect(src).toContain('<JournalDraftNotice')
    expect(src).toContain("mode={isClosed ? 'closed' : 'failed'}")
  })

  it('App keeps one SessionView across /session/new adopting its id (no key remount)', async () => {
    const app = (await import('../../App?raw')).default
    expect(app).toMatch(/<SessionView\s+sessionId=\{sessionIdFromPath\}/)
    expect(app).not.toMatch(/<SessionView[^>]*\bkey=/)
  })
})
