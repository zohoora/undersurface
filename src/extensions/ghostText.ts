import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

export const ghostTextKey = new PluginKey('ghostText')

interface GhostTextMeta {
  text: string
  position: number
  color?: string
}

interface GhostTextState {
  decorations: DecorationSet
  text: string | null
  position: number | null
}

function isTouchDevice(): boolean {
  return 'ontouchstart' in window || navigator.maxTouchPoints > 0
}

function createGhostWidget(text: string, color?: string): HTMLSpanElement {
  const span = document.createElement('span')
  span.className = 'ghost-text'
  span.textContent = text
  span.setAttribute('data-ghost-text', text)

  const baseColor = color || 'var(--text-ghost)'
  span.style.cssText = [
    `color: ${baseColor}`,
    'opacity: 0',
    'font-style: italic',
    'pointer-events: none',
    'user-select: none',
    'animation: ghost-text-appear 300ms ease-out forwards',
  ].join(';')

  if (isTouchDevice()) {
    span.style.pointerEvents = 'auto'
    span.style.cursor = 'pointer'
    span.style.borderBottom = `1px dashed ${baseColor}`
    span.style.paddingBottom = '1px'
  } else {
    // Desktop: show Tab hint
    const hint = document.createElement('span')
    hint.className = 'ghost-text-hint'
    hint.textContent = 'Tab'
    hint.style.cssText = [
      'font-size: 10px',
      'opacity: 0.3',
      'margin-left: 6px',
      'font-style: normal',
      'font-family: Inter, sans-serif',
      `color: ${baseColor}`,
    ].join(';')
    span.appendChild(hint)
  }

  return span
}

export const GhostText = Extension.create({
  name: 'ghostText',

  addStorage() {
    return { disabled: false }
  },

  addProseMirrorPlugins() {
    const storage = this.storage

    return [
      new Plugin({
        key: ghostTextKey,
        state: {
          init(): GhostTextState {
            return { decorations: DecorationSet.empty, text: null, position: null }
          },
          apply(tr, state: GhostTextState, _oldState, newState): GhostTextState {
            if (storage.disabled) {
              return { decorations: DecorationSet.empty, text: null, position: null }
            }

            const meta = tr.getMeta(ghostTextKey) as GhostTextMeta | { clear: true } | undefined

            // Clear request
            if (meta && 'clear' in meta) {
              return { decorations: DecorationSet.empty, text: null, position: null }
            }

            // New ghost text request
            if (meta && 'text' in meta) {
              const widget = Decoration.widget(meta.position, createGhostWidget(meta.text, meta.color), {
                side: 1,
                key: 'ghost-text-widget',
              })
              return {
                decorations: DecorationSet.create(newState.doc, [widget]),
                text: meta.text,
                position: meta.position,
              }
            }

            // Doc changed (user typed) → clear ghost text
            if (tr.docChanged && state.text !== null) {
              return { decorations: DecorationSet.empty, text: null, position: null }
            }

            // Selection changed → clear ghost text
            if (!tr.docChanged && tr.selectionSet && state.text !== null) {
              return { decorations: DecorationSet.empty, text: null, position: null }
            }

            return state
          },
        },
        props: {
          decorations(state) {
            return (ghostTextKey.getState(state) as GhostTextState)?.decorations || DecorationSet.empty
          },
          handleDOMEvents: {
            // Handle tap on ghost text (mobile)
            click(view, event) {
              const target = event.target as HTMLElement
              if (!target.classList.contains('ghost-text') && !target.closest('.ghost-text')) return false

              const ghostEl = target.classList.contains('ghost-text') ? target : target.closest('.ghost-text') as HTMLElement
              const text = ghostEl?.getAttribute('data-ghost-text')
              if (!text) return false

              const state = ghostTextKey.getState(view.state) as GhostTextState
              if (!state?.text) return false

              // Insert the ghost text at the stored position
              const tr = view.state.tr.insertText(text, state.position ?? undefined)
              tr.setMeta(ghostTextKey, { clear: true })
              view.dispatch(tr)

              return true
            },
          },
        },
      }),
    ]
  },
})
