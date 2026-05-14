import { describe, it, expect } from 'vitest'
import {
  breathPhase,
  breathScale,
  computeAdaptiveBpm,
  cycleMs,
  getNarrationCues,
  getTargetRespRate,
  nextNarrationCue,
} from './relaxEngine'
import type { RelaxSessionType } from '../types'

const ALL_TYPES: readonly RelaxSessionType[] = ['breathwork', 'body_scan', 'safe_place', 'open_awareness']

describe('relaxEngine', () => {
  describe('getTargetRespRate', () => {
    it('returns 5.5 BPM for breathwork (canonical resonance frequency)', () => {
      expect(getTargetRespRate('breathwork')).toBe(5.5)
    })
    it('returns a sensible BPM for every session type', () => {
      for (const t of ALL_TYPES) {
        const bpm = getTargetRespRate(t)
        expect(bpm).toBeGreaterThan(3)
        expect(bpm).toBeLessThan(12)
      }
    })
  })

  describe('cycleMs', () => {
    it('5.5 BPM → ~10909 ms', () => {
      expect(cycleMs(5.5)).toBe(10909)
    })
    it('6 BPM → 10000 ms', () => {
      expect(cycleMs(6)).toBe(10000)
    })
  })

  describe('breathPhase', () => {
    it('returns 0 at t=0', () => {
      expect(breathPhase(0, 5.5)).toBe(0)
    })
    it('always in [0, 1)', () => {
      for (const t of [0, 1, 1000, 5000, 9999, 100_000, 1_000_000]) {
        const p = breathPhase(t, 5.5)
        expect(p).toBeGreaterThanOrEqual(0)
        expect(p).toBeLessThan(1)
      }
    })
    it('is periodic — phase(t) ≈ phase(t + cycle)', () => {
      const bpm = 5.5
      const cycle = cycleMs(bpm)
      for (const t of [0, 500, 2000, 8000]) {
        expect(Math.abs(breathPhase(t, bpm) - breathPhase(t + cycle, bpm))).toBeLessThan(0.001)
      }
    })
    it('handles negative elapsedMs without going negative', () => {
      const p = breathPhase(-500, 5.5)
      expect(p).toBeGreaterThanOrEqual(0)
      expect(p).toBeLessThan(1)
    })
  })

  describe('breathScale', () => {
    it('0 at phase=0 (start of inhale)', () => {
      expect(breathScale(0)).toBeCloseTo(0, 5)
    })
    it('1 at phase=0.5 (peak / end of inhale)', () => {
      expect(breathScale(0.5)).toBeCloseTo(1, 5)
    })
    it('0 at phase=1 (end of exhale, wraps to start)', () => {
      expect(breathScale(1)).toBeCloseTo(0, 5)
    })
    it('monotone increasing on [0, 0.5]', () => {
      for (let i = 0; i < 10; i++) {
        const a = i / 20
        const b = (i + 1) / 20
        expect(breathScale(b)).toBeGreaterThan(breathScale(a))
      }
    })
    it('monotone decreasing on [0.5, 1]', () => {
      for (let i = 10; i < 20; i++) {
        const a = i / 20
        const b = (i + 1) / 20
        expect(breathScale(b)).toBeLessThan(breathScale(a))
      }
    })
  })

  describe('computeAdaptiveBpm', () => {
    it('returns null when respiratoryRate is null', () => {
      expect(computeAdaptiveBpm(null, 5.5)).toBeNull()
    })
    it('returns null for clearly noisy values (below 4 BPM)', () => {
      expect(computeAdaptiveBpm(2, 5.5)).toBeNull()
      expect(computeAdaptiveBpm(3.9, 5.5)).toBeNull()
    })
    it('returns null for clearly noisy values (above 30 BPM)', () => {
      expect(computeAdaptiveBpm(35, 5.5)).toBeNull()
      expect(computeAdaptiveBpm(60, 5.5)).toBeNull()
    })
    it('returns userRR × 0.95 when above the session-target floor', () => {
      // 12 BPM × 0.95 = 11.4 > 5.5 floor
      expect(computeAdaptiveBpm(12, 5.5)).toBeCloseTo(11.4, 5)
    })
    it('floors at the session target when the lead would drive below', () => {
      // 5 BPM × 0.95 = 4.75 < 5.5 floor → 5.5
      expect(computeAdaptiveBpm(5, 5.5)).toBe(5.5)
    })
    it('respects different session targets', () => {
      // 5 BPM × 0.95 = 4.75, body_scan target 5.0 → 5.0
      expect(computeAdaptiveBpm(5, 5.0)).toBe(5.0)
    })
    it('produces the leading-attractor pattern across iterations', () => {
      // Simulate user following the lead — each step the user matches the
      // previous animation BPM, the new BPM drops by 5%, asymptote at floor.
      const floor = 5.5
      let userRR = 18
      const trail: number[] = []
      for (let i = 0; i < 30; i++) {
        const next = computeAdaptiveBpm(userRR, floor)
        if (next === null) break
        trail.push(next)
        userRR = next
      }
      // Reaches the floor within ~25 iterations
      expect(trail[trail.length - 1]).toBe(floor)
      // Monotonically non-increasing
      for (let i = 1; i < trail.length; i++) {
        expect(trail[i]).toBeLessThanOrEqual(trail[i - 1])
      }
    })
    it('treats the [4, 30] range as inclusive', () => {
      // Floor at 1.0 so the lead value isn't masked by the session-target clamp.
      expect(computeAdaptiveBpm(4, 1)).toBeCloseTo(3.8, 5)
      expect(computeAdaptiveBpm(30, 1)).toBeCloseTo(28.5, 5)
    })
  })

  describe('narration cues', () => {
    it('every session type has at least one cue', () => {
      for (const t of ALL_TYPES) {
        expect(getNarrationCues(t).length).toBeGreaterThan(0)
      }
    })
    it('cues are sorted ascending by atMs', () => {
      for (const t of ALL_TYPES) {
        const cues = getNarrationCues(t)
        for (let i = 1; i < cues.length; i++) {
          expect(cues[i].atMs).toBeGreaterThan(cues[i - 1].atMs)
        }
      }
    })
  })

  describe('nextNarrationCue', () => {
    it('returns null when elapsed is before the first cue', () => {
      expect(nextNarrationCue('breathwork', 1000, 0)).toBeNull()
    })
    it('returns the cue scheduled in (lastEmittedAtMs, elapsedMs]', () => {
      const cue = nextNarrationCue('breathwork', 5000, 0)
      expect(cue).not.toBeNull()
      expect(cue!.atMs).toBe(3000)
    })
    it('does not return an already-emitted cue', () => {
      expect(nextNarrationCue('breathwork', 5000, 3000)).toBeNull()
    })
    it('returns the next pending cue across a window', () => {
      const cue = nextNarrationCue('breathwork', 15000, 3000)
      expect(cue).not.toBeNull()
      expect(cue!.atMs).toBe(12000)
    })
    it('does not skip cues — returns the earliest pending one in range', () => {
      // Caller advances lastEmittedAtMs incrementally; the engine emits one cue per call.
      const first = nextNarrationCue('breathwork', 60_000, 0)!
      expect(first.atMs).toBe(3000)
      const second = nextNarrationCue('breathwork', 60_000, first.atMs)!
      expect(second.atMs).toBe(12000)
    })
  })
})
