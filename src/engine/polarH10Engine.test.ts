import { describe, it, expect } from 'vitest'
import {
  parseHeartRateMeasurement,
  trimRrBuffer,
  computeConfidence,
  computeTrend,
  composeMeasurement,
  PolarH10Engine,
  type RrSample,
} from './polarH10Engine'

/** Build a DataView from a byte sequence — keeps the spec-shaped tests readable. */
function view(...bytes: number[]): DataView {
  const buf = new ArrayBuffer(bytes.length)
  const dv = new DataView(buf)
  bytes.forEach((b, i) => dv.setUint8(i, b))
  return dv
}

/** Little-endian uint16 split helper for legibility in test payloads. */
function u16(value: number): [number, number] {
  return [value & 0xff, (value >> 8) & 0xff]
}

describe('parseHeartRateMeasurement', () => {
  describe('HR value format', () => {
    it('parses 8-bit HR with no extras', () => {
      // flags=0x00, hr=72
      const out = parseHeartRateMeasurement(view(0x00, 72))
      expect(out.hr).toBe(72)
      expect(out.rrIntervals).toEqual([])
    })

    it('parses 16-bit HR (LE) with no extras', () => {
      // flags=0x01 (HR is uint16), hr=300 little-endian
      const out = parseHeartRateMeasurement(view(0x01, ...u16(300)))
      expect(out.hr).toBe(300)
      expect(out.rrIntervals).toEqual([])
    })
  })

  describe('RR intervals', () => {
    it('converts 1024-tick RR to exactly 1000 ms', () => {
      // flags=0x10 (RR present), hr=60, rr=1024 ticks
      const out = parseHeartRateMeasurement(view(0x10, 60, ...u16(1024)))
      expect(out.hr).toBe(60)
      expect(out.rrIntervals).toEqual([1000])
    })

    it('parses multiple RR intervals in one notification', () => {
      // flags=0x10, hr=60, three RRs: 1024 (1000ms), 819 (~800ms), 1229 (~1200ms)
      const out = parseHeartRateMeasurement(
        view(0x10, 60, ...u16(1024), ...u16(819), ...u16(1229)),
      )
      expect(out.hr).toBe(60)
      expect(out.rrIntervals).toHaveLength(3)
      expect(out.rrIntervals[0]).toBeCloseTo(1000, 3)
      expect(out.rrIntervals[1]).toBeCloseTo(799.8, 1)
      expect(out.rrIntervals[2]).toBeCloseTo(1200.2, 1)
    })

    it('preserves sub-millisecond resolution from 1/1024 s ticks', () => {
      // 1025 ticks = 1000.976... ms (a value that would round-trip lossy
      // if we coerced to int). Keep float.
      const out = parseHeartRateMeasurement(view(0x10, 60, ...u16(1025)))
      expect(out.rrIntervals[0]).toBeCloseTo(1000.977, 2)
      expect(out.rrIntervals[0]).not.toBe(1001) // not silently rounded up
    })

    it('returns empty RR list when RR flag is unset, even with trailing bytes', () => {
      // flags=0x00 (no RR), but extra bytes after HR — must be ignored.
      const out = parseHeartRateMeasurement(view(0x00, 60, 0x00, 0x04))
      expect(out.rrIntervals).toEqual([])
    })
  })

  describe('Energy-expended field', () => {
    it('skips energy-expended bytes when energy flag set', () => {
      // flags=0b00011000 = 0x18 (energy present, RR present)
      // bytes: flags, hr8=60, energy16=1000 (skipped), rr16=1024 (→1000ms)
      const out = parseHeartRateMeasurement(
        view(0x18, 60, ...u16(1000), ...u16(1024)),
      )
      expect(out.hr).toBe(60)
      expect(out.rrIntervals).toEqual([1000])
    })

    it('handles 16-bit HR + energy + RR together', () => {
      // flags=0b00011001 = 0x19 (HR uint16, energy, RR)
      const out = parseHeartRateMeasurement(
        view(0x19, ...u16(72), ...u16(500), ...u16(1024), ...u16(1024)),
      )
      expect(out.hr).toBe(72)
      expect(out.rrIntervals).toEqual([1000, 1000])
    })
  })

  describe('Defensive parsing', () => {
    it('returns zero HR when payload is shorter than flags+HR', () => {
      expect(parseHeartRateMeasurement(view(0x00))).toEqual({ hr: 0, rrIntervals: [] })
    })

    it('truncated 16-bit HR yields zero — does not throw', () => {
      // flags=0x01 (HR uint16) but only one HR byte present
      const out = parseHeartRateMeasurement(view(0x01, 60))
      expect(out.hr).toBe(0)
      expect(out.rrIntervals).toEqual([])
    })

    it('truncated RR pair is silently dropped (no half-read)', () => {
      // flags=0x10, hr=60, one valid RR (1024 ticks), then one stray byte
      const out = parseHeartRateMeasurement(view(0x10, 60, ...u16(1024), 0x00))
      expect(out.rrIntervals).toEqual([1000])
    })
  })
})

describe('trimRrBuffer', () => {
  it('drops samples older than the window', () => {
    const buf: RrSample[] = [
      { rr: 1000, t: 0 },
      { rr: 1000, t: 5_000 },
      { rr: 1000, t: 20_000 },
      { rr: 1000, t: 35_000 },
    ]
    trimRrBuffer(buf, /* now */ 40_000, /* window */ 30_000)
    expect(buf.map(s => s.t)).toEqual([20_000, 35_000])
  })

  it('keeps the buffer intact when all samples are within window', () => {
    const buf: RrSample[] = [{ rr: 800, t: 1000 }, { rr: 800, t: 2000 }]
    trimRrBuffer(buf, 5000, 30_000)
    expect(buf).toHaveLength(2)
  })

  it('empties the buffer when all samples are stale', () => {
    const buf: RrSample[] = [{ rr: 800, t: 0 }, { rr: 800, t: 1000 }]
    trimRrBuffer(buf, 100_000, 30_000)
    expect(buf).toHaveLength(0)
  })
})

describe('computeConfidence', () => {
  it('returns 0 when fewer than 5 samples', () => {
    expect(computeConfidence(0, 60)).toBe(0)
    expect(computeConfidence(4, 60)).toBe(0)
  })

  it('reaches 1.0 at 15 samples with plausible HR', () => {
    expect(computeConfidence(15, 60)).toBe(1)
    expect(computeConfidence(20, 80)).toBe(1)
  })

  it('ramps between 0.4 and 1.0 from 5 → 15 samples', () => {
    expect(computeConfidence(5, 60)).toBeCloseTo(0.4, 5)
    expect(computeConfidence(10, 60)).toBeCloseTo(0.7, 5)
    expect(computeConfidence(14, 60)).toBeCloseTo(0.94, 2)
  })

  it('clamps to 0.3 when HR is outside [40,200]', () => {
    expect(computeConfidence(20, 35)).toBe(0.3)
    expect(computeConfidence(20, 210)).toBe(0.3)
    expect(computeConfidence(20, 41)).toBe(1)
  })
})

describe('computeTrend', () => {
  it('returns steady when fewer than 4 samples', () => {
    expect(computeTrend([])).toBe('steady')
    expect(computeTrend([30, 32, 31])).toBe('steady')
  })

  it('detects rising when second half is >10% higher', () => {
    expect(computeTrend([30, 30, 40, 40])).toBe('rising')
  })

  it('detects falling when second half is >10% lower', () => {
    expect(computeTrend([50, 50, 40, 40])).toBe('falling')
  })

  it('returns steady when the change is small', () => {
    expect(computeTrend([40, 40, 42, 42])).toBe('steady')
  })
})

describe('composeMeasurement', () => {
  /** Build a buffer of identical RR intervals — synthetic steady state. */
  function steadyBuffer(rrMs: number, count: number, t0 = 0): RrSample[] {
    return Array.from({ length: count }, (_, i) => ({ rr: rrMs, t: t0 + i * rrMs }))
  }

  it('returns null when fewer than 2 RR samples', () => {
    expect(composeMeasurement([], null, [], Date.now())).toBeNull()
    expect(composeMeasurement([{ rr: 1000, t: 0 }], null, [], Date.now())).toBeNull()
  })

  it('60 BPM steady → hr ≈ 60, rmssd ≈ 0, autonomicState transitioning', () => {
    const m = composeMeasurement(steadyBuffer(1000, 30), null, [], 30_000)!
    expect(m.hr).toBeCloseTo(60, 1)
    expect(m.rmssd).toBeCloseTo(0, 3)
    // With baseline=null we use 50ms fallback; rmssd=0 → activated.
    expect(m.autonomicState).toBe('activated')
    expect(m.source).toBe('polarH10')
    expect(m.confidence).toBe(1)
  })

  it('alternating 800/1000 ms → high RMSSD, calm vs baseline', () => {
    // Alternating creates large diffs; rmssd ≈ 200ms.
    const buf: RrSample[] = []
    let t = 0
    for (let i = 0; i < 20; i++) {
      const rr = i % 2 === 0 ? 800 : 1000
      t += rr
      buf.push({ rr, t })
    }
    const m = composeMeasurement(buf, /* baseline */ 50, [], t)!
    expect(m.rmssd).toBeGreaterThan(150)
    expect(m.autonomicState).toBe('calm') // rmssd/baseline ratio is huge
  })

  it('respiratoryRate is null in v1 (PMD service deferred)', () => {
    const m = composeMeasurement(steadyBuffer(800, 30), null, [], 30_000)!
    expect(m.respiratoryRate).toBeNull()
  })
})

describe('PolarH10Engine — math + emission', () => {
  it('emits measurements via tick() after samples are fed', () => {
    const engine = new PolarH10Engine()
    const emitted: Array<{ hr: number; rmssd: number }> = []
    engine.onMeasurement(m => emitted.push({ hr: m.hr, rmssd: m.rmssd }))

    // 30 samples of 1000ms (60 BPM) over a 30s span.
    for (let i = 0; i < 30; i++) {
      engine.feedSampleForTest([1000], 60, i * 1000)
    }
    engine.tickForTest(30_000)

    expect(emitted).toHaveLength(1)
    expect(emitted[0].hr).toBeCloseTo(60, 1)
    expect(emitted[0].rmssd).toBeCloseTo(0, 3)
    expect(engine.getLatestMeasurement()?.source).toBe('polarH10')
  })

  it('emits zero measurements when buffer is empty', () => {
    const engine = new PolarH10Engine()
    const emitted: unknown[] = []
    engine.onMeasurement(m => emitted.push(m))
    engine.tickForTest(0)
    expect(emitted).toHaveLength(0)
  })
})
