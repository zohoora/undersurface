import '@tiptap/core'

declare module '@tiptap/core' {
  interface Storage {
    inkWeight: { disabled: boolean }
    paragraphSettle: { disabled: boolean }
    colorBleed: { disabled: boolean }
    typewriterScroll: { mode: 'off' | 'comfortable' | 'typewriter' }
    textHighlight: { disabled: boolean }
    ghostText: { disabled: boolean }
  }
}
