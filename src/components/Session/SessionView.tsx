import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import { InkWeight } from '../../extensions/inkWeight'
import { useAutocorrect } from '../../hooks/useAutocorrect'
import { useTypewriter } from '../../hooks/useTypewriter'
import { useHrvSession } from '../../hooks/useHrvSession'
import { useSettings } from '../../store/settings'
import { getGlobalConfig, useGlobalConfig } from '../../store/globalConfig'
import { SessionBottomBar, type SessionSurface } from './SessionBottomBar'
import { db, sessionMessages as sessionMessagesDb, generateId } from '../../store/db'
import { SessionOrchestrator } from '../../engine/sessionOrchestrator'
import { buildTherapistMessages, buildTherapistSystemPrompt } from '../../ai/therapistPrompts'
import { useVoiceSession } from '../../hooks/useVoiceSession'
import { VoiceField } from './VoiceField'
import { streamChatCompletion, reasoningForSpeed } from '../../ai/openrouter'
import { loadTherapistContext } from '../../engine/sessionContextLoader'
import type { TherapistContext } from '../../engine/sessionContextLoader'
import { reflectOnSession } from '../../engine/sessionReflectionEngine'
import { getWeatherEngine } from '../../store/weatherStore'
import { isGroundingActive } from '../../hooks/useGroundingMode'
import { trackEvent } from '../../services/analytics'
import { SessionMessageBubble } from './SessionMessage'
import { SessionJournalSurface } from './SessionJournalSurface'
import { parseRecommendations } from '../../ai/therapistRecommendationParser'
import { BiometricsBar } from './HrvAmbientBar'
import { HrvConsentDialog } from './HrvConsentDialog'
import type { Session, SessionMessage, SessionPhase, SessionMode, EmotionalTone } from '../../types'
import { useTranslation, getLanguageCode } from '../../i18n'

interface Props {
  sessionId: string | null
  openingMethod: 'auto' | 'open_invitation'
  initialMode?: SessionMode
  onSessionCreated?: (id: string) => void
  onBack?: () => void
}

export function SessionView({ sessionId, openingMethod, initialMode, onSessionCreated, onBack }: Props) {
  const tr = useTranslation()
  const [session, setSession] = useState<Session | null>(null)
  const [messages, setMessages] = useState<SessionMessage[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const [openerError, setOpenerError] = useState<string | null>(null)
  const settings = useSettings()

  const typewriter = useTypewriter()
  const sessionIdRef = useRef<string | null>(sessionId)
  const hrv = useHrvSession(sessionIdRef)

  const orchestratorRef = useRef(new SessionOrchestrator())
  const contextRef = useRef<TherapistContext | null>(null)
  const weatherEngine = getWeatherEngine()
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const sessionRef = useRef<Session | null>(null)
  const messagesRef = useRef<SessionMessage[]>([])
  const handleSendRef = useRef<() => void>(() => {})

  const voice = useVoiceSession()
  const voiceEnabled = getGlobalConfig()?.features?.voiceEnabled === true

  const globalConfig = useGlobalConfig()
  const unifiedUI = globalConfig?.features?.unifiedSessionUI === true
  const [surface, setSurface] = useState<SessionSurface>('talk')
  const [journalDraft, setJournalDraft] = useState<string>('')

  const handleAutocorrect = useAutocorrect({
    autocorrect: settings.autocorrect,
    autoCapitalize: settings.autoCapitalize ?? true,
  })

  // Keep refs in sync
  useEffect(() => { sessionRef.current = session; sessionIdRef.current = session?.id ?? null }, [session])
  useEffect(() => { messagesRef.current = messages }, [messages])

  // Auto-scroll on new messages or streaming content
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, typewriter.displayedContent])

  // Initialize session
  useEffect(() => {
    let cancelled = false

    async function init() {
      const context = await loadTherapistContext()
      if (cancelled) return
      contextRef.current = context

      if (sessionId) {
        const existingSession = await db.sessions.get(sessionId)
        if (cancelled || !existingSession) return

        setSession(existingSession)
        sessionRef.current = existingSession

        const existingMessages = await sessionMessagesDb.getAll(sessionId)
        if (cancelled) return
        setMessages(existingMessages)
        messagesRef.current = existingMessages
      } else {
        await startNewSession()
      }
    }

    init()
    return () => {
      cancelled = true
      typewriter.cleanup()
      hrv.cleanupEngine()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId])

  const startNewSession = useCallback(async () => {
    const id = generateId()

    const newSession: Session = {
      id,
      startedAt: Date.now(),
      endedAt: null,
      status: 'active',
      hostPartId: 'therapist',
      participantPartIds: [],
      openingMethod,
      sessionNote: null,
      messageCount: 0,
      firstLine: '',
      phase: 'opening',
      favorited: false,
      mode: initialMode ?? 'standard',
    }

    await db.sessions.add(newSession)
    setSession(newSession)
    sessionRef.current = newSession
    onSessionCreated?.(id)

    trackEvent('session_started', {
      opening_method: openingMethod,
      host_part: 'therapist',
      mode: newSession.mode ?? 'standard',
    })

    // Generate opening message unless open invitation (user speaks first)
    if (openingMethod !== 'open_invitation') {
      try {
        setOpenerError(null)
        await generateTherapistMessage([], newSession)
      } catch (err) {
        setOpenerError(err instanceof Error ? err.message : 'Failed to start session')
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openingMethod, onSessionCreated, initialMode])

  // Returns the updated messages array after the therapist message is finalized.
  //
  // Crisis-detection race: on the first attempt, fires the L2 classifier in
  // parallel with therapist generation. If risk=2 returns before the
  // therapist's first token arrives, the in-flight stream is aborted and a
  // single retry runs with the now-flipped grounding state — so the user
  // sees a grounded response rather than a Real Talk callout or whatever
  // the original prompt would have produced. After first token has arrived,
  // the response finishes (already constrained by SAFETY_RULES) and grounding
  // takes effect on the next turn.
  const generateTherapistMessage = useCallback(async (
    currentMessages: SessionMessage[],
    currentSession: Session,
  ): Promise<SessionMessage[]> => {
    setIsStreaming(true)

    const orchestrator = orchestratorRef.current
    const lastUserMessage = [...currentMessages].reverse().find(m => m.speaker === 'user')

    // At most two attempts: original + one crisis-grounded retry.
    for (let attempt = 0; attempt < 2; attempt++) {
      const phase = orchestrator.detectPhase(currentMessages)
      const maxTokens = orchestrator.getMaxTokens(phase)

      const context = contextRef.current
      const hrvContext = hrv.buildPromptContext()
      const promptMessages = buildTherapistMessages(currentMessages, {
        phase,
        recentSessionNotes: context?.recentSessionNotes,
        relevantMemories: context?.relevantMemories,
        profile: context?.userProfile,
        personalFacts: context?.personalFacts,
        isGrounding: isGroundingActive(),
        hrvContext,
        mode: currentSession.mode ?? 'standard',
        allowRecommendations: unifiedUI,
        // First turn = the therapist has not yet spoken. Covers both the auto-opening
        // path (no messages exist) and the open_invitation path (user speaks first).
        isFirstTurn: currentMessages.filter(m => m.speaker === 'therapist').length === 0,
      })

      typewriter.reset()

      let resolveMessages: (messages: SessionMessage[]) => void
      const messagesPromise = new Promise<SessionMessage[]>(resolve => {
        resolveMessages = resolve
      })

      const finalizeMessage = async (fullText: string) => {
        const msgId = generateId()
        const newMessage: SessionMessage = {
          id: msgId,
          speaker: 'therapist',
          partId: null,
          partName: null,
          content: fullText.trim(),
          timestamp: Date.now(),
          phase,
          isEmergence: false,
        }

        await sessionMessagesDb.add(currentSession.id, newMessage)

        const updatedMessages = [...currentMessages, newMessage]
        const newMessageCount = updatedMessages.length
        const firstLine = currentSession.firstLine || fullText.trim().slice(0, 100)

        await db.sessions.update(currentSession.id, {
          messageCount: newMessageCount,
          firstLine,
          phase,
        })

        setSession(prev => prev ? {
          ...prev,
          messageCount: newMessageCount,
          firstLine,
          phase,
        } : prev)
        setMessages(updatedMessages)
        messagesRef.current = updatedMessages
        setIsStreaming(false)
        typewriter.reset()
        resolveMessages(updatedMessages)
      }

      hrv.resetResponseStarted()

      const crisisAbortController = new AbortController()
      let firstTokenArrived = false
      let crisisAborted = false

      // Fire L2 only on the first attempt — if it already determined risk=2
      // and we aborted, the second attempt's prompt is already grounded and
      // re-running the classifier would waste a call.
      if (attempt === 0 && lastUserMessage) {
        orchestrator.checkCrisisRisk(lastUserMessage.content, getLanguageCode())
          .then(result => {
            if (result.risk === 2 && !firstTokenArrived && !crisisAborted) {
              crisisAborted = true
              crisisAbortController.abort()
            }
          })
          .catch(() => { /* fail-open inside checkCrisisRisk */ })
      }

      await streamChatCompletion(
        promptMessages,
        {
          onToken: (token) => {
            firstTokenArrived = true
            typewriter.appendToken(token)
            if (hrv.enabled && hrv.markResponseStarted()) {
              hrv.addConversationEvent('ai_response_start', currentMessages.length)
            }
          },
          onComplete: () => {
            typewriter.setOnComplete(finalizeMessage)
            if (hrv.enabled) {
              hrv.addConversationEvent('ai_response_complete', currentMessages.length)
            }
          },
          onError: (error) => {
            // A crisis-driven abort is expected — suppress and let the loop retry.
            if (crisisAborted) return
            console.error('Session stream error:', error)
            typewriter.reset()
            setIsStreaming(false)
            resolveMessages(currentMessages)
          },
        },
        maxTokens,
        reasoningForSpeed(settings.responseSpeed),
        crisisAbortController.signal,
      )

      if (crisisAborted) continue

      return messagesPromise
    }

    // The loop returns from inside on success and only continues on a
    // crisis-abort, which can happen at most once (attempt > 0 skips L2).
    // This fallback exists for type-safety only.
    setIsStreaming(false)
    return currentMessages
  }, [hrv, typewriter, settings.responseSpeed, unifiedUI])

  // Persist a user-authored message (text or voice) and run the synchronous
  // side effects: HRV event, crisis-keyword check, async emotion/weather update.
  // Returns the updated message list + computed firstLine so callers can chain
  // (text path immediately calls generateTherapistMessage; voice path doesn't).
  const appendUserMessage = useCallback(async (
    content: string,
    inputMethod?: 'text' | 'voice',
  ): Promise<{ updatedMessages: SessionMessage[]; firstLine: string; phase: SessionPhase } | null> => {
    const currentSession = sessionRef.current
    if (!currentSession || currentSession.status === 'closed') return null
    const trimmed = content.trim()
    if (!trimmed) return null

    const currentMessages = messagesRef.current
    const phase = orchestratorRef.current.detectPhase(currentMessages)
    const userMessage: SessionMessage = {
      id: generateId(),
      speaker: 'user',
      partId: null,
      partName: null,
      content: trimmed,
      timestamp: Date.now(),
      phase,
      isEmergence: false,
      ...(inputMethod === 'voice' && { inputMethod }),
    }

    await sessionMessagesDb.add(currentSession.id, userMessage)

    if (hrv.enabled) {
      hrv.addConversationEvent('user_message', currentMessages.length)
    }

    const updatedMessages = [...currentMessages, userMessage]
    const firstLine = currentSession.firstLine || trimmed.slice(0, 100)

    await db.sessions.update(currentSession.id, {
      messageCount: updatedMessages.length,
      firstLine,
    })

    setSession(prev => prev ? { ...prev, messageCount: updatedMessages.length, firstLine } : prev)
    setMessages(updatedMessages)
    messagesRef.current = updatedMessages

    // Synchronous crisis keyword check — runs BEFORE any AI response.
    // Activates grounding mode so isGrounding=true flows into the prompt.
    orchestratorRef.current.checkCrisisKeywords(trimmed)

    // Non-blocking: LLM-based emotion check and weather update.
    orchestratorRef.current.checkEmotionAfterMessage(trimmed)
      .then(result => {
        if (result) {
          weatherEngine.recordEmotion(result.emotion as EmotionalTone)
          if (weatherEngine.shouldPersist()) {
            weatherEngine.persist().catch(console.error)
          }
        }
      })
      .catch(console.error)

    return { updatedMessages, firstLine, phase }
  }, [hrv])

  const handleSend = useCallback(async (editorInstance?: ReturnType<typeof useEditor>) => {
    const ed = editorInstance
    const trimmed = ed?.getText().trim() ?? ''
    if (!trimmed || isStreaming || !sessionRef.current || sessionRef.current.status === 'closed') return

    const result = await appendUserMessage(trimmed, 'text')
    if (!result) return

    const currentSession = sessionRef.current!
    await generateTherapistMessage(result.updatedMessages, {
      ...currentSession,
      messageCount: result.updatedMessages.length,
      firstLine: result.firstLine,
    })
  }, [isStreaming, generateTherapistMessage, appendUserMessage])

  const handleEndSession = useCallback(async () => {
    const currentSession = sessionRef.current
    const currentMessages = messagesRef.current
    if (!currentSession || currentSession.status === 'closed' || isStreaming) return

    // Generate closing therapist message — returns updated messages array
    const finalMessages = await generateTherapistMessage(currentMessages, currentSession)

    // Generate session note — failure must not block session closure or HRV flush.
    // Note can be regenerated; losing the closed-state and HRV data cannot.
    const orchestrator = orchestratorRef.current
    let sessionNote = ''
    try {
      sessionNote = await orchestrator.generateSessionNote(finalMessages)
      trackEvent('session_note_generated', { session_id: currentSession.id })
    } catch (error) {
      console.error('Session note generation failed; closing session without note:', error)
      trackEvent('session_note_failed', { session_id: currentSession.id })
    }

    // Update session as closed
    const endedAt = Date.now()
    await db.sessions.update(currentSession.id, {
      status: 'closed',
      endedAt,
      sessionNote,
      phase: 'closing',
    })

    setSession(prev => prev ? {
      ...prev,
      status: 'closed',
      endedAt,
      sessionNote,
      phase: 'closing',
    } : prev)

    // Non-blocking: run full reflection pipeline
    db.parts.toArray()
      .then(parts => reflectOnSession(currentSession.id, finalMessages, parts))
      .catch(error => console.error('Session reflection error:', error))

    // Persist weather
    weatherEngine.persist().catch(console.error)

    // Save HRV data and stop engine
    await hrv.stopAndFlush()

    trackEvent('session_closed', {
      session_id: currentSession.id,
      message_count: finalMessages.length,
      duration_ms: endedAt - currentSession.startedAt,
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStreaming, generateTherapistMessage, hrv])

  // ─── Voice session wiring ───────────────────────────────
  // User-side voice turns delegate to appendUserMessage (shared with text path).
  // Therapist-side voice turns persist directly — no crisis/emotion/HRV side
  // effects since the realtime model produces the response, not us.
  const persistVoiceTherapistMessage = useCallback(async (content: string) => {
    const currentSession = sessionRef.current
    if (!currentSession || currentSession.status === 'closed') return
    const trimmed = content.trim()
    if (!trimmed) return

    const currentMessages = messagesRef.current
    const phase = orchestratorRef.current.detectPhase(currentMessages)
    const message: SessionMessage = {
      id: generateId(),
      speaker: 'therapist',
      partId: null,
      partName: null,
      content: trimmed,
      timestamp: Date.now(),
      phase,
      isEmergence: false,
      inputMethod: 'voice',
    }

    await sessionMessagesDb.add(currentSession.id, message)

    const updatedMessages = [...currentMessages, message]
    const firstLine = currentSession.firstLine || trimmed.slice(0, 100)

    await db.sessions.update(currentSession.id, {
      messageCount: updatedMessages.length,
      firstLine,
      phase,
    })

    setSession(prev => prev ? { ...prev, messageCount: updatedMessages.length, firstLine, phase } : prev)
    setMessages(updatedMessages)
    messagesRef.current = updatedMessages
  }, [])

  const handleStartVoice = useCallback(async () => {
    const context = contextRef.current
    if (!context) return

    const sessionMessages = messagesRef.current ?? []
    // First turn = the therapist has not yet spoken. Covers both the auto-opening
    // path (no messages exist) and the open_invitation path (user speaks first).
    const isFirstTurn = sessionMessages.filter(m => m.speaker === 'therapist').length === 0

    const instructions = buildTherapistSystemPrompt({
      phase: sessionRef.current?.phase ?? 'opening',
      recentSessionNotes: context.recentSessionNotes,
      relevantMemories: context.relevantMemories,
      profile: context.userProfile,
      personalFacts: context.personalFacts,
      isGrounding: isGroundingActive(),
      hrvContext: hrv.buildPromptContext(),
      mode: sessionRef.current?.mode ?? 'standard',
      allowRecommendations: unifiedUI,
      isFirstTurn,
    })

    const preferredVoice = getGlobalConfig()?.voice?.defaultVoice ?? 'marin'

    trackEvent('voice_session_started', { session_id: sessionRef.current?.id ?? '' })

    await voice.start({
      instructions,
      voice: preferredVoice,
      onUserTranscript: (text) => {
        void appendUserMessage(text, 'voice')
      },
      onAssistantTranscript: (text) => {
        void persistVoiceTherapistMessage(text)
      },
      onAssistantSpeakingChange: (speaking) => {
        if (hrv.enabled) {
          hrv.addConversationEvent(
            speaking ? 'ai_response_start' : 'ai_response_complete',
            messagesRef.current.length,
          )
        }
      },
    })
  }, [voice, hrv, appendUserMessage, persistVoiceTherapistMessage, unifiedUI])

  const handleEndVoice = useCallback(() => {
    voice.stop()
    trackEvent('voice_session_ended', { session_id: sessionRef.current?.id ?? '' })
  }, [voice])

  const handleRealTalkToggle = useCallback(async (next: boolean) => {
    if (!session?.id) return
    const nextMode: 'standard' | 'real_talk' = next ? 'real_talk' : 'standard'
    await db.sessions.update(session.id, { mode: nextMode })
    // Mode change persists immediately. The session subscription (onSnapshot) updates
    // local state in the next tick, so the UI reflects the new mode automatically.
    setSession(prev => prev ? { ...prev, mode: nextMode } : prev)
  }, [session?.id])

  const handleSurfaceChange = useCallback((next: SessionSurface) => {
    // Leaving Journal with non-empty text: append it as a user message so the
    // therapist receives it as context on her next turn.
    if (surface === 'journal' && next !== 'journal' && journalDraft.trim()) {
      void appendUserMessage(journalDraft.trim(), 'text')
      setJournalDraft('')
    }
    // Entering Speak: invoke existing voice infrastructure.
    if (surface !== 'speak' && next === 'speak') {
      void handleStartVoice()
    }
    // Leaving Speak while voice is active: stop voice.
    if (surface === 'speak' && next !== 'speak' && voice.state !== 'idle') {
      voice.stop()
    }
    setSurface(next)
  }, [surface, journalDraft, appendUserMessage, handleStartVoice, voice])

  const handleRecommendationTap = useCallback((target: string) => {
    switch (target) {
      case 'real-talk-on':
        void handleRealTalkToggle(true)
        return
      case 'real-talk-off':
        void handleRealTalkToggle(false)
        return
      case 'journal':
        handleSurfaceChange('journal')
        return
      case 'speak':
        handleSurfaceChange('speak')
        return
      default:
        console.warn(`[unifiedSession] Unknown recommendation target: "${target}"`)
        return
    }
  }, [handleRealTalkToggle, handleSurfaceChange])

  const inputEditor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        codeBlock: false,
        blockquote: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
        horizontalRule: false,
        hardBreak: false,
      }),
      InkWeight,
      Placeholder.configure({ placeholder: 'Type here...' }),
    ],
    content: '',
    editorProps: {
      attributes: {
        class: 'session-input',
        spellcheck: 'false',
      },
      handleKeyDown: (_view, event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault()
          handleSendRef.current()
          return true
        }

        // Autocorrect: backspace undo, auto-capitalize, standalone-i, sentence correction
        if (inputEditor && handleAutocorrect(inputEditor, event)) return true

        return false
      },
    },
  })

  // Keep handleSendRef in sync
  useEffect(() => { handleSendRef.current = () => handleSend(inputEditor) }, [handleSend, inputEditor])

  // Sync InkWeight disabled state
  useEffect(() => {
    if (!inputEditor) return
    const vfx = getGlobalConfig()?.features?.visualEffectsEnabled !== false
    inputEditor.storage.inkWeight.disabled = !(vfx && getGlobalConfig()?.features?.inkWeight !== false)
  }, [inputEditor])

  // Clear editor content when streaming starts
  useEffect(() => {
    if (isStreaming && inputEditor) {
      inputEditor.commands.clearContent()
    }
  }, [isStreaming, inputEditor])

  // Focus editor after streaming completes
  useEffect(() => {
    if (!isStreaming && inputEditor && session?.status !== 'closed') {
      setTimeout(() => inputEditor.commands.focus(), 50)
    }
  }, [isStreaming, inputEditor, session?.status])

  // If voice ends while we're on the Speak surface, return to Talk so the user
  // is not left without input affordances.
  useEffect(() => {
    if (unifiedUI && surface === 'speak' && voice.state === 'idle') {
      setSurface('talk')
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voice.state])

  const isClosed = session?.status === 'closed'
  const canEnd = !isStreaming && messages.length >= 2 && !isClosed

  const backButtonStyle = useMemo<React.CSSProperties>(() => ({
    position: 'fixed',
    top: `calc(${hrv.enabled ? '48px' : '12px'} + env(safe-area-inset-top, 0px))`,
    left: 12,
    zIndex: 40,
    width: 36,
    height: 36,
    borderRadius: 8,
    border: 'none',
    background: 'var(--bg-primary, #1a1a1a)',
    color: 'var(--text-tertiary, #888)',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 18,
    opacity: 0.6,
  }), [hrv.enabled])

  return (
    <>
    {/* Biometrics bar — fixed at top */}
    {hrv.enabled && (
      <div style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 50,
        padding: 'calc(4px + env(safe-area-inset-top, 0px)) 12px 4px',
        background: 'var(--bg-primary, #1a1a1a)',
        borderBottom: '1px solid var(--border-subtle, rgba(255,255,255,0.1))',
      }}>
        <div style={{ maxWidth: 640, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ flex: 1 }}>
            <BiometricsBar
              latest={hrv.latestMeasurement}
              measurementCount={hrv.measurementCount}
              isCalibrating={hrv.calibrating}
              error={hrv.error}
            />
          </div>
          <button
            onClick={hrv.toggle}
            style={{
              padding: '3px 8px',
              borderRadius: 6,
              border: '1px solid var(--border-subtle)',
              background: 'rgba(178,93,93,0.15)',
              color: 'var(--text-secondary)',
              fontFamily: "'Inter', sans-serif",
              fontSize: 10,
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            Stop
          </button>
        </div>
      </div>
    )}
    <div className="session-container">
      {onBack && (
        <button onClick={onBack} style={backButtonStyle} aria-label="Back">
          ←
        </button>
      )}

      {!unifiedUI && session?.mode === 'real_talk' && (
        <div className="session-mode-badge" aria-label={tr['session.mode.realTalk']}>
          <span className="session-mode-glyph" aria-hidden="true">{'◆'}</span>
          {tr['session.mode.realTalk']}
        </div>
      )}

      {/* Session note card (for closed sessions) */}
      {isClosed && session?.sessionNote && (
        <div className="session-note-card">
          <div style={{
            fontSize: 11,
            fontFamily: "'Inter', sans-serif",
            fontWeight: 600,
            color: 'var(--text-secondary)',
            textTransform: 'uppercase' as const,
            letterSpacing: '0.05em',
            marginBottom: 8,
          }}>
            Session Note
          </div>
          <div className="session-message-text" style={{
            color: 'var(--text-primary)',
            fontStyle: 'italic',
          }}>
            {session.sessionNote}
          </div>
        </div>
      )}

      {/* Voice toggle — therapist mode only, inline beside HRV */}
      {!unifiedUI && voiceEnabled && !isClosed && voice.state === 'idle' && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
          <button
            onClick={handleStartVoice}
            className="session-voice-btn"
            aria-label="Start voice session"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="23" />
            </svg>
            Voice
          </button>
        </div>
      )}

      {/* HRV Toggle (inline, non-fixed) */}
      {getGlobalConfig()?.features?.webcamHrv === true && !isClosed && !hrv.enabled && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
          <button
            onClick={hrv.toggle}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 12px',
              borderRadius: 8,
              border: '1px solid var(--border-subtle)',
              background: 'transparent',
              color: 'var(--text-secondary)',
              fontFamily: "'Inter', sans-serif",
              fontSize: 12,
              cursor: 'pointer',
              transition: 'all 0.2s',
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
              <circle cx="12" cy="13" r="4" />
              <line x1="1" y1="1" x2="23" y2="23" />
            </svg>
            Biometrics Off
          </button>
        </div>
      )}

      {(unifiedUI && surface === 'journal') ? (
        <SessionJournalSurface
          messageCount={messages.length}
          value={journalDraft}
          onChange={setJournalDraft}
        />
      ) : (
        <>
          {/* Error banner for opening message generation */}
          {openerError && (
            <div style={{
              margin: '16px 0',
              padding: 12,
              border: '1px solid var(--border-subtle)',
              borderRadius: 6,
              background: 'var(--overlay-subtle)',
              fontSize: 13,
              color: 'var(--text-secondary)',
              display: 'flex',
              alignItems: 'center',
              gap: 12,
            }}>
              <span style={{ flex: 1 }}>The therapist couldn't be reached. {openerError}</span>
              <button
                onClick={async () => {
                  if (!session) return
                  try {
                    setOpenerError(null)
                    await generateTherapistMessage([], session)
                  } catch (err) {
                    setOpenerError(err instanceof Error ? err.message : 'Failed to retry')
                  }
                }}
                style={{
                  padding: '4px 10px',
                  border: '1px solid var(--accent-warm)',
                  borderRadius: 4,
                  background: 'transparent',
                  color: 'var(--accent-warm)',
                  cursor: 'pointer',
                  fontSize: 12,
                }}
              >
                Retry
              </button>
            </div>
          )}

          {/* Messages list */}
          {messages.map(msg => (
            <SessionMessageBubble
              key={msg.id}
              message={msg}
              unifiedUI={unifiedUI}
              onRecommendationTap={handleRecommendationTap}
            />
          ))}

          {/* Streaming message */}
          {isStreaming && typewriter.displayedContent && (
            <div style={{ marginBottom: 20, opacity: 0.88 }}>
              <div className="session-message-text" style={{
                color: 'var(--text-secondary)',
                fontStyle: 'italic',
              }}>
                {unifiedUI
                  ? parseRecommendations(typewriter.displayedContent).map((seg, i) =>
                      seg.type === 'text' ? (
                        <span key={i}>{seg.text}</span>
                      ) : (
                        <button
                          key={i}
                          type="button"
                          className="session-recommendation"
                          onClick={() => handleRecommendationTap(seg.target)}
                        >
                          {seg.phrase}
                        </button>
                      )
                    )
                  : typewriter.displayedContent}
                <span style={{
                  display: 'inline-block',
                  width: 2,
                  height: '1em',
                  background: 'var(--text-secondary)',
                  marginLeft: 2,
                  opacity: 0.5,
                  animation: 'blink 1s step-end infinite',
                }} />
              </div>
            </div>
          )}

          {/* Streaming indicator (no content yet) */}
          {isStreaming && !typewriter.displayedContent && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ display: 'flex', gap: 3 }}>
                {[0, 1, 2].map((i) => (
                  <span key={i} style={{
                    display: 'inline-block',
                    width: 5,
                    height: 5,
                    borderRadius: '50%',
                    background: 'var(--text-secondary)',
                    opacity: 0.4,
                    animation: `dotPulse 1.4s ease-in-out ${i * 0.2}s infinite`,
                  }} />
                ))}
              </div>
            </div>
          )}

          {/* Inline input with send button */}
          {!isClosed && !isStreaming && (
            <div className="session-input-row" style={{ marginBottom: 20 }}>
              <EditorContent editor={inputEditor} />
              <button
                className="session-send-btn"
                onClick={() => handleSendRef.current()}
                aria-label="Send"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="19" x2="12" y2="5" />
                  <polyline points="5 12 12 5 19 12" />
                </svg>
              </button>
            </div>
          )}
        </>
      )}

      {/* Unified session bottom bar — shown when flag is on and session is active */}
      {unifiedUI && !isClosed && (
        <SessionBottomBar
          activeSurface={surface}
          realTalkOn={session?.mode === 'real_talk'}
          onSurfaceChange={handleSurfaceChange}
          onRealTalkToggle={handleRealTalkToggle}
        />
      )}

      <div ref={messagesEndRef} />

      {/* End session */}
      {!isClosed && (
        <div style={{ paddingTop: 24, paddingBottom: 32 }}>
          <button
            className="session-end-btn"
            onClick={handleEndSession}
            disabled={!canEnd}
            style={{
              opacity: canEnd ? 0.5 : 0.2,
              cursor: canEnd ? 'pointer' : 'default',
            }}
          >
            end session
          </button>
        </div>
      )}

      {/* Closed state indicator */}
      {isClosed && (
        <div style={{
          textAlign: 'center',
          padding: '32px 0',
          fontFamily: "'Inter', sans-serif",
          fontSize: 12,
          color: 'var(--text-secondary)',
          opacity: 0.5,
          letterSpacing: '0.05em',
        }}>
          session closed
        </div>
      )}

      {/* HRV Consent Dialog */}
      {hrv.showConsent && (
        <HrvConsentDialog
          onAccept={() => {
            hrv.setShowConsent(false)
            hrv.start()
          }}
          onDecline={() => hrv.setShowConsent(false)}
        />
      )}
    </div>

    {/* Voice session overlay — full-screen field visualization */}
    {voiceEnabled && voice.state !== 'idle' && (
      <VoiceField
        state={voice.state}
        error={voice.error}
        muted={voice.muted}
        assistantSpeaking={voice.assistantSpeaking}
        userSpeaking={voice.userSpeaking}
        remoteStream={voice.remoteStream}
        dominantEmotion={weatherEngine.getCurrentDominantEmotion()}
        onToggleMute={voice.toggleMute}
        onEnd={handleEndVoice}
      />
    )}
    </>
  )
}

export default SessionView
