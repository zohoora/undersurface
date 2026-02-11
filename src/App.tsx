import { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react'
import { BreathingBackground } from './components/Atmosphere/BreathingBackground'
import { CursorGlow } from './components/Atmosphere/CursorGlow'
import { EntriesList } from './components/Sidebar/EntriesList'
import { LoginScreen } from './components/LoginScreen'
import { AnnouncementBanner } from './components/AnnouncementBanner'
import { useAuth } from './auth/useAuth'
import { initializeDB, db, generateId } from './store/db'

const AdminDashboard = lazy(() => import('./admin/AdminDashboard'))
const LivingEditor = lazy(() => import('./components/Editor/LivingEditor'))
import { spellEngine } from './engine/spellEngine'
import { ReflectionEngine } from './engine/reflectionEngine'
import { useSettings } from './store/settings'
import { initGlobalConfig, useGlobalConfig, useNewVersionAvailable } from './store/globalConfig'
import { useTheme } from './hooks/useTheme'
import { useTimeAwarePalette } from './hooks/useTimeAwarePalette'
import { useSeasonalPalette } from './hooks/useSeasonalPalette'
import { useFlowState } from './hooks/useFlowState'
import { useHandwritingMode } from './hooks/useHandwritingMode'
import { useGroundingMode } from './hooks/useGroundingMode'
import { InnerWeather } from './components/InnerWeather'
import { WeatherEngine } from './engine/weatherEngine'
import { RitualEngine } from './engine/ritualEngine'
import { IntentionInput } from './components/Editor/IntentionInput'
import { ExplorationCard } from './components/Editor/ExplorationCard'
import { Onboarding } from './components/Onboarding'
import { CrisisResources } from './components/CrisisResources'
import { SessionClosing } from './components/SessionClosing'
import { chatCompletion } from './ai/openrouter'
import { trackEvent } from './services/analytics'
import type { EmotionalTone, Part, GuidedExploration, InnerWeather as InnerWeatherType } from './types'

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
        A diary where inner voices respond as you write
      </div>
    </div>
  )
}

function App() {
  const { user, loading } = useAuth()
  const [isReady, setIsReady] = useState(false)
  const [initError, setInitError] = useState<string | null>(null)
  const [hasConsent, setHasConsent] = useState<boolean | null>(null)
  const [activeEntryId, setActiveEntryId] = useState<string>('')
  const [initialContent, setInitialContent] = useState('')
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
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latestContentRef = useRef({ html: '', text: '' })
  const reflectionEngineRef = useRef(new ReflectionEngine())
  const weatherEngineRef = useRef(new WeatherEngine())
  const ritualEngineRef = useRef(new RitualEngine())
  const fossilEngineRef = useRef<InstanceType<typeof import('./engine/fossilEngine').FossilEngine> | null>(null)
  const explorationEngineRef = useRef<InstanceType<typeof import('./engine/explorationEngine').ExplorationEngine> | null>(null)
  const [weather, setWeather] = useState<InnerWeatherType | null>(null)
  const [fossilThought, setFossilThought] = useState<{ partName: string; partColor: string; colorLight: string; content: string } | null>(null)
  const [intention, setIntention] = useState('')
  const [explorations, setExplorations] = useState<GuidedExploration[]>([])
  const [closingPhrase, setClosingPhrase] = useState<string | null>(null)
  const [closingLoading, setClosingLoading] = useState(false)

  // Load most recent entry or create a blank one
  const loadOrCreateEntry = useCallback(async () => {
    const entries = await db.entries.orderBy('updatedAt').reverse().toArray()
    if (entries.length > 0) {
      const entry = entries[0] as { id: string; content: string }
      setActiveEntryId(entry.id)
      setInitialContent(entry.content)
    } else {
      const id = generateId()
      await db.entries.add({
        id,
        content: '',
        plainText: '',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
      setActiveEntryId(id)
      setInitialContent('')
    }
  }, [])

  // Initialize DB and load or create first entry
  useEffect(() => {
    if (!user) return

    const init = async () => {
      try {
        initGlobalConfig()
        await initializeDB()

        // Check consent before proceeding
        const consentDoc = await db.consent.get('terms')
        if (!consentDoc || (consentDoc as { acceptedVersion?: string }).acceptedVersion !== '1.0') {
          setHasConsent(false)
          return
        }
        setHasConsent(true)

        spellEngine.init()
        await loadOrCreateEntry()
        setIsReady(true)
        trackEvent('app_launch')
      } catch (error) {
        console.error('Init failed:', error)
        setInitError(error instanceof Error ? error.message : 'Failed to initialize. Please try again.')
      }
    }
    init()
  }, [user, loadOrCreateEntry])

  // Log session start/end
  useEffect(() => {
    if (!isReady) return
    const ritualEngine = ritualEngineRef.current
    return () => {
      const text = latestContentRef.current.text
      const wordCount = text ? text.split(/\s+/).filter(Boolean).length : 0
      ritualEngine.logSession(wordCount).catch(console.error)
    }
  }, [isReady])

  // Auto-save with debounce
  const handleContentChange = useCallback(
    (content: string, plainText: string) => {
      latestContentRef.current = { html: content, text: plainText }

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

  const triggerReflection = useCallback((entryIdToReflect: string) => {
    db.parts.toArray()
      .then((parts) => reflectionEngineRef.current.reflect(entryIdToReflect, parts as Part[]))
      .catch((error) => console.error('Reflection error:', error))
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

    const entry = await db.entries.get(id) as { id: string; content: string; intention?: string; createdAt?: number } | undefined
    if (entry) {
      setActiveEntryId(id)
      setInitialContent(entry.content)
      setIntention(entry.intention || '')
      setExplorations([])
      const ageDays = entry.createdAt ? Math.floor((Date.now() - entry.createdAt) / 86400000) : 0
      trackEvent('entry_switch', { entry_age_days: ageDays })

      // Fossil check for old entries
      setFossilThought(null)
      const entryCreatedAt = (entry as { createdAt?: number }).createdAt
      if (entryCreatedAt) {
        db.parts.toArray().then(async (parts) => {
          if (!fossilEngineRef.current) {
            const { FossilEngine } = await import('./engine/fossilEngine')
            fossilEngineRef.current = new FossilEngine()
          }
          const fossil = await fossilEngineRef.current.checkForFossil(id, entryCreatedAt, parts as Part[])
          if (fossil) {
            const part = (parts as Part[]).find(p => p.id === fossil.partId)
            if (part) {
              setFossilThought({
                partName: part.name,
                partColor: part.color,
                colorLight: part.colorLight,
                content: fossil.commentary,
              })
              trackEvent('fossil_shown', { part_name: part.name })
              setTimeout(() => setFossilThought(null), 30000)
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
    const wordCount = text ? text.split(/\s+/).filter(Boolean).length : 0
    trackEvent('session_close', { word_count: wordCount })
    const snippet = text.slice(-600) || 'The writer opened a blank page today.'

    try {
      const phrase = await chatCompletion([
        {
          role: 'system',
          content: `You are The Weaver — a warm, pattern-seeing inner voice. The writer is finishing their session. Offer one brief, warm closing thought (1-2 sentences). Be soothing and loving. Reference something specific from what they wrote — a thread, an image, a feeling. Don't summarize. Don't give advice. Just leave them with something gentle to carry. Speak directly to them. No quotes around your words.`,
        },
        { role: 'user', content: snippet },
      ], 15000, 80)
      setClosingPhrase(phrase.trim())
    } catch {
      setClosingPhrase('You showed up today. That matters.')
    }
  }, [activeEntryId])

  const handleDismissClosing = useCallback(() => {
    setClosingLoading(false)
    setClosingPhrase(null)
  }, [])

  const prevEmotionRef = useRef(emotion)
  const handleEmotionChange = useCallback((newEmotion: EmotionalTone) => {
    if (newEmotion !== prevEmotionRef.current) trackEvent('emotion_shift', { from: prevEmotionRef.current, to: newEmotion })
    prevEmotionRef.current = newEmotion
    setEmotion(newEmotion)
    weatherEngineRef.current.recordEmotion(newEmotion)
    const w = weatherEngineRef.current.getWeather()
    if (w) setWeather(w)
    if (weatherEngineRef.current.shouldPersist()) {
      weatherEngineRef.current.persist().catch(console.error)
    }
  }, [])

  const handleActivePartColorChange = useCallback((color: string | null) => {
    setActivePartColor(color)
  }, [])

  // Loading state
  if (loading) {
    return <SplashScreen />
  }

  // Auth gate
  if (!user) {
    return <LoginScreen />
  }

  // Admin routing — before DB init so admin page stays lightweight
  if (window.location.pathname.startsWith('/admin')) {
    if (ADMIN_EMAILS.includes(user.email || '')) {
      return <Suspense fallback={<SplashScreen />}><AdminDashboard /></Suspense>
    }
    window.history.replaceState(null, '', '/')
  }

  // 404 — redirect unknown paths to root
  if (window.location.pathname !== '/' && !window.location.pathname.startsWith('/admin')) {
    window.history.replaceState(null, '', '/')
  }

  // Consent gate — show onboarding if user hasn't accepted terms
  if (hasConsent === false) {
    const handleOnboardingComplete = async () => {
      setHasConsent(true)
      spellEngine.init()
      await loadOrCreateEntry()
      setIsReady(true)
      trackEvent('onboarding_complete')
    }
    return <Onboarding onComplete={handleOnboardingComplete} />
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
          Something went wrong
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
          Try again
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
          New version available — tap to refresh
        </div>
      )}
      <a href="#editor" className="skip-to-content">Skip to editor</a>
      <BreathingBackground emotion={emotion} enabled={visualEffectsEnabled && globalConfig?.features?.breathingBackground !== false} />
      <CursorGlow partTint={activePartColor} />
      <EntriesList
        activeEntryId={activeEntryId}
        onSelectEntry={handleSelectEntry}
        onNewEntry={handleNewEntry}
      />
      <div style={{
        position: 'fixed',
        bottom: 20,
        left: 16,
        zIndex: 10,
      }}>
        <InnerWeather weather={weather} />
      </div>
      <CrisisResources visible={isGrounding} />
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
            <div className="fossil-label">from the archive</div>
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
      <div style={{
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
          {globalConfig?.features?.intentionsEnabled === true && (
            <IntentionInput value={intention} onChange={handleIntentionChange} />
          )}
        </div>
        <button
          className="session-close-trigger"
          onClick={handleSessionClose}
        >
          close session
        </button>
      </div>
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
        />
      </Suspense>
      {/* Session closing overlay */}
      {(closingLoading || closingPhrase) && (
        <SessionClosing
          phrase={closingPhrase}
          loading={closingLoading}
          onClose={handleDismissClosing}
        />
      )}
    </>
  )
}

export default App
