import { useEffect, useRef } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import { InkWeight } from '../../extensions/inkWeight'
import { ParagraphSettle } from '../../extensions/paragraphSettle'
import { TypewriterScroll } from '../../extensions/typewriterScroll'
import { useTranslation } from '../../i18n'
import { useGlobalConfig } from '../../store/globalConfig'

interface Props {
  value: string
  onChange: (next: string) => void
}

// Atmospheric journal surface: TipTap-based writing space with the visual
// effects from standalone Journal (ink weight, paragraph settle, typewriter
// scroll), but no parts engine. Inside a session, the therapist is the one
// steady voice — the page is responsive but doesn't talk back.
export function SessionJournalSurface({ value, onChange }: Props) {
  const tr = useTranslation()
  const globalConfig = useGlobalConfig()
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

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
      TypewriterScroll,
    ],
    content: value || '',
    autofocus: 'end',
    editorProps: {
      attributes: {
        class: 'tiptap session-journal-editor',
        spellcheck: 'false',
      },
    },
    onUpdate: ({ editor }) => {
      onChangeRef.current(editor.getText())
    },
  })

  // Wire visual-effect flags to editor storage. Same pattern as LivingEditor:
  // toggling storage.disabled is reactive without rebuilding the editor. The
  // immutability disable matches LivingEditor — TipTap's storage is designed
  // to be mutated; the React-hooks rule can't see through the abstraction.
  /* eslint-disable react-hooks/immutability */
  useEffect(() => {
    if (!editor) return
    const vfx = globalConfig?.features?.visualEffectsEnabled !== false
    editor.storage.inkWeight.disabled =
      !(vfx && globalConfig?.features?.inkWeight !== false)
    editor.storage.paragraphSettle.disabled =
      !(vfx && globalConfig?.features?.paragraphFade !== false)
  }, [editor, globalConfig?.features?.visualEffectsEnabled,
      globalConfig?.features?.inkWeight, globalConfig?.features?.paragraphFade])
  /* eslint-enable react-hooks/immutability */

  return (
    <div className="session-journal-surface">
      <div className="session-journal-presence">
        <div className="session-journal-presence__dot" />
        <span>{tr['session.journal.presence']}</span>
      </div>
      <EditorContent editor={editor} />
    </div>
  )
}
