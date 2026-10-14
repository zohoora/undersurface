import { doc, setDoc } from 'firebase/firestore'
import { getAuth } from 'firebase/auth'
import { firestore } from '../firebase'
import { onGroundingActivated } from './groundingState'

// Grounding state itself lives in browser memory, which the server cannot see.
// Proactive SMS and SMS replies must still know about a recent crisis, so every
// grounding activation (any source, any session — including Fresh eyes, since
// this is safety state rather than memory) stamps a server-readable timestamp
// on users/{uid}/companionPreferences/current.
//
// Merge write: the doc may not exist yet, and the other preference fields are
// owned by Settings. Readers spread their own defaults, so a partial doc is
// safe. Best-effort only: a failed write is swallowed and never delays or
// breaks the crisis path that triggered it.

const MIN_WRITE_INTERVAL_MS = 30_000
let lastWriteAt = 0

export async function persistLastGroundingAt(at: number = Date.now()): Promise<void> {
  // L1, the raced L2 classifier and the in-stream preamble can all fire for
  // the same turn. One write per burst is enough for a multi-hour window.
  if (at - lastWriteAt < MIN_WRITE_INTERVAL_MS) return
  const uid = getAuth().currentUser?.uid
  if (!uid) return
  lastWriteAt = at
  try {
    await setDoc(
      doc(firestore, 'users', uid, 'companionPreferences', 'current'),
      { id: 'current', lastGroundingAt: at },
      { merge: true },
    )
  } catch {
    // Offline or rules failure: allow the next activation to try again.
    lastWriteAt = 0
  }
}

let uninstall: (() => void) | null = null

/** Wire grounding activations to the server-readable timestamp. Idempotent. */
export function installGroundingPersistence(): () => void {
  if (!uninstall) {
    const remove = onGroundingActivated(at => persistLastGroundingAt(at))
    uninstall = () => {
      remove()
      uninstall = null
    }
  }
  return uninstall
}

/** Test seam: forget the write throttle. */
export function resetGroundingPersistenceForTests(): void {
  lastWriteAt = 0
}
