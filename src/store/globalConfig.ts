import { useSyncExternalStore } from 'react'
import { doc, onSnapshot } from 'firebase/firestore'
import { firestore } from '../firebase'
import { invalidateSettingsCache } from './settings'
import type { GlobalConfig } from '../admin/adminTypes'

let cache: GlobalConfig | null = null
const listeners = new Set<() => void>()
let unsubscribe: (() => void) | null = null

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
