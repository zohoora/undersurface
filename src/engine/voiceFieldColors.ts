import type { EmotionalTone } from '../types'

export interface FieldColor {
  r: number
  g: number
  b: number
  /** Base alpha — callers can override via rgba(color, overrideAlpha) */
  a: number
}

export interface FieldPalette {
  /** Background gradient top */
  bgTop: FieldColor
  /** Background gradient bottom (emotion-tinted) */
  bgBottom: FieldColor
  /** Center form when AI is speaking */
  aiCore: FieldColor
  /** Center form when the user is speaking / listening */
  userCore: FieldColor
  /** Word fog — AI-spoken words */
  aiText: FieldColor
  /** Word fog — user-spoken words */
  userText: FieldColor
}

const PALETTES: Record<EmotionalTone, FieldPalette> = {
  neutral: {
    bgTop:    { r: 13,  g: 15,  b: 18,  a: 1 },
    bgBottom: { r: 26,  g: 29,  b: 34,  a: 1 },
    aiCore:   { r: 180, g: 180, b: 190, a: 0.9 },
    userCore: { r: 200, g: 190, b: 170, a: 0.9 },
    aiText:   { r: 220, g: 220, b: 230, a: 0.92 },
    userText: { r: 230, g: 220, b: 200, a: 0.85 },
  },
  tender: {
    bgTop:    { r: 18,  g: 14,  b: 16,  a: 1 },
    bgBottom: { r: 42,  g: 31,  b: 28,  a: 1 },
    aiCore:   { r: 230, g: 180, b: 150, a: 0.92 },
    userCore: { r: 220, g: 160, b: 140, a: 0.9 },
    aiText:   { r: 250, g: 215, b: 190, a: 0.95 },
    userText: { r: 245, g: 205, b: 180, a: 0.9 },
  },
  anxious: {
    bgTop:    { r: 13,  g: 17,  b: 24,  a: 1 },
    bgBottom: { r: 26,  g: 34,  b: 48,  a: 1 },
    aiCore:   { r: 180, g: 200, b: 220, a: 0.88 },
    userCore: { r: 170, g: 190, b: 210, a: 0.85 },
    aiText:   { r: 220, g: 230, b: 245, a: 0.92 },
    userText: { r: 210, g: 220, b: 235, a: 0.88 },
  },
  angry: {
    bgTop:    { r: 19,  g: 13,  b: 13,  a: 1 },
    bgBottom: { r: 42,  g: 26,  b: 24,  a: 1 },
    aiCore:   { r: 230, g: 150, b: 130, a: 0.9 },
    userCore: { r: 220, g: 140, b: 120, a: 0.88 },
    aiText:   { r: 250, g: 200, b: 180, a: 0.92 },
    userText: { r: 245, g: 190, b: 170, a: 0.88 },
  },
  sad: {
    bgTop:    { r: 12,  g: 16,  b: 22,  a: 1 },
    bgBottom: { r: 24,  g: 32,  b: 48,  a: 1 },
    aiCore:   { r: 160, g: 180, b: 210, a: 0.9 },
    userCore: { r: 150, g: 170, b: 200, a: 0.88 },
    aiText:   { r: 210, g: 225, b: 245, a: 0.92 },
    userText: { r: 200, g: 215, b: 235, a: 0.88 },
  },
  joyful: {
    bgTop:    { r: 18,  g: 16,  b: 8,   a: 1 },
    bgBottom: { r: 45,  g: 38,  b: 18,  a: 1 },
    aiCore:   { r: 240, g: 210, b: 150, a: 0.94 },
    userCore: { r: 230, g: 200, b: 140, a: 0.9 },
    aiText:   { r: 255, g: 230, b: 185, a: 0.95 },
    userText: { r: 250, g: 225, b: 180, a: 0.9 },
  },
  contemplative: {
    bgTop:    { r: 12,  g: 17,  b: 13,  a: 1 },
    bgBottom: { r: 28,  g: 42,  b: 30,  a: 1 },
    aiCore:   { r: 180, g: 210, b: 180, a: 0.9 },
    userCore: { r: 170, g: 200, b: 170, a: 0.88 },
    aiText:   { r: 215, g: 235, b: 215, a: 0.92 },
    userText: { r: 205, g: 225, b: 205, a: 0.88 },
  },
  fearful: {
    bgTop:    { r: 14,  g: 12,  b: 20,  a: 1 },
    bgBottom: { r: 33,  g: 28,  b: 46,  a: 1 },
    aiCore:   { r: 190, g: 180, b: 215, a: 0.9 },
    userCore: { r: 180, g: 170, b: 205, a: 0.88 },
    aiText:   { r: 225, g: 220, b: 240, a: 0.92 },
    userText: { r: 215, g: 210, b: 230, a: 0.88 },
  },
  hopeful: {
    bgTop:    { r: 12,  g: 18,  b: 14,  a: 1 },
    bgBottom: { r: 31,  g: 44,  b: 35,  a: 1 },
    aiCore:   { r: 190, g: 220, b: 190, a: 0.92 },
    userCore: { r: 180, g: 210, b: 180, a: 0.9 },
    aiText:   { r: 225, g: 240, b: 225, a: 0.94 },
    userText: { r: 215, g: 230, b: 215, a: 0.9 },
  },
  conflicted: {
    bgTop:    { r: 15,  g: 13,  b: 18,  a: 1 },
    bgBottom: { r: 34,  g: 31,  b: 43,  a: 1 },
    aiCore:   { r: 200, g: 190, b: 210, a: 0.88 },
    userCore: { r: 190, g: 180, b: 200, a: 0.85 },
    aiText:   { r: 230, g: 225, b: 240, a: 0.92 },
    userText: { r: 220, g: 215, b: 230, a: 0.88 },
  },
}

export function getFieldPalette(emotion: EmotionalTone | undefined): FieldPalette {
  if (!emotion) return PALETTES.neutral
  return PALETTES[emotion] ?? PALETTES.neutral
}

export function rgba(c: FieldColor, alphaOverride?: number): string {
  const a = alphaOverride ?? c.a
  return `rgba(${c.r}, ${c.g}, ${c.b}, ${a})`
}

/** Component-wise channel lerp, used for smoothly transitioning between palettes. */
export function lerpColor(a: FieldColor, b: FieldColor, t: number): FieldColor {
  return {
    r: Math.round(a.r + (b.r - a.r) * t),
    g: Math.round(a.g + (b.g - a.g) * t),
    b: Math.round(a.b + (b.b - a.b) * t),
    a: a.a + (b.a - a.a) * t,
  }
}

export function lerpPalette(a: FieldPalette, b: FieldPalette, t: number): FieldPalette {
  return {
    bgTop: lerpColor(a.bgTop, b.bgTop, t),
    bgBottom: lerpColor(a.bgBottom, b.bgBottom, t),
    aiCore: lerpColor(a.aiCore, b.aiCore, t),
    userCore: lerpColor(a.userCore, b.userCore, t),
    aiText: lerpColor(a.aiText, b.aiText, t),
    userText: lerpColor(a.userText, b.userText, t),
  }
}

/** True when two palettes have converged within 1 R/G/B unit per channel. */
export function palettesApproxEqual(a: FieldPalette, b: FieldPalette): boolean {
  const keys: (keyof FieldPalette)[] = ['bgTop', 'bgBottom', 'aiCore', 'userCore', 'aiText', 'userText']
  for (const k of keys) {
    const ca = a[k]
    const cb = b[k]
    if (Math.abs(ca.r - cb.r) > 1) return false
    if (Math.abs(ca.g - cb.g) > 1) return false
    if (Math.abs(ca.b - cb.b) > 1) return false
    if (Math.abs(ca.a - cb.a) > 0.01) return false
  }
  return true
}
