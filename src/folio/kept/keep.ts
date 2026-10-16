import type { JSONContent } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { BENEATH, BETWEEN, FOLD, UNDERSIDE, foldRange } from '../page/schema'
import type { Gap } from '../page/schema'
import { checkKey, checkKeys } from '../safety/checkedSet'
import type { SafetyUnit } from '../safety/samples'
import type { FolioTrace, FolioTraceEntry } from '../../types/folio'

// Keep (draft 4 §3.7, C3): a dated snapshot of the lifted line, the distance,
// the between and the beneath. The composition is stored as ProseMirror JSON
// in one string, like the page (build plan §3.3: italic, hard breaks and
// paragraph breaks survive exactly, and a snapshot can never be larger than
// the page it came from). Plain text is derived for safety, export and lists.

export interface Composition {
  v: 1
  /** The lifted line's inline content, without the fold mark. */
  line: JSONContent[]
  gap: Gap
  /** Paragraphs; null when there's no between. */
  between: JSONContent[] | null
  /** Paragraphs. */
  beneath: JSONContent[]
}

export interface FoldSnapshot {
  composition: Composition
  /** The lifted line as plain text. */
  surface: string
  /** The page paragraphs (pids) each passage came from. */
  sourcePids: { between: string[]; beneath: string[] }
  /** Nothing written between or beneath: there's nothing to keep. */
  empty: boolean
}

function stripFold(node: JSONContent): JSONContent {
  if (!node.marks) return node
  const marks = node.marks.filter((m) => m.type !== FOLD)
  const rest: JSONContent = { ...node }
  delete rest.marks
  return marks.length > 0 ? { ...rest, marks } : rest
}

function paragraphJSON(p: PMNode): JSONContent {
  const content = (p.toJSON() as JSONContent).content
  return content && content.length > 0 ? { type: 'paragraph', content: content.map(stripFold) } : { type: 'paragraph' }
}

/** A paragraph's text, with hard breaks as line breaks. */
export function inlineText(content: JSONContent[] | undefined): string {
  return (content ?? []).map((c) => (c.type === 'hardBreak' ? '\n' : c.text ?? '')).join('')
}

/** A passage's text: paragraphs separated by a blank line. */
export function passageText(paragraphs: JSONContent[] | null): string {
  return (paragraphs ?? []).map((p) => inlineText(p.content)).join('\n\n')
}

/** Snapshot an underside and its line. Null when the fold isn't on the page. */
export function snapshotFold(doc: PMNode, foldId: string): FoldSnapshot | null {
  let underside: PMNode | null = null
  let line: JSONContent[] | null = null
  doc.forEach((node, offset) => {
    if (node.type.name === 'paragraph' && line === null) {
      const r = foldRange(node, offset, foldId)
      if (r) {
        const fragment = node.content.cut(r.from - offset - 1, r.to - offset - 1)
        line = ((fragment.toJSON() ?? []) as JSONContent[]).map(stripFold)
      }
    }
    if (node.type.name === UNDERSIDE && node.attrs.foldId === foldId) underside = node
  })
  const found = underside as PMNode | null
  if (!found) return null
  const sourcePids = { between: [] as string[], beneath: [] as string[] }
  let between: JSONContent[] | null = null
  const beneath: JSONContent[] = []
  found.forEach((passage) => {
    const into = passage.type.name === BETWEEN ? (between = []) : passage.type.name === BENEATH ? beneath : null
    if (!into) return
    const pids = passage.type.name === BETWEEN ? sourcePids.between : sourcePids.beneath
    passage.forEach((p) => {
      into.push(paragraphJSON(p))
      if (p.attrs.pid) pids.push(String(p.attrs.pid))
    })
  })
  // A loose underside lost its line; it keeps the line it was lifted with.
  const lineContent: JSONContent[] = line ?? (found.attrs.surfaceSnapshot ? [{ type: 'text', text: String(found.attrs.surfaceSnapshot) }] : [])
  const composition: Composition = { v: 1, line: lineContent, gap: (found.attrs.gap ?? 0) as Gap, between, beneath }
  return {
    composition,
    surface: inlineText(lineContent),
    sourcePids,
    empty: passageText(between).trim() === '' && passageText(beneath).trim() === '',
  }
}

export function parseComposition(json: string): Composition | null {
  try {
    const c = JSON.parse(json) as Composition
    if (!c || c.v !== 1 || !Array.isArray(c.line) || !Array.isArray(c.beneath)) return null
    return c
  } catch {
    return null
  }
}

// ------------------------------------------------------------ safety (§5.4, "Traces too")

/** A trace unit's id: the trace's id with a fixed name or an entry's id. */
export function tracePid(traceId: string, part: string): string {
  return `${traceId}:${part}`
}

export function traceUnits(trace: Pick<FolioTrace, 'id' | 'surface' | 'composition'>, entries: Pick<FolioTraceEntry, 'id' | 'text'>[] = []): SafetyUnit[] {
  const c = parseComposition(trace.composition)
  const units: SafetyUnit[] = []
  const between = passageText(c?.between ?? null)
  const beneath = passageText(c?.beneath ?? [])
  if (between.trim() !== '') units.push({ pid: tracePid(trace.id, 'between'), kind: 'between', text: between, line: trace.surface })
  if (beneath.trim() !== '') units.push({ pid: tracePid(trace.id, 'beneath'), kind: 'beneath', text: beneath, line: trace.surface })
  for (const e of entries) if (e.text.trim() !== '') units.push({ pid: tracePid(trace.id, `e:${e.id}`), kind: 'page', text: e.text })
  return units
}

/**
 * On Keep, a passage is recorded as checked in the same write when every
 * page paragraph it came from is in the page's checked set (§5.4).
 * Otherwise it's left for the trace's own check.
 */
export async function keptCheckedKeys(
  traceId: string,
  snapshot: FoldSnapshot,
  pageUnits: SafetyUnit[],
  pageChecked: ReadonlySet<string>,
): Promise<string[]> {
  const byPid = new Map(pageUnits.map((u) => [u.pid, u]))
  const keys = await checkKeys(pageUnits)
  const checkedPids = new Set(pageUnits.filter((_, i) => pageChecked.has(keys[i])).map((u) => u.pid))
  const out: string[] = []
  const draft = { id: traceId, surface: snapshot.surface, composition: JSON.stringify(snapshot.composition) }
  for (const unit of traceUnits(draft)) {
    const part = unit.pid.slice(traceId.length + 1) as 'between' | 'beneath'
    const sources = snapshot.sourcePids[part].filter((pid) => byPid.has(pid))
    if (sources.length > 0 && sources.every((pid) => checkedPids.has(pid))) out.push(await checkKey(unit))
  }
  return out
}

// ------------------------------------------------------------ the trace

export function buildTrace(args: {
  id: string
  snapshot: FoldSnapshot
  source: FolioTrace['source']
  keptAt: number
  checked: string[]
  groundedNearKeep: boolean
  previousTraceId?: string | null
  correctedFromId?: string | null
}): FolioTrace {
  const trace: FolioTrace = {
    id: args.id,
    keptAt: args.keptAt,
    source: args.source,
    surface: args.snapshot.surface,
    gap: args.snapshot.composition.gap,
    composition: JSON.stringify(args.snapshot.composition),
    author: 'writer',
    groundedNearKeep: args.groundedNearKeep,
    safety: { checked: args.checked },
    schemaVersion: 2,
  }
  // Firestore rejects undefined, so optional links are left out when absent.
  if (args.previousTraceId) trace.previousTraceId = args.previousTraceId
  if (args.correctedFromId) trace.correctedFromId = args.correctedFromId
  return trace
}

/** What the floor and the slip show for a trace: its title, or its line. */
export function traceName(trace: Pick<FolioTrace, 'title' | 'surface'>): string {
  return trace.title?.trim() || trace.surface
}
