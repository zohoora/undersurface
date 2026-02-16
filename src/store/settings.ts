import { useSyncExternalStore } from 'react'
import { getGlobalConfig } from './globalConfig'
import { detectBrowserLanguage } from '../i18n/languages'

export interface AppSettings {
  // AI
  openRouterModel: string

  // Part responsiveness (0.5 = slower, 2.0 = faster)
  responseSpeed: number

  // Editor
  typewriterScroll: 'off' | 'comfortable' | 'typewriter'

  // Autocorrect
  autoCapitalize: boolean
  autocorrect: boolean

  // AI text interactions (user can disable even when admin-enabled)
  textHighlights: boolean
  ghostText: boolean

  // Appearance
  theme: 'light' | 'dark' | 'system'

  // Language
  language: string
}

const DEFAULTS: AppSettings = {
  openRouterModel: 'google/gemini-3-flash-preview',
  responseSpeed: 1.0,
  typewriterScroll: 'typewriter',
  autoCapitalize: true,
  autocorrect: true,
  textHighlights: true,
  ghostText: true,
  theme: 'system',
  language: detectBrowserLanguage(),
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
const ADMIN_CONTROLLED_KEYS: (keyof AppSettings)[] = ['openRouterModel', 'typewriterScroll']

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
  // Lazy import to avoid circular dependency — only called on globalConfig update
  import('../i18n/index').then((m) => m.invalidateTranslationCache()).catch(() => {})
  notify()
}

export function updateSettings(partial: Partial<AppSettings>) {
  const next = { ...load(), ...partial }
  cache = next
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  if ('language' in partial) {
    import('../i18n/index').then((m) => m.invalidateTranslationCache()).catch(() => {})
  }
  notify()
}

export function clearSettings() {
  localStorage.removeItem(STORAGE_KEY)
  cache = null
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
