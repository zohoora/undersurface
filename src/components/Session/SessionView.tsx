import { useState, useEffect, useRef, useCallback } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { InkWeight } from '../../extensions/inkWeight'
import { extractCompletedSentence, correctSentence, shouldTriggerAutocorrect } from '../../ai/llmCorrect'
import { getLanguageCode } from '../../i18n'
import { useSettings } from '../../store/settings'
import { getGlobalConfig } from '../../store/globalConfig'
import { db, sessionMessages as sessionMessagesDb, generateId } from '../../store/db'
import { SessionOrchestrator } from '../../engine/sessionOrchestrator'
import { buildTherapistMessages } from '../../ai/therapistPrompts'
import { streamChatCompletion } from '../../ai/openrouter'
import { loadTherapistContext } from '../../engine/sessionContextLoader'
import type { TherapistContext } from '../../engine/sessionContextLoader'
import { reflectOnSession } from '../../engine/sessionReflectionEngine'
import { WeatherEngine } from '../../engine/weatherEngine'
import { isGroundingActive } from '../../hooks/useGroundingMode'
import { trackEvent } from '../../services/analytics'
import { SessionMessageBubble } from './SessionMessage'
import { HrvEngine } from '../../engine/hrvEngine'
import { HrvTimeline } from '../../engine/hrvTimeline'
import { HrvAmbientBar } from './HrvAmbientBar'
import { HrvConsentDialog } from './HrvConsentDialog'
import type { Session, SessionMessage, Part, EmotionalTone, HrvMeasurement, HrvError, HrvSessionData } from '../../types'

interface Props {
  sessionId: string | null
  openingMethod: 'auto' | 'open_invitation'
  onSessionCreated?: (id: string) => void
}

export function SessionView({ sessionId, openingMethod, onSessionCreated }: Props) {
  const [session, setSession] = useState<Session | null>(null)
  const [messages, setMessages] = useState<SessionMessage[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const [streamingContent, setStreamingContent] = useState('')
  const settings = useSettings()

  const orchestratorRef = useRef(new SessionOrchestrator())
  const therapistContextRef = useRef<TherapistContext | null>(null)
  const weatherEngineRef = useRef(new WeatherEngine())
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const sessionRef = useRef<Session | null>(null)
  const messagesRef = useRef<SessionMessage[]>([])
  const lastAutocorrectRef = useRef<{
    original: string
    correction: string
    wordStart: number
    delimiter: string
  } | null>(null)
  const handleSendRef = useRef<() => void>(() => {})

  // HRV biometric state
  const [hrvEnabled, setHrvEnabled] = useState(false)
  const [hrvMeasurements, setHrvMeasurements] = useState<HrvMeasurement[]>([])
  const [hrvCalibrating, setHrvCalibrating] = useState(true)
  const [hrvError, setHrvError] = useState<string | null>(null)
  const [showHrvConsent, setShowHrvConsent] = useState(false)
  const hrvEngineRef = useRef<HrvEngine | null>(null)
  const hrvTimelineRef = useRef(new HrvTimeline())
  const hrvStartTimeRef = useRef<number>(0)
  const hrvFlushIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const hrvResponseStartedRef = useRef(false)

  // Typewriter effect: buffer incoming tokens, reveal character by character
  const streamBufferRef = useRef('')
  const displayedLengthRef = useRef(0)
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onStreamCompleteRef = useRef<((fullText: string) => void) | null>(null)

  const revealNextChar = useCallback(() => {
    if (displayedLengthRef.current < streamBufferRef.current.length) {
      const remaining = streamBufferRef.current.length - displayedLengthRef.current
      const burst = remaining > 20 ? 3 : remaining > 5 ? 2 : 1
      displayedLengthRef.current = Math.min(
        displayedLengthRef.current + burst,
        streamBufferRef.current.length,
      )
      setStreamingContent(streamBufferRef.current.slice(0, displayedLengthRef.current))
      const delay = 25 + Math.random() * 30
      typingTimerRef.current = setTimeout(revealNextChar, delay)
    } else if (onStreamCompleteRef.current) {
      const cb = onStreamCompleteRef.current
      onStreamCompleteRef.current = null
      cb(streamBufferRef.current)
    } else {
      typingTimerRef.current = null
    }
  }, [])

  // Keep refs in sync
  useEffect(() => { sessionRef.current = session }, [session])
  useEffect(() => { messagesRef.current = messages }, [messages])

  // Auto-scroll on new messages or streaming content
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingContent])

  // Initialize session
  useEffect(() => {
    let cancelled = false

    async function init() {
      // Load therapist context (cross-session memory)
      const context = await loadTherapistContext()
      if (cancelled) return
      therapistContextRef.current = context

      if (sessionId) {
        // Load existing session
        const existingSession = await db.sessions.get(sessionId) as unknown as Session | undefined
        if (cancelled || !existingSession) return
        setSession(existingSession)
        sessionRef.current = existingSession

        const existingMessages = await sessionMessagesDb.getAll(sessionId) as unknown as SessionMessage[]
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
      if (typingTimerRef.current) {
        clearTimeout(typingTimerRef.current)
        typingTimerRef.current = null
      }
      // Clean up HRV engine
      hrvEngineRef.current?.stop()
      if (hrvFlushIntervalRef.current) {
        clearInterval(hrvFlushIntervalRef.current)
      }
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
      isTherapistSession: true,
    }

    await db.sessions.add(newSession)
    setSession(newSession)
    sessionRef.current = newSession
    onSessionCreated?.(id)

    trackEvent('session_started', {
      opening_method: openingMethod,
      host_part: 'therapist',
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
    setStreamingContent('')

    const orchestrator = orchestratorRef.current
    const phase = orchestrator.detectPhase(currentMessages)
    const maxTokens = orchestrator.getMaxTokens(phase)

    const context = therapistContextRef.current
    const hrvContext = hrvEnabled ? hrvTimelineRef.current.buildPromptContext() : undefined
    const promptMessages = buildTherapistMessages(currentMessages, {
      phase,
      recentSessionNotes: context?.recentSessionNotes,
      relevantMemories: context?.relevantMemories,
      profile: context?.userProfile,
      isGrounding: isGroundingActive(),
      hrvContext,
    })

    // Reset typewriter buffer
    streamBufferRef.current = ''
    displayedLengthRef.current = 0
    if (typingTimerRef.current) {
      clearTimeout(typingTimerRef.current)
      typingTimerRef.current = null
    }
    onStreamCompleteRef.current = null

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
      setStreamingContent('')
      resolveMessages(updatedMessages)
    }

    hrvResponseStartedRef.current = false

    await streamChatCompletion(
      promptMessages,
      {
        onToken: (token) => {
          streamBufferRef.current += token
          if (!typingTimerRef.current) {
            revealNextChar()
          }
          // Track HRV timeline: first token = response start
          if (hrvEnabled && !hrvResponseStartedRef.current) {
            hrvResponseStartedRef.current = true
            hrvTimelineRef.current.addConversationEvent('ai_response_start', currentMessages.length)
          }
        },
        onComplete: () => {
          onStreamCompleteRef.current = finalizeMessage
          if (!typingTimerRef.current) {
            revealNextChar()
          }
          // Track HRV timeline: response complete
          if (hrvEnabled) {
            hrvTimelineRef.current.addConversationEvent('ai_response_complete', currentMessages.length)
          }
        },
        onError: (error) => {
          console.error('Session stream error:', error)
          if (typingTimerRef.current) {
            clearTimeout(typingTimerRef.current)
            typingTimerRef.current = null
          }
          onStreamCompleteRef.current = null
          setIsStreaming(false)
          setStreamingContent('')
          resolveMessages(currentMessages)
        },
      },
      maxTokens,
    )

    return messagesPromise
  }, [revealNextChar, hrvEnabled])

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
    if (hrvEnabled) {
      hrvTimelineRef.current.addConversationEvent('user_message', currentMessages.length)
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
          weatherEngineRef.current.recordEmotion(result.emotion as EmotionalTone)
          if (weatherEngineRef.current.shouldPersist()) {
            weatherEngineRef.current.persist().catch(console.error)
          }
        }
      })
      .catch(console.error)

    await generateTherapistMessage(updatedMessages, {
      ...currentSession,
      messageCount: updatedMessages.length,
      firstLine,
    })
  }, [isStreaming, generateTherapistMessage, hrvEnabled])

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
      .then(parts => reflectOnSession(currentSession.id, finalMessages, parts as Part[]))
      .catch(error => console.error('Session reflection error:', error))

    // Persist weather
    weatherEngineRef.current.persist().catch(console.error)

    // Save HRV data and stop engine
    if (hrvEnabled && hrvEngineRef.current) {
      if (!hrvEngineRef.current.isCalibrating()) {
        await flushHrvData()
      }
      hrvEngineRef.current.stop()
      hrvEngineRef.current = null
      setHrvEnabled(false)
      if (hrvFlushIntervalRef.current) {
        clearInterval(hrvFlushIntervalRef.current)
        hrvFlushIntervalRef.current = null
      }
    }

    trackEvent('session_closed', {
      session_id: currentSession.id,
      message_count: finalMessages.length,
      duration_ms: endedAt - currentSession.startedAt,
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStreaming, generateTherapistMessage, hrvEnabled])

  const flushHrvData = useCallback(async () => {
    const currentSession = sessionRef.current
    const timeline = hrvTimelineRef.current
    if (!currentSession || timeline.getMeasurements().length === 0) return

    const measurements = timeline.getMeasurements()
    const shifts = timeline.getRecentShifts(99999)

    const avgHr = measurements.reduce((s, m) => s + m.hr, 0) / measurements.length
    const avgRmssd = measurements.reduce((s, m) => s + m.rmssd, 0) / measurements.length
    const avgConf = measurements.reduce((s, m) => s + m.confidence, 0) / measurements.length

    const stateCounts: Record<string, number> = {}
    for (const m of measurements) {
      stateCounts[m.autonomicState] = (stateCounts[m.autonomicState] || 0) + 1
    }
    const dominantState = Object.entries(stateCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'transitioning'

    const data: HrvSessionData = {
      id: currentSession.id,
      startedAt: hrvStartTimeRef.current,
      endedAt: Date.now(),
      calibrationBaseline: timeline.baselineRmssd || 0,
      measurements,
      shifts,
      summary: {
        dominantState: dominantState as HrvSessionData['summary']['dominantState'],
        averageHr: Math.round(avgHr),
        averageRmssd: Math.round(avgRmssd * 10) / 10,
        shiftCount: shifts.length,
        avgConfidence: Math.round(avgConf * 100) / 100,
      },
    }

    await db.hrvSessions.add(data)
  }, [])

  const startHrvEngine = useCallback(async () => {
    const engine = new HrvEngine()
    hrvEngineRef.current = engine
    hrvTimelineRef.current = new HrvTimeline()
    hrvStartTimeRef.current = Date.now()

    engine.onMeasurement((m) => {
      hrvTimelineRef.current.addMeasurement(m)
      setHrvMeasurements(prev => [...prev, m])
    })

    engine.onCalibrationComplete((baseline) => {
      hrvTimelineRef.current.setBaseline(baseline)
      setHrvCalibrating(false)
    })

    engine.onError((err) => {
      if (err.type === 'camera_lost') {
        setHrvError('Camera disconnected')
      } else if (err.type === 'worker_error') {
        console.warn('HRV worker error:', err.message)
      }
    })

    try {
      await engine.start()
      setHrvEnabled(true)
      setHrvError(null)

      // Safety flush every 5 minutes
      hrvFlushIntervalRef.current = setInterval(() => {
        flushHrvData().catch(console.error)
      }, 5 * 60 * 1000)

      trackEvent('hrv_enabled', { session_id: sessionRef.current?.id ?? '' })
    } catch (err) {
      const hrvErr = err as HrvError
      if (hrvErr.type === 'camera_denied') {
        setHrvError('Camera access denied')
      } else {
        setHrvError('Camera not available')
      }
      hrvEngineRef.current = null
    }
  }, [flushHrvData])

  const handleHrvToggle = useCallback(async () => {
    const config = getGlobalConfig()
    if (config?.features?.webcamHrv !== true) return

    if (hrvEnabled) {
      // Disable
      hrvEngineRef.current?.stop()
      hrvEngineRef.current = null
      setHrvEnabled(false)
      setHrvMeasurements([])
      setHrvCalibrating(true)
      setHrvError(null)
      if (hrvFlushIntervalRef.current) {
        clearInterval(hrvFlushIntervalRef.current)
        hrvFlushIntervalRef.current = null
      }
      return
    }

    // Check consent
    const consent = await db.consent.get('camera-hrv')
    if (!consent) {
      setShowHrvConsent(true)
      return
    }

    await startHrvEngine()
  }, [hrvEnabled, startHrvEngine])

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

        if (event.metaKey || event.ctrlKey || event.altKey) return false

        // Undo autocorrect on Backspace
        if (event.key === 'Backspace' && inputEditor && lastAutocorrectRef.current) {
          const { original, correction, wordStart, delimiter } = lastAutocorrectRef.current
          const cursor = inputEditor.state.selection.from
          const expectedEnd = wordStart + correction.length + delimiter.length
          if (cursor === expectedEnd) {
            const docText = inputEditor.state.doc.textBetween(wordStart, expectedEnd)
            if (docText === correction + delimiter) {
              event.preventDefault()
              inputEditor.view.dispatch(
                inputEditor.state.tr.replaceWith(
                  wordStart,
                  expectedEnd,
                  inputEditor.state.schema.text(original + delimiter),
                ),
              )
              lastAutocorrectRef.current = null
              return true
            }
          }
          lastAutocorrectRef.current = null
        }

        if (event.key.length === 1 || event.key === 'Backspace' || event.key === 'Delete') {
          if (event.key !== 'Backspace') lastAutocorrectRef.current = null

          // Auto-capitalize
          if (settings.autoCapitalize && inputEditor && event.key.length === 1) {
            const from = inputEditor.state.selection.from
            const parentOffset = inputEditor.state.selection.$from.parentOffset

            if (/[a-z]/.test(event.key)) {
              const shouldCapitalize = parentOffset === 0
                || /[.!?]\s$/.test(inputEditor.state.doc.textBetween(Math.max(0, from - 3), from))

              if (shouldCapitalize) {
                event.preventDefault()
                inputEditor.commands.insertContent(event.key.toUpperCase())
                return true
              }
            }

            // Fix standalone "i" to "I"
            if (getLanguageCode() === 'en' && /[\s,.'!?;:]/.test(event.key) && from >= 1) {
              const lookback = inputEditor.state.doc.textBetween(Math.max(0, from - 2), from)
              if (/(?:^|\s)i$/.test(lookback)) {
                inputEditor.view.dispatch(
                  inputEditor.state.tr.replaceWith(from - 1, from, inputEditor.state.schema.text('I'))
                )
              }
            }
          }

          // Autocorrect: on sentence-ending punctuation, send completed sentence to LLM
          if (settings.autocorrect && getGlobalConfig()?.features?.autocorrectEnabled !== false && inputEditor) {
            const $pos = inputEditor.state.selection.$from
            const textBefore = $pos.parent.textBetween(0, $pos.parentOffset)
            if (shouldTriggerAutocorrect(event.key, textBefore)) {
              const textForExtraction = event.key === ' ' ? textBefore + ' ' : textBefore
              const extracted = extractCompletedSentence(textForExtraction)
              if (extracted) {
                const absStart = $pos.start() + extracted.start
                const absEnd = $pos.start() + extracted.end
                const capturedEditor = inputEditor
                const originalSentence = extracted.sentence
                correctSentence(originalSentence).then((corrected) => {
                  if (!corrected) return
                  const currentState = capturedEditor.state
                  if (absEnd > currentState.doc.content.size) return
                  let currentText: string
                  try { currentText = currentState.doc.textBetween(absStart, absEnd) } catch { return }
                  if (currentText !== originalSentence) return
                  capturedEditor.view.dispatch(
                    currentState.tr.replaceWith(
                      absStart,
                      absEnd,
                      currentState.schema.text(corrected),
                    ),
                  )
                  lastAutocorrectRef.current = { original: originalSentence, correction: corrected, wordStart: absStart, delimiter: '' }
                })
              }
            }
          }
        }
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

  return (
    <>
    {/* HRV Ambient Bar — fixed at top */}
    {hrvEnabled && (
      <div style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 50,
        padding: '8px 16px',
        background: 'var(--bg-primary, #1a1a1a)',
        borderBottom: '1px solid var(--border-subtle, rgba(255,255,255,0.1))',
      }}>
        <div style={{ maxWidth: 800, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ flex: 1 }}>
            <HrvAmbientBar
              measurements={hrvMeasurements}
              stream={hrvEngineRef.current?.getStream() ?? null}
              isCalibrating={hrvCalibrating}
              error={hrvError}
              faceROI={hrvEngineRef.current?.getFaceROI() ?? null}
              videoWidth={hrvEngineRef.current?.getVideoSize()?.width ?? 320}
              videoHeight={hrvEngineRef.current?.getVideoSize()?.height ?? 240}
            />
          </div>
          <button
            onClick={handleHrvToggle}
            style={{
              padding: '4px 10px',
              borderRadius: 6,
              border: '1px solid var(--border-subtle)',
              background: 'rgba(178,93,93,0.15)',
              color: 'var(--text-secondary)',
              fontFamily: "'Inter', sans-serif",
              fontSize: 11,
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            Stop
          </button>
        </div>
      </div>
    )}
    <div style={{
      position: 'relative',
      zIndex: 2,
      maxWidth: 640,
      margin: '0 auto',
      paddingTop: hrvEnabled ? 140 : 80,
      paddingBottom: 80,
      paddingLeft: 24,
      paddingRight: 24,
      minHeight: '100vh',
    }}>
      {/* Session note card (for closed sessions) */}
      {isClosed && session?.sessionNote && (
        <div style={{
          background: 'var(--surface-secondary)',
          borderRadius: 12,
          padding: '20px 24px',
          marginBottom: 32,
          border: '1px solid var(--border-subtle)',
        }}>
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
          <div style={{
            fontFamily: "'Spectral', Georgia, 'Times New Roman', serif",
            fontSize: 17,
            fontWeight: 400,
            lineHeight: 1.85,
            color: 'var(--text-primary)',
            fontStyle: 'italic',
          }}>
            {session.sessionNote}
          </div>
        </div>
      )}

      {/* HRV Toggle (inline, non-fixed) */}
      {getGlobalConfig()?.features?.webcamHrv === true && !isClosed && !hrvEnabled && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
          <button
            onClick={handleHrvToggle}
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
            HRV Off
          </button>
        </div>
      )}

      {/* Messages list */}
      {messages.map(msg => (
        <SessionMessageBubble key={msg.id} message={msg} />
      ))}

      {/* Streaming message */}
      {isStreaming && streamingContent && (
        <div style={{ marginBottom: 20, opacity: 0.88 }}>
          <div style={{
            fontFamily: "'Spectral', Georgia, 'Times New Roman', serif",
            fontSize: 19,
            fontWeight: 400,
            lineHeight: 1.85,
            color: 'var(--text-secondary)',
            fontStyle: 'italic',
          }}>
            {streamingContent}
            <span style={{
              display: 'inline-block',
              width: 2,
              height: 19,
              background: 'var(--text-secondary)',
              marginLeft: 2,
              opacity: 0.5,
              animation: 'blink 1s step-end infinite',
            }} />
          </div>
        </div>
      )}

      {/* Streaming indicator (no content yet) */}
      {isStreaming && !streamingContent && (
        <div style={{
          marginBottom: 20,
        }}>
          <div style={{
            fontFamily: "'Spectral', Georgia, 'Times New Roman', serif",
            fontSize: 19,
            fontWeight: 400,
            lineHeight: 1.85,
            color: 'var(--text-secondary)',
            fontStyle: 'italic',
            display: 'flex',
            gap: 3,
          }}>
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

      {/* Inline input */}
      {!isClosed && !isStreaming && (
        <div style={{ marginBottom: 20 }}>
          <EditorContent editor={inputEditor} />
        </div>
      )}

      <div ref={messagesEndRef} />

      {/* End session */}
      {!isClosed && (
        <div style={{
          paddingTop: 40,
          paddingBottom: 40,
        }}>
          <button
            onClick={handleEndSession}
            disabled={!canEnd}
            style={{
              fontFamily: "'Inter', sans-serif",
              fontSize: 11,
              fontWeight: 500,
              color: 'var(--text-secondary)',
              opacity: canEnd ? 0.5 : 0.2,
              background: 'none',
              border: 'none',
              cursor: canEnd ? 'pointer' : 'default',
              padding: 0,
              letterSpacing: '0.04em',
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
      {showHrvConsent && (
        <HrvConsentDialog
          onAccept={() => {
            setShowHrvConsent(false)
            startHrvEngine()
          }}
          onDecline={() => setShowHrvConsent(false)}
        />
      )}
    </div>
    </>
  )
}

export default SessionView
