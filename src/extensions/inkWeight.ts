import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

const inkWeightKey = new PluginKey('inkWeight')

export const InkWeight = Extension.create({
  name: 'inkWeight',

  addStorage() {
    return { disabled: false }
  },

  addProseMirrorPlugins() {
    let lastKeystrokeTime = 0
    const storage = this.storage

    return [
      new Plugin({
        key: inkWeightKey,
        state: {
          init() {
            return DecorationSet.empty
          },
          apply(tr, decorationSet) {
            decorationSet = decorationSet.map(tr.mapping, tr.doc)

            if (storage.disabled) return decorationSet
            if (!tr.docChanged) return decorationSet
            if (tr.getMeta('paste') || tr.getMeta('uiEvent') === 'drop') {
              return decorationSet
            }

            const now = Date.now()
            const interval = lastKeystrokeTime > 0 ? now - lastKeystrokeTime : 200
            lastKeystrokeTime = now

            // Fast typing (<100ms) → lighter (0.80)
            // Slow/deliberate (>400ms) → darker (0.95)
            const clamped = Math.min(Math.max(interval, 50), 500)
            const rawOpacity = 0.80 + (clamped - 50) / (500 - 50) * 0.15
            // Round to nearest 0.03 for decoration merging
            const opacity = Math.round(rawOpacity / 0.03) * 0.03

            tr.steps.forEach((_step, i) => {
              const map = tr.mapping.maps[i]
              map.forEach((_oldStart: number, _oldEnd: number, newStart: number, newEnd: number) => {
                if (newEnd > newStart) {
                  const deco = Decoration.inline(newStart, newEnd, {
                    style: `opacity: ${opacity.toFixed(2)}`,
                  })
                  decorationSet = decorationSet.add(tr.doc, [deco])
                }
              })
            })

            return decorationSet
          },
        },
        props: {
          decorations(state) {
            return inkWeightKey.getState(state)
          },
        },
      }),
    ]
  },
})
