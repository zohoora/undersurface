import { afterEach, describe, expect, it } from 'vitest'
import { checkKey, checkKeys } from '../safety/checkedSet'
import { readingOrderUnits } from '../safety/samples'
import { doc, makeEditor, p, u } from '../page/testUtils'
import type { TestEditor } from '../page/testUtils'
import { buildTrace, keptCheckedKeys, parseComposition, passageText, snapshotFold, traceName, tracePid, traceUnits } from './keep'

// Draft 4 §7 Phase 2: "A trace contains the line, the distance, the between
// and the beneath, exactly." Italic travels with it (build plan §3.3).

let t: TestEditor | null = null
afterEach(() => { t?.destroy(); t = null })

const italic = (text: string) => ({ type: 'text', text, marks: [{ type: 'italic' }] })

describe('snapshotFold', () => {
  it('keeps the line, the distance, the between and the beneath exactly, with italic and hard breaks', () => {
    t = makeEditor(doc(
      { type: 'paragraph', attrs: { pid: 'p1' }, content: [
        { type: 'text', text: 'Before. ' },
        { type: 'text', text: 'It was ', marks: [{ type: 'fold', attrs: { foldId: 'f1' } }] },
        { type: 'text', text: 'nice', marks: [{ type: 'fold', attrs: { foldId: 'f1' } }, { type: 'italic' }] },
        { type: 'text', text: '.', marks: [{ type: 'fold', attrs: { foldId: 'f1' } }] },
        { type: 'text', text: ' After.' },
      ] },
      u('f1', [
        { type: 'paragraph', attrs: { pid: 'b1' }, content: [{ type: 'text', text: 'I felt' }, { type: 'hardBreak' }, italic('absent.')] },
        p('Second paragraph.', { pid: 'b2' }),
      ], { between: [p('The drive home.', { pid: 'w1' })], gap: 3 }),
    ))
    const s = snapshotFold(t.editor.state.doc, 'f1')
    expect(s).not.toBeNull()
    expect(s?.surface).toBe('It was nice.')
    expect(s?.composition.line).toEqual([{ type: 'text', text: 'It was ' }, italic('nice'), { type: 'text', text: '.' }])
    expect(s?.composition.gap).toBe(3)
    expect(passageText(s?.composition.between ?? null)).toBe('The drive home.')
    expect(passageText(s?.composition.beneath ?? [])).toBe('I felt\nabsent.\n\nSecond paragraph.')
    expect(s?.composition.beneath[0].content?.[2]).toEqual(italic('absent.'))
    expect(s?.sourcePids).toEqual({ between: ['w1'], beneath: ['b1', 'b2'] })
    expect(s?.empty).toBe(false)
    // Round trip through the stored string.
    expect(parseComposition(JSON.stringify(s?.composition))).toEqual(s?.composition)
  })

  it('a fold with nothing written beneath is empty; a missing fold is null', () => {
    t = makeEditor(doc(p('Line.', { pid: 'a', fold: 'f1' }), u('f1', [p('', { pid: 'b' })])))
    expect(snapshotFold(t.editor.state.doc, 'f1')?.empty).toBe(true)
    expect(snapshotFold(t.editor.state.doc, 'nope')).toBeNull()
  })

  it('a loose underside keeps the line it was lifted with', () => {
    t = makeEditor(doc(
      p('Other.', { pid: 'a' }),
      { type: 'underside', attrs: { foldId: 'f9', gap: 0, loose: true, surfaceSnapshot: 'The removed line.' }, content: [{ type: 'beneath', content: [p('Still here.', { pid: 'b' })] }] },
    ))
    const s = snapshotFold(t.editor.state.doc, 'f9')
    expect(s?.surface).toBe('The removed line.')
    expect(s?.empty).toBe(false)
  })
})

describe('the trace and its safety units', () => {
  const composition = JSON.stringify({ v: 1, line: [{ type: 'text', text: 'Line.' }], gap: 1, between: [{ type: 'paragraph', content: [{ type: 'text', text: 'Mid.' }] }], beneath: [{ type: 'paragraph', content: [{ type: 'text', text: 'Low.' }] }] })

  it('units are the between, the beneath and each entry, with the line as context', () => {
    const units = traceUnits({ id: 't1', surface: 'Line.', composition }, [{ id: 'e1', text: 'Added.' }, { id: 'e2', text: '   ' }])
    expect(units).toEqual([
      { pid: 't1:between', kind: 'between', text: 'Mid.', line: 'Line.' },
      { pid: 't1:beneath', kind: 'beneath', text: 'Low.', line: 'Line.' },
      { pid: 't1:e:e1', kind: 'page', text: 'Added.' },
    ])
    expect(tracePid('t1', 'between')).toBe('t1:between')
  })

  it('on Keep, a passage counts as checked only if every page paragraph it came from was checked', async () => {
    t = makeEditor(doc(
      p('Line.', { pid: 'a', fold: 'f1' }),
      u('f1', [p('Low one.', { pid: 'b1' }), p('Low two.', { pid: 'b2' })], { between: [p('Mid.', { pid: 'w1' })], gap: 1 }),
    ))
    const pageUnits = readingOrderUnits(t.editor.state.doc)
    const keys = await checkKeys(pageUnits)
    const keyOf = (pid: string) => keys[pageUnits.findIndex((x) => x.pid === pid)]
    const snapshot = snapshotFold(t.editor.state.doc, 'f1')
    if (!snapshot) throw new Error('no snapshot')
    const draft = { id: 'T', surface: snapshot.surface, composition: JSON.stringify(snapshot.composition) }
    const [betweenUnit, beneathUnit] = traceUnits(draft)

    // Only one of the beneath's two paragraphs was checked: the beneath waits.
    const partial = await keptCheckedKeys('T', snapshot, pageUnits, new Set([keyOf('w1'), keyOf('b1')]))
    expect(partial).toEqual([await checkKey(betweenUnit)])

    const all = await keptCheckedKeys('T', snapshot, pageUnits, new Set(keys))
    expect(all).toEqual([await checkKey(betweenUnit), await checkKey(beneathUnit)])
  })

  it('buildTrace leaves out absent links (Firestore rejects undefined)', () => {
    const snapshot = { composition: { v: 1 as const, line: [], gap: 0 as const, between: null, beneath: [] }, surface: 'L', sourcePids: { between: [], beneath: [] }, empty: true }
    const trace = buildTrace({ id: 'x', snapshot, source: { pageId: 'p', foldId: 'f', revId: null }, keptAt: 1, checked: [], groundedNearKeep: false, previousTraceId: null })
    expect('previousTraceId' in trace).toBe(false)
    expect('correctedFromId' in trace).toBe(false)
    expect(buildTrace({ id: 'y', snapshot, source: trace.source, keptAt: 2, checked: [], groundedNearKeep: true, previousTraceId: 'x' }).previousTraceId).toBe('x')
    expect(traceName({ title: '  ', surface: 'The line.' })).toBe('The line.')
    expect(traceName({ title: 'the soup incident', surface: 'The line.' })).toBe('the soup incident')
  })
})
