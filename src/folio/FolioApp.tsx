import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
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
  const route = parseFolioRoute(routePath)

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

  const onDelete = useCallback(async () => {
    setMenuOpen(false)
    if (!pageId || !window.confirm(tr['folio.deletePage.confirm'])) return
    await deletePage(user.uid, pageId).catch(() => {})
    navigateTo('/folio/pages', { replace: true })
  }, [pageId, tr, user.uid, navigateTo])

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
        </div>
        <div className="folio-topbar__group">
          <button type="button" className="folio-button" onClick={() => goToSessions()}>{tr['folio.sessions']}</button>
          <button type="button" className="folio-button" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((v) => !v)}>•••<span className="folio-visually-hidden">{tr['folio.menu']}</span></button>
        </div>
        {menuOpen && (
          <div className="folio-menu" role="menu">
            {pageId && <button role="menuitem" type="button" className="folio-button" onClick={() => { setReading((v) => !v); setMenuOpen(false) }}>{reading ? tr['folio.writingView'] : tr['folio.readingView']}</button>}
            <button role="menuitem" type="button" className="folio-button" onClick={() => { setMenuOpen(false); setReading(false); navigateTo(`/folio/p/${newId()}`) }}>{tr['folio.newPage']}</button>
            {pageId && <button role="menuitem" type="button" className="folio-button" onClick={() => void onDelete()}>{tr['folio.deletePage']}</button>}
            <button role="menuitem" type="button" className="folio-button" onClick={() => { setMenuOpen(false); shore.findHelp() }}>{tr['folio.findHelp']}</button>
            <button role="menuitem" type="button" className="folio-button" onClick={() => { setMenuOpen(false); setSettingsOpen(true) }}>{tr['folio.settings']}</button>
          </div>
        )}
      </header>

      <main className="folio-main">
        {route?.kind !== 'pages' && <h1 className="folio-visually-hidden">Folio</h1>}
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

        {pageId && !reading && (
          <>
            <FolioPageView
              key={pageId}
              uid={user.uid}
              pageId={pageId}
              switches={switches}
              shore={shore}
              reduceMotion={reduceMotion}
              ornaments={ornaments}
              onNavigate={navigateTo}
              onAnnounce={announce}
            />
            {prefs !== undefined && !prefs?.firstVisitSeenAt && (
              <div className="folio-line" role="note">
                {tr['folio.firstVisit']}{' '}
                <button type="button" className="folio-button folio-button--inline folio-button--link" onClick={() => setPolicyOpen(true)}>{tr['folio.privacyPolicy']}</button>{' · '}
                <button type="button" className="folio-button folio-button--inline" onClick={() => void updatePreferences(user.uid, { firstVisitSeenAt: Date.now() })}>{tr['folio.firstVisit.dismiss']}</button>
              </div>
            )}
          </>
        )}
        {pageId && reading && <ReadingView key={pageId} uid={user.uid} pageId={pageId} />}
      </main>

      {settingsOpen && (
        <div className="folio-notice" role="dialog" aria-label={tr['folio.settings']} style={{ bottom: 'auto', top: 80 }}>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', minHeight: 44 }}>
            <input type="checkbox" checked={reduceMotion} onChange={(e) => void updatePreferences(user.uid, { reduceMotion: e.target.checked })} />
            {tr['folio.settings.reduceMotion']}
          </label>
          <button type="button" className="folio-button" onClick={() => setSettingsOpen(false)}>{tr['folio.settings.close']}</button>
        </div>
      )}

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
