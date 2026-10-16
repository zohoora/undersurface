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
import type { FolioPage } from '../../types/folio'

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
}

type Notice =
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

export function FolioPageView({ uid, pageId, switches, shore, reduceMotion, ornaments, onNavigate, onAnnounce }: Props) {
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

  // As with the editor below: these callbacks read refs only when a control
  // is pressed, never during render.
  // eslint-disable-next-line react-hooks/refs
  const controls = useMemo(() => undersideControls({
    labels: () => ({
      close: tr['folio.close'], unlift: tr['folio.unlift'], closer: tr['folio.closer'], farther: tr['folio.farther'],
      looseTitle: tr['folio.loose.title'], looseKeep: tr['folio.loose.keep'], looseToPage: tr['folio.loose.toPage'], looseRemove: tr['folio.loose.remove'],
    }),
    switches: () => ({ between: switchesRef.current.between, distance: switchesRef.current.distance }),
    onAnnounce: announce,
    announceGap: (dir: -1 | 1, gap: Gap) => (dir > 0 ? stringsRef.current.farther(gap) : stringsRef.current.closer(gap)),
    closerBlocked: () => stringsRef.current.closerBlocked,
    unlifted: () => stringsRef.current.unlifted,
    looseAcknowledged,
  }), [tr, announce, looseAcknowledged])

  // The callbacks below read refs only when the editor calls them from its
  // own event handlers, never during render.
  const editor = useEditor({
    // eslint-disable-next-line react-hooks/refs
    extensions: folioExtensions({
      strings: () => stringsRef.current,
      onAnnounce: announce,
      onProtected: (ids) => setNotice({ kind: 'protected', ids }),
      label: tr['folio.pageLabel'],
      switches: () => ({ between: switchesRef.current.between, distance: switchesRef.current.distance }),
      locale: () => getLanguageCode(),
      controls,
    }),
    editable: false,
    content: JSON.parse(EMPTY_DOC) as JSONContent,
    editorProps: {
      attributes: { class: 'folio-editor', spellcheck: 'true' },
      handlePaste: () => bytesRef.current >= PAGE_FULL_BYTES,
    },
    immediatelyRender: true,
  }, [controls])

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
        editor.view.dispatch(editor.state.tr
          .replaceWith(0, editor.state.doc.content.size, editor.schema.nodeFromJSON(JSON.parse(snap.page.doc)).content)
          .setMeta(TR_LOAD, true).setMeta('addToHistory', false))
      } else if (lock.isHolder() && snap.page && !snap.fromCache && !snap.hasPendingWrites) {
        // A revision from another device while this one is idle: adopt it.
        const c = controllerRef.current
        if (c && c.adoptRemote(snap.page)) {
          editor.view.dispatch(editor.state.tr
            .replaceWith(0, editor.state.doc.content.size, editor.schema.nodeFromJSON(JSON.parse(snap.page.doc)).content)
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
      editor.view.dispatch(editor.state.tr
        .replaceWith(0, editor.state.doc.content.size, editor.schema.nodeFromJSON(JSON.parse(start.content.doc)).content)
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
        <LiftControl editor={editor} label={tr['folio.lift']} onLift={doLift} disabled={bytes >= PAGE_FULL_BYTES} />
      )}
      {bytes >= PAGE_WARN_BYTES && bytes < PAGE_FULL_BYTES && <div className="folio-line">{tr['folio.pageLong']}</div>}
      {bytes >= PAGE_FULL_BYTES && <div className="folio-line">{tr['folio.pageFull']}</div>}
      {statusText && (
        <div className="folio-status" data-tone={status === 'notSaved' || status === 'couldNotSave' ? 'warn' : undefined}>
          {statusText}
          {status === 'notSaved' && <> · <button type="button" className="folio-button folio-button--inline" onClick={() => void copyPage()}>{tr['folio.copyPage']}</button></>}
        </div>
      )}
      {notice && (
        <div className="folio-notice" role="status">
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
