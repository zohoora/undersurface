import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import type { Editor, JSONContent } from '@tiptap/core'
import { useTranslation, getLanguageCode } from '../../i18n'
import { activateGrounding } from '../../store/groundingState'
import { checkCrisisRisk } from '../../ai/openrouter'
import { detectCrisisKeywords } from '../../engine/sessionOrchestrator'
import { folioExtensions, setOrnaments } from './folioCore'
import { foldViewKey, getFoldView, TR_LOAD } from './foldView'
import type { FoldViewMeta } from './foldView'
import { apart, findUnderside, lift } from './commands'
import { foldHint } from './guide'
import type { Corner } from './guide'
import { FOLIO_KEYS } from './keys'
import { coarsePointer, keyLabel } from './keyLabels'
import { undersideControls } from './undersideControls'
import { LiftControl } from './LiftControl'
import { UNDERSIDE, newId } from './schema'
import type { Gap } from './schema'
import { folioStringsFrom } from '../folioStrings'
import { readViewState, writeViewState } from '../viewState'
import { pageAdapter, EMPTY_DOC } from '../store'
import { PageSaveController } from '../save/PageSaveController'
import type { PageContent, SaveStatus } from '../save/PageSaveController'
import { listPending, removePending, writePending } from '../save/pendingStore'
import { acquirePageLock, holdEditorLiveness, liveEditorIds } from '../save/pageLock'
import type { PageLock } from '../save/pageLock'
import { prepareEditable, resolveOtherOrphans } from '../save/pageSession'
import { FolioSafetyWatch } from '../safety/FolioSafetyWatch'
import { readingOrderUnits } from '../safety/samples'
import type { SafetyUnit } from '../safety/samples'
import { checkKeys, pruneChecked } from '../safety/checkedSet'
import type { ShorePresentation } from '../safety/shorePresentation'
import type { FolioSwitches } from '../access'
import type { FolioLearned, FolioPage, FolioTrace } from '../../types/folio'
import { keptCheckedKeys, snapshotFold } from '../kept/keep'
import type { KeepRequest } from '../kept/useKept'
import { comeBackFields } from '../kept/comeBack'
import type { ComeBackChoice } from '../kept/comeBack'
import { ComeBackChoices } from '../kept/ComeBackChoices'
import { shortDate } from '../kept/dates'
import { liftFromTrace, takeLiftIntent } from '../kept/liftToday'
import { takeOpenFoldIntent } from '../kept/goToPage'
import { StepInside } from '../inside/StepInside'
import { useStepInside } from '../inside/useStepInside'
import { loadDoc, notesKey, withNote, withoutNote } from '../ask/notes'
import type { PendingNote } from '../ask/notes'
import { noteRender } from '../ask/noteViews'
import { askForNote } from '../ask/askContract'
import { ASK_MAX_CHARS, buildAskMessages } from '../ask/askPrompt'
import type { AskPassage } from '../ask/askPrompt'
import { streamChatCompletion } from '../../ai/openrouter'
import { isGroundingActive } from '../../store/groundingState'
import { getLLMLanguageName } from '../../i18n'
import { noWriterWords, useCompanion } from '../companion/useCompanion'
import type { CompanionKey, CompanionNotice } from '../companion/useCompanion'
import { TR_COMPANION, safetyText, writerText } from '../companion/companionText'
import { presence, sentenceRange } from '../companion/presence'
import { composition as foldComposition } from '../companion/conductor'
import type { KeepResult } from '../companion/conductor'
import { TextSelection } from '@tiptap/pm/state'
import type { Transaction } from '@tiptap/pm/state'
import { NOTICE_MS } from '../companion/levels'
import { noteMessages } from '../companion/calls'
import type { InvolvementLevel } from '../companion/levels'
import { FOLD } from './schema'

// One Folio page (draft 4 §3.4–§3.6, §5.1–§5.5): the editor core, saving
// (C2), safety coverage (C4) and the notices around them.

const SETTLE_MS = 2000
export const PAGE_WARN_BYTES = 400_000
export const PAGE_FULL_BYTES = 900_000
const encoder = new TextEncoder()

interface Props {
  uid: string
  pageId: string
  switches: FolioSwitches
  shore: ShorePresentation
  reduceMotion: boolean
  /** The Journal's ink weight and paragraph settle, after the admin switches and shore. */
  ornaments: { ink: boolean; settle: boolean }
  readOnlyForShore?: boolean
  onNavigate: (path: string, opts?: { replace?: boolean }) => void
  onAnnounce: (message: string) => void
  /** The page as last seen in a list, for a fast first paint. */
  onFirstContent?: () => void
  /** Shore and Quiet close Step inside and make it unavailable (§5.5). */
  presentation?: 'normal' | 'shore' | 'quiet'
  /** H1, when its switch is on; `sound` when its own switch is on, on the web. */
  stepInside?: { sound: boolean }
  /** H2, when its switch is on: Ask, and the shore door on a grounded note. */
  ask?: { isRecent: () => boolean; onTalkNow: () => void }
  /** Phase 2 (draft 4 §3.7, §3.8): Keep, its undo, and Come back to this. */
  kept?: {
    keep: (req: KeepRequest) => FolioTrace
    undo: (traceId: string) => void
    setComeBack: (traceId: string, choice: ComeBackChoice) => boolean
    tz: string
    /** The writer's kept things (involvement reads titles and "kept again"). */
    traces: FolioTrace[]
    /** Name a trace; `by` 'companion' marks the name as the companion's. */
    name: (traceId: string, title: string, by: 'companion' | null) => void
  }
  /** Companion involvement, 1–5 (docs/vision/2026-10-16-folio-involvement.md). */
  involvement?: InvolvementLevel
  /** The Recent overlay (72 h since a grounding activation). */
  isRecent?: () => boolean
  /** What the writer has already met (first-time lines show once per account). */
  learned?: FolioLearned
  /** Record a first time (merged into the preferences). */
  onLearn?: (patch: FolioLearned) => void
}

type Notice =
  | { kind: 'kept'; traceId: string; choosing: boolean; suggest?: { title: string | null; choice: ComeBackChoice }; first?: boolean }
  | { kind: 'learnMark' }
  | CompanionNotice
  | { kind: 'comingBack'; at: number }
  | { kind: 'protected'; ids: string[] }
  | { kind: 'conflict' }
  | { kind: 'remoteDeleted'; content: PageContent }
  | { kind: 'otherTab'; noAnswer?: boolean }
  | { kind: 'copied' }
  | { kind: 'full' }

/** The page's first words as the lists show them: the writer's, never a line only the companion wrote. */
function previewOf(editor: Editor): string {
  let out = ''
  editor.state.doc.forEach((node) => {
    if (out || node.type.name !== 'paragraph') return
    const text = safetyText(node)
    if (text.trim()) out = text
  })
  return out.slice(0, 120)
}

/** True when the page holds anything the writer wrote (a page the companion began isn't saved until then). */
function hasWriterWords(editor: Editor): boolean {
  let found = false
  editor.state.doc.descendants((node) => {
    if (found) return false
    if (node.isTextblock) { if (writerText(node).trim()) found = true; return false }
    return true
  })
  return found
}

function foldIdsOf(editor: Editor): string[] {
  const ids: string[] = []
  editor.state.doc.forEach((node) => { if (node.type.name === UNDERSIDE && node.attrs.foldId) ids.push(String(node.attrs.foldId)) })
  return ids
}

function foldCountOf(editor: Editor): number {
  let n = 0
  editor.state.doc.forEach((node) => { if (node.type.name === UNDERSIDE) n++ })
  return n
}

function textMap(units: SafetyUnit[]): Map<string, string> {
  return new Map(units.map((u) => [u.pid, `${u.line ?? ''}\u0000${u.text}`]))
}

export function FolioPageView({ uid, pageId, switches, shore, reduceMotion, ornaments, onNavigate, onAnnounce, kept, presentation = 'normal', stepInside, ask, involvement = 1, isRecent, learned, onLearn }: Props) {
  const tr = useTranslation()
  const strings = useMemo(() => folioStringsFrom(tr), [tr])
  const stringsRef = useRef(strings)
  const switchesRef = useRef(switches)
  const trRef = useRef(tr)
  useEffect(() => { stringsRef.current = strings }, [strings])
  useEffect(() => { switchesRef.current = switches }, [switches])
  useEffect(() => { trRef.current = tr }, [tr])
  // The first moment (docs/vision/2026-10-22-folio-first-moment.md): what the
  // writer has met, and whether the guides may show right now.
  const learnedRef = useRef<FolioLearned>(learned ?? {})
  useEffect(() => { learnedRef.current = learned ?? {} }, [learned])
  const onLearnRef = useRef(onLearn)
  useEffect(() => { onLearnRef.current = onLearn }, [onLearn])
  const guidesOn = useRef(false)
  const learn = useCallback((patch: FolioLearned) => {
    learnedRef.current = { ...learnedRef.current, ...patch }
    onLearnRef.current?.(patch)
  }, [])
  const doLiftRef = useRef<(corner?: Corner) => void>(() => {})

  const editorId = useMemo(() => newId(), [])
  const [ready, setReady] = useState(false)
  const [holder, setHolder] = useState(false)
  const [status, setStatus] = useState<SaveStatus | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [bytes, setBytes] = useState(0)
  const controllerRef = useRef<PageSaveController | null>(null)
  const watchRef = useRef<FolioSafetyWatch | null>(null)
  const lockRef = useRef<PageLock | null>(null)
  const checkedRef = useRef<Set<string>>(new Set())
  const unitsRef = useRef<Map<string, string>>(new Map())
  const settleTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const caretUnitRef = useRef<string | null>(null)
  const [looseAcknowledged] = useState(() => new Set<string>())
  const bytesRef = useRef(0)
  /**
   * Which folds are open is remembered only once the page's own content is in
   * the editor: before that (the first paint, a read-only snapshot) the open
   * set is empty, and writing it would forget the folds left open last time.
   */
  const viewStateReady = useRef(false)
  /** The highest L2 risk seen per unit this visit (the companion writes only beside 0). */
  const riskRef = useRef(new Map<string, number>())
  /** Pressing a companion mark's dot (involvement level 2+); set once the editor exists. */
  const liftMarkedRef = useRef<(pid: string, sentence: string) => void>(() => {})
  const dismissMarkRef = useRef<() => void>(() => {})
  const adapter = useMemo(() => pageAdapter(uid), [uid])

  const announce = useCallback((m: string) => { if (m) onAnnounce(m) }, [onAnnounce])
  const keptRef = useRef(kept)
  useEffect(() => { keptRef.current = kept }, [kept])
  const keepRef = useRef<(foldId: string) => void>(() => {})
  const canKeep = !!kept
  const stepInsideRef = useRef<(foldId: string) => void>(() => {})
  const canStepInside = !!stepInside
  const askRef = useRef(ask)
  useEffect(() => { askRef.current = ask }, [ask])
  const noteHandlers = useRef<Parameters<typeof noteRender>[1]>(() => ({ keep: () => {}, dismiss: () => {}, copy: () => {}, deleteNote: () => {}, talkNow: null }))
  // The notes' handlers read refs only when a note is drawn or pressed.
  /* eslint-disable react-hooks/refs */
  const notes = useMemo(() => noteRender(() => ({
    label: tr['folio.ask.label'], asking: tr['folio.ask.asking'], failed: tr['folio.ask.failed'], keep: tr['folio.ask.keep'],
    dismiss: tr['folio.ask.dismiss'], copy: tr['folio.ask.copy'], deleteNote: tr['folio.ask.delete'], talkNow: tr['folio.shore.talk'],
  }), () => noteHandlers.current()), [tr])
  /* eslint-enable react-hooks/refs */

  // As with the editor below: these callbacks read refs only when a control
  // is pressed, never during render.
  // eslint-disable-next-line react-hooks/refs
  const controls = useMemo(() => undersideControls({
    labels: () => ({
      close: tr['folio.close'], unlift: tr['folio.unlift'], closer: tr['folio.closer'], farther: tr['folio.farther'],
      looseTitle: tr['folio.loose.title'], looseKeep: tr['folio.loose.keep'], looseToPage: tr['folio.loose.toPage'], looseRemove: tr['folio.loose.remove'],
      keep: canKeep ? tr['folio.keep'] : undefined,
      stepInside: canStepInside ? tr['folio.stepInside'] : undefined,
      tips: { close: tr['folio.tip.close'], farther: tr['folio.tip.farther'], closer: tr['folio.tip.closer'], keep: tr['folio.tip.keep'], stepInside: tr['folio.tip.stepInside'] },
    }),
    switches: () => ({ between: switchesRef.current.between, distance: switchesRef.current.distance }),
    onAnnounce: announce,
    onKeep: (foldId) => keepRef.current(foldId),
    onStepInside: (foldId) => stepInsideRef.current(foldId),
    announceGap: (dir: -1 | 1, gap: Gap) => (dir > 0 ? stringsRef.current.farther(gap) : stringsRef.current.closer(gap)),
    closerBlocked: () => stringsRef.current.closerBlocked,
    unlifted: () => stringsRef.current.unlifted,
    looseAcknowledged,
  }), [tr, announce, looseAcknowledged, canKeep, canStepInside])

  // The callbacks below read refs only when the editor calls them from its
  // own event handlers, never during render.
  const editor = useEditor({
    // eslint-disable-next-line react-hooks/refs
    extensions: folioExtensions({
      strings: () => stringsRef.current,
      onAnnounce: announce,
      onProtected: (ids) => setNotice({ kind: 'protected', ids }),
      label: tr['folio.pageLabel'],
      placeholder: tr['folio.placeholder'],
      switches: () => ({ between: switchesRef.current.between, distance: switchesRef.current.distance }),
      locale: () => getLanguageCode(),
      controls,
      onStepInside: (foldId) => stepInsideRef.current(foldId),
      notes: () => notes,
      presence: {
        onLiftMarked: (pid, sentence) => liftMarkedRef.current(pid, sentence),
        onDismissMark: () => dismissMarkRef.current(),
        labels: () => ({ mark: tr['folio.companion.markLabel'], ghost: tr['folio.ask.label'], who: tr['folio.companion.who'], markTitle: tr['folio.companion.markTitle'] }),
      },
      guide: {
        enabled: () => guidesOn.current,
        learned: () => (learnedRef.current.lifts ?? 0) >= 2,
        labels: () => ({ corner: trRef.current['folio.corner'], cornerLabel: trRef.current['folio.corner.label'], foldHint: trRef.current['folio.learn.fold'] }),
        shortcut: () => (coarsePointer() ? null : keyLabel(FOLIO_KEYS.liftOrToggle)),
        onLift: (corner) => doLiftRef.current(corner),
        locale: () => getLanguageCode(),
      },
      grip: {
        enabled: () => switchesRef.current.distance,
        label: () => trRef.current['folio.grip'],
        step: (view, foldId, dir) => {
          const r = apart(view.state, foldId, dir, switchesRef.current)
          if (!r.ok) return false
          view.dispatch(r.tr)
          return true
        },
        done: (_view, _foldId, gap, from) => {
          if (gap !== from) announce(gap > from ? stringsRef.current.farther(gap) : stringsRef.current.closer(gap))
        },
      },
    }),
    editable: false,
    content: JSON.parse(EMPTY_DOC) as JSONContent,
    editorProps: {
      attributes: { class: 'folio-editor', spellcheck: 'true' },
      handlePaste: () => bytesRef.current >= PAGE_FULL_BYTES,
    },
    immediatelyRender: true,
  }, [controls, notes])

  useEffect(() => {
    if (editor) setOrnaments(editor, ornaments)
  }, [editor, ornaments])

  // ------------------------------------------------------------ content

  const contentNow = useCallback((ed: Editor): PageContent => ({
    doc: JSON.stringify(ed.getJSON()),
    checked: [...checkedRef.current],
    preview: previewOf(ed),
    foldCount: foldCountOf(ed),
  }), [])

  const pushContent = useCallback(() => {
    const ed = editor
    const c = controllerRef.current
    if (!ed || !c) return
    const content = contentNow(ed)
    const size = encoder.encode(content.doc).length + content.checked.length * 19
    bytesRef.current = size
    setBytes(size)
    c.edit(content)
  }, [editor, contentNow])

  const pruneLater = useRef<ReturnType<typeof setTimeout> | null>(null)
  const schedulePrune = useCallback(() => {
    if (pruneLater.current) return
    pruneLater.current = setTimeout(() => {
      pruneLater.current = null
      if (!editor) return
      void checkKeys(readingOrderUnits(editor.state.doc)).then((keys) => {
        const pruned = pruneChecked(checkedRef.current, keys)
        if (pruned.length !== checkedRef.current.size) {
          checkedRef.current = new Set(pruned)
          pushContent()
        }
      })
    }, 10_000)
  }, [editor, pushContent])

  // ------------------------------------------------------------ the move to editable

  useEffect(() => {
    if (!editor) return
    let disposed = false
    const timers = settleTimers.current
    const releaseLiveness = holdEditorLiveness(editorId)
    const lock = acquirePageLock(uid, pageId, editorId)
    lockRef.current = lock
    let first: FolioPage | null | undefined
    const unsubscribe = adapter.subscribe(pageId, (snap) => {
      if (disposed) return
      if (first === undefined) first = snap.page
      if (!lock.isHolder() && snap.page && !snap.hasPendingWrites) {
        // Read-only: show the latest saved words.
        editor.view.dispatch(loadDoc(editor.state.tr, editor.schema, snap.page.doc)
          .setMeta(TR_LOAD, true).setMeta('addToHistory', false))
      } else if (lock.isHolder() && snap.page && !snap.fromCache && !snap.hasPendingWrites) {
        // A revision from another device while this one is idle: adopt it.
        const c = controllerRef.current
        if (c && c.adoptRemote(snap.page)) {
          editor.view.dispatch(loadDoc(editor.state.tr, editor.schema, snap.page.doc)
            .setMeta(TR_LOAD, true).setMeta('addToHistory', false)
            .setMeta(foldViewKey, { type: 'load', open: [...getFoldView(editor.state).open] } satisfies FoldViewMeta))
          void watchRef.current?.sweep('remote')
        }
      }
    })

    lock.onHandoverRequest(async () => {
      controllerRef.current?.flush()
      await new Promise((r) => setTimeout(r, 50))
      editor.setEditable(false)
      setHolder(false)
      setNotice({ kind: 'otherTab' })
    })

    void (async () => {
      // Let the first snapshot arrive (cache or server) before deciding.
      for (let i = 0; i < 40 && first === undefined && !disposed; i++) await new Promise((r) => setTimeout(r, 25))
      if (!lock.isHolder() && !disposed) setNotice({ kind: 'otherTab' })
      setReady(true)
      await lock.granted
      if (disposed) return
      setNotice((n) => (n?.kind === 'otherTab' ? null : n))
      const page = first ?? null
      const deps = { uid, pageId, editorId, listPending, removePending, writePending, liveEditorIds }
      const { start, others, adopted } = await prepareEditable(deps, page, EMPTY_DOC, Date.now())
      if (disposed) return
      checkedRef.current = new Set(start.content.checked)
      viewStateReady.current = true
      editor.view.dispatch(loadDoc(editor.state.tr, editor.schema, start.content.doc)
        .setMeta(TR_LOAD, true).setMeta('addToHistory', false)
        .setMeta(foldViewKey, { type: 'load', open: readViewState(uid, pageId)?.open ?? [] } satisfies FoldViewMeta))
      unitsRef.current = textMap(readingOrderUnits(editor.state.doc))
      const controller = new PageSaveController({
        uid, pageId, editorId, adapter,
        newRevId: newId,
        newPageId: newId,
        copyPreview: (p, at) => tr['folio.thisDevice'].replace('{preview}', p).replace('{date}', new Date(at).toLocaleString(getLanguageCode(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })),
        onStatus: (s) => setStatus(s),
        onConflictCopy: (copyId) => { setNotice({ kind: 'conflict' }); onNavigate(`/folio/p/${copyId}`, { replace: true }) },
        onRemoteDeleted: (c) => setNotice({ kind: 'remoteDeleted', content: c }),
      }, start)
      controllerRef.current = controller
      const watch = new FolioSafetyWatch({
        l1: detectCrisisKeywords,
        check: checkCrisisRisk,
        activate: (trigger) => {
          activateGrounding('auto')
          shore.activation(trigger, bringText(editor, trigger))
        },
        lateRisk: () => shore.lateRisk(),
        units: () => readingOrderUnits(editor.state.doc),
        checked: checkedRef.current,
        onCheckedChange: () => { pushContent(); schedulePrune() },
        onClassified: (pid, risk) => { riskRef.current.set(pid, Math.max(risk, riskRef.current.get(pid) ?? 0)) },
        isLockHolder: () => lock.isHolder(),
        language: () => getLanguageCode(),
        pageUpdatedAt: page?.updatedAt ?? Date.now(),
      })
      watchRef.current = watch
      setHolder(true)
      editor.setEditable(true)
      const view = readViewState(uid, pageId)
      if (view?.caret) {
        try { editor.commands.setTextSelection(Math.min(view.caret, editor.state.doc.content.size - 1)) } catch { /* stale caret */ }
      }
      editor.commands.focus()
      // Go to the page (from a trace): open the fold and put the caret on its line.
      const openFold = takeOpenFoldIntent(uid, pageId)
      if (openFold) {
        editor.view.dispatch(editor.state.tr.setMeta(foldViewKey, { type: 'open', ids: [openFold] } satisfies FoldViewMeta).setMeta('addToHistory', false))
        const el = editor.view.dom.querySelector(`[data-fold-id="${CSS.escape(openFold)}"]`)
        el?.scrollIntoView({ block: 'center' })
      }
      // Lift into today's page (§3.8): the trace's line, quoted exactly.
      const intent = takeLiftIntent(uid, pageId)
      if (intent && bytesRef.current < PAGE_FULL_BYTES) {
        const r = liftFromTrace(editor.state, intent)
        if (r) { editor.view.dispatch(r.tr); announce(stringsRef.current.lifted) }
      }
      if (adopted) {
        const server = await adapter.waitForConfirmed(pageId)
        if (disposed) return
        controller.confirm(server)
        await resolveOtherOrphans(deps, adapter, others, Date.now, (p, at) => tr['folio.thisDevice'].replace('{preview}', p).replace('{date}', new Date(at).toLocaleDateString()))
        void watch.sweep('hydrate')
      } else {
        void watch.sweep('open')
      }
    })()

    const onHide = () => {
      if (document.visibilityState === 'hidden') {
        controllerRef.current?.flush()
        watchRef.current?.hidden()
        shore.visibility(true, Date.now())
      } else {
        shore.visibility(false, Date.now())
      }
    }
    const onPageHide = () => { controllerRef.current?.flush(); watchRef.current?.hidden() }
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', onPageHide)

    return () => {
      disposed = true
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', onPageHide)
      watchRef.current?.hidden()
      controllerRef.current?.flush()
      controllerRef.current?.dispose()
      watchRef.current?.dispose()
      controllerRef.current = null
      watchRef.current = null
      for (const t of timers.values()) clearTimeout(t)
      timers.clear()
      unsubscribe()
      lock.release()
      releaseLiveness()
      try {
        if (viewStateReady.current) writeViewState(uid, pageId, { open: [...getFoldView(editor.state).open], scroll: window.scrollY, caret: editor.state.selection.head })
      } catch { /* editor gone */ }
    }
  }, [editor, uid, pageId, editorId, adapter]) // eslint-disable-line react-hooks/exhaustive-deps

  // ------------------------------------------------------------ edits, settles and view state

  useEffect(() => {
    if (!editor) return
    const onUpdate = ({ transaction }: { transaction: { getMeta: (k: string) => unknown; docChanged: boolean } }) => {
      if (!transaction.docChanged || transaction.getMeta(TR_LOAD)) return
      const units = readingOrderUnits(editor.state.doc)
      const now = textMap(units)
      const watch = watchRef.current
      for (const [pid, text] of now) {
        if (unitsRef.current.get(pid) === text) continue
        watch?.markDirty(pid)
        const old = settleTimers.current.get(pid)
        if (old) clearTimeout(old)
        settleTimers.current.set(pid, setTimeout(() => {
          settleTimers.current.delete(pid)
          void watchRef.current?.settle(pid)
        }, SETTLE_MS))
      }
      for (const pid of unitsRef.current.keys()) if (!now.has(pid)) watch?.forget(pid)
      unitsRef.current = now
      // A page the companion began (level 5's arrival) is saved once the writer writes in it.
      if (!transaction.getMeta(TR_COMPANION) || hasWriterWords(editor)) pushContent()
      // The writer's next edit ends a passing notice; the companion's own edits don't.
      if (!(transaction.getMeta(TR_COMPANION) as boolean | undefined)) {
        setNotice((n) => ((n?.kind === 'kept' && !n.choosing) || n?.kind === 'companion' ? null : n))
      }
    }
    const onSelection = () => {
      const $c = editor.state.selection.$from
      const pid = $c.parent.type.name === 'paragraph' ? String($c.parent.attrs.pid ?? '') : null
      const prev = caretUnitRef.current
      if (prev && prev !== pid && settleTimers.current.has(prev)) {
        clearTimeout(settleTimers.current.get(prev))
        settleTimers.current.delete(prev)
        void watchRef.current?.settle(prev)
      }
      caretUnitRef.current = pid
    }
    const onFoldMeta = () => {
      if (!viewStateReady.current) return
      writeViewState(uid, pageId, { open: [...getFoldView(editor.state).open], scroll: window.scrollY, caret: editor.state.selection.head })
    }
    editor.on('update', onUpdate as never)
    editor.on('selectionUpdate', onSelection)
    editor.on('transaction', onFoldMeta)
    return () => {
      editor.off('update', onUpdate as never)
      editor.off('selectionUpdate', onSelection)
      editor.off('transaction', onFoldMeta)
    }
  }, [editor, pushContent, uid, pageId])

  // ------------------------------------------------------------ actions

  const doLift = useCallback((corner?: Corner) => {
    if (!editor || bytesRef.current >= PAGE_FULL_BYTES) { if (bytesRef.current >= PAGE_FULL_BYTES) setNotice({ kind: 'full' }); return }
    const r = lift(editor.state, { locale: getLanguageCode(), range: corner })
    if (!r.ok) {
      if (r.reason === 'alreadyLifted') announce(strings.alreadyLifted)
      if (r.reason === 'tooLong') announce(tr['folio.tooLong'])
      return
    }
    editor.view.dispatch(r.tr)
    editor.view.focus()
    announce(strings.lifted)
  }, [editor, announce, strings, tr])
  useEffect(() => { doLiftRef.current = doLift }, [doLift])

  // A mark's dot (involvement level 2+): select its sentence and lift it, as the writer would.
  useEffect(() => {
    liftMarkedRef.current = (pid, sentence) => {
      if (!editor) return
      const range = sentenceRange(editor.state.doc, pid, sentence)
      if (!range) return
      editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, range.from, range.to)))
      doLift()
    }
  }, [editor, doLift])

  // Keep (draft 4 §3.7): a dated snapshot; the page doesn't change. The
  // composition settles to the bottom edge (a 120 ms fade with reduced motion);
  // nothing waits on it.
  const [settling, setSettling] = useState<{ key: string; text: string; left: number; top: number; width: number; dx: number; dy: number; toKept: boolean } | null>(null)
  /** Keep a fold (the writer's Keep, or the companion's at level 4+). */
  const keepFold = useCallback(async (foldId: string, by: 'companion' | null): Promise<{ trace: FolioTrace } | null> => {
    const k = keptRef.current
    if (!editor || !k) return null
    const snapshot = snapshotFold(editor.state.doc, foldId)
    if (!snapshot || snapshot.empty) return null
    const id = newId()
    const checked = await keptCheckedKeys(id, snapshot, readingOrderUnits(editor.state.doc), checkedRef.current)
    const trace = k.keep({ id, pageId, foldId, revId: controllerRef.current?.chainState.baseRevId ?? null, snapshot, checked, ...(by ? { keptBy: by } : {}) })
    const el = editor.view.dom.querySelector(`[data-fold-id="${CSS.escape(foldId)}"]`)
    const r = el?.getBoundingClientRect()
    if (r) {
      // The copy settles into Kept in the top bar, so the eye learns where
      // kept things go (2026-10-22); without one, to the bottom edge.
      const target = document.querySelector('[data-folio-nav="kept"]')?.getBoundingClientRect()
      const width = Math.min(r.width, 360)
      const dx = target ? target.left + target.width / 2 - (r.left + width / 2) : 0
      const dy = target ? target.top + target.height / 2 - (r.top + 18) : Math.max(0, window.innerHeight - r.top - 56)
      setSettling({ key: id, text: snapshot.surface, left: r.left, top: r.top, width, dx, dy, toKept: !!target })
    }
    return { trace }
  }, [editor, pageId])
  const companionKeptRef = useRef<(k: KeepResult) => void>(() => {})
  const doKeep = useCallback(async (foldId: string) => {
    if (!editor) return
    const before = foldComposition(editor.state.doc, foldId)
    const reKeep = (keptRef.current?.traces ?? []).some((t) => t.source.foldId === foldId)
    const kept = await keepFold(foldId, null)
    if (!kept) return
    // The first keep says where kept things go; after that, "Kept."
    const first = switchesRef.current.guides && !learnedRef.current.keep
    setNotice({ kind: 'kept', traceId: kept.trace.id, choosing: false, first })
    announce(first ? tr['folio.kept.first'] : tr['folio.kept'])
    if (first) learn({ keep: Date.now() })
    if (before) companionKeptRef.current({ traceId: kept.trace.id, composition: before.text, beneathChars: before.beneathChars, reKeep })
  }, [editor, keepFold, announce, tr, learn])
  useEffect(() => { keepRef.current = (foldId) => { void doKeep(foldId) } }, [doKeep])

  // "Kept." lasts 10 seconds, or until the next action (an edit ends it too).
  const keptNotice = notice?.kind === 'kept' && !notice.choosing ? notice.traceId : null
  useEffect(() => {
    if (!keptNotice) return
    const t = setTimeout(() => setNotice((n) => (n?.kind === 'kept' && n.traceId === keptNotice && !n.choosing ? null : n)), 10_000)
    return () => clearTimeout(t)
  }, [keptNotice])
  const comingBackNotice = notice?.kind === 'comingBack' ? notice.at : null
  useEffect(() => {
    if (comingBackNotice === null) return
    const t = setTimeout(() => setNotice((n) => (n?.kind === 'comingBack' ? null : n)), 6_000)
    return () => clearTimeout(t)
  }, [comingBackNotice])

  const chooseComeBack = useCallback((traceId: string, choice: ComeBackChoice) => {
    const k = keptRef.current
    if (!k || !k.setComeBack(traceId, choice)) return
    const at = comeBackFields(choice, Date.now(), k.tz)?.comeBackAt
    setNotice(typeof at === 'number' ? { kind: 'comingBack', at } : null)
  }, [])

  // Step inside (H1).
  const { inside, open: openInside, leave: leaveInside, afterglow, clearAfterglow } = useStepInside({
    editor, shore, enabled: canStepInside, reduceMotion: reduceMotion || presentation !== 'normal', strings: () => stringsRef.current,
  })
  useEffect(() => { stepInsideRef.current = openInside }, [openInside])

  // Ask (H2; draft 4 §5.4's contract): only the selection, its passage and the
  // language are sent. The note is buffered and shown once L2 clears it.
  const [asking, setAsking] = useState(false)
  const askAbort = useRef<AbortController | null>(null)
  const setPending = useCallback((pending: PendingNote | null) => {
    if (!editor || editor.isDestroyed) return
    editor.view.dispatch(editor.state.tr.setMeta(notesKey, { pending }).setMeta('addToHistory', false))
  }, [editor])
  const doAsk = useCallback(async () => {
    const a = askRef.current
    if (!editor || !a || asking) return
    const sel = editor.state.selection
    const $f = sel.$from
    if ($f.parent !== sel.$to.parent || $f.parent.type.name !== 'paragraph') return
    const selection = editor.state.doc.textBetween(sel.from, sel.to, '\n').slice(0, ASK_MAX_CHARS)
    if (!selection.trim()) return
    // Ask is about the writer's words: a selection of only the companion's own words isn't sent.
    const slice = editor.state.doc.slice(sel.from, sel.to)
    let writerWords = ''
    slice.content.descendants((n) => { if (n.isTextblock) { writerWords += writerText(n); return false } return true })
    if (slice.content.firstChild?.isText) writerWords = writerText(editor.state.schema.nodes.paragraph.create(null, slice.content))
    if (!writerWords.trim()) return
    const pid = String($f.parent.attrs.pid ?? '')
    let onLine = false
    editor.state.doc.nodesBetween(sel.from, sel.to, (n) => { if (n.marks.some((m) => m.type.name === FOLD)) onLine = true })
    const passage: AskPassage = $f.depth > 1 ? ($f.node(2).type.name === 'between' ? 'between' : 'beneath') : onLine ? 'line' : 'page'
    const lang = getLanguageCode()
    // The selection's job is done: collapse it to its end, so the bar or
    // popover goes and never covers the note as it arrives.
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, sel.to)).setMeta('addToHistory', false))
    setAsking(true)
    setPending({ pid, status: 'asking' })
    announce(tr['folio.ask.asking'])
    const controller = new AbortController()
    askAbort.current = controller
    const outcome = await askForNote({
      selection,
      language: lang,
      l1: detectCrisisKeywords,
      check: checkCrisisRisk,
      generate: (grounded, signal) => new Promise<string>((resolve, reject) => {
        const messages = buildAskMessages({ selection, passage, languageName: lang === 'en' ? null : getLLMLanguageName(), grounded })
        void streamChatCompletion(messages, { onToken: () => {}, onComplete: resolve, onError: reject }, 1200, 'low', signal).catch(reject)
      }),
      isGrounding: isGroundingActive,
      isRecent: a.isRecent,
      activate: () => { activateGrounding('auto'); shore.activation(`ask:${pid}`, selection) },
      signal: controller.signal,
    })
    askAbort.current = null
    setAsking(false)
    if (outcome.kind === 'note') {
      setPending({ pid, status: 'note', text: outcome.text, grounded: outcome.grounded })
      announce(`${tr['folio.ask.label']}: ${outcome.text}`)
    } else if (outcome.kind === 'failed') {
      setPending({ pid, status: 'failed' })
      announce(tr['folio.ask.failed'])
    } else {
      setPending(null)
    }
  }, [editor, asking, setPending, announce, tr, shore])
  useEffect(() => () => askAbort.current?.abort(), [])

  // ------------------------------------------------------------ companion involvement

  const presentationNow = useRef(presentation)
  useEffect(() => { presentationNow.current = presentation }, [presentation])
  const statusNow = useRef(status)
  useEffect(() => { statusNow.current = status }, [status])
  const noticeNow = useRef(notice)
  useEffect(() => { noticeNow.current = notice }, [notice])
  const companion = useCompanion({
    editor, uid, pageId,
    level: involvement,
    holder,
    // Crisis owns the page (involvement §4.3): nothing unasked under Shore,
    // Quiet, Recent, the card, grounding, or a save chain in trouble.
    gate: () => presentationNow.current === 'normal'
      && !(isRecent?.() ?? false)
      && !shore.getSnapshot().card
      && !isGroundingActive()
      && statusNow.current !== 'couldNotSave'
      && !['conflict', 'remoteDeleted', 'otherTab', 'protected'].includes(noticeNow.current?.kind ?? ''),
    checkedRef,
    riskOf: (pid) => riskRef.current.get(pid) ?? null,
    reduceMotion: () => reduceMotion || (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true),
    switches: () => ({ between: switchesRef.current.between, distance: switchesRef.current.distance }),
    call: (messages, signal) => new Promise<string>((resolve, reject) => {
      void streamChatCompletion(messages, { onToken: () => {}, onComplete: resolve, onError: reject }, 1200, 'low', signal).catch(reject)
    }),
    l1: detectCrisisKeywords,
    languageName: () => (getLanguageCode() === 'en' ? null : getLLMLanguageName()),
    traces: () => keptRef.current?.traces ?? [],
    keepFold: (foldId, by) => keepFold(foldId, by),
    name: (traceId, title) => keptRef.current?.name(traceId, title, 'companion'),
    setComeBack: (traceId, choice) => {
      const k = keptRef.current
      if (!k || !k.setComeBack(traceId, choice)) return null
      return comeBackFields(choice, Date.now(), k.tz)?.comeBackAt ?? null
    },
    undoKeep: (traceId) => keptRef.current?.undo(traceId),
    note: async (pid, comp) => {
      if (!editor || asking) return false
      const lang = getLanguageCode()
      const outcome = await askForNote({
        selection: comp.slice(0, ASK_MAX_CHARS),
        language: lang,
        l1: detectCrisisKeywords,
        check: checkCrisisRisk,
        generate: (grounded, signal) => new Promise<string>((resolve, reject) => {
          // An unasked note never comes grounded (askForNote's grounded reply is dropped below).
          void grounded
          const messages = noteMessages({ composition: comp.slice(0, ASK_MAX_CHARS), languageName: lang === 'en' ? null : getLLMLanguageName() })
          void streamChatCompletion(messages, { onToken: () => {}, onComplete: resolve, onError: reject }, 1200, 'low', signal).catch(reject)
        }),
        isGrounding: isGroundingActive,
        isRecent: () => isRecent?.() ?? false,
        activate: () => { activateGrounding('auto'); shore.activation(`note:${pid}`, comp) },
      })
      // A grounded note never comes unasked: the companion steps back instead.
      if (outcome.kind !== 'note' || outcome.grounded) return false
      setPending({ pid, status: 'note', text: outcome.text, grounded: false })
      announce(`${tr['folio.ask.label']}: ${outcome.text}`)
      return true
    },
    // Opened by the companion (level 5): never with sound.
    stepInside: (foldId) => { setInsideByCompanion(true); stepInsideRef.current(foldId) },
    prefill: (traceId, title, choice) => setNotice((n) => (n?.kind === 'kept' && n.traceId === traceId ? { ...n, suggest: { title, choice } } : n)),
    notify: (n) => setNotice(n),
    announce,
    t: (key: CompanionKey, vars?: Record<string, string>) => Object.entries(vars ?? {}).reduce<string>((s, [k, v]) => s.replace(`{${k}}`, v), tr[key]),
    shortDate: (ms) => shortDate(ms, getLanguageCode(), keptRef.current?.tz ?? 'UTC'),
  })
  useEffect(() => {
    companionKeptRef.current = (k) => companion.writerKept(k)
    dismissMarkRef.current = () => companion.markDismissed()
  }, [companion])
  // A companion notice offers Undo for 30 seconds, or until the writer's next edit.
  const [insideByCompanion, setInsideByCompanion] = useState(false)
  useEffect(() => { if (!inside) setInsideByCompanion(false) }, [inside])
  const companionNoticeAt = notice?.kind === 'companion' ? notice : null
  useEffect(() => {
    if (!companionNoticeAt) return
    const t = setTimeout(() => setNotice((n) => (n === companionNoticeAt ? null : n)), NOTICE_MS)
    return () => clearTimeout(t)
  }, [companionNoticeAt])

  // ------------------------------------------------------------ the first moment

  // The corner and the first-time lines show only with their switch, in this
  // tab's editable page, on Normal paper, with room left on the page.
  useEffect(() => {
    guidesOn.current = switches.guides && holder && presentation === 'normal' && bytes < PAGE_FULL_BYTES
  }, [switches.guides, holder, presentation, bytes])

  // What the writer meets for the first time: their own lifts (the corner's
  // words step back after two), the first fold away (a line under it, once)
  // and the companion's first mark (a notice saying what the dot is).
  useEffect(() => {
    if (!editor) return
    let open = new Set(getFoldView(editor.state).open)
    let folds = new Set(foldIdsOf(editor))
    let mark = presence(editor.state).mark
    let hintTimer: ReturnType<typeof setTimeout> | null = null
    const onTransaction = ({ transaction }: { transaction: Transaction }) => {
      const nowOpen = getFoldView(editor.state).open
      const nowFolds = new Set(foldIdsOf(editor))
      const nowMark = presence(editor.state).mark
      const l = learnedRef.current
      const guides = switchesRef.current.guides && presentationNow.current === 'normal'
      if (!transaction.getMeta(TR_LOAD) && !transaction.getMeta(TR_COMPANION)) {
        if ((l.lifts ?? 0) < 2 && [...nowFolds].some((id) => !folds.has(id))) learn({ lifts: (l.lifts ?? 0) + 1 })
        const folded = [...open].find((id) => !nowOpen.has(id) && nowFolds.has(id))
        if (folded && !l.fold && guides) {
          learn({ fold: Date.now() })
          // After this transaction has settled: never dispatch inside another.
          setTimeout(() => {
            if (editor.isDestroyed) return
            foldHint(editor.view, folded)
            announce(trRef.current['folio.learn.fold'])
            hintTimer = setTimeout(() => { if (!editor.isDestroyed) foldHint(editor.view, null) }, 6000)
          }, 0)
        }
      }
      if (!mark && nowMark && !l.mark && guides) {
        learn({ mark: Date.now() })
        setNotice((n) => n ?? { kind: 'learnMark' })
      }
      open = new Set(nowOpen)
      folds = nowFolds
      mark = nowMark
    }
    editor.on('transaction', onTransaction)
    return () => {
      editor.off('transaction', onTransaction)
      if (hintTimer) clearTimeout(hintTimer)
    }
  }, [editor, learn, announce])
  const learnMarkNotice = notice?.kind === 'learnMark' ? notice : null
  useEffect(() => {
    if (!learnMarkNotice) return
    const t = setTimeout(() => setNotice((n) => (n === learnMarkNotice ? null : n)), 20_000)
    return () => clearTimeout(t)
  }, [learnMarkNotice])

  // The notes' actions read the latest state when pressed.
  const presentationRef2 = useRef(presentation)
  useEffect(() => { presentationRef2.current = presentation }, [presentation])
  useEffect(() => {
    noteHandlers.current = () => ({
      keep: (p) => {
        if (!editor) return
        const tr2 = withNote(editor.state.tr, { id: newId(), pid: p.pid, text: p.text, createdAt: Date.now() })
        if (!tr2) { announce(tr['folio.ask.full']); return }
        editor.view.dispatch(tr2.setMeta(notesKey, { pending: null }))
        announce(tr['folio.ask.kept'])
      },
      dismiss: () => setPending(null),
      copy: (text) => { void navigator.clipboard?.writeText(text).then(() => announce(tr['folio.copied'])).catch(() => {}) },
      deleteNote: (id) => { if (editor) editor.view.dispatch(withoutNote(editor.state.tr, id)) },
      talkNow: presentationRef2.current === 'shore' && askRef.current ? () => askRef.current?.onTalkNow() : null,
    })
  }, [editor, announce, tr, setPending])

  const removeKept = useCallback((ids: string[]) => {
    if (!editor) return
    const s = editor.state
    let t = s.tr
    s.doc.forEach((node, offset) => {
      if (node.type.name === UNDERSIDE && ids.includes(String(node.attrs.foldId))) {
        const from = t.mapping.map(offset)
        t = t.delete(from, from + node.nodeSize)
      }
    })
    editor.view.dispatch(t.setMeta('folio:visibleEdit', true))
    setNotice(null)
  }, [editor])

  const copyPage = useCallback(async () => {
    if (!editor) return
    try {
      await navigator.clipboard.writeText(editor.state.doc.textBetween(0, editor.state.doc.content.size, '\n\n'))
      setNotice({ kind: 'copied' })
    } catch { /* clipboard refused */ }
  }, [editor])

  const keepRemoteDeleted = useCallback((content: PageContent) => {
    const id = newId()
    writePending(uid, { pageId: id, editorId, baseRevId: null, sentRevIds: [], created: false, ...content, createdAt: Date.now(), updatedAt: Date.now() })
    removePending(uid, pageId, editorId)
    onNavigate(`/folio/p/${id}`, { replace: true })
  }, [uid, pageId, editorId, onNavigate])

  // Degradations only, and recoveries (§3.10): never the ordinary flicker.
  const lastAnnounced = useRef<SaveStatus | null>(null)
  useEffect(() => {
    if (!status) return
    const bad = status === 'notSaved' || status === 'couldNotSave'
    if (bad && lastAnnounced.current !== status) announce(status === 'notSaved' ? tr['folio.notSaved'] : tr['folio.saveFailed'])
    if (status === 'saved' && (lastAnnounced.current === 'notSaved' || lastAnnounced.current === 'couldNotSave')) announce(tr['folio.saved'])
    if (bad || status === 'saved') lastAnnounced.current = status
  }, [status, announce, tr])

  // "Saved on this device" is the ordinary moment between a keystroke and
  // the account confirming it. The corner keeps what it last said until that
  // moment lasts 2 s, so it doesn't flicker between two words while writing
  // (the fresh-eyes test); every other status shows at once.
  const [shown, setShown] = useState<SaveStatus | null>(null)
  useEffect(() => {
    if (status !== 'savedLocal') { setShown(status); return }
    const t = setTimeout(() => setShown('savedLocal'), 2000)
    return () => clearTimeout(t)
  }, [status])
  const statusText = shown === 'saved' ? tr['folio.saved']
    : shown === 'savedLocal' ? tr['folio.savedLocal']
    : shown === 'notSaved' ? tr['folio.notSaved']
    : shown === 'couldNotSave' ? tr['folio.saveFailed']
    : null

  return (
    <div className="folio-page" data-reduce-motion={reduceMotion ? 'true' : undefined}>
      {!ready && <div className="folio-line">{tr['folio.opening']}</div>}
      <EditorContent editor={editor} />
      {editor && holder && (
        <LiftControl
          editor={editor}
          label={tr['folio.lift']}
          onLift={() => doLift()}
          disabled={bytes >= PAGE_FULL_BYTES}
          ask={ask ? { label: tr['folio.ask'], onAsk: () => void doAsk(), busy: asking } : undefined}
        />
      )}
      {bytes >= PAGE_WARN_BYTES && bytes < PAGE_FULL_BYTES && <div className="folio-line">{tr['folio.pageLong']}</div>}
      {bytes >= PAGE_FULL_BYTES && <div className="folio-line">{tr['folio.pageFull']}</div>}
      {statusText && (
        <div className="folio-status" data-tone={status === 'notSaved' || status === 'couldNotSave' ? 'warn' : undefined}>
          {statusText}
          {status === 'notSaved' && <> · <button type="button" className="folio-button folio-button--inline" onClick={() => void copyPage()}>{tr['folio.copyPage']}</button></>}
        </div>
      )}
      {inside && (
        <StepInside
          uid={uid}
          composition={inside.composition}
          line={inside.line}
          undersideLabel={inside.label}
          soundAvailable={!!stepInside?.sound && !insideByCompanion}
          reduceMotion={reduceMotion || presentation !== 'normal'}
          onLeave={leaveInside}
        />
      )}
      {afterglow > 0 && !inside && <div key={afterglow} className="folio-inside-afterglow" aria-hidden="true" onAnimationEnd={clearAfterglow} />}
      {settling && (
        <div
          key={settling.key}
          className="folio-keep-slip"
          aria-hidden="true"
          data-to-kept={settling.toKept ? 'true' : undefined}
          style={{ left: settling.left, top: settling.top, width: settling.width, ['--folio-settle-x' as string]: `${settling.dx}px`, ['--folio-settle-y' as string]: `${settling.dy}px` }}
          onAnimationEnd={() => {
            setSettling(null)
            const nav = document.querySelector('[data-folio-nav="kept"]')
            if (nav) {
              nav.setAttribute('data-received', 'true')
              setTimeout(() => nav.removeAttribute('data-received'), 1400)
            }
          }}
        >
          {settling.text}
        </div>
      )}
      {notice && (
        <div className="folio-notice" role="status" data-kind={notice.kind}>
          {notice.kind === 'learnMark' && (
            <>
              <span>{tr['folio.learn.mark']}</span>
              <button type="button" className="folio-button" onClick={() => setNotice(null)}>{tr['folio.firstVisit.dismiss']}</button>
            </>
          )}
          {notice.kind === 'kept' && !notice.choosing && (
            <>
              <span>{notice.first ? tr['folio.kept.first'] : tr['folio.kept']}</span>
              {/* Level 3: the companion offers a name and a day; the writer decides. */}
              {notice.suggest?.title && (
                <button type="button" className="folio-button" onClick={() => {
                  kept?.name(notice.traceId, notice.suggest?.title ?? '', 'companion')
                  setNotice({ ...notice, suggest: notice.suggest ? { ...notice.suggest, title: null } : undefined })
                }}>{tr['folio.companion.nameIt'].replace('{title}', notice.suggest.title)}</button>
              )}
              {notice.suggest && typeof notice.suggest.choice === 'string' && (
                <button type="button" className="folio-button" onClick={() => chooseComeBack(notice.traceId, notice.suggest?.choice ?? 'week')}>
                  {tr['folio.comeBack']}: {tr[`folio.comeBack.${notice.suggest.choice}`]}
                </button>
              )}
              <button type="button" className="folio-button" onClick={() => { kept?.undo(notice.traceId); setNotice(null) }}>{tr['folio.undo']}</button>
              {/* The first keep says only where it went; Come back to this from the second (2026-10-22). */}
              {!notice.first && <button type="button" className="folio-button" onClick={() => setNotice({ ...notice, choosing: true })}>{tr['folio.comeBack']}…</button>}
              <button type="button" className="folio-button" aria-label={tr['folio.cancel']} onClick={() => setNotice(null)}>×</button>
            </>
          )}
          {notice.kind === 'companion' && (
            <>
              <span>{notice.text}</span>
              {notice.act === 'kept' && notice.comeBackAt && kept && <span>· {tr['folio.comeBack.on'].replace('{date}', shortDate(notice.comeBackAt, getLanguageCode(), kept.tz))}</span>}
              {(notice.act === 'kept' || (notice.act === 'lifted' && isEmptyFold(editor, notice.foldId))) && (
                <button type="button" className="folio-button" onClick={() => { companion.undo(notice); setNotice(null) }}>{tr['folio.undo']}</button>
              )}
              {notice.act === 'closed' && (
                <button type="button" className="folio-button" onClick={() => { companion.undo(notice); setNotice(null) }}>{tr['folio.open']}</button>
              )}
              {(notice.act === 'arrived' || notice.act === 'began') && (
                <button type="button" className="folio-button" onClick={() => { companion.startBlank(); setNotice(null) }}>{tr['folio.companion.startBlank']}</button>
              )}
              <button type="button" className="folio-button" aria-label={tr['folio.cancel']} onClick={() => setNotice(null)}>×</button>
            </>
          )}
          {notice.kind === 'kept' && notice.choosing && kept && (
            <>
              <ComeBackChoices tz={kept.tz} autoFocus onChoose={(choice) => chooseComeBack(notice.traceId, choice)} />
              <button type="button" className="folio-button" aria-label={tr['folio.cancel']} onClick={() => setNotice(null)}>×</button>
            </>
          )}
          {notice.kind === 'comingBack' && kept && <span>{tr['folio.comeBack.on'].replace('{date}', shortDate(notice.at, getLanguageCode(), kept.tz))}</span>}
          {notice.kind === 'protected' && (
            <>
              <span>{tr['folio.protected']}</span>
              <button type="button" className="folio-button" onClick={() => removeKept(notice.ids)}>{tr['folio.removeToo']}</button>
              <button type="button" className="folio-button" onClick={() => { editor?.commands.undo(); setNotice(null) }}>{tr['folio.undo']}</button>
              <button type="button" className="folio-button" aria-label={tr['folio.cancel']} onClick={() => setNotice(null)}>×</button>
            </>
          )}
          {notice.kind === 'conflict' && (
            <>
              <span>{tr['folio.conflict']}</span>
              <button type="button" className="folio-button" aria-label={tr['folio.cancel']} onClick={() => setNotice(null)}>×</button>
            </>
          )}
          {notice.kind === 'remoteDeleted' && (
            <>
              <span>{tr['folio.remoteDeleted']}</span>
              <button type="button" className="folio-button" onClick={() => keepRemoteDeleted(notice.content)}>{tr['folio.remoteDeleted.keep']}</button>
              <button type="button" className="folio-button" onClick={() => { removePending(uid, pageId, editorId); onNavigate('/folio/pages', { replace: true }) }}>{tr['folio.remoteDeleted.discard']}</button>
            </>
          )}
          {notice.kind === 'otherTab' && (
            <>
              <span>{notice.noAnswer ? tr['folio.otherTabNoAnswer'] : tr['folio.otherTab']}</span>
              {!notice.noAnswer && (
                <button type="button" className="folio-button" onClick={() => {
                  void lockRef.current?.requestHandover().then((ok) => { if (!ok) setNotice({ kind: 'otherTab', noAnswer: true }) })
                }}>{tr['folio.editHere']}</button>
              )}
            </>
          )}
          {notice.kind === 'copied' && <span>{tr['folio.copied']}</span>}
          {notice.kind === 'full' && <span>{tr['folio.pageFull']}</span>}
        </div>
      )}
    </div>
  )
}

/** A companion lift can be undone only while the writer has written nothing in it (their words would go too). */
function isEmptyFold(editor: Editor | null, foldId: string): boolean {
  if (!editor) return false
  const u = findUnderside(editor.state.doc, foldId)
  return !!u && noWriterWords(u.node)
}

/** "This" for Talk now, bringing this (§3.9): the trigger's unit or pair, with its lifted line. */
function bringText(editor: Editor, trigger: string): string | null {
  const units = readingOrderUnits(editor.state.doc)
  const pids = trigger.split('|')
  const picked = units.filter((u) => pids.includes(u.pid))
  if (picked.length === 0) return null
  const line = picked.find((u) => u.line)?.line
  const body = picked.map((u) => u.text).join('\n\n')
  return line && !body.startsWith(line) ? `${line}\n\n${body}` : body
}
