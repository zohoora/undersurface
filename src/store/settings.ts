import { useSyncExternalStore } from 'react'
import { getGlobalConfig } from './globalConfig'
import { detectBrowserLanguage } from '../i18n/languages'
import type { RelaxAudioTrack, RelaxSessionType, RelaxVisualMode, SessionMode } from '../types'

export interface AppSettings {
  // Part responsiveness (0.5 = slower, 2.0 = faster)
  responseSpeed: number

  // Autocorrect
  autoCapitalize: boolean
  autocorrect: boolean

  // AI text interactions (user can disable even when admin-enabled)
  bilateralStimulation: boolean

  // Appearance
  theme: 'light' | 'dark' | 'system'

  // Language
  language: string

  // Timezone (IANA, e.g. 'America/New_York')
  timezone: string

  // Last-used session tone — new sessions start in this mode so the user
  // doesn't have to re-pick Real Talk every time.
  lastSessionMode: SessionMode

  // Last-chosen Relax mode preferences. Pre-populate the settings panel so
  // the user can begin a session in two taps.
  lastRelaxDuration: 5 | 10 | 20
  lastRelaxType: RelaxSessionType
  lastRelaxAudio: RelaxAudioTrack
  lastRelaxAudioVolume: number  // 0..1
  lastRelaxVoiceEnabled: boolean
  lastRelaxVisualMode: RelaxVisualMode
}

const DEFAULTS: AppSettings = {
  responseSpeed: 1.0,
  autoCapitalize: true,
  autocorrect: true,
  bilateralStimulation: true,
  theme: 'system',
  language: detectBrowserLanguage(),
  timezone: 'America/New_York',
  lastSessionMode: 'standard',
  lastRelaxDuration: 10,
  lastRelaxType: 'breathwork',
  lastRelaxAudio: 'ocean',
  lastRelaxAudioVolume: 0.5,
  lastRelaxVoiceEnabled: false,
  lastRelaxVisualMode: 'full',
}

const STORAGE_KEY = 'undersurface:settings'

let cache: AppSettings | null = null
const listeners = new Set<() => void>()

function getGlobalDefaults(): Partial<AppSettings> {
  const config = getGlobalConfig()
  if (!config) return {}
  const overrides: Partial<AppSettings> = {}
  if (config.defaultResponseSpeed) overrides.responseSpeed = config.defaultResponseSpeed
  if (config.features?.autocorrectEnabled === false) {
    overrides.autocorrect = false
  }
  return overrides
}

function load(): AppSettings {
  if (cache) return cache
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const globalDefaults = getGlobalDefaults()
    const local = raw ? JSON.parse(raw) : {}
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
