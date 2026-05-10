import { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react'
import { BreathingBackground } from './components/Atmosphere/BreathingBackground'
import { CursorGlow } from './components/Atmosphere/CursorGlow'
import { BilateralPulse } from './components/Atmosphere/BilateralPulse'
import { EntriesList } from './components/Sidebar/EntriesList'
import { LoginScreen } from './components/LoginScreen'
import { AnnouncementBanner } from './components/AnnouncementBanner'
import { useAuth } from './auth/useAuth'
import { initializeDB, db } from './store/db'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function lazyWithRetry<T extends React.ComponentType<any>>(factory: () => Promise<{ default: T }>) {
  return lazy(() => factory().catch(() => {
    window.location.reload()
    return new Promise<{ default: T }>(() => {})
  }))
}

const AdminDashboard = lazyWithRetry(() => import('./admin/AdminDashboard'))
const SessionView = lazyWithRetry(() => import('./components/Session/SessionView'))
import { useSettings } from './store/settings'
import { initGlobalConfig, teardownGlobalConfig, useGlobalConfig, useNewVersionAvailable } from './store/globalConfig'
import { useTheme } from './hooks/useTheme'
import { useTimeAwarePalette } from './hooks/useTimeAwarePalette'
import { useSeasonalPalette } from './hooks/useSeasonalPalette'
import { useFlowState } from './hooks/useFlowState'
import { useHandwritingMode } from './hooks/useHandwritingMode'
import { useGroundingMode } from './hooks/useGroundingMode'
import { InnerWeather } from './components/InnerWeather'
import { getWeatherEngine } from './store/weatherStore'
import type { RitualEngine } from './engine/ritualEngine'
const Onboarding = lazyWithRetry(() => import('./components/Onboarding').then(m => ({ default: m.Onboarding })))
const CrisisResources = lazyWithRetry(() => import('./components/CrisisResources').then(m => ({ default: m.CrisisResources })))
import { trackEvent } from './services/analytics'
import { t, useTranslation } from './i18n'
import { getSettings } from './store/settings'
import type { InnerWeather as InnerWeatherType } from './types'

import { isAdmin } from './admin/isAdmin'

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

  const navigateTo = useCallback((path: string) => {
    window.history.pushState(null, '', path)
    setRoutePath(path)
  }, [])

  const ritualEngineRef = useRef<InstanceType<typeof RitualEngine> | null>(null)
  const weatherEngine = getWeatherEngine()
  const [weather, setWeather] = useState<InnerWeatherType | null>(null)

  // Initialize DB and route to a session (resume active or start new)
  useEffect(() => {
    if (!user) return

    const init = async () => {
      try {
        initGlobalConfig()
        await initializeDB()

        const consentDoc = await db.consent.get('terms')
        if (!consentDoc || (consentDoc as { acceptedVersion?: string }).acceptedVersion !== '1.0') {
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
          // Cap to recent 20 — covers virtually all real "today's active" cases
          // without paging the entire session history on every cold boot.
          const sessions = await db.sessions.orderBy('startedAt').reverse().limit(20).toArray()
          const todaySession = sessions.find(
            s => isFromToday(s.startedAt) && s.status === 'active',
          )
          navigateTo(todaySession ? `/session/${todaySession.id}` : '/session/new')
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
      ritualEngineRef.current?.logSession(0).catch(console.error)
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
    } else if (
      routePath !== '/' &&
      !routePath.startsWith('/admin') &&
      !routePath.startsWith('/session')
    ) {
      window.history.replaceState(null, '', '/')
      setRoutePath('/')
    }
  }, [routePath, user?.email, loading])

  if (loading) {
    return <SplashScreen />
  }

  if (!user) {
    return <LoginScreen />
  }

  const isAdminRoute = routePath.startsWith('/admin') && isAdmin(user.email)
  if (isAdminRoute) {
    return <Suspense fallback={<SplashScreen />}><AdminDashboard /></Suspense>
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
    return <Suspense fallback={<SplashScreen />}><Onboarding onComplete={handleOnboardingComplete} /></Suspense>
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
      <EntriesList navigateTo={navigateTo} currentPath={routePath} />
      <div style={{
        position: 'fixed',
        bottom: 20,
        left: 16,
        zIndex: 10,
      }}>
        <InnerWeather weather={weather} />
      </div>
      <Suspense fallback={null}><CrisisResources visible={isGrounding} /></Suspense>
      {isSessionRoute && (
        <Suspense fallback={<EditorSkeleton />}>
          <SessionView
            sessionId={sessionIdFromPath}
            openingMethod="auto"
            onSessionCreated={(id) => {
              window.history.replaceState(null, '', `/session/${id}`)
              setRoutePath(`/session/${id}`)
            }}
            onBack={() => navigateTo('/session/new')}
          />
        </Suspense>
      )}
    </>
  )
}

export default App
