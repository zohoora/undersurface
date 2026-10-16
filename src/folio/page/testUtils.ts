import { Editor } from '@tiptap/core'
import type { JSONContent } from '@tiptap/core'
import { folioExtensions } from './folioCore'
import type { FolioCoreOptions } from './folioCore'
import { foldViewKey, getFoldView } from './foldView'
import type { FoldViewMeta } from './foldView'
import { UNDERSIDE } from './schema'

// Builders and a jsdom editor for the editor core's tests and the Playwright
// harness. Not shipped: only imported by *.test.ts and the e2e harness.

export function p(text: string, opts: { pid?: string; fold?: string; foldFrom?: number; foldTo?: number; italic?: boolean } = {}): JSONContent {
  const attrs = { pid: opts.pid ?? null }
  if (!text) return { type: 'paragraph', attrs }
  if (!opts.fold) return { type: 'paragraph', attrs, content: [{ type: 'text', text, ...(opts.italic ? { marks: [{ type: 'italic' }] } : {}) }] }
  const from = opts.foldFrom ?? 0
  const to = opts.foldTo ?? text.length
  const parts: JSONContent[] = []
  if (from > 0) parts.push({ type: 'text', text: text.slice(0, from) })
  parts.push({ type: 'text', text: text.slice(from, to), marks: [{ type: 'fold', attrs: { foldId: opts.fold } }] })
  if (to < text.length) parts.push({ type: 'text', text: text.slice(to) })
  return { type: 'paragraph', attrs, content: parts }
}

export function u(foldId: string, beneath: JSONContent[], opts: { between?: JSONContent[]; gap?: number; loose?: boolean } = {}): JSONContent {
  const content: JSONContent[] = []
  if (opts.between) content.push({ type: 'between', content: opts.between })
  content.push({ type: 'beneath', content: beneath })
  return { type: UNDERSIDE, attrs: { foldId, gap: opts.gap ?? (opts.between ? 1 : 0), loose: opts.loose ?? false, surfaceSnapshot: '' }, content }
}

export function doc(...content: JSONContent[]): JSONContent {
  return { type: 'doc', content }
}

export interface TestEditor {
  editor: Editor
  announcements: string[]
  diagnostics: string[]
  protectedIds: string[][]
  clock: { now: number }
  destroy: () => void
}

export function makeEditor(content: JSONContent, options: FolioCoreOptions = {}): TestEditor {
  const element = document.createElement('div')
  document.body.appendChild(element)
  const announcements: string[] = []
  const diagnostics: string[] = []
  const protectedIds: string[][] = []
  const clock = { now: 1_000_000 }
  const editor = new Editor({
    element,
    extensions: folioExtensions({
      onAnnounce: (m) => announcements.push(m),
      onDiagnostic: (c) => diagnostics.push(c),
      onProtected: (ids) => protectedIds.push(ids),
      now: () => clock.now,
      ...options,
    }),
    content,
  })
  return {
    editor, announcements, diagnostics, protectedIds, clock,
    destroy: () => { editor.destroy(); element.remove() },
  }
}

export function setOpen(editor: Editor, ids: string[], open = true): void {
  const meta: FoldViewMeta = open ? { type: 'open', ids } : { type: 'close', ids }
  editor.view.dispatch(editor.state.tr.setMeta(foldViewKey, meta).setMeta('addToHistory', false))
}

export function openIds(editor: Editor): string[] {
  return [...getFoldView(editor.state).open]
}

/** Text of the beneath (and between) of the underside with `foldId`. */
export function undersideText(editor: Editor, foldId: string): string | null {
  let text: string | null = null
  editor.state.doc.forEach((node) => {
    if (node.type.name === UNDERSIDE && node.attrs.foldId === foldId) text = node.textContent
  })
  return text
}

export function press(editor: Editor, key: string, init: KeyboardEventInit = {}): boolean {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
  editor.view.dom.dispatchEvent(event)
  return event.defaultPrevented
}

export function keyup(editor: Editor, key: string): void {
  editor.view.dom.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true }))
}

/** Position of the start of the text `needle` (first occurrence). */
export function posOf(editor: Editor, needle: string): number {
  let found = -1
  editor.state.doc.descendants((node, pos) => {
    if (found >= 0) return false
    if (node.isText && node.text) {
      const i = node.text.indexOf(needle)
      if (i >= 0) found = pos + i
    }
    return true
  })
  if (found < 0) throw new Error(`text not found: ${needle}`)
  return found
}

export function topLevelTypes(editor: Editor): string[] {
  const out: string[] = []
  editor.state.doc.forEach((n) => out.push(n.type.name === 'paragraph' ? `p:${n.textContent}` : `u:${n.attrs.foldId}${n.attrs.loose ? ':loose' : ''}`))
  return out
}
