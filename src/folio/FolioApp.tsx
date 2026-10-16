import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { User } from 'firebase/auth'
import { useTranslation } from '../i18n'
import { useGlobalConfig } from '../store/globalConfig'
import { useGroundingMode } from '../hooks/useGroundingMode'
import { onGroundingActivated } from '../store/groundingState'
import { CrisisResources } from '../components/CrisisResources'
import PolicyModal from '../components/PolicyModal'
import { folioSwitches } from './access'
import { FolioPageView } from './page/FolioPageView'
import { ReadingView } from './ReadingView'
import { PagesList } from './PagesList'
import { ShorePresentation, readActivationMirror, writeActivationMirror } from './safety/shorePresentation'
import { mostRecentPage, subscribePreferences, updatePreferences, deletePage } from './store'
import { newId } from './page/schema'
import { writeHandoff } from './handoff'
import { parseFolioRoute } from './routes'
import type { FolioPreferences } from '../types/folio'
import './folio.css'
import { allowZoomWhileOpen } from './zoom'
import { useKept } from './kept/useKept'
import { KeptView } from './kept/KeptView'
import { TraceView } from './kept/TraceView'
import { ComeBackSlip, ReturnSlip } from './kept/ComeBackSlip'
import { returnAllowed } from './kept/returnTide'
import { VISIT_IDLE_MS } from './safety/shorePresentation'
import { parseComposition } from './kept/keep'
import { todaysPageId, writeLiftIntent } from './kept/liftToday'
import { deleteTrace } from './kept/traceStore'
import { DeletePageDialog } from './DeletePageDialog'
import { Capacitor } from '@capacitor/core'
import type { FolioTrace } from '../types/folio'
import { LEVELS, effectiveLevel } from './companion/levels'
import type { InvolvementLevel } from './companion/levels'

// Folio's shell (draft 4 §3.2–§3.4, §3.9): routes, the top bar, the first
// visit line, shore and the live region. Mounted by App.tsx instead of the
// Sessions chrome for /folio paths.

const RECENT_PAGE_MS = 12 * 60 * 60 * 1000

interface Props {
  user: User
  routePath: string
  navigateTo: (path: string, opts?: { replace?: boolean }) => void
  goToSessions: (handoff?: string) => void
}

export default function FolioApp({ user, routePath, navigateTo, goToSessions }: Props) {
  const tr = useTranslation()
  const config = useGlobalConfig()
  const switches = useMemo(() => folioSwitches(config?.features), [config?.features])
  const grounding = useGroundingMode()
  const shore = useMemo(() => new ShorePresentation({ lastActivationAt: readActivationMirror(user.uid) }), [user.uid])
  const shoreState = useSyncExternalStore(shore.subscribe, shore.getSnapshot)
  const [prefs, setPrefs] = useState<FolioPreferences | null | undefined>(undefined)
  const [menuOpen, setMenuOpen] = useState(false)
  const [reading, setReading] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [bringPreview, setBringPreview] = useState(false)
  const [announcement, setAnnouncement] = useState('')
  const [policyOpen, setPolicyOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const route = parseFolioRoute(routePath)
  // Companion involvement (docs/vision/2026-10-16-folio-involvement.md). Until
  // the preferences arrive, level 1: nothing unasked before the writer's choice is known.
  const level: InvolvementLevel = prefs === undefined ? 1 : effectiveLevel(prefs?.involvement, { switchOn: switches.involvement, firstVisitSeenAt: prefs?.firstVisitSeenAt })
  const kept = useKept(user.uid, shore, { dances: level === 5 })

  // Unknown /folio paths go to /folio (§3.3).
  useEffect(() => { if (!route) navigateTo('/folio', { replace: true }) }, [route, navigateTo])

  // /folio: the most recent page if edited in the last 12 hours, else a new one.
  useEffect(() => {
    if (route?.kind !== 'home') return
    let live = true
    void mostRecentPage(user.uid).then((page) => {
      if (!live) return
      if (page && Date.now() - page.updatedAt < RECENT_PAGE_MS) navigateTo(`/folio/p/${page.id}`, { replace: true })
      else navigateTo(`/folio/p/${newId()}`, { replace: true })
    }).catch(() => { if (live) navigateTo(`/folio/p/${newId()}`, { replace: true }) })
    return () => { live = false }
  }, [route?.kind, user.uid, navigateTo])
  useEffect(() => { if (route?.kind === 'new') navigateTo(`/folio/p/${newId()}`, { replace: true }) }, [route?.kind, navigateTo])

  // Shore follows the shared grounding state; every activation is mirrored on
  // this device so a reload within 30 minutes starts in Quiet (§5.5).
  useEffect(() => { shore.groundingChanged(grounding) }, [grounding, shore])
  useEffect(() => onGroundingActivated((at) => writeActivationMirror(user.uid, at)), [user.uid])

  useEffect(() => subscribePreferences(user.uid, setPrefs), [user.uid])
  useEffect(() => allowZoomWhileOpen(), [])
  const reduceMotion = prefs?.reduceMotion === true

  const announce = useCallback((m: string) => {
    setAnnouncement('')
    requestAnimationFrame(() => setAnnouncement(m))
  }, [])

  const pageId = route?.kind === 'page' ? route.pageId : null
  const presentation = shoreState.presentation
  // The Journal's ink weight and settle follow their admin switches, and go
  // quiet with the rest of the page in shore and Quiet.
  const features = config?.features
  const vfx = features?.visualEffectsEnabled !== false && presentation === 'normal'
  const inkOn = vfx && features?.inkWeight !== false
  const settleOn = vfx && features?.paragraphFade !== false
  const ornaments = useMemo(() => ({ ink: inkOn, settle: settleOn }), [inkOn, settleOn])

  // Deleting a page asks how, when kept things came from it (§3.7).
  const onDelete = useCallback(async (withTraces: string[] | null) => {
    setDeleting(false)
    if (!pageId) return
    await deletePage(user.uid, pageId).catch(() => {})
    for (const id of withTraces ?? []) await deleteTrace(user.uid, id).catch(() => {})
    navigateTo('/folio/pages', { replace: true })
  }, [pageId, user.uid, navigateTo])

  // Lift into today's page (§3.8): today's page is the page edited most
  // recently if that was today, writer-local; else a new page.
  const liftToday = useCallback(async (trace: FolioTrace) => {
    const composition = parseComposition(trace.composition)
    if (!composition) return
    const latest = await mostRecentPage(user.uid).catch(() => null)
    const target = todaysPageId(latest, Date.now(), kept.tz)
    writeLiftIntent({ uid: user.uid, pageId: target, traceId: trace.id, keptAt: trace.keptAt, line: composition.line, at: Date.now() })
    navigateTo(`/folio/p/${target}`)
  }, [user.uid, kept.tz, navigateTo])

  // Step inside (H1) under its switch; its sound under its own, on the web only.
  const insideOn = switches.stepInside
  const insideSound = switches.stepInsideSound && !Capacitor.isNativePlatform()
  const stepInside = useMemo(() => (insideOn ? { sound: insideSound } : undefined), [insideOn, insideSound])
  // Ask (H2) under its switch. Recent is read when asked, never from render.
  const recentRef = useRef(kept.recent)
  useEffect(() => { recentRef.current = kept.recent }, [kept.recent])
  const askOn = switches.ask
  const ask = useMemo(() => (askOn ? { isRecent: () => recentRef.current, onTalkNow: () => goToSessions() } : undefined), [askOn, goToSessions])
  const isRecentNow = useCallback(() => recentRef.current, [])
  const traceId = route?.kind === 'trace' ? route.traceId : null
  // H3, automatic Return: at most one per visit, after any asked come-back,
  // never under Recent, Shore or Quiet; both opt-ins on (build plan §4).
  const [visitReturn, setVisitReturn] = useState<{ id: string; dismissed: boolean } | null>(null)
  // Level 5 lets kept things come back without the setting (each trace's own "Don't" still holds).
  const returnSettingOn = switches.returnOn && (prefs?.returnEnabled === true || level === 5)
  const candidate = kept.returnCandidate
  if (visitReturn === null && candidate && returnAllowed({
    settingOn: returnSettingOn, switchOn: switches.returnOn, recent: kept.recent, presentation, askedDue: kept.slip !== null, shownThisVisit: false,
  })) setVisitReturn({ id: candidate.id, dismissed: false })
  const stamped = useRef(new Set<string>())
  useEffect(() => {
    if (!visitReturn || stamped.current.has(visitReturn.id)) return
    stamped.current.add(visitReturn.id)
    void kept.update(visitReturn.id, { lastReturnShownAt: Date.now() }).catch(() => {})
  }, [visitReturn, kept])
  useEffect(() => {
    let hiddenAt: number | null = null
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); return }
      if (hiddenAt !== null && Date.now() - hiddenAt >= VISIT_IDLE_MS) setVisitReturn(null)
      hiddenAt = null
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])
  const returnTrace = visitReturn && !visitReturn.dismissed && presentation === 'normal' && !kept.recent && !kept.slip && visitReturn.id !== traceId
    ? kept.traces.find((t) => t.id === visitReturn.id) ?? null
    : null

  const keptUpdate = kept.update
  const pageKept = useMemo(() => ({
    keep: kept.keep, undo: kept.undoKeep, setComeBack: kept.setComeBack, tz: kept.tz, traces: kept.traces,
    name: (traceId: string, title: string, by: 'companion' | null) => { void keptUpdate(traceId, { title, titleBy: by }).catch(() => {}) },
  }), [kept.keep, kept.undoKeep, kept.setComeBack, kept.tz, kept.traces, keptUpdate])
  // The slip shows only on Normal paper (never in Shore or Quiet; Recent holds it in useKept).
  const slip = presentation === 'normal' && kept.slip && kept.slip.id !== traceId ? kept.slip : null

  return (
    <div
      className="folio-root"
      data-shore={presentation === 'shore' ? 'true' : undefined}
      data-quiet={presentation === 'quiet' ? 'true' : undefined}
      data-reduce-motion={reduceMotion || presentation !== 'normal' ? 'true' : undefined}
    >
      <header className="folio-topbar">
        <div className="folio-topbar__group">
          <button type="button" className="folio-button" onClick={() => navigateTo('/folio/pages')} aria-pressed={route?.kind === 'pages'}>{tr['folio.pages']}</button>
          <button type="button" className="folio-button" onClick={() => navigateTo('/folio/kept')} aria-pressed={route?.kind === 'kept' || route?.kind === 'trace'}>{tr['folio.kept.nav']}</button>
        </div>
        <div className="folio-topbar__group">
          <button type="button" className="folio-button" onClick={() => goToSessions()}>{tr['folio.sessions']}</button>
          <button type="button" className="folio-button" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((v) => !v)}>•••<span className="folio-visually-hidden">{tr['folio.menu']}</span></button>
        </div>
        {menuOpen && (
          <div className="folio-menu" role="menu">
            {pageId && <button role="menuitem" type="button" className="folio-button" onClick={() => { setReading((v) => !v); setMenuOpen(false) }}>{reading ? tr['folio.writingView'] : tr['folio.readingView']}</button>}
            <button role="menuitem" type="button" className="folio-button" onClick={() => { setMenuOpen(false); setReading(false); navigateTo(`/folio/p/${newId()}`) }}>{tr['folio.newPage']}</button>
            {pageId && <button role="menuitem" type="button" className="folio-button" onClick={() => { setMenuOpen(false); setDeleting(true) }}>{tr['folio.deletePage']}</button>}
            <button role="menuitem" type="button" className="folio-button" onClick={() => { setMenuOpen(false); shore.findHelp() }}>{tr['folio.findHelp']}</button>
            <button role="menuitem" type="button" className="folio-button" onClick={() => { setMenuOpen(false); setSettingsOpen(true) }}>{tr['folio.settings']}</button>
          </div>
        )}
      </header>

      <main className="folio-main">
        {route?.kind !== 'pages' && route?.kind !== 'kept' && route?.kind !== 'trace' && <h1 className="folio-visually-hidden">Folio</h1>}
        {slip && (
          <ComeBackSlip
            trace={slip}
            tz={kept.tz}
            liftToday={switches.liftToday}
            onOpen={() => { kept.clearComeBack(slip.id); navigateTo(`/folio/kept/${slip.id}`) }}
            onNotNow={() => kept.notNow(slip.id)}
            onClear={() => kept.clearComeBack(slip.id)}
            onLiftToday={() => { kept.clearComeBack(slip.id); void liftToday(slip) }}
          />
        )}
        {!slip && returnTrace && (
          <ReturnSlip
            trace={returnTrace}
            tz={kept.tz}
            onOpen={() => { setVisitReturn({ id: returnTrace.id, dismissed: true }); navigateTo(`/folio/kept/${returnTrace.id}`) }}
            onNotNow={() => setVisitReturn({ id: returnTrace.id, dismissed: true })}
            onOff={() => { setVisitReturn({ id: returnTrace.id, dismissed: true }); void kept.update(returnTrace.id, { returnEligible: false }).catch(() => {}) }}
          />
        )}
        {presentation === 'shore' && (
          <section className="folio-shore-line" aria-live="polite">
            <div>{tr['folio.shore.line']}</div>
            <div className="folio-shore-line__actions">
              <button type="button" className="folio-button" onClick={() => goToSessions()}>{tr['folio.shore.talk']}</button>
              {shoreState.bring && <button type="button" className="folio-button" onClick={() => setBringPreview(true)}>{tr['folio.shore.bringThis']}</button>}
              <button type="button" className="folio-button" onClick={() => shore.findHelp()}>{tr['folio.shore.help']}</button>
              <button type="button" className="folio-button" onClick={() => shore.okay()}>{tr['folio.shore.okay']}</button>
            </div>
            {bringPreview && shoreState.bring && (
              <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: 12, color: 'var(--folio-control)' }}>{tr['folio.shore.bringPreview']}</div>
                <blockquote style={{ margin: '8px 0', whiteSpace: 'pre-wrap', fontFamily: "'Spectral', Georgia, serif" }}>{shoreState.bring.text}</blockquote>
                <button type="button" className="folio-button" onClick={() => { const text = shoreState.bring?.text ?? ''; writeHandoff(user.uid, text); shore.clearBring(); goToSessions(text) }}>{tr['folio.shore.go']}</button>
                <button type="button" className="folio-button" onClick={() => setBringPreview(false)}>{tr['folio.shore.notThis']}</button>
              </div>
            )}
          </section>
        )}

        {route?.kind === 'pages' && <PagesList uid={user.uid} onOpen={(id) => navigateTo(`/folio/p/${id}`)} />}
        {route?.kind === 'kept' && <KeptView uid={user.uid} kept={kept} onOpen={(id) => navigateTo(`/folio/kept/${id}`)} />}
        {traceId && (
          <TraceView
            key={traceId}
            uid={user.uid}
            trace={kept.traces.find((t) => t.id === traceId) ?? null}
            kept={kept}
            switches={switches}
            onNavigate={navigateTo}
            onAnnounce={announce}
            onLiftToday={(t) => void liftToday(t)}
            returnSetting={returnSettingOn}
          />
        )}

        {pageId && !reading && (
          <>
            {/* Above the page, so it's seen without scrolling on any screen. */}
            {prefs !== undefined && !prefs?.firstVisitSeenAt && (
              <div className="folio-line" role="note">
                {level === 1 ? tr['folio.firstVisit'] : level === 5 ? tr['folio.firstVisit.dances'] : tr['folio.firstVisit.reads']}{' '}
                <button type="button" className="folio-button folio-button--inline folio-button--link" onClick={() => setPolicyOpen(true)}>{tr['folio.privacyPolicy']}</button>{' · '}
                <button type="button" className="folio-button folio-button--inline" onClick={() => void updatePreferences(user.uid, { firstVisitSeenAt: Date.now() })}>{tr['folio.firstVisit.dismiss']}</button>
              </div>
            )}
            {switches.involvement && prefs?.firstVisitSeenAt && prefs.involvement === undefined && !prefs.involvementIntroSeenAt && (
              <div className="folio-line" role="note">
                {tr['folio.involvement.intro']}{' '}
                <button type="button" className="folio-button folio-button--inline folio-button--link" onClick={() => setSettingsOpen(true)}>{tr['folio.involvement.choose']}</button>{' · '}
                <button type="button" className="folio-button folio-button--inline" aria-label={tr['folio.cancel']} onClick={() => void updatePreferences(user.uid, { involvementIntroSeenAt: Date.now() })}>×</button>
              </div>
            )}
            <FolioPageView
              key={pageId}
              uid={user.uid}
              pageId={pageId}
              switches={switches}
              shore={shore}
              reduceMotion={reduceMotion}
              ornaments={ornaments}
              kept={pageKept}
              presentation={presentation}
              stepInside={stepInside}
              ask={ask}
              involvement={level}
              isRecent={isRecentNow}
              onNavigate={navigateTo}
              onAnnounce={announce}
            />
          </>
        )}
        {pageId && reading && <ReadingView key={pageId} uid={user.uid} pageId={pageId} />}
      </main>

      {settingsOpen && (
        <div className="folio-notice folio-settings" role="dialog" aria-label={tr['folio.settings']} style={{ bottom: 'auto', top: 80 }}>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', minHeight: 44 }}>
            <input type="checkbox" checked={reduceMotion} onChange={(e) => void updatePreferences(user.uid, { reduceMotion: e.target.checked })} />
            {tr['folio.settings.reduceMotion']}
          </label>
          {switches.returnOn && (
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', minHeight: 44 }}>
              <input type="checkbox" checked={prefs?.returnEnabled === true} onChange={(e) => void updatePreferences(user.uid, { returnEnabled: e.target.checked })} />
              {tr['folio.return.setting']}
            </label>
          )}
          {switches.involvement && (
            <div className="folio-involvement">
              <label htmlFor="folio-involvement" className="folio-involvement__label">{tr['folio.involvement']}</label>
              <input
                id="folio-involvement"
                type="range"
                min={1}
                max={5}
                step={1}
                value={level}
                aria-valuetext={tr['folio.involvement.level'].replace('{n}', String(level)).replace('{name}', tr[`folio.involvement.${level}`])}
                onChange={(e) => {
                  const next = Number(e.target.value) as InvolvementLevel
                  void updatePreferences(user.uid, { involvement: next, ...(prefs?.involvementIntroSeenAt ? {} : { involvementIntroSeenAt: Date.now() }) })
                }}
              />
              <div className="folio-involvement__scale" aria-hidden="true">
                {LEVELS.map((l) => <span key={l} data-on={l === level ? 'true' : undefined}>{tr[`folio.involvement.${l}`]}</span>)}
              </div>
              <p className="folio-involvement__line">{tr[`folio.involvement.${level}.line`]}</p>
              {level >= 2 && <p className="folio-involvement__line">{tr['folio.involvement.afterHard']}</p>}
            </div>
          )}
          <button type="button" className="folio-button" onClick={() => setSettingsOpen(false)}>{tr['folio.settings.close']}</button>
        </div>
      )}

      {deleting && pageId && <DeletePageDialog uid={user.uid} pageId={pageId} onDelete={(t) => void onDelete(t)} onCancel={() => setDeleting(false)} />}
      <PolicyModal isOpen={policyOpen} onClose={() => setPolicyOpen(false)} />
      {shoreState.card && (
        <aside className="folio-help" aria-label={tr['folio.findHelp']}>
          <CrisisResources visible showToken={shoreState.cardToken} onDismiss={() => shore.cardDismissed()} />
        </aside>
      )}
      <div className="folio-visually-hidden" aria-live="polite" role="status">{announcement}</div>
    </div>
  )
}
