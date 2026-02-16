import { useState, useCallback, useEffect, lazy, Suspense } from 'react'
import { db, generateId } from '../../store/db'
import { SettingsPanel } from './SettingsPanel'
import { useTranslation, getLanguageCode } from '../../i18n'
import { useGlobalConfig } from '../../store/globalConfig'

const BodyMapTab = lazy(() => import('../BodyMap/BodyMapTab').then(m => ({ default: m.BodyMapTab })))

interface Props {
  activeEntryId: string
  onSelectEntry: (id: string) => void
  onNewEntry: (id: string) => void
}

interface Entry {
  id: string
  plainText: string
  updatedAt: number
}

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.innerWidth <= 768,
  )

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)')
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  return isMobile
}

export function EntriesList({ activeEntryId, onSelectEntry, onNewEntry }: Props) {
  const [isOpen, setIsOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [entries, setEntries] = useState<Entry[]>([])
  const [activeTab, setActiveTab] = useState<'entries' | 'body'>('entries')
  const isMobile = useIsMobile()
  const t = useTranslation()
  const globalConfig = useGlobalConfig()
  const showBodyMap = globalConfig?.features?.bodyMap === true

  const loadEntries = useCallback(async () => {
    const data = await db.entries.orderBy('updatedAt').reverse().toArray()
    setEntries(data as Entry[])
  }, [])

  // Initial load + infrequent fallback refresh (60s instead of 3s)
  // Refresh on activeEntryId change (entry switches and content saves)
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const data = await db.entries.orderBy('updatedAt').reverse().toArray()
      if (!cancelled) setEntries(data as Entry[])
    }
    load()
    const interval = setInterval(load, 60_000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [activeEntryId])

  const handleNewEntry = async () => {
    const id = generateId()
    await db.entries.add({
      id,
      content: '',
      plainText: '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    onNewEntry(id)
    loadEntries()
    if (isMobile) setIsOpen(false)
  }

  const handleSelect = useCallback(
    (id: string) => {
      onSelectEntry(id)
      if (isMobile) setIsOpen(false)
    },
    [onSelectEntry, isMobile],
  )

  const formatDate = (timestamp: number) => {
    const d = new Date(timestamp)
    const now = new Date()
    const isToday = d.toDateString() === now.toDateString()
    const yesterday = new Date(now)
    yesterday.setDate(yesterday.getDate() - 1)
    const isYesterday = d.toDateString() === yesterday.toDateString()

    if (isToday) return t['entries.today']
    if (isYesterday) return t['entries.yesterday']
    return d.toLocaleDateString(getLanguageCode(), { month: 'short', day: 'numeric' })
  }

  const getPreview = (plainText: string) => {
    if (!plainText) return t['entries.empty']
    return plainText.slice(0, 40) + (plainText.length > 40 ? '...' : '')
  }

  return (
    <>
      {/* Mobile toggle button */}
      {isMobile && (
        <button
          className="sidebar-toggle"
          onClick={() => setIsOpen((o) => !o)}
          aria-label="Toggle entries"
        >
          {isOpen ? '\u2715' : '\u2630'}
        </button>
      )}

      {/* Backdrop overlay for mobile */}
      {isMobile && (
        <div
          className={`sidebar-backdrop ${isOpen ? 'visible' : ''}`}
          onClick={() => setIsOpen(false)}
        />
      )}

      <div
        className={`entries-sidebar ${isMobile && isOpen ? 'open' : ''}`}
        onMouseLeave={() => setSettingsOpen(false)}
      >
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', opacity: settingsOpen ? 0.15 : 1, transition: 'opacity 0.25s ease', pointerEvents: settingsOpen ? 'none' : 'auto' }}>
          {showBodyMap ? (
            <div className="sidebar-tab-bar">
              <button
                className={`sidebar-tab ${activeTab === 'entries' ? 'active' : ''}`}
                onClick={() => setActiveTab('entries')}
              >
                {t['entries.title']}
              </button>
              <button
                className={`sidebar-tab ${activeTab === 'body' ? 'active' : ''}`}
                onClick={() => setActiveTab('body')}
              >
                {t['bodyMap.title']}
              </button>
            </div>
          ) : (
            <div className="sidebar-label">{t['entries.title']}</div>
          )}

          {activeTab === 'body' && showBodyMap ? (
            <Suspense fallback={null}>
              <BodyMapTab />
            </Suspense>
          ) : (
            <>
              <button className="new-entry-btn" onClick={handleNewEntry}>
                {t['entries.new']}
              </button>
              <div style={{ marginTop: 8 }}>
                {entries?.filter((e) => e.plainText?.trim() || e.id === activeEntryId).map((entry) => (
                  <div
                    key={entry.id}
                    className={`entry-item ${entry.id === activeEntryId ? 'active' : ''}`}
                    onClick={() => handleSelect(entry.id)}
                  >
                    <div style={{ fontSize: 11, opacity: 0.5, marginBottom: 2 }}>
                      {formatDate(entry.updatedAt)}
                    </div>
                    {getPreview(entry.plainText)}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
        <SettingsPanel isOpen={settingsOpen} onToggle={() => setSettingsOpen((o) => !o)} />
      </div>
    </>
  )
}
