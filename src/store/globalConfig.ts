import { useSyncExternalStore } from 'react'
import { doc, onSnapshot } from 'firebase/firestore'
import { firestore } from '../firebase'
import { invalidateSettingsCache } from './settings'
import type { GlobalConfig } from '../admin/adminTypes'

let cache: GlobalConfig | null = null
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
      notify()
    },
    (error) => {
      console.error('Global config listener error:', error)
    },
  )
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
