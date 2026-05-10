import { useCallback, useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import { PauseDetector } from '../../engine/pauseDetector'
import { PartOrchestrator } from '../../engine/partOrchestrator'
import { EmergenceEngine } from '../../engine/emergenceEngine'
import { useChatResponse, type UseChatResponse } from '../../hooks/useChatResponse'
import { generateId } from '../../store/db'
import { getPartDisplayName } from '../../i18n'
import type { AppSettings } from '../../store/settings'
import type { EmotionalTone, Part, PartThought } from '../../types'
import type { AutonomicState } from '../../types/hrv'

export interface ActiveThought {
  id: string
  partId: string
  partName: string
  partColor: string
  partColorLight: string
  content: string
  isStreaming: boolean
  isEmerging: boolean
  isVisible: boolean
  isEcho?: boolean
  isSilence?: boolean
  isBlankPage?: boolean
  isQuote?: boolean
  isDisagreement?: boolean
  quotedText?: string
  echoDate?: number
  isReturning?: boolean
}

export interface UseJournalPartsOptions {
  editor: Editor | null
  // Effective on/off — callers should pre-AND any guards (toggle, grounding,
  // global feature flag) before passing in. The hook treats it as the single
  // source of truth for "should the parts pipeline be live right now."
  enabled: boolean
  // Opaque scope identifier passed to PartOrchestrator.setEntryId(). For
  // standalone journal this is the entry id; for in-session journal this is
  // the session id. The orchestrator just persists it as an opaque tag.
  scopeId: string
  settings: AppSettings
  hrvAutonomicState: AutonomicState | null
  onActivePartColorChange?: (color: string | null) => void
  onEmotionChange?: (tone: EmotionalTone) => void
  triggerRipple?: () => void
}

export interface UseJournalPartsReturn {
  thoughts: ActiveThought[]
  // Fade visible non-streaming bubbles when the writer resumes typing.
  // No-op if nothing is visible (returns same array reference, so React
  // bails out of re-render).
  fadeVisibleThoughts: () => void
  handleThoughtClick: (t: ActiveThought) => void
  chat: UseChatResponse
  // No-ops when disabled — safe to wire unconditionally into editor handlers.
  recordKeystroke: (key: string, text: string, pos: number) => void
  updateText: (text: string, pos: number) => void
}

export function useJournalParts(opts: UseJournalPartsOptions): UseJournalPartsReturn {
  const {
    editor,
    enabled,
    scopeId,
    settings,
    hrvAutonomicState,
    onActivePartColorChange,
    onEmotionChange,
    triggerRipple,
  } = opts

  const [thoughts, setThoughts] = useState<ActiveThought[]>([])
  const orchestratorRef = useRef<PartOrchestrator | null>(null)
  const emergenceRef = useRef<EmergenceEngine | null>(null)
  const pauseDetectorRef = useRef<PauseDetector | null>(null)
  const currentThoughtRef = useRef<ActiveThought | null>(null)
  const pendingThoughtUpdateRef = useRef<number | null>(null)
  const emergenceCheckCountRef = useRef(0)

  // Latest-callback refs so the orchestrator's effect doesn't re-init when
  // parent props change identity. Mirrors LivingEditor's pattern.
  const onActivePartColorChangeRef = useRef(onActivePartColorChange)
  const onEmotionChangeRef = useRef(onEmotionChange)
  const triggerRippleRef = useRef(triggerRipple)
  useEffect(() => { onActivePartColorChangeRef.current = onActivePartColorChange }, [onActivePartColorChange])
  useEffect(() => { onEmotionChangeRef.current = onEmotionChange }, [onEmotionChange])
  useEffect(() => { triggerRippleRef.current = triggerRipple }, [triggerRipple])

  const hrvStateRef = useRef<AutonomicState | null>(hrvAutonomicState)
  useEffect(() => {
    hrvStateRef.current = hrvAutonomicState
    orchestratorRef.current?.setHrvState(hrvAutonomicState)
    pauseDetectorRef.current?.setHrvState(hrvAutonomicState)
  }, [hrvAutonomicState])

  const teardown = useCallback(() => {
    pauseDetectorRef.current?.destroy()
    pauseDetectorRef.current = null
    orchestratorRef.current = null
    emergenceRef.current = null
    if (pendingThoughtUpdateRef.current !== null) {
      cancelAnimationFrame(pendingThoughtUpdateRef.current)
      pendingThoughtUpdateRef.current = null
    }
    currentThoughtRef.current = null
    setThoughts([])
    onActivePartColorChangeRef.current?.(null)
  }, [])

  // Initialize / re-initialize engines when (enabled, scopeId) changes.
  // teardown is intentionally NOT called in the body — only in the cleanup
  // closure. That way setState (inside teardown) only fires on the
  // false→true→false transition (when previous cleanup runs), never as an
  // effect-body side effect (which lint flags as cascading-render risk).
  useEffect(() => {
    if (!enabled || !scopeId) return

    const orchestrator = new PartOrchestrator({
      onThoughtStart: (partId, partName, partColor) => {
        const part = orchestrator.getParts().find((p: Part) => p.id === partId)
        const newThought: ActiveThought = {
          id: generateId(),
          partId,
          partName,
          partColor,
          partColorLight: part?.colorLight || partColor + '25',
          content: '',
          isStreaming: true,
          isEmerging: false,
          isVisible: true,
        }
        currentThoughtRef.current = newThought
        onActivePartColorChangeRef.current?.(partColor)
      },
      onThoughtToken: (token) => {
        const current = currentThoughtRef.current
        if (!current) return
        const wasEmpty = current.content.length === 0
        current.content += token

        if (wasEmpty) {
          const snapshot = { ...current }
          setThoughts((prev) => [...prev, snapshot])
        } else {
          if (!pendingThoughtUpdateRef.current) {
            pendingThoughtUpdateRef.current = requestAnimationFrame(() => {
              pendingThoughtUpdateRef.current = null
              const id = current.id
              const content = current.content
              setThoughts((prev) =>
                prev.map((th) => (th.id === id ? { ...th, content } : th)),
              )
            })
          }
        }
      },
      onThoughtComplete: (thought: PartThought) => {
        const current = currentThoughtRef.current
        if (!current) return
        const id = current.id
        currentThoughtRef.current = null
        setThoughts((prev) =>
          prev.map((t) =>
            t.id === id ? { ...t, content: thought.content, isStreaming: false } : t,
          ),
        )
      },
      onEmotionDetected: (tone: EmotionalTone) => {
        onEmotionChangeRef.current?.(tone)
      },
      onError: (error: Error) => {
        console.error('useJournalParts orchestrator error:', error)
        const current = currentThoughtRef.current
        if (current) {
          const id = current.id
          setThoughts((prev) => prev.filter((t) => t.id !== id))
          currentThoughtRef.current = null
        }
        onActivePartColorChangeRef.current?.(null)
      },
      onEcho: (echo) => {
        setThoughts((prev) => [...prev, {
          id: generateId(),
          partId: echo.partId,
          partName: echo.partName,
          partColor: echo.partColor,
          partColorLight: echo.partColorLight,
          content: echo.text,
          isStreaming: false,
          isEmerging: false,
          isVisible: true,
          isEcho: true,
          quotedText: echo.text,
          echoDate: echo.date,
        }])
      },
      onSilence: (partId, partName, partColor, partColorLight) => {
        setThoughts((prev) => [...prev, {
          id: generateId(),
          partId,
          partName,
          partColor,
          partColorLight,
          content: '',
          isStreaming: false,
          isEmerging: false,
          isVisible: true,
          isSilence: true,
        }])
        onActivePartColorChangeRef.current?.(partColor)
      },
      onDisagreementComplete: (thought) => {
        const parts = orchestrator.getParts()
        const part = parts.find((p: Part) => p.id === thought.partId)
        setThoughts((prev) => [...prev, {
          id: thought.id,
          partId: thought.partId,
          partName: part ? getPartDisplayName(part) : 'Unknown',
          partColor: part?.color || '#A09A94',
          partColorLight: part?.colorLight || '#A09A9425',
          content: thought.content,
          isStreaming: false,
          isEmerging: false,
          isVisible: true,
          isDisagreement: true,
        }])
      },
    })

    orchestrator.setEntryId(scopeId)
    orchestrator.setHrvState(hrvStateRef.current)
    void orchestrator.loadParts()
    orchestratorRef.current = orchestrator

    const emergence = new EmergenceEngine()
    emergenceRef.current = emergence

    const pauseDetector = new PauseDetector(async (event) => {
      triggerRippleRef.current?.()
      await orchestrator.handlePause(event)

      emergenceCheckCountRef.current++
      if (emergenceCheckCountRef.current % 3 === 0) {
        const parts = [...orchestrator.getParts()]
        const result = await emergence.checkForEmergence(event.currentText, parts)
        if (result.detected && result.part && result.firstWords) {
          orchestrator.addPart(result.part)
          setThoughts((prev) => [...prev, {
            id: generateId(),
            partId: result.part!.id,
            partName: getPartDisplayName(result.part!),
            partColor: result.part!.color,
            partColorLight: result.part!.colorLight,
            content: result.firstWords!,
            isStreaming: false,
            isEmerging: true,
            isVisible: true,
          }])
        }
      }
    })

    pauseDetector.setHrvState(hrvStateRef.current)
    pauseDetectorRef.current = pauseDetector

    return () => {
      teardown()
    }
  }, [enabled, scopeId, teardown])

  const recordKeystroke = useCallback((key: string, text: string, pos: number) => {
    pauseDetectorRef.current?.recordKeystroke(key, text, pos)
  }, [])

  const updateText = useCallback((text: string, pos: number) => {
    pauseDetectorRef.current?.updateText(text, pos)
  }, [])

  const fadeVisibleThoughts = useCallback(() => {
    setThoughts((prev) => {
      const hasVisible = prev.some((t) => t.isVisible && !t.isStreaming)
      if (!hasVisible) return prev
      return prev.map((t) => (t.isStreaming ? t : { ...t, isVisible: false }))
    })
  }, [])

  const chat = useChatResponse({
    entryId: scopeId,
    editor,
    settings,
    orchestratorRef,
    pauseDetectorRef,
    onPartColorChange: onActivePartColorChange ?? (() => {}),
    // Session journal v1: no color-bleed extension to feed.
    onReplyComplete: () => {},
  })

  const handleThoughtClick = useCallback(
    (thought: ActiveThought) => {
      if (chat.openInteraction(thought)) {
        setThoughts((prev) =>
          prev.map((t) => (t.id === thought.id ? { ...t, isVisible: false } : t)),
        )
      }
    },
    [chat],
  )

  return {
    thoughts,
    fadeVisibleThoughts,
    handleThoughtClick,
    chat,
    recordKeystroke,
    updateText,
  }
}
