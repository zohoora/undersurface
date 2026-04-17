import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import { InkWeight } from '../../extensions/inkWeight'
import { useAutocorrect } from '../../hooks/useAutocorrect'
import { useTypewriter } from '../../hooks/useTypewriter'
import { useHrvSession } from '../../hooks/useHrvSession'
import { useSettings } from '../../store/settings'
import { getGlobalConfig } from '../../store/globalConfig'
import { db, sessionMessages as sessionMessagesDb, generateId } from '../../store/db'
import { SessionOrchestrator } from '../../engine/sessionOrchestrator'
import { buildTherapistMessages } from '../../ai/therapistPrompts'
import { buildFutureSelfMessages } from '../../ai/futureSelfPrompts'
import { streamChatCompletion } from '../../ai/openrouter'
import { loadTherapistContext, loadFutureSelfContext } from '../../engine/sessionContextLoader'
import type { FutureSelfContext } from '../../engine/sessionContextLoader'
import { reflectOnSession } from '../../engine/sessionReflectionEngine'
import { getWeatherEngine } from '../../store/weatherStore'
import { isGroundingActive } from '../../hooks/useGroundingMode'
import { trackEvent } from '../../services/analytics'
import { useTranslation } from '../../i18n'
import { SessionMessageBubble } from './SessionMessage'
import { BiometricsBar } from './HrvAmbientBar'
import { HrvConsentDialog } from './HrvConsentDialog'
import type { Session, SessionMessage, SessionMode, EmotionalTone } from '../../types'

const HOST_PART_ID: Record<SessionMode, string> = {
  therapist: 'therapist',
  futureSelf: 'future-self',
}

interface Props {
  sessionId: string | null
  openingMethod: 'auto' | 'open_invitation'
  mode?: SessionMode
  onSessionCreated?: (id: string) => void
  onBack?: () => void
}

export function SessionView({ sessionId, openingMethod, mode = 'therapist', onSessionCreated, onBack }: Props) {
  const tr = useTranslation()
  const isFutureSelf = mode === 'futureSelf'
  const [session, setSession] = useState<Session | null>(null)
  const [messages, setMessages] = useState<SessionMessage[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const settings = useSettings()

  const typewriter = useTypewriter()
  const sessionIdRef = useRef<string | null>(sessionId)
  const hrv = useHrvSession(sessionIdRef)

  const orchestratorRef = useRef(new SessionOrchestrator())
  // Holds therapist or future-self context (superset). `voiceExcerpts` is only
  // populated in future-self mode and ignored by the therapist prompt builder.
  const contextRef = useRef<FutureSelfContext | null>(null)
  const weatherEngine = getWeatherEngine()
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const sessionRef = useRef<Session | null>(null)
  const messagesRef = useRef<SessionMessage[]>([])
  const handleSendRef = useRef<() => void>(() => {})

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
      // Load context — Future Self mode also loads voice excerpts for style mimicry
      const context = isFutureSelf
        ? await loadFutureSelfContext()
        : await loadTherapistContext()
      if (cancelled) return
      contextRef.current = context

      if (sessionId) {
        // Load existing session
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
      hostPartId: HOST_PART_ID[mode],
      participantPartIds: [],
      openingMethod,
      sessionNote: null,
      messageCount: 0,
      firstLine: '',
      phase: 'opening',
      favorited: false,
      isTherapistSession: !isFutureSelf,
      mode,
    }

    await db.sessions.add(newSession)
    setSession(newSession)
    sessionRef.current = newSession
    onSessionCreated?.(id)

    trackEvent('session_started', {
      opening_method: openingMethod,
      host_part: HOST_PART_ID[mode],
      mode,
    })

    // Generate opening message unless open invitation (user speaks first)
    if (openingMethod !== 'open_invitation') {
      await generateTherapistMessage([], newSession)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openingMethod, onSessionCreated])

  // Returns the updated messages array after the therapist message is finalized
  const generateTherapistMessage = useCallback(async (
    currentMessages: SessionMessage[],
    currentSession: Session,
  ): Promise<SessionMessage[]> => {
    setIsStreaming(true)

    const orchestrator = orchestratorRef.current
    const phase = orchestrator.detectPhase(currentMessages)
    const maxTokens = orchestrator.getMaxTokens(phase)

    const context = contextRef.current
    const hrvContext = hrv.buildPromptContext()
    const promptOptions = {
      phase,
      recentSessionNotes: context?.recentSessionNotes,
      relevantMemories: context?.relevantMemories,
      profile: context?.userProfile,
      isGrounding: isGroundingActive(),
      hrvContext,
    }
    const promptMessages = isFutureSelf
      ? buildFutureSelfMessages(currentMessages, {
          ...promptOptions,
          voiceExcerpts: context?.voiceExcerpts,
        })
      : buildTherapistMessages(currentMessages, promptOptions)

    // Reset typewriter buffer
    typewriter.reset()

    // Promise that resolves to the final messages array once typewriter finishes
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

    await streamChatCompletion(
      promptMessages,
      {
        onToken: (token) => {
          typewriter.appendToken(token)
          // Track HRV timeline: first token = response start
          if (hrv.enabled && hrv.markResponseStarted()) {
            hrv.addConversationEvent('ai_response_start', currentMessages.length)
          }
        },
        onComplete: () => {
          typewriter.setOnComplete(finalizeMessage)
          // Track HRV timeline: response complete
          if (hrv.enabled) {
            hrv.addConversationEvent('ai_response_complete', currentMessages.length)
          }
        },
        onError: (error) => {
          console.error('Session stream error:', error)
          typewriter.reset()
          setIsStreaming(false)
          resolveMessages(currentMessages)
        },
      },
      maxTokens,
    )

    return messagesPromise
  }, [hrv, typewriter])

  const handleSend = useCallback(async (editorInstance?: ReturnType<typeof useEditor>) => {
    const ed = editorInstance
    const trimmed = ed?.getText().trim() ?? ''
    if (!trimmed || isStreaming || !sessionRef.current || sessionRef.current.status === 'closed') return

    const currentSession = sessionRef.current
    const currentMessages = messagesRef.current

    // Create user message
    const msgId = generateId()
    const phase = orchestratorRef.current.detectPhase(currentMessages)
    const userMessage: SessionMessage = {
      id: msgId,
      speaker: 'user',
      partId: null,
      partName: null,
      content: trimmed,
      timestamp: Date.now(),
      phase,
      isEmergence: false,
    }

    await sessionMessagesDb.add(currentSession.id, userMessage)

    // Record HRV timeline event
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

    // Synchronous crisis keyword check — runs BEFORE therapist responds
    // Activates grounding mode so isGrounding=true is passed to the prompt
    orchestratorRef.current.checkCrisisKeywords(trimmed)

    // Non-blocking: LLM-based emotion check and weather update
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

    await generateTherapistMessage(updatedMessages, {
      ...currentSession,
      messageCount: updatedMessages.length,
      firstLine,
    })
  }, [isStreaming, generateTherapistMessage, hrv])

  const handleEndSession = useCallback(async () => {
    const currentSession = sessionRef.current
    const currentMessages = messagesRef.current
    if (!currentSession || currentSession.status === 'closed' || isStreaming) return

    // Generate closing therapist message — returns updated messages array
    const finalMessages = await generateTherapistMessage(currentMessages, currentSession)

    // Generate session note
    const orchestrator = orchestratorRef.current
    const sessionNote = await orchestrator.generateSessionNote(finalMessages)
    trackEvent('session_note_generated', { session_id: currentSession.id })

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

      {/* Mode indicator — Future Self only, subtle header */}
      {isFutureSelf && !isClosed && (
        <div style={{
          fontSize: 11,
          fontFamily: "'Inter', sans-serif",
          fontWeight: 500,
          color: 'var(--text-secondary)',
          textTransform: 'uppercase' as const,
          letterSpacing: '0.08em',
          textAlign: 'center' as const,
          opacity: 0.55,
          marginBottom: 28,
          marginTop: 8,
        }}>
          {tr['futureSelf.sessionHeader']}
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

      {/* Messages list */}
      {messages.map(msg => (
        <SessionMessageBubble key={msg.id} message={msg} />
      ))}

      {/* Streaming message */}
      {isStreaming && typewriter.displayedContent && (
        <div style={{ marginBottom: 20, opacity: 0.88 }}>
          <div className="session-message-text" style={{
            color: 'var(--text-secondary)',
            fontStyle: 'italic',
          }}>
            {typewriter.displayedContent}
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
    </>
  )
}

export default SessionView
