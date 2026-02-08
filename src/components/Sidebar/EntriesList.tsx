import { useState, useCallback, useEffect } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, generateId } from '../../store/db'
import { SettingsPanel } from './SettingsPanel'

interface Props {
  activeEntryId: string
  onSelectEntry: (id: string) => void
  onNewEntry: (id: string) => void
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
  const isMobile = useIsMobile()

  const entries = useLiveQuery(
    () => db.entries.orderBy('updatedAt').reverse().toArray(),
    [],
  )

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

    if (isToday) return 'Today'
    if (isYesterday) return 'Yesterday'
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  const getPreview = (plainText: string) => {
    if (!plainText) return 'Empty entry'
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
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
          <div className="sidebar-label">Entries</div>
          <button className="new-entry-btn" onClick={handleNewEntry}>
            + New entry
          </button>
          <div style={{ marginTop: 8 }}>
            {entries?.map((entry) => (
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
        </div>
        <SettingsPanel isOpen={settingsOpen} onToggle={() => setSettingsOpen((o) => !o)} />
      </div>
    </>
  )
}
