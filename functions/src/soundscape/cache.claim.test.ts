// Pure-logic tests for the soundscape generation-claim dedup (D5). The full
// getOrCreateSoundscape flow needs Firestore + Storage; these cover the two
// decision functions the transaction and hit-path rely on.
import { describe, it, expect } from 'vitest'
import { isSidecarReady, shouldClaimGeneration } from './cache'

describe('isSidecarReady', () => {
  it('is false when the doc does not exist', () => {
    expect(isSidecarReady({ exists: false })).toBe(false)
  })
  it('is false while a generation claim is pending', () => {
    expect(isSidecarReady({ exists: true, status: 'generating' })).toBe(false)
  })
  it('is true for a ready doc', () => {
    expect(isSidecarReady({ exists: true, status: 'ready' })).toBe(true)
  })
  it('treats a legacy doc with no status as ready', () => {
    expect(isSidecarReady({ exists: true })).toBe(true)
  })
})

describe('shouldClaimGeneration', () => {
  const NOW = 1_000_000

  it('claims when no doc exists', () => {
    expect(shouldClaimGeneration({ exists: false }, NOW)).toBe(true)
  })
  it('does NOT claim when the doc is already ready', () => {
    expect(shouldClaimGeneration({ exists: true, status: 'ready' }, NOW)).toBe(false)
  })
  it('does NOT claim when another request holds a fresh generating claim', () => {
    expect(shouldClaimGeneration({ exists: true, status: 'generating', claimedAt: NOW - 5_000 }, NOW)).toBe(false)
  })
  it('re-claims when the generating claim has gone stale (orphaned generator)', () => {
    expect(shouldClaimGeneration({ exists: true, status: 'generating', claimedAt: NOW - 31_000 }, NOW)).toBe(true)
  })
  it('re-claims a generating doc with no claimedAt (treated as ancient)', () => {
    expect(shouldClaimGeneration({ exists: true, status: 'generating' }, NOW)).toBe(true)
  })
})
