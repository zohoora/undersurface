import { useSyncExternalStore } from 'react'
import { getGlobalConfig } from './globalConfig'

export interface AppSettings {
  // AI
  openRouterApiKey: string
  openRouterModel: string
  hasSeenOnboarding: boolean

  // Part responsiveness (0.5 = slower, 2.0 = faster)
  responseSpeed: number

  // Editor
  typewriterScroll: 'off' | 'comfortable' | 'typewriter'

  // Autocorrect
  autoCapitalize: boolean
  autocorrect: boolean

  // Appearance
  theme: 'light' | 'dark' | 'system'
}

const DEFAULTS: AppSettings = {
  openRouterApiKey: '',
  openRouterModel: 'google/gemini-3-flash-preview',
  hasSeenOnboarding: false,
  responseSpeed: 1.0,
  typewriterScroll: 'typewriter',
  autoCapitalize: true,
  autocorrect: true,
  theme: 'system',
}

const STORAGE_KEY = 'undersurface:settings'

let cache: AppSettings | null = null
const listeners = new Set<() => void>()

function getGlobalDefaults(): Partial<AppSettings> {
  const config = getGlobalConfig()
  if (!config) return {}
  const overrides: Partial<AppSettings> = {}
  if (config.defaultModel) overrides.openRouterModel = config.defaultModel
  if (config.defaultResponseSpeed) overrides.responseSpeed = config.defaultResponseSpeed
  if (config.defaultTypewriterScroll) overrides.typewriterScroll = config.defaultTypewriterScroll
  if (config.features) {
    if (config.features.autocorrectEnabled === false) {
      overrides.autocorrect = false
    }
  }
  return overrides
}

// Settings that should always come from globalConfig, never from localStorage
const ADMIN_CONTROLLED_KEYS: (keyof AppSettings)[] = ['openRouterModel']

function load(): AppSettings {
  if (cache) return cache
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const globalDefaults = getGlobalDefaults()
    const local = raw ? JSON.parse(raw) : {}
    // Remove admin-controlled keys from localStorage so globalConfig always wins
    for (const key of ADMIN_CONTROLLED_KEYS) {
      delete local[key]
    }
    cache = { ...DEFAULTS, ...globalDefaults, ...local }
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

export function invalidateSettingsCache() {
  cache = null
  notify()
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
