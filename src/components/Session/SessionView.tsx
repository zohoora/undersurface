import { useState, useEffect, useRef, useCallback } from 'react'
import { db, sessionMessages as sessionMessagesDb, generateId } from '../../store/db'
import { SessionOrchestrator } from '../../engine/sessionOrchestrator'
import { buildSessionMessages } from '../../ai/sessionPrompts'
import { streamChatCompletion } from '../../ai/openrouter'
import { trackEvent } from '../../services/analytics'
import { getPartDisplayName } from '../../i18n'
import { SessionMessageBubble } from './SessionMessage'
import type { Session, SessionMessage, Part, PartMemory } from '../../types'

interface Props {
  sessionId: string | null
  openingMethod: 'auto' | 'user_chose' | 'open_invitation'
  chosenPartId?: string
  onSessionCreated?: (id: string) => void
}

export function SessionView({ sessionId, openingMethod, chosenPartId, onSessionCreated }: Props) {
  const [session, setSession] = useState<Session | null>(null)
  const [messages, setMessages] = useState<SessionMessage[]>([])
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [streamingContent, setStreamingContent] = useState('')
  const [streamingPartName, setStreamingPartName] = useState<string | null>(null)
  const [parts, setParts] = useState<Part[]>([])

  const orchestratorRef = useRef(new SessionOrchestrator())
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const sessionRef = useRef<Session | null>(null)
  const messagesRef = useRef<SessionMessage[]>([])
  const partsRef = useRef<Part[]>([])

  // Keep refs in sync
  useEffect(() => { sessionRef.current = session }, [session])
  useEffect(() => { messagesRef.current = messages }, [messages])
  useEffect(() => { partsRef.current = parts }, [parts])

  // Auto-scroll on new messages or streaming content
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingContent])

  // Auto-focus input after streaming completes
  useEffect(() => {
    if (!isStreaming && textareaRef.current) {
      textareaRef.current.focus()
    }
  }, [isStreaming])

  // Load parts and initialize session
  useEffect(() => {
    let cancelled = false

    async function init() {
      const allParts = await db.parts.toArray() as unknown as Part[]
      if (cancelled) return
      setParts(allParts)
      partsRef.current = allParts

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
        // Start new session
        await startNewSession(allParts)
      }
    }

    init()
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId])

  const startNewSession = useCallback(async (availableParts: Part[]) => {
    if (availableParts.length === 0) return

    const id = generateId()

    // Select host part
    let hostPart: Part
    if (openingMethod === 'user_chose' && chosenPartId) {
      hostPart = availableParts.find(p => p.id === chosenPartId) ?? availableParts[0]
    } else {
      hostPart = availableParts[Math.floor(Math.random() * availableParts.length)]
    }

    const newSession: Session = {
      id,
      startedAt: Date.now(),
      endedAt: null,
      status: 'active',
      hostPartId: hostPart.id,
      participantPartIds: [hostPart.id],
      openingMethod,
      ...(chosenPartId ? { chosenPartId } : {}),
      sessionNote: null,
      messageCount: 0,
      firstLine: '',
      phase: 'opening',
      favorited: false,
    }

    await db.sessions.add(newSession)
    setSession(newSession)
    sessionRef.current = newSession
    onSessionCreated?.(id)

    trackEvent('session_started', {
      opening_method: openingMethod,
      host_part: hostPart.id,
    })

    // Generate opening message unless open invitation (user speaks first)
    if (openingMethod !== 'open_invitation') {
      await generatePartMessage(hostPart, [], newSession)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openingMethod, chosenPartId, onSessionCreated])

  const generatePartMessage = useCallback(async (
    part: Part,
    currentMessages: SessionMessage[],
    currentSession: Session,
  ) => {
    const displayName = getPartDisplayName({ id: part.id, name: part.name, isSeeded: part.isSeeded })
    setIsStreaming(true)
    setStreamingContent('')
    setStreamingPartName(displayName)

    const orchestrator = orchestratorRef.current
    const phase = orchestrator.detectPhase(currentMessages)
    const maxTokens = orchestrator.getMaxTokens(phase)

    // Check if this is an emergence (new part entering)
    const previousSpeakers = new Set(
      currentMessages
        .filter(m => m.speaker === 'part' && m.partId)
        .map(m => m.partId),
    )
    const isEmergence = !previousSpeakers.has(part.id) && previousSpeakers.size > 0

    // Load memories for this part
    const allMemories = await db.memories.where('partId').equals(part.id).toArray() as unknown as PartMemory[]
    const partMemories = allMemories.slice(-8)

    // Load user profile
    const profiles = await db.userProfile.toArray()
    const profile = profiles.length > 0 ? profiles[0] : null

    // Build other parts list
    const otherPartNames = currentMessages
      .filter(m => m.speaker === 'part' && m.partId && m.partId !== part.id)
      .reduce<string[]>((acc, m) => {
        if (m.partName && !acc.includes(m.partName)) acc.push(m.partName)
        return acc
      }, [])

    // Build emergence context
    let emergenceContext: string | undefined
    if (isEmergence) {
      const lastUserMsg = [...currentMessages].reverse().find(m => m.speaker === 'user')
      if (lastUserMsg) {
        emergenceContext = `The writer said: "${lastUserMsg.content.slice(0, 200)}"`
      }
    }

    const promptMessages = buildSessionMessages(part, currentMessages, {
      phase,
      memories: partMemories,
      profile: profile as Parameters<typeof buildSessionMessages>[2]['profile'],
      otherParts: otherPartNames,
      emergenceContext,
      isClosing: phase === 'closing',
    })

    let streamedText = ''

    await streamChatCompletion(
      promptMessages,
      {
        onToken: (token) => {
          streamedText += token
          setStreamingContent(streamedText)
        },
        onComplete: async (fullText) => {
          const msgId = generateId()
          const newMessage: SessionMessage = {
            id: msgId,
            speaker: 'part',
            partId: part.id,
            partName: displayName,
            content: fullText.trim(),
            timestamp: Date.now(),
            phase,
            isEmergence,
            ...(isEmergence ? { emergenceReason: 'emotional_gravity' as const } : {}),
          }

          await sessionMessagesDb.add(currentSession.id, newMessage)

          // Update participant list if emergence
          const updatedParticipants = isEmergence
            ? [...new Set([...currentSession.participantPartIds, part.id])]
            : currentSession.participantPartIds

          const updatedMessages = [...currentMessages, newMessage]
          const newMessageCount = updatedMessages.length
          const firstLine = currentSession.firstLine || fullText.trim().slice(0, 100)

          await db.sessions.update(currentSession.id, {
            participantPartIds: updatedParticipants,
            messageCount: newMessageCount,
            firstLine,
            phase,
          })

          setSession(prev => prev ? {
            ...prev,
            participantPartIds: updatedParticipants,
            messageCount: newMessageCount,
            firstLine,
            phase,
          } : prev)
          setMessages(updatedMessages)
          setIsStreaming(false)
          setStreamingContent('')
          setStreamingPartName(null)

          if (isEmergence) {
            trackEvent('part_emerged', {
              part_id: part.id,
              session_id: currentSession.id,
              reason: 'emotional_gravity',
            })
          }
        },
        onError: (error) => {
          console.error('Session stream error:', error)
          setIsStreaming(false)
          setStreamingContent('')
          setStreamingPartName(null)
        },
      },
      maxTokens,
    )
  }, [])

  const handleSend = useCallback(async () => {
    const trimmed = input.trim()
    if (!trimmed || isStreaming || !sessionRef.current || sessionRef.current.status === 'closed') return

    const currentSession = sessionRef.current
    const currentMessages = messagesRef.current
    const currentParts = partsRef.current

    setInput('')

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

    // Select speaker and generate response
    const orchestrator = orchestratorRef.current
    const speaker = orchestrator.selectSpeaker(
      currentParts,
      updatedMessages,
      currentSession.hostPartId,
      trimmed,
    )

    await generatePartMessage(speaker, updatedMessages, {
      ...currentSession,
      messageCount: updatedMessages.length,
      firstLine,
    })
  }, [input, isStreaming, generatePartMessage])

  const handleEndSession = useCallback(async () => {
    const currentSession = sessionRef.current
    const currentMessages = messagesRef.current
    const currentParts = partsRef.current
    if (!currentSession || currentSession.status === 'closed' || isStreaming) return

    // Generate closing reflection from host part
    const hostPart = currentParts.find(p => p.id === currentSession.hostPartId)
    if (hostPart) {
      await generatePartMessage(hostPart, currentMessages, currentSession)
    }

    // Re-read messages after closing reflection
    const finalMessages = messagesRef.current

    // Generate session note
    const orchestrator = orchestratorRef.current
    const partNames = [...new Set(
      finalMessages
        .filter(m => m.speaker === 'part' && m.partName)
        .map(m => m.partName as string),
    )]
    const sessionNote = await orchestrator.generateSessionNote(finalMessages, partNames)
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

    // Create reflection memories for each participating part
    for (const partId of currentSession.participantPartIds) {
      const part = currentParts.find(p => p.id === partId)
      if (!part) continue

      const partMsgs = finalMessages.filter(m => m.speaker === 'user').slice(-3)
      const userSummary = partMsgs.map(m => m.content).join(' ').slice(0, 300)

      if (userSummary) {
        const memory: PartMemory = {
          id: generateId(),
          partId: part.id,
          entryId: currentSession.id,
          content: `Session reflection: The writer shared about ${userSummary.slice(0, 150)}...`,
          type: 'reflection',
          timestamp: Date.now(),
          source: 'session',
          sessionId: currentSession.id,
        }
        await db.memories.add(memory)
      }
    }

    trackEvent('session_closed', {
      session_id: currentSession.id,
      message_count: finalMessages.length,
      participant_count: currentSession.participantPartIds.length,
      duration_ms: endedAt - currentSession.startedAt,
    })
  }, [isStreaming, generatePartMessage])

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }, [handleSend])

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
            fontFamily: "'Spectral', serif",
            fontSize: 15,
            lineHeight: 1.7,
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
          {streamingPartName && (
            <div style={{
              fontSize: 11,
              fontFamily: "'Inter', sans-serif",
              fontWeight: 500,
              color: 'var(--text-secondary)',
              marginBottom: 4,
              letterSpacing: '0.02em',
            }}>
              {streamingPartName}
            </div>
          )}
          <div style={{
            fontFamily: "'Spectral', serif",
            fontSize: 16,
            lineHeight: 1.7,
            color: 'var(--text-secondary)',
            fontStyle: 'italic',
          }}>
            {streamingContent}
            <span style={{
              display: 'inline-block',
              width: 2,
              height: 16,
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
          {streamingPartName && (
            <div style={{
              fontSize: 11,
              fontFamily: "'Inter', sans-serif",
              fontWeight: 500,
              color: 'var(--text-secondary)',
              marginBottom: 4,
              letterSpacing: '0.02em',
            }}>
              {streamingPartName}
            </div>
          )}
          <div style={{
            fontFamily: "'Spectral', serif",
            fontSize: 16,
            lineHeight: 1.7,
            color: 'var(--text-secondary)',
            fontStyle: 'italic',
          }}>
            ...
          </div>
        </div>
      )}

      {/* Inline input — flows in the document like co-editing */}
      {!isClosed && !isStreaming && (
        <div style={{ marginBottom: 20 }}>
          <textarea
            ref={textareaRef}
            value={input}
            onChange={e => {
              setInput(e.target.value)
              // Auto-resize
              const el = e.target
              el.style.height = 'auto'
              el.style.height = el.scrollHeight + 'px'
            }}
            onKeyDown={handleKeyDown}
            placeholder=""
            rows={1}
            style={{
              width: '100%',
              fontFamily: "'Spectral', serif",
              fontSize: 17,
              lineHeight: 1.7,
              color: 'var(--text-primary)',
              background: 'transparent',
              border: 'none',
              padding: 0,
              resize: 'none',
              outline: 'none',
              overflow: 'hidden',
            }}
          />
        </div>
      )}

      <div ref={messagesEndRef} />

      {/* End session — subtle, inline at the bottom */}
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
