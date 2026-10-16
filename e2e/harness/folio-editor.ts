// A page that mounts only Folio's editor core, for the Playwright matrix
// (folio build plan, step 2). Served by Vite in dev; never built or shipped.
import { Editor } from '@tiptap/core'
import type { JSONContent } from '@tiptap/core'
import { NodeSelection, TextSelection } from '@tiptap/pm/state'
import { undoDepth } from '@tiptap/pm/history'
import { folioExtensions } from '../../src/folio/page/folioCore'
import { foldViewKey, getFoldView } from '../../src/folio/page/foldView'
import { lift } from '../../src/folio/page/commands'
import { UNDERSIDE } from '../../src/folio/page/schema'

const announcements: string[] = []
const diagnostics: string[] = []
const element = document.getElementById('editor') as HTMLElement
const announcer = document.getElementById('announcer') as HTMLElement

function make(content: JSONContent): Editor {
  return new Editor({
    element,
    extensions: folioExtensions({
      onAnnounce: (m) => { announcements.push(m); announcer.textContent = m },
      onDiagnostic: (c) => diagnostics.push(c),
    }),
    content,
  })
}

let editor = make({ type: 'doc', content: [{ type: 'paragraph' }] })

const api = {
  load(content: JSONContent) {
    editor.destroy()
    element.innerHTML = ''
    announcements.length = 0
    diagnostics.length = 0
    editor = make(content)
    editor.view.focus()
  },
  open(ids: string[]) { editor.view.dispatch(editor.state.tr.setMeta(foldViewKey, { type: 'open', ids }).setMeta('addToHistory', false)) },
  close(ids: string[]) { editor.view.dispatch(editor.state.tr.setMeta(foldViewKey, { type: 'close', ids }).setMeta('addToHistory', false)) },
  openIds: () => [...getFoldView(editor.state).open],
  json: () => editor.getJSON(),
  undersideText(foldId: string): string | null {
    let text: string | null = null
    editor.state.doc.forEach((n) => { if (n.type.name === UNDERSIDE && n.attrs.foldId === foldId) text = n.textContent })
    return text
  },
  topLevel(): string[] {
    const out: string[] = []
    editor.state.doc.forEach((n) => out.push(n.type.name === 'paragraph' ? `p:${n.textContent}` : `u:${n.attrs.foldId}${n.attrs.loose ? ':loose' : ''}`))
    return out
  },
  selection() {
    const s = editor.state.selection
    return { kind: s instanceof NodeSelection ? 'node' : s.empty ? 'caret' : 'text', from: s.from, to: s.to, depth: s.$from.depth, parent: s.$from.parent.type.name }
  },
  posOf(needle: string): number {
    let found = -1
    editor.state.doc.descendants((node, pos) => {
      if (found >= 0) return false
      if (node.isText && node.text && node.text.includes(needle)) found = pos + node.text.indexOf(needle)
      return true
    })
    return found
  },
  setCaret(pos: number) {
    editor.view.focus()
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos)))
  },
  setSelection(from: number, to: number) {
    editor.view.focus()
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, from, to)))
  },
  lift() {
    const r = lift(editor.state)
    if (r.ok) editor.view.dispatch(r.tr)
    return r.ok ? r.foldId : r.reason
  },
  undoDepth: () => undoDepth(editor.state),
  domText: () => editor.view.dom.textContent ?? '',
  announcements: () => [...announcements],
  diagnostics: () => [...diagnostics],
}

;(window as unknown as { folio: typeof api }).folio = api
document.body.dataset.ready = 'true'
