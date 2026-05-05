import { useCallback, useState, type RefObject } from 'react'
import type { Editor } from '@tiptap/react'
import { buildInteractionReply } from '../ai/partPrompts'
import { reasoningForSpeed, streamChatCompletion } from '../ai/openrouter'
import { db, generateId } from '../store/db'
import { isGroundingActive } from '../store/groundingState'
import { trackEvent } from '../services/analytics'
import type { PartOrchestrator } from '../engine/partOrchestrator'
import type { PauseDetector } from '../engine/pauseDetector'
import type { AppSettings } from '../store/settings'

export interface ActiveInteraction {
  thoughtId: string
  partId: string
  partName: string
  partColor: string
  partColorLight: string
  initialThought: string
  partReply: string | null
  isReplyStreaming: boolean
}

export interface ThoughtToOpen {
  id: string
  partId: string
  partName: string
  partColor: string
  partColorLight: string
  content: string
  isStreaming: boolean
}

interface UseChatResponseOptions {
  entryId: string
  editor: Editor | null
  settings: AppSettings
  orchestratorRef: RefObject<PartOrchestrator | null>
  pauseDetectorRef: RefObject<PauseDetector | null>
  /** Called when the panel closes; parent clears bleed/active-part color. */
  onClearPartColor: () => void
  /**
   * Fired once the streamed reply has finalized. Parent owns the bleed-color
   * queue (see pendingBleedColorRef in LivingEditor) and decides what to do
   * with the color — typically queueing it for the next ProseMirror tick.
   */
  onReplyComplete: (partColor: string) => void
}

export interface UseChatResponse {
  activeInteraction: ActiveInteraction | null
  /** Returns true if the panel opened, false if rejected. */
  openInteraction: (thought: ThoughtToOpen) => boolean
  sendUserResponse: (response: string) => Promise<void>
  closeInteraction: () => void
  /**
   * Soft-dismiss the panel when the user starts typing again. Keeps the panel
   * open if a reply is mid-stream. Unlike closeInteraction, this does not run
   * cleanup (resume pause detector, clear part color, refocus) — the editor's
   * keydown path already handles that.
   */
  dismissIfIdle: () => void
}

export function useChatResponse(opts: UseChatResponseOptions): UseChatResponse {
  const {
    entryId,
    editor,
    settings,
    orchestratorRef,
    pauseDetectorRef,
    onClearPartColor,
    onReplyComplete,
  } = opts

  const [activeInteraction, setActiveInteraction] = useState<ActiveInteraction | null>(null)

  const openInteraction = useCallback<UseChatResponse['openInteraction']>(
    (thought) => {
      if (thought.isStreaming) return false
      if (activeInteraction) return false

      pauseDetectorRef.current?.suppress()
      setActiveInteraction({
        thoughtId: thought.id,
        partId: thought.partId,
        partName: thought.partName,
        partColor: thought.partColor,
        partColorLight: thought.partColorLight,
        initialThought: thought.content,
        partReply: null,
        isReplyStreaming: false,
      })
      return true
    },
    [activeInteraction, pauseDetectorRef],
  )

  const closeInteraction = useCallback(() => {
    setActiveInteraction(null)
    pauseDetectorRef.current?.resume()
    onClearPartColor()
    setTimeout(() => editor?.commands.focus(), 100)
  }, [editor, onClearPartColor, pauseDetectorRef])

  const dismissIfIdle = useCallback(() => {
    setActiveInteraction((prev) => {
      if (!prev) return prev
      if (prev.isReplyStreaming) return prev
      return null
    })
  }, [])

  const sendUserResponse = useCallback(
    async (response: string) => {
      if (!activeInteraction) return

      const part = orchestratorRef.current?.getParts().find((p) => p.id === activeInteraction.partId)
      if (!part) return

      const text = editor?.getText() || ''
      trackEvent('thinking_out_loud', { part_name: activeInteraction.partName, status: 'user_responded' })

      const interactionId = generateId()
      await db.interactions.add({
        id: interactionId,
        thoughtId: activeInteraction.thoughtId,
        partId: activeInteraction.partId,
        entryId,
        partOpening: activeInteraction.initialThought,
        userResponse: response,
        partReply: null,
        status: 'user_responded',
        timestamp: Date.now(),
      })

      setActiveInteraction((prev) => (prev ? { ...prev, isReplyStreaming: true } : null))

      const messages = buildInteractionReply(
        part,
        activeInteraction.initialThought,
        response,
        text,
        { isGrounding: isGroundingActive() },
      )

      let replyText = ''

      await streamChatCompletion(
        messages,
        {
          onToken: (token) => {
            replyText += token
            setActiveInteraction((prev) => (prev ? { ...prev, partReply: replyText } : null))
          },
          onComplete: async (fullReply) => {
            setActiveInteraction((prev) =>
              prev ? { ...prev, partReply: fullReply, isReplyStreaming: false } : null,
            )
            onReplyComplete(activeInteraction.partColor)

            await db.interactions.update(interactionId, {
              partReply: fullReply,
              status: 'complete',
            })

            await db.memories.add({
              id: generateId(),
              partId: activeInteraction.partId,
              entryId,
              content: `Writer said: "${response}" → You replied: "${fullReply}"`,
              type: 'interaction',
              timestamp: Date.now(),
            })
          },
          onError: (error) => {
            console.error('useChatResponse: reply error', error)
            setActiveInteraction((prev) => (prev ? { ...prev, isReplyStreaming: false } : null))
          },
        },
        150,
        reasoningForSpeed(settings.responseSpeed),
      )
    },
    [activeInteraction, editor, entryId, settings.responseSpeed, orchestratorRef, onReplyComplete],
  )

  return { activeInteraction, openInteraction, sendUserResponse, closeInteraction, dismissIfIdle }
}
