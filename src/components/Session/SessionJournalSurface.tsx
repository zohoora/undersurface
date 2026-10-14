import { useCallback, useEffect } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import { InkWeight } from '../../extensions/inkWeight'
import { ParagraphSettle } from '../../extensions/paragraphSettle'
import { useTranslation } from '../../i18n'
import { useGlobalConfig } from '../../store/globalConfig'
import { useSettings } from '../../store/settings'
import { useGroundingMode } from '../../hooks/useGroundingMode'
import { useJournalParts, type ActiveThought } from '../Editor/useJournalParts'
import { PartThoughtBubble } from '../Editor/PartThoughtBubble'
import { ThinkingSpace } from '../ThinkingOutLoud/ThinkingSpace'
import { PauseRipple } from '../Atmosphere/PauseRipple'
import { triggerRippleAtCursor, usePauseRipple } from '../Atmosphere/usePauseRipple'
import { journalDraftToDoc } from '../../store/journalDrafts'

interface Props {
  // The session's saved draft (plain text). Read once when the editor is
  // created; the parent remounts this surface when the draft's owner changes.
  initialContent: string
  onChange: (next: string) => void
  // Per-session toggle from the mode bar. When false the parts pipeline is
  // never wired in. When true the hook still defers to grounding state and
  // the global partsEnabled flag before activating.
  partsEnabled: boolean
  // Opaque scope id passed to PartOrchestrator.setEntryId — the session id
  // when running in-session. Empty string skips engine init (the hook treats
  // an empty scopeId as not-ready).
  sessionId: string
  onActivePartColorChange?: (color: string | null) => void
}

// Atmospheric journal surface inside a Session. By default the page is quiet
// and the therapist is the one steady voice. When the user turns on the
// "Inner voices" toggle in the mode bar, parts respond on pause — same
// pipeline used by the standalone journal at /, gated behind `partsEnabled`
// and the session-level grounding override (parts silence during distress,
// no exceptions).
export function SessionJournalSurface({
  initialContent,
  onChange,
  partsEnabled,
  sessionId,
  onActivePartColorChange,
}: Props) {
  const tr = useTranslation()
  const globalConfig = useGlobalConfig()
  const settings = useSettings()
  const isGrounding = useGroundingMode()
  const { ripples, addRipple } = usePauseRipple()

  // Effective gate: opt-in toggle AND not-in-distress AND admin hasn't
  // disabled parts globally. Mirrors the load-bearing Real Talk grounding
  // override — distress + inner-voice cacophony is the wrong combination.
  const effectivelyEnabled =
    partsEnabled &&
    !isGrounding &&
    globalConfig?.features?.partsEnabled !== false

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
        placeholder: () => tr['session.journal.placeholder'],
      }),
      InkWeight,
      ParagraphSettle,
    ],
    content: initialContent ? journalDraftToDoc(initialContent) : '',
    autofocus: 'end',
    editorProps: {
      attributes: {
        class: 'tiptap session-journal-editor',
        spellcheck: 'false',
      },
      // Closures capture recordKeystroke / fadeVisibleThoughts at first
      // render; both are stable across renders (useCallback [] + useState
      // setter), so re-binding via refs would be cargo-culting.
      handleKeyDown: (_view, event) => {
        if (event.metaKey || event.ctrlKey || event.altKey) return false
        // Only printable keys + edits + Enter advance the cadence model.
        if (
          event.key.length === 1 ||
          event.key === 'Backspace' ||
          event.key === 'Delete' ||
          event.key === 'Enter'
        ) {
          const text = editor?.getText() || ''
          const pos = editor?.state.selection.from || 0
          recordKeystroke(event.key, text, pos)
          fadeVisibleThoughts()
        }
        return false
      },
    },
    onUpdate: ({ editor }) => {
      const text = editor.getText()
      onChange(text)
      updateText(text, editor.state.selection.from)
    },
  })

  const triggerRipple = useCallback(
    () => triggerRippleAtCursor(editor, '.session-journal-surface', addRipple),
    [editor, addRipple],
  )

  const {
    thoughts,
    fadeVisibleThoughts,
    handleThoughtClick,
    chat,
    recordKeystroke,
    updateText,
  } = useJournalParts({
    editor,
    enabled: effectivelyEnabled,
    scopeId: sessionId,
    settings,
    hrvAutonomicState: null,
    onActivePartColorChange,
    triggerRipple,
  })

  /* eslint-disable react-hooks/immutability */
  useEffect(() => {
    if (!editor) return
    // Storage entries can be undefined in transient editor states; the TS
    // module augmentation does not reflect that runtime gap.
    const ink = editor.storage.inkWeight
    const settle = editor.storage.paragraphSettle
    if (!ink || !settle) return
    const vfx = globalConfig?.features?.visualEffectsEnabled !== false
    ink.disabled = !(vfx && globalConfig?.features?.inkWeight !== false)
    settle.disabled = !(vfx && globalConfig?.features?.paragraphFade !== false)
    editor.view.dispatch(editor.state.tr)
  }, [editor, globalConfig])
  /* eslint-enable react-hooks/immutability */

  return (
    <div className="session-journal-surface">
      <div className="session-journal-presence">
        <div className="session-journal-presence__dot" />
        <span>{tr['session.journal.presence']}</span>
      </div>
      <EditorContent editor={editor} />

      <PauseRipple ripples={ripples} />

      <div aria-live="polite" className="sr-only">
        {thoughts.filter((t) => t.isVisible && !t.isStreaming).map((t: ActiveThought) => (
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
            exitInstant={chat.activeInteraction?.thoughtId === thought.id}
            onClick={() => handleThoughtClick(thought)}
            isEcho={thought.isEcho}
            isSilence={thought.isSilence}
            isQuote={thought.isQuote}
            isDisagreement={thought.isDisagreement}
            quotedText={thought.quotedText}
            echoDate={thought.echoDate}
            isReturning={thought.isReturning}
          />
        ))}

        {chat.activeInteraction && (
          <ThinkingSpace
            partName={chat.activeInteraction.partName}
            partColor={chat.activeInteraction.partColor}
            colorLight={chat.activeInteraction.partColorLight}
            initialThought={chat.activeInteraction.initialThought}
            isOpen={true}
            onSubmitResponse={chat.sendUserResponse}
            partReply={chat.activeInteraction.partReply}
            isReplyStreaming={chat.activeInteraction.isReplyStreaming}
            onClose={chat.closeInteraction}
          />
        )}
      </div>
    </div>
  )
}
