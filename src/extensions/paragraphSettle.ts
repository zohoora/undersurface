import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

const paragraphSettleKey = new PluginKey('paragraphSettle')

export const ParagraphSettle = Extension.create({
  name: 'paragraphSettle',

  addOptions() {
    // Folio sets this so paragraphs in a between or a beneath settle too;
    // Sessions keeps the default (top-level paragraphs only).
    return { descend: false }
  },

  addStorage() {
    return { disabled: false }
  },

  addProseMirrorPlugins() {
    const storage = this.storage
    const descend = this.options.descend

    return [
      new Plugin({
        key: paragraphSettleKey,
        props: {
          decorations(state) {
            if (storage.disabled) return DecorationSet.empty

            const { doc, selection } = state
            const cursorPos = selection.from
            const decorations: Decoration[] = []

            const settle = (node: { type: { name: string }; nodeSize: number; textContent: string }, offset: number) => {
              if (node.type.name !== 'paragraph') return
              const from = offset
              const to = offset + node.nodeSize
              const isCurrent = cursorPos >= from && cursorPos <= to
              if (!isCurrent && node.textContent.length > 0) {
                decorations.push(Decoration.node(from, to, { class: 'settled-paragraph' }))
              }
            }
            if (descend) {
              doc.descendants((node, pos) => {
                settle(node, pos)
                return node.type.name !== 'paragraph'
              })
            } else {
              doc.forEach((node, offset) => settle(node, offset))
            }

            return DecorationSet.create(doc, decorations)
          },
        },
      }),
    ]
  },
})
