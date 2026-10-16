// Fable engineering review of Folio draft 3.1: VIEW-level checks under jsdom.
// What it can show: a node view with no contentDOM keeps hidden text out of the
// DOM; how ProseMirror maps positions/selections inside such a node; that
// `update` returning false recreates the view; the native `cut` event path;
// transformCopied at the clipboard boundary; a DOM mutation that removes the
// placeholder and what PM does with it.
// What it cannot show: real caret movement, IME, layout, key repeat.
// Run: NODE_PATH=<repo>/node_modules node repro-eng-view.cjs
const { JSDOM } = require('jsdom')
const dom = new JSDOM('<!doctype html><html><body><div id="editor"></div></body></html>', { pretendToBeVisual: true })
const w = dom.window
for (const k of ['window', 'document', 'navigator', 'Node', 'Range', 'Selection', 'MutationObserver', 'HTMLElement', 'Element', 'Text', 'DocumentFragment', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'KeyboardEvent', 'Event', 'CustomEvent']) {
  if (w[k] !== undefined) global[k] = w[k]
}
// jsdom has no layout; PM calls these on nodes.
global.getSelection = () => w.document.getSelection()
w.HTMLElement.prototype.getClientRects = function () { return [] }
w.HTMLElement.prototype.getBoundingClientRect = function () { return { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 } }
w.Range.prototype.getClientRects = function () { return [] }
w.Range.prototype.getBoundingClientRect = function () { return { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 } }

const { Schema } = require('prosemirror-model')
const { EditorState, TextSelection, NodeSelection, Plugin, PluginKey } = require('prosemirror-state')
const { EditorView, Decoration, DecorationSet } = require('prosemirror-view')
const { history, undo } = require('prosemirror-history')
const { deleteSelection } = require('prosemirror-commands')

const schema = new Schema({
  nodes: {
    doc: { content: '(paragraph | underside)+' },
    paragraph: { content: 'text*', group: 'block', attrs: { pid: { default: null } }, toDOM: () => ['p', 0], parseDOM: [{ tag: 'p' }] },
    underside: {
      content: 'between? beneath', group: 'block', defining: true, isolating: true,
      attrs: { foldId: { default: null } },
      toDOM: (n) => ['div', { 'data-underside': n.attrs.foldId }, 0], parseDOM: [{ tag: 'div[data-underside]', getAttrs: (d) => ({ foldId: d.getAttribute('data-underside') }) }],
    },
    between: { content: 'paragraph+', toDOM: () => ['div', { 'data-between': '' }, 0], parseDOM: [{ tag: 'div[data-between]' }] },
    beneath: { content: 'paragraph+', toDOM: () => ['div', { 'data-beneath': '' }, 0], parseDOM: [{ tag: 'div[data-beneath]' }] },
    text: {},
  },
  marks: { fold: { attrs: { foldId: { default: null } }, inclusive: false, excludes: 'fold', toDOM: (m) => ['span', { 'data-fold-id': m.attrs.foldId }, 0], parseDOM: [{ tag: 'span[data-fold-id]', getAttrs: (d) => ({ foldId: d.getAttribute('data-fold-id') }) }] } },
})
let pidN = 0
const p = (t, marks) => schema.node('paragraph', { pid: 'p' + (++pidN) }, t ? [schema.text(t, marks)] : [])
const fold = schema.marks.fold.create({ foldId: 'f1' })
const mkDoc = () => schema.node('doc', null, [
  p('Before.'),
  schema.node('paragraph', { pid: 'L' }, [schema.text('It was nice to see everyone.', [fold])]),
  schema.node('underside', { foldId: 'f1' }, [schema.node('beneath', null, [p('I felt absent the whole time.')])]),
  p('After.'),
])
const posOf = (d, needle) => { let at = -1; d.descendants((n, pos) => { if (at < 0 && n.isText && n.text.includes(needle)) at = pos + n.text.indexOf(needle) }); return at }
const undersideOf = (d) => { let u = null, at = -1; d.forEach((n, off) => { if (n.type.name === 'underside') { u = n; at = off } }); return { node: u, pos: at } }
const selDesc = (s) => s.selection instanceof NodeSelection ? `NodeSelection(${s.selection.node.type.name})` : `TextSelection(${s.selection.from}${s.selection.empty ? '' : '-' + s.selection.to})`
const insideUnderside = (s) => { const $p = s.selection.$head; for (let d = $p.depth; d > 0; d--) if ($p.node(d).type.name === 'underside') return true; return false }
const log = (...a) => console.log(...a)

// --- the foldView plugin: closed set in plugin state, exposed as a NODE decoration
const viewKey = new PluginKey('foldView')
const foldView = new Plugin({
  key: viewKey,
  state: {
    init: () => ({ closed: new Set(['f1']) }),
    apply(tr, v) {
      const m = tr.getMeta(viewKey); if (!m) return v
      const closed = new Set(v.closed); if (m.close) closed.add(m.close); if (m.open) closed.delete(m.open); return { closed }
    },
  },
  props: {
    decorations(state) {
      const { closed } = viewKey.getState(state); const decos = []
      state.doc.forEach((n, off) => { if (n.type.name === 'underside' && closed.has(n.attrs.foldId)) decos.push(Decoration.node(off, off + n.nodeSize, {}, { closed: true })) })
      return DecorationSet.create(state.doc, decos)
    },
  },
})
const isClosed = (decos) => decos.some(d => d.spec && d.spec.closed)
let factoryCalls = 0
const nodeViews = {
  underside(node, view, getPos, decorations) {
    factoryCalls++
    if (isClosed(decorations)) {
      const el = document.createElement('div')
      el.setAttribute('contenteditable', 'false'); el.setAttribute('aria-hidden', 'true'); el.className = 'closed-underside'
      return { dom: el, update: (n, decos) => n.type === node.type && isClosed(decos) }
    }
    const el = document.createElement('div'); el.className = 'open-underside'
    return { dom: el, contentDOM: el, update: (n, decos) => n.type === node.type && !isClosed(decos) }
  },
}

function makeView(extraPlugins = [], extraProps = {}, nv = nodeViews) {
  document.getElementById('editor').innerHTML = ''
  const state = EditorState.create({ doc: mkDoc(), plugins: [history(), foldView, ...extraPlugins] })
  return new EditorView(document.getElementById('editor'), { state, nodeViews: nv, attributes: { tabindex: '0' }, ...extraProps })
}

// B1. Closed underside: no hidden text in the DOM; toggling recreates the view in the other form.
{
  const view = makeView()
  log('B1 closed: hidden text present in DOM =', view.dom.textContent.includes('absent'), '| placeholder element present =', !!view.dom.querySelector('.closed-underside'))
  view.dispatch(view.state.tr.setMeta(viewKey, { open: 'f1' }))
  log('B1 after open (metadata-only tr): hidden text present in DOM =', view.dom.textContent.includes('absent'), '| open element =', !!view.dom.querySelector('.open-underside'))
  view.dispatch(view.state.tr.setMeta(viewKey, { close: 'f1' }))
  log('B1 after close: hidden text present in DOM =', view.dom.textContent.includes('absent'))
  view.destroy()
}

// B2. A closed view WITHOUT an `update` method is recreated on every transaction that
//     touches its parent (prosemirror-view CustomNodeViewDesc.update: !contentDOM && !isLeaf -> false).
{
  let calls = 0
  const nv = { underside(node, view, getPos, decorations) { calls++; const el = document.createElement('div'); el.setAttribute('contenteditable', 'false'); return { dom: el } } }
  const view = makeView([], {}, nv)
  const c0 = calls
  for (let i = 0; i < 3; i++) view.dispatch(view.state.tr.insertText('x', posOf(view.state.doc, 'After.')))
  log('B2 closed view without update(): factory calls after 3 unrelated keystrokes =', calls - c0, '(expected 3: recreated each time; supply update() returning true)')
  view.destroy()
  factoryCalls = 0
  const view2 = makeView()
  const c1 = factoryCalls
  for (let i = 0; i < 3; i++) view2.dispatch(view2.state.tr.insertText('x', posOf(view2.state.doc, 'After.')))
  log('B2 closed view WITH update(): factory calls after 3 unrelated keystrokes =', factoryCalls - c1)
  view2.destroy()
}

// B3. Position mapping inside a closed underside, and a TextSelection placed there by a command.
{
  const view = makeView()
  const { node: u, pos: uPos } = undersideOf(view.state.doc)
  const inner = uPos + 3 // inside the beneath's paragraph text
  let mapped
  try { mapped = view.domAtPos(inner) } catch (e) { mapped = 'THROWS: ' + e.message }
  log('B3 view.domAtPos(inside closed underside) =', typeof mapped === 'string' ? mapped : `{node: ${mapped.node.nodeName}.${mapped.node.className || ''}, offset: ${mapped.offset}}`)
  view.dom.focus()
  log('B3 view.hasFocus() under jsdom =', view.hasFocus())
  let threw = null
  try { view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, inner))) } catch (e) { threw = e.message }
  const domSel = document.getSelection()
  log('B3 dispatch TextSelection inside closed underside: threw =', threw, '| state selection =', selDesc(view.state), '| DOM selection anchorNode =', domSel.anchorNode ? (domSel.anchorNode.nodeName + '.' + (domSel.anchorNode.className || '')) : null, 'offset', domSel.anchorOffset)
  // Typing now (handleTextInput path is DOM-driven; simulate the state-level consequence):
  view.dispatch(view.state.tr.insertText('Q'))
  log('B3 a character inserted at that selection landed in the hidden beneath:', undersideOf(view.state.doc).node.textContent.includes('Q'), '| visible in DOM:', view.dom.textContent.includes('Q'))
  view.destroy()
}

// B4. Deletion from the page into the beneath via deleteSelection: where does Selection.near put the caret?
{
  const view = makeView()
  const from = posOf(view.state.doc, 'fore.')
  const to = posOf(view.state.doc, 'absent') + 'absent'.length
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)))
  deleteSelection(view.state, view.dispatch)
  const u = undersideOf(view.state.doc).node
  log('B4 after deleteSelection spanning into the closed beneath: underside =', u ? JSON.stringify(u.textContent) : '(gone)', '| sel =', selDesc(view.state), '| caret inside underside:', insideUnderside(view.state), '| hidden text in DOM:', view.dom.textContent.includes('absent'))
  view.destroy()
}

// B5. The native `cut` event (Edit menu / context menu): PM's own handler deletes the selection
//     WITHOUT consulting handleKeyDown. With transformCopied dropping closed undersides, the clipboard
//     gets the visible text while the deletion removes the hidden underside.
{
  let copied = null
  const view = makeView([], {
    transformCopied(slice) { // drop closed undersides, keep the rest
      const { closed } = viewKey.getState(view.state); const kept = []
      slice.content.forEach(n => { if (!(n.type.name === 'underside' && closed.has(n.attrs.foldId))) kept.push(n) })
      return new slice.constructor(slice.content.constructor.from(kept), slice.openStart, slice.openEnd)
    },
    handleKeyDown() { return false },
  })
  const from = posOf(view.state.doc, 'fore.'), to = posOf(view.state.doc, 'ter.')
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)))
  const before = !!undersideOf(view.state.doc).node
  const ev = new w.Event('cut', { bubbles: true, cancelable: true })
  view.dom.dispatchEvent(ev)
  // captureCopy appends a wrapper div to body synchronously (no clipboardData in jsdom)
  const wrap = document.body.lastElementChild
  copied = wrap && wrap !== document.getElementById('editor') ? wrap.textContent : '(no capture)'
  log('B5 native cut event: underside before =', before, '| after =', !!undersideOf(view.state.doc).node, '| clipboard capture includes hidden text =', String(copied).includes('absent'), '| capture text =', JSON.stringify(copied))
  view.destroy()
}

// B5b. The fix: a handleDOMEvents.cut handler runs before PM's and can take over.
{
  let intercepted = false
  const view = makeView([], { handleDOMEvents: { cut(view, e) { intercepted = true; e.preventDefault(); return true } } })
  const from = posOf(view.state.doc, 'fore.'), to = posOf(view.state.doc, 'ter.')
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)))
  view.dom.dispatchEvent(new w.Event('cut', { bubbles: true, cancelable: true }))
  log('B5b handleDOMEvents.cut intercepted =', intercepted, '| underside survives =', !!undersideOf(view.state.doc).node)
  view.destroy()
}

// B6. A DOM mutation that removes the closed placeholder (an extension, an IME, a browser quirk):
//     what does PM's DOM reader make of it, and does an appendTransaction net restore it in the same undo event?
{
  const net = new Plugin({
    appendTransaction(trs, oldState, newState) {
      if (!trs.some(t => t.docChanged) || trs.some(t => t.getMeta('folio:visibleEdit'))) return null
      const had = undersideOf(oldState.doc).node, has = undersideOf(newState.doc).node
      if (!had || has) return null
      // crude: put it back where it was (after the lifted paragraph)
      let at = 0; newState.doc.forEach((n, off) => { if (n.attrs && n.attrs.pid === 'L') at = off + n.nodeSize })
      return newState.tr.insert(at, had)
    },
  })
  const view = makeView([net])
  const original = view.state.doc
  const placeholder = view.dom.querySelector('.closed-underside')
  placeholder.remove()
  view.domObserver.flush()
  log('B6 after removing the placeholder from the DOM and flushing: underside in state =', !!undersideOf(view.state.doc).node, '| doc equals original =', view.state.doc.eq(original), '| placeholder re-rendered =', !!view.dom.querySelector('.closed-underside'))
  // Now with no net: does PM delete the node from the state when the DOM loses the placeholder?
  view.destroy()
  const view2 = makeView()
  view2.dom.querySelector('.closed-underside').remove()
  view2.domObserver.flush()
  log('B6 without a net: underside in state after DOM removal =', !!undersideOf(view2.state.doc).node, '| doc text =', JSON.stringify(view2.state.doc.textContent))
  view2.destroy()
}

// B7. NodeSelection of a closed underside (what K1's first Backspace press produces) and what PM draws.
{
  const view = makeView()
  view.dom.focus()
  const { pos } = undersideOf(view.state.doc)
  let threw = null
  try { view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos))) } catch (e) { threw = e.message }
  const el = view.dom.querySelector('.closed-underside')
  log('B7 NodeSelection of closed underside: threw =', threw, '| placeholder has ProseMirror-selectednode class =', !!(el && el.classList.contains('ProseMirror-selectednode')))
  view.destroy()
}
