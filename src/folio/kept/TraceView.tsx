import { useCallback, useEffect, useRef, useState } from 'react'
import { getLanguageCode, useTranslation } from '../../i18n'
import { useModalA11y } from '../../hooks/useModalA11y'
import type { FolioTrace, FolioTraceEntry } from '../../types/folio'
import type { FolioSwitches } from '../access'
import { newId } from '../page/schema'
import { shortDate } from './dates'
import { lineageOf } from './floor'
import { parseComposition, traceName, tracePid } from './keep'
import { CompositionView } from './CompositionView'
import { ComeBackChoices } from './ComeBackChoices'
import { CorrectedCopy } from './CorrectedCopy'
import { addEntry, deleteEntry, deleteTrace, subscribeEntries } from './traceStore'
import { writeOpenFoldIntent } from './goToPage'
import { pageExists } from '../store'
import type { Kept } from './useKept'

// A trace (draft 4 §3.7): the composition exactly as kept, read-only, with
// its date; Add (dated today, beside it on wide screens and below on narrow
// ones; 10 s undo; never edited in place); Name it; Come back to this; Lift
// into today's page; Make a corrected copy (build plan §3.5); Go to the page;
// Delete.

export const UNDO_MS = 10_000
export const ARRIVAL_GRACE_MS = 4_000

interface Props {
  uid: string
  trace: FolioTrace | null
  kept: Kept
  switches: FolioSwitches
  onNavigate: (path: string, opts?: { replace?: boolean }) => void
  onAnnounce: (message: string) => void
  onLiftToday: (trace: FolioTrace) => void
  /** H3: the writer let kept things come back on their own (Folio settings). */
  returnSetting?: boolean
}

export function TraceView({ uid, trace, kept, switches, onNavigate, onAnnounce, onLiftToday, returnSetting }: Props) {
  const tr = useTranslation()
  const lang = getLanguageCode()
  const [entries, setEntries] = useState<FolioTraceEntry[]>([])
  const [entriesLoaded, setEntriesLoaded] = useState(false)
  const [draft, setDraft] = useState('')
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')
  const [comingBack, setComingBack] = useState(false)
  const [menu, setMenu] = useState(false)
  const [correcting, setCorrecting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [undo, setUndo] = useState<{ entryId: string } | null>(null)
  const [pageGone, setPageGone] = useState(false)
  // Today, for the Add area's date: fixed when the trace opens.
  const [today] = useState(() => Date.now())
  const addRef = useRef<HTMLTextAreaElement>(null)
  const traceId = trace?.id ?? null

  useEffect(() => {
    if (!traceId) return
    return subscribeEntries(uid, traceId, (e) => { setEntries(e); setEntriesLoaded(true) }, () => setEntriesLoaded(true))
  }, [uid, traceId])

  // Opening a trace sweeps its unchecked units (§5.4), once its entries are known.
  const swept = useRef<string | null>(null)
  useEffect(() => {
    if (!trace || !entriesLoaded || swept.current === trace.id) return
    swept.current = trace.id
    kept.safety.sweep(trace, entries)
  }, [trace, entries, entriesLoaded, kept.safety])

  // Undo lasts 10 seconds or until the next action.
  useEffect(() => {
    if (!undo) return
    const t = setTimeout(() => setUndo(null), UNDO_MS)
    return () => clearTimeout(t)
  }, [undo])

  const date = useCallback((ms: number) => shortDate(ms, lang, kept.tz), [lang, kept.tz])

  // A trace that no longer exists (deleted here or elsewhere): back to the
  // floor. A trace just created (Keep, a corrected copy) can be opened before
  // the listener reports it, so a trace never seen here gets a short grace.
  const [seen, setSeen] = useState(false)
  const [graceOver, setGraceOver] = useState(false)
  if (trace && !seen) setSeen(true)
  useEffect(() => {
    const t = setTimeout(() => setGraceOver(true), ARRIVAL_GRACE_MS)
    return () => clearTimeout(t)
  }, [])
  const missing = kept.loaded && !trace && (seen || graceOver)
  useEffect(() => { if (missing) onNavigate('/folio/kept', { replace: true }) }, [missing, onNavigate])

  if (!trace) {
    return (
      <section className="folio-trace">
        <p className="folio-line">{tr['folio.opening']}</p>
      </section>
    )
  }

  const composition = parseComposition(trace.composition)
  const original = trace.correctedFromId ? kept.traces.find((t) => t.id === trace.correctedFromId) : undefined
  const earlier = lineageOf(trace, kept.traces)

  const add = () => {
    const text = draft.trim()
    if (!text) return
    const entry: FolioTraceEntry = { id: newId(), addedAt: Date.now(), text, author: 'writer' }
    setDraft('')
    setUndo({ entryId: entry.id })
    onAnnounce(tr['folio.added'])
    void addEntry(uid, trace.id, entry).catch(() => {})
    kept.safety.checkNew(trace, [...entries, entry], [tracePid(trace.id, `e:${entry.id}`)])
  }

  const goToPage = async () => {
    const exists = await pageExists(uid, trace.source.pageId).catch(() => true)
    if (!exists) { setPageGone(true); onAnnounce(tr['folio.pageGone']); return }
    writeOpenFoldIntent(uid, trace.source.pageId, trace.source.foldId)
    onNavigate(`/folio/p/${trace.source.pageId}`)
  }

  const saveName = () => {
    void kept.update(trace.id, { title: name.trim().slice(0, 200) }).catch(() => {})
    setNaming(false)
  }

  return (
    <section className="folio-trace" aria-labelledby="folio-trace-title">
      <header className="folio-trace__header">
        <h1 id="folio-trace-title">{traceName(trace)}</h1>
        <div className="folio-trace__meta">
          {tr['folio.keptOn'].replace('{date}', date(trace.keptAt))}
          {typeof trace.comeBackAt === 'number' && <> · {tr['folio.comeBack.on'].replace('{date}', date(trace.comeBackAt))}</>}
        </div>
        {original && (
          <div className="folio-trace__meta">
            {tr['folio.correctedFrom'].replace('{date}', date(original.keptAt))} ·{' '}
            <button type="button" className="folio-button folio-button--inline folio-button--link" onClick={() => onNavigate(`/folio/kept/${original.id}`)}>{tr['folio.earlierWording']}</button>
          </div>
        )}
      </header>

      {naming && (
        <form className="folio-trace__name" onSubmit={(e) => { e.preventDefault(); saveName() }}>
          <label>
            <span className="folio-visually-hidden">{tr['folio.nameIt.label']}</span>
            <input className="folio-input" value={name} maxLength={200} autoFocus onChange={(e) => setName(e.target.value)} placeholder={tr['folio.nameIt.label']} />
          </label>
          <button type="submit" className="folio-button">{tr['folio.nameIt.save']}</button>
          <button type="button" className="folio-button" onClick={() => setNaming(false)}>{tr['folio.cancel']}</button>
        </form>
      )}

      {correcting && composition ? (
        <CorrectedCopy
          uid={uid}
          original={trace}
          composition={composition}
          kept={kept}
          onDone={(copyId) => { setCorrecting(false); if (copyId) onNavigate(`/folio/kept/${copyId}`) }}
        />
      ) : (
        <div className="folio-trace__body">
          <div className="folio-trace__composition">
            {composition
              ? <CompositionView composition={composition} labels={{ line: tr['folio.lift'], between: tr['folio.between'], beneath: tr['folio.beneath'] }} />
              : <p className="folio-line">{trace.surface}</p>}
          </div>
          <div className="folio-trace__entries">
            {entries.map((e) => (
              <article key={e.id} className="folio-entry">
                <div className="folio-entry__date">{date(e.addedAt)}</div>
                <p className="folio-entry__text">{e.text}</p>
                <button type="button" className="folio-button folio-button--inline" aria-label={`${tr['folio.delete']}: ${date(e.addedAt)}`} onClick={() => { void deleteEntry(uid, trace.id, e.id).catch(() => {}) }}>{tr['folio.delete']}</button>
              </article>
            ))}
            <form className="folio-entry folio-entry--new" onSubmit={(e) => { e.preventDefault(); add() }}>
              <label>
                <span className="folio-entry__date">{date(today)}</span>
                <span className="folio-visually-hidden">{tr['folio.add.label']}</span>
                <textarea ref={addRef} className="folio-input folio-entry__input" value={draft} rows={3} maxLength={20000} onChange={(e) => { setDraft(e.target.value); if (undo) setUndo(null) }} />
              </label>
              <button type="submit" className="folio-button" disabled={draft.trim() === ''}>{tr['folio.add']}</button>
            </form>
            {undo && (
              <div className="folio-line" role="status">
                {tr['folio.added']} ·{' '}
                <button type="button" className="folio-button folio-button--inline" onClick={() => { void deleteEntry(uid, trace.id, undo.entryId).catch(() => {}); setUndo(null) }}>{tr['folio.undo']}</button>
              </div>
            )}
          </div>
        </div>
      )}

      {!correcting && (
        <div className="folio-trace__actions">
          <button type="button" className="folio-button" onClick={() => addRef.current?.focus()}>{tr['folio.add']}</button>
          <button type="button" className="folio-button" aria-expanded={comingBack} onClick={() => setComingBack((v) => !v)}>{tr['folio.comeBack']}</button>
          <button type="button" className="folio-button" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((v) => !v)}>•••<span className="folio-visually-hidden">{tr['folio.menu']}</span></button>
          {menu && (
            <div className="folio-menu folio-menu--inline" role="menu">
              <button role="menuitem" type="button" className="folio-button" onClick={() => { setMenu(false); setName(trace.title ?? ''); setNaming(true) }}>{tr['folio.nameIt']}</button>
              {switches.liftToday && <button role="menuitem" type="button" className="folio-button" onClick={() => { setMenu(false); onLiftToday(trace) }}>{tr['folio.liftToday']}</button>}
              {composition && <button role="menuitem" type="button" className="folio-button" onClick={() => { setMenu(false); setCorrecting(true) }}>{tr['folio.correctedCopy']}</button>}
              <button role="menuitem" type="button" className="folio-button" onClick={() => { setMenu(false); void goToPage() }}>{tr['folio.goToPage']}</button>
              <button role="menuitem" type="button" className="folio-button" onClick={() => { setMenu(false); setConfirmDelete(true) }}>{tr['folio.delete']}</button>
            </div>
          )}
        </div>
      )}

      {pageGone && <p className="folio-line" role="status">{tr['folio.pageGone']}</p>}

      {returnSetting && !correcting && (
        <label className="folio-trace__return">
          <input type="checkbox" checked={trace.returnEligible === true} onChange={(e) => { void kept.update(trace.id, { returnEligible: e.target.checked }).catch(() => {}) }} />
          {tr['folio.return.trace']}
        </label>
      )}

      {comingBack && (
        <div className="folio-trace__comeback">
          <ComeBackChoices tz={kept.tz} autoFocus onChoose={(choice) => { if (kept.setComeBack(trace.id, choice)) setComingBack(false) }} />
          {typeof trace.comeBackAt === 'number' && (
            <button type="button" className="folio-button" onClick={() => { kept.clearComeBack(trace.id); setComingBack(false) }}>{tr['folio.comeBack.clear']}</button>
          )}
        </div>
      )}

      {earlier.length > 0 && (
        <nav className="folio-trace__lineage" aria-label={tr['folio.versions']}>
          <h2>{tr['folio.versions']}</h2>
          <ul>
            {earlier.map((t) => (
              <li key={t.id}>
                <button type="button" className="folio-button folio-button--inline folio-button--link" onClick={() => onNavigate(`/folio/kept/${t.id}`)}>
                  {tr['folio.keptOn'].replace('{date}', date(t.keptAt))}
                </button>
              </li>
            ))}
          </ul>
        </nav>
      )}

      {confirmDelete && (
        <ConfirmDialog
          label={tr['folio.delete']}
          body={tr['folio.deleteTrace.body']}
          confirm={tr['folio.delete']}
          cancel={tr['folio.cancel']}
          onConfirm={() => { void deleteTrace(uid, trace.id).catch(() => {}); setConfirmDelete(false); onNavigate('/folio/kept', { replace: true }) }}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </section>
  )
}

export function ConfirmDialog({ label, body, confirm, cancel, onConfirm, onCancel, extra }: {
  label: string
  body: string
  confirm: string
  cancel: string
  onConfirm: () => void
  onCancel: () => void
  extra?: { label: string; onClick: () => void }
}) {
  const ref = useRef<HTMLDivElement>(null)
  useModalA11y(ref, onCancel)
  return (
    <div className="folio-dialog__backdrop">
      <div ref={ref} className="folio-dialog" role="dialog" aria-modal="true" aria-label={label} tabIndex={-1}>
        <p>{body}</p>
        <div className="folio-dialog__actions">
          <button type="button" className="folio-button" onClick={onCancel}>{cancel}</button>
          {extra && <button type="button" className="folio-button" onClick={extra.onClick}>{extra.label}</button>}
          <button type="button" className="folio-button folio-button--strong" onClick={onConfirm}>{confirm}</button>
        </div>
      </div>
    </div>
  )
}
