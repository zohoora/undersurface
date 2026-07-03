import { useState, useCallback, useEffect, useMemo, lazy, Suspense } from 'react'
import { db } from '../../store/db'
import { SettingsPanel } from './SettingsPanel'
import { useTranslation, getLanguageCode } from '../../i18n'
import { useGlobalConfig } from '../../store/globalConfig'
import type { Session } from '../../types'

const BodyMapTab = lazy(() => import('../BodyMap/BodyMapTab').then(m => ({ default: m.BodyMapTab })).catch(() => {
  window.location.reload()
  return new Promise(() => {})
}))

interface Props {
  navigateTo: (path: string) => void
  currentPath: string
}

interface SidebarItem {
  id: string
  timestamp: number
  preview: string
  status: 'active' | 'closed'
  favorited?: boolean
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

export function EntriesList({ navigateTo, currentPath }: Props) {
  const [isOpen, setIsOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<'entries' | 'body'>('entries')
  const [searchQuery, setSearchQuery] = useState('')
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false)
  const [sessions, setSessions] = useState<Session[]>([])
  const isMobile = useIsMobile()
  const t = useTranslation()
  const globalConfig = useGlobalConfig()
  const showBodyMap = globalConfig?.features?.bodyMap === true

  // 60s poll. Sessions don't have a Firestore subscription wired here, so
  // the sidebar can lag a session-creation/close by up to one tick. Fix the
  // staleness by adding `db.sessions.subscribe(...)` if it becomes a problem.
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      // Bounded: an unbounded scan re-reads every session doc the user has
      // ever created on every poll tick (~10k reads/hour for a long-tenured
      // user). 100 newest covers the visible list.
      const data = await db.sessions.orderBy('startedAt').reverse().limit(100).toArray()
      if (!cancelled) setSessions(data)
    }
    load()
    const interval = setInterval(load, 60_000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [])

  const formatDate = (timestamp: number) => {
    const d = new Date(timestamp)
    const now = new Date()
    const isToday = d.toDateString() === now.toDateString()
    const yesterday = new Date(now)
    yesterday.setDate(yesterday.getDate() - 1)
    const isYesterday = d.toDateString() === yesterday.toDateString()

    if (isToday) return t['sidebar.today']
    if (isYesterday) return t['sidebar.yesterday']
    return d.toLocaleDateString(getLanguageCode(), { month: 'short', day: 'numeric' })
  }

  const handleSelectSession = useCallback((id: string) => {
    navigateTo('/session/' + id)
    if (isMobile) setIsOpen(false)
  }, [navigateTo, isMobile])

  const handleNewSession = useCallback(() => {
    navigateTo('/session/new')
    if (isMobile) setIsOpen(false)
  }, [navigateTo, isMobile])

  const sidebarItems = useMemo(() => {
    const previewSession = (session: Session): string => {
      const text = session.sessionNote || session.firstLine
      if (!text) return t['sessions.title']
      return text.slice(0, 40) + (text.length > 40 ? '...' : '')
    }

    let merged: SidebarItem[] = sessions.map(s => ({
      id: s.id,
      timestamp: s.startedAt,
      preview: previewSession(s),
      status: s.status,
      favorited: s.favorited,
    }))

    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      merged = merged.filter(item => item.preview.toLowerCase().includes(q))
    }
    if (showFavoritesOnly) {
      merged = merged.filter(item => item.favorited)
    }

    merged.sort((a, b) => b.timestamp - a.timestamp)
    return merged
  }, [sessions, searchQuery, showFavoritesOnly, t])

  return (
    <>
      {isMobile && (
        <button
          className="sidebar-toggle"
          onClick={() => setIsOpen((o) => !o)}
          aria-label="Toggle entries"
        >
          {isOpen ? '✕' : '☰'}
        </button>
      )}

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
                {t['sessions.title']}
              </button>
              <button
                className={`sidebar-tab ${activeTab === 'body' ? 'active' : ''}`}
                onClick={() => setActiveTab('body')}
              >
                {t['bodyMap.title']}
              </button>
            </div>
          ) : (
            <div className="sidebar-label">{t['sessions.title']}</div>
          )}

          {activeTab === 'body' && showBodyMap ? (
            <Suspense fallback={null}>
              <BodyMapTab />
            </Suspense>
          ) : (
            <>
              <div className="sidebar-new-buttons">
                <button className="new-entry-btn" onClick={handleNewSession}>
                  {t['sidebar.newShort']}
                </button>
              </div>

              <div className="sidebar-search-toolbar">
                <div className="sidebar-search-wrap">
                  <svg className="sidebar-search-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <circle cx="6.5" cy="6.5" r="4.5" />
                    <line x1="10" y1="10" x2="14" y2="14" />
                  </svg>
                  <input
                    className="sidebar-search-input"
                    type="text"
                    placeholder={t['sidebar.search']}
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                  />
                  {searchQuery && (
                    <button
                      className="sidebar-search-clear"
                      onClick={() => setSearchQuery('')}
                      aria-label="Clear search"
                    >
                      {'✕'}
                    </button>
                  )}
                </div>
                <button
                  className={`sidebar-favorites-toggle ${showFavoritesOnly ? 'active' : ''}`}
                  onClick={() => setShowFavoritesOnly(f => !f)}
                  title={t['sidebar.favorites']}
                >
                  {'★'}
                </button>
              </div>

              <div style={{ marginTop: 4 }}>
                {sidebarItems.length === 0 && (searchQuery || showFavoritesOnly) ? (
                  <div className="sidebar-no-results">{t['sidebar.noResults']}</div>
                ) : (
                  sidebarItems.map((item) => (
                    <div
                      key={item.id}
                      className={`entry-item session-item ${'/session/' + item.id === currentPath ? 'active' : ''}`}
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
                      <span className="session-item-label">{item.preview}</span>
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
