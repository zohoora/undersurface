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
import { lift } from './commands'
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
import type { FolioPage, FolioTrace } from '../../types/folio'
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
  }
}

type Notice =
  | { kind: 'kept'; traceId: string; choosing: boolean }
  | { kind: 'comingBack'; at: number }
  | { kind: 'protected'; ids: string[] }
  | { kind: 'conflict' }
  | { kind: 'remoteDeleted'; content: PageContent }
  | { kind: 'otherTab'; noAnswer?: boolean }
  | { kind: 'copied' }
  | { kind: 'full' }

function previewOf(editor: Editor): string {
  const first = editor.state.doc.firstChild
  return (first?.textContent ?? '').slice(0, 120)
}

function foldCountOf(editor: Editor): number {
  let n = 0
  editor.state.doc.forEach((node) => { if (node.type.name === UNDERSIDE) n++ })
  return n
}

function textMap(units: SafetyUnit[]): Map<string, string> {
  return new Map(units.map((u) => [u.pid, `${u.line ?? ''}\u0000${u.text}`]))
}

export function FolioPageView({ uid, pageId, switches, shore, reduceMotion, ornaments, onNavigate, onAnnounce, kept, presentation = 'normal', stepInside, ask }: Props) {
  const tr = useTranslation()
  const strings = useMemo(() => folioStringsFrom(tr), [tr])
  const stringsRef = useRef(strings)
  const switchesRef = useRef(switches)
  useEffect(() => { stringsRef.current = strings }, [strings])
  useEffect(() => { switchesRef.current = switches }, [switches])

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
        writeViewState(uid, pageId, { open: [...getFoldView(editor.state).open], scroll: window.scrollY, caret: editor.state.selection.head })
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
      pushContent()
      setNotice((n) => (n?.kind === 'kept' && !n.choosing ? null : n))
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

  const doLift = useCallback(() => {
    if (!editor || bytesRef.current >= PAGE_FULL_BYTES) { if (bytesRef.current >= PAGE_FULL_BYTES) setNotice({ kind: 'full' }); return }
    const r = lift(editor.state, { locale: getLanguageCode() })
    if (!r.ok) {
      if (r.reason === 'alreadyLifted') announce(strings.alreadyLifted)
      if (r.reason === 'tooLong') announce(tr['folio.tooLong'])
      return
    }
    editor.view.dispatch(r.tr)
    editor.view.focus()
    announce(strings.lifted)
  }, [editor, announce, strings, tr])

  // Keep (draft 4 §3.7): a dated snapshot; the page doesn't change. The
  // composition settles to the bottom edge (a 120 ms fade with reduced motion);
  // nothing waits on it.
  const [settling, setSettling] = useState<{ key: string; text: string; left: number; top: number; width: number; drop: number } | null>(null)
  const doKeep = useCallback(async (foldId: string) => {
    const k = keptRef.current
    if (!editor || !k) return
    const snapshot = snapshotFold(editor.state.doc, foldId)
    if (!snapshot || snapshot.empty) return
    const id = newId()
    const checked = await keptCheckedKeys(id, snapshot, readingOrderUnits(editor.state.doc), checkedRef.current)
    const trace = k.keep({ id, pageId, foldId, revId: controllerRef.current?.chainState.baseRevId ?? null, snapshot, checked })
    setNotice({ kind: 'kept', traceId: trace.id, choosing: false })
    announce(tr['folio.kept'])
    const el = editor.view.dom.querySelector(`[data-fold-id="${CSS.escape(foldId)}"]`)
    const r = el?.getBoundingClientRect()
    if (r) setSettling({ key: id, text: snapshot.surface, left: r.left, top: r.top, width: r.width, drop: Math.max(0, window.innerHeight - r.top - 56) })
  }, [editor, pageId, announce, tr])
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
    const pid = String($f.parent.attrs.pid ?? '')
    let onLine = false
    editor.state.doc.nodesBetween(sel.from, sel.to, (n) => { if (n.marks.some((m) => m.type.name === FOLD)) onLine = true })
    const passage: AskPassage = $f.depth > 1 ? ($f.node(2).type.name === 'between' ? 'between' : 'beneath') : onLine ? 'line' : 'page'
    const lang = getLanguageCode()
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

  const statusText = status === 'saved' ? tr['folio.saved']
    : status === 'savedLocal' ? tr['folio.savedLocal']
    : status === 'notSaved' ? tr['folio.notSaved']
    : status === 'couldNotSave' ? tr['folio.saveFailed']
    : null

  return (
    <div className="folio-page" data-reduce-motion={reduceMotion ? 'true' : undefined}>
      {!ready && <div className="folio-line">{tr['folio.opening']}</div>}
      <EditorContent editor={editor} />
      {editor && holder && (
        <LiftControl
          editor={editor}
          label={tr['folio.lift']}
          onLift={doLift}
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
          soundAvailable={!!stepInside?.sound}
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
          style={{ left: settling.left, top: settling.top, width: settling.width, ['--folio-settle-y' as string]: `${settling.drop}px` }}
          onAnimationEnd={() => setSettling(null)}
        >
          {settling.text}
        </div>
      )}
      {notice && (
        <div className="folio-notice" role="status">
          {notice.kind === 'kept' && !notice.choosing && (
            <>
              <span>{tr['folio.kept']}</span>
              <button type="button" className="folio-button" onClick={() => { kept?.undo(notice.traceId); setNotice(null) }}>{tr['folio.undo']}</button>
              <button type="button" className="folio-button" onClick={() => setNotice({ ...notice, choosing: true })}>{tr['folio.comeBack']}…</button>
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
