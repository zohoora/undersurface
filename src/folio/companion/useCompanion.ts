import { useCallback, useEffect, useRef } from 'react'
import type { MutableRefObject } from 'react'
import type { Editor } from '@tiptap/core'
import type { Transaction } from '@tiptap/pm/state'
import { BETWEEN, FOLD, UNDERSIDE } from '../page/schema'
import type { Gap } from '../page/schema'
import { TR_LOAD, foldViewKey } from '../page/foldView'
import type { FoldViewMeta } from '../page/foldView'
import { findUnderside } from '../page/commands'
import { readingOrderUnits } from '../safety/samples'
import { checkKeys } from '../safety/checkedSet'
import { lastOtherPage } from '../store'
import type { ComeBackChoice } from '../kept/comeBack'
import { usableTimezone } from '../kept/comeBack'
import { getSettings } from '../../store/settings'
import type { FolioTrace } from '../../types/folio'
import { TR_COMPANION, writerOnlyOf, writerText } from './companionText'
import { arrivalLift, arrivalOpening, closeFold, companionLift } from './acts'
import { CompanionConductor, composition } from './conductor'
import type { Act, ArrivalContext, KeepResult } from './conductor'
import type { Arrival, Message } from './calls'
import { OPENING, dispatchPresence } from './presence'
import { powersOf } from './levels'
import type { InvolvementLevel } from './levels'
import { visitBudget } from './visit'

// Wires the conductor to one Folio page (involvement §4): the page's own
// state is read at the moment of each decision (the gate, the checked set,
// the caret), and each act is shown with a notice and undone by the writer's
// own commands.

export type CompanionNotice =
  | { kind: 'companion'; act: 'lifted'; text: string; foldId: string }
  | { kind: 'companion'; act: 'kept'; text: string; traceId: string; comeBackAt: number | null }
  | { kind: 'companion'; act: 'closed'; text: string; foldId: string }
  | { kind: 'companion'; act: 'arrived' | 'began'; text: string }

export interface CompanionPage {
  editor: Editor | null
  uid: string
  pageId: string
  level: InvolvementLevel
  /** This tab holds the page and it's editable. */
  holder: boolean
  /** The gate: normal presentation, not Recent, no card, a healthy save chain, not grounding. */
  gate: () => boolean
  checkedRef: MutableRefObject<Set<string>>
  /** The highest L2 risk seen for a unit this visit, or null if not classified this visit. */
  riskOf: (pid: string) => number | null
  /** Folio's reduced motion, or the system's. */
  reduceMotion: () => boolean
  switches: () => { between: boolean; distance: boolean }
  call: (messages: Message[], signal: AbortSignal) => Promise<string>
  l1: (text: string) => boolean
  languageName: () => string | null
  /** The writer's kept things, for Return-like context and "kept again". */
  traces: () => FolioTrace[]
  keepFold: (foldId: string, by: 'companion') => Promise<{ trace: FolioTrace } | null>
  name: (traceId: string, title: string) => void
  setComeBack: (traceId: string, choice: ComeBackChoice) => number | null
  undoKeep: (traceId: string) => void
  note: (pid: string, composition: string) => Promise<boolean>
  stepInside: (foldId: string) => void
  prefill: (traceId: string, title: string | null, choice: ComeBackChoice) => void
  notify: (n: CompanionNotice) => void
  announce: (message: string) => void
  t: (key: CompanionKey, vars?: Record<string, string>) => string
  shortDate: (ms: number) => string
}

export type CompanionKey =
  | 'folio.stepInside'
  | 'folio.ask.label'
  | 'folio.companion.marked' | 'folio.companion.lifted' | 'folio.companion.kept' | 'folio.companion.keptUntitled'
  | 'folio.companion.closed' | 'folio.companion.arrived' | 'folio.companion.began'

/** The writer-local day and part of day (their chosen timezone), in English for the model; it writes in the writer's language. */
function when(): string {
  const tz = usableTimezone(getSettings().timezone)
  try {
    const d = new Date()
    const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: tz }).format(d))
    const part = hour < 5 ? 'night' : hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening'
    return `${d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: tz })}, ${part}`
  } catch {
    return 'today'
  }
}

/** The writer's words at the end of a stored page (at most ~1,000 characters). */
function pageEnd(doc: string): string {
  try {
    const json = JSON.parse(doc) as { content?: unknown[] }
    const texts: string[] = []
    const walk = (n: unknown) => {
      const node = n as { type?: string; text?: string; marks?: { type: string }[]; content?: unknown[] }
      if (node.type === 'paragraph') {
        const t = writerOnlyOf(node.content as Parameters<typeof writerOnlyOf>[0])
        if (t.trim()) texts.push(t)
        return
      }
      for (const c of node.content ?? []) walk(c)
    }
    for (const n of json.content ?? []) walk(n)
    return texts.join('\n\n').slice(-1000)
  } catch {
    return ''
  }
}

export function useCompanion(p: CompanionPage) {
  const pRef = useRef(p)
  useEffect(() => { pRef.current = p })
  const conductorRef = useRef<CompanionConductor | null>(null)
  const { editor, uid, pageId, level, holder } = p

  useEffect(() => {
    if (!editor) return
    const page = () => pRef.current
    // The writer's last key, pointer or scroll (Step inside opens itself only after stillness).
    let lastInputAt = Date.now()
    const onInput = () => { lastInputAt = Date.now() }
    const inputs = ['keydown', 'pointerdown', 'pointermove', 'wheel', 'scroll', 'touchstart'] as const
    for (const e of inputs) document.addEventListener(e, onInput, { capture: true, passive: true })
    const onVisible = () => { if (document.visibilityState === 'visible') conductorRef.current?.resume() }
    document.addEventListener('visibilitychange', onVisible)
    // When the writer last wrote in each fold (kept, then written again: keep again).
    const lastFoldEdit = new Map<string, number>()
    const conductor = new CompanionConductor({
      view: () => viewOf(editor),
      level: () => page().level,
      open: () => page().holder && page().gate(),
      checked: async (pids, opts) => {
        const all = readingOrderUnits(editor.state.doc)
        const units = all.filter((u) => pids.includes(u.pid))
        if (units.length === 0) return false
        const keys = await checkKeys(units)
        if (!keys.every((k) => page().checkedRef.current.has(k))) return false
        if (!opts?.ink) return true
        // Ink only beside risk 0: the units and their reading-order neighbours.
        const near = new Set<string>()
        all.forEach((u, i) => { if (pids.includes(u.pid)) for (const j of [i - 1, i, i + 1]) if (all[j]) near.add(all[j].pid) })
        return [...near].every((pid) => (page().riskOf(pid) ?? 0) === 0)
      },
      foldOutOfView: (foldId) => {
        const el = editor.view.dom.querySelector(`[data-fold-id="${CSS.escape(foldId)}"].folio-underside--open`) ?? editor.view.dom.querySelector(`div[data-fold-id="${CSS.escape(foldId)}"]`)
        if (!el) return false
        const r = el.getBoundingClientRect()
        return r.bottom < 0 || r.top > window.innerHeight
      },
      insideReady: (foldId) => {
        if (page().reduceMotion() || document.visibilityState !== 'visible' || !document.hasFocus()) return false
        if (Date.now() - lastInputAt < INSIDE_STILL_MS) return false
        const el = editor.view.dom.querySelector(`div[data-fold-id="${CSS.escape(foldId)}"]`)
        if (!el) return false
        const r = el.getBoundingClientRect()
        return r.top < window.innerHeight && r.bottom > 0
      },
      call: (m, s) => page().call(m, s),
      l1: (t) => page().l1(t),
      languageName: () => page().languageName(),
      when: () => when(),
      switches: () => page().switches(),
      lift: (req) => {
        const r = companionLift(editor.state, { ...req, switches: page().switches() })
        if (!r) return null
        // The writer's line stays where it was on screen, through the opening's animation too.
        const before = caretTop(editor)
        editor.view.dispatch(r.tr)
        holdCaretStill(editor, before)
        const text = page().t('folio.companion.lifted')
        page().notify({ kind: 'companion', act: 'lifted', text, foldId: r.foldId })
        page().announce(text)
        return { foldId: r.foldId, beneathPid: r.beneathPid }
      },
      keep: async (foldId): Promise<KeepResult | null> => {
        const c = composition(editor.state.doc, foldId)
        const reKeep = page().traces().some((t) => t.source.foldId === foldId)
        const kept = await page().keepFold(foldId, 'companion')
        if (!kept || !c) return null
        return { traceId: kept.trace.id, composition: c.text, beneathChars: c.beneathChars, reKeep }
      },
      isKept: (foldId) => {
        // Kept, and nothing written since: the newest trace of this fold matches it.
        const latest = page().traces().filter((t) => t.source.foldId === foldId).sort((a, b) => b.keptAt - a.keptAt)[0]
        if (!latest) return false
        const c = composition(editor.state.doc, foldId)
        return !!c && latest.keptAt >= (lastFoldEdit.get(foldId) ?? 0)
      },
      named: (traceId, title) => {
        page().name(traceId, title)
      },
      comeBack: (traceId, choice) => {
        const at = page().setComeBack(traceId, choice)
        const title = page().traces().find((t) => t.id === traceId)?.title
        const text = title ? page().t('folio.companion.kept', { title }) : page().t('folio.companion.keptUntitled')
        page().notify({ kind: 'companion', act: 'kept', text, traceId, comeBackAt: at })
        page().announce(text)
      },
      note: (pid, comp) => page().note(pid, comp),
      close: (foldId) => {
        const before = caretTop(editor)
        editor.view.dispatch(closeFold(editor.state, foldId))
        holdCaretStill(editor, before)
        const text = page().t('folio.companion.closed')
        page().notify({ kind: 'companion', act: 'closed', text, foldId })
        page().announce(text)
      },
      stepInside: (foldId) => {
        // Said first, then opened: the writer is told why focus moves.
        page().announce(page().t('folio.stepInside'))
        setTimeout(() => page().stepInside(foldId), 600)
      },
      arrivalContext: async (): Promise<ArrivalContext | null> => {
        // Only a recent last page is "the end of their last page" (7 days).
        const found = await lastOtherPage(page().uid, page().pageId).catch(() => null)
        const last = found && Date.now() - found.updatedAt <= 7 * 24 * 60 * 60 * 1000 ? found : null
        const kept = page().traces().slice().sort((a, b) => b.keptAt - a.keptAt).slice(0, 10).map((t) => t.title?.trim() || t.surface)
        return {
          when: when(),
          lastPage: last ? { id: last.id, text: pageEnd(last.doc), at: last.updatedAt } : null,
          kept,
        }
      },
      arrive: (a: Arrival, ctx: ArrivalContext) => {
        if (a.kind === 'lift' && ctx.lastPage) {
          const r = arrivalLift(editor.state, {
            sentence: a.sentence, gap: a.distance as Gap, between: a.between, starter: a.starter,
            fromPageId: ctx.lastPage.id, fromAt: ctx.lastPage.at, switches: page().switches(),
          })
          if (!r) return false
          editor.view.dispatch(r.tr)
          focusUnlessTouch(editor)
          if (!a.starter && a.question) dispatchPresence(editor.view, { type: 'ghost', pid: r.beneathPid, text: a.question })
          const text = page().t('folio.companion.arrived', { date: page().shortDate(ctx.lastPage.at) })
          page().notify({ kind: 'companion', act: 'arrived', text })
          page().announce(text)
          return true
        }
        if (a.kind === 'blank') {
          const tr = arrivalOpening(editor.state, a.line)
          if (!tr) return false
          editor.view.dispatch(tr)
          focusUnlessTouch(editor)
          const text = page().t('folio.companion.began')
          page().notify({ kind: 'companion', act: 'began', text })
          page().announce(text)
          return true
        }
        return false
      },
      prefill: (traceId, title, choice) => page().prefill(traceId, title, choice),
      active: () => document.hasFocus(),
      announce: (kind, text) => {
        page().announce(kind === 'mark' ? page().t('folio.companion.marked') : `${page().t('folio.ask.label')}: ${text}`)
      },
      budget: () => visitBudget(page().uid),
      diagnostic: (code) => { console.info(`[folio] ${code}`) },
    })
    conductorRef.current = conductor

    // Writer edits (not the companion's, not a load) reset the rest clock.
    let betweens = betweenFolds(editor.state.doc)
    let folds = undersides(editor.state.doc)
    const onTransaction = ({ transaction }: { transaction: Transaction }) => {
      if (transaction.getMeta(TR_LOAD)) {
        conductor.stand()
        betweens = betweenFolds(editor.state.doc)
        folds = undersides(editor.state.doc)
        return
      }
      if (!transaction.docChanged) return
      const nowBetweens = betweenFolds(editor.state.doc)
      const nowFolds = undersides(editor.state.doc)
      if (!transaction.getMeta(TR_COMPANION)) {
        const { pid, foldId } = caretPlace(editor)
        if (foldId) lastFoldEdit.set(foldId, Date.now())
        conductor.edited(pid, foldId)
        // A lift by the writer (key, bar or a mark's dot): a ghost question
        // waits beneath (level 3+), the mark's own question when it was the
        // marked line.
        for (const [id, f] of nowFolds) {
          if (folds.has(id)) continue
          const q = conductor.takeOfferQuestion(f.pid, f.line)
          if (q) dispatchPresence(editor.view, { type: 'clearMark' })
          void conductor.writerLifted(id, f.line, q)
        }
        for (const [id, line] of nowBetweens) if (!betweens.has(id)) void conductor.betweenOpened(id, line)
      }
      betweens = nowBetweens
      folds = nowFolds
    }
    editor.on('transaction', onTransaction)
    return () => {
      for (const e of inputs) document.removeEventListener(e, onInput, { capture: true })
      document.removeEventListener('visibilitychange', onVisible)
      editor.off('transaction', onTransaction)
      conductor.stand(false)
      conductorRef.current = null
    }
  }, [editor, uid, pageId])

  // The beat: about once a second while the companion may take part.
  useEffect(() => {
    if (!editor || !holder || !powersOf(level).marks) return
    const timer = setInterval(() => { void conductorRef.current?.tick() }, 1000)
    return () => clearInterval(timer)
  }, [editor, holder, level])

  // The level changed: clear what the new one doesn't allow.
  const lastLevel = useRef(level)
  useEffect(() => {
    if (lastLevel.current !== level) conductorRef.current?.levelChanged()
    lastLevel.current = level
  }, [level])

  // The page became editable: a blank page may be opened or begun (level 3+).
  const openedFor = useRef<string | null>(null)
  useEffect(() => {
    if (!editor || !holder || !powersOf(level).ghosts || openedFor.current === pageId) return
    openedFor.current = pageId
    const t = setTimeout(() => { void conductorRef.current?.opened() }, 600)
    return () => clearTimeout(t)
  }, [editor, holder, level, pageId])

  const writerKept = useCallback((k: KeepResult) => { void conductorRef.current?.writerKept(k) }, [])
  const markDismissed = useCallback(() => { conductorRef.current?.markDismissed() }, [])
  const writerActed = useCallback(() => { conductorRef.current?.writerActed() }, [])

  /** Undo of a companion act, from its notice. */
  const undo = useCallback((n: CompanionNotice) => {
    const c = conductorRef.current
    if (!editor || !c) return
    const act: Act = n.act === 'lifted' ? 'lift' : n.act === 'kept' ? 'keep' : n.act === 'closed' ? 'close' : 'arrival'
    if (n.act === 'lifted') {
      const tr = undoCompanionLift(editor.state, n.foldId)
      if (tr) editor.view.dispatch(tr)
    } else if (n.act === 'kept') {
      pRef.current.undoKeep(n.traceId)
    } else if (n.act === 'closed') {
      editor.view.dispatch(editor.state.tr.setMeta(foldViewKey, { type: 'open', ids: [n.foldId] } satisfies FoldViewMeta).setMeta('addToHistory', false))
    } else {
      editor.commands.undo()
    }
    c.undone(act)
  }, [editor])

  /** Level 5's arrival: "Start blank" empties the page the companion began. */
  const startBlank = useCallback(() => {
    if (!editor) return
    const { schema } = editor.state
    const tr = editor.state.tr.replaceWith(0, editor.state.doc.content.size, schema.nodes.paragraph.create({ pid: newPid() }))
      .setMeta(TR_COMPANION, true).setMeta('folio:visibleEdit', true)
    editor.view.dispatch(tr)
    dispatchPresence(editor.view, { type: 'clearGhost', pid: OPENING })
    conductorRef.current?.undone('arrival')
  }, [editor])

  return { writerKept, writerActed, markDismissed, undo, startBlank, conductorRef }
}

/** The editor's view once it's mounted (TipTap throws before then). */
function viewOf(editor: Editor): import('@tiptap/pm/view').EditorView | null {
  if (editor.isDestroyed) return null
  try { return editor.view } catch { return null }
}

/** True when an underside holds none of the writer's words (the companion's between and starter don't count). */
export function noWriterWords(node: import('@tiptap/pm/model').Node): boolean {
  let writer = ''
  node.descendants((n) => { if (n.isTextblock) { writer += writerText(n); return false } return true })
  return writer.trim() === ''
}

/** Undo a companion lift: the underside and the fold mark go together; the caret stays where it is. */
function undoCompanionLift(state: import('@tiptap/pm/state').EditorState, foldId: string): Transaction | null {
  const u = findUnderside(state.doc, foldId)
  if (!u || !noWriterWords(u.node)) return null
  const tr = state.tr.setMeta(TR_COMPANION, true).setMeta('folio:visibleEdit', true).setMeta('addToHistory', false)
  tr.delete(u.pos, u.pos + u.node.nodeSize)
  tr.doc.forEach((node, offset) => {
    if (node.type.name === 'paragraph') tr.removeMark(offset, offset + node.nodeSize, state.schema.marks[FOLD].create({ foldId }))
  })
  return tr.setMeta(foldViewKey, { type: 'close', ids: [foldId] } satisfies FoldViewMeta)
}

/** No key, pointer or scroll for this long before Step inside may open itself. */
const INSIDE_STILL_MS = 45_000

/** The caret is set in the state; focus (which raises a phone's keyboard) only with a pointer. */
function focusUnlessTouch(editor: Editor): void {
  try { if (!window.matchMedia('(pointer: coarse)').matches) editor.view.focus() } catch { /* no matchMedia */ }
}

function newPid(): string {
  const bytes = new Uint8Array(9)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 12)
}

/** Scroll so the caret's line stays at `top` for the next half second (folds animate open and closed). */
function holdCaretStill(editor: Editor, top: number | null): void {
  if (top === null) return
  const root = document.querySelector('.folio-root')
  const until = performance.now() + 500
  const frame = () => {
    if (editor.isDestroyed) return
    const now = caretTop(editor)
    if (now !== null && Math.abs(now - top) >= 1) root?.scrollBy(0, now - top)
    if (performance.now() < until) requestAnimationFrame(frame)
  }
  frame()
}

function caretTop(editor: Editor): number | null {
  try { return editor.view.coordsAtPos(editor.state.selection.head).top } catch { return null }
}

/** The caret's paragraph and the fold it's in (or on), if any. */
function caretPlace(editor: Editor): { pid: string | null; foldId: string | null } {
  const $c = editor.state.selection.$from
  const pid = $c.parent.type.name === 'paragraph' ? String($c.parent.attrs.pid ?? '') : null
  for (let d = $c.depth; d >= 1; d--) {
    const n = $c.node(d)
    if (n.type.name === UNDERSIDE) return { pid, foldId: String(n.attrs.foldId) }
  }
  let foldId: string | null = null
  $c.parent.forEach((c) => { const m = c.marks.find((x) => x.type.name === FOLD); if (m && !foldId) foldId = String(m.attrs.foldId) })
  return { pid, foldId }
}

/** Every underside on the page: its line and the paragraph it's lifted from. */
function undersides(doc: import('@tiptap/pm/model').Node): Map<string, { line: string; pid: string }> {
  const out = new Map<string, { line: string; pid: string }>()
  let lastPid = ''
  doc.forEach((node) => {
    if (node.type.name === 'paragraph') { lastPid = String(node.attrs.pid ?? ''); return }
    if (node.type.name === UNDERSIDE) out.set(String(node.attrs.foldId), { line: String(node.attrs.surfaceSnapshot ?? ''), pid: lastPid })
  })
  return out
}

/** Folds that have a between, with their lines (to notice a new, empty one). */
function betweenFolds(doc: import('@tiptap/pm/model').Node): Map<string, string> {
  const out = new Map<string, string>()
  doc.forEach((node) => {
    if (node.type.name !== UNDERSIDE || node.firstChild?.type.name !== BETWEEN) return
    if (node.firstChild.textContent.trim() !== '') return
    out.set(String(node.attrs.foldId), String(node.attrs.surfaceSnapshot ?? ''))
  })
  return out
}

