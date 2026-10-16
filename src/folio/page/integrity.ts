import { Plugin, PluginKey, TextSelection, NodeSelection } from '@tiptap/pm/state'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import type { Node as PMNode, MarkType } from '@tiptap/pm/model'
import { BETWEEN, FOLD, MAX_GAP, UNDERSIDE, foldIdsInParagraph, newId } from './schema'
import { TR_INTEGRITY, closedRanges, getFoldView } from './foldView'

// Invariants I1–I5, I7 and I9 (draft 4 §5.1), restored after every document
// change in one appended transaction tagged `folio:integrity`. The pass is
// idempotent: a document that satisfies every invariant produces no change.
//
// I1 Every fold mark's foldId has exactly one underside; orphan marks go.
// I2 Each non-loose underside sits directly after its paragraph, ordered by
//    mark position.
// I3 An underside without a matching mark is loose (removed only by Remove).
// I4 No fold marks inside undersides.
// I5 foldIds are unique; on a duplicate the earliest paragraph keeps it.
// I7 gap 0 has no between: an empty between is removed, a written one lifts
//    the gap to 1.
// I9 pids are unique and present; a duplicate is re-assigned outside closed
//    undersides, so the fixer never edits hidden writing.

export const integrityKey = new PluginKey('folioIntegrity')

interface TopEntry { node: PMNode; index: number }

function paragraphOwners(doc: PMNode): Map<string, number> {
  const owners = new Map<string, number>()
  doc.forEach((node, _offset, index) => {
    if (node.type.name !== 'paragraph') return
    for (const id of foldIdsInParagraph(node)) if (!owners.has(id)) owners.set(id, index)
  })
  return owners
}

function stripMarksAndDuplicates(tr: Transaction, foldType: MarkType): void {
  const doc = tr.doc
  // I4: fold marks inside undersides.
  doc.forEach((node, offset) => {
    if (node.type.name !== UNDERSIDE) return
    let has = false
    node.descendants((d) => { if (d.marks.some((m) => m.type === foldType)) has = true })
    if (has) tr.removeMark(offset, offset + node.nodeSize, foldType)
  })
  // I5: a foldId in more than one paragraph stays only in the earliest.
  const seen = new Set<string>()
  tr.doc.forEach((node, offset) => {
    if (node.type.name !== 'paragraph') return
    for (const id of foldIdsInParagraph(node)) {
      if (seen.has(id)) tr.removeMark(offset, offset + node.nodeSize, foldType.create({ foldId: id }))
    }
    for (const id of foldIdsInParagraph(node)) seen.add(id)
  })
}

function fixUndersideAttrs(tr: Transaction, foldType: MarkType): void {
  const owners = paragraphOwners(tr.doc)
  const claimed = new Set<string>()
  tr.doc.forEach((node, offset) => {
    if (node.type.name !== UNDERSIDE) return
    let foldId = node.attrs.foldId as string | null
    const attrs: Record<string, unknown> = { ...node.attrs }
    if (!foldId || claimed.has(foldId)) {
      foldId = newId()
      attrs.foldId = foldId
      attrs.loose = true
    } else {
      attrs.loose = !owners.has(foldId)
    }
    claimed.add(foldId)
    const gap = Math.max(0, Math.min(MAX_GAP, Number(node.attrs.gap) || 0))
    attrs.gap = gap
    if (Object.keys(attrs).some((k) => attrs[k] !== node.attrs[k])) tr.setNodeMarkup(offset, undefined, attrs)
  })
  // I1: marks whose foldId has no underside.
  tr.doc.forEach((node, offset) => {
    if (node.type.name !== 'paragraph') return
    for (const id of foldIdsInParagraph(node)) {
      if (!claimed.has(id)) tr.removeMark(offset, offset + node.nodeSize, foldType.create({ foldId: id }))
    }
  })
}

function fixGapZeroBetween(tr: Transaction): void {
  const edits: { pos: number; node: PMNode }[] = []
  tr.doc.forEach((node, offset) => {
    if (node.type.name === UNDERSIDE && node.attrs.gap === 0 && node.firstChild?.type.name === BETWEEN) edits.push({ pos: offset, node })
  })
  for (const { pos, node } of edits.reverse()) {
    const between = node.firstChild as PMNode
    if (between.textContent.trim() === '') tr.delete(pos + 1, pos + 1 + between.nodeSize)
    else tr.setNodeMarkup(pos, undefined, { ...node.attrs, gap: 1 })
  }
}

/** I2: the desired top-level order, as indices into the current children. */
function desiredOrder(doc: PMNode): number[] | null {
  const children: TopEntry[] = []
  doc.forEach((node, _o, index) => children.push({ node, index }))
  const byFold = new Map<string, number>()
  for (const c of children) if (c.node.type.name === UNDERSIDE && !c.node.attrs.loose) byFold.set(c.node.attrs.foldId as string, c.index)

  const placed = new Set<number>()
  const order: number[] = []
  for (const c of children) {
    if (placed.has(c.index)) continue
    if (c.node.type.name === UNDERSIDE && !c.node.attrs.loose) continue // placed with its paragraph
    order.push(c.index)
    placed.add(c.index)
    if (c.node.type.name === 'paragraph') {
      for (const id of foldIdsInParagraph(c.node)) {
        const u = byFold.get(id)
        if (u !== undefined && !placed.has(u)) { order.push(u); placed.add(u) }
      }
    }
  }
  // Any non-loose underside whose paragraph vanished in this pass stays put.
  for (const c of children) if (!placed.has(c.index)) { order.push(c.index); placed.add(c.index) }
  return order.every((v, i) => v === i) ? null : order
}

function reorder(tr: Transaction, order: number[]): void {
  const doc = tr.doc
  const nodes: PMNode[] = []
  const starts: number[] = []
  doc.forEach((node, offset) => { nodes.push(node); starts.push(offset) })
  const first = order.findIndex((v, i) => v !== i)
  let last = order.length - 1
  while (last > first && order[last] === last) last--
  const from = starts[first]
  const to = starts[last] + nodes[last].nodeSize

  // Keep the selection on the same node and offset across the move.
  const sel = tr.selection
  let anchorNode = -1
  let anchorOffset = 0
  for (let i = first; i <= last; i++) {
    if (sel.head >= starts[i] && sel.head <= starts[i] + nodes[i].nodeSize) { anchorNode = i; anchorOffset = sel.head - starts[i]; break }
  }
  const moved = order.slice(first, last + 1).map((i) => nodes[i])
  tr.replaceWith(from, to, moved)
  if (anchorNode >= 0) {
    let pos = from
    for (const i of order.slice(first, last + 1)) {
      if (i === anchorNode) break
      pos += nodes[i].nodeSize
    }
    const target = Math.min(pos + anchorOffset, tr.doc.content.size)
    const $t = tr.doc.resolve(target)
    tr.setSelection(sel instanceof NodeSelection && $t.nodeAfter ? NodeSelection.create(tr.doc, target) : TextSelection.near($t))
  }
}

function fixPids(tr: Transaction, state: EditorState): void {
  const closed = closedRanges(tr.doc, getFoldView(state).open)
  const inClosed = (pos: number) => closed.some((r) => pos > r.from && pos < r.to)
  const occurrences = new Map<string, { pos: number; closed: boolean }[]>()
  const missing: number[] = []
  tr.doc.descendants((node, pos) => {
    if (node.type.name !== 'paragraph') return true
    const pid = node.attrs.pid as string | null
    if (!pid) missing.push(pos)
    else occurrences.set(pid, [...(occurrences.get(pid) ?? []), { pos, closed: inClosed(pos) }])
    return false
  })
  const reassign: number[] = [...missing]
  for (const list of occurrences.values()) {
    if (list.length < 2) continue
    const keeper = list.find((o) => o.closed) ?? list[0]
    for (const o of list) if (o !== keeper) reassign.push(o.pos)
  }
  for (const pos of reassign) {
    const node = tr.doc.nodeAt(pos)
    if (node) tr.setNodeMarkup(pos, undefined, { ...node.attrs, pid: newId() })
  }
}

export function integrityPlugin(): Plugin {
  return new Plugin({
    key: integrityKey,
    appendTransaction(trs, _old, newState) {
      if (!trs.some((tr) => tr.docChanged)) return null
      const foldType = newState.schema.marks[FOLD]
      const tr = newState.tr
      stripMarksAndDuplicates(tr, foldType)
      fixUndersideAttrs(tr, foldType)
      fixGapZeroBetween(tr)
      const order = desiredOrder(tr.doc)
      if (order) reorder(tr, order)
      fixPids(tr, newState)
      if (!tr.docChanged) return null
      return tr.setMeta(TR_INTEGRITY, true)
    },
  })
}
