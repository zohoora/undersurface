import { useCallback, useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'

interface Ripple {
  id: number
  x: number
  y: number
}

// Drop a ripple at the editor's cursor in container-local coordinates.
// `containerSelector` lets the editor live inside different wrappers
// (`.editor-container` for standalone Journal, `.session-journal-surface`
// for in-session Journal). Silently no-ops if cursor coords aren't yet
// resolvable (mid-update).
export function triggerRippleAtCursor(
  editor: Editor | null,
  containerSelector: string,
  addRipple: (r: { id: number; x: number; y: number }) => void,
): void {
  if (!editor) return
  try {
    const coords = editor.view.coordsAtPos(editor.state.selection.from)
    const container = editor.view.dom.closest(containerSelector)
    if (!container) return
    const rect = container.getBoundingClientRect()
    addRipple({
      id: Date.now(),
      x: coords.left - rect.left,
      y: coords.top - rect.top,
    })
  } catch {
    // ProseMirror position not resolvable — drop the ripple
  }
}

export function usePauseRipple() {
  const [ripples, setRipples] = useState<Ripple[]>([])
  const timersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map())

  const addRipple = useCallback((ripple: Ripple) => {
    setRipples((prev) => [...prev, ripple])
    const timer = setTimeout(() => {
      setRipples((prev) => prev.filter((r) => r.id !== ripple.id))
      timersRef.current.delete(ripple.id)
    }, 2500)
    timersRef.current.set(ripple.id, timer)
  }, [])

  useEffect(() => {
    const timers = timersRef.current
    return () => {
      for (const timer of timers.values()) clearTimeout(timer)
    }
  }, [])

  return { ripples, addRipple }
}
