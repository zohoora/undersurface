import { useRef, useCallback } from 'react'
import type { Editor } from '@tiptap/core'
import { extractCompletedSentence, correctSentence, shouldTriggerAutocorrect } from '../ai/llmCorrect'
import { getLanguageCode } from '../i18n'
import { getGlobalConfig } from '../store/globalConfig'

interface AutocorrectOptions {
  autocorrect: boolean
  autoCapitalize: boolean
}

/**
 * Shared autocorrect keyboard handler for TipTap editors.
 * Handles: backspace undo of corrections, auto-capitalize,
 * standalone "i" → "I" fix, and LLM-based sentence autocorrect.
 */
export function useAutocorrect({ autocorrect, autoCapitalize }: AutocorrectOptions) {
  const lastAutocorrectRef = useRef<{
    original: string
    correction: string
    wordStart: number
    delimiter: string
  } | null>(null)

  const handleAutocorrect = useCallback((editor: Editor, event: KeyboardEvent): boolean => {
    if (event.metaKey || event.ctrlKey || event.altKey) return false

    // Undo autocorrect on Backspace
    if (event.key === 'Backspace' && lastAutocorrectRef.current) {
      const { original, correction, wordStart, delimiter } = lastAutocorrectRef.current
      const cursor = editor.state.selection.from
      const expectedEnd = wordStart + correction.length + delimiter.length
      // Cursor must be right after "correction + delimiter"
      if (cursor === expectedEnd) {
        const docText = editor.state.doc.textBetween(wordStart, expectedEnd)
        if (docText === correction + delimiter) {
          event.preventDefault()
          editor.view.dispatch(
            editor.state.tr.replaceWith(
              wordStart,
              expectedEnd,
              editor.state.schema.text(original + delimiter),
            ),
          )
          lastAutocorrectRef.current = null
          return true
        }
      }
      lastAutocorrectRef.current = null
    }

    if (event.key.length === 1 || event.key === 'Backspace' || event.key === 'Delete' || event.key === 'Enter') {
      // Clear autocorrect undo on any non-backspace key
      if (event.key !== 'Backspace') lastAutocorrectRef.current = null

      // Auto-capitalize
      if (autoCapitalize && event.key.length === 1) {
        const from = editor.state.selection.from
        const parentOffset = editor.state.selection.$from.parentOffset

        // Capitalize first letter at start of paragraph or after sentence endings
        if (/[a-z]/.test(event.key)) {
          const shouldCapitalize = parentOffset === 0
            || /[.!?]\s$/.test(editor.state.doc.textBetween(Math.max(0, from - 3), from))

          if (shouldCapitalize) {
            event.preventDefault()
            editor.commands.insertContent(event.key.toUpperCase())
            return true
          }
        }

        // Fix standalone "i" to "I" when followed by space/punctuation (English only)
        if (getLanguageCode() === 'en' && /[\s,.'!?;:]/.test(event.key) && from >= 1) {
          const lookback = editor.state.doc.textBetween(Math.max(0, from - 2), from)
          if (/(?:^|\s)i$/.test(lookback)) {
            editor.view.dispatch(
              editor.state.tr.replaceWith(from - 1, from, editor.state.schema.text('I'))
            )
          }
        }
      }

      // Autocorrect: on sentence-ending punctuation, send completed sentence to LLM
      // Triggers on: space after any sentence-end punct, or next char after CJK fullwidth punct
      if (autocorrect && getGlobalConfig()?.features?.autocorrectEnabled !== false) {
        const $pos = editor.state.selection.$from
        const textBefore = $pos.parent.textBetween(0, $pos.parentOffset)
        if (shouldTriggerAutocorrect(event.key, textBefore)) {
          // For space-triggered: append space so extractCompletedSentence sees "punct + space"
          // For CJK-triggered: text already ends with fullwidth punct, no space needed
          const textForExtraction = event.key === ' ' ? textBefore + ' ' : textBefore
          const extracted = extractCompletedSentence(textForExtraction)
          if (extracted) {
            const absStart = $pos.start() + extracted.start
            const absEnd = $pos.start() + extracted.end
            const capturedEditor = editor
            const originalSentence = extracted.sentence
            correctSentence(originalSentence).then((corrected) => {
              if (!corrected) return
              const currentState = capturedEditor.state
              if (absEnd > currentState.doc.content.size) return
              let currentText: string
              try { currentText = currentState.doc.textBetween(absStart, absEnd) } catch { return }
              if (currentText !== originalSentence) return
              capturedEditor.view.dispatch(
                currentState.tr.replaceWith(
                  absStart,
                  absEnd,
                  currentState.schema.text(corrected),
                ),
              )
              lastAutocorrectRef.current = { original: originalSentence, correction: corrected, wordStart: absStart, delimiter: '' }
            })
          }
        }
      }
    }
    return false
  }, [autocorrect, autoCapitalize])

  return handleAutocorrect
}
