import { afterEach, describe, expect, it } from 'vitest'
import type { CrisisCheck } from '../../ai/openrouter'
import { detectCrisisKeywords } from '../../../functions/src/shared/crisisFloor'
import { FolioSafetyWatch, LATE_AFTER_MS, SETTLE_SPACING_MS, SWEEP_SPACING_MS } from './FolioSafetyWatch'
import { checkKey } from './checkedSet'
import { SAMPLE_MAX, l1Inputs, readingOrderUnits, samplesFor, trimAnchor } from './samples'
import type { SafetyUnit } from './samples'
import { doc, makeEditor, p, u } from '../page/testUtils'
import type { TestEditor } from '../page/testUtils'

// C4 (draft 4 §5.4, §6.7): units, samples, keys and the scheduler.

let t: TestEditor | null = null
afterEach(() => { t?.destroy(); t = null })

describe('reading-order units and samples', () => {
  it('reads the page, then each underside after its paragraph, closed or not, skipping empty paragraphs', () => {
    t = makeEditor(doc(
      p('Before.', { pid: 'a' }),
      p('It was nice to see everyone.', { pid: 'b', fold: 'f1' }),
      u('f1', [p('I felt absent.', { pid: 'd' }), p('', { pid: 'e' })], { between: [p('Bread.', { pid: 'c' })] }),
      p('', { pid: 'x' }),
      p('After.', { pid: 'f' }),
    ))
    const units = readingOrderUnits(t.editor.state.doc)
    expect(units.map((x) => `${x.kind}:${x.pid}`)).toEqual(['page:a', 'page:b', 'between:c', 'beneath:d', 'page:f'])
    expect(units[3].line).toBe('It was nice to see everyone.')
  })

  it('a beneath\'s sample holds its line and its between; a paragraph inserted above reads what follows', () => {
    const units: SafetyUnit[] = [
      { pid: 'n', text: 'It was a normal Tuesday.', kind: 'page' },
      { pid: 'b', text: 'between words', kind: 'between', line: 'It was a normal Tuesday.' },
      { pid: 'c', text: 'I\'ve decided how I\'ll do it.', kind: 'beneath', line: 'It was a normal Tuesday.' },
    ]
    const [s] = samplesFor(units, 2)
    expect(s.startsWith('It was a normal Tuesday.\n\n')).toBe(true)
    expect(s).toContain('between words')
    const inserted: SafetyUnit[] = [{ pid: 'new', text: 'Everyone would be better off.', kind: 'page' }, { pid: 'old', text: 'Soon.', kind: 'page' }]
    expect(samplesFor(inserted, 0)[0]).toContain('Soon.')
  })

  it('windows stay within 1,000 characters and cover a 20,000-character paste at every offset, each with the anchor', () => {
    const long = Array.from({ length: 20000 }, (_, i) => 'abcdefghij'[i % 10]).join('')
    const units: SafetyUnit[] = [{ pid: 'p', text: long, kind: 'beneath', line: 'The line.' }]
    const windows = samplesFor(units, 0)
    expect(windows.every((w) => w.length <= SAMPLE_MAX && w.startsWith('The line.\n\n'))).toBe(true)
    for (const offset of [0, 999, 5000, 12345, 19990]) {
      const needle = long.slice(offset, offset + 10)
      expect(windows.some((w) => w.includes(needle))).toBe(true)
    }
  })

  it('trims a long line in the middle, and that trimmed form is part of the key', async () => {
    const line = 'x'.repeat(200) + 'MIDDLE' + 'y'.repeat(200)
    expect(trimAnchor(line).length).toBe(240)
    const a = await checkKey({ pid: 'p', text: 't', line })
    const b = await checkKey({ pid: 'p', text: 't', line: trimAnchor(line) })
    expect(a).toBe(b)
  })

  it('keys differ for the same words in two places, and for any edit', async () => {
    expect(await checkKey({ pid: 'a', text: 'I mean it.' })).not.toBe(await checkKey({ pid: 'b', text: 'I mean it.' }))
    expect(await checkKey({ pid: 'a', text: 'I mean it.' })).not.toBe(await checkKey({ pid: 'a', text: 'I mean it!' }))
    expect(await checkKey({ pid: 'a', text: 'x' })).toMatch(/^[0-9a-f]{16}$/)
  })

  it('L1 catches a sentence split across two units through the pair', () => {
    const units: SafetyUnit[] = [{ pid: 'a', text: 'Tonight I am going to kill', kind: 'page' }, { pid: 'b', text: 'myself.', kind: 'page' }]
    expect(detectCrisisKeywords(units[0].text)).toBe(false)
    expect(detectCrisisKeywords(units[1].text)).toBe(false)
    const hit = l1Inputs(units, 1).find((x) => detectCrisisKeywords(x.text))
    expect(hit?.trigger).toBe('a|b')
  })
})

// ---------------------------------------------------------------- scheduler

class Clock {
  now = 10_000_000
  timers: { at: number; fn: () => void; id: number }[] = []
  private id = 1
  set = (fn: () => void, ms: number) => { const id = this.id++; this.timers.push({ at: this.now + ms, fn, id }); return id }
  clear = (h: unknown) => { this.timers = this.timers.filter((x) => x.id !== h) }
  async advance(ms: number) {
    const end = this.now + ms
    for (;;) {
      const due = this.timers.filter((x) => x.at <= end).sort((a, b) => a.at - b.at)[0]
      if (!due) break
      this.timers = this.timers.filter((x) => x !== due)
      this.now = Math.max(this.now, due.at)
      due.fn()
      await settle()
    }
    this.now = end
    await settle()
  }
}

const settle = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)) }

interface Harness {
  watch: FolioSafetyWatch
  units: SafetyUnit[]
  checked: Set<string>
  calls: string[]
  activated: string[]
  late: string[]
  diagnostics: string[]
  clock: Clock
  answer: (sample: string) => CrisisCheck | Promise<CrisisCheck>
}

function harness(units: SafetyUnit[], opts: { checked?: Set<string>; holder?: boolean; updatedAgoMs?: number; answer?: Harness['answer'] } = {}): Harness {
  const clock = new Clock()
  const h = {
    units, checked: opts.checked ?? new Set<string>(), calls: [] as string[], activated: [] as string[], late: [] as string[], diagnostics: [] as string[], clock,
    answer: opts.answer ?? ((): CrisisCheck => ({ status: 'classified', risk: 0 })),
  } as Harness
  h.watch = new FolioSafetyWatch({
    l1: detectCrisisKeywords,
    check: async (sample) => { h.calls.push(sample); return h.answer(sample) },
    activate: (tr) => h.activated.push(tr),
    lateRisk: (tr) => h.late.push(tr),
    units: () => h.units,
    checked: h.checked,
    isLockHolder: () => opts.holder ?? true,
    language: () => 'en',
    pageUpdatedAt: clock.now - (opts.updatedAgoMs ?? 0),
    now: () => clock.now,
    setTimer: clock.set,
    clearTimer: clock.clear,
    onDiagnostic: (c) => h.diagnostics.push(c),
  })
  return h
}

const unit = (pid: string, text: string, extra: Partial<SafetyUnit> = {}): SafetyUnit => ({ pid, text, kind: 'page', ...extra })

describe('FolioSafetyWatch', () => {
  it('checks two units that settle while a call is in flight (no newest-wins)', async () => {
    let release: (v: CrisisCheck) => void = () => {}
    const h = harness([unit('a', 'Paragraph A is long enough.'), unit('b', 'Paragraph B is long enough too.')], {
      answer: () => new Promise<CrisisCheck>((r) => { release = r }),
    })
    await h.watch.settle('a')
    await h.watch.settle('b')
    expect(h.calls).toHaveLength(1)
    release({ status: 'classified', risk: 0 })
    await settle()
    h.answer = () => ({ status: 'classified', risk: 0 })
    await h.clock.advance(SETTLE_SPACING_MS)
    expect(h.calls).toHaveLength(2)
    expect(h.checked.size).toBe(2)
  })

  it('discards a result whose text changed in flight, and checks the new text', async () => {
    let release: (v: CrisisCheck) => void = () => {}
    const h = harness([unit('a', 'First version of the paragraph.')], { answer: () => new Promise<CrisisCheck>((r) => { release = r }) })
    await h.watch.settle('a')
    h.units = [unit('a', 'First version of the paragraph, now longer.')]
    await h.watch.settle('a')
    release({ status: 'classified', risk: 0 })
    await settle()
    expect(h.diagnostics).toContain('folio.l2.stale')
    expect(h.checked.size).toBe(0)
    h.answer = () => ({ status: 'classified', risk: 0 })
    await h.clock.advance(SETTLE_SPACING_MS)
    expect(h.calls.at(-1)).toContain('now longer')
    expect(h.checked.has(await checkKey(h.units[0]))).toBe(true)
  })

  it('an unavailable check stays pending, backs off, and never enters the checked set', async () => {
    const h = harness([unit('a', 'A paragraph long enough to check.')], { answer: () => ({ status: 'unavailable', cause: 'timeout' }) })
    await h.watch.settle('a')
    expect(h.checked.size).toBe(0)
    await h.clock.advance(29_000)
    expect(h.calls).toHaveLength(1)
    await h.clock.advance(2_000)
    expect(h.calls).toHaveLength(2)
    h.answer = () => ({ status: 'classified', risk: 0 })
    await h.clock.advance(121_000)
    expect(h.checked.size).toBe(1)
  })

  it('backs off longer when the classifier\'s own limit is hit', async () => {
    const h = harness([unit('a', 'A paragraph long enough to check.')], { answer: () => ({ status: 'unavailable', cause: 'rate_limited' }) })
    await h.watch.settle('a')
    await h.clock.advance(59_000)
    expect(h.calls).toHaveLength(1)
    await h.clock.advance(2_000)
    expect(h.calls).toHaveLength(2)
    expect(h.diagnostics).toContain('folio.l2.rateLimited')
  })

  it('a tab closed before a settle runs L1 now; the unit stays unchecked and the next open schedules it', async () => {
    const units = [unit('a', 'Tonight I will kill myself.')]
    const h = harness(units)
    h.watch.markDirty('a')
    h.watch.hidden()
    expect(h.activated).toEqual(['a'])
    expect(h.calls).toHaveLength(0)
    const next = harness(units, { checked: h.checked })
    await next.watch.sweep('open')
    expect(next.calls).toHaveLength(1)
  })

  it('another device: every unchecked unit of a saved page is scheduled on open', async () => {
    const units = [unit('a', 'Written on the phone, never checked.'), unit('b', 'Checked on the phone already.')]
    const checked = new Set([await checkKey(units[1])])
    const h = harness(units, { checked })
    await h.watch.sweep('open')
    await h.clock.advance(SWEEP_SPACING_MS * 3)
    expect(h.calls).toHaveLength(1)
    expect(h.calls[0]).toContain('Written on the phone')
    expect(h.checked.size).toBe(2)
  })

  it('a late risk on a page not edited for 72 hours shows the card, never shore', async () => {
    const units = [unit('a', 'Something heavy written weeks ago, offline.')]
    const h = harness(units, { updatedAgoMs: LATE_AFTER_MS + 1, answer: () => ({ status: 'classified', risk: 2 }) })
    await h.watch.sweep('open')
    expect(h.late).toEqual(['a'])
    expect(h.activated).toEqual([])
    expect(h.checked.size).toBe(1)
    const recent = harness(units, { updatedAgoMs: 1000, answer: () => ({ status: 'classified', risk: 2 }) })
    await recent.watch.sweep('open')
    expect(recent.activated).toEqual(['a'])
  })

  it('the floor counts words, so a short page of Japanese or Chinese is still checked', async () => {
    const ja = harness([unit('a', 'もう死にたい。本当に。今夜やる。')])
    await ja.watch.settle('a')
    expect(ja.calls).toHaveLength(1)
    const zh = harness([unit('a', '我不想活了，今晚我就想结束自己的生命。')])
    await zh.watch.settle('a')
    expect(zh.calls).toHaveLength(1)
  })

  it('short text: a short beneath under a long line is sent; a short unit alone is not', async () => {
    const h = harness([unit('a', 'soon.', { kind: 'beneath', line: 'Everyone would be better off without me.' })])
    await h.watch.settle('a')
    expect(h.calls).toHaveLength(1)
    const lone = harness([unit('a', 'ok')])
    await lone.watch.settle('a')
    expect(lone.calls).toHaveLength(0)
    expect(lone.checked.size).toBe(1)
  })

  it('a read-only tab checks nothing', async () => {
    const h = harness([unit('a', 'A paragraph long enough to check.')], { holder: false })
    await h.watch.settle('a')
    await h.watch.sweep('open')
    expect(h.calls).toHaveLength(0)
  })

  it('never exceeds 10 calls a minute for settles, or 6 for sweeps', async () => {
    const units = Array.from({ length: 30 }, (_, i) => unit(`u${i}`, `Paragraph number ${i} with enough words.`))
    const s = harness(units)
    for (const x of units) await s.watch.settle(x.pid)
    await s.clock.advance(60_000)
    expect(s.calls.length).toBeLessThanOrEqual(11)
    const w = harness(units)
    await w.watch.sweep('open')
    await w.clock.advance(60_000)
    expect(w.calls.length).toBeLessThanOrEqual(7)
  })

  it('a risk-2 result activates once per unit with the unit as trigger, and is recorded', async () => {
    const h = harness([unit('a', 'An ambiguous but serious paragraph here.')], { answer: () => ({ status: 'classified', risk: 2 }) })
    await h.watch.settle('a')
    expect(h.activated).toEqual(['a'])
    expect(h.checked.size).toBe(1)
  })
})
