import { describe, expect, it } from 'vitest'
import { detectCrisisKeywords } from '../../../functions/src/shared/crisisFloor'
import type { CrisisCheck } from '../../ai/openrouter'
import type { FolioTrace, FolioTraceEntry } from '../../types/folio'
import { checkKeys } from '../safety/checkedSet'
import { tracePid, traceUnits } from './keep'
import { TraceSafety } from './traceSafety'

// C4 for kept things (draft 4 §5.4): new text is checked at once and grounds
// on risk; a sweep of writing older than 72 h shows the card only; the
// checked set is written back, pruned to units that still exist; traces are
// checked one at a time.

const DAY = 24 * 60 * 60 * 1000
const tick = () => new Promise<void>((r) => setTimeout(r, 0))

function trace(id: string, keptAt: number, beneath: string, checked: string[] = []): FolioTrace {
  return {
    id, keptAt, source: { pageId: 'p', foldId: 'f', revId: null }, surface: 'The line.', gap: 0,
    composition: JSON.stringify({ v: 1, line: [{ type: 'text', text: 'The line.' }], gap: 0, between: null, beneath: [{ type: 'paragraph', content: [{ type: 'text', text: beneath }] }] }),
    author: 'writer', groundedNearKeep: false, safety: { checked }, schemaVersion: 2,
  }
}

function harness(answer: (sample: string) => CrisisCheck = () => ({ status: 'classified', risk: 0 })) {
  const h = { calls: [] as string[], activated: [] as string[], late: [] as string[], persisted: [] as { id: string; checked: string[] }[], inFlight: 0, maxInFlight: 0 }
  const safety = new TraceSafety({
    l1: detectCrisisKeywords,
    check: async (sample) => {
      h.calls.push(sample); h.inFlight++; h.maxInFlight = Math.max(h.maxInFlight, h.inFlight)
      await tick(); h.inFlight--
      return answer(sample)
    },
    activate: (t) => h.activated.push(t),
    lateRisk: (t) => h.late.push(t),
    language: () => 'en',
    persist: (id, checked) => { h.persisted.push({ id, checked }) },
    sleep: tick,
    setTimer: (fn) => setTimeout(fn, 0),
    clearTimer: (t) => clearTimeout(t as ReturnType<typeof setTimeout>),
  })
  return { h, safety }
}

const until = async (cond: () => boolean) => { for (let i = 0; i < 200 && !cond(); i++) await tick() }

describe('TraceSafety', () => {
  it('a new entry with risk grounds at once; its key is saved', async () => {
    const t = trace('t1', Date.now() - 10 * DAY, 'An old, ordinary beneath.')
    const entry: FolioTraceEntry = { id: 'e1', addedAt: Date.now(), text: 'Something I wrote today about it all.', author: 'writer' }
    const { h, safety } = harness((s) => ({ status: 'classified', risk: s.includes('today') ? 2 : 0 }))
    safety.checkNew(t, [entry], [tracePid('t1', 'e:e1')])
    await until(() => h.activated.length > 0)
    expect(h.activated).toHaveLength(1)
    expect(h.late).toEqual([])
  })

  it('a sweep of writing older than 72 hours shows the card only', async () => {
    const { h, safety } = harness(() => ({ status: 'classified', risk: 2 }))
    safety.sweep(trace('old', Date.now() - 10 * DAY, 'Words kept long ago, long enough to check.'), [])
    await until(() => h.late.length > 0)
    expect(h.late).toHaveLength(1)
    expect(h.activated).toEqual([])
  })

  it('a sweep checks only unchecked units and writes back the pruned set', async () => {
    const t = trace('t2', Date.now() - DAY, 'Beneath words long enough to check.', ['stale0000000000a'])
    const { h, safety } = harness()
    safety.sweep(t, [])
    await until(() => h.persisted.length > 0)
    const live = await checkKeys(traceUnits(t))
    expect(h.persisted).toEqual([{ id: 't2', checked: live }])
    expect(h.calls).toHaveLength(1)

    // Swept again with the saved set: nothing to check.
    const again = harness()
    again.safety.sweep({ ...t, safety: { checked: live } }, [])
    for (let i = 0; i < 20; i++) await tick()
    expect(again.h.calls).toEqual([])
    expect(again.h.persisted).toEqual([])
  })

  it('checks one trace at a time', async () => {
    const { h, safety } = harness()
    for (const id of ['a', 'b', 'c']) safety.sweep(trace(id, Date.now() - DAY, `Beneath of ${id}, long enough to check.`), [])
    await until(() => h.persisted.length === 3)
    expect(h.persisted.map((p) => p.id)).toEqual(['a', 'b', 'c'])
    expect(h.maxInFlight).toBe(1)
  })

  it('an unavailable check never enters the checked set', async () => {
    const { h, safety } = harness(() => ({ status: 'unavailable', cause: 'network' }))
    safety.sweep(trace('u', Date.now() - DAY, 'Beneath words long enough to check.'), [])
    for (let i = 0; i < 30; i++) await tick()
    safety.dispose()
    expect(h.calls.length).toBeGreaterThan(0)
    expect(h.persisted).toEqual([])
  })
})
