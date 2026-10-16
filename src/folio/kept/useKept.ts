import { useCallback, useEffect, useMemo, useState } from 'react'
import { getLanguageCode } from '../../i18n'
import { activateGrounding } from '../../store/groundingState'
import { checkCrisisRisk } from '../../ai/openrouter'
import { detectCrisisKeywords } from '../../engine/sessionOrchestrator'
import { getSettings } from '../../store/settings'
import type { FolioTrace, FolioTraceEntry } from '../../types/folio'
import { isRecent, useLastGrounding } from '../safety/recent'
import type { ShorePresentation } from '../safety/shorePresentation'
import { newId } from '../page/schema'
import { buildTrace, parseComposition, tracePid, traceUnits, writerPassageText } from './keep'
import { checkKey } from '../safety/checkedSet'
import type { FoldSnapshot } from './keep'
import { CLEARED, comeBackFields, dueTraces, nextSlip, usableTimezone } from './comeBack'
import type { ComeBackChoice } from './comeBack'
import { createTrace, deleteTrace, saveTraceChecked, subscribeTraces, updateTrace } from './traceStore'
import type { TracePatch } from './traceStore'
import { TraceSafety } from './traceSafety'
import { nextReturn } from './returnTide'

// Kept things for the whole Folio shell (draft 4 §3.7, §3.8, §5.4, §5.5): the
// traces, their safety queue, Keep, and when a come-back slip may show.

export interface KeepRequest {
  /** Chosen by the page, so its checked keys can name the trace. */
  id: string
  pageId: string
  foldId: string
  revId: string | null
  snapshot: FoldSnapshot
  /** Keys recorded as checked in the same write (§5.4). */
  checked: string[]
  /** Involvement level 4+: the companion kept it. */
  keptBy?: 'companion'
}

export interface Kept {
  traces: FolioTrace[]
  loaded: boolean
  /** The writer's timezone, usable by Intl. */
  tz: string
  /** The Recent overlay (72 h since the last grounding activation). */
  recent: boolean
  /** The slip to show at the top now, if any (never under Recent; the caller checks Shore and Quiet). */
  slip: FolioTrace | null
  /** Due traces held by Recent: the floor's "Waiting" group. */
  waiting: FolioTrace[]
  /** H3: the trace Return would bring now (the shell applies the other conditions). */
  returnCandidate: FolioTrace | null
  keep: (req: KeepRequest) => FolioTrace
  /** A corrected copy (build plan §3.5): a new trace; the original stays. */
  keepCorrection: (original: FolioTrace, snapshot: FoldSnapshot) => Promise<FolioTrace>
  undoKeep: (traceId: string) => void
  setComeBack: (traceId: string, choice: ComeBackChoice) => boolean
  clearComeBack: (traceId: string) => void
  notNow: (traceId: string) => void
  update: (traceId: string, patch: TracePatch) => Promise<void>
  safety: TraceSafety
}

export function useKept(uid: string, shore: ShorePresentation, opts: { dances?: boolean } = {}): Kept {
  const [traces, setTraces] = useState<FolioTrace[]>([])
  const [loaded, setLoaded] = useState(false)
  useEffect(() => subscribeTraces(uid, (t) => { setTraces(t); setLoaded(true) }, () => setLoaded(true)), [uid])

  const lastGrounding = useLastGrounding(uid)
  // Due-ness moves with time: re-check every minute and when the tab shows.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const tickNow = () => setNow(Date.now())
    const timer = setInterval(tickNow, 60_000)
    const onVisible = () => { if (document.visibilityState === 'visible') tickNow() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', onVisible) }
  }, [])
  // A fresh activation counts at once: `now` is never earlier than it.

  const tz = usableTimezone(getSettings().timezone)
  const recent = isRecent(lastGrounding, Math.max(now, lastGrounding ?? 0))
  const slip = useMemo(() => (recent ? null : nextSlip(traces, now, tz)), [recent, traces, now, tz])
  const waiting = useMemo(() => (recent ? dueTraces(traces, now) : []), [recent, traces, now])
  const dances = opts.dances === true
  const returnCandidate = useMemo(() => (recent ? null : nextReturn(traces, now, tz, { dances })), [recent, traces, now, tz, dances])

  const safety = useMemo(() => new TraceSafety({
    l1: detectCrisisKeywords,
    check: checkCrisisRisk,
    activate: (trigger) => { activateGrounding('auto'); shore.activation(trigger, null) },
    lateRisk: () => shore.lateRisk(),
    language: () => getLanguageCode(),
    persist: (traceId, checked) => saveTraceChecked(uid, traceId, checked).catch(() => {}),
  }), [uid, shore])
  useEffect(() => () => safety.dispose(), [safety])

  const keep = useCallback((req: KeepRequest): FolioTrace => {
    const keptAt = Date.now()
    const previous = traces.filter((t) => t.source.foldId === req.foldId).sort((a, b) => b.keptAt - a.keptAt)[0]
    const trace = buildTrace({
      id: req.id,
      snapshot: req.snapshot,
      source: { pageId: req.pageId, foldId: req.foldId, revId: req.revId },
      keptAt,
      checked: req.checked,
      groundedNearKeep: isRecent(lastGrounding, keptAt),
      previousTraceId: previous?.id ?? null,
      keptBy: req.keptBy,
    })
    // The cache shows it at once; the promise settles when the server answers.
    void createTrace(uid, trace).catch(() => {})
    const unchecked = traceUnits(trace).map((u) => u.pid)
    if (unchecked.length > 0 && req.checked.length < unchecked.length) safety.sweep(trace, [] as FolioTraceEntry[])
    return trace
  }, [uid, traces, lastGrounding, safety])

  const keepCorrection = useCallback(async (original: FolioTrace, snapshot: FoldSnapshot): Promise<FolioTrace> => {
    const id = newId()
    const keptAt = Date.now()
    // Passages whose text and line didn't change keep their checked state;
    // changed ones are checked as new text.
    const before = parseComposition(original.composition)
    const was = { between: writerPassageText(before?.between ?? null), beneath: writerPassageText(before?.beneath ?? []) }
    const draft = buildTrace({ id, snapshot, source: original.source, keptAt, checked: [], groundedNearKeep: isRecent(lastGrounding, keptAt), correctedFromId: original.id })
    const units = traceUnits(draft)
    const checked: string[] = []
    const fresh: string[] = []
    for (const u of units) {
      const part = u.pid.slice(id.length + 1) as 'between' | 'beneath'
      const unchanged = snapshot.surface === original.surface && was[part] === u.text
      const originalKey = unchanged ? await checkKey({ ...u, pid: tracePid(original.id, part) }) : null
      if (originalKey && (original.safety?.checked ?? []).includes(originalKey)) checked.push(await checkKey(u))
      else fresh.push(u.pid)
    }
    const trace = { ...draft, safety: { checked } }
    void createTrace(uid, trace).catch(() => {})
    if (fresh.length > 0) safety.checkNew(trace, [], fresh)
    return trace
  }, [uid, lastGrounding, safety])

  const undoKeep = useCallback((traceId: string) => { void deleteTrace(uid, traceId).catch(() => {}) }, [uid])
  const update = useCallback((traceId: string, patch: TracePatch) => updateTrace(uid, traceId, patch), [uid])
  const setComeBack = useCallback((traceId: string, choice: ComeBackChoice) => {
    const fields = comeBackFields(choice, Date.now(), tz)
    if (!fields) return false
    void updateTrace(uid, traceId, fields).catch(() => {})
    return true
  }, [uid, tz])
  const clearComeBack = useCallback((traceId: string) => { void updateTrace(uid, traceId, CLEARED).catch(() => {}) }, [uid])
  const notNow = useCallback((traceId: string) => { void updateTrace(uid, traceId, { lastComeBackShownAt: Date.now() }).catch(() => {}) }, [uid])

  return { traces, loaded, tz, recent, slip, waiting, returnCandidate, keep, keepCorrection, undoKeep, setComeBack, clearComeBack, notNow, update, safety }
}
