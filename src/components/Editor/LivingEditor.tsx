import { useEffect, useRef, useCallback, useState } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import { InkWeight } from '../../extensions/inkWeight'
import { ParagraphSettle } from '../../extensions/paragraphSettle'
import { MarginTraces, marginTracesKey } from '../../extensions/marginTraces'
import { ColorBleed, colorBleedKey } from '../../extensions/colorBleed'
import { TypewriterScroll } from '../../extensions/typewriterScroll'
import { spellEngine } from '../../engine/spellEngine'
import { PauseDetector } from '../../engine/pauseDetector'
import { PartOrchestrator } from '../../engine/partOrchestrator'
import { EmergenceEngine } from '../../engine/emergenceEngine'
import type { AppSettings } from '../../store/settings'
import { PartThoughtBubble } from './PartThoughtBubble'
import { ThinkingSpace } from '../ThinkingOutLoud/ThinkingSpace'
import { PauseRipple } from '../Atmosphere/PauseRipple'
import { usePauseRipple } from '../Atmosphere/usePauseRipple'
import { buildInteractionReply } from '../../ai/partPrompts'
import { streamChatCompletion } from '../../ai/openrouter'
import { db, generateId } from '../../store/db'
import type { EmotionalTone, Part, PartThought } from '../../types'

interface ActiveThought {
  id: string
  partId: string
  partName: string
  partColor: string
  partColorLight: string
  content: string
  isStreaming: boolean
  isEmerging: boolean
  isVisible: boolean
}

interface ActiveInteraction {
  thoughtId: string
  partId: string
  partName: string
  partColor: string
  partColorLight: string
  initialThought: string
  partReply: string | null
  isReplyStreaming: boolean
}

interface Props {
  entryId: string
  initialContent: string
  onContentChange: (content: string, plainText: string) => void
  onEmotionChange: (emotion: EmotionalTone) => void
  onActivePartColorChange: (color: string | null) => void
  settings: AppSettings
}

export function LivingEditor({
  entryId,
  initialContent,
  onContentChange,
  onEmotionChange,
  onActivePartColorChange,
  settings,
}: Props) {
  const pauseDetectorRef = useRef<PauseDetector | null>(null)
  const orchestratorRef = useRef<PartOrchestrator | null>(null)
  const emergenceRef = useRef<EmergenceEngine | null>(null)
  const [thoughts, setThoughts] = useState<ActiveThought[]>([])
  const [activeInteraction, setActiveInteraction] = useState<ActiveInteraction | null>(null)
  const { ripples, addRipple } = usePauseRipple()
  const currentThoughtRef = useRef<ActiveThought | null>(null)
  const emergenceCheckCountRef = useRef(0)
  const pendingBleedColorRef = useRef<string | null>(null)

  // Typing intensity tracking (for breathing sync)
  const lastKeystrokeTimeRef = useRef(0)
  const typingEnergyRef = useRef(0)
  const breathRafRef = useRef<number>(0)

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        codeBlock: false,
        blockquote: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
        horizontalRule: false,
      }),
      Placeholder.configure({
        placeholder: 'Begin writing...',
      }),
      InkWeight,
      ParagraphSettle,
      MarginTraces,
      ColorBleed,
      TypewriterScroll,
    ],
    content: initialContent || '',
    editorProps: {
      attributes: {
        class: 'tiptap',
        spellcheck: 'false',
      },
      handleKeyDown: (_view, event) => {
        if (event.metaKey || event.ctrlKey || event.altKey) return false
        if (event.key.length === 1 || event.key === 'Backspace' || event.key === 'Delete' || event.key === 'Enter') {
          const text = editor?.getText() || ''
          const pos = editor?.state.selection.from || 0
          pauseDetectorRef.current?.recordKeystroke(event.key, text, pos)

          // Track typing intensity for breathing sync
          // eslint-disable-next-line react-hooks/purity -- Date.now() is in an event handler, not during render
          const now = Date.now()
          const interval = now - lastKeystrokeTimeRef.current
          lastKeystrokeTimeRef.current = now
          const rawIntensity = Math.min(1, Math.max(0, 1 - (interval - 50) / 400))
          typingEnergyRef.current = typingEnergyRef.current * 0.7 + rawIntensity * 0.3

          // Fade out visible thoughts and close interactions when typing resumes
          setThoughts((prev) => {
            const hasVisible = prev.some((t) => t.isVisible && !t.isStreaming)
            if (!hasVisible) return prev
            return prev.map((t) => (t.isStreaming ? t : { ...t, isVisible: false }))
          })
          setActiveInteraction((prev) => {
            if (!prev) return prev
            if (prev.isReplyStreaming) return prev
            return null
          })
          pauseDetectorRef.current?.resume()

          // Activate color bleed if a part just spoke
          const bleedColor = pendingBleedColorRef.current
          if (bleedColor && editor) {
            const tr = editor.state.tr.setMeta(colorBleedKey, { color: bleedColor })
            editor.view.dispatch(tr)
            pendingBleedColorRef.current = null
          }

          // Clear active part color when typing
          onActivePartColorChange(null)

          // Auto-capitalize
          if (settings.autoCapitalize && editor && event.key.length === 1) {
            const from = editor.state.selection.from
            const parentOffset = editor.state.selection.$from.parentOffset

            // Capitalize first letter at start of paragraph or after sentence endings
            if (/[a-z]/.test(event.key)) {
              const shouldCapitalize = parentOffset === 0
                || /[.!?]\s$/.test(editor.state.doc.textBetween(Math.max(0, from - 3), from))

              if (shouldCapitalize) {
                event.preventDefault()
                editor.commands.insertContent(event.key.toUpperCase())
                return true
              }
            }

            // Fix standalone "i" to "I" when followed by space/punctuation
            if (/[\s,.'!?;:]/.test(event.key) && from >= 1) {
              const lookback = editor.state.doc.textBetween(Math.max(0, from - 2), from)
              if (/(?:^|\s)i$/.test(lookback)) {
                editor.view.dispatch(
                  editor.state.tr.replaceWith(from - 1, from, editor.state.schema.text('I'))
                )
              }
            }
          }

          // Autocorrect on word boundary
          if (settings.autocorrect && editor && /[\s,.'!?;:\-)]/.test(event.key)) {
            const $pos = editor.state.selection.$from
            const textBefore = $pos.parent.textBetween(0, $pos.parentOffset)
            const match = textBefore.match(/([a-zA-Z']+)$/)
            if (match) {
              const word = match[1]
              const isSentenceStart = match.index === 0
                || /[.!?]\s+$/.test(textBefore.slice(0, match.index))
              const correction = spellEngine.suggest(word, isSentenceStart)
              if (correction) {
                const absOffset = $pos.start() + $pos.parentOffset
                const wordStart = absOffset - word.length
                const capturedEditor = editor
                queueMicrotask(() => {
                  const currentState = capturedEditor.state
                  if (currentState.doc.textBetween(wordStart, absOffset) === word) {
                    capturedEditor.view.dispatch(
                      currentState.tr.replaceWith(
                        wordStart,
                        absOffset,
                        currentState.schema.text(correction),
                      ),
                    )
                  }
                })
              }
            }
          }
        }
        return false
      },
    },
    onUpdate: ({ editor }) => {
      const html = editor.getHTML()
      const text = editor.getText()
      onContentChange(html, text)
      pauseDetectorRef.current?.updateText(text, editor.state.selection.from)
    },
  })

  // Breathing sync: rAF loop to update .typing-breath element
  useEffect(() => {
    const updateBreath = () => {
      // Decay energy when not typing
      typingEnergyRef.current *= 0.97
      if (typingEnergyRef.current < 0.01) typingEnergyRef.current = 0

      const energy = typingEnergyRef.current
      const el = document.querySelector('.typing-breath') as HTMLElement
      if (el) {
        el.style.transform = `scale(${1 + energy * 0.06})`
        el.style.opacity = String(0.15 + energy * 0.6)
      }

      breathRafRef.current = requestAnimationFrame(updateBreath)
    }

    breathRafRef.current = requestAnimationFrame(updateBreath)
    return () => cancelAnimationFrame(breathRafRef.current)
  }, [])

  // Sync settings into extensions and pause detector
  useEffect(() => {
    if (editor) {
      editor.storage.inkWeight.disabled = !settings.inkWeight
      editor.storage.paragraphSettle.disabled = !settings.paragraphFade
      editor.storage.colorBleed.disabled = !settings.colorBleed
      editor.storage.typewriterScroll.mode = settings.typewriterScroll
      // Force decoration refresh
      editor.view.dispatch(editor.state.tr)
    }
    pauseDetectorRef.current?.setSpeedMultiplier(settings.responseSpeed)
  }, [editor, settings.inkWeight, settings.paragraphFade, settings.colorBleed, settings.typewriterScroll, settings.responseSpeed])

  // Clean up faded thoughts periodically
  useEffect(() => {
    const interval = setInterval(() => {
      setThoughts((prev) => prev.filter((t) => t.isVisible || t.isStreaming))
    }, 2000)
    return () => clearInterval(interval)
  }, [])

  // Trigger ripple at cursor position
  const triggerRipple = useCallback(() => {
    if (!editor) return
    try {
      const coords = editor.view.coordsAtPos(editor.state.selection.from)
      const container = editor.view.dom.closest('.editor-container')
      if (!container) return
      const rect = container.getBoundingClientRect()
      addRipple({
        id: Date.now(),
        x: coords.left - rect.left,
        y: coords.top - rect.top,
      })
    } catch {
      // Position might be invalid
    }
  }, [editor, addRipple])

  // Add margin trace at current cursor position
  const addMarginTrace = useCallback(
    (color: string) => {
      if (!editor) return
      const tr = editor.state.tr.setMeta(marginTracesKey, {
        action: 'add',
        pos: editor.state.selection.from,
        color,
      })
      editor.view.dispatch(tr)
    },
    [editor],
  )

  // Initialize engines
  useEffect(() => {
    const orchestrator = new PartOrchestrator({
      onThoughtStart: (partId, partName, partColor) => {
        const part = orchestrator['parts'].find((p: Part) => p.id === partId)
        const newThought: ActiveThought = {
          id: generateId(),
          partId,
          partName,
          partColor,
          partColorLight: part?.colorLight || partColor + '20',
          content: '',
          isStreaming: true,
          isEmerging: false,
          isVisible: true,
        }
        currentThoughtRef.current = newThought
        setThoughts((prev) => [...prev, newThought])

        // Cursor glow absorbs part color
        onActivePartColorChange(partColor)

        // Add margin trace
        addMarginTrace(partColor)
      },
      onThoughtToken: (token) => {
        const current = currentThoughtRef.current
        if (!current) return
        current.content += token
        const id = current.id
        const content = current.content
        setThoughts((prev) =>
          prev.map((t) => (t.id === id ? { ...t, content } : t)),
        )
      },
      onThoughtComplete: (thought: PartThought) => {
        const current = currentThoughtRef.current
        if (!current) return
        const id = current.id
        pendingBleedColorRef.current = current.partColor
        currentThoughtRef.current = null
        setThoughts((prev) =>
          prev.map((t) =>
            t.id === id ? { ...t, content: thought.content, isStreaming: false } : t,
          ),
        )
      },
      onEmotionDetected: (tone: EmotionalTone) => {
        onEmotionChange(tone)
      },
      onError: (error: Error) => {
        console.error('Orchestrator error:', error)
        const current = currentThoughtRef.current
        if (current) {
          const id = current.id
          setThoughts((prev) => prev.filter((t) => t.id !== id))
          currentThoughtRef.current = null
        }
        onActivePartColorChange(null)
      },
    })

    orchestrator.setEntryId(entryId)
    orchestrator.loadParts()
    orchestratorRef.current = orchestrator

    const emergence = new EmergenceEngine()
    emergenceRef.current = emergence

    const pauseDetector = new PauseDetector(async (event) => {
      // Trigger ripple on pause detection (before thought appears)
      triggerRipple()

      await orchestrator.handlePause(event)

      emergenceCheckCountRef.current++
      if (emergenceCheckCountRef.current % 3 === 0) {
        const parts = orchestrator['parts'] as Part[]
        const result = await emergence.checkForEmergence(event.currentText, parts)
        if (result.detected && result.part && result.firstWords) {
          orchestrator['parts'].push(result.part)

          const newThought: ActiveThought = {
            id: generateId(),
            partId: result.part.id,
            partName: result.part.name,
            partColor: result.part.color,
            partColorLight: result.part.colorLight,
            content: result.firstWords,
            isStreaming: false,
            isEmerging: true,
            isVisible: true,
          }
          setThoughts((prev) => [...prev, newThought])

          // Margin trace for emerged part too
          addMarginTrace(result.part.color)
        }
      }
    })

    pauseDetectorRef.current = pauseDetector

    return () => {
      pauseDetector.destroy()
    }
  }, [entryId, onEmotionChange, onActivePartColorChange, triggerRipple, addMarginTrace])

  const handleThoughtClick = useCallback(
    (thought: ActiveThought) => {
      if (thought.isStreaming) return
      if (activeInteraction) return

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

      setThoughts((prev) =>
        prev.map((t) => (t.id === thought.id ? { ...t, isVisible: false } : t)),
      )
    },
    [activeInteraction],
  )

  const handleUserResponse = useCallback(
    async (response: string) => {
      if (!activeInteraction) return

      const parts = orchestratorRef.current?.['parts'] as Part[]
      const part = parts?.find((p) => p.id === activeInteraction.partId)
      if (!part) return

      const text = editor?.getText() || ''

      const interactionId = generateId()
      await db.interactions.add({
        id: interactionId,
        thoughtId: activeInteraction.thoughtId,
        partId: activeInteraction.partId,
        entryId: entryId,
        partOpening: activeInteraction.initialThought,
        userResponse: response,
        partReply: null,
        status: 'user_responded',
        timestamp: Date.now(),
      })

      setActiveInteraction((prev) =>
        prev ? { ...prev, isReplyStreaming: true } : null,
      )

      const messages = buildInteractionReply(
        part,
        activeInteraction.initialThought,
        response,
        text,
      )

      let replyText = ''

      await streamChatCompletion(
        messages,
        {
          onToken: (token) => {
            replyText += token
            setActiveInteraction((prev) =>
              prev ? { ...prev, partReply: replyText } : null,
            )
          },
          onComplete: async (fullReply) => {
            setActiveInteraction((prev) =>
              prev ? { ...prev, partReply: fullReply, isReplyStreaming: false } : null,
            )
            pendingBleedColorRef.current = activeInteraction.partColor

            await db.interactions.update(interactionId, {
              partReply: fullReply,
              status: 'complete',
            })

            await db.memories.add({
              id: generateId(),
              partId: activeInteraction.partId,
              entryId: entryId,
              content: `Writer said: "${response}" → You replied: "${fullReply}"`,
              type: 'interaction',
              timestamp: Date.now(),
            })
          },
          onError: (error) => {
            console.error('Reply error:', error)
            setActiveInteraction((prev) =>
              prev ? { ...prev, isReplyStreaming: false } : null,
            )
          },
        },
        150,
      )
    },
    [activeInteraction, editor, entryId],
  )

  const handleCloseInteraction = useCallback(() => {
    setActiveInteraction(null)
    pauseDetectorRef.current?.resume()
    onActivePartColorChange(null)
    setTimeout(() => editor?.commands.focus(), 100)
  }, [editor, onActivePartColorChange])

  return (
    <div className={`editor-container${settings.typewriterScroll === 'typewriter' ? ' typewriter-active' : ''}`} id="editor">
      <EditorContent editor={editor} />

      <PauseRipple ripples={ripples} />

      {/* Announce part thoughts to screen readers */}
      <div aria-live="polite" className="sr-only">
        {thoughts.filter((t) => t.isVisible && !t.isStreaming).map((t) => (
          <span key={t.id}>{t.partName} says: {t.content}</span>
        ))}
      </div>

      <div style={{ position: 'relative' }}>
        {thoughts.map((thought) => (
          <PartThoughtBubble
            key={thought.id}
            partName={thought.partName}
            partColor={thought.partColor}
            colorLight={thought.partColorLight}
            content={thought.content}
            isStreaming={thought.isStreaming}
            isEmerging={thought.isEmerging}
            isVisible={thought.isVisible}
            onClick={() => handleThoughtClick(thought)}
          />
        ))}

        {activeInteraction && (
          <ThinkingSpace
            partName={activeInteraction.partName}
            partColor={activeInteraction.partColor}
            colorLight={activeInteraction.partColorLight}
            initialThought={activeInteraction.initialThought}
            isOpen={true}
            onSubmitResponse={handleUserResponse}
            partReply={activeInteraction.partReply}
            isReplyStreaming={activeInteraction.isReplyStreaming}
            onClose={handleCloseInteraction}
          />
        )}
      </div>
    </div>
  )
}
