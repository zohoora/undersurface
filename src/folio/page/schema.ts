import { Extension, Mark, Node, mergeAttributes } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'

// Folio's document is `(paragraph | underside)+`. A lifted line carries a
// `fold` mark whose foldId names exactly one `underside` placed directly after
// its paragraph (draft 4 §5.1, I1–I2). The underside holds an optional
// `between` and a `beneath`, each `paragraph+`. Every paragraph carries a
// stable `pid` (§5.4) used for safety coverage.

export const FOLD = 'fold'
export const UNDERSIDE = 'underside'
export const BETWEEN = 'between'
export const BENEATH = 'beneath'

/** The five authored distances (§3.6): 0 touching … 4 very far. */
export type Gap = 0 | 1 | 2 | 3 | 4
export const MAX_GAP: Gap = 4
/** On-screen line-heights per stop (§3.6). */
export const GAP_LINE_HEIGHTS: Record<Gap, number> = { 0: 0, 1: 1, 2: 3, 3: 7, 4: 15 }

function dataAttr(name: string, fallback: unknown, parse: (v: string | null) => unknown = (v) => v) {
  return {
    default: fallback,
    parseHTML: (el: HTMLElement) => parse(el.getAttribute(`data-${name}`)),
    renderHTML: (attrs: Record<string, unknown>) => {
      const value = attrs[toCamel(name)]
      return value === null || value === undefined || value === fallback ? {} : { [`data-${name}`]: String(value) }
    },
  }
}

function toCamel(name: string): string {
  return name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())
}

const parseIntOr = (fallback: number) => (v: string | null) => {
  const n = v === null ? NaN : parseInt(v, 10)
  return Number.isFinite(n) ? n : fallback
}

export const Fold = Mark.create({
  name: FOLD,
  inclusive: false,
  excludes: FOLD,
  addAttributes() {
    return { foldId: dataAttr('fold-id', null) }
  },
  parseHTML() {
    return [{ tag: 'span[data-fold-id]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { class: 'folio-fold' }), 0]
  },
})

export const Underside = Node.create({
  name: UNDERSIDE,
  group: 'block',
  content: `${BETWEEN}? ${BENEATH}`,
  defining: true,
  isolating: true,
  selectable: true,
  draggable: false,
  addAttributes() {
    return {
      foldId: dataAttr('fold-id', null),
      gap: dataAttr('gap', 0, parseIntOr(0)),
      loose: dataAttr('loose', false, (v) => v === 'true'),
      surfaceSnapshot: dataAttr('surface-snapshot', ''),
      createdAt: dataAttr('created-at', 0, parseIntOr(0)),
      fromTraceId: dataAttr('from-trace-id', null),
      fromKeptAt: dataAttr('from-kept-at', null, (v) => (v === null ? null : parseIntOr(0)(v))),
    }
  },
  parseHTML() {
    return [{ tag: 'div[data-folio-underside]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-folio-underside': '' }), 0]
  },
})

export const Between = Node.create({
  name: BETWEEN,
  content: 'paragraph+',
  defining: true,
  selectable: false,
  parseHTML() {
    return [{ tag: 'div[data-folio-between]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-folio-between': '' }), 0]
  },
})

export const Beneath = Node.create({
  name: BENEATH,
  content: 'paragraph+',
  defining: true,
  selectable: false,
  parseHTML() {
    return [{ tag: 'div[data-folio-beneath]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-folio-beneath': '' }), 0]
  },
})

/** Adds a `pid` attribute to every paragraph. Uniqueness is I9 (integrity). */
export const ParagraphId = Extension.create({
  name: 'paragraphId',
  addGlobalAttributes() {
    return [{ types: ['paragraph'], attributes: { pid: dataAttr('pid', null) } }]
  },
})

export function newId(): string {
  const bytes = new Uint8Array(9)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 12)
}

export function isUnderside(node: PMNode | null | undefined): boolean {
  return !!node && node.type.name === UNDERSIDE
}

export function foldIdOf(node: PMNode): string | null {
  return (node.attrs.foldId as string | null) ?? null
}

/** Every top-level underside with its position, in document order. */
export function undersides(doc: PMNode): { node: PMNode; pos: number; foldId: string | null }[] {
  const out: { node: PMNode; pos: number; foldId: string | null }[] = []
  doc.forEach((node, offset) => {
    if (isUnderside(node)) out.push({ node, pos: offset, foldId: foldIdOf(node) })
  })
  return out
}

/** The foldIds whose marks appear in a paragraph, in mark-start order. */
export function foldIdsInParagraph(paragraph: PMNode): string[] {
  const ids: string[] = []
  paragraph.forEach((child) => {
    for (const mark of child.marks) {
      if (mark.type.name === FOLD) {
        const id = mark.attrs.foldId as string | null
        if (id && !ids.includes(id)) ids.push(id)
      }
    }
  })
  return ids
}

/** The text range [from, to) of a fold mark inside a paragraph at `paraPos`. */
export function foldRange(paragraph: PMNode, paraPos: number, foldId: string): { from: number; to: number } | null {
  let from = -1
  let to = -1
  paragraph.forEach((child, offset) => {
    if (child.marks.some((m) => m.type.name === FOLD && m.attrs.foldId === foldId)) {
      const start = paraPos + 1 + offset
      if (from < 0) from = start
      to = start + child.nodeSize
    }
  })
  return from < 0 ? null : { from, to }
}
