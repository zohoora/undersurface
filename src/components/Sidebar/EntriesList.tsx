import { useState, useCallback, useEffect, useMemo, Suspense } from 'react'
import { db } from '../../store/db'
import { SettingsPanel } from './SettingsPanel'
import { useTranslation, getLanguageCode } from '../../i18n'
import { useGlobalConfig } from '../../store/globalConfig'
import type { Session } from '../../types'
import { lazyWithRetry } from '../../utils/lazyWithRetry'
import { ChunkErrorBoundary } from '../ChunkErrorBoundary'

const BodyMapTab = lazyWithRetry(() => import('../BodyMap/BodyMapTab').then(m => ({ default: m.BodyMapTab })), 'body-map-tab')

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
  const [visibleCount, setVisibleCount] = useState(30)
  const [sessions, setSessions] = useState<Session[]>([])
  const isMobile = useIsMobile()
  const t = useTranslation()
  const globalConfig = useGlobalConfig()
  const showBodyMap = globalConfig?.features?.bodyMap === true

  // 60s poll. Sessions don't have a Firestore subscription wired here, so
  // Live subscription over the 100 newest sessions: Firestore charges the
  // initial 100 reads once, then only changed docs — instead of re-reading 100
  // docs every 60s poll tick (~6k reads/hour/tab). Also removes the up-to-60s
  // lag the old poll had on session creation/close.
  useEffect(() => {
    const unsubscribe = db.sessions.orderBy('startedAt').reverse().limit(100)
      .subscribe(setSessions)
    return unsubscribe
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

  const visibleItems = searchQuery || showFavoritesOnly
    ? sidebarItems
    : sidebarItems.slice(0, visibleCount)

  const toggleNavigation = useCallback(() => {
    setIsOpen(value => {
      if (value) setSettingsOpen(false)
      return !value
    })
  }, [])

  const toggleSettings = useCallback(() => {
    setSettingsOpen(value => !value)
    if (isMobile) setIsOpen(false)
  }, [isMobile])

  return (
    <>
      <button
        className="sidebar-toggle"
        onClick={toggleNavigation}
        aria-label={isOpen ? t['sidebar.closeNavigation'] : t['sidebar.openNavigation']}
        aria-expanded={isOpen}
      >
        {isOpen ? '✕' : '☰'}
      </button>

      {isMobile && (
        <div
          className={`sidebar-backdrop ${isOpen ? 'visible' : ''}`}
          onClick={() => setIsOpen(false)}
        />
      )}

      <div
        className={`entries-sidebar ${isOpen ? 'open' : ''}`}
        aria-label={t['sidebar.navigation']}
      >
        <button className="rail-brand" onClick={toggleNavigation} aria-label={isOpen ? t['sidebar.collapse'] : t['sidebar.expand']}>
          <span className="rail-brand-mark" aria-hidden="true">U</span>
          <span className="rail-copy">UnderSurface</span>
        </button>

        <button className="rail-new-session" onClick={handleNewSession}>
          <span className="rail-icon" aria-hidden="true">＋</span>
          <span className="rail-copy">{t['sidebar.newSession']}</span>
        </button>

        <div className="sidebar-expanded-content">
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
            <ChunkErrorBoundary area="body-map" variant="compact">
              <Suspense fallback={null}>
                <BodyMapTab />
              </Suspense>
            </ChunkErrorBoundary>
          ) : (
            <>
              <div className="sidebar-new-buttons">
                <div className="sidebar-section-title">{t['sidebar.recent']}</div>
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
                  visibleItems.map((item) => (
                    <button
                      type="button"
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
                    </button>
                  ))
                )}
              </div>
              {!searchQuery && !showFavoritesOnly && visibleItems.length < sidebarItems.length && (
                <button className="sidebar-load-older" onClick={() => setVisibleCount(count => count + 30)}>
                  {t['sidebar.showOlder']}
                </button>
              )}
            </>
          )}
        </div>
        <SettingsPanel isOpen={settingsOpen} onToggle={toggleSettings} />
      </div>
    </>
  )
}
