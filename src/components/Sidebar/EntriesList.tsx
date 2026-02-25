import { useState, useCallback, useEffect, useMemo, lazy, Suspense } from 'react'
import { db } from '../../store/db'
import { SettingsPanel } from './SettingsPanel'
import { useTranslation, getLanguageCode } from '../../i18n'
import { useGlobalConfig } from '../../store/globalConfig'
import type { Session } from '../../types'

const BodyMapTab = lazy(() => import('../BodyMap/BodyMapTab').then(m => ({ default: m.BodyMapTab })))

interface Props {
  activeEntryId: string
  onSelectEntry: (id: string) => void
  navigateTo: (path: string) => void
  currentPath: string
}

interface Entry {
  id: string
  plainText: string
  title?: string
  favorited?: boolean
  updatedAt: number
}

type SidebarItem =
  | { kind: 'entry'; id: string; timestamp: number; preview: string; favorited?: boolean; title?: string }
  | { kind: 'session'; id: string; timestamp: number; preview: string; status: 'active' | 'closed'; favorited?: boolean }

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

export function EntriesList({ activeEntryId, onSelectEntry, navigateTo, currentPath }: Props) {
  const [isOpen, setIsOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [entries, setEntries] = useState<Entry[]>([])
  const [activeTab, setActiveTab] = useState<'entries' | 'body'>('entries')
  const [searchQuery, setSearchQuery] = useState('')
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false)
  const [sessions, setSessions] = useState<Session[]>([])
  const isMobile = useIsMobile()
  const t = useTranslation()
  const globalConfig = useGlobalConfig()
  const showBodyMap = globalConfig?.features?.bodyMap === true

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

  // Load sessions on same interval as entries
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const data = await db.sessions.orderBy('startedAt').reverse().toArray()
      if (!cancelled) setSessions(data as unknown as Session[])
    }
    load()
    const interval = setInterval(load, 60_000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [activeEntryId])

  const handleSelect = useCallback(
    (id: string) => {
      if (currentPath !== '/') navigateTo('/')
      onSelectEntry(id)
      if (isMobile) setIsOpen(false)
    },
    [onSelectEntry, isMobile, currentPath, navigateTo],
  )

  const handleToggleFavorite = useCallback(async (e: React.MouseEvent, entry: Entry) => {
    e.stopPropagation()
    await db.entries.update(entry.id, { favorited: !entry.favorited })
    setEntries(prev => prev.map(ent =>
      ent.id === entry.id ? { ...ent, favorited: !ent.favorited } : ent
    ))
  }, [])

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

  const getPreview = (entry: Entry) => {
    if (entry.title) return entry.title
    if (!entry.plainText) return t['entries.empty']
    return entry.plainText.slice(0, 40) + (entry.plainText.length > 40 ? '...' : '')
  }

  const getSessionPreview = (session: Session) => {
    const text = session.sessionNote || session.firstLine
    if (!text) return t['sessions.title']
    return text.slice(0, 40) + (text.length > 40 ? '...' : '')
  }

  const handleSelectSession = (id: string) => {
    navigateTo('/session/' + id)
    if (isMobile) setIsOpen(false)
  }

  const sidebarItems = useMemo(() => {
    const entryItems: SidebarItem[] = entries
      .filter(e => e.plainText?.trim() || e.id === activeEntryId)
      .map(e => ({
        kind: 'entry' as const,
        id: e.id,
        timestamp: e.updatedAt,
        preview: getPreview(e),
        favorited: e.favorited,
        title: e.title,
      }))

    const sessionItems: SidebarItem[] = sessions.map(s => ({
      kind: 'session' as const,
      id: s.id,
      timestamp: s.startedAt,
      preview: getSessionPreview(s),
      status: s.status,
      favorited: s.favorited,
    }))

    let merged = [...entryItems, ...sessionItems]

    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      merged = merged.filter(item => item.preview.toLowerCase().includes(q))
    }
    if (showFavoritesOnly) {
      merged = merged.filter(item => item.favorited)
    }

    merged.sort((a, b) => b.timestamp - a.timestamp)
    return merged
  }, [entries, sessions, searchQuery, showFavoritesOnly, activeEntryId])

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
              <div className="sidebar-new-buttons">
                <button className="new-entry-btn" onClick={() => { navigateTo('/new'); if (isMobile) setIsOpen(false) }}>
                  {t['entries.newShort']}
                </button>
              </div>

              {/* Search & filter toolbar */}
              <div className="sidebar-search-toolbar">
                <div className="sidebar-search-wrap">
                  <svg className="sidebar-search-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <circle cx="6.5" cy="6.5" r="4.5" />
                    <line x1="10" y1="10" x2="14" y2="14" />
                  </svg>
                  <input
                    className="sidebar-search-input"
                    type="text"
                    placeholder={t['entries.search']}
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                  />
                  {searchQuery && (
                    <button
                      className="sidebar-search-clear"
                      onClick={() => setSearchQuery('')}
                      aria-label="Clear search"
                    >
                      {'\u2715'}
                    </button>
                  )}
                </div>
                <button
                  className={`sidebar-favorites-toggle ${showFavoritesOnly ? 'active' : ''}`}
                  onClick={() => setShowFavoritesOnly(f => !f)}
                  title={t['entries.favorites']}
                >
                  {'\u2605'}
                </button>
              </div>

              <div style={{ marginTop: 4 }}>
                {sidebarItems.length === 0 && (searchQuery || showFavoritesOnly) ? (
                  <div className="sidebar-no-results">{t['entries.noResults']}</div>
                ) : (
                  sidebarItems.map((item) => item.kind === 'entry' ? (
                    <div
                      key={item.id}
                      className={`entry-item ${item.id === activeEntryId ? 'active' : ''}`}
                      onClick={() => handleSelect(item.id)}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div style={{ fontSize: 11, opacity: 0.5, marginBottom: 2 }}>
                          {formatDate(item.timestamp)}
                        </div>
                        <button
                          className={`entry-star-btn ${item.favorited ? 'active' : ''}`}
                          onClick={(e) => {
                            e.stopPropagation()
                            handleToggleFavorite(e, { id: item.id, favorited: item.favorited } as Entry)
                          }}
                          aria-label={item.favorited ? 'Remove from favorites' : 'Add to favorites'}
                        >
                          {item.favorited ? '\u2605' : '\u2606'}
                        </button>
                      </div>
                      {item.preview}
                    </div>
                  ) : (
                    <div
                      key={item.id}
                      className={`entry-item session-item ${currentPath === '/session/' + item.id ? 'active' : ''}`}
                      onClick={() => handleSelectSession(item.id)}
                      style={{ opacity: item.status === 'closed' ? 0.7 : 1 }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div style={{ fontSize: 11, opacity: 0.5, marginBottom: 2 }}>
                          {formatDate(item.timestamp)}
                        </div>
                        {item.status === 'active' && (
                          <div style={{
                            width: 6,
                            height: 6,
                            borderRadius: '50%',
                            background: 'var(--text-secondary)',
                            opacity: 0.6,
                          }} />
                        )}
                      </div>
                      <span className="session-item-label">
                        <svg viewBox="0 0 16 16" fill="currentColor" width="11" height="11" style={{ opacity: 0.45, marginRight: 4, verticalAlign: -1 }}>
                          <path d="M2 2.5A2.5 2.5 0 0 1 4.5 0h7A2.5 2.5 0 0 1 14 2.5v7a2.5 2.5 0 0 1-2.5 2.5H7l-3.5 3.5V12H4.5A2.5 2.5 0 0 1 2 9.5v-7z" />
                        </svg>
                        {item.preview}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </div>
        <SettingsPanel isOpen={settingsOpen} onToggle={() => setSettingsOpen((o) => !o)} />
      </div>
    </>
  )
}
