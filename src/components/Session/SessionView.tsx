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
import type { Session, SessionMessage, Part, EmotionalTone } from '../../types'

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
    const promptMessages = buildTherapistMessages(currentMessages, {
      phase,
      recentSessionNotes: context?.recentSessionNotes,
      relevantMemories: context?.relevantMemories,
      profile: context?.userProfile,
      isGrounding: isGroundingActive(),
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

    await streamChatCompletion(
      promptMessages,
      {
        onToken: (token) => {
          streamBufferRef.current += token
          if (!typingTimerRef.current) {
            revealNextChar()
          }
        },
        onComplete: () => {
          onStreamCompleteRef.current = finalizeMessage
          if (!typingTimerRef.current) {
            revealNextChar()
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
  }, [revealNextChar])

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
  }, [isStreaming, generateTherapistMessage])

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

    trackEvent('session_closed', {
      session_id: currentSession.id,
      message_count: finalMessages.length,
      duration_ms: endedAt - currentSession.startedAt,
    })
  }, [isStreaming, generateTherapistMessage])

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
    <div style={{
      position: 'relative',
      zIndex: 2,
      maxWidth: 640,
      margin: '0 auto',
      paddingTop: 80,
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
          opacity: 0.5,
        }}>
          <div style={{
            fontFamily: "'Spectral', Georgia, 'Times New Roman', serif",
            fontSize: 19,
            fontWeight: 400,
            lineHeight: 1.85,
            color: 'var(--text-secondary)',
            fontStyle: 'italic',
          }}>
            ...
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
    </div>
  )
}

export default SessionView
