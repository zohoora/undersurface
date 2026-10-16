import type { EditorView } from '@tiptap/pm/view'
import type { Node as PMNode } from '@tiptap/pm/model'
import { BENEATH, BETWEEN, FOLD, UNDERSIDE } from '../page/schema'
import type { Gap } from '../page/schema'
import { getFoldView } from '../page/foldView'
import type { ComeBackChoice } from '../kept/comeBack'
import { safetyText, safetyTextOf, writerText } from './companionText'
import { OPENING, dispatchPresence, presence } from './presence'
import { passagePid } from './acts'
import type { Arrival, Message } from './calls'
import {
  arrivalMessages, chooseLineMessages, nameMessages, openingMessages, parseArrival, parseChooseLine,
  parseName, parseOpening, parseQuestion, questionMessages,
} from './calls'
import {
  CALL_TIMEOUT_MS, CLOSE_REST_MS, INSIDE_REST_MS, KEEP_REST_MS, REST_MS, UNDO_PAUSE_MS, limitsOf, powersOf,
} from './levels'
import type { InvolvementLevel } from './levels'

// When the companion takes part (involvement §4): the timing is deterministic
// (rest, Enter, lift, keep, open); the model decides only the words. Every
// act re-checks its preconditions at the moment it would apply, and a stale
// offer is dropped, never applied late:
//   1. the page has rested (no writer edit for REST_MS) and is visible;
//   2. the caret is outside the target;
//   3. every unit the act reads is in the page's checked set;
//   4. the target is unchanged since the call;
//   5. the gate is open: normal presentation, not Recent, no crisis card,
//      this tab holds the page, the save chain is healthy;
//   6. the level's budget allows it, and no call is in flight.
// Crisis owns the page: a closed gate clears every ghost and mark at once.

export type Act = 'mark' | 'lift' | 'keep' | 'note' | 'close' | 'inside' | 'ghost' | 'opening' | 'arrival'

export interface KeepResult { traceId: string; composition: string; beneathChars: number; reKeep: boolean }

export interface ArrivalContext {
  when: string
  /** The end of the writer's last page (their words only) and that page. */
  lastPage: { id: string; text: string; at: number } | null
  kept: string[]
}

export interface CompanionHost {
  view: () => EditorView | null
  level: () => InvolvementLevel
  /** The gate (precondition 5). */
  open: () => boolean
  /**
   * Every listed unit is in the checked set (precondition 3). With `ink` (the
   * companion would show or write words beside them), also no unit nor its
   * reading-order neighbour was classified above risk 0 this visit.
   */
  checked: (pids: string[], opts?: { ink?: boolean }) => Promise<boolean>
  /** Level 5: the fold is out of view and the caret well away (closing moves nothing being read). */
  foldOutOfView: (foldId: string) => boolean
  /** Level 5: Step inside may open itself: no key, pointer or scroll for a while, the tab focused, the composition in view, motion allowed. */
  insideReady: (foldId: string) => boolean
  call: (messages: Message[], signal: AbortSignal) => Promise<string>
  l1: (text: string) => boolean
  languageName: () => string | null
  /** e.g. "Tuesday evening, 15 October". */
  when: () => string
  /** The window has focus (nothing structural happens while the writer is elsewhere). */
  active?: () => boolean
  /** Say something through the page's live region. */
  announce?: (kind: 'mark' | 'ghost', text: string) => void
  /** This visit's counters, read when needed (a visit ends after 30 minutes hidden). */
  budget: () => VisitBudget
  switches: () => { between: boolean; distance: boolean }
  // ---- acts, performed by the host (which shows the notice)
  lift: (req: { pid: string; sentence: string; gap: Gap; between: string }) => { foldId: string; beneathPid: string } | null
  keep: (foldId: string) => Promise<KeepResult | null>
  isKept: (foldId: string) => boolean
  named: (traceId: string, title: string) => void
  comeBack: (traceId: string, choice: ComeBackChoice) => void
  note: (pid: string, composition: string) => Promise<boolean>
  close: (foldId: string) => void
  stepInside: (foldId: string) => void
  arrivalContext: () => Promise<ArrivalContext | null>
  arrive: (a: Arrival, ctx: ArrivalContext) => boolean
  /** Level 3: offer a name and a come-back day after the writer's own keep. */
  prefill?: (traceId: string, title: string | null, choice: ComeBackChoice) => void
  diagnostic?: (code: string) => void
  now?: () => number
}

interface MarkOffer { pid: string; sentence: string; question: string; gap: Gap; between: string; at: number; text: string }

/** One visit's counters (C5's visit: a load, or 30 minutes hidden). */
export interface VisitBudget {
  calls: number
  marks: number
  ghosts: number
  lifts: number
  keeps: number
  notes: number
  lastMarkAt: number
  lastLiftAt: number
  insideDone: boolean
  arrivalDone: boolean
  dismissedMarks: number
}

export function freshBudget(): VisitBudget {
  return { calls: 0, marks: 0, ghosts: 0, lifts: 0, keeps: 0, notes: 0, lastMarkAt: -Infinity, lastLiftAt: -Infinity, insideDone: false, arrivalDone: false, dismissedMarks: 0 }
}

/** The first choice of come-back day is deterministic (§5, call F): a model adds nothing. */
export function comeBackFor(k: Pick<KeepResult, 'beneathChars' | 'reKeep'>): ComeBackChoice {
  if (k.reKeep) return 'month'
  return k.beneathChars < 80 ? 'tomorrow' : 'week'
}

const MIN_MARK_CHARS = 40
/** A mark stays at least this long before the companion lifts its line itself (level 4+). */
const MARK_TO_LIFT_MS = 25_000
const MIN_BENEATH_CHARS = 20

export class CompanionConductor {
  private inflight: AbortController | null = null
  private lastEditAt: number
  private writerActedSinceStructural = true
  private readonly considered = new Set<string>()
  private readonly lastEditedPids: string[] = []
  private readonly foldChangedAt = new Map<string, number>()
  private offer: MarkOffer | null = null
  private readonly pausedUntil = new Map<Act, number>()
  private undos = 0
  private kept: { foldId: string; at: number; writerSince: boolean } | null = null
  private readonly closedAfterKeep = new Set<string>()

  private readonly host: CompanionHost
  private busy = false

  constructor(host: CompanionHost) {
    this.host = host
    this.lastEditAt = this.now()
  }

  private get budget(): VisitBudget { return this.host.budget() }

  private now(): number { return this.host.now?.() ?? Date.now() }

  // ------------------------------------------------------------ events from the page

  /** A writer edit (not the companion's, not a load). */
  edited(pid: string | null, foldId: string | null): void {
    const t = this.now()
    this.lastEditAt = t
    this.writerActedSinceStructural = true
    if (pid) {
      const i = this.lastEditedPids.indexOf(pid)
      if (i >= 0) this.lastEditedPids.splice(i, 1)
      this.lastEditedPids.push(pid)
      if (this.lastEditedPids.length > 20) this.lastEditedPids.shift()
    }
    if (foldId) this.foldChangedAt.set(foldId, t)
    if (this.kept) this.kept.writerSince = true
  }

  /** The page is visible again: the rest starts over (nothing acts on a return from elsewhere). */
  resume(): void {
    this.lastEditAt = this.now()
  }

  /** Any other writer action (a lift, a keep, a tap). */
  writerActed(): void {
    this.writerActedSinceStructural = true
    this.lastEditAt = this.now()
  }

  /** The writer undid one of the companion's acts: that act pauses; two Undos, the visit. */
  undone(act: Act): void {
    this.undos++
    const until = this.undos >= 2 ? Infinity : this.now() + UNDO_PAUSE_MS
    this.pausedUntil.set(act, until)
    if (act === 'lift') this.pausedUntil.set('mark', until)
    this.writerActed()
  }

  /** A mark the writer dismissed (Esc or the paragraph rewritten): two in a row pause marks. */
  markDismissed(): void {
    this.budget.dismissedMarks++
    if (this.budget.dismissedMarks >= 2) this.pausedUntil.set('mark', Infinity)
    this.offer = null
    const view = this.host.view()
    if (view) dispatchPresence(view, { type: 'clearMark' })
  }

  /** The question that came with a mark, for a lift of that line (by the writer's tap). */
  takeOfferQuestion(pid: string, sentence: string): string | null {
    const o = this.offer
    if (!o || o.pid !== pid || o.sentence !== sentence) return null
    this.offer = null
    return o.question
  }

  /** Clear everything shown and stop any call: the gate closed, the level fell, or a load. */
  stand(clear = true): void {
    this.inflight?.abort()
    this.inflight = null
    this.offer = null
    const view = this.host.view()
    if (clear && view) dispatchPresence(view, { type: 'clearAll' })
  }

  /** The level changed: what the new level doesn't allow is cleared; nothing applied is reverted. */
  levelChanged(): void {
    const p = powersOf(this.host.level())
    const view = this.host.view()
    this.inflight?.abort()
    this.inflight = null
    if (!view) return
    if (!p.marks) { this.offer = null; dispatchPresence(view, { type: 'clearAll' }) }
    else if (!p.ghosts) dispatchPresence(view, { type: 'clearGhosts' })
  }

  // ------------------------------------------------------------ the writer's own acts, answered

  /** The writer lifted a line (level 3+): a ghost question waits in the empty beneath. */
  async writerLifted(foldId: string, line: string, question: string | null = null): Promise<void> {
    this.writerActed()
    const p = powersOf(this.host.level())
    if (!p.ghosts || !this.host.open()) return
    const doc = this.host.view()?.state.doc
    const beneathPid = doc ? passagePid(doc, foldId, 'beneath') : null
    const linePid = doc ? lineParagraph(doc, foldId) : null
    if (!beneathPid || !linePid || !await this.waitChecked([linePid])) return
    const q = question ?? await this.ask('ghost', questionMessages({ line, passage: 'beneath', languageName: this.host.languageName() }), parseQuestion)
    if (q && this.host.open()) this.ghost(beneathPid, q)
  }

  /** A between appeared and is empty (level 3+). */
  async betweenOpened(foldId: string, line: string): Promise<void> {
    const p = powersOf(this.host.level())
    if (!p.ghosts || !this.host.open()) return
    const doc = this.host.view()?.state.doc
    const pid = doc ? passagePid(doc, foldId, 'between') : null
    const linePid = doc ? lineParagraph(doc, foldId) : null
    if (!pid || !linePid || !await this.waitChecked([linePid])) return
    const q = await this.ask('ghost', questionMessages({ line, passage: 'between', languageName: this.host.languageName() }), parseQuestion)
    if (q && this.host.open()) this.ghost(pid, q)
  }

  /** The writer kept (level 3: offer a name and a day; the writer decides). */
  async writerKept(k: KeepResult): Promise<void> {
    this.writerActed()
    const level = this.host.level()
    if (level < 3 || !this.host.prefill || !this.host.open()) return
    const title = await this.ask('ghost', nameMessages({ composition: k.composition, languageName: this.host.languageName() }), (raw) => parseName(raw, k.composition))
    this.host.prefill(k.traceId, title, comeBackFor(k))
  }

  /** The page opened (level 3+: an opening ghost on a blank page; level 5: arrival). */
  async opened(): Promise<void> {
    const level = this.host.level()
    const p = powersOf(level)
    const view = this.host.view()
    if (!p.ghosts || !view || !this.host.open() || !isBlank(view.state.doc)) return
    if (p.dances && !this.budget.arrivalDone) {
      this.budget.arrivalDone = true
      const ctx = await this.host.arrivalContext()
      if (ctx?.lastPage && ctx.lastPage.text.trim()) {
        const lastPage = ctx.lastPage.text
        const a = await this.ask('arrival', arrivalMessages({ when: ctx.when, languageName: this.host.languageName(), lastPage, kept: ctx.kept }), (raw) => parseArrival(raw, lastPage))
        const v = this.host.view()
        if (a && v && isBlank(v.state.doc) && this.host.open() && this.now() - this.lastEditAt >= 0 && this.host.arrive(a, ctx)) {
          this.writerActedSinceStructural = false
          return
        }
      }
      const line = await this.ask('opening', openingMessages({ when: this.host.when(), languageName: this.host.languageName() }), parseOpening)
      const v = this.host.view()
      if (line && v && isBlank(v.state.doc) && this.host.open()) this.host.arrive({ kind: 'blank', line }, ctx ?? { when: this.host.when(), lastPage: null, kept: [] })
      return
    }
    const line = await this.ask('opening', openingMessages({ when: this.host.when(), languageName: this.host.languageName() }), parseOpening)
    if (line) this.ghost(OPENING, line)
  }

  // ------------------------------------------------------------ the beat

  /** Called about once a second. Does at most one thing, and never overlaps itself. */
  async tick(): Promise<void> {
    if (this.busy) return
    this.busy = true
    try { await this.beat() } finally { this.busy = false }
  }

  private async beat(): Promise<void> {
    const view = this.host.view()
    if (!view) return
    const level = this.host.level()
    const p = powersOf(level)
    if (!p.marks) return
    if (!this.host.open()) {
      const s = presence(view.state)
      if (s.ghosts.size > 0 || s.mark || this.inflight) this.stand()
      return
    }
    if (this.inflight || (typeof document !== 'undefined' && document.visibilityState === 'hidden') || this.host.active?.() === false) return
    const t = this.now()
    const rest = t - this.lastEditAt
    if (rest < REST_MS) return

    // Level 5's follow-ups to a companion keep: Step inside when the writer is
    // still and looking at it; closing only after the writer has written again
    // and the fold is out of view.
    if (p.dances && this.kept) {
      const { foldId, at, writerSince } = this.kept
      const open = getFoldView(view.state).open.has(foldId)
      if (!this.budget.insideDone && !this.paused('inside') && open && rest >= INSIDE_REST_MS && t - at >= INSIDE_REST_MS && this.host.insideReady(foldId)) {
        this.budget.insideDone = true
        this.host.stepInside(foldId)
        return
      }
      if (writerSince && !this.closedAfterKeep.has(foldId) && !this.paused('close') && t - at >= CLOSE_REST_MS && open && !caretInFold(view, foldId) && this.host.foldOutOfView(foldId)) {
        this.closedAfterKeep.add(foldId)
        this.kept = null
        this.host.close(foldId)
        return
      }
    }

    if (!this.writerActedSinceStructural) return

    if (p.arranges && await this.tryKeep(view, level)) return
    if (p.arranges && this.tryLift(view, level)) return
    await this.tryMark(view, level)
  }

  // ------------------------------------------------------------ the acts

  private async tryMark(view: EditorView, level: InvolvementLevel): Promise<boolean> {
    const lim = limitsOf(level)
    const t = this.now()
    if (this.paused('mark') || this.budget.marks >= lim.marksPerVisit || t - this.budget.lastMarkAt < lim.markSpacingMs) return false
    if (this.offer || presence(view.state).mark) return false
    const caretPid = caretParagraph(view)
    const target = [...this.lastEditedPids].reverse().map((pid) => pageParagraph(view.state.doc, pid)).find((c) =>
      c && c.pid !== caretPid && c.text.length >= MIN_MARK_CHARS && !c.lifted && !this.considered.has(`${c.pid}:${c.text}`))
    if (!target) return false
    this.considered.add(`${target.pid}:${target.text}`)
    if (!await this.host.checked([target.pid], { ink: true })) return false
    const context = neighbours(view.state.doc, target.pid)
    const dances = powersOf(level).dances
    const chosen = await this.ask('mark', chooseLineMessages({ paragraph: target.text, context, languageName: this.host.languageName(), dances }), (raw) => parseChooseLine(raw, target.text, dances))
    const v = this.host.view()
    if (!chosen || !v || !this.host.open()) return false
    const now = pageParagraph(v.state.doc, target.pid)
    if (!now || now.text !== target.text || caretParagraph(v) === target.pid) return false
    this.offer = { pid: target.pid, sentence: chosen.sentence, question: chosen.question, gap: chosen.distance as Gap, between: chosen.between, at: this.now(), text: target.text }
    this.budget.marks++
    this.budget.lastMarkAt = this.now()
    dispatchPresence(v, { type: 'mark', pid: target.pid, sentence: chosen.sentence })
    this.host.announce?.('mark', chosen.sentence)
    return true
  }

  private tryLift(view: EditorView, level: InvolvementLevel): boolean {
    const o = this.offer
    const lim = limitsOf(level)
    const t = this.now()
    if (!o || this.paused('lift') || this.budget.lifts >= lim.liftsPerVisit || t - this.budget.lastLiftAt < lim.liftSpacingMs) return false
    if (t - o.at < MARK_TO_LIFT_MS) return false
    const now = pageParagraph(view.state.doc, o.pid)
    if (!now || now.text !== o.text || caretParagraph(view) === o.pid) { this.markDismissed(); return false }
    const dances = powersOf(level).dances
    const r = this.host.lift({ pid: o.pid, sentence: o.sentence, gap: dances ? o.gap : 0, between: dances ? o.between : '' })
    this.offer = null
    if (!r) return false
    this.budget.lifts++
    this.budget.lastLiftAt = t
    this.budget.dismissedMarks = 0
    this.writerActedSinceStructural = false
    // At level 5 with a distance the question is already written in the between.
    if (!(dances && o.gap > 0 && o.between)) this.ghost(r.beneathPid, o.question)
    return true
  }

  private async tryKeep(view: EditorView, level: InvolvementLevel): Promise<boolean> {
    const lim = limitsOf(level)
    if (this.paused('keep') || this.budget.keeps >= lim.keepsPerVisit) return false
    const t = this.now()
    const open = getFoldView(view.state).open
    for (const [foldId, changedAt] of this.foldChangedAt) {
      if (t - changedAt < KEEP_REST_MS || !open.has(foldId) || this.host.isKept(foldId) || caretInFold(view, foldId)) continue
      const c = composition(view.state.doc, foldId)
      if (!c || c.beneathChars < MIN_BENEATH_CHARS || !c.line) continue
      this.foldChangedAt.delete(foldId)
      if (!await this.host.checked(c.pids)) continue
      const k = await this.host.keep(foldId)
      if (!k) return false
      this.budget.keeps++
      this.writerActedSinceStructural = false
      this.kept = powersOf(level).dances ? { foldId, at: this.now(), writerSince: false } : null
      const title = await this.ask('keep', nameMessages({ composition: k.composition, languageName: this.host.languageName() }), (raw) => parseName(raw, k.composition))
      if (title) this.host.named(k.traceId, title)
      this.host.comeBack(k.traceId, comeBackFor(k))
      if (this.budget.notes < powersOf(level).notesPerVisit && !this.paused('note') && this.host.open()) {
        const pid = passagePid(view.state.doc, foldId, 'beneath')
        if (pid && await this.host.note(pid, k.composition)) this.budget.notes++
      }
      return true
    }
    return false
  }

  // ------------------------------------------------------------ helpers

  private ghost(pid: string, text: string): void {
    const view = this.host.view()
    const lim = limitsOf(this.host.level())
    if (!view || this.budget.ghosts >= lim.ghostsPerVisit || !this.host.open()) return
    this.budget.ghosts++
    dispatchPresence(view, { type: 'ghost', pid, text })
    this.host.announce?.('ghost', text)
  }

  /** Wait (up to 20 s) for units the writer just wrote to be checked and clear. */
  private async waitChecked(pids: string[]): Promise<boolean> {
    for (let i = 0; i < 40; i++) {
      if (!this.host.open()) return false
      if (await this.host.checked(pids, { ink: true })) return true
      await new Promise((r) => setTimeout(r, 500))
    }
    return false
  }

  private paused(act: Act): boolean {
    return (this.pausedUntil.get(act) ?? -Infinity) > this.now()
  }

  /** One model call: budgeted, timed out, never two at once; output passes L1 or is dropped. */
  private async ask<T>(act: Act, messages: Message[], parse: (raw: string) => T | null): Promise<T | null> {
    const lim = limitsOf(this.host.level())
    if (this.inflight || this.budget.calls >= lim.callsPerVisit || this.paused(act)) return null
    this.budget.calls++
    const controller = new AbortController()
    this.inflight = controller
    const timer = setTimeout(() => controller.abort(), CALL_TIMEOUT_MS)
    try {
      const raw = await this.host.call(messages, controller.signal)
      if (controller.signal.aborted) return null
      const out = parse(raw)
      if (out === null) { this.host.diagnostic?.(`folio.companion.${act}.none`); return null }
      if (this.host.l1(JSON.stringify(out))) { this.host.diagnostic?.('folio.companion.l1Out'); return null }
      return out
    } catch {
      if (!controller.signal.aborted) this.host.diagnostic?.(`folio.companion.${act}.failed`)
      return null
    } finally {
      clearTimeout(timer)
      if (this.inflight === controller) this.inflight = null
    }
  }
}

// ------------------------------------------------------------ reading the page

/** The pid of the page paragraph holding a fold's line. */
function lineParagraph(doc: PMNode, foldId: string): string | null {
  let pid: string | null = null
  doc.forEach((node) => {
    if (pid || node.type.name !== 'paragraph') return
    node.forEach((c) => { if (!pid && c.marks.some((m) => m.type.name === FOLD && m.attrs.foldId === foldId)) pid = String(node.attrs.pid ?? '') })
  })
  return pid
}

function isBlank(doc: PMNode): boolean {
  const first = doc.firstChild
  return doc.childCount === 1 && !!first && first.type.name === 'paragraph' && first.content.size === 0
}

function caretParagraph(view: EditorView): string | null {
  const $c = view.state.selection.$from
  return $c.parent.type.name === 'paragraph' ? String($c.parent.attrs.pid ?? '') : null
}

function caretInFold(view: EditorView, foldId: string): boolean {
  const $c = view.state.selection.$from
  for (let d = $c.depth; d >= 1; d--) {
    const n = $c.node(d)
    if (n.type.name === UNDERSIDE && n.attrs.foldId === foldId) return true
  }
  // On the lifted line itself.
  return $c.parent.type.name === 'paragraph' && $c.parent.content.content.some((c) => c.marks.some((m) => m.type.name === FOLD && m.attrs.foldId === foldId))
}

/** A page paragraph (not in an underside): its writer text and whether it holds a fold. */
function pageParagraph(doc: PMNode, pid: string): { pid: string; text: string; lifted: boolean } | null {
  let out: { pid: string; text: string; lifted: boolean } | null = null
  doc.forEach((node) => {
    if (out || node.type.name !== 'paragraph' || String(node.attrs.pid ?? '') !== pid) return
    let lifted = false
    node.forEach((c) => { if (c.marks.some((m) => m.type.name === FOLD)) lifted = true })
    out = { pid, text: writerText(node), lifted }
  })
  return out
}

/** The writer's words around a page paragraph, for context (at most ~600 characters each side). */
function neighbours(doc: PMNode, pid: string): string {
  const texts: string[] = []
  let at = -1
  doc.forEach((node) => {
    if (node.type.name !== 'paragraph') return
    if (String(node.attrs.pid ?? '') === pid) at = texts.length
    texts.push(writerText(node))
  })
  if (at < 0) return ''
  const before = texts.slice(Math.max(0, at - 2), at).join('\n\n').slice(-600)
  const after = texts.slice(at + 1, at + 3).join('\n\n').slice(0, 600)
  return [before, after].filter((s) => s.trim()).join('\n\n…\n\n')
}

/**
 * A fold's composition as the companion may read it, by the same rule as the
 * safety checks: what only the companion wrote is left out, a paragraph the
 * writer wrote in is read whole. Its units, and the writer's own beneath length.
 */
export function composition(doc: PMNode, foldId: string): { line: string; text: string; beneathChars: number; pids: string[] } | null {
  const lineParts: { type: string; text: string; marks: { type: string; attrs: Record<string, unknown> }[] }[] = []
  const between: string[] = []
  const beneath: string[] = []
  const pids: string[] = []
  let beneathWriter = 0
  let found = false
  doc.forEach((node) => {
    if (node.type.name === 'paragraph') {
      node.forEach((c) => {
        if (c.isText && c.marks.some((m) => m.type.name === FOLD && m.attrs.foldId === foldId)) {
          lineParts.push({ type: 'text', text: c.text ?? '', marks: c.marks.map((m) => ({ type: m.type.name, attrs: m.attrs as Record<string, unknown> })) })
          if (!pids.includes(String(node.attrs.pid))) pids.push(String(node.attrs.pid))
        }
      })
      return
    }
    if (node.type.name !== UNDERSIDE || node.attrs.foldId !== foldId) return
    found = true
    node.forEach((passage) => {
      passage.forEach((p) => {
        const text = safetyText(p)
        if (!text.trim()) return
        pids.push(String(p.attrs.pid))
        if (passage.type.name === BETWEEN) between.push(text)
        if (passage.type.name === BENEATH) { beneath.push(text); beneathWriter += writerText(p).trim().length }
      })
    })
  })
  if (!found) return null
  const line = safetyTextOf(lineParts)
  const text = [line, between.join('\n'), beneath.join('\n')].filter((s) => s.trim()).join('\n\n').slice(0, 1000)
  return { line, text, beneathChars: beneathWriter, pids }
}
