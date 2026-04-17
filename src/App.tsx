import { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react'
import { BreathingBackground } from './components/Atmosphere/BreathingBackground'
import { CursorGlow } from './components/Atmosphere/CursorGlow'
import { BilateralPulse } from './components/Atmosphere/BilateralPulse'
import { EntriesList } from './components/Sidebar/EntriesList'
import { LoginScreen } from './components/LoginScreen'
import { AnnouncementBanner } from './components/AnnouncementBanner'
import { useAuth } from './auth/useAuth'
import { initializeDB, db, generateId } from './store/db'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function lazyWithRetry<T extends React.ComponentType<any>>(factory: () => Promise<{ default: T }>) {
  return lazy(() => factory().catch(() => {
    // Stale chunk after deployment — reload to get new assets
    window.location.reload()
    return new Promise<{ default: T }>(() => {}) // never resolves; reload takes over
  }))
}

const AdminDashboard = lazyWithRetry(() => import('./admin/AdminDashboard'))
const LivingEditor = lazyWithRetry(() => import('./components/Editor/LivingEditor'))
const SessionView = lazyWithRetry(() => import('./components/Session/SessionView'))
import type { ReflectionEngine } from './engine/reflectionEngine'
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
import { IntentionInput } from './components/Editor/IntentionInput'
import { ExplorationCard } from './components/Editor/ExplorationCard'
const Onboarding = lazyWithRetry(() => import('./components/Onboarding').then(m => ({ default: m.Onboarding })))
const EntryChoice = lazyWithRetry(() => import('./components/EntryChoice').then(m => ({ default: m.EntryChoice })))
const CrisisResources = lazyWithRetry(() => import('./components/CrisisResources').then(m => ({ default: m.CrisisResources })))
const SessionClosing = lazyWithRetry(() => import('./components/SessionClosing').then(m => ({ default: m.SessionClosing })))
import { trackEvent } from './services/analytics'
import { t, useTranslation, getPartDisplayName } from './i18n'
import { getSettings } from './store/settings'
import type { EmotionalTone, GuidedExploration, InnerWeather as InnerWeatherType } from './types'

const ADMIN_EMAILS = ['zohoora@gmail.com']

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
  const [activeEntryId, setActiveEntryId] = useState<string>('')
  const [initialContent, setInitialContent] = useState('')
  const [isEditorBlank, setIsEditorBlank] = useState(true)
  const [emotion, setEmotion] = useState<EmotionalTone>('neutral')
  const [activePartColor, setActivePartColor] = useState<string | null>(null)
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

  // Sync route state with browser back/forward
  useEffect(() => {
    const handler = () => setRoutePath(window.location.pathname)
    window.addEventListener('popstate', handler)
    return () => window.removeEventListener('popstate', handler)
  }, [])

  const navigateTo = useCallback((path: string) => {
    window.history.pushState(null, '', path)
    setRoutePath(path)
  }, [])

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latestContentRef = useRef({ html: '', text: '' })
  const reflectionEngineRef = useRef<InstanceType<typeof ReflectionEngine> | null>(null)
  const weatherEngine = getWeatherEngine()
  const ritualEngineRef = useRef<InstanceType<typeof RitualEngine> | null>(null)
  const fossilEngineRef = useRef<InstanceType<typeof import('./engine/fossilEngine').FossilEngine> | null>(null)
  const fossilTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const explorationEngineRef = useRef<InstanceType<typeof import('./engine/explorationEngine').ExplorationEngine> | null>(null)
  const [weather, setWeather] = useState<InnerWeatherType | null>(null)
  const [fossilThought, setFossilThought] = useState<{ partName: string; partColor: string; colorLight: string; content: string } | null>(null)
  const [intention, setIntention] = useState('')
  const [explorations, setExplorations] = useState<GuidedExploration[]>([])
  const [closingPhrase, setClosingPhrase] = useState<string | null>(null)
  const [closingLoading, setClosingLoading] = useState(false)
  const readyAtRef = useRef(0)
  const firstKeystrokeTrackedRef = useRef(false)
  const [lastUsedType, setLastUsedType] = useState<'journal' | 'conversation' | null>(null)

  // Determine last-used type when entering choice screen
  useEffect(() => {
    if (routePath !== '/new') return
    let cancelled = false
    ;(async () => {
      const entries = await db.entries.orderBy('updatedAt').reverse().toArray()
      const sessions = await db.sessions.orderBy('startedAt').reverse().toArray()
      if (cancelled) return
      const latestEntry = entries[0]
      const latestSession = sessions[0]
      if (!latestEntry && !latestSession) { setLastUsedType(null); return }
      if (!latestSession) { setLastUsedType('journal'); return }
      if (!latestEntry) { setLastUsedType('conversation'); return }
      setLastUsedType(latestEntry.updatedAt >= latestSession.startedAt ? 'journal' : 'conversation')
    })()
    return () => { cancelled = true }
  }, [routePath])

  // Initialize DB, load entry, and route based on today's activity
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
        const isRootVisit = window.location.pathname === '/'

        const [entries, sessions] = await Promise.all([
          db.entries.orderBy('updatedAt').reverse().toArray(),
          isRootVisit ? db.sessions.orderBy('startedAt').reverse().toArray() : Promise.resolve([]),
        ])

        // Load today's entry, or fall back to most recent for editor state
        const todayEntry = entries.find(e => isFromToday(e.createdAt))
        const entryToLoad = todayEntry ?? entries[0]
        if (entryToLoad) {
          setActiveEntryId(entryToLoad.id)
          setInitialContent(entryToLoad.content)
        }

        // Smart resume: on initial root visit, redirect based on today's activity
        // A blank entry (e.g. auto-created after session dismissal) doesn't count —
        // the user hasn't actively chosen to write yet
        if (isRootVisit) {
          const todaySession = sessions.find(
            s => isFromToday(s.startedAt) && s.status === 'active'
          )
          const hasRealTodayEntry = todayEntry && (todayEntry.plainText?.trim() || todayEntry.content?.trim())

          if (todaySession) {
            const entryIsMoreRecent = hasRealTodayEntry && todayEntry.updatedAt >= todaySession.startedAt
            if (!entryIsMoreRecent) {
              const basePath = todaySession.mode === 'futureSelf' ? '/future-self' : '/session'
              navigateTo(`${basePath}/${todaySession.id}`)
            }
          } else if (!hasRealTodayEntry) {
            navigateTo('/new')
          }
        }

        readyAtRef.current = Date.now()
        firstKeystrokeTrackedRef.current = false
        setIsReady(true)
        trackEvent('app_launch')
      } catch (error) {
        console.error('Init failed:', error)
        setInitError(error instanceof Error ? error.message : 'Failed to initialize. Please try again.')
      }
    }
    init()
  }, [user]) // eslint-disable-line react-hooks/exhaustive-deps

  // Tear down global config listener on logout
  useEffect(() => {
    if (!user) {
      teardownGlobalConfig()
    }
  }, [user])

  // Log session start/end
  useEffect(() => {
    if (!isReady) return
    ;(async () => {
      if (!ritualEngineRef.current) {
        const { RitualEngine } = await import('./engine/ritualEngine')
        ritualEngineRef.current = new RitualEngine()
      }
    })()
    return () => {
      const text = latestContentRef.current.text
      const wordCount = text ? text.split(/\s+/).filter(Boolean).length : 0
      ritualEngineRef.current?.logSession(wordCount).catch(console.error)
    }
  }, [isReady])

  // Auto-save with debounce
  const handleContentChange = useCallback(
    (content: string, plainText: string) => {
      latestContentRef.current = { html: content, text: plainText }
      setIsEditorBlank(!plainText.trim())

      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      saveTimerRef.current = setTimeout(async () => {
        if (activeEntryId) {
          await db.entries.update(activeEntryId, {
            content: latestContentRef.current.html,
            plainText: latestContentRef.current.text,
            updatedAt: Date.now(),
          })
        }
      }, 1000)
    },
    [activeEntryId],
  )

  const triggerReflection = useCallback(async (entryIdToReflect: string) => {
    if (!reflectionEngineRef.current) {
      const { ReflectionEngine } = await import('./engine/reflectionEngine')
      reflectionEngineRef.current = new ReflectionEngine()
    }
    const parts = await db.parts.toArray()
    reflectionEngineRef.current.reflect(entryIdToReflect, parts)
      .catch((error: unknown) => console.error('Reflection error:', error))
  }, [])

  const handleSelectEntry = useCallback(async (id: string) => {
    // Save current first
    const outgoingEntryId = activeEntryId
    if (latestContentRef.current.html) {
      await db.entries.update(outgoingEntryId, {
        content: latestContentRef.current.html,
        plainText: latestContentRef.current.text,
        updatedAt: Date.now(),
      })
    }

    // Trigger reflection on outgoing entry (async, non-blocking)
    triggerReflection(outgoingEntryId)

    const entry = await db.entries.get(id)
    if (entry) {
      setActiveEntryId(id)
      setInitialContent(entry.content)
      setIsEditorBlank(!entry.content?.replace(/<[^>]*>/g, '').trim())
      setIntention(entry.intention || '')
      setExplorations([])
      const ageDays = entry.createdAt ? Math.floor((Date.now() - entry.createdAt) / 86400000) : 0
      trackEvent('entry_switch', { entry_age_days: ageDays })

      // Fossil check for old entries
      setFossilThought(null)
      const entryCreatedAt = entry.createdAt
      if (entryCreatedAt) {
        db.parts.toArray().then(async (parts) => {
          if (!fossilEngineRef.current) {
            const { FossilEngine } = await import('./engine/fossilEngine')
            fossilEngineRef.current = new FossilEngine()
          }
          const fossil = await fossilEngineRef.current.checkForFossil(id, entryCreatedAt, parts)
          if (fossil) {
            const part = parts.find(p => p.id === fossil.partId)
            if (part) {
              setFossilThought({
                partName: getPartDisplayName(part),
                partColor: part.color,
                colorLight: part.colorLight,
                content: fossil.commentary,
              })
              trackEvent('fossil_shown', { part_name: part.name })
              if (fossilTimerRef.current) clearTimeout(fossilTimerRef.current)
              fossilTimerRef.current = setTimeout(() => setFossilThought(null), 30000)
            }
          }
        }).catch(console.error)
      }
    }
  }, [activeEntryId, triggerReflection])

  const handleNewEntry = useCallback((id: string) => {
    // Trigger reflection on outgoing entry (async, non-blocking)
    triggerReflection(activeEntryId)

    setActiveEntryId(id)
    setInitialContent('')
    setIsEditorBlank(true)
    setIntention('')
    setExplorations([])
    trackEvent('new_entry')

    // Generate explorations for new blank entry (lazy-loaded)
    ;(async () => {
      if (!explorationEngineRef.current) {
        const { ExplorationEngine } = await import('./engine/explorationEngine')
        explorationEngineRef.current = new ExplorationEngine()
      }
      const engine = explorationEngineRef.current
      engine.reset()
      if (engine.shouldSuggest()) {
        const results = await engine.generateExplorations()
        if (results.length > 0) {
          setExplorations(results)
          trackEvent('exploration_shown', { count: results.length })
        }
      }
    })().catch(console.error)
  }, [activeEntryId, triggerReflection])

  // Entry choice screen handlers
  const handleChoiceJournal = useCallback((id: string) => {
    handleNewEntry(id)
    navigateTo('/')
  }, [handleNewEntry, navigateTo])

  const handleChoiceConversation = useCallback(() => {
    navigateTo('/session/new')
  }, [navigateTo])

  const handleChoiceFutureSelf = useCallback(() => {
    navigateTo('/future-self/new')
  }, [navigateTo])

  const handleIntentionChange = useCallback((newIntention: string) => {
    setIntention(newIntention)
    if (activeEntryId) {
      db.entries.update(activeEntryId, { intention: newIntention })
    }
    if (newIntention.trim()) trackEvent('intention_set')
  }, [activeEntryId])

  const handleSelectExploration = useCallback((exploration: GuidedExploration) => {
    handleIntentionChange(exploration.prompt)
    setExplorations([])
    trackEvent('exploration_selected', { source: 'new_entry' })
  }, [handleIntentionChange])

  const handleDismissExplorations = useCallback(() => {
    setExplorations([])
  }, [])

  const handleSessionClose = useCallback(async () => {
    setClosingLoading(true)
    setClosingPhrase(null)

    // Save current entry first
    if (activeEntryId && latestContentRef.current.html) {
      await db.entries.update(activeEntryId, {
        content: latestContentRef.current.html,
        plainText: latestContentRef.current.text,
        updatedAt: Date.now(),
      })
    }

    const text = latestContentRef.current.text.trim()
    trackEvent('session_close', { word_count: text ? text.split(/\s+/).filter(Boolean).length : 0 })

    try {
      const { generateClosingPhrase } = await import('./engine/closingEngine')
      const phrase = await generateClosingPhrase(text)
      setClosingPhrase(phrase)
    } catch {
      setClosingPhrase(tr['session.fallback'])
    }
  }, [activeEntryId, tr])

  const handleDismissClosing = useCallback(() => {
    setClosingLoading(false)
    setClosingPhrase(null)

    // Start a fresh entry after session ends
    const id = generateId()
    db.entries.add({
      id,
      content: '',
      plainText: '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }).then(() => {
      handleNewEntry(id)
    }).catch(console.error)
  }, [handleNewEntry])

  const prevEmotionRef = useRef(emotion)
  const handleEmotionChange = useCallback((newEmotion: EmotionalTone) => {
    if (newEmotion !== prevEmotionRef.current) trackEvent('emotion_shift', { from: prevEmotionRef.current, to: newEmotion })
    prevEmotionRef.current = newEmotion
    setEmotion(newEmotion)
    weatherEngine.recordEmotion(newEmotion)
    const w = weatherEngine.getWeather()
    if (w) setWeather(w)
    if (weatherEngine.shouldPersist()) {
      weatherEngine.persist().catch(console.error)
    }
  }, [])

  const handleActivePartColorChange = useCallback((color: string | null) => {
    setActivePartColor(color)
  }, [])

  // Redirect invalid routes (admin without permission, unknown paths)
  useEffect(() => {
    // Do not redirect while auth is still resolving — user?.email is legitimately
    // undefined during loading and must not be treated as "not admin"
    if (loading) return

    if (routePath.startsWith('/admin') && !ADMIN_EMAILS.includes(user?.email || '')) {
      window.history.replaceState(null, '', '/')
      setRoutePath('/')
    } else if (
      routePath !== '/' &&
      routePath !== '/new' &&
      !routePath.startsWith('/admin') &&
      !routePath.startsWith('/session') &&
      !routePath.startsWith('/future-self')
    ) {
      window.history.replaceState(null, '', '/')
      setRoutePath('/')
    }
  }, [routePath, user?.email, loading])

  // Loading state
  if (loading) {
    return <SplashScreen />
  }

  // Auth gate
  if (!user) {
    return <LoginScreen />
  }

  // Admin routing — before DB init so admin page stays lightweight
  const isAdminRoute = routePath.startsWith('/admin') && ADMIN_EMAILS.includes(user.email || '')
  if (isAdminRoute) {
    return <Suspense fallback={<SplashScreen />}><AdminDashboard /></Suspense>
  }

  // Route detection
  const isChoiceRoute = routePath === '/new'
  const isSessionRoute = routePath.startsWith('/session')
  const isFutureSelfRoute = routePath.startsWith('/future-self')
  const isNewSession = routePath === '/session/new'
  const isNewFutureSelf = routePath === '/future-self/new'
  const sessionIdFromPath = !isNewSession && routePath.startsWith('/session/')
    ? routePath.split('/session/')[1]
    : null
  const futureSelfIdFromPath = !isNewFutureSelf && routePath.startsWith('/future-self/')
    ? routePath.split('/future-self/')[1]
    : null

  // Consent gate — show onboarding if user hasn't accepted terms
  if (hasConsent === false) {
    const handleOnboardingComplete = async () => {
      setHasConsent(true)
      setIsReady(true)
      navigateTo('/new')
      trackEvent('onboarding_complete')
    }
    return <Suspense fallback={<SplashScreen />}><Onboarding onComplete={handleOnboardingComplete} /></Suspense>
  }

  // Init error — show retry screen
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

  // Initializing DB
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
      <BreathingBackground emotion={emotion} enabled={visualEffectsEnabled && globalConfig?.features?.breathingBackground !== false} />
      <CursorGlow partTint={activePartColor} />
      <BilateralPulse
        emotion={emotion}
        enabled={
          visualEffectsEnabled
          && globalConfig?.features?.bilateralStimulation === true
          && settings.bilateralStimulation !== false
        }
      />
      <EntriesList
        activeEntryId={activeEntryId}
        onSelectEntry={handleSelectEntry}
        navigateTo={navigateTo}
        currentPath={routePath}
      />
      <div style={{
        position: 'fixed',
        bottom: 20,
        left: 16,
        zIndex: 10,
      }}>
        <InnerWeather weather={weather} />
      </div>
      <Suspense fallback={null}><CrisisResources visible={isGrounding} /></Suspense>
      {isChoiceRoute ? (
        <Suspense fallback={null}>
          <EntryChoice
            onJournalCreated={handleChoiceJournal}
            onConversationChosen={handleChoiceConversation}
            onFutureSelfChosen={handleChoiceFutureSelf}
            lastUsedType={lastUsedType}
          />
        </Suspense>
      ) : isSessionRoute ? (
        <Suspense fallback={<EditorSkeleton />}>
          <SessionView
            sessionId={sessionIdFromPath}
            openingMethod="auto"
            mode="therapist"
            onSessionCreated={(id) => {
              window.history.replaceState(null, '', `/session/${id}`)
              setRoutePath(`/session/${id}`)
            }}
            onBack={() => navigateTo('/')}
          />
        </Suspense>
      ) : isFutureSelfRoute ? (
        <Suspense fallback={<EditorSkeleton />}>
          <SessionView
            sessionId={futureSelfIdFromPath}
            openingMethod="auto"
            mode="futureSelf"
            onSessionCreated={(id) => {
              window.history.replaceState(null, '', `/future-self/${id}`)
              setRoutePath(`/future-self/${id}`)
            }}
            onBack={() => navigateTo('/')}
          />
        </Suspense>
      ) : (
        <>
          {fossilThought && (
            <div style={{
              position: 'relative',
              zIndex: 2,
              maxWidth: 680,
              margin: '0 auto',
              padding: '0 40px',
            }}>
              <div
                className="part-thought fossil-thought"
                style={{
                  backgroundColor: fossilThought.colorLight,
                  borderLeft: `2px dotted ${fossilThought.partColor}`,
                  cursor: 'pointer',
                }}
                onClick={() => setFossilThought(null)}
              >
                <div className="fossil-label">{tr['app.fossilLabel']}</div>
                <div className="part-name" style={{ color: fossilThought.partColor }}>
                  {fossilThought.partName}
                </div>
                <div className="part-content" style={{ color: fossilThought.partColor }}>
                  {fossilThought.content}
                </div>
              </div>
            </div>
          )}
          {explorations.length > 0 && (
            <ExplorationCard
              explorations={explorations}
              onSelect={handleSelectExploration}
              onDismiss={handleDismissExplorations}
            />
          )}
          <div className="toolbar-row" style={{
            position: 'relative',
            zIndex: 2,
            maxWidth: 680,
            margin: '0 auto',
            padding: '0 40px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            minHeight: 28,
          }}>
            <div style={{ flex: 1 }}>
              {globalConfig?.features?.intentionsEnabled === true && (isEditorBlank || intention) && (
                <IntentionInput value={intention} onChange={handleIntentionChange} />
              )}
            </div>
          </div>
          <button
            className="session-close-trigger"
            onClick={handleSessionClose}
          >
            {tr['session.end']}
          </button>
          <Suspense fallback={<EditorSkeleton />}>
            <LivingEditor
              key={activeEntryId}
              entryId={activeEntryId}
              initialContent={initialContent}
              onContentChange={handleContentChange}
              onEmotionChange={handleEmotionChange}
              onActivePartColorChange={handleActivePartColorChange}
              settings={settings}
              intention={intention}
              onFirstKeystroke={() => {
                if (firstKeystrokeTrackedRef.current) return
                firstKeystrokeTrackedRef.current = true
                trackEvent('first_keystroke', {
                  seconds_to_first_keystroke: Math.round((Date.now() - readyAtRef.current) / 1000),
                })
              }}
            />
          </Suspense>
          {/* Session closing overlay */}
          {(closingLoading || closingPhrase) && (
            <Suspense fallback={null}>
              <SessionClosing
                phrase={closingPhrase}
                loading={closingLoading}
                onClose={handleDismissClosing}
              />
            </Suspense>
          )}
        </>
      )}
    </>
  )
}

export default App
