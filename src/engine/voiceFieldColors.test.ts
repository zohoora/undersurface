import { describe, it, expect } from 'vitest'
import type { EmotionalTone } from '../types'
import {
  getFieldPalette,
  rgba,
  lerpColor,
  lerpPalette,
  palettesApproxEqual,
} from './voiceFieldColors'
import type { FieldColor, FieldPalette } from './voiceFieldColors'

const ALL_EMOTIONS: EmotionalTone[] = [
  'neutral',
  'tender',
  'anxious',
  'angry',
  'sad',
  'joyful',
  'contemplative',
  'fearful',
  'hopeful',
  'conflicted',
]

describe('getFieldPalette', () => {
  it('returns the neutral palette when emotion is undefined', () => {
    const p = getFieldPalette(undefined)
    // Sentinel: neutral.bgTop is rgb(13, 15, 18)
    expect(p.bgTop).toEqual({ r: 13, g: 15, b: 18, a: 1 })
  })

  it('returns the neutral palette as a fallback when an unrecognized emotion is passed', () => {
    // Cast through unknown so we can pass a bogus tone — the runtime fallback
    // (?? PALETTES.neutral) is the load-bearing safety here.
    const p = getFieldPalette('not-a-real-emotion' as unknown as EmotionalTone)
    expect(p.bgTop).toEqual({ r: 13, g: 15, b: 18, a: 1 })
  })

  it('returns a distinct palette for every defined EmotionalTone', () => {
    // Guards against accidental duplication when a new tone is added.
    for (const e of ALL_EMOTIONS) {
      expect(getFieldPalette(e)).toBeDefined()
    }
    const tenderTop = getFieldPalette('tender').bgTop
    const angryTop = getFieldPalette('angry').bgTop
    expect(tenderTop).not.toEqual(angryTop)
  })

  it('every palette has all six required keys populated with valid color objects', () => {
    const keys: (keyof FieldPalette)[] = ['bgTop', 'bgBottom', 'aiCore', 'userCore', 'aiText', 'userText']
    for (const tone of ALL_EMOTIONS) {
      const p = getFieldPalette(tone)
      for (const k of keys) {
        const c = p[k]
        expect(c.r).toBeGreaterThanOrEqual(0)
        expect(c.r).toBeLessThanOrEqual(255)
        expect(c.g).toBeGreaterThanOrEqual(0)
        expect(c.g).toBeLessThanOrEqual(255)
        expect(c.b).toBeGreaterThanOrEqual(0)
        expect(c.b).toBeLessThanOrEqual(255)
        expect(c.a).toBeGreaterThanOrEqual(0)
        expect(c.a).toBeLessThanOrEqual(1)
      }
    }
  })
})

describe('rgba', () => {
  it('formats a color with its base alpha when no override is given', () => {
    const c: FieldColor = { r: 10, g: 20, b: 30, a: 0.5 }
    expect(rgba(c)).toBe('rgba(10, 20, 30, 0.5)')
  })

  it('uses alphaOverride when provided', () => {
    const c: FieldColor = { r: 10, g: 20, b: 30, a: 0.5 }
    expect(rgba(c, 0.9)).toBe('rgba(10, 20, 30, 0.9)')
  })

  it('honors alphaOverride of 0 (not falsy-coerced back to base alpha)', () => {
    // Uses ?? so 0 must pass through, unlike ||.
    const c: FieldColor = { r: 10, g: 20, b: 30, a: 0.5 }
    expect(rgba(c, 0)).toBe('rgba(10, 20, 30, 0)')
  })
})

describe('lerpColor', () => {
  it('returns the start color exactly at t=0', () => {
    const a: FieldColor = { r: 10, g: 20, b: 30, a: 0.5 }
    const b: FieldColor = { r: 100, g: 200, b: 250, a: 1 }
    expect(lerpColor(a, b, 0)).toEqual(a)
  })

  it('returns the end color (approximately) at t=1', () => {
    const a: FieldColor = { r: 10, g: 20, b: 30, a: 0.5 }
    const b: FieldColor = { r: 100, g: 200, b: 250, a: 1 }
    const result = lerpColor(a, b, 1)
    expect(result.r).toBe(100)
    expect(result.g).toBe(200)
    expect(result.b).toBe(250)
    expect(result.a).toBeCloseTo(1)
  })

  it('rounds RGB to integers at intermediate t', () => {
    const a: FieldColor = { r: 0, g: 0, b: 0, a: 0 }
    const b: FieldColor = { r: 3, g: 3, b: 3, a: 1 }
    const result = lerpColor(a, b, 0.5)
    expect(Number.isInteger(result.r)).toBe(true)
    expect(Number.isInteger(result.g)).toBe(true)
    expect(Number.isInteger(result.b)).toBe(true)
  })

  it('does not round alpha (keeps floating point precision)', () => {
    const a: FieldColor = { r: 0, g: 0, b: 0, a: 0 }
    const b: FieldColor = { r: 0, g: 0, b: 0, a: 1 }
    expect(lerpColor(a, b, 0.5).a).toBeCloseTo(0.5)
  })
})

describe('lerpPalette', () => {
  it('lerps every channel of every key', () => {
    const a = getFieldPalette('neutral')
    const b = getFieldPalette('joyful')
    const mid = lerpPalette(a, b, 0.5)

    const keys: (keyof FieldPalette)[] = ['bgTop', 'bgBottom', 'aiCore', 'userCore', 'aiText', 'userText']
    for (const k of keys) {
      // mid should be between the endpoints inclusive on every channel
      const lo = Math.min(a[k].r, b[k].r)
      const hi = Math.max(a[k].r, b[k].r)
      expect(mid[k].r).toBeGreaterThanOrEqual(lo)
      expect(mid[k].r).toBeLessThanOrEqual(hi)
    }
  })

  it('lerps to the start palette at t=0', () => {
    const a = getFieldPalette('sad')
    const b = getFieldPalette('joyful')
    expect(lerpPalette(a, b, 0)).toEqual(a)
  })
})

describe('palettesApproxEqual', () => {
  it('returns true for identical palettes', () => {
    const a = getFieldPalette('neutral')
    const b = getFieldPalette('neutral')
    expect(palettesApproxEqual(a, b)).toBe(true)
  })

  it('returns true when channels differ by <= 1 (the convergence tolerance)', () => {
    const a = getFieldPalette('neutral')
    const b: FieldPalette = {
      ...a,
      bgTop: { ...a.bgTop, r: a.bgTop.r + 1 },
    }
    expect(palettesApproxEqual(a, b)).toBe(true)
  })

  it('returns false when any RGB channel differs by > 1', () => {
    const a = getFieldPalette('neutral')
    const b: FieldPalette = {
      ...a,
      bgTop: { ...a.bgTop, r: a.bgTop.r + 2 },
    }
    expect(palettesApproxEqual(a, b)).toBe(false)
  })

  it('returns false when alpha differs by > 0.01', () => {
    const a = getFieldPalette('neutral')
    const b: FieldPalette = {
      ...a,
      bgTop: { ...a.bgTop, a: a.bgTop.a - 0.5 },
    }
    expect(palettesApproxEqual(a, b)).toBe(false)
  })

  it('returns true when alpha differs by <= 0.01', () => {
    const a = getFieldPalette('neutral')
    const b: FieldPalette = {
      ...a,
      aiCore: { ...a.aiCore, a: a.aiCore.a + 0.005 },
    }
    expect(palettesApproxEqual(a, b)).toBe(true)
  })

  it('detects mismatch in any of the six keys, not just bgTop', () => {
    const a = getFieldPalette('neutral')
    const b: FieldPalette = {
      ...a,
      userText: { ...a.userText, b: a.userText.b + 50 },
    }
    expect(palettesApproxEqual(a, b)).toBe(false)
  })
})
