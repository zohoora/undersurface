import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'

const typewriterScrollKey = new PluginKey('typewriterScroll')

export const TypewriterScroll = Extension.create({
  name: 'typewriterScroll',

  addStorage() {
    return { mode: 'off' as 'off' | 'comfortable' | 'typewriter' }
  },

  addProseMirrorPlugins() {
    const storage = this.storage

    return [
      new Plugin({
        key: typewriterScrollKey,
        props: {
          handleScrollToSelection(view: EditorView) {
            // In typewriter mode, suppress ProseMirror's default scroll-into-view
            // so only our centered scroll fires
            if (storage.mode === 'typewriter') {
              scrollToSelection(view, storage.mode)
              return true
            }
            if (storage.mode === 'comfortable') {
              scrollToSelection(view, storage.mode)
            }
            return false
          },
        },
      }),
    ]
  },
})

function scrollToSelection(view: EditorView, mode: 'comfortable' | 'typewriter') {
  requestAnimationFrame(() => {
    try {
      const coords = view.coordsAtPos(view.state.selection.from)
      const viewportHeight = window.innerHeight

      if (mode === 'typewriter') {
        const targetY = viewportHeight * 0.5
        const scrollBy = coords.top - targetY
        window.scrollBy({ top: scrollBy, behavior: 'instant' })
      } else {
        // Comfortable: keep cursor away from edges
        const bottomMargin = 300
        const topMargin = 100

        if (coords.top > viewportHeight - bottomMargin) {
          const scrollBy = coords.top - (viewportHeight - bottomMargin)
          window.scrollBy({ top: scrollBy, behavior: 'instant' })
        } else if (coords.top < topMargin) {
          const scrollBy = coords.top - topMargin
          window.scrollBy({ top: scrollBy, behavior: 'instant' })
        }
      }
    } catch {
      // Position might be invalid during rapid edits
    }
  })
}
