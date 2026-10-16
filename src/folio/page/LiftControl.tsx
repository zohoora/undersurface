import { useEffect, useState } from 'react'
import type { Editor } from '@tiptap/core'

// Lift (draft 4 §3.5; S2): a button near the selection on pointer devices,
// a bar at the bottom on touch screens. It appears only for a selection
// inside one page paragraph (not inside an underside).

function coarsePointer(): boolean {
  try { return window.matchMedia('(pointer: coarse)').matches } catch { return false }
}

interface Position { left: number; top: number }

export function LiftControl({ editor, label, onLift, disabled }: { editor: Editor; label: string; onLift: () => void; disabled?: boolean }) {
  const [position, setPosition] = useState<Position | null>(null)
  const [touch] = useState(coarsePointer)

  useEffect(() => {
    const update = () => {
      const { state, view } = editor
      const sel = state.selection
      if (sel.empty || !editor.isEditable) { setPosition(null); return }
      const $from = sel.$from
      const $to = sel.$to
      if ($from.depth !== 1 || $to.depth !== 1 || $from.parent !== $to.parent || $from.parent.type.name !== 'paragraph') { setPosition(null); return }
      try {
        const end = view.coordsAtPos(sel.to)
        setPosition({ left: end.left, top: end.bottom + 8 })
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
  }, [editor])

  if (!position) return null
  const button = (
    <button
      type="button"
      className={touch ? 'folio-button' : 'folio-lift'}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onLift}
      style={touch ? undefined : { left: Math.max(8, Math.min(position.left, window.innerWidth - 120)), top: Math.min(position.top, window.innerHeight - 52), position: 'fixed' }}
    >
      {label}
    </button>
  )
  return touch ? <div className="folio-touchbar">{button}</div> : button
}
