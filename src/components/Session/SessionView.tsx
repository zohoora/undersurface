import { useState, useEffect, useRef, useCallback, useMemo, Suspense } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import { takeHandoff } from '../../folio/handoff'
import { getAuth } from 'firebase/auth'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import { InkWeight } from '../../extensions/inkWeight'
import { useAutocorrect } from '../../hooks/useAutocorrect'
import { useTypewriter } from '../../hooks/useTypewriter'
import { useSessionBiometrics } from '../../hooks/useSessionBiometrics'
import { isWebBluetoothSupported } from '../../engine/polarH10Engine'
import { useSettings, updateSettings } from '../../store/settings'
import { getGlobalConfig, useGlobalConfig } from '../../store/globalConfig'
import { SessionBottomBar, type SessionSurface } from './SessionBottomBar'
import { db, sessionMessages as sessionMessagesDb, generateId } from '../../store/db'
import { discardSurfaceArcOutcome } from '../../store/personalScience'
import { SessionOrchestrator } from '../../engine/sessionOrchestrator'
import { SessionRuntime, type SessionTicket } from '../../engine/sessionRuntime'
import { useSessionVoice } from '../../hooks/useSessionVoice'
import { useSessionStream } from '../../hooks/useSessionStream'
import { useJournalDraft, type JournalDraftOwner } from '../../hooks/useJournalDraft'
import { useAuth } from '../../auth/useAuth'
import { loadTherapistContext } from '../../engine/sessionContextLoader'
import { maybeBackfillUserParts } from '../../engine/userPartsBackfill'
import { maybeGenerateStoryArc } from '../../engine/storyArc'
import type { TherapistContext } from '../../engine/sessionContextLoader'
import { reflectOnSession } from '../../engine/sessionReflectionEngine'
import { getWeatherEngine } from '../../store/weatherStore'
import { trackEvent } from '../../services/analytics'
import { SessionMessageBubble } from './SessionMessage'
import { SessionJournalSurface } from './SessionJournalSurface'
import { JournalDraftNotice } from './JournalDraftNotice'
import { isGroundingActive, useGroundingMode } from '../../hooks/useGroundingMode'
import { BiometricsBar } from './HrvAmbientBar'
import { HrvConsentDialog } from './HrvConsentDialog'
import { PolarH10ConsentDialog } from './PolarH10ConsentDialog'
import { PolarH10ConnectButton } from './PolarH10ConnectButton'
import type { Session, SessionMessage, SessionMode } from '../../types'
import { getLanguageCode, useTranslation } from '../../i18n'
import type { MemoryAperture } from '../../types'
import { FieldMosaic } from './FieldMosaic'
import { SurfaceArcGuide, SurfaceArcReturn } from './SurfaceArc'
import { assignmentFromEvent } from '../../engine/personalScience'
import { isFreshEyesSession, normalizeSessionMemoryAperture } from '../../engine/freshEyes'
import { finalizePreviousActiveSessions } from '../../engine/sessionFinalizer'
import { respondToUserTurn as respondToTurn } from '../../engine/turnResponder'
import { canOpenSurface, isRoomEnabled, isVoiceEnabled } from '../../engine/surfaceAvailability'
import { roomVoiceCommandsSupported } from '../../engine/roomEngine'
import { buildVoiceCompanionInstructions, consumeVoiceRepair } from '../../ai/voiceInstructions'
import { buildRoomInstructions } from '../../ai/roomPrompts'
import type { RoomConfig } from '../../hooks/useRoomSession'
import { lazyWithRetry } from '../../utils/lazyWithRetry'
import { SurfaceErrorBoundary } from './SurfaceErrorBoundary'

const VoiceField = lazyWithRetry(() => import('./VoiceField').then(module => ({ default: module.VoiceField })), 'voice-field')
const RoomField = lazyWithRetry(() => import('./Room/RoomField'), 'room-field')

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
  const biometrics = useSessionBiometrics(sessionIdRef)
  const {
    camera: hrv,
    polar,
    active: activeBio,
    enabled: biometricsEnabled,
    startupError: biometricStartupError,
    source: biometricSource,
    cleanup: cleanupBiometrics,
    stopAndFlush: stopAndFlushBiometrics,
  } = biometrics

  const orchestratorRef = useRef(new SessionOrchestrator())
  const contextRef = useRef<TherapistContext | null>(null)
  const weatherEngine = getWeatherEngine()
  const messagesEndRef = useRef<HTMLDivElement>(null)
  // Scrolls the session note (rendered under "session closed") into view on the
  // close transition. justClosedRef scopes it to a just-ended session, so
  // reopening an old closed session still lands on the conversation.
  const closedNoteEndRef = useRef<HTMLDivElement>(null)
  const justClosedRef = useRef(false)
  const sessionRef = useRef<Session | null>(null)
  const messagesRef = useRef<SessionMessage[]>([])
  const runtimeRef = useRef(new SessionRuntime())
  const handleSendRef = useRef<() => void>(() => {})

  const globalConfig = useGlobalConfig()
  const voiceEnabled = isVoiceEnabled(globalConfig?.features)
  // Room absorbs the old Relax and Drift entries. It is unavailable while
  // grounding owns the session. An explicit `roomEnabled` flag wins; unset, it
  // stays derived from the legacy relaxEnabled/driftEnabled flags.
  const grounding = useGroundingMode()
  const roomEnabled = isRoomEnabled(globalConfig?.features)
  const [surface, setSurface] = useState<SessionSurface>('talk')
  const uid = useAuth().user?.uid ?? null
  const [activeArc, setActiveArc] = useState<{ surface: SessionSurface; outcomeId: string; researchEventId: string; startedAt: number; ambientReturn?: boolean } | null>(null)
  const [returnedArc, setReturnedArc] = useState<{ surface: SessionSurface; outcomeId: string } | null>(null)
  const [conductorReturn, setConductorReturn] = useState<Exclude<SessionSurface, 'talk' | 'relax' | 'drift'> | null>(null)
  const handleAutocorrect = useAutocorrect({
    autocorrect: settings.autocorrect,
    autoCapitalize: settings.autoCapitalize ?? true,
  })

  // Keep refs in sync
  useEffect(() => { sessionRef.current = session; sessionIdRef.current = session?.id ?? null }, [session])
  useEffect(() => { messagesRef.current = messages }, [messages])

  // Auto-scroll on new messages, streaming content, or when the closing
  // check-in appears — the check-in mounts just above this anchor, so scrolling
  // the anchor into view keeps the check-in visible where the person is looking.
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, typewriter.displayedContent])

  // Reveal the session note (under "session closed", below the conversation
  // anchor) once, on the close transition. Guarded so it fires only for a
  // session that just ended here, not when reopening an already-closed one.
  useEffect(() => {
    if (session?.status === 'closed' && justClosedRef.current) {
      justClosedRef.current = false
      closedNoteEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [session?.status])

  // Init effect — runs once per sessionId change. Suppressed deps are
  // `startNewSession`, `typewriter`, `hrv`: all three are useCallback/hook
  // returns whose reference changes whenever their own internal deps change
  // (settings, response speed, etc). Including them would re-run session init
  // on unrelated state churn, which would re-fire the opener LLM call.
  // The `cancelled` flag below guarantees teardown safety regardless.
  useEffect(() => {
    const runtime = runtimeRef.current
    const ticket = runtime.begin(sessionId)

    async function init() {
      // Pass the resumed session's id so open-time rupture detection excludes
      // it from the prior-session list (new sessions don't exist yet here).
      const context = await loadTherapistContext(sessionId ?? undefined)
      if (!runtime.isCurrent(ticket)) return
      contextRef.current = context

      // One-time user-parts history backfill + story-arc trigger (both flag-
      // gated inside; fire-and-forget, never on the session's critical path).
      void maybeBackfillUserParts()
      void maybeGenerateStoryArc(sessionId ?? undefined)

      if (sessionId) {
        const existingSession = await db.sessions.get(sessionId)
        if (!runtime.isCurrent(ticket)) return
        if (!existingSession) {
          // Stale bookmark / deleted session / another account's id: without
          // this, the view renders a composer wired to a null session — typing
          // does nothing. Recover to a fresh session.
          onBack?.()
          return
        }

        const normalizedSession = {
          ...existingSession,
          memoryAperture: normalizeSessionMemoryAperture(existingSession.memoryAperture),
        }
        if (normalizedSession.memoryAperture !== existingSession.memoryAperture) {
          void db.sessions.update(existingSession.id, { memoryAperture: normalizedSession.memoryAperture })
        }
        setSession(normalizedSession)
        sessionRef.current = normalizedSession

        const existingMessages = await sessionMessagesDb.getAll(sessionId)
        if (!runtime.isCurrent(ticket)) return
        setMessages(existingMessages)
        messagesRef.current = existingMessages
      } else {
        await startNewSession(ticket)
      }
    }

    init()
    return () => {
      // Flush: if a therapist response finished streaming but is still
      // revealing when the session switches, persist it (finalizeMessage guards
      // its own state writes) rather than dropping the paid message.
      typewriter.cleanup(true)
      runtime.end(ticket)
      // Reset shared streaming state so the next session doesn't inherit a
      // stuck "streaming" bubble (SessionView is one instance across sessions).
      setIsStreaming(false)
      cleanupBiometrics()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId])

  const startNewSession = useCallback(async (ticket: SessionTicket) => {
    await finalizePreviousActiveSessions()
    if (!runtimeRef.current.isCurrent(ticket)) return
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
      mode: initialMode ?? settings.lastSessionMode,
      journalPartsEnabled: true,
      memoryAperture: normalizeSessionMemoryAperture(contextRef.current?.memoryAperture),
    }

    await db.sessions.add(newSession)
    if (!runtimeRef.current.adoptSessionId(id, ticket)) return
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
  // startNewSession runs exactly once per session lifetime (called from init
  // effect when sessionId is null). Adding `generateTherapistMessage` or
  // `settings.lastSessionMode` to deps would just rebuild this callback on
  // unrelated renders without changing its observable behavior.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openingMethod, onSessionCreated, initialMode])

  // Single append queue shared by every message writer (text turn, stream
  // finalize, both voice transcript sides) so concurrent appends serialize.
  const enqueueAppend = useCallback(
    <T,>(fn: () => Promise<T>): Promise<T> => runtimeRef.current.enqueueAppend(fn),
    [],
  )

  const { generateTherapistMessage, appendUserMessage, appendDeterministicCompanionMessage, appendRealtimeCompanionMessage } = useSessionStream({
    sessionRef,
    messagesRef,
    contextRef,
    orchestratorRef,
    setSession,
    setMessages,
    setIsStreaming,
    setOpenerError,
    hrv: biometricSource,
    typewriter,
    enqueueAppend,
    runtime: runtimeRef.current,
  })

  // Another tab or device may close this session (TECH_ISSUES #15). Merge a
  // remote close into the local view so nothing keeps writing into it.
  const adoptRemoteClose = useCallback((sessionId: string, remote: Session) => {
    setSession(prev => prev && prev.id === sessionId ? {
      ...prev,
      status: 'closed',
      endedAt: remote.endedAt ?? prev.endedAt,
      sessionNote: remote.sessionNote ?? prev.sessionNote,
      phase: remote.phase ?? prev.phase,
    } : prev)
  }, [])

  // A Journal draft belongs to the session it was written in, captured by the
  // draft itself. It is contributed only to that session, only while it is
  // the one on screen and still open (re-read, since another tab may have
  // closed it); otherwise the append is refused and the words stay saved.
  const appendJournalDraft = useCallback(async (text: string, owner: JournalDraftOwner): Promise<boolean> => {
    const current = sessionRef.current
    if (!current || current.id !== owner.sessionId || current.status !== 'active') return false
    const remote = await db.sessions.get(owner.sessionId).catch(() => undefined)
    if (remote?.status === 'closed') {
      adoptRemoteClose(owner.sessionId, remote)
      return false
    }
    const result = await appendUserMessage(text, 'text', 'journal', {
      ownerSessionId: owner.sessionId,
      messageId: owner.messageId,
    })
    return result !== null
  }, [appendUserMessage, adoptRemoteClose])

  // Saved on this device as the writer types; restored when Journal opens for
  // the same session. `/session/new` adopts its real id without losing words.
  const journalDraft = useJournalDraft({ uid, sessionId: session?.id ?? null, append: appendJournalDraft })
  const commitJournalDraft = journalDraft.commit
  const setJournalText = journalDraft.setText

  // Conductor / research planning lives in turnResponder, which reads
  // grounding at call time: L1 fires DURING the awaited user append, so the
  // render-time `grounding` value here would be stale (TECH_ISSUES #1).
  const respondToUserTurn = useCallback(async (
    updatedMessages: SessionMessage[],
    currentSession: Session,
  ): Promise<SessionMessage[]> => respondToTurn({
    context: contextRef.current,
    availableSurfaces: [
      'talk',
      'journal',
      ...(voiceEnabled ? ['speak' as const] : []),
      ...(roomEnabled ? ['room' as const] : []),
    ],
    copy: {
      conductorOffer: {
        journal_arc: tr['conductor.offer.journal'],
        speak_arc: tr['conductor.offer.speak'],
        relax_arc: tr['conductor.offer.relax'],
        drift_arc: tr['conductor.offer.drift'],
        room_arc: tr['conductor.offer.room'],
      },
      journalOffer: tr['ps.fixed.journal'],
      transferUserFirst: tr['ps.transfer.fixed.userFirst'],
      transferMinimalCue: tr['ps.transfer.fixed.minimalCue'],
      transferIndependent: tr['ps.transfer.fixed.independent'],
    },
    appendDeterministicCompanionMessage,
    generateTherapistMessage,
  }, updatedMessages, currentSession), [appendDeterministicCompanionMessage, generateTherapistMessage, tr, voiceEnabled, roomEnabled])

  const voice = useSessionVoice({
    sessionRef,
    messagesRef,
    contextRef,
    orchestratorRef,
    setSession,
    setMessages,
    appendUserMessage,
    hrv: biometricSource,
    enqueueAppend,
  })

  // Synchronous re-entry lock: `isStreaming` is stale render state and stays
  // false through the whole awaited append (a full server round-trip), so a
  // second Enter in that window duplicated the user message and launched two
  // concurrent streams into the shared typewriter.
  const handleSend = useCallback(async (editorInstance?: ReturnType<typeof useEditor>) => {
    const ed = editorInstance
    const trimmed = ed?.getText().trim() ?? ''
    if (!trimmed || isStreaming || !sessionRef.current || sessionRef.current.status === 'closed') return
    if (!runtimeRef.current.acquireSend()) return

    // Clear immediately so the same draft can't be re-read mid-append;
    // restored below if the write fails so the words are never lost.
    ed?.commands?.clearContent()
    try {
      let result: Awaited<ReturnType<typeof appendUserMessage>> | null = null
      try {
        result = await appendUserMessage(trimmed, 'text')
      } catch (error) {
        console.error('Failed to append user message:', error)
      }
      if (!result) {
        ed?.commands?.setContent(trimmed)
        return
      }

      const currentSession = sessionRef.current!
      await respondToUserTurn(result.updatedMessages, {
        ...currentSession,
        messageCount: result.updatedMessages.length,
        firstLine: result.firstLine,
      })
    } finally {
      runtimeRef.current.releaseSend()
    }
  }, [isStreaming, respondToUserTurn, appendUserMessage])

  const handleMosaicOpen = useCallback(async (moment: { text: string }) => {
    if (isStreaming || !sessionRef.current || !runtimeRef.current.acquireSend()) return
    try {
      const result = await appendUserMessage(moment.text, 'text', 'talk')
      if (!result) return
      const currentSession = sessionRef.current
      if (!currentSession) return
      await respondToUserTurn(result.updatedMessages, {
        ...currentSession,
        messageCount: result.updatedMessages.length,
        firstLine: result.firstLine,
      })
    } finally {
      runtimeRef.current.releaseSend()
    }
  }, [isStreaming, appendUserMessage, respondToUserTurn])

  const handleEndSession = useCallback(async () => {
    const startingSession = sessionRef.current
    if (!startingSession || startingSession.status === 'closed' || isStreaming) return
    // Journal words written in this session belong in its transcript before
    // the closing turn reads it. If they cannot be added they stay saved on
    // this device (with a copy affordance) rather than blocking the close.
    await commitJournalDraft()
    const currentSession = sessionRef.current
    if (!currentSession || currentSession.id !== startingSession.id || currentSession.status === 'closed') return
    // The closing companion message and session note render in Talk; ending
    // from Journal used to leave the writer on a page where neither appeared.
    setSurface(prev => (prev === 'journal' ? 'talk' : prev))
    const currentMessages = messagesRef.current
    const freshEyes = isFreshEyesSession(currentSession)

    // Generate closing therapist message — returns updated messages array
    const finalMessages = await generateTherapistMessage(currentMessages, currentSession)

    // Generate session note — failure must not block session closure or HRV flush.
    // Note can be regenerated; losing the closed-state and HRV data cannot.
    const orchestrator = orchestratorRef.current
    let sessionNote: string | null = null
    if (!freshEyes) {
      try {
        sessionNote = await orchestrator.generateSessionNote(finalMessages)
        trackEvent('session_note_generated', { session_id: currentSession.id })
      } catch (error) {
        console.error('Session note generation failed; closing session without note:', error)
        trackEvent('session_note_failed', { session_id: currentSession.id })
      }
    }

    // Update session as closed
    const endedAt = Date.now()
    await db.sessions.update(currentSession.id, {
      status: 'closed',
      endedAt,
      sessionNote,
      phase: 'closing',
      reflectionStatus: freshEyes ? 'complete' : 'pending',
      ...(freshEyes ? { reflectedAt: Date.now() } : {}),
    })

    justClosedRef.current = true
    setSession(prev => prev ? {
      ...prev,
      status: 'closed',
      endedAt,
      sessionNote,
      phase: 'closing',
      reflectionStatus: freshEyes ? 'complete' : 'pending',
      ...(freshEyes ? { reflectedAt: Date.now() } : {}),
    } : prev)

    // Whole-session ambient assessment is coupled to the existing reflection
    // call, so scientific evaluation adds no separate LLM request.
    if (!freshEyes) {
      db.parts.toArray()
        .then(parts => reflectOnSession(currentSession.id, finalMessages, parts))
        .catch(error => console.error('Session reflection error:', error))
    }

    // Persist weather
    if (!freshEyes) weatherEngine.persist().catch(console.error)

    // Save HRV data and stop engines (whichever is active)
    await stopAndFlushBiometrics()

    trackEvent('session_closed', {
      session_id: currentSession.id,
      message_count: finalMessages.length,
      duration_ms: endedAt - currentSession.startedAt,
    })
  }, [isStreaming, commitJournalDraft, generateTherapistMessage, stopAndFlushBiometrics, weatherEngine])

  const updateSession = useCallback(async (patch: Partial<Session>) => {
    if (!session?.id) return
    await db.sessions.update(session.id, patch)
    setSession(prev => prev ? { ...prev, ...patch } : prev)
  }, [session?.id])

  const handleRealTalkToggle = useCallback(async (next: boolean) => {
    const nextMode: SessionMode = next ? 'real_talk' : 'standard'
    await updateSession({ mode: nextMode })
    // Remember-last-choice: future new sessions open in this tone.
    updateSettings({ lastSessionMode: nextMode })
  }, [updateSession])

  const handleJournalPartsToggle = useCallback(
    (next: boolean) => updateSession({ journalPartsEnabled: next }),
    [updateSession],
  )

  const handleMemoryApertureChange = useCallback(async (next: MemoryAperture) => {
    const currentSession = sessionRef.current
    const currentMessages = messagesRef.current
    if (!currentSession || isStreaming || currentMessages.some(message => message.speaker === 'user')) return

    const memoryAperture = normalizeSessionMemoryAperture(next)
    if (memoryAperture === currentSession.memoryAperture) return
    const nextSession = { ...currentSession, memoryAperture }

    // The automatic opener was built before the person could reach this
    // switch. Replace it when the mode changes so Fresh eyes is true from the
    // first visible companion word, rather than only from the next turn.
    const openerMessages = currentMessages.filter(message => message.speaker === 'therapist')
    await Promise.all(openerMessages.map(message => sessionMessagesDb.delete(currentSession.id, message.id)))
    await db.sessions.update(currentSession.id, {
      memoryAperture,
      messageCount: 0,
      firstLine: '',
    })
    sessionRef.current = { ...nextSession, messageCount: 0, firstLine: '' }
    messagesRef.current = []
    setSession(sessionRef.current)
    setMessages([])

    if (openerMessages.length > 0 && currentSession.openingMethod !== 'open_invitation') {
      try {
        await generateTherapistMessage([], sessionRef.current)
      } catch (error) {
        setOpenerError(error instanceof Error ? error.message : 'Failed to refresh the opening')
      }
    }
  }, [generateTherapistMessage, isStreaming])

  const voiceState = voice.state
  const voiceStop = voice.stop
  const voiceHandleStart = voice.handleStart
  const handleSurfaceChange = useCallback((next: SessionSurface) => {
    // A surface that is not available must never open: a #switch:speak link
    // with voice disabled used to start a hidden Realtime session.
    if (!canOpenSurface(next, { voiceEnabled, roomEnabled, grounding: isGroundingActive() })) return
    // Leaving Journal: contribute the draft as a user message so the companion
    // receives it as context on her next turn. Exactly once, to the session
    // that owns the draft; it is cleared only after the append succeeds.
    if (surface === 'journal' && next !== 'journal') void commitJournalDraft()
    if (surface !== 'speak' && next === 'speak') {
      void voiceHandleStart()
    }
    if (surface === 'speak' && next !== 'speak' && voiceState !== 'idle') {
      voiceStop()
    }
    if (activeArc && next === 'talk') {
      if (activeArc.surface === 'room') {
        // Room's research stays ambient. Returning should not trigger a
        // questionnaire after an experience explicitly designed around ease.
        setConductorReturn('room')
        setReturnedArc(null)
      } else if (activeArc.ambientReturn && activeArc.surface !== 'talk') {
        const returnSurface = activeArc.surface === 'relax' || activeArc.surface === 'drift' ? 'room' : activeArc.surface
        setConductorReturn(returnSurface)
        setReturnedArc(null)
      } else {
        setReturnedArc({ surface: activeArc.surface, outcomeId: activeArc.outcomeId })
      }
      setActiveArc(null)
    }
    setSurface(next)
  }, [surface, commitJournalDraft, voiceHandleStart, voiceState, voiceStop, activeArc, voiceEnabled, roomEnabled])

  const startSurfaceArc = useCallback((next: Exclude<SessionSurface, 'talk'>) => {
    if (!session || isGroundingActive() || isFreshEyesSession(session)) return
    if (next === 'speak' && !voiceEnabled) return
    if (next === 'room' && !roomEnabled) return
    if ((next === 'relax' || next === 'drift') && !roomEnabled) return
    const outcomeId = generateId()
    const now = Date.now()
    const sourceMessage = messagesRef.current.at(-1)
    const conductorArc = sourceMessage?.researchEventId?.startsWith('conductor-') === true
    const existingResearchEventId = sourceMessage?.researchArm === 'offer_journal_arc' || conductorArc
      ? sourceMessage.researchEventId
      : undefined
    const researchEventId = existingResearchEventId ?? `research-arc-${outcomeId}`
    setActiveArc({ surface: next, outcomeId, researchEventId, startedAt: now, ambientReturn: conductorArc })
    void db.interventionOutcomes.add({
      id: outcomeId,
      source: 'talk',
      sourceId: messagesRef.current.at(-1)?.id ?? session.id,
      sessionId: session.id,
      intervention: 'surface_arc',
      researchEventId,
      createdAt: now,
      updatedAt: now,
    })
    if (existingResearchEventId) {
      void db.researchEvents.update(existingResearchEventId, { outcomeId, updatedAt: now })
    } else {
      void db.researchEvents.add({
        id: researchEventId,
        protocolId: 'surface-choreography-v1',
        protocolVersion: 1,
        assignmentKind: 'observational',
        status: 'delivered',
        source: 'talk',
        sessionId: session.id,
        sourceId: sourceMessage?.id ?? session.id,
        eligibilityPoint: 'user-chosen-surface-arc',
        assignmentSeed: outcomeId,
        assignedArm: `${next}_arc`,
        deliveredArm: `${next}_arc`,
        provider: 'deterministic',
        deliveryFidelity: 'deterministic',
        promptVersion: 'personal-science-v1',
        appVersion: '2026-07-10.1',
        outcomeId,
        createdAt: now,
        deliveredAt: now,
        updatedAt: now,
      })
    }
    handleSurfaceChange(next)
  }, [session, handleSurfaceChange, voiceEnabled, roomEnabled])

  // A crisis/grounding transition returns every ambient surface to Talk.
  // Preserve journal words; never show an outcome card for a safety-forced
  // return. Room unmount cleanup stops its mic, voice, sound, and wake lock.
  useEffect(() => {
    if (!grounding) return
    if (!activeArc) {
      if (surface === 'room') setSurface('talk')
      return
    }
    if (activeArc.surface === 'journal') void commitJournalDraft()
    if (activeArc.surface === 'speak' && voiceState !== 'idle') voiceStop()
    void discardSurfaceArcOutcome(activeArc.outcomeId, activeArc.researchEventId)
      .catch(() => { /* research telemetry; the safety return already happened */ })
    setActiveArc(null)
    setReturnedArc(null)
    setSurface('talk')
  }, [grounding, activeArc, commitJournalDraft, voiceState, voiceStop, surface])

  const handleRecommendationTap = useCallback((target: string) => {
    // Links can outlive the flags they were written under (history, a model
    // that ignored the availability list): drop taps on unavailable surfaces.
    if (!canOpenSurface(target, { voiceEnabled, roomEnabled, grounding: isGroundingActive() })) return
    switch (target) {
      case 'real-talk-on':
        void handleRealTalkToggle(true)
        return
      case 'journal':
        handleSurfaceChange('journal')
        return
      case 'speak':
        handleSurfaceChange('speak')
        return
      case 'relax':
        handleSurfaceChange('room')
        return
      case 'journal-arc':
        startSurfaceArc('journal')
        return
      case 'speak-arc':
        startSurfaceArc('speak')
        return
      case 'relax-arc':
        startSurfaceArc('room')
        return
      case 'drift-arc':
        startSurfaceArc('room')
        return
      case 'room':
        handleSurfaceChange('room')
        return
      case 'room-arc':
        startSurfaceArc('room')
        return
      case 'end-session':
        void handleEndSession()
        return
      default:
        console.warn(`[unifiedSession] Unknown recommendation target: "${target}"`)
        return
    }
  }, [handleRealTalkToggle, handleSurfaceChange, startSurfaceArc, handleEndSession, voiceEnabled, roomEnabled])

  // Room shares Speak's companion prompt (one builder): live grounding — never
  // a hardcoded false — plus the same lexicon, HRV and flag gating. Kept
  // synchronous so getUserMedia still runs inside the initiating tap on iOS.
  const buildRoomVoiceInstructions = useCallback((config: RoomConfig): string => {
    const context = contextRef.current
    const currentSession = sessionRef.current
    const { instructions, usedRepair } = buildVoiceCompanionInstructions({
      context,
      session: currentSession,
      messages: messagesRef.current,
      grounded: isGroundingActive(),
      hrvContext: biometricSource.buildPromptContext(),
      features: getGlobalConfig()?.features,
    })
    if (usedRepair) consumeVoiceRepair(context)
    return buildRoomInstructions({
      companionInstructions: instructions,
      approach: config.approach,
      duration: config.duration,
      voiceDensity: config.voiceDensity,
      localVoiceControls: roomVoiceCommandsSupported(getLanguageCode()),
      roomHistory: currentSession?.memoryAperture === 'fresh'
        ? undefined
        : context?.recentRoomSessions.map(room => `${room.approach}, ${room.duration} minutes, ${room.voiceDensity} voice, ${room.audioTrack}; controls used: ${room.commands.join(', ') || 'none'}`),
    })
  }, [biometricSource])

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
        id: 'editor',
        class: 'session-input',
        role: 'textbox',
        'aria-label': 'Session message',
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

  // Folio's "Talk now, bringing this": words the writer chose and saw in
  // Folio are placed in the composer once, unsent (docs/vision/2026-10-15-folio-v4.md §3.9).
  useEffect(() => {
    if (!inputEditor || sessionId) return
    const text = takeHandoff(getAuth().currentUser?.uid)
    if (!text) return
    inputEditor.commands.setContent(text.split(/\n{2,}/).map((p) => ({ type: 'paragraph', content: p ? [{ type: 'text', text: p }] : [] })))
    inputEditor.commands.focus('end')
  }, [inputEditor, sessionId])

  // Keep handleSendRef in sync
  useEffect(() => { handleSendRef.current = () => handleSend(inputEditor) }, [handleSend, inputEditor])

  // Sync InkWeight disabled state. Storage can be undefined in production
  // during transient editor states (Sentry 9b6f8301275743e88045df9cfe2b1965);
  // the TS module augmentation lies about this — runtime can be empty.
  useEffect(() => {
    const ink = inputEditor?.storage.inkWeight
    if (!ink) return
    const vfx = getGlobalConfig()?.features?.visualEffectsEnabled !== false
    ink.disabled = !(vfx && getGlobalConfig()?.features?.inkWeight !== false)
  }, [inputEditor])

  // Clear editor content when streaming starts. TipTap's editor proxy can
  // resolve `commands` to null in transient destroyed/recreating states
  // (Sentry 9b6f8301275743e88045df9cfe2b1965 and 0aac2772978a496086d213c22e58f398).
  useEffect(() => {
    if (isStreaming) inputEditor?.commands?.clearContent()
  }, [isStreaming, inputEditor])

  // Focus editor after streaming completes. The deferred setTimeout makes
  // this even more vulnerable to the same null-commands race — clear on
  // re-run so a stale callback can't fire after the editor is torn down.
  useEffect(() => {
    if (isStreaming || !inputEditor || session?.status === 'closed') return
    const id = setTimeout(() => inputEditor?.commands?.focus(), 50)
    return () => clearTimeout(id)
  }, [isStreaming, inputEditor, session?.status])

  // If voice ends while we're on the Speak surface, return to Talk so the user
  // is not left without input affordances. The guard prevents the effect from
  // re-firing setSurface on unrelated surface transitions.
  useEffect(() => {
    if (surface === 'speak' && voice.state === 'idle') {
      setSurface('talk')
    }
  }, [voice.state, surface])

  // An already-running Room or Speak session belongs to the session it
  // started in. When the selected session changes underneath it (browser
  // history, the sidebar), end it rather than letting it write into the next
  // session. `/session/new` adopting its real id is not a change (null → id).
  const ownerSessionIdRef = useRef<string | null>(null)
  const currentSessionId = session?.id ?? null
  useEffect(() => {
    const previous = ownerSessionIdRef.current
    ownerSessionIdRef.current = currentSessionId
    if (previous === null || currentSessionId === null || previous === currentSessionId) return
    if (voiceState !== 'idle') voiceStop()
    if (surface === 'room' || surface === 'speak') setSurface('talk')
    // An arc that began in the previous session must not surface its return
    // note or outcome card in this one.
    setActiveArc(null)
    setReturnedArc(null)
    setConductorReturn(null)
  }, [currentSessionId, surface, voiceState, voiceStop])

  // Another tab or device may close this session (TECH_ISSUES #15). When the
  // page becomes visible again, re-read the status so the composer does not
  // keep writing into a session that has already been closed elsewhere.
  useEffect(() => {
    const recheck = () => {
      if (document.visibilityState !== 'visible') return
      const current = sessionRef.current
      if (!current || current.status !== 'active') return
      void db.sessions.get(current.id).then(remote => {
        if (remote?.status === 'closed') adoptRemoteClose(current.id, remote)
      }).catch(() => { /* offline: keep the local view */ })
    }
    document.addEventListener('visibilitychange', recheck)
    return () => document.removeEventListener('visibilitychange', recheck)
  }, [adoptRemoteClose])

  const isClosed = session?.status === 'closed'
  const canEnd = !isStreaming && messages.length >= 2 && !isClosed
  const roomOpen = roomEnabled && surface === 'room' && !grounding
  const overlayOpen = roomOpen || voice.state !== 'idle'
  const voiceHandleEnd = voice.handleEnd
  const endVoiceAndReturn = useCallback(() => {
    voiceHandleEnd()
    if (surface === 'speak') handleSurfaceChange('talk')
  }, [voiceHandleEnd, surface, handleSurfaceChange])
  const closeRoom = useCallback(() => handleSurfaceChange('talk'), [handleSurfaceChange])
  // Room transcripts belong to the session the Room started in. The append
  // helpers write into whichever session is current, so a late callback after
  // the route changed must be dropped, never appended to the new session.
  const isRoomOwnerCurrent = useCallback((ownerSessionId: string | null) =>
    ownerSessionId === null || sessionRef.current?.id === ownerSessionId, [])
  const handleRoomUserTranscript = useCallback((text: string, ownerSessionId: string | null) => {
    if (!isRoomOwnerCurrent(ownerSessionId)) return
    void appendUserMessage(text, 'voice', 'room')
  }, [appendUserMessage, isRoomOwnerCurrent])
  const handleRoomAssistantTranscript = useCallback((text: string, ownerSessionId: string | null) => {
    if (!isRoomOwnerCurrent(ownerSessionId)) return
    void appendRealtimeCompanionMessage(text, 'room')
  }, [appendRealtimeCompanionMessage, isRoomOwnerCurrent])

  // `left` intentionally lives in CSS (.session-back-btn) so a media query can
  // shift the button clear of the mobile sidebar hamburger, which occupies the
  // same top-left corner.
  const backButtonStyle = useMemo<React.CSSProperties>(() => ({
    position: 'fixed',
    top: `calc(${biometricsEnabled ? '48px' : '12px'} + env(safe-area-inset-top, 0px))`,
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
  }), [biometricsEnabled])

  const freshEyes = isFreshEyesSession(session)
  const journalPartsOn = session?.journalPartsEnabled !== false && !freshEyes
  const journalScope = journalDraft.scope
  const hasJournalDraft = journalDraft.text.trim() !== ''

  return (
    <>
    {/* Biometrics bar — fixed at top. Driven by whichever source (Polar H10
        or webcam) is currently streaming. */}
    {activeBio && (
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
              latest={activeBio.latestMeasurement}
              measurementCount={activeBio.measurementCount}
              isCalibrating={activeBio.calibrating}
              error={activeBio.error}
              chestScaleGetter={polar.enabled ? polar.getBreathingScale : undefined}
            />
          </div>
          <button
            onClick={activeBio.toggle}
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
    {biometricStartupError && (
      <div
        role="alert"
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          zIndex: 50,
          padding: 'calc(6px + env(safe-area-inset-top, 0px)) 12px 6px',
          background: 'var(--bg-primary, #1a1a1a)',
          borderBottom: '1px solid rgba(178,93,93,0.4)',
        }}
      >
        <div style={{
          maxWidth: 640,
          margin: '0 auto',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontFamily: "'Inter', sans-serif",
          fontSize: 11,
          color: 'var(--text-secondary)',
        }}>
          <span aria-hidden="true">⚠</span>
          <span style={{ flex: 1 }}>{biometricStartupError}</span>
          <button
            onClick={() => { polar.clearError(); hrv.clearError() }}
            aria-label={tr['common.dismiss']}
            style={{
              padding: '2px 8px',
              borderRadius: 6,
              border: '1px solid var(--border-subtle)',
              background: 'transparent',
              color: 'var(--text-secondary)',
              fontSize: 14,
              lineHeight: 1,
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            ×
          </button>
        </div>
      </div>
    )}
    {/* While a full-screen overlay (Room or Speak) is open, the Talk composer
        and controls behind it are inert: not tabbable, not clickable, hidden
        from assistive tech. */}
    <div className="session-container" inert={overlayOpen || undefined}>
      {onBack && (
        <button onClick={onBack} className="session-back-btn" style={backButtonStyle} aria-label="Back">
          ←
        </button>
      )}

      {/* HRV Toggle (inline, non-fixed). Webcam button is hidden when the
          Polar H10 is the active source — H10 takes priority. */}
      {getGlobalConfig()?.features?.webcamHrv === true && !isClosed && !hrv.enabled && !polar.enabled && (
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

      {/* Polar H10 connect — visible only when the flag is on, the browser
          supports Web Bluetooth, and the session is still open. Webcam HRV
          is not active here (mutex above) so this is a clean entry point. */}
      {getGlobalConfig()?.features?.polarH10 === true && !isClosed && !hrv.enabled && (
        <PolarH10ConnectButton
          supported={isWebBluetoothSupported()}
          enabled={polar.enabled}
          status={polar.status}
          deviceName={polar.deviceName}
          onClick={polar.toggle}
        />
      )}

      {/* Mode bar — sticky at top, regardless of which surface
          (Talk/Journal/Speak) is currently selected. Hidden once the
          session is closed. */}
      {!isClosed && (
        <SessionBottomBar
          activeSurface={surface}
          realTalkOn={session?.mode === 'real_talk'}
          journalPartsOn={journalPartsOn}
          showJournalPartsToggle={!freshEyes && globalConfig?.features?.partsEnabled !== false}
          showSpeakSurface={voiceEnabled}
          showRoomSurface={roomEnabled && !grounding}
          onSurfaceChange={handleSurfaceChange}
          onRealTalkToggle={handleRealTalkToggle}
          onJournalPartsToggle={handleJournalPartsToggle}
          memoryAperture={session?.memoryAperture ?? contextRef.current?.memoryAperture ?? 'pattern'}
          memoryApertureLocked={isStreaming || messages.some(message => message.speaker === 'user')}
          onMemoryApertureChange={handleMemoryApertureChange}
        />
      )}

      {/* Journal words that have not reached the conversation. Leaving the
          Journal retries on its own, so the open-session notice stays out of
          the writer's way while they are still writing. */}
      {(isClosed ? hasJournalDraft : journalDraft.failed && surface !== 'journal') && (
        <JournalDraftNotice
          mode={isClosed ? 'closed' : 'failed'}
          text={journalDraft.text}
          sending={journalDraft.sending}
          onRetry={() => { void commitJournalDraft() }}
        />
      )}

      {surface === 'journal' ? (
        <>
          {activeArc?.surface === 'journal' && <SurfaceArcGuide surface="journal" startedAt={activeArc.startedAt} onReturn={() => handleSurfaceChange('talk')} />}
          <SessionJournalSurface
            key={journalScope}
            initialContent={journalDraft.text}
            onChange={text => setJournalText(text, journalScope)}
            partsEnabled={journalPartsOn}
            sessionId={session?.id ?? ''}
          />
        </>
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
              <span style={{ flex: 1 }}>{tr['session.error.therapistUnreachable']} {openerError}</span>
              <button
                onClick={async () => {
                  if (!session) return
                  try {
                    setOpenerError(null)
                    // Retry with current message context — empty for opener,
                    // populated for an empty-completion mid-session.
                    const lastUser = [...messagesRef.current].reverse().find(message => message.speaker === 'user')
                    const pending = lastUser ? await db.researchEvents.get(`research-${lastUser.id}`) : undefined
                    await generateTherapistMessage(
                      messagesRef.current,
                      session,
                      pending?.status === 'assigned' ? assignmentFromEvent(pending) : undefined,
                    )
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
                {tr['session.error.retry']}
              </button>
            </div>
          )}

          {/* Messages list */}
          {session?.status === 'active' && !freshEyes && !grounding && messages.length <= 2 && contextRef.current?.fieldMosaicEnabled !== false && <FieldMosaic sessionId={session.id} disabled={isStreaming} onBringIntoTalk={handleMosaicOpen} />}
          {!freshEyes && !grounding && returnedArc && <SurfaceArcReturn outcomeId={returnedArc.outcomeId} surface={returnedArc.surface} onDone={() => setReturnedArc(null)} />}
          {!freshEyes && !grounding && conductorReturn && (
            <div style={{ margin: '8px 0 20px', padding: '12px 14px', borderLeft: '2px solid var(--accent-warm)', color: 'var(--text-secondary)', font: "italic 15px/1.55 'Cormorant Garamond', serif" }}>
              <span>{tr[`conductor.return.${conductorReturn}` as keyof typeof tr]}</span>
              <button type="button" aria-label={tr['common.dismiss']} onClick={() => setConductorReturn(null)} style={{ float: 'right', border: 0, background: 'transparent', color: 'var(--text-tertiary)', cursor: 'pointer' }}>×</button>
            </div>
          )}
          {messages.map((msg) => (
            <div key={msg.id}>
              <SessionMessageBubble
                message={msg}
                onRecommendationTap={handleRecommendationTap}
                prismSessionId={session?.status === 'active' && !freshEyes && !grounding ? session.id : null}
                conductorOfferSessionId={session?.status === 'active' && !freshEyes && !grounding ? session.id : null}
                intentionOfferSessionId={
                  session?.status === 'active' && !freshEyes && getGlobalConfig()?.features?.sessionIntentions === true
                    ? session.id
                    : null
                }
              />
            </div>
          ))}

          {/* Streaming message */}
          {isStreaming && typewriter.displayedContent && (
            <div style={{ marginBottom: 20, opacity: 0.88 }}>
              <div className="session-message-text" style={{
                color: 'var(--text-secondary)',
                fontStyle: 'italic',
              }}>
                {/* Render the streaming text raw — recommendation links arrive
                    fully-formed from the model, so mid-stream parsing finds
                    nothing useful. SessionMessageBubble handles the parse once
                    the message commits to the messages array. */}
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
        </>
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

      {/* Session note card — under the "session closed" line so it's the last
          thing a closed session shows, where the reader's eye ends up. */}
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
      <div ref={closedNoteEndRef} />

      {/* HRV Consent Dialog (webcam path) */}
      {hrv.showConsent && (
        <HrvConsentDialog
          onAccept={() => {
            hrv.setShowConsent(false)
            hrv.start()
          }}
          onDecline={() => hrv.setShowConsent(false)}
        />
      )}

      {/* Polar H10 Consent Dialog (Bluetooth path) */}
      {polar.showConsent && (
        <PolarH10ConsentDialog
          onAccept={() => {
            polar.setShowConsent(false)
            polar.start()
          }}
          onDecline={() => polar.setShowConsent(false)}
        />
      )}
    </div>

    {/* Voice session overlay — full-screen field visualization. Rendered for
        ANY live voice state (not only when the flag is on): a running mic must
        always have a visible stop control. */}
    {voice.state !== 'idle' && (
      <SurfaceErrorBoundary surface="voice" onExit={endVoiceAndReturn}>
        <Suspense fallback={null}>
          <VoiceField
            state={voice.state}
            error={voice.error}
            muted={voice.muted}
            assistantSpeaking={voice.assistantSpeaking}
            userSpeaking={voice.userSpeaking}
            remoteStream={voice.remoteStream}
            dominantEmotion={weatherEngine.getCurrentDominantEmotion()}
            onToggleMute={voice.toggleMute}
            onEnd={endVoiceAndReturn}
          />
        </Suspense>
      </SurfaceErrorBoundary>
    )}

    {/* Room is the single restorative surface. One score owns its audiovisual
        arc; optional voice is the same organic two-way Realtime companion. */}
    {roomOpen && (
      <SurfaceErrorBoundary surface="room" onExit={closeRoom}>
        <Suspense fallback={null}>
          <RoomField
            parentSessionId={session?.id ?? null}
            memoryAperture={session?.memoryAperture ?? 'pattern'}
            buildInstructions={buildRoomVoiceInstructions}
            voiceAvailable={voiceEnabled}
            rememberedConfig={contextRef.current?.recentRoomSessions[0] ? {
              approach: contextRef.current.recentRoomSessions[0].approach,
              duration: contextRef.current.recentRoomSessions[0].duration,
              voiceDensity: contextRef.current.recentRoomSessions[0].voiceDensity,
              audioTrack: contextRef.current.recentRoomSessions[0].audioTrack,
            } : undefined}
            onUserTranscript={handleRoomUserTranscript}
            onAssistantTranscript={handleRoomAssistantTranscript}
            onClose={closeRoom}
          />
        </Suspense>
      </SurfaceErrorBoundary>
    )}
    </>
  )
}

export default SessionView
