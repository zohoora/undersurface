// Folio's key bindings as a writer reads them (2026-10-22: the corner's
// tooltip and Keyboard shortcuts). TipTap's Mod is ⌘ on Apple devices and
// Ctrl elsewhere.

export function isApple(): boolean {
  if (typeof navigator === 'undefined') return false
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent)
}

const APPLE: Record<string, string> = { Mod: '⌘', Shift: '⇧', Alt: '⌥', Enter: '↵', Escape: 'Esc' }
const OTHER: Record<string, string> = { Mod: 'Ctrl', Shift: 'Shift', Alt: 'Alt', Enter: 'Enter', Escape: 'Esc' }

/** 'Mod-Shift-Enter' → '⌘⇧↵' on a Mac, 'Ctrl+Shift+Enter' elsewhere. */
export function keyLabel(binding: string, apple: boolean = isApple()): string {
  // The last part may itself be '-' only in theory; Folio's bindings never end in one.
  const parts = binding.split('-')
  const names = parts.map((p) => (apple ? APPLE : OTHER)[p] ?? (p.length === 1 ? p.toUpperCase() : p))
  return apple ? names.join('') : names.join('+')
}

export function coarsePointer(): boolean {
  try { return window.matchMedia('(pointer: coarse)').matches } catch { return false }
}
