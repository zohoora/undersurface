import { useEffect } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import { InkWeight } from '../../extensions/inkWeight'
import { ParagraphSettle } from '../../extensions/paragraphSettle'
import { useTranslation } from '../../i18n'
import { useGlobalConfig } from '../../store/globalConfig'

interface Props {
  initialContent: string
  onChange: (next: string) => void
}

// Atmospheric journal surface: TipTap-based writing space with the visual
// effects from standalone Journal (ink weight, paragraph settle), but no
// parts engine. Inside a session, the therapist is the one steady voice —
// the page is responsive but doesn't talk back.
export function SessionJournalSurface({ initialContent, onChange }: Props) {
  const tr = useTranslation()
  const globalConfig = useGlobalConfig()

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
    content: initialContent || '',
    autofocus: 'end',
    editorProps: {
      attributes: {
        class: 'tiptap session-journal-editor',
        spellcheck: 'false',
      },
    },
    onUpdate: ({ editor }) => {
      onChange(editor.getText())
    },
  })

  // Sync settings into extensions. TipTap's editor.storage is intentionally
  // mutable — extensions write to it directly. React Compiler can't see
  // through this so we disable its immutability check for the block.
  /* eslint-disable react-hooks/immutability */
  useEffect(() => {
    if (editor) {
      const vfx = globalConfig?.features?.visualEffectsEnabled !== false
      editor.storage.inkWeight.disabled =
        !(vfx && globalConfig?.features?.inkWeight !== false)
      editor.storage.paragraphSettle.disabled =
        !(vfx && globalConfig?.features?.paragraphFade !== false)
      editor.view.dispatch(editor.state.tr)
    }
  }, [editor, globalConfig])
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
