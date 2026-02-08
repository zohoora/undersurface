import { useSyncExternalStore } from 'react'

export interface AppSettings {
  // AI
  openRouterApiKey: string
  openRouterModel: string
  hasSeenOnboarding: boolean

  // Part responsiveness (0.5 = slower, 2.0 = faster)
  responseSpeed: number

  // Visual effects
  paragraphFade: boolean
  inkWeight: boolean
  colorBleed: boolean
  breathingBackground: boolean

  // Autocorrect
  autoCapitalize: boolean
  autocorrect: boolean
}

const DEFAULTS: AppSettings = {
  openRouterApiKey: '',
  openRouterModel: 'anthropic/claude-sonnet-4',
  hasSeenOnboarding: false,
  responseSpeed: 1.0,
  paragraphFade: true,
  inkWeight: true,
  colorBleed: true,
  breathingBackground: true,
  autoCapitalize: true,
  autocorrect: true,
}

const STORAGE_KEY = 'undersurface:settings'

let cache: AppSettings | null = null
const listeners = new Set<() => void>()

function load(): AppSettings {
  if (cache) return cache
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    cache = raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS }
  } catch {
    cache = { ...DEFAULTS }
  }
  return cache!
}

function notify() {
  for (const fn of listeners) fn()
}

export function getSettings(): AppSettings {
  return load()
}

export function updateSettings(partial: Partial<AppSettings>) {
  const next = { ...load(), ...partial }
  cache = next
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  notify()
}

function subscribe(callback: () => void) {
  listeners.add(callback)
  return () => { listeners.delete(callback) }
}

function getSnapshot(): AppSettings {
  return load()
}

export function useSettings(): AppSettings {
  return useSyncExternalStore(subscribe, getSnapshot)
}
