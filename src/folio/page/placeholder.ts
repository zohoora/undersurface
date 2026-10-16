import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

// The blank page's one line (draft 4 §3.12, "Write anything. Select a line to
// lift it."), shown only while the whole page is one empty paragraph. A node
// decoration on that paragraph, drawn by CSS: no text enters the document,
// and an underside (a node view) is never decorated, so none is redrawn.

export function placeholderPlugin(text: string | undefined): Plugin {
  return new Plugin({
    key: new PluginKey('folioPlaceholder'),
    props: {
      decorations(state) {
        const { doc } = state
        const first = doc.firstChild
        if (!text || doc.childCount !== 1 || !first || first.type.name !== 'paragraph' || first.content.size !== 0) return null
        return DecorationSet.create(doc, [Decoration.node(0, first.nodeSize, { class: 'is-editor-empty', 'data-placeholder': text })])
      },
    },
  })
}
