import { useState, useEffect, useCallback, useRef, Suspense } from 'react'
import { BreathingBackground } from './components/Atmosphere/BreathingBackground'
import { CursorGlow } from './components/Atmosphere/CursorGlow'
import { BilateralPulse } from './components/Atmosphere/BilateralPulse'
import { EntriesList } from './components/Sidebar/EntriesList'
import { LoginScreen } from './components/LoginScreen'
import { AnnouncementBanner } from './components/AnnouncementBanner'
import { ChunkErrorBoundary } from './components/ChunkErrorBoundary'
// Crisis resources are part of the main bundle on purpose: they must render
// offline and after a broken deploy, when a lazy chunk may never arrive.
import { CrisisResources } from './components/CrisisResources'
import { useAuth } from './auth/useAuth'
import { initializeDB, db } from './store/db'
import { useSettings } from './store/settings'
import { initGlobalConfig, teardownGlobalConfig, useGlobalConfig, useNewVersionAvailable, useGlobalConfigStatus, whenGlobalConfigReady, getGlobalConfig } from './store/globalConfig'
import { useTheme } from './hooks/useTheme'
import { useTimeAwarePalette } from './hooks/useTimeAwarePalette'
import { useSeasonalPalette } from './hooks/useSeasonalPalette'
import { useFlowState } from './hooks/useFlowState'
import { useHandwritingMode } from './hooks/useHandwritingMode'
import { useGroundingMode } from './hooks/useGroundingMode'
import { InnerWeather } from './components/InnerWeather'
import { getWeatherEngine } from './store/weatherStore'
import type { RitualEngine } from './engine/ritualEngine'
import { trackEvent } from './services/analytics'
import { t, useTranslation } from './i18n'
import { getSettings, updateSettings } from './store/settings'
import { canOpenFolio, loadFolioClaim, useFolioClaim } from './folio/access'
import type { InnerWeather as InnerWeatherType } from './types'
import { lazyWithRetry } from './utils/lazyWithRetry'

import { isAdmin } from './admin/isAdmin'
import { hasRequiredConsent } from './auth/consentGate'
import { getAuth } from 'firebase/auth'

// Shared guarded loader: retry once, then reload at most once per chunk
// (sessionStorage guard). A chunk that still fails reaches ChunkErrorBoundary,
// never an endless reload loop.
const AdminDashboard = lazyWithRetry(() => import('./admin/AdminDashboard'), 'admin-dashboard')
const SessionView = lazyWithRetry(() => import('./components/Session/SessionView'), 'session-view')
const Onboarding = lazyWithRetry(() => import('./components/Onboarding').then(m => ({ default: m.Onboarding })), 'onboarding')
const FolioApp = lazyWithRetry(() => import('./folio/FolioApp'), 'folio')

// How long a /folio visit waits for the config and the access claim before
// treating "still loading" as "no access" (an offline device with no cached
// config would otherwise wait forever).
const FOLIO_ACCESS_WAIT_MS = 4000

const isFolioPath = (path: string) => path === '/folio' || path.startsWith('/folio/')

function EditorSkeleton() {
  return (
    <div style={{
      maxWidth: 680,
      margin: '0 auto',
      padding: '120px 40px',
      opacity: 0.3,
    }}>
      <div style={{ height: 20, width: '60%', background: 'var(--border-light)', borderRadius: 4, marginBottom: 16 }} />
      <div style={{ height: 16, width: '90%', background: 'var(--border-light)', borderRadius: 4, marginBottom: 12 }} />
      <div style={{ height: 16, width: '75%', background: 'var(--border-light)', borderRadius: 4 }} />
    </div>
  )
}

function SplashScreen() {
  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--bg-primary)',
      gap: 12,
      animation: 'splashFadeIn 0.6s ease-out',
    }}>
      <style>{`@keyframes splashFadeIn { from { opacity: 0 } to { opacity: 1 } }`}</style>
      <div style={{
        fontFamily: "'Spectral', serif",
        fontSize: 28,
        fontWeight: 400,
        color: 'var(--text-primary)',
        letterSpacing: '0.02em',
      }}>
        UnderSurface
      </div>
      <div style={{
        fontFamily: "'Inter', sans-serif",
        fontSize: 13,
        color: 'var(--text-ghost)',
        letterSpacing: '0.02em',
      }}>
        {t('app.subtitle')}
      </div>
    </div>
  )
}

function App() {
  const { user, loading } = useAuth()
  const tr = useTranslation()
  const [isReady, setIsReady] = useState(false)
  const [initError, setInitError] = useState<string | null>(null)
  const [hasConsent, setHasConsent] = useState<boolean | null>(null)
  const settings = useSettings()
  const globalConfig = useGlobalConfig()
  const newVersionAvailable = useNewVersionAvailable()
  useTheme()
  useTimeAwarePalette()
  useSeasonalPalette()
  useFlowState()
  useHandwritingMode()
  const isGrounding = useGroundingMode()
  const [routePath, setRoutePath] = useState(window.location.pathname)

  useEffect(() => {
    const handler = () => setRoutePath(window.location.pathname)
    window.addEventListener('popstate', handler)
    return () => window.removeEventListener('popstate', handler)
  }, [])

  const navigateTo = useCallback((path: string, opts?: { replace?: boolean }) => {
    if (opts?.replace) {
      window.history.replaceState(null, '', path)
    } else {
      window.history.pushState(null, '', path)
    }
    setRoutePath(path)
  }, [])

  // Today's active session (searched in the 20 most recent, "today" in the
  // writer's timezone), else a new one. Used by a root visit and by Folio's
  // "Sessions" door.
  const resolveSessionsHome = useCallback(async (isFromToday?: (ms: number) => boolean): Promise<string> => {
    const tz = getSettings().timezone
    const dateFmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz })
    const todayStr = dateFmt.format(new Date())
    const today = isFromToday ?? ((ms: number) => dateFmt.format(new Date(ms)) === todayStr)
    const sessions = await db.sessions.orderBy('startedAt').reverse().limit(20).toArray()
    const todaySession = sessions.find(s => today(s.startedAt) && s.status === 'active')
    return todaySession ? `/session/${todaySession.id}` : '/session/new'
  }, [])

  const goToSessions = useCallback((handoff?: string) => {
    // With a handoff (Folio's "Talk now, bringing this"), always a new session;
    // the words wait in a one-time slot the Talk composer reads.
    if (handoff) { navigateTo('/session/new'); return }
    void resolveSessionsHome().then((path) => navigateTo(path))
  }, [navigateTo, resolveSessionsHome])

  // Folio access: admins at once; everyone else once the config and the claim
  // are known, for at most FOLIO_ACCESS_WAIT_MS.
  const configStatus = useGlobalConfigStatus()
  const folioClaim = useFolioClaim(user?.uid)
  const onFolioRoute = isFolioPath(routePath)
  const [folioWaitExpired, setFolioWaitExpired] = useState(false)
  useEffect(() => {
    if (!onFolioRoute || !user) return
    if (!isAdmin(user.email)) void loadFolioClaim(user, true)
    const timer = setTimeout(() => setFolioWaitExpired(true), FOLIO_ACCESS_WAIT_MS)
    return () => clearTimeout(timer)
  }, [onFolioRoute, user])
  const folioAllowed = !!user && canOpenFolio(globalConfig?.features, user.email, folioClaim)
  const folioAccess: 'allowed' | 'loading' | 'denied' = folioAllowed
    ? 'allowed'
    : (configStatus === 'loading' || folioClaim === null) && !folioWaitExpired ? 'loading' : 'denied'

  // Where opening the app lands next time on this device.
  useEffect(() => {
    if (onFolioRoute && folioAccess === 'allowed') { if (getSettings().lastHome !== 'folio') updateSettings({ lastHome: 'folio' }) }
    else if (routePath.startsWith('/session') && getSettings().lastHome !== 'session') updateSettings({ lastHome: 'session' })
  }, [routePath, onFolioRoute, folioAccess])

  const ritualEngineRef = useRef<InstanceType<typeof RitualEngine> | null>(null)
  const weatherEngine = getWeatherEngine()
  const [weather, setWeather] = useState<InnerWeatherType | null>(null)

  // Reset per-user derived state on any auth identity change (sign-out, or
  // signing in as a different user in the same tab). Without this, user B
  // transiently inherited A's isReady/hasConsent/route and the singleton
  // WeatherEngine's emotion history — B could reach a session or fire an opener
  // before accepting terms, and A's emotions coloured B's context (C-2).
  useEffect(() => {
    setIsReady(false)
    setHasConsent(null)
    setInitError(null)
    setWeather(null)
    weatherEngine.clear()
  }, [user?.uid, weatherEngine])

  // Initialize DB and route to a session (resume active or start new)
  useEffect(() => {
    if (!user) return

    const init = async () => {
      try {
        initGlobalConfig()
        await initializeDB()

        const consentDoc = await db.consent.get('terms')
        if (!hasRequiredConsent(consentDoc)) {
          setHasConsent(false)
          return
        }
        setHasConsent(true)

        // "Today" is determined by the user's configured timezone
        const tz = getSettings().timezone
        const dateFmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz })
        const todayStr = dateFmt.format(new Date())
        const isFromToday = (ms: number) => dateFmt.format(new Date(ms)) === todayStr
        const isRootVisit = window.location.pathname === '/' || window.location.pathname === '/new'

        if (isRootVisit) {
          // Folio is home on this device when it was the last place used and
          // the writer can open it (docs/vision/2026-10-15-folio-v4.md §3.2).
          let folioHome = false
          if (getSettings().lastHome === 'folio') {
            const admin = isAdmin(user.email)
            if (!admin) await Promise.race([whenGlobalConfigReady(), new Promise((r) => setTimeout(r, FOLIO_ACCESS_WAIT_MS))])
            const claimed = admin ? false : await loadFolioClaim(user)
            folioHome = canOpenFolio(getGlobalConfig()?.features, user.email, { folio: claimed })
          }
          // replace, not push: `/` renders nothing on its own (all content is
          // gated on the route), so leaving it in history made Back land on a
          // blank shell.
          navigateTo(folioHome ? '/folio' : await resolveSessionsHome(isFromToday), { replace: true })
        } else {
          void loadFolioClaim(user)
        }

        setIsReady(true)
        trackEvent('app_launch')
      } catch (error) {
        console.error('Init failed:', error)
        setInitError(error instanceof Error ? error.message : 'Failed to initialize. Please try again.')
      }
    }
    init()
  }, [user]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!user) {
      teardownGlobalConfig()
    }
  }, [user])

  // Log session start/end via the ritual engine.
  useEffect(() => {
    if (!isReady) return
    ;(async () => {
      if (!ritualEngineRef.current) {
        const { RitualEngine } = await import('./engine/ritualEngine')
        ritualEngineRef.current = new RitualEngine()
      }
    })()
    return () => {
      // No content available post-LivingEditor; log as a 0-word session.
      // RitualEngine still tracks the session boundary which is what matters.
      // Account deletion signs out before this cleanup runs. Do not attempt a
      // Firestore write after auth has disappeared.
      if (getAuth().currentUser) {
        ritualEngineRef.current?.logSession(0).catch(console.error)
      }
    }
  }, [isReady])

  // Poll weather from the global store every 30s. weatherEngine.getWeather()
  // mints a fresh object on every call (new id + updatedAt), so we dedupe on
  // the meaningful fields — otherwise every tick triggers a root re-render
  // even when the user's emotional landscape hasn't shifted.
  useEffect(() => {
    if (!isReady) return
    const tick = () => {
      const w = weatherEngine.getWeather()
      if (!w) return
      setWeather(prev => {
        if (
          prev
          && prev.dominantEmotion === w.dominantEmotion
          && prev.secondaryEmotion === w.secondaryEmotion
          && prev.trend === w.trend
          && Math.abs(prev.intensity - w.intensity) < 0.01
        ) return prev
        return w
      })
    }
    tick()
    const interval = setInterval(tick, 30_000)
    return () => clearInterval(interval)
  }, [isReady, weatherEngine])

  // Redirect invalid routes (admin without permission, unknown paths)
  useEffect(() => {
    if (loading) return

    if (routePath.startsWith('/admin') && !isAdmin(user?.email)) {
      window.history.replaceState(null, '', '/')
      setRoutePath('/')
    } else if (isFolioPath(routePath) && folioAccess === 'denied') {
      window.history.replaceState(null, '', '/')
      setRoutePath('/')
    } else if (
      routePath !== '/' &&
      !routePath.startsWith('/admin') &&
      !routePath.startsWith('/session') &&
      !isFolioPath(routePath)
    ) {
      window.history.replaceState(null, '', '/')
      setRoutePath('/')
    }
  }, [routePath, user?.email, loading, folioAccess])

  if (loading) {
    return <SplashScreen />
  }

  if (!user) {
    return <LoginScreen />
  }

  const isAdminRoute = routePath.startsWith('/admin') && isAdmin(user.email)
  if (isAdminRoute) {
    return (
      <ChunkErrorBoundary area="admin" variant="page">
        <Suspense fallback={<SplashScreen />}><AdminDashboard /></Suspense>
      </ChunkErrorBoundary>
    )
  }

  const isSessionRoute = routePath.startsWith('/session')
  const isNewSession = routePath === '/session/new'
  const sessionIdFromPath = !isNewSession && routePath.startsWith('/session/')
    ? routePath.split('/session/')[1]
    : null

  if (hasConsent === false) {
    const handleOnboardingComplete = async () => {
      setHasConsent(true)
      setIsReady(true)
      navigateTo('/session/new')
      trackEvent('onboarding_complete')
    }
    return (
      <ChunkErrorBoundary area="onboarding" variant="page">
        <Suspense fallback={<SplashScreen />}><Onboarding onComplete={handleOnboardingComplete} /></Suspense>
      </ChunkErrorBoundary>
    )
  }

  if (initError) {
    return (
      <div style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg-primary)',
        gap: 16,
        padding: 40,
      }}>
        <div style={{
          fontFamily: "'Spectral', serif",
          fontSize: 24,
          color: 'var(--text-primary)',
        }}>
          {tr['error.title']}
        </div>
        <div style={{
          fontFamily: "'Inter', sans-serif",
          fontSize: 13,
          color: 'var(--text-secondary)',
          textAlign: 'center',
          maxWidth: 340,
        }}>
          {initError}
        </div>
        <button
          onClick={() => { setInitError(null); window.location.reload() }}
          style={{
            fontFamily: "'Inter', sans-serif",
            fontSize: 14,
            padding: '10px 24px',
            border: '1px solid var(--border-subtle)',
            borderRadius: 8,
            background: 'var(--surface-primary)',
            color: 'var(--text-primary)',
            cursor: 'pointer',
          }}
        >
          {tr['app.tryAgain']}
        </button>
      </div>
    )
  }

  if (!isReady) {
    return <SplashScreen />
  }

  if (onFolioRoute) {
    if (folioAccess !== 'allowed') return <SplashScreen />
    // Folio renders instead of the Sessions chrome (no sidebar, atmosphere or
    // inner weather). It shows its own crisis card, tied to its shore.
    return (
      <>
        <AnnouncementBanner />
        {newVersionAvailable && (
          <div
            style={{ position: 'fixed', bottom: 20, left: 20, zIndex: 9999, padding: '10px 16px', fontSize: 12, fontFamily: "'Inter', sans-serif", background: 'var(--surface-primary)', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)', borderRadius: 8, cursor: 'pointer' }}
            onClick={() => window.location.reload()}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter') window.location.reload() }}
          >
            {tr['app.newVersion']}
          </div>
        )}
        <ChunkErrorBoundary area="folio" variant="page">
          <Suspense fallback={<SplashScreen />}>
            <FolioApp user={user} routePath={routePath} navigateTo={navigateTo} goToSessions={goToSessions} />
          </Suspense>
        </ChunkErrorBoundary>
      </>
    )
  }

  const visualEffectsEnabled = globalConfig?.features?.visualEffectsEnabled !== false

  return (
    <>
      <AnnouncementBanner />
      {newVersionAvailable && (
        <div
          style={{
            position: 'fixed',
            bottom: 20,
            right: 20,
            zIndex: 9999,
            padding: '10px 16px',
            fontSize: 12,
            fontFamily: "'Inter', sans-serif",
            background: 'var(--surface-primary)',
            color: 'var(--text-secondary)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 8,
            cursor: 'pointer',
            boxShadow: '0 2px 8px var(--overlay-medium)',
          }}
          onClick={() => window.location.reload()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter') window.location.reload() }}
        >
          {tr['app.newVersion']}
        </div>
      )}
      <a href="#editor" className="skip-to-content">{tr['app.skipToEditor']}</a>
      <BreathingBackground emotion={'neutral'} enabled={visualEffectsEnabled && globalConfig?.features?.breathingBackground !== false} />
      <CursorGlow partTint={null} />
      <BilateralPulse
        emotion={'neutral'}
        enabled={
          visualEffectsEnabled
          && globalConfig?.features?.bilateralStimulation === true
          && settings.bilateralStimulation !== false
        }
      />
      <EntriesList navigateTo={navigateTo} currentPath={routePath} onOpenFolio={folioAllowed ? () => navigateTo('/folio') : undefined} />
      <div className="inner-weather-shell">
        <InnerWeather weather={weather} />
      </div>
      <CrisisResources visible={isGrounding} />
      {isSessionRoute && (
        // Inline, so a session chunk that cannot load leaves the sidebar and
        // the crisis resources card on screen.
        <ChunkErrorBoundary area="session" messageKey="surface.error.body">
          <Suspense fallback={<EditorSkeleton />}>
            <SessionView
              sessionId={sessionIdFromPath}
              openingMethod="auto"
              onSessionCreated={(id) => {
                window.history.replaceState(null, '', `/session/${id}`)
                setRoutePath(`/session/${id}`)
              }}
            />
          </Suspense>
        </ChunkErrorBoundary>
      )}
    </>
  )
}

export default App
