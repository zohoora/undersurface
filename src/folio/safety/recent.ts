import { useEffect, useState } from 'react'
import { doc, onSnapshot } from 'firebase/firestore'
import { firestore } from '../../firebase'
import { onGroundingActivated } from '../../store/groundingState'
import { readActivationMirror } from './shorePresentation'

// Recent (draft 4 §5.5): an overlay while less than 72 hours have passed since
// the last grounding activation on any surface or device. The persisted value
// is users/{uid}/companionPreferences/current.lastGroundingAt (written best
// effort, throttled); this device's mirror and live activations in this tab
// cover the gap until it arrives.

export const RECENT_MS = 72 * 60 * 60 * 1000

export function latestGrounding(...times: (number | null | undefined)[]): number | null {
  const valid = times.filter((t): t is number => typeof t === 'number' && Number.isFinite(t) && t > 0)
  return valid.length > 0 ? Math.max(...valid) : null
}

export function isRecent(lastGroundingAt: number | null, now: number): boolean {
  return lastGroundingAt !== null && now - lastGroundingAt < RECENT_MS
}

/** The writer's last grounding activation, kept current; null until known. */
export function useLastGrounding(uid: string): number | null {
  const [server, setServer] = useState<number | null>(null)
  const [local, setLocal] = useState<number | null>(() => readActivationMirror(uid))
  useEffect(() => {
    const ref = doc(firestore, 'users', uid, 'companionPreferences', 'current')
    return onSnapshot(ref, (snap) => {
      const at = snap.exists() ? (snap.data() as { lastGroundingAt?: unknown }).lastGroundingAt : null
      setServer(typeof at === 'number' ? at : null)
    }, () => setServer(null))
  }, [uid])
  useEffect(() => onGroundingActivated((at) => setLocal((prev) => latestGrounding(prev, at))), [])
  return latestGrounding(server, local)
}

/** Whether the Recent overlay applies now; flips back by itself when it ends. */
export function useRecent(uid: string): boolean {
  const last = useLastGrounding(uid)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (last === null) return
    const ends = last + RECENT_MS - Date.now()
    if (ends <= 0) return
    // Re-render when it ends; a long timeout is clamped by browsers, so cap it.
    const t = setTimeout(() => setNow(Date.now()), Math.min(ends + 1000, 2 ** 31 - 1))
    return () => clearTimeout(t)
  }, [last])
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') setNow(Date.now()) }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])
  return isRecent(last, Math.max(now, last ?? 0))
}
