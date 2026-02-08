import { useState, useEffect, useCallback, useRef } from 'react'
import { BreathingBackground } from './components/Atmosphere/BreathingBackground'
import { CursorGlow } from './components/Atmosphere/CursorGlow'
import { LivingEditor } from './components/Editor/LivingEditor'
import { EntriesList } from './components/Sidebar/EntriesList'
import { initializeDB, db, generateId } from './store/db'
import { spellEngine } from './engine/spellEngine'
import { useSettings } from './store/settings'
import type { EmotionalTone } from './types'

function App() {
  const [isReady, setIsReady] = useState(false)
  const [activeEntryId, setActiveEntryId] = useState<string>('')
  const [initialContent, setInitialContent] = useState('')
  const [emotion, setEmotion] = useState<EmotionalTone>('neutral')
  const [activePartColor, setActivePartColor] = useState<string | null>(null)
  const settings = useSettings()
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latestContentRef = useRef({ html: '', text: '' })

  // Initialize DB and load or create first entry
  useEffect(() => {
    const init = async () => {
      await initializeDB()
      spellEngine.init()

      // Get most recent entry or create one
      const entries = await db.entries.orderBy('updatedAt').reverse().toArray()
      if (entries.length > 0) {
        setActiveEntryId(entries[0].id)
        setInitialContent(entries[0].content)
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
  }, [])

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

  const handleSelectEntry = useCallback(async (id: string) => {
    // Save current first
    if (latestContentRef.current.html) {
      await db.entries.update(activeEntryId, {
        content: latestContentRef.current.html,
        plainText: latestContentRef.current.text,
        updatedAt: Date.now(),
      })
    }

    const entry = await db.entries.get(id)
    if (entry) {
      setActiveEntryId(id)
      setInitialContent(entry.content)
    }
  }, [activeEntryId])

  const handleNewEntry = useCallback((id: string) => {
    setActiveEntryId(id)
    setInitialContent('')
  }, [])

  const handleEmotionChange = useCallback((newEmotion: EmotionalTone) => {
    setEmotion(newEmotion)
  }, [])

  const handleActivePartColorChange = useCallback((color: string | null) => {
    setActivePartColor(color)
  }, [])

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

  return (
    <>
      <BreathingBackground emotion={emotion} enabled={settings.breathingBackground} />
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
