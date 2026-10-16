import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { doc, makeEditor, openIds, p, topLevelTypes } from '../page/testUtils'
import type { TestEditor } from '../page/testUtils'
import { UNDERSIDE } from '../page/schema'
import { liftFromTrace, takeLiftIntent, todaysPageId, writeLiftIntent } from './liftToday'

// Draft 4 §7 Phase 2: "The trace is unchanged; the new fold's line equals the
// trace's line exactly; the new text is checked like any other."

let t: TestEditor | null = null
afterEach(() => { t?.destroy(); t = null })

const LINE = [{ type: 'text', text: 'It was ' }, { type: 'text', text: 'nice', marks: [{ type: 'italic' }] }, { type: 'text', text: ' to see everyone.' }]

describe('liftFromTrace', () => {
  it('appends the line exactly as a new lifted line, open, the caret in its beneath', () => {
    t = makeEditor(doc(p('Today I wrote this.', { pid: 'a' })))
    const r = liftFromTrace(t.editor.state, { traceId: 'tr1', keptAt: 1_792_000_000_000, line: LINE }, 5)
    expect(r).not.toBeNull()
    t.editor.view.dispatch(r!.tr)
    const types = topLevelTypes(t.editor)
    expect(types.slice(0, 3)).toEqual(['p:Today I wrote this.', 'p:It was nice to see everyone.', `u:${r!.foldId}`])
    expect(openIds(t.editor)).toContain(r!.foldId)

    const line = t.editor.state.doc.child(1)
    expect(line.child(1).text).toBe('nice')
    expect(line.child(1).marks.map((m) => m.type.name).sort()).toEqual(['fold', 'italic'])
    expect(line.textContent).toBe('It was nice to see everyone.')

    const underside = t.editor.state.doc.child(2)
    expect(underside.type.name).toBe(UNDERSIDE)
    expect(underside.attrs).toMatchObject({ fromTraceId: 'tr1', fromKeptAt: 1_792_000_000_000, surfaceSnapshot: 'It was nice to see everyone.', gap: 0 })

    const $c = t.editor.state.selection.$from
    expect($c.node(2).type.name).toBe('beneath')
    t.editor.commands.insertContent('Written today, beneath it.')
    expect(underside.textContent).toBe('')
    expect(t.editor.state.doc.child(2).textContent).toBe('Written today, beneath it.')
  })

  it('uses an empty last paragraph instead of adding one', () => {
    t = makeEditor(doc(p('Words.', { pid: 'a' }), p('', { pid: 'b' })))
    t.editor.view.dispatch(liftFromTrace(t.editor.state, { traceId: 'tr1', keptAt: 1, line: LINE })!.tr)
    expect(topLevelTypes(t.editor)[1]).toBe('p:It was nice to see everyone.')
  })

  it('refuses an empty or malformed line', () => {
    t = makeEditor(doc(p('Words.', { pid: 'a' })))
    expect(liftFromTrace(t.editor.state, { traceId: 'x', keptAt: 1, line: [] })).toBeNull()
    expect(liftFromTrace(t.editor.state, { traceId: 'x', keptAt: 1, line: [{ type: 'nonsense' }] })).toBeNull()
  })
})

describe('today\'s page and the intent', () => {
  beforeEach(() => sessionStorage.clear())

  it('today\'s page is the latest page if it was edited today, writer-local', () => {
    const now = Date.parse('2026-10-15T03:30:00Z') // 14 Oct, 23:30 in Toronto
    expect(todaysPageId({ id: 'p1', updatedAt: Date.parse('2026-10-14T13:00:00Z') }, now, 'America/Toronto', () => 'new')).toBe('p1')
    expect(todaysPageId({ id: 'p1', updatedAt: Date.parse('2026-10-14T03:00:00Z') }, now, 'America/Toronto', () => 'new')).toBe('new')
    expect(todaysPageId(null, now, 'UTC', () => 'new')).toBe('new')
  })

  it('the intent is taken once, only by its account and page', () => {
    writeLiftIntent({ uid: 'u1', pageId: 'p1', traceId: 't', keptAt: 1, line: LINE, at: 1000 })
    expect(takeLiftIntent('u2', 'p1', 1000)).toBeNull()
    expect(takeLiftIntent('u1', 'p2', 1000)).toBeNull()
    expect(takeLiftIntent('u1', 'p1', 1000)?.traceId).toBe('t')
    expect(takeLiftIntent('u1', 'p1', 1000)).toBeNull()
    writeLiftIntent({ uid: 'u1', pageId: 'p1', traceId: 't', keptAt: 1, line: LINE, at: 1000 })
    expect(takeLiftIntent('u1', 'p1', 1000 + 11 * 60 * 1000)).toBeNull()
  })
})
