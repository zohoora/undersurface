import { useSyncExternalStore } from 'react'
import { doc, onSnapshot } from 'firebase/firestore'
import { firestore } from '../firebase'
import { invalidateSettingsCache } from './settings'
import type { GlobalConfig } from '../admin/adminTypes'

let cache: GlobalConfig | null = null
// Whether the first snapshot (cache or server) has arrived. `getGlobalConfig()`
// is null both before it arrives and when the document doesn't exist, so code
// that must tell "not loaded yet" from "no config" (Folio's access check)
// waits on this.
let loaded = false
let readyWaiters: (() => void)[] = []
const listeners = new Set<() => void>()
let unsubscribe: (() => void) | null = null
let initialBuildVersion: string | null = null
let hasNewVersion = false
const versionListeners = new Set<() => void>()

function notify() {
  for (const fn of listeners) fn()
}

export function initGlobalConfig() {
  if (unsubscribe) return
  const docRef = doc(firestore, 'appConfig', 'global')
  unsubscribe = onSnapshot(
    docRef,
    (snap) => {
      cache = snap.exists() ? (snap.data() as GlobalConfig) : null
      // Track build version changes
      const version = cache?.buildVersion ?? null
      if (initialBuildVersion === null) {
        initialBuildVersion = version
      } else if (version && version !== initialBuildVersion && !hasNewVersion) {
        hasNewVersion = true
        for (const fn of versionListeners) fn()
      }
      invalidateSettingsCache()
      markLoaded()
      notify()
    },
    (error) => {
      console.error('Global config listener error:', error)
      markLoaded()
      notify()
    },
  )
}

function markLoaded() {
  if (loaded) return
  loaded = true
  const waiters = readyWaiters
  readyWaiters = []
  for (const fn of waiters) fn()
}

/** Resolves once the first config snapshot (or a listener error) has arrived. */
export function whenGlobalConfigReady(): Promise<void> {
  if (loaded) return Promise.resolve()
  return new Promise((resolve) => { readyWaiters.push(resolve) })
}

export function useGlobalConfigStatus(): 'loading' | 'ready' {
  return useSyncExternalStore(subscribe, () => (loaded ? 'ready' : 'loading'))
}

export function teardownGlobalConfig(): void {
  if (unsubscribe) {
    unsubscribe()
    unsubscribe = null
  }
  loaded = false
  cache = null
  hasNewVersion = false
  initialBuildVersion = null
  notify()
}

export function getGlobalConfig(): GlobalConfig | null {
  return cache
}

function subscribe(callback: () => void) {
  listeners.add(callback)
  return () => { listeners.delete(callback) }
}

function getSnapshot(): GlobalConfig | null {
  return cache
}

export function useGlobalConfig(): GlobalConfig | null {
  return useSyncExternalStore(subscribe, getSnapshot)
}

function subscribeVersion(callback: () => void) {
  versionListeners.add(callback)
  return () => { versionListeners.delete(callback) }
}

function getVersionSnapshot(): boolean {
  return hasNewVersion
}

export function useNewVersionAvailable(): boolean {
  return useSyncExternalStore(subscribeVersion, getVersionSnapshot)
}
