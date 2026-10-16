import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { EditorView } from '@tiptap/pm/view'
import type { Node as PMNode } from '@tiptap/pm/model'
import { FOLD } from '../page/schema'

// The companion's two quiet presences on the page (involvement §3), both
// decorations: never in the document, the undo history, a save or a trace.
// - A ghost: its question (or opening line) drawn in an empty paragraph,
//   gone at the first character.
// - A mark: a dot beside one sentence it thinks has something beneath it;
//   pressing the dot lifts that sentence.

export const OPENING = '@opening'

export interface PresenceState {
  /** pid → the ghost's words; OPENING for a blank page's first line. */
  ghosts: Map<string, string>
  mark: { pid: string; sentence: string } | null
}

export type PresenceMeta =
  | { type: 'ghost'; pid: string; text: string }
  | { type: 'clearGhost'; pid: string }
  | { type: 'mark'; pid: string; sentence: string }
  | { type: 'clearMark' }
  | { type: 'clearGhosts' }
  | { type: 'clearAll' }

export const presenceKey = new PluginKey<PresenceState>('folioCompanionPresence')

export interface PresenceOptions {
  /** Pressing a mark's dot. */
  onLiftMarked?: (pid: string, sentence: string) => void
  /** Esc with the caret in the marked paragraph: the writer set the mark aside. */
  onDismissMark?: () => void
  labels?: () => { mark: string; ghost: string }
}

export function paragraphByPid(doc: PMNode, pid: string): { node: PMNode; pos: number } | null {
  let found: { node: PMNode; pos: number } | null = null
  doc.descendants((node, pos) => {
    if (found) return false
    if (node.type.name === 'paragraph') {
      if (String(node.attrs.pid ?? '') === pid) found = { node, pos }
      return false
    }
    return true
  })
  return found
}

/** Where `sentence` sits in the paragraph, if it's still there and unlifted. */
export function sentenceRange(doc: PMNode, pid: string, sentence: string): { from: number; to: number } | null {
  const p = paragraphByPid(doc, pid)
  if (!p) return null
  let text = ''
  const starts: number[] = []
  let lifted = false
  p.node.forEach((child, offset) => {
    if (!child.isText || !child.text) return
    for (let i = 0; i < child.text.length; i++) starts.push(p.pos + 1 + offset + i)
    text += child.text
  })
  const at = text.indexOf(sentence)
  if (at < 0) return null
  const from = starts[at]
  const to = starts[at + sentence.length - 1] + 1
  doc.nodesBetween(from, to, (n) => { if (n.marks.some((m) => m.type.name === FOLD)) lifted = true })
  return lifted ? null : { from, to }
}

function blankPage(doc: PMNode): PMNode | null {
  const first = doc.firstChild
  return doc.childCount === 1 && first && first.type.name === 'paragraph' && first.content.size === 0 ? first : null
}

function prune(state: PresenceState, doc: PMNode): PresenceState {
  let ghosts = state.ghosts
  for (const [pid] of state.ghosts) {
    if (pid === OPENING) {
      if (!blankPage(doc)) { if (ghosts === state.ghosts) ghosts = new Map(ghosts); ghosts.delete(pid) }
      continue
    }
    const p = paragraphByPid(doc, pid)
    // The first character (or the paragraph going) ends the ghost.
    if (!p || p.node.content.size > 0) {
      if (ghosts === state.ghosts) ghosts = new Map(ghosts)
      ghosts.delete(pid)
    }
  }
  const mark = state.mark && sentenceRange(doc, state.mark.pid, state.mark.sentence) ? state.mark : null
  return ghosts === state.ghosts && mark === state.mark ? state : { ghosts, mark }
}

export function presencePlugin(options: PresenceOptions = {}): Plugin<PresenceState> {
  return new Plugin<PresenceState>({
    key: presenceKey,
    state: {
      init: () => ({ ghosts: new Map(), mark: null }),
      apply(tr, value, _old, newState) {
        let next = value
        const meta = tr.getMeta(presenceKey) as PresenceMeta | undefined
        if (meta) {
          if (meta.type === 'clearAll') next = { ghosts: new Map(), mark: null }
          else if (meta.type === 'clearGhosts') next = { ...next, ghosts: new Map() }
          else if (meta.type === 'ghost') next = { ...next, ghosts: new Map(next.ghosts).set(meta.pid, meta.text) }
          else if (meta.type === 'clearGhost') { const g = new Map(next.ghosts); g.delete(meta.pid); next = { ...next, ghosts: g } }
          else if (meta.type === 'mark') next = { ...next, mark: { pid: meta.pid, sentence: meta.sentence } }
          else if (meta.type === 'clearMark') next = { ...next, mark: null }
        }
        return tr.docChanged || meta ? prune(next, newState.doc) : next
      },
    },
    props: {
      // Every action has a key (§3.10): Mod+Alt+L lifts the line the companion marked.
      handleKeyDown(view, event) {
        const s = presenceKey.getState(view.state)
        if (!s?.mark) return false
        if (event.key === 'Escape') {
          const $c = view.state.selection.$from
          if ($c.parent.type.name === 'paragraph' && String($c.parent.attrs.pid ?? '') === s.mark.pid) options.onDismissMark?.()
          return false // Esc keeps its own meaning (close, unlift)
        }
        const mod = event.metaKey || event.ctrlKey
        if (!mod || !event.altKey || event.code !== 'KeyL') return false
        options.onLiftMarked?.(s.mark.pid, s.mark.sentence)
        return true
      },
      decorations(state) {
        const s = presenceKey.getState(state)
        if (!s || (s.ghosts.size === 0 && !s.mark)) return null
        const labels = options.labels?.() ?? { mark: 'Lift the line the companion marked', ghost: 'Companion' }
        const decos: Decoration[] = []
        for (const [pid, text] of s.ghosts) {
          const p = pid === OPENING ? (blankPage(state.doc) ? { node: state.doc.firstChild as PMNode, pos: 0 } : null) : paragraphByPid(state.doc, pid)
          if (!p || p.node.content.size > 0) continue
          decos.push(Decoration.node(p.pos, p.pos + p.node.nodeSize, { class: 'folio-ghost', 'data-ghost': text, 'aria-description': `${labels.ghost}: ${text}` }))
        }
        if (s.mark) {
          const r = sentenceRange(state.doc, s.mark.pid, s.mark.sentence)
          if (r) {
            decos.push(Decoration.inline(r.from, r.to, { class: 'folio-marked' }))
            const { pid, sentence } = s.mark
            decos.push(Decoration.widget(r.from, () => markButton(labels.mark, () => options.onLiftMarked?.(pid, sentence)), {
              side: -1, key: `mark:${pid}:${sentence.length}`, ignoreSelection: true, stopEvent: () => true,
            }))
          }
        }
        return DecorationSet.create(state.doc, decos)
      },
    },
  })
}

function markButton(label: string, onPress: () => void): HTMLElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'folio-mark'
  button.setAttribute('contenteditable', 'false')
  button.setAttribute('aria-label', label)
  button.dataset.folioMark = ''
  button.addEventListener('mousedown', (e) => e.preventDefault())
  button.addEventListener('click', (e) => { e.preventDefault(); onPress() })
  return button
}

export function presence(state: EditorState): PresenceState {
  return presenceKey.getState(state) ?? { ghosts: new Map(), mark: null }
}

export function withPresence(tr: Transaction, meta: PresenceMeta): Transaction {
  return tr.setMeta(presenceKey, meta).setMeta('addToHistory', false)
}

export function dispatchPresence(view: EditorView, meta: PresenceMeta): void {
  view.dispatch(withPresence(view.state.tr, meta))
}
