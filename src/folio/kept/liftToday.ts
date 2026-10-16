import type { JSONContent } from '@tiptap/core'
import { Fragment } from '@tiptap/pm/model'
import type { Node as PMNode } from '@tiptap/pm/model'
import { TextSelection } from '@tiptap/pm/state'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import { TR_VISIBLE_EDIT, openFolds } from '../page/foldView'
import { BENEATH, FOLD, UNDERSIDE, newId } from '../page/schema'
import type { FolioPage } from '../../types/folio'
import { inlineText } from './keep'
import { ymdIn, compareYmd } from './comeBack'

// Lift into today's page (draft 4 §3.8): a trace's lifted line, quoted exactly,
// becomes the lifted line of a new fold at the end of today's page, marked
// "from ‹date›", with the caret waiting in the beneath. The trace doesn't
// change. The new fold is ordinary page writing: saved, guarded and checked
// like any other.

export interface LiftIntent {
  uid: string
  pageId: string
  traceId: string
  keptAt: number
  line: JSONContent[]
  at: number
}

const KEY = 'us.folioLiftToday'
const MAX_AGE_MS = 10 * 60 * 1000

export function writeLiftIntent(intent: LiftIntent): void {
  try { sessionStorage.setItem(KEY, JSON.stringify(intent)) } catch { /* nothing to do */ }
}

/** The pending lift for this page, once, for the account that asked for it. */
export function takeLiftIntent(uid: string, pageId: string, now: number = Date.now()): LiftIntent | null {
  try {
    const raw = sessionStorage.getItem(KEY)
    if (!raw) return null
    const v = JSON.parse(raw) as LiftIntent
    if (v.uid !== uid || v.pageId !== pageId) return null
    sessionStorage.removeItem(KEY)
    if (typeof v.at !== 'number' || now - v.at > MAX_AGE_MS || !Array.isArray(v.line)) return null
    return v
  } catch {
    return null
  }
}

export function clearLiftIntent(): void {
  try { sessionStorage.removeItem(KEY) } catch { /* nothing to do */ }
}

/** Today's page: the page edited most recently, if that was today (writer-local); else a new one. */
export function todaysPageId(latest: Pick<FolioPage, 'id' | 'updatedAt'> | null, now: number, tz: string, makeId: () => string = newId): string {
  if (latest && compareYmd(ymdIn(latest.updatedAt, tz), ymdIn(now, tz)) === 0) return latest.id
  return makeId()
}

/**
 * Append the quoted line as a new lifted line, its fold open and empty, the
 * caret in the beneath. An empty last paragraph is used instead of adding one.
 */
export function liftFromTrace(state: EditorState, intent: Pick<LiftIntent, 'traceId' | 'keptAt' | 'line'>, now: number = Date.now()): { tr: Transaction; foldId: string } | null {
  const { schema, doc } = state
  const text = inlineText(intent.line)
  if (text.trim() === '') return null
  const foldId = newId()
  const fold = schema.marks[FOLD].create({ foldId })
  let inline: PMNode[]
  try {
    inline = intent.line.map((n) => schema.nodeFromJSON(n)).map((n) => (n.isText ? n.mark(fold.addToSet(n.marks)) : n))
  } catch {
    return null
  }
  const paragraph = schema.nodes.paragraph.create({ pid: newId() }, Fragment.fromArray(inline))
  const underside = schema.nodes[UNDERSIDE].create(
    { foldId, gap: 0, loose: false, surfaceSnapshot: text, createdAt: now, fromTraceId: intent.traceId, fromKeptAt: intent.keptAt },
    schema.nodes[BENEATH].create(null, schema.nodes.paragraph.create({ pid: newId() })),
  )
  const tr = state.tr.setMeta(TR_VISIBLE_EDIT, true)
  const last = doc.lastChild
  let at = doc.content.size
  if (last && last.type.name === 'paragraph' && last.content.size === 0) {
    at = doc.content.size - last.nodeSize
    tr.replaceWith(at, doc.content.size, Fragment.from([paragraph, underside]))
  } else {
    tr.insert(at, Fragment.from([paragraph, underside]))
  }
  // paragraph, then underside(1) beneath(1) paragraph(1): the caret waits in the beneath.
  tr.setSelection(TextSelection.create(tr.doc, at + paragraph.nodeSize + 3))
  openFolds(tr, [foldId])
  return { tr: tr.scrollIntoView(), foldId }
}
