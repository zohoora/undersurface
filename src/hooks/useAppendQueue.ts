import { useRef, useCallback } from 'react'

/**
 * Serializes message-append operations across every writer in a session — the
 * text turn, the therapist-stream finalize, and both voice transcript sides.
 *
 * Each writer does a read-modify-write on the shared `messagesRef`: read the
 * current array, `await` a Firestore write, then append and store the result.
 * Run concurrently (e.g. the realtime API delivering a user transcript while an
 * assistant transcript is still persisting), two writers read the same base
 * array of N messages and each store N+1 — the last write wins, one message
 * vanishes from the UI, and `messageCount` is persisted as N+1 instead of N+2.
 *
 * Threading every append through this queue guarantees each one observes the
 * previous append's committed result. Returns a stable `enqueue` that chains
 * work onto a single promise tail; the chain survives a rejected step.
 */
export function useAppendQueue() {
  const tailRef = useRef<Promise<unknown>>(Promise.resolve())

  return useCallback(<T>(fn: () => Promise<T>): Promise<T> => {
    const run = tailRef.current.then(fn, fn)
    tailRef.current = run.then(() => {}, () => {})
    return run
  }, [])
}

export type EnqueueAppend = ReturnType<typeof useAppendQueue>
