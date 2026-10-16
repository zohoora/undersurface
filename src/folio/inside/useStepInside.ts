import { useCallback, useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { getFoldView } from '../page/foldView'
import { UNDERSIDE } from '../page/schema'
import type { FolioStrings } from '../page/strings'
import { snapshotFold } from '../kept/keep'
import type { Composition } from '../kept/keep'
import type { ShorePresentation } from '../safety/shorePresentation'
import type { LeaveMode } from './StepInside'

// Step inside's state (build plan §4, H1): open from an open fold with writing,
// only on Normal paper; "Back to the page" restores the exact selection and
// scroll; "Back and write" puts the caret at the end of the beneath; Shore or
// Quiet closes it at once and shows the page.

export interface InsideState {
  foldId: string
  composition: Composition
  line: string
  label: string
  from: number
  to: number
  scroll: number
}

export function useStepInside({ editor, shore, enabled, reduceMotion, strings }: {
  editor: Editor | null
  shore: ShorePresentation
  enabled: boolean
  reduceMotion: boolean
  strings: () => FolioStrings
}) {
  const [inside, setInside] = useState<InsideState | null>(null)
  const [afterglow, setAfterglow] = useState(0)
  const insideRef = useRef(inside)
  useEffect(() => { insideRef.current = inside }, [inside])

  const scroller = useCallback(() => (editor?.view.dom.closest('.folio-root') as HTMLElement | null) ?? null, [editor])

  const open = useCallback((foldId: string) => {
    if (!editor || !enabled || shore.getSnapshot().presentation !== 'normal') return
    if (!getFoldView(editor.state).open.has(foldId)) return
    const snapshot = snapshotFold(editor.state.doc, foldId)
    if (!snapshot || snapshot.empty) return
    const { from, to } = editor.state.selection
    setInside({
      foldId, composition: snapshot.composition, line: snapshot.surface,
      label: strings().undersideLabel(snapshot.surface, snapshot.composition.gap),
      from, to, scroll: scroller()?.scrollTop ?? 0,
    })
  }, [editor, enabled, shore, strings, scroller])

  const leave = useCallback((mode: LeaveMode) => {
    const was = insideRef.current
    insideRef.current = null
    setInside(null)
    if (!reduceMotion) setAfterglow((n) => n + 1)
    if (!editor || !was) return
    const { doc } = editor.state
    if (mode === 'write') {
      let end: number | null = null
      doc.forEach((node, offset) => {
        if (node.type.name === UNDERSIDE && node.attrs.foldId === was.foldId) end = offset + node.nodeSize - 3
      })
      if (end !== null) editor.view.dispatch(editor.state.tr.setSelection(TextSelection.near(doc.resolve(end), -1)).setMeta('addToHistory', false).scrollIntoView())
      focusAfterClose(editor)
      return
    }
    try {
      const size = doc.content.size
      editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(doc, Math.min(was.from, size), Math.min(was.to, size))).setMeta('addToHistory', false))
    } catch { /* the selection no longer fits */ }
    const root = scroller()
    focusAfterClose(editor, () => { if (root) root.scrollTop = was.scroll })
  }, [editor, reduceMotion, scroller])

  // Shore or Quiet: the space closes at once and the page shows (§5.5, H1 row).
  useEffect(() => shore.subscribe(() => {
    if (shore.getSnapshot().presentation === 'normal' || !insideRef.current) return
    insideRef.current = null
    setInside(null)
    if (editor) focusAfterClose(editor)
  }), [shore, editor])

  const clearAfterglow = useCallback(() => setAfterglow(0), [])
  return { inside, open, leave, afterglow, clearAfterglow }
}

/**
 * Focus the editor once the dialog is gone: while it's open the page is inert
 * and can't take focus, so this waits for React to remove it.
 */
function focusAfterClose(editor: Editor, then?: () => void): void {
  setTimeout(() => {
    if (editor.isDestroyed) return
    editor.view.focus()
    then?.()
  }, 0)
}
