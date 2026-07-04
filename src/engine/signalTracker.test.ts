import { describe, it, expect } from 'vitest'
import { SignalTracker } from './signalTracker'

const calm = { withdrawal: 0, rumination: 0 } as const
const ruminating = { withdrawal: 0, rumination: 2 } as const
const withdrawing = { withdrawal: 2, rumination: 0 } as const

describe('SignalTracker — pivot (rumination)', () => {
  it('does NOT arm on a single elevated turn', () => {
    const t = new SignalTracker()
    expect(t.record(ruminating).pivotActive).toBe(false)
  })

  it('arms on the 2nd consecutive elevated turn', () => {
    const t = new SignalTracker()
    t.record(ruminating)
    expect(t.record(ruminating).pivotActive).toBe(true)
  })

  it('a calm turn between elevated turns resets the streak', () => {
    const t = new SignalTracker()
    t.record(ruminating)
    t.record(calm)
    expect(t.record(ruminating).pivotActive).toBe(false)
  })

  it('level 1 does not count toward the streak', () => {
    const t = new SignalTracker()
    t.record({ withdrawal: 0, rumination: 1 })
    expect(t.record(ruminating).pivotActive).toBe(false)
  })

  it('after arming, cooldown blocks re-arming for 6 turns, then allows it', () => {
    const t = new SignalTracker()
    t.record(ruminating)
    expect(t.record(ruminating).pivotActive).toBe(true) // armed; cooldown starts
    // 6 turns of sustained rumination during cooldown: never re-arms.
    for (let i = 0; i < 6; i++) {
      expect(t.record(ruminating).pivotActive).toBe(false)
    }
    // Cooldown over; sustained elevation may arm again (streak already >= 2).
    expect(t.record(ruminating).pivotActive).toBe(true)
  })

  it('pivotActive is true only on the arming turn, not held', () => {
    const t = new SignalTracker()
    t.record(ruminating)
    expect(t.record(ruminating).pivotActive).toBe(true)
    expect(t.record(calm).pivotActive).toBe(false)
  })
})

describe('SignalTracker — soften (withdrawal)', () => {
  it('arms on the 2nd consecutive elevated turn and HOLDS while elevated', () => {
    const t = new SignalTracker()
    expect(t.record(withdrawing).softenActive).toBe(false)
    expect(t.record(withdrawing).softenActive).toBe(true)
    expect(t.record(withdrawing).softenActive).toBe(true) // held, not one-shot
  })

  it('releases only after 2 consecutive zero turns', () => {
    const t = new SignalTracker()
    t.record(withdrawing)
    t.record(withdrawing) // armed
    expect(t.record(calm).softenActive).toBe(true) // one zero: still soft
    expect(t.record(calm).softenActive).toBe(false) // two zeros: released
  })

  it('a non-zero turn interrupts the release countdown', () => {
    const t = new SignalTracker()
    t.record(withdrawing)
    t.record(withdrawing) // armed
    t.record(calm)
    t.record({ withdrawal: 1, rumination: 0 }) // interrupts release
    expect(t.record(calm).softenActive).toBe(true) // countdown restarted
  })
})

describe('SignalTracker — reset', () => {
  it('clears all streaks, cooldowns, and active states', () => {
    const t = new SignalTracker()
    t.record(ruminating)
    t.record(ruminating) // pivot armed, cooldown running
    t.record(withdrawing)
    t.record(withdrawing) // soften armed
    t.reset()
    expect(t.record(calm).softenActive).toBe(false)
    t.record(ruminating)
    // Fresh streak needed post-reset, and no cooldown carryover blocking it.
    expect(t.record(ruminating).pivotActive).toBe(true)
  })
})
