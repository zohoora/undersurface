import { useState, useEffect, useCallback, useRef } from 'react'
import { BreathingBackground } from './components/Atmosphere/BreathingBackground'
import { CursorGlow } from './components/Atmosphere/CursorGlow'
import { LivingEditor } from './components/Editor/LivingEditor'
import { EntriesList } from './components/Sidebar/EntriesList'
import { LoginScreen } from './components/LoginScreen'
import { AnnouncementBanner } from './components/AnnouncementBanner'
import { AdminDashboard } from './admin/AdminDashboard'
import { useAuth } from './auth/useAuth'
import { initializeDB, db, generateId } from './store/db'
import { spellEngine } from './engine/spellEngine'
import { ReflectionEngine } from './engine/reflectionEngine'
import { useSettings } from './store/settings'
import { initGlobalConfig, useGlobalConfig } from './store/globalConfig'
import type { EmotionalTone, Part } from './types'

const ADMIN_EMAILS = ['zohoora@gmail.com']

function App() {
  const { user, loading } = useAuth()
  const [isReady, setIsReady] = useState(false)
  const [activeEntryId, setActiveEntryId] = useState<string>('')
  const [initialContent, setInitialContent] = useState('')
  const [emotion, setEmotion] = useState<EmotionalTone>('neutral')
  const [activePartColor, setActivePartColor] = useState<string | null>(null)
  const settings = useSettings()
  const globalConfig = useGlobalConfig()
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latestContentRef = useRef({ html: '', text: '' })
  const reflectionEngineRef = useRef(new ReflectionEngine())

  // Initialize DB and load or create first entry
  useEffect(() => {
    if (!user) return

    const init = async () => {
      initGlobalConfig()
      await initializeDB()
      spellEngine.init()

      // Get most recent entry or create one
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
      setIsReady(true)
    }
    init()
  }, [user])

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

    const entry = await db.entries.get(id) as { id: string; content: string } | undefined
    if (entry) {
      setActiveEntryId(id)
      setInitialContent(entry.content)
    }
  }, [activeEntryId, triggerReflection])

  const handleNewEntry = useCallback((id: string) => {
    // Trigger reflection on outgoing entry (async, non-blocking)
    triggerReflection(activeEntryId)

    setActiveEntryId(id)
    setInitialContent('')
  }, [activeEntryId, triggerReflection])

  const handleEmotionChange = useCallback((newEmotion: EmotionalTone) => {
    setEmotion(newEmotion)
  }, [])

  const handleActivePartColorChange = useCallback((color: string | null) => {
    setActivePartColor(color)
  }, [])

  // Loading state
  if (loading) {
    return (
      <div style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#FAF8F5',
      }}>
        <div style={{
          fontFamily: "'Inter', sans-serif",
          fontSize: 13,
          color: '#A09A94',
          letterSpacing: '0.1em',
        }}>
          undersurface
        </div>
      </div>
    )
  }

  // Auth gate
  if (!user) {
    return <LoginScreen />
  }

  // Admin routing — before DB init so admin page stays lightweight
  if (window.location.pathname.startsWith('/admin')) {
    if (ADMIN_EMAILS.includes(user.email || '')) {
      return <AdminDashboard />
    }
    window.history.replaceState(null, '', '/')
  }

  // Initializing DB
  if (!isReady) {
    return (
      <div style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#FAF8F5',
      }}>
        <div style={{
          fontFamily: "'Inter', sans-serif",
          fontSize: 13,
          color: '#A09A94',
          letterSpacing: '0.1em',
        }}>
          undersurface
        </div>
      </div>
    )
  }

  const visualEffectsEnabled = globalConfig?.features?.visualEffectsEnabled !== false

  return (
    <>
      <AnnouncementBanner />
      <a href="#editor" className="skip-to-content">Skip to editor</a>
      <BreathingBackground emotion={emotion} enabled={settings.breathingBackground && visualEffectsEnabled} />
      <CursorGlow partTint={activePartColor} />
      <EntriesList
        activeEntryId={activeEntryId}
        onSelectEntry={handleSelectEntry}
        onNewEntry={handleNewEntry}
      />
      <LivingEditor
        key={activeEntryId}
        entryId={activeEntryId}
        initialContent={initialContent}
        onContentChange={handleContentChange}
        onEmotionChange={handleEmotionChange}
        onActivePartColorChange={handleActivePartColorChange}
        settings={settings}
      />
    </>
  )
}

export default App
