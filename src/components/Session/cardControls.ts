import type { CSSProperties } from 'react'

// Shared sizing for the quiet in-session cards (Ambiguity prism, Field mosaic,
// surface arcs, conductor offers, proposal and intention cards). The look
// stays restrained, but every control gets a 44px touch target and text never
// drops below 12px.
export const CARD_TAP_TARGET = 44

export const CARD_FONT = "'Inter', sans-serif"

/** Secondary card copy (hints, notes, timestamps). */
export const cardNoteStyle: CSSProperties = {
  fontFamily: CARD_FONT,
  fontSize: 12,
  lineHeight: 1.5,
  color: 'var(--text-ghost)',
}

/** Primary card copy. */
export const cardBodyStyle: CSSProperties = {
  fontFamily: CARD_FONT,
  fontSize: 13,
  lineHeight: 1.5,
  color: 'var(--text-secondary)',
}

/** Rounded choice chip; `active` marks the pressed state. */
export function cardChipStyle(active = false): CSSProperties {
  return {
    minHeight: CARD_TAP_TARGET,
    minWidth: CARD_TAP_TARGET,
    padding: '0 14px',
    border: '1px solid var(--border-light)',
    borderRadius: 999,
    background: active ? 'var(--surface-secondary)' : 'transparent',
    color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
    fontFamily: CARD_FONT,
    fontSize: 12,
    lineHeight: 1.2,
    cursor: 'pointer',
  }
}

/** Borderless text action (skip, not now) that still has a full-size target. */
export const cardQuietButtonStyle: CSSProperties = {
  minHeight: CARD_TAP_TARGET,
  minWidth: CARD_TAP_TARGET,
  padding: '0 10px',
  border: 0,
  borderRadius: 999,
  background: 'transparent',
  color: 'var(--text-ghost)',
  fontFamily: CARD_FONT,
  fontSize: 12,
  cursor: 'pointer',
}

export const cardInputStyle: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  minHeight: CARD_TAP_TARGET,
  padding: '0 10px',
  border: '1px solid var(--border-light)',
  borderRadius: 8,
  background: 'transparent',
  color: 'var(--text-primary)',
  fontFamily: CARD_FONT,
  fontSize: 13,
}

/** A visible label stacked above its control. */
export const cardLabelStyle: CSSProperties = {
  display: 'grid',
  gap: 4,
  ...cardNoteStyle,
}
