import { useEffect, useSyncExternalStore } from 'react'
import { useSettings, getSettings } from '../store/settings'

const mediaQuery =
  typeof window !== 'undefined'
    ? window.matchMedia('(prefers-color-scheme: dark)')
    : null

function subscribeMedia(callback: () => void) {
  mediaQuery?.addEventListener('change', callback)
  return () => mediaQuery?.removeEventListener('change', callback)
}

function getMediaSnapshot(): boolean {
  return mediaQuery?.matches ?? false
}

export function useTheme(): 'light' | 'dark' {
  const settings = useSettings()
  const systemDark = useSyncExternalStore(subscribeMedia, getMediaSnapshot)

  const resolved = settings.theme === 'system'
    ? (systemDark ? 'dark' : 'light')
    : settings.theme

  useEffect(() => {
    document.documentElement.dataset.theme = resolved
  }, [resolved])

  return resolved
}

/** Non-React version for class components or inline-style helpers */
export function getResolvedTheme(): 'light' | 'dark' {
  const { theme } = getSettings()
  if (theme === 'system') {
    return mediaQuery?.matches ? 'dark' : 'light'
  }
  return theme
}
