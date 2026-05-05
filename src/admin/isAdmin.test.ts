import { describe, it, expect } from 'vitest'
import { ADMIN_EMAILS, isAdmin } from './isAdmin'

describe('isAdmin', () => {
  it('returns true for the canonical admin email', () => {
    expect(isAdmin('zohoora@gmail.com')).toBe(true)
  })

  it('returns false for a non-admin email', () => {
    expect(isAdmin('attacker@example.com')).toBe(false)
  })

  it('returns false for null', () => {
    expect(isAdmin(null)).toBe(false)
  })

  it('returns false for undefined', () => {
    expect(isAdmin(undefined)).toBe(false)
  })

  it('returns false for empty string (Firebase Auth occasionally yields "")', () => {
    expect(isAdmin('')).toBe(false)
  })

  it('is case-sensitive — UPPERCASE variants must not pass', () => {
    // Firebase Auth normalizes to lowercase, but we still defend against any
    // mixed-case bypass. Test pins behavior in case the upstream ever changes.
    expect(isAdmin('ZOHOORA@gmail.com')).toBe(false)
    expect(isAdmin('Zohoora@Gmail.com')).toBe(false)
  })

  it('does not match substring or look-alike domains', () => {
    expect(isAdmin('zohoora@gmail.com.evil.com')).toBe(false)
    expect(isAdmin('not-zohoora@gmail.com')).toBe(false)
    expect(isAdmin('zohoora+admin@gmail.com')).toBe(false)
  })

  it('exposes the allowlist as a single canonical entry', () => {
    // If a second admin is ever added, that change should be intentional and
    // visible in a diff. This guard catches accidental allowlist drift.
    expect(ADMIN_EMAILS).toEqual(['zohoora@gmail.com'])
  })
})
