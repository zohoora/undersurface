import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { hexToRgba } from '../utils/color'

export const textHighlightKey = new PluginKey('textHighlight')

interface HighlightMeta {
  phrases: string[]
  color: string
  fadeDuration?: number
}

interface HighlightState {
  decorations: DecorationSet
  fadeTimer: ReturnType<typeof setTimeout> | null
}

function findPhrasePositions(doc: import('@tiptap/pm/model').Node, phrase: string): Array<{ from: number; to: number }> {
  const positions: Array<{ from: number; to: number }> = []
  const lowerPhrase = phrase.toLowerCase()

  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return
    const lowerText = node.text.toLowerCase()
    let searchFrom = 0
    while (searchFrom < lowerText.length) {
      const idx = lowerText.indexOf(lowerPhrase, searchFrom)
      if (idx === -1) break
      positions.push({ from: pos + idx, to: pos + idx + phrase.length })
      searchFrom = idx + 1
      if (positions.length >= 5) return false
    }
  })

  return positions
}

export const TextHighlight = Extension.create({
  name: 'textHighlight',

  addStorage() {
    return { disabled: false }
  },

  addProseMirrorPlugins() {
    const storage = this.storage

    return [
      new Plugin({
        key: textHighlightKey,
        state: {
          init(): HighlightState {
            return { decorations: DecorationSet.empty, fadeTimer: null }
          },
          apply(tr, state: HighlightState, _oldState, newState): HighlightState {
            if (storage.disabled) {
              if (state.fadeTimer) clearTimeout(state.fadeTimer)
              return { decorations: DecorationSet.empty, fadeTimer: null }
            }

            const meta = tr.getMeta(textHighlightKey) as HighlightMeta | { clear: true } | undefined

            // Clear request
            if (meta && 'clear' in meta) {
              if (state.fadeTimer) clearTimeout(state.fadeTimer)
              return { decorations: DecorationSet.empty, fadeTimer: null }
            }

            // New highlight request
            if (meta && 'phrases' in meta) {
              if (state.fadeTimer) clearTimeout(state.fadeTimer)

              const decorations: Decoration[] = []
              const isDark = document.documentElement.getAttribute('data-theme') === 'dark'
              const bgAlpha = isDark ? 0.18 : 0.12
              const underlineAlpha = isDark ? 0.5 : 0.4

              for (const phrase of meta.phrases) {
                const positions = findPhrasePositions(newState.doc, phrase)
                for (const { from, to } of positions) {
                  decorations.push(
                    Decoration.inline(from, to, {
                      class: 'text-highlight',
                      style: [
                        `text-decoration: underline`,
                        `text-decoration-color: ${hexToRgba(meta.color, underlineAlpha)}`,
                        `text-underline-offset: 3px`,
                        `background: ${hexToRgba(meta.color, bgAlpha)}`,
                        `letter-spacing: 0.02em`,
                        `border-radius: 2px`,
                        `padding: 1px 0`,
                      ].join(';'),
                    })
                  )
                }
              }

              const fadeDuration = meta.fadeDuration ?? 8000

              // Schedule fade-out via view dispatch (handled in view.update)
              const fadeTimer = setTimeout(() => {
                const editorEl = document.querySelector('.tiptap') as HTMLElement | null
                const highlights = editorEl?.querySelectorAll('.text-highlight')
                highlights?.forEach((el) => el.classList.add('fading'))
              }, fadeDuration)

              return {
                decorations: DecorationSet.create(newState.doc, decorations),
                fadeTimer,
              }
            }

            // Doc changed (user typed) → clear highlights immediately
            if (tr.docChanged && state.decorations !== DecorationSet.empty) {
              if (state.fadeTimer) clearTimeout(state.fadeTimer)
              return { decorations: DecorationSet.empty, fadeTimer: null }
            }

            // Map existing decorations through doc changes
            if (tr.docChanged) {
              return { ...state, decorations: state.decorations.map(tr.mapping, newState.doc) }
            }

            return state
          },
        },
        props: {
          decorations(state) {
            return (textHighlightKey.getState(state) as HighlightState)?.decorations || DecorationSet.empty
          },
        },
      }),
    ]
  },
})
