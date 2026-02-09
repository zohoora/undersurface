import { useSyncExternalStore } from 'react'
import { getGlobalConfig } from './globalConfig'

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

  // Editor
  typewriterScroll: 'off' | 'comfortable' | 'typewriter'

  // Autocorrect
  autoCapitalize: boolean
  autocorrect: boolean
}

const DEFAULTS: AppSettings = {
  openRouterApiKey: '',
  openRouterModel: 'google/gemini-3-flash-preview',
  hasSeenOnboarding: false,
  responseSpeed: 1.0,
  typewriterScroll: 'typewriter',
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

function getGlobalDefaults(): Partial<AppSettings> {
  const config = getGlobalConfig()
  if (!config) return {}
  const overrides: Partial<AppSettings> = {}
  if (config.defaultModel) overrides.openRouterModel = config.defaultModel
  if (config.defaultResponseSpeed) overrides.responseSpeed = config.defaultResponseSpeed
  if (config.defaultTypewriterScroll) overrides.typewriterScroll = config.defaultTypewriterScroll
  if (config.features) {
    if (config.features.visualEffectsEnabled === false) {
      overrides.paragraphFade = false
      overrides.inkWeight = false
      overrides.colorBleed = false
      overrides.breathingBackground = false
    }
    if (config.features.autocorrectEnabled === false) {
      overrides.autocorrect = false
    }
  }
  return overrides
}

function load(): AppSettings {
  if (cache) return cache
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const globalDefaults = getGlobalDefaults()
    cache = raw
      ? { ...DEFAULTS, ...globalDefaults, ...JSON.parse(raw) }
      : { ...DEFAULTS, ...globalDefaults }
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
