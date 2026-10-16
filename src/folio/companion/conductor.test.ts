import { afterEach, describe, expect, it, vi } from 'vitest'
import { TextSelection } from '@tiptap/pm/state'
import { doc, makeEditor, p, posOf, setOpen, u } from '../page/testUtils'
import type { TestEditor } from '../page/testUtils'
import { getFoldView } from '../page/foldView'
import { companionLift, closeFold } from './acts'
import { CompanionConductor, comeBackFor, freshBudget } from './conductor'
import type { CompanionHost, KeepResult } from './conductor'
import { OPENING, presence } from './presence'
import { CLOSE_REST_MS, INSIDE_REST_MS, KEEP_REST_MS, REST_MS, UNDO_PAUSE_MS } from './levels'
import type { InvolvementLevel } from './levels'

let t: TestEditor | null = null
afterEach(() => { t?.destroy(); t = null })

const PARA = 'We drove back late. I kept checking the mirror as if someone was behind us.'

function setup(level: InvolvementLevel, content = doc(p(PARA, { pid: 'p1' }), p('Still writing.', { pid: 'p2' })), replies: string[] = []) {
  t = makeEditor(content)
  const ed = t.editor
  const clock = { now: 1_000_000 }
  const calls: string[] = []
  const acts: string[] = []
  const state = { open: true, checked: true, level, replies: [...replies], outOfView: true, insideReady: true, risk: new Map<string, number>() }
  const host: CompanionHost = {
    view: () => ed.view,
    level: () => state.level,
    open: () => state.open,
    checked: async (pids, opts) => state.checked && (!opts?.ink || pids.every((pid) => (state.risk.get(pid) ?? 0) === 0)),
    foldOutOfView: () => state.outOfView,
    insideReady: () => state.insideReady,
    call: async (messages) => { calls.push(messages[0].content.match(/TASK: ([^.]*)/)?.[1] ?? 'note'); return state.replies.shift() ?? '{"none": true}' },
    l1: (text) => /kill myself/i.test(text),
    languageName: () => null,
    when: () => 'Tuesday 15 October, evening',
    switches: () => ({ between: true, distance: true }),
    lift: (req) => {
      const r = companionLift(ed.state, { ...req, switches: { between: true, distance: true } })
      if (!r) return null
      ed.view.dispatch(r.tr)
      acts.push(`lift:${req.sentence}:${req.gap}`)
      return { foldId: r.foldId, beneathPid: r.beneathPid }
    },
    keep: async (foldId): Promise<KeepResult> => { acts.push(`keep:${foldId}`); return { traceId: 't1', composition: 'Line.\n\nI felt cold the whole way.', beneathChars: 26, reKeep: false } },
    isKept: () => acts.some((a) => a.startsWith('keep:')),
    named: (_id, title) => { acts.push(`name:${title}`) },
    comeBack: (_id, choice) => { acts.push(`comeBack:${String(choice)}`) },
    note: async () => { acts.push('note'); return true },
    close: (foldId) => { ed.view.dispatch(closeFold(ed.state, foldId)); acts.push(`close:${foldId}`) },
    stepInside: (foldId) => { acts.push(`inside:${foldId}`) },
    arrivalContext: async () => ({ when: 'Tuesday', lastPage: { id: 'page-0', text: 'The heater only worked on one side.', at: 1 }, kept: [] }),
    arrive: (a) => { acts.push(`arrive:${a.kind}`); return true },
    prefill: (_id, title, choice) => { acts.push(`prefill:${title}:${String(choice)}`) },
    diagnostic: (code) => { acts.push(`diag:${code}`) },
    budget: () => budget,
    now: () => clock.now,
  }
  const budget = freshBudget()
  const c = new CompanionConductor(host)
  const caretIn = (text: string) => ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, posOf(ed, text) + 1)))
  const rest = (ms: number) => { clock.now += ms }
  return { ed, c, clock, calls, acts, state, caretIn, rest }
}

const LINE = '{"sentence": "I kept checking the mirror as if someone was behind us.", "question": "Who did you expect to see?", "distance": 2, "between": "The rear window, dark."}'

describe('when the companion takes part', () => {
  it('level 1 does nothing at all', async () => {
    const s = setup(1, undefined, [LINE])
    s.c.edited('p1', null)
    s.caretIn('Still')
    s.rest(REST_MS * 10)
    await s.c.tick()
    expect(s.calls).toEqual([])
  })

  it('level 2 marks a rested paragraph once the caret has left it; never while writing in it', async () => {
    const s = setup(2, undefined, [LINE])
    s.c.edited('p1', null)
    s.caretIn('drove')
    s.rest(REST_MS)
    await s.c.tick()
    expect(s.calls).toEqual([]) // the caret is still in the paragraph
    s.caretIn('Still')
    await s.c.tick()
    expect(s.calls).toHaveLength(1)
    expect(presence(s.ed.state).mark).toEqual({ pid: 'p1', sentence: 'I kept checking the mirror as if someone was behind us.' })
    // Level 2 never lifts it.
    s.rest(120_000)
    await s.c.tick()
    expect(s.acts.filter((a) => a.startsWith('lift'))).toEqual([])
  })

  it('nothing before the rest; nothing on unchecked text; nothing with the gate closed (which clears what\'s shown)', async () => {
    const s = setup(2, undefined, [LINE, LINE])
    s.c.edited('p1', null)
    s.caretIn('Still')
    s.rest(REST_MS - 1)
    await s.c.tick()
    expect(s.calls).toEqual([])
    s.state.checked = false
    s.rest(1)
    await s.c.tick()
    expect(s.calls).toEqual([])
    s.state.checked = true
    s.c.edited('p1', null)
    s.caretIn('Still')
    s.rest(REST_MS)
    // An edit of the same text isn't re-considered; a new text is.
    s.ed.view.dispatch(s.ed.state.tr.insertText(' Again.', posOf(s.ed, 'behind us.') + 'behind us.'.length))
    s.c.edited('p1', null)
    s.caretIn('Still')
    s.rest(REST_MS)
    await s.c.tick()
    expect(presence(s.ed.state).mark).not.toBeNull()
    s.state.open = false
    await s.c.tick()
    expect(presence(s.ed.state).mark).toBeNull()
  })

  it('output that the deterministic floor matches is dropped, without grounding', async () => {
    const s = setup(2, undefined, ['{"sentence": "We drove back late.", "question": "Did you want to kill myself?"}'])
    s.c.edited('p1', null)
    s.caretIn('Still')
    s.rest(REST_MS)
    await s.c.tick()
    expect(presence(s.ed.state).mark).toBeNull()
    expect(s.acts).toContain('diag:folio.companion.l1Out')
  })

  it('level 3 answers the writer\'s lift with a ghost question, and a blank page with an opening ghost', async () => {
    const s = setup(3, doc(p('Line.', { pid: 'p1', fold: 'f1' }), u('f1', [p('', { pid: 'b1' })])), ['{"question": "What was on the other side?"}'])
    setOpen(s.ed, ['f1'])
    await s.c.writerLifted('f1', 'Line.')
    expect(presence(s.ed.state).ghosts.get('b1')).toBe('What was on the other side?')
    t?.destroy()
    const s2 = setup(3, doc(p('', { pid: 'p0' })), ['{"line": "What did today sound like?"}'])
    await s2.c.opened()
    expect(presence(s2.ed.state).ghosts.get(OPENING)).toBe('What did today sound like?')
  })

  it('level 3 offers a name and a day after the writer keeps; it decides nothing', async () => {
    const s = setup(3, undefined, ['{"title": "the cold"}'])
    await s.c.writerKept({ traceId: 't1', composition: 'Line.\n\nI felt cold the whole way.', beneathChars: 26, reKeep: false })
    expect(s.acts).toEqual(['prefill:the cold:tomorrow'])
  })

  it('level 4 lifts the marked line itself after a while, caret untouched, touching; then waits for the writer', async () => {
    const s = setup(4, undefined, [LINE])
    s.c.edited('p1', null)
    s.caretIn('Still')
    s.rest(REST_MS)
    await s.c.tick()
    s.rest(30_000)
    await s.c.tick()
    expect(s.acts).toEqual(['lift:I kept checking the mirror as if someone was behind us.:0'])
    expect(s.ed.state.selection.$from.parent.attrs.pid).toBe('p2')
    const beneath = presence(s.ed.state).ghosts
    expect([...beneath.values()]).toEqual(['Who did you expect to see?'])
  })

  it('level 5 lifts with the distance and the between it chose', async () => {
    const s = setup(5, undefined, [LINE])
    s.c.edited('p1', null)
    s.caretIn('Still')
    s.rest(REST_MS)
    await s.c.tick()
    s.rest(30_000)
    await s.c.tick()
    expect(s.acts).toEqual(['lift:I kept checking the mirror as if someone was behind us.:2'])
  })

  it('an Undo pauses that act; two Undos pause it for the visit', async () => {
    const s = setup(4, undefined, [LINE, LINE])
    s.c.undone('lift')
    s.c.edited('p1', null)
    s.caretIn('Still')
    s.rest(REST_MS)
    await s.c.tick()
    expect(s.calls).toEqual([]) // marks pause with lifts
    s.rest(UNDO_PAUSE_MS)
    await s.c.tick()
    expect(s.calls).toHaveLength(1)
    s.c.undone('lift')
    s.rest(UNDO_PAUSE_MS * 100)
    await s.c.tick()
    expect(s.acts.filter((a) => a.startsWith('lift'))).toEqual([])
  })

  it('level 4 keeps a composition that has rested with the caret elsewhere, names it and sets a come-back', async () => {
    const s = setup(4, doc(p('Line.', { pid: 'p1', fold: 'f1' }), u('f1', [p('I felt cold the whole way.', { pid: 'b1' })]), p('Elsewhere.', { pid: 'p2' })), ['{"title": "felt cold"}'])
    setOpen(s.ed, ['f1'])
    s.c.edited('b1', 'f1')
    s.caretIn('Elsewhere')
    s.rest(KEEP_REST_MS - 1)
    await s.c.tick()
    expect(s.acts).toEqual([])
    s.rest(1)
    await s.c.tick()
    expect(s.acts).toEqual(['keep:f1', 'name:felt cold', 'comeBack:tomorrow', 'note'])
  })

  it('level 5 steps inside only when the writer is still and looking; closes only after they write again, out of view', async () => {
    const s = setup(5, doc(p('Line.', { pid: 'p1', fold: 'f1' }), u('f1', [p('I felt cold the whole way.', { pid: 'b1' })]), p('Elsewhere.', { pid: 'p2' })), ['{"title": "felt cold"}'])
    setOpen(s.ed, ['f1'])
    s.c.edited('b1', 'f1')
    s.caretIn('Elsewhere')
    s.rest(KEEP_REST_MS)
    await s.c.tick()
    s.state.insideReady = false
    s.rest(INSIDE_REST_MS)
    await s.c.tick()
    expect(s.acts).not.toContain('inside:f1')
    s.state.insideReady = true
    await s.c.tick()
    expect(s.acts).toContain('inside:f1')
    // No close until the writer has written again since the keep.
    s.rest(CLOSE_REST_MS)
    await s.c.tick()
    expect(s.acts).not.toContain('close:f1')
    s.c.edited('p2', null)
    s.state.outOfView = false
    s.rest(REST_MS)
    await s.c.tick()
    expect(s.acts).not.toContain('close:f1')
    s.state.outOfView = true
    await s.c.tick()
    expect(s.acts).toContain('close:f1')
    expect(getFoldView(s.ed.state).open.has('f1')).toBe(false)
  })

  it('no ink beside a paragraph classified above 0, nor its neighbour', async () => {
    const s = setup(2, undefined, [LINE])
    s.state.risk.set('p1', 1)
    s.c.edited('p1', null)
    s.caretIn('Still')
    s.rest(REST_MS)
    await s.c.tick()
    expect(s.calls).toEqual([])
  })

  it('level 5 arrives on a blank page', async () => {
    const s = setup(5, doc(p('', { pid: 'p0' })), ['{"kind": "lift", "sentence": "The heater only worked on one side.", "distance": 1, "between": "Warm air.", "question": "Q?", "starter": "On her side"}'])
    await s.c.opened()
    expect(s.acts).toEqual(['arrive:lift'])
  })

  it('a level change clears what the new level doesn\'t allow', async () => {
    const s = setup(3, doc(p('', { pid: 'p0' })), ['{"line": "Q?"}'])
    await s.c.opened()
    expect(presence(s.ed.state).ghosts.size).toBe(1)
    s.state.level = 2
    s.c.levelChanged()
    expect(presence(s.ed.state).ghosts.size).toBe(0)
  })

  it('the come-back day is deterministic', () => {
    expect(comeBackFor({ beneathChars: 20, reKeep: false })).toBe('tomorrow')
    expect(comeBackFor({ beneathChars: 200, reKeep: false })).toBe('week')
    expect(comeBackFor({ beneathChars: 200, reKeep: true })).toBe('month')
  })

  it('a slow reply is dropped', async () => {
    vi.useFakeTimers()
    try {
      const s = setup(2)
      const host = (s.c as unknown as { host: CompanionHost }).host
      host.call = (_m, signal) => new Promise((_r, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))))
      s.c.edited('p1', null)
      s.caretIn('Still')
      s.rest(REST_MS)
      const tick = s.c.tick()
      await vi.advanceTimersByTimeAsync(13_000)
      await tick
      expect(presence(s.ed.state).mark).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})
