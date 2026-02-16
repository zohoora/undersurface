import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { hexToRgb } from '../utils/color'

export const colorBleedKey = new PluginKey('colorBleed')

const BASE_RGB: [number, number, number] = [44, 40, 37] // #2C2825
const BLEED_WORDS = 20
const MAX_BLEND = 0.3

function blend(base: [number, number, number], tint: [number, number, number], amount: number): string {
  const r = Math.round(base[0] * (1 - amount) + tint[0] * amount)
  const g = Math.round(base[1] * (1 - amount) + tint[1] * amount)
  const b = Math.round(base[2] * (1 - amount) + tint[2] * amount)
  return `rgb(${r},${g},${b})`
}

interface BleedState {
  decorations: DecorationSet
  tintRgb: [number, number, number] | null
  wordsRemaining: number
}

export const ColorBleed = Extension.create({
  name: 'colorBleed',

  addStorage() {
    return { disabled: false }
  },

  addProseMirrorPlugins() {
    const storage = this.storage

    return [
      new Plugin({
        key: colorBleedKey,
        state: {
          init(): BleedState {
            return { decorations: DecorationSet.empty, tintRgb: null, wordsRemaining: 0 }
          },
          apply(tr, state: BleedState, _oldState, newState): BleedState {
            let { decorations, tintRgb, wordsRemaining } = state
            decorations = decorations.map(tr.mapping, newState.doc)

            if (storage.disabled) {
              return { decorations: DecorationSet.empty, tintRgb: null, wordsRemaining: 0 }
            }

            const meta = tr.getMeta(colorBleedKey)
            if (meta?.color) {
              tintRgb = hexToRgb(meta.color)
              wordsRemaining = BLEED_WORDS
            }

            if (!tr.docChanged || !tintRgb || wordsRemaining <= 0) {
              return { decorations, tintRgb, wordsRemaining }
            }

            if (tr.getMeta('paste') || tr.getMeta('uiEvent') === 'drop') {
              return { decorations, tintRgb, wordsRemaining }
            }

            // Count word boundaries in inserted text
            let wordBoundaries = 0
            tr.steps.forEach((_step, i) => {
              const map = tr.mapping.maps[i]
              map.forEach((_oldStart: number, _oldEnd: number, newStart: number, newEnd: number) => {
                if (newEnd > newStart) {
                  const inserted = newState.doc.textBetween(newStart, newEnd)
                  for (const ch of inserted) {
                    if (ch === ' ' || ch === '\n') wordBoundaries++
                  }
                }
              })
            })

            if (wordBoundaries > 0) {
              wordsRemaining = Math.max(0, wordsRemaining - wordBoundaries)
            }

            // Compute tint strength based on remaining words
            const strength = (wordsRemaining / BLEED_WORDS) * MAX_BLEND
            const color = blend(BASE_RGB, tintRgb, strength)

            tr.steps.forEach((_step, i) => {
              const map = tr.mapping.maps[i]
              map.forEach((_oldStart: number, _oldEnd: number, newStart: number, newEnd: number) => {
                if (newEnd > newStart) {
                  decorations = decorations.add(newState.doc, [
                    Decoration.inline(newStart, newEnd, { style: `color:${color}` }),
                  ])
                }
              })
            })

            if (wordsRemaining <= 0) tintRgb = null

            return { decorations, tintRgb, wordsRemaining }
          },
        },
        props: {
          decorations(state) {
            return (colorBleedKey.getState(state) as BleedState)?.decorations || DecorationSet.empty
          },
        },
      }),
    ]
  },
})
