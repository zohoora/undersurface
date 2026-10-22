import { useEffect, useState } from 'react'
import type { Editor } from '@tiptap/core'
import { ASK_MAX_CHARS } from '../ask/askPrompt'

// Lift ("Write beneath"; draft 4 §3.5; S2): a button near the selection on
// pointer devices, a bar at the bottom on touch screens, riding above the
// on-screen keyboard (iOS keeps the layout viewport under it). It appears only
// for a selection inside one page paragraph (not inside an underside).
// Ask (H2): beside Lift, for a selection inside one paragraph anywhere — the
// page, a between or a beneath — of at most 1,000 characters, while no other
// request is pending.

function coarsePointer(): boolean {
  try { return window.matchMedia('(pointer: coarse)').matches } catch { return false }
}

/** How far the on-screen keyboard (or anything else) covers the bottom of the layout viewport. */
function keyboardInset(): number {
  const vv = typeof window !== 'undefined' ? window.visualViewport : null
  if (!vv) return 0
  return Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop))
}

function useKeyboardInset(on: boolean): number {
  const [inset, setInset] = useState(0)
  useEffect(() => {
    const vv = window.visualViewport
    if (!on || !vv) return
    const update = () => setInset(keyboardInset())
    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
    }
  }, [on])
  return inset
}

interface Position { left: number; top: number; lift: boolean; ask: boolean }

export interface AskControl {
  label: string
  onAsk: () => void
  /** A request is pending. */
  busy: boolean
}

export function LiftControl({ editor, label, onLift, disabled, ask }: { editor: Editor; label: string; onLift: () => void; disabled?: boolean; ask?: AskControl }) {
  const [position, setPosition] = useState<Position | null>(null)
  const [touch] = useState(coarsePointer)
  const askOn = !!ask
  const inset = useKeyboardInset(touch && position !== null)

  useEffect(() => {
    const update = () => {
      const { state, view } = editor
      const sel = state.selection
      if (sel.empty || !editor.isEditable) { setPosition(null); return }
      const $from = sel.$from
      const $to = sel.$to
      if ($from.parent !== $to.parent || $from.parent.type.name !== 'paragraph') { setPosition(null); return }
      const lift = $from.depth === 1
      const askable = askOn && state.doc.textBetween(sel.from, sel.to, '\n').trim().length > 0 && sel.to - sel.from <= ASK_MAX_CHARS
      if (!lift && !askable) { setPosition(null); return }
      try {
        const end = view.coordsAtPos(sel.to)
        setPosition({ left: end.left, top: end.bottom + 8, lift, ask: askable })
      } catch {
        setPosition(null)
      }
    }
    editor.on('selectionUpdate', update)
    editor.on('blur', update)
    // The page scrolls inside Folio's fixed root, so follow any scroll.
    document.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)
    return () => {
      editor.off('selectionUpdate', update)
      editor.off('blur', update)
      document.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
    }
  }, [editor, askOn])

  if (!position) return null
  const buttons = (
    <>
      {position.lift && (
        <button type="button" className={touch ? 'folio-button' : 'folio-lift__button'} disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={onLift}>
          {label}
        </button>
      )}
      {position.ask && ask && (
        <button type="button" className={touch ? 'folio-button' : 'folio-lift__button'} disabled={ask.busy} onMouseDown={(e) => e.preventDefault()} onClick={ask.onAsk}>
          {ask.label}
        </button>
      )}
    </>
  )
  if (touch) return <div className="folio-touchbar" style={inset > 0 ? { bottom: inset } : undefined}>{buttons}</div>
  return (
    <div
      className="folio-lift"
      style={{ left: Math.max(8, Math.min(position.left, window.innerWidth - 180)), top: Math.min(position.top, window.innerHeight - 52), position: 'fixed' }}
    >
      {buttons}
    </div>
  )
}
