import { describe, it, expect } from 'vitest'
import {
  initialDriftState,
  driftReduce,
  outcomeForReason,
  selectInterweave,
  blsPan,
  clampPassMs,
  passMsForSoftening,
  DRIFT_LIMITS,
  DRIFT_LENGTHS,
} from './driftEngine'
import type { DriftPhase, DriftState, DriftEvent } from './driftEngine'

// Ordered phase index — the structural expression of the no-return invariant.
// set/notice/settle share a band; nothing may ever decrease this index.
const PHASE_INDEX: Record<DriftPhase, number> = {
  arrive: 0,
  anchor: 1,
  choose: 2,
  baseline: 3,
  set: 4,
  notice: 4,
  settle: 4,
  closure: 5,
  closed: 6,
}
const ALL_PHASES: DriftPhase[] = [
  'arrive', 'anchor', 'choose', 'baseline', 'set', 'notice', 'settle', 'closure', 'closed',
]

function stateIn(phase: DriftPhase, overrides: Partial<DriftState> = {}): DriftState {
  return { ...initialDriftState(), phase, ...overrides }
}

function run(events: DriftEvent[], start: DriftState = initialDriftState()): DriftState {
  return events.reduce(driftReduce, start)
}

// Walk from arrive to the first notice (one completed set).
const TO_FIRST_NOTICE: DriftEvent[] = [
  { type: 'BEGIN' },
  { type: 'ANCHOR_CONFIRMED' },
  { type: 'STARTING_POINT' },
  { type: 'BASELINE_DONE' },
  { type: 'SET_COMPLETE' },
]

describe('initialDriftState', () => {
  it('starts in arrive with zeroed counters', () => {
    const s = initialDriftState()
    expect(s.phase).toBe('arrive')
    expect(s.setCount).toBe(0)
    expect(s.sameStreak).toBe(0)
    expect(s.inSettleRecheck).toBe(false)
    expect(s.elapsedMs).toBe(0)
    expect(s.closureReason).toBeNull()
    expect(s.lastInterweave).toBeNull()
  })
})

describe('driftReduce — forward spine', () => {
  it('walks arrive → anchor → choose → baseline → set', () => {
    let s = initialDriftState()
    s = driftReduce(s, { type: 'BEGIN' })
    expect(s.phase).toBe('anchor')
    s = driftReduce(s, { type: 'ANCHOR_CONFIRMED' })
    expect(s.phase).toBe('choose')
    s = driftReduce(s, { type: 'STARTING_POINT' })
    expect(s.phase).toBe('baseline')
    s = driftReduce(s, { type: 'BASELINE_DONE' })
    expect(s.phase).toBe('set')
  })

  it('SET_COMPLETE moves set → notice and increments setCount', () => {
    const s = run(TO_FIRST_NOTICE)
    expect(s.phase).toBe('notice')
    expect(s.setCount).toBe(1)
  })

  it('spine events are no-ops from the wrong phase (one-way earlier phases)', () => {
    // BEGIN from a later phase must NOT rewind to anchor.
    const late = stateIn('choose')
    expect(driftReduce(late, { type: 'BEGIN' })).toEqual(late)
    // BASELINE_DONE only fires in baseline.
    const notBaseline = stateIn('set')
    expect(driftReduce(notBaseline, { type: 'BASELINE_DONE' })).toEqual(notBaseline)
    // NOTICE outside notice is ignored.
    const inSet = stateIn('set')
    expect(driftReduce(inSet, { type: 'NOTICE', direction: 'stronger', risk: 0, interweave: null })).toEqual(inSet)
  })
})

describe('driftReduce — happy path resolves via cap to settled', () => {
  it('six softer sets then the seventh is capped (setCount stays 6)', () => {
    const events: DriftEvent[] = [...TO_FIRST_NOTICE.slice(0, 4)] // through BASELINE_DONE (phase set)
    for (let i = 0; i < 6; i++) {
      events.push({ type: 'SET_COMPLETE' })
      events.push({ type: 'NOTICE', direction: 'softer', risk: 0, interweave: null })
    }
    let s = run(events)
    expect(s.phase).toBe('closure')
    expect(s.closureReason).toBe('cap')
    expect(s.setCount).toBe(6)
    s = driftReduce(s, { type: 'CLOSURE_DONE' })
    expect(s.phase).toBe('closed')
    expect(outcomeForReason(s.closureReason)).toBe('settled')
  })

  it('setCount never exceeds hardSetCap no matter how hard it is driven', () => {
    let s = run(TO_FIRST_NOTICE.slice(0, 4)) // phase set, setCount 0
    for (let i = 0; i < 40; i++) {
      s = driftReduce(s, { type: 'SET_COMPLETE' })
      s = driftReduce(s, { type: 'NOTICE', direction: 'softer', risk: 0, interweave: null })
      expect(s.setCount).toBeLessThanOrEqual(DRIFT_LIMITS.hardSetCap)
    }
    // The tighter setTarget bound stops it well before hardSetCap.
    expect(s.setCount).toBe(DRIFT_LIMITS.setTarget)
    expect(s.phase).toBe('closure')
    expect(s.closureReason).toBe('cap')
  })
})

describe('driftReduce — pendulation (settle branch)', () => {
  it('stronger → settle (inSettleRecheck set), re-check stronger → closure(settle) → eased_early', () => {
    let s = run(TO_FIRST_NOTICE) // notice, inSettleRecheck false
    s = driftReduce(s, { type: 'NOTICE', direction: 'stronger', risk: 0, interweave: null })
    expect(s.phase).toBe('settle')
    expect(s.inSettleRecheck).toBe(true)
    s = driftReduce(s, { type: 'SETTLE_DONE' })
    expect(s.phase).toBe('notice')
    expect(s.inSettleRecheck).toBe(true) // stays true until a non-stronger notice
    s = driftReduce(s, { type: 'NOTICE', direction: 'stronger', risk: 0, interweave: null })
    expect(s.phase).toBe('closure')
    expect(s.closureReason).toBe('settle')
    expect(outcomeForReason(s.closureReason)).toBe('eased_early')
  })

  it('stronger → settle → softer clears inSettleRecheck and returns to set', () => {
    let s = run(TO_FIRST_NOTICE)
    s = driftReduce(s, { type: 'NOTICE', direction: 'stronger', risk: 0, interweave: null })
    s = driftReduce(s, { type: 'SETTLE_DONE' })
    s = driftReduce(s, { type: 'NOTICE', direction: 'softer', risk: 0, interweave: null })
    expect(s.phase).toBe('set')
    expect(s.inSettleRecheck).toBe(false)
  })

  it('L2 risk=1 routes like stronger (overrides a softer pill)', () => {
    let s = run(TO_FIRST_NOTICE)
    s = driftReduce(s, { type: 'NOTICE', direction: 'softer', risk: 1, interweave: null })
    expect(s.phase).toBe('settle')
    expect(s.inSettleRecheck).toBe(true)
  })
})

describe('driftReduce — stuck detection', () => {
  it('two consecutive "same" notices → closure(stuck) → settled', () => {
    let s = run(TO_FIRST_NOTICE) // notice, setCount 1
    s = driftReduce(s, { type: 'NOTICE', direction: 'same', risk: 0, interweave: null })
    expect(s.phase).toBe('set')
    expect(s.sameStreak).toBe(1)
    s = driftReduce(s, { type: 'SET_COMPLETE' })
    s = driftReduce(s, { type: 'NOTICE', direction: 'same', risk: 0, interweave: null })
    expect(s.phase).toBe('closure')
    expect(s.closureReason).toBe('stuck')
    expect(outcomeForReason(s.closureReason)).toBe('settled')
  })

  it('a softer notice resets the same-streak', () => {
    let s = run(TO_FIRST_NOTICE)
    s = driftReduce(s, { type: 'NOTICE', direction: 'same', risk: 0, interweave: null }) // streak 1 → set
    s = driftReduce(s, { type: 'SET_COMPLETE' })
    s = driftReduce(s, { type: 'NOTICE', direction: 'softer', risk: 0, interweave: null }) // reset
    expect(s.sameStreak).toBe(0)
    expect(s.phase).toBe('set')
  })
})

describe('driftReduce — interweave record (cooldown input)', () => {
  it('NOTICE records the interweave used; a null-interweave exchange clears it', () => {
    let s = run(TO_FIRST_NOTICE)
    s = driftReduce(s, { type: 'NOTICE', direction: 'softer', risk: 0, interweave: 'rain' })
    expect(s.lastInterweave).toBe('rain')
    s = driftReduce(s, { type: 'SET_COMPLETE' })
    s = driftReduce(s, { type: 'NOTICE', direction: 'softer', risk: 0, interweave: null })
    expect(s.lastInterweave).toBeNull()
  })
})

describe('driftReduce — caps', () => {
  it('a softer notice at the set target closes via cap', () => {
    const s = stateIn('notice', { setCount: DRIFT_LIMITS.setTarget })
    const next = driftReduce(s, { type: 'NOTICE', direction: 'softer', risk: 0, interweave: null })
    expect(next.phase).toBe('closure')
    expect(next.closureReason).toBe('cap')
  })

  it('TICK past maxSessionMs in the active loop closes via cap', () => {
    for (const phase of ['set', 'notice', 'settle'] as DriftPhase[]) {
      const s = stateIn(phase)
      const next = driftReduce(s, { type: 'TICK', elapsedMs: DRIFT_LIMITS.maxSessionMs })
      expect(next.phase).toBe('closure')
      expect(next.closureReason).toBe('cap')
    }
  })

  it('TICK only updates elapsedMs outside the active loop', () => {
    const s = stateIn('anchor')
    const next = driftReduce(s, { type: 'TICK', elapsedMs: DRIFT_LIMITS.maxSessionMs + 5000 })
    expect(next.phase).toBe('anchor')
    expect(next.elapsedMs).toBe(DRIFT_LIMITS.maxSessionMs + 5000)
  })
})

describe('driftReduce — user close', () => {
  it('REQUEST_CLOSE from set/notice/settle → closure(user) → eased_early', () => {
    for (const phase of ['set', 'notice', 'settle'] as DriftPhase[]) {
      const next = driftReduce(stateIn(phase), { type: 'REQUEST_CLOSE' })
      expect(next.phase).toBe('closure')
      expect(next.closureReason).toBe('user')
      expect(outcomeForReason(next.closureReason)).toBe('eased_early')
    }
  })

  it('REQUEST_CLOSE is reachable from anchor onward (never a dead exit)', () => {
    for (const phase of ['anchor', 'choose', 'baseline'] as DriftPhase[]) {
      expect(driftReduce(stateIn(phase), { type: 'REQUEST_CLOSE' }).phase).toBe('closure')
    }
  })

  it('REQUEST_CLOSE is a no-op in arrive / closure / closed', () => {
    for (const phase of ['arrive', 'closure', 'closed'] as DriftPhase[]) {
      const s = stateIn(phase, { closureReason: phase === 'arrive' ? null : 'user' })
      expect(driftReduce(s, { type: 'REQUEST_CLOSE' })).toEqual(s)
    }
  })
})

describe('driftReduce — CRISIS from every phase', () => {
  it('routes to closure(crisis) from every non-closed phase', () => {
    for (const phase of ALL_PHASES) {
      const s = stateIn(phase)
      const next = driftReduce(s, { type: 'CRISIS' })
      if (phase === 'closed') {
        expect(next).toEqual(s) // no reopening a closed session
      } else {
        expect(next.phase).toBe('closure')
        expect(next.closureReason).toBe('crisis')
        expect(outcomeForReason(next.closureReason)).toBe('aborted_to_grounding')
      }
    }
  })

  it('crisis is sticky — a later REQUEST_CLOSE cannot downgrade the reason', () => {
    let s = run(TO_FIRST_NOTICE)
    s = driftReduce(s, { type: 'CRISIS' })
    expect(s.closureReason).toBe('crisis')
    s = driftReduce(s, { type: 'REQUEST_CLOSE' })
    expect(s.phase).toBe('closure')
    expect(s.closureReason).toBe('crisis')
  })

  it('crisis upgrades an existing user-close, but crisis-close ignores further crisis idempotently', () => {
    const userClosed = stateIn('closure', { closureReason: 'user' })
    const upgraded = driftReduce(userClosed, { type: 'CRISIS' })
    expect(upgraded.closureReason).toBe('crisis')
    const again = driftReduce(upgraded, { type: 'CRISIS' })
    expect(again.closureReason).toBe('crisis')
  })

  it('risk=2 in a notice closes to crisis regardless of direction', () => {
    const s = run(TO_FIRST_NOTICE)
    const next = driftReduce(s, { type: 'NOTICE', direction: 'softer', risk: 2, interweave: null })
    expect(next.phase).toBe('closure')
    expect(next.closureReason).toBe('crisis')
  })
})

describe('driftReduce — closure and closed are terminal', () => {
  it('CLOSURE_DONE moves closure → closed, and only from closure', () => {
    const closed = driftReduce(stateIn('closure', { closureReason: 'settle' }), { type: 'CLOSURE_DONE' })
    expect(closed.phase).toBe('closed')
    // No other phase reaches closed.
    expect(driftReduce(stateIn('notice'), { type: 'CLOSURE_DONE' }).phase).toBe('notice')
  })

  it('a closed state absorbs all further events without moving', () => {
    const closed = stateIn('closed', { closureReason: 'settle' })
    for (const ev of SAMPLE_EVENTS) {
      expect(driftReduce(closed, ev).phase).toBe('closed')
    }
  })
})

// Representative events used for the structural sweep.
const SAMPLE_EVENTS: DriftEvent[] = [
  { type: 'BEGIN' },
  { type: 'ANCHOR_CONFIRMED' },
  { type: 'STARTING_POINT' },
  { type: 'BASELINE_DONE' },
  { type: 'SET_COMPLETE' },
  { type: 'NOTICE', direction: 'softer', risk: 0, interweave: null },
  { type: 'NOTICE', direction: 'same', risk: 0, interweave: null },
  { type: 'NOTICE', direction: 'stronger', risk: 0, interweave: null },
  { type: 'NOTICE', direction: 'skipped', risk: 1, interweave: null },
  { type: 'NOTICE', direction: 'softer', risk: 2, interweave: null },
  { type: 'SETTLE_DONE' },
  { type: 'REQUEST_CLOSE' },
  { type: 'CRISIS' },
  { type: 'CLOSURE_DONE' },
  { type: 'TICK', elapsedMs: 1000 },
  { type: 'TICK', elapsedMs: 999_999 },
]

describe('driftReduce — structural no-return invariant', () => {
  it('no (phase, event) pair ever decreases the phase index', () => {
    const bases: Partial<DriftState>[] = [
      { setCount: 0, sameStreak: 0, inSettleRecheck: false },
      { setCount: 3, sameStreak: 1, inSettleRecheck: false },
      { setCount: DRIFT_LIMITS.setTarget, sameStreak: 1, inSettleRecheck: true },
    ]
    for (const phase of ALL_PHASES) {
      for (const base of bases) {
        const s = stateIn(phase, base)
        for (const ev of SAMPLE_EVENTS) {
          const next = driftReduce(s, ev)
          expect(PHASE_INDEX[next.phase]).toBeGreaterThanOrEqual(PHASE_INDEX[phase])
        }
      }
    }
  })
})

describe('outcomeForReason', () => {
  it('maps every closure reason to the right outcome', () => {
    expect(outcomeForReason('stuck')).toBe('settled')
    expect(outcomeForReason('cap')).toBe('settled')
    expect(outcomeForReason('user')).toBe('eased_early')
    expect(outcomeForReason('settle')).toBe('eased_early')
    expect(outcomeForReason('crisis')).toBe('aborted_to_grounding')
    expect(outcomeForReason(null)).toBe('settled')
  })
})

describe('selectInterweave', () => {
  const base = { lastInterweave: null, grounding: false, userPartNames: [] as string[] }

  it('detects each category', () => {
    expect(selectInterweave('i feel so sad today', base)).toBe('rain')
    expect(selectInterweave('i keep thinking about it', base)).toBe('defusion')
    expect(selectInterweave('a part of me wants to run', base)).toBe('parts')
    expect(selectInterweave('my throat feels tight', base)).toBe('focusing')
  })

  it('matches defusion phrases with straight or curly apostrophes', () => {
    expect(selectInterweave('i\'m such a mess', base)).toBe('defusion')
    expect(selectInterweave('i’m such a mess', base)).toBe('defusion')
    expect(selectInterweave('i shouldn\'t have said it', base)).toBe('defusion')
  })

  it('prioritises parts over rain when both are present', () => {
    expect(selectInterweave('a part of me is so sad', base)).toBe('parts')
  })

  it('treats an emotion-laden body word as rain, not focusing', () => {
    // "heavy" is a tenderness word; it outranks the "heavy in" focusing phrase.
    expect(selectInterweave('it feels heavy in my chest', base)).toBe('rain')
  })

  it('matches a mapped user part name as a whole word', () => {
    expect(selectInterweave('the critic is loud again', { ...base, userPartNames: ['The Critic'] })).toBe('parts')
    // Substring-only overlap must NOT match.
    expect(selectInterweave('i was very critical of myself', { ...base, userPartNames: ['Critic'] })).toBeNull()
  })

  it('applies a one-exchange cooldown', () => {
    expect(selectInterweave('i feel sad', { ...base, lastInterweave: 'rain' })).toBeNull()
    // A different category is still eligible.
    expect(selectInterweave('a part of me is sad', { ...base, lastInterweave: 'rain' })).toBe('parts')
  })

  it('never fires under grounding', () => {
    expect(selectInterweave('a part of me is so sad', { ...base, grounding: true })).toBeNull()
  })

  it('returns null when nothing matches', () => {
    expect(selectInterweave('we walked by the river at noon', base)).toBeNull()
  })
})

describe('blsPan / clampPassMs', () => {
  it('clamps pass duration to [1500, 2500]', () => {
    expect(clampPassMs(900)).toBe(1500)
    expect(clampPassMs(9000)).toBe(2500)
    expect(clampPassMs(2000)).toBe(2000)
  })

  it('stays within [-1, 1] and moves continuously', () => {
    let prev = blsPan(0, 1500)
    for (let t = 8; t <= 6000; t += 8) {
      const p = blsPan(t, 1500)
      expect(Math.abs(p)).toBeLessThanOrEqual(1 + 1e-9)
      expect(Math.abs(p - prev)).toBeLessThan(0.1) // no snap between rAF frames
      prev = p
    }
  })

  it('reaches both extremes across one full cycle', () => {
    // one full sweep spans 2 * passMs
    let min = 1
    let max = -1
    for (let t = 0; t <= 3000; t += 5) {
      const p = blsPan(t, 1500)
      min = Math.min(min, p)
      max = Math.max(max, p)
    }
    expect(min).toBeLessThan(-0.98)
    expect(max).toBeGreaterThan(0.98)
  })
})

// ── v2 additions (2026-07-09 redesign) ───────────────────────────────────────
// The machine above is untouched; these cover the parameterized lengths and
// the softening counters that drive pacing + the closure contrast line.

describe('driftReduce — v2 length parameterization', () => {
  it('defaults to the v1 limits when BEGIN carries no length', () => {
    const s = driftReduce(initialDriftState(), { type: 'BEGIN' })
    expect(s.limits).toEqual({
      setTarget: DRIFT_LIMITS.setTarget,
      setMs: DRIFT_LIMITS.setMs,
      maxSessionMs: DRIFT_LIMITS.maxSessionMs,
    })
  })

  it('BEGIN with a length fixes the active limits for the session', () => {
    const s = driftReduce(initialDriftState(), { type: 'BEGIN', length: 'quick' })
    expect(s.limits).toEqual(DRIFT_LENGTHS.quick)
  })

  it('a quick drift closes via cap after its 2nd round', () => {
    let s = run([
      { type: 'BEGIN', length: 'quick' },
      { type: 'ANCHOR_CONFIRMED' },
      { type: 'STARTING_POINT' },
      { type: 'BASELINE_DONE' },
    ])
    for (let i = 0; i < DRIFT_LENGTHS.quick.setTarget; i++) {
      s = driftReduce(s, { type: 'SET_COMPLETE' })
      s = driftReduce(s, { type: 'NOTICE', direction: 'softer', risk: 0, interweave: null })
    }
    expect(s.setCount).toBe(DRIFT_LENGTHS.quick.setTarget)
    expect(s.phase).toBe('closure')
    expect(s.closureReason).toBe('cap')
    expect(outcomeForReason(s.closureReason)).toBe('settled')
  })

  it('TICK respects the active maxSessionMs, not the global default', () => {
    let s = run([
      { type: 'BEGIN', length: 'quick' },
      { type: 'ANCHOR_CONFIRMED' },
      { type: 'STARTING_POINT' },
      { type: 'BASELINE_DONE' },
    ])
    s = driftReduce(s, { type: 'TICK', elapsedMs: DRIFT_LENGTHS.quick.maxSessionMs })
    expect(s.phase).toBe('closure')
    expect(s.closureReason).toBe('cap')
  })

  it('every preset stays at or under the absolute hard cap', () => {
    for (const preset of Object.values(DRIFT_LENGTHS)) {
      expect(preset.setTarget).toBeLessThanOrEqual(DRIFT_LIMITS.hardSetCap)
    }
  })
})

describe('driftReduce — v2 softening counters', () => {
  const notice = (direction: 'softer' | 'same' | 'stronger' | 'skipped'): DriftEvent =>
    ({ type: 'NOTICE', direction, risk: 0, interweave: null })

  it('softer increments streak and total; same resets streak but keeps total', () => {
    let s = run(TO_FIRST_NOTICE)
    s = driftReduce(s, notice('softer'))
    expect(s.softerStreak).toBe(1)
    expect(s.softerTotal).toBe(1)
    s = driftReduce(s, { type: 'SET_COMPLETE' })
    s = driftReduce(s, notice('same'))
    expect(s.softerStreak).toBe(0)
    expect(s.softerTotal).toBe(1)
  })

  it('skipped is neutral — keeps the streak, does not count as softening', () => {
    let s = run(TO_FIRST_NOTICE)
    s = driftReduce(s, notice('softer'))
    s = driftReduce(s, { type: 'SET_COMPLETE' })
    s = driftReduce(s, notice('skipped'))
    expect(s.softerStreak).toBe(1)
    expect(s.softerTotal).toBe(1)
  })

  it('stronger (pendulation) resets the streak but keeps the total', () => {
    let s = run(TO_FIRST_NOTICE)
    s = driftReduce(s, notice('softer'))
    s = driftReduce(s, { type: 'SET_COMPLETE' })
    s = driftReduce(s, notice('stronger'))
    expect(s.phase).toBe('settle')
    expect(s.softerStreak).toBe(0)
    expect(s.softerTotal).toBe(1)
  })

  it('a final softer that lands on the cap is still recorded (closure contrast)', () => {
    let s = run([
      { type: 'BEGIN', length: 'quick' },
      { type: 'ANCHOR_CONFIRMED' },
      { type: 'STARTING_POINT' },
      { type: 'BASELINE_DONE' },
    ])
    // A softer landing exactly on the round target —
    // toSet's cap branch must not drop that last increment. (No two 'same's,
    // which would close via stuck before the cap is ever reached.)
    const directions = ['skipped', 'softer'] as const
    for (const d of directions) {
      s = driftReduce(s, { type: 'SET_COMPLETE' })
      s = driftReduce(s, notice(d))
    }
    expect(s.phase).toBe('closure')
    expect(s.closureReason).toBe('cap')
    expect(s.softerTotal).toBe(1) // includes the cap-landing softer
  })
})

describe('passMsForSoftening', () => {
  it('starts at 2000ms and slows 200ms per consecutive softer, clamped at the pass bound', () => {
    expect(passMsForSoftening(0)).toBe(2000)
    expect(passMsForSoftening(1)).toBe(2200)
    expect(passMsForSoftening(2)).toBe(2400)
    expect(passMsForSoftening(3)).toBe(DRIFT_LIMITS.passMsMax)
    expect(passMsForSoftening(10)).toBe(DRIFT_LIMITS.passMsMax)
  })
})
