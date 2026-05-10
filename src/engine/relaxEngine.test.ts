import { describe, it, expect } from 'vitest'
import {
  breathPhase,
  breathScale,
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
