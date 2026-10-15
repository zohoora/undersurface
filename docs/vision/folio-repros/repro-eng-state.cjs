// Fable engineering review of Folio draft 3.1: state-level ProseMirror checks
// against the installed packages, using the FULL proposed schema from §6.5
// (underside = between? beneath, isolating + defining; fold mark non-inclusive).
// Run: NODE_PATH=<repo>/node_modules node repro-eng-state.cjs
const { Schema, Slice, Fragment } = require('prosemirror-model')
const { EditorState, TextSelection, NodeSelection, AllSelection, Plugin } = require('prosemirror-state')
const { history, undo, undoDepth, closeHistory } = require('prosemirror-history')
const { baseKeymap, macBaseKeymap, pcBaseKeymap, splitBlock, deleteSelection, selectAll } = require('prosemirror-commands')
const { GapCursor } = require('prosemirror-gapcursor')

const schema = new Schema({
  nodes: {
    doc: { content: '(paragraph | underside)+' },
    paragraph: { content: 'text*', group: 'block', attrs: { pid: { default: null } } },
    underside: {
      content: 'between? beneath', group: 'block', defining: true, isolating: true,
      attrs: { foldId: { default: null }, gap: { default: 0 }, loose: { default: false } },
    },
    between: { content: 'paragraph+' },
    beneath: { content: 'paragraph+' },
    text: {},
  },
  marks: { fold: { attrs: { foldId: { default: null } }, inclusive: false, excludes: 'fold' } },
})
let pidN = 0
const p = (t, marks) => schema.node('paragraph', { pid: 'p' + (++pidN) }, t ? [schema.text(t, marks)] : [])
const fold = schema.marks.fold.create({ foldId: 'f1' })
const beneath = (...ps) => schema.node('beneath', null, ps)
const between = (...ps) => schema.node('between', null, ps)
const underside = (content, attrs = {}) => schema.node('underside', { foldId: 'f1', ...attrs }, content)
const lifted = () => schema.node('paragraph', { pid: 'L' }, [schema.text('It was nice to see everyone.', [fold])])

const text = (d) => { const out = []; d.descendants(n => { if (n.isText) out.push(n.text) }); return out.join(' | ') }
const shape = (d) => { const out = []; d.forEach(n => out.push(n.type.name + (n.type.name === 'paragraph' ? `(${JSON.stringify(n.textContent)})` : ''))); return out.join(' ') }
const run = (state, cmd) => { let s = state; const ok = cmd(s, tr => { s = s.apply(tr) }); return [s, ok] }
const posOf = (d, needle) => { let at = -1; d.descendants((n, pos) => { if (at < 0 && n.isText && n.text.includes(needle)) at = pos + n.text.indexOf(needle) }); return at }
const undersideOf = (d) => { let u = null; d.forEach(n => { if (n.type.name === 'underside') u = n }); return u }
const selDesc = (s) => s.selection instanceof NodeSelection ? `NodeSelection(${s.selection.node.type.name})`
  : s.selection instanceof AllSelection ? 'AllSelection'
  : `TextSelection(${s.selection.from}${s.selection.empty ? '' : '-' + s.selection.to})`
const insideUnderside = (s) => { const $p = s.selection.$head; for (let d = $p.depth; d > 0; d--) if ($p.node(d).type.name === 'underside') return true; return false }
const log = (k, ...rest) => console.log(k, ...rest)

// ---------------------------------------------------------------------------
// A1. Forward Delete at the END of the lifted line (the paragraph BEFORE the underside).
{
  const doc = schema.node('doc', null, [p('Before.'), lifted(), underside([beneath(p('I felt absent the whole time.'))]), p('After.')])
  let s = EditorState.create({ doc, plugins: [history()] })
  const end = posOf(s.doc, 'everyone.') + 'everyone.'.length
  s = s.apply(s.tr.setSelection(TextSelection.create(s.doc, end)))
  const del = baseKeymap['Delete']
  for (let i = 1; i <= 2; i++) {
    ;[s] = run(s, del)
    log(`A1.${i} Delete (forward) press ${i} at end of lifted line: selection=${selDesc(s)} | underside present: ${!!undersideOf(s.doc)}`)
  }
}

// A2. Enter at the END of the lifted line: where does the new paragraph land?
{
  const doc = schema.node('doc', null, [p('Before.'), lifted(), underside([beneath(p('I felt absent the whole time.'))]), p('After.')])
  let s = EditorState.create({ doc })
  const end = posOf(s.doc, 'everyone.') + 'everyone.'.length
  s = s.apply(s.tr.setSelection(TextSelection.create(s.doc, end)))
  ;[s] = run(s, splitBlock)
  log('A2 after Enter at end of lifted line:', shape(s.doc))
  log('A2 new paragraph sits between the lifted line and its underside (I2 violated until integrity reorders):',
    s.doc.child(2).type.name === 'paragraph' && s.doc.child(3).type.name === 'underside')
  const marksOnNew = []; s.doc.child(2).descendants(n => { if (n.isText) marksOnNew.push(...n.marks.map(m => m.type.name)) })
  log('A2 new paragraph carries no fold mark:', marksOnNew.length === 0, '| caret in new paragraph:', s.selection.$head.parent === s.doc.child(2))
}

// A3. Backspace in an EMPTY page paragraph right after a (closed) underside.
//     joinBackward's empty-textblock branch deletes the paragraph and moves the
//     caret INTO the underside's last textblock.
{
  const doc = schema.node('doc', null, [p('Before.'), lifted(), underside([beneath(p('I felt absent the whole time.'))]), p('')])
  let s = EditorState.create({ doc, plugins: [history()] })
  s = s.apply(s.tr.setSelection(TextSelection.create(s.doc, s.doc.content.size - 1)))
  ;[s] = run(s, baseKeymap['Backspace'])
  log('A3 Backspace in empty paragraph after underside: doc =', shape(s.doc), '| selection =', selDesc(s), '| caret now INSIDE the underside:', insideUnderside(s))
  // and the next keystroke, if nothing remaps the selection, writes into the hidden beneath:
  s = s.apply(s.tr.insertText('X'))
  log('A3 next typed character landed inside the underside:', undersideOf(s.doc).textContent.endsWith('X'))
}

// A4. Backspace at the start of the beneath's first paragraph when a between exists,
//     and when the beneath paragraph is empty.
{
  const doc = schema.node('doc', null, [p('Before.'), lifted(), underside([between(p('Someone passed me the bread.')), beneath(p('I felt absent.'))]), p('After.')])
  let s = EditorState.create({ doc })
  s = s.apply(s.tr.setSelection(TextSelection.create(s.doc, posOf(s.doc, 'I felt absent.'))))
  let ok
  ;[s, ok] = run(s, baseKeymap['Backspace'])
  log('A4a Backspace at start of beneath (non-empty) with a between: handled =', ok, '| doc text =', text(s.doc), '| sel =', selDesc(s))
  const doc2 = schema.node('doc', null, [p('Before.'), lifted(), underside([between(p('Someone passed me the bread.')), beneath(p(''))]), p('After.')])
  let s2 = EditorState.create({ doc: doc2 })
  const u = undersideOf(s2.doc)
  // position inside the empty beneath paragraph
  let emptyPos = -1; s2.doc.descendants((n, pos) => { if (n.type.name === 'paragraph' && n.content.size === 0 && emptyPos < 0) emptyPos = pos + 1 })
  s2 = s2.apply(s2.tr.setSelection(TextSelection.create(s2.doc, emptyPos)))
  ;[s2, ok] = run(s2, baseKeymap['Backspace'])
  log('A4b Backspace in EMPTY beneath paragraph with a between: handled =', ok, '| underside children =', undersideOf(s2.doc).childCount, '| beneath still present =', undersideOf(s2.doc).lastChild.type.name === 'beneath', '| sel =', selDesc(s2))
}

// A5. Select All + Delete (plain PM): the underside is gone.
{
  const doc = schema.node('doc', null, [p('Before.'), lifted(), underside([beneath(p('I felt absent the whole time.'))]), p('After.')])
  let s = EditorState.create({ doc })
  ;[s] = run(s, selectAll)
  ;[s] = run(s, deleteSelection)
  log('A5 Select All + Delete:', shape(s.doc), '| underside survives:', !!undersideOf(s.doc))
}

// A6. Undo grouping: a keystroke inside the beneath, then one in the page paragraph
//     right after it within newGroupDelay (500 ms) -> ONE undo event (adjacent ranges).
{
  const doc = schema.node('doc', null, [p('Before.'), lifted(), underside([beneath(p('I felt absent.'))]), p('After.')])
  let s = EditorState.create({ doc, plugins: [history()] })
  const t0 = 1_000_000
  let tr = s.tr.insertText('X', posOf(s.doc, 'absent.') + 'absent.'.length); tr.time = t0; s = s.apply(tr)
  tr = s.tr.insertText('Y', posOf(s.doc, 'After.')); tr.time = t0 + 100; s = s.apply(tr)
  log('A6 beneath edit then page edit 100 ms later: undoDepth =', undoDepth(s), '(1 means one undo would touch both the page and the beneath)')
  tr = s.tr.insertText('Z', posOf(s.doc, 'After.') + 'YAfter.'.length); tr.time = t0 + 200; s = s.apply(tr)
  log('A6 after a third adjacent keystroke: undoDepth =', undoDepth(s))
}

// A7. Which key bindings reach the deleteSelection/joinBackward/selectNodeBackward chain?
{
  const chain = (map) => Object.keys(map).filter(k => /Backspace|Delete|Ctrl-h|Ctrl-d|Alt-d/.test(k))
  log('A7 pcBaseKeymap deletion keys:', chain(pcBaseKeymap).join(', '))
  log('A7 macBaseKeymap deletion keys:', chain(macBaseKeymap).join(', '))
}

// A8. Gap cursor validity around and inside an underside (StarterKit ships Gapcursor).
{
  const doc = schema.node('doc', null, [p('Before.'), lifted(), underside([between(p('B.')), beneath(p('I felt absent.'))]), p('After.')])
  const u = undersideOf(doc)
  let uPos = -1; doc.forEach((n, off) => { if (n === u) uPos = off })
  const beforeUnderside = doc.resolve(uPos)                 // doc level, between lifted paragraph and underside
  const insideBetweenBeneath = doc.resolve(uPos + 1 + u.firstChild.nodeSize) // inside underside, between `between` and `beneath`
  log('A8 GapCursor.valid between lifted paragraph and underside:', GapCursor.valid(beforeUnderside))
  log('A8 GapCursor.valid inside underside between `between` and `beneath`:', GapCursor.valid(insideBetweenBeneath))
  const afterUnderside = doc.resolve(uPos + u.nodeSize)
  log('A8 GapCursor.valid between underside and next paragraph:', GapCursor.valid(afterUnderside))
}

// A9. A deletion spanning from the page INTO the underside (ends inside the beneath):
//     where does the mapped selection land?
{
  const doc = schema.node('doc', null, [p('Before.'), lifted(), underside([beneath(p('I felt absent the whole time.'))]), p('After.')])
  let s = EditorState.create({ doc })
  const from = posOf(s.doc, 'fore.')                     // inside "Before."
  const to = posOf(s.doc, 'absent') + 'absent'.length     // inside the beneath
  s = s.apply(s.tr.setSelection(TextSelection.create(s.doc, from, to)))
  const [s2, ok] = run(s, deleteSelection)
  log('A9 deleteSelection from page into beneath: handled =', ok, '| doc =', shape(s2.doc), '| underside text =', undersideOf(s2.doc) ? JSON.stringify(undersideOf(s2.doc).textContent) : '(gone)', '| sel =', selDesc(s2), '| caret inside underside:', insideUnderside(s2))
}

// A10. The history guard's follow-up "open" transaction vs undo depth: a metadata-only
//      transaction leaves history untouched (so the second press applies). Sanity only.
{
  const doc = schema.node('doc', null, [p('Before.'), lifted(), underside([beneath(p('I felt absent.'))]), p('After.')])
  let s = EditorState.create({ doc, plugins: [history()] })
  s = s.apply(s.tr.insertText('X', posOf(s.doc, 'absent.') + 'absent.'.length))
  s = s.apply(closeHistory(s.tr))
  const d0 = undoDepth(s)
  s = s.apply(s.tr.setMeta('folioView', { open: 'f1' }))
  log('A10 metadata-only transaction leaves undoDepth unchanged:', undoDepth(s) === d0)
}
