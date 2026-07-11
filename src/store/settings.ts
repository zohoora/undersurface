import { useSyncExternalStore } from 'react'
import { getGlobalConfig } from './globalConfig'
import { detectBrowserLanguage } from '../i18n/languages'
import type { DriftBlsChannel, RelaxAudioTrack, RelaxSessionType, RelaxVisualMode, SessionMode } from '../types'

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
  // Last-used custom soundscape prompt. Pre-fills the textarea when user
  // re-enters Relax mode so they don't have to retype.
  lastRelaxCustomPrompt?: string

  // Last-chosen Drift preferences (device-local).
  lastDriftBlsChannel: DriftBlsChannel
  lastDriftAudioVolume: number  // 0..1
  lastDriftVoice: boolean
  // Literal union (not the engine's DriftLength) so the store stays engine-free.
  lastDriftLength: 'quick' | 'short' | 'full'
  lastDriftAnchorKind: 'feet' | 'calm_place'
  driftHasCompleted: boolean
}

// The device's zone, not a hardcoded one: the timezone defines "today's
// session" boundaries (App.tsx), so a Sydney user on an ET default got
// sessions split mid-afternoon and yesterday's resumed as today's.
function detectTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York'
  } catch {
    return 'America/New_York'
  }
}

const DEFAULTS: AppSettings = {
  responseSpeed: 1.0,
  autoCapitalize: true,
  autocorrect: true,
  bilateralStimulation: true,
  theme: 'system',
  language: detectBrowserLanguage(),
  timezone: detectTimezone(),
  lastSessionMode: 'standard',
  lastRelaxDuration: 10,
  lastRelaxType: 'breathwork',
  lastRelaxAudio: 'ocean',
  lastRelaxAudioVolume: 0.5,
  lastRelaxVoiceEnabled: false,
  lastRelaxVisualMode: 'full',
  lastDriftBlsChannel: 'visual',
  lastDriftAudioVolume: 0.5,
  lastDriftVoice: false,
  lastDriftLength: 'short',
  lastDriftAnchorKind: 'feet',
  driftHasCompleted: false,
}

const STORAGE_KEY = 'undersurface:settings'

let cache: AppSettings | null = null
const listeners = new Set<() => void>()
const dependentInvalidators = new Set<() => void>()

export function registerSettingsInvalidator(invalidator: () => void): () => void {
  dependentInvalidators.add(invalidator)
  return () => dependentInvalidators.delete(invalidator)
}

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
  for (const invalidate of dependentInvalidators) invalidate()
  notify()
}

export function updateSettings(partial: Partial<AppSettings>) {
  // Persist ONLY keys that differ from the effective defaults (DEFAULTS +
  // admin globalDefaults), NOT the full merged object. Persisting the merge
  // baked admin config and the browser-detected language into localStorage as
  // if the user had chosen them, so later admin changes and re-detected
  // language could never reach the device (C-5). Diffing also un-bakes values
  // already frozen in existing users' localStorage on their next save.
  let storedLocal: Record<string, unknown> = {}
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) storedLocal = JSON.parse(raw)
  } catch { storedLocal = {} }

  const merged = { ...storedLocal, ...partial } as Record<string, unknown>
  const baseline = { ...DEFAULTS, ...getGlobalDefaults() } as Record<string, unknown>
  const sparse: Record<string, unknown> = {}
  for (const key of Object.keys(merged)) {
    if (merged[key] !== baseline[key]) sparse[key] = merged[key]
  }

  localStorage.setItem(STORAGE_KEY, JSON.stringify(sparse))
  cache = null // force a re-merge (DEFAULTS + globalDefaults + sparse) on next load
  if ('language' in partial) {
    for (const invalidate of dependentInvalidators) invalidate()
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
