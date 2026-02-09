import { useState, useMemo } from 'react'
import { useGlobalConfig } from '../store/globalConfig'

export function AnnouncementBanner() {
  const config = useGlobalConfig()
  const [dismissedMessage, setDismissedMessage] = useState<string | null>(null)

  const announcement = config?.announcement

  const isDismissed = useMemo(() => {
    if (!announcement?.message) return false
    if (dismissedMessage === announcement.message) return true
    const key = `undersurface:dismissed:${announcement.message}`
    return sessionStorage.getItem(key) === 'true'
  }, [announcement?.message, dismissedMessage])

  if (!announcement?.message || isDismissed) return null

  const isWarning = announcement.type === 'warning'

  const handleDismiss = () => {
    const key = `undersurface:dismissed:${announcement.message}`
    sessionStorage.setItem(key, 'true')
    setDismissedMessage(announcement.message)
  }

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 9999,
        padding: '10px 20px',
        fontSize: 13,
        fontFamily: "'Inter', sans-serif",
        textAlign: 'center',
        background: isWarning ? '#FEF3C7' : '#EFF6FF',
        color: isWarning ? '#92400E' : '#1E40AF',
        borderBottom: `1px solid ${isWarning ? '#FDE68A' : '#BFDBFE'}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
      }}
    >
      <span>{announcement.message}</span>
      {announcement.dismissible && (
        <button
          onClick={handleDismiss}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            fontSize: 16,
            color: 'inherit',
            padding: '0 4px',
            lineHeight: 1,
            opacity: 0.6,
          }}
          aria-label="Dismiss announcement"
        >
          x
        </button>
      )}
    </div>
  )
}
