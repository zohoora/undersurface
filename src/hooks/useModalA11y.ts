import { useEffect, type RefObject } from 'react'

// Standard modal accessibility, wired onto an existing dialog panel without
// forcing a markup rewrite: Escape closes, Tab is trapped inside the dialog,
// initial focus moves into the panel, and focus is restored to the element that
// opened the modal when it unmounts. The panel element should carry
// role="dialog", aria-modal="true", tabIndex={-1}, and an accessible name
// (aria-label or aria-labelledby).
export function useModalA11y(
  panelRef: RefObject<HTMLElement | null>,
  onClose: () => void,
): void {
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null
    const panel = panelRef.current

    const focusable = (): HTMLElement[] =>
      Array.from(
        panel?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((el) => el.offsetParent !== null)

    // Move focus into the dialog so keyboard users start inside it.
    ;(focusable()[0] ?? panel)?.focus()

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
        return
      }
      if (e.key !== 'Tab') return
      const items = focusable()
      if (items.length === 0) {
        e.preventDefault()
        return
      }
      const firstEl = items[0]
      const lastEl = items[items.length - 1]
      const active = document.activeElement
      if (e.shiftKey && active === firstEl) {
        e.preventDefault()
        lastEl.focus()
      } else if (!e.shiftKey && active === lastEl) {
        e.preventDefault()
        firstEl.focus()
      }
    }

    // Capture phase so we intercept before inner handlers stop propagation.
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      previouslyFocused?.focus?.()
    }
  }, [panelRef, onClose])
}
