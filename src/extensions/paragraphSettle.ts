import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

const paragraphSettleKey = new PluginKey('paragraphSettle')

export const ParagraphSettle = Extension.create({
  name: 'paragraphSettle',

  addStorage() {
    return { disabled: false }
  },

  addProseMirrorPlugins() {
    const storage = this.storage

    return [
      new Plugin({
        key: paragraphSettleKey,
        props: {
          decorations(state) {
            if (storage.disabled) return DecorationSet.empty

            const { doc, selection } = state
            const cursorPos = selection.from
            const decorations: Decoration[] = []

            doc.forEach((node, offset) => {
              if (node.type.name === 'paragraph') {
                const from = offset
                const to = offset + node.nodeSize
                const isCurrent = cursorPos >= from && cursorPos <= to

                if (!isCurrent && node.textContent.length > 0) {
                  decorations.push(
                    Decoration.node(from, to, {
                      class: 'settled-paragraph',
                    }),
                  )
                }
              }
            })

            return DecorationSet.create(doc, decorations)
          },
        },
      }),
    ]
  },
})
