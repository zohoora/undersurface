import { db, sessionMessages } from '../store/db'
import type { Part, Session } from '../types'
import { reflectOnSession } from './sessionReflectionEngine'

const ACTIVE_SCAN_LIMIT = 20
// A session touched this recently may be live in another tab or on another
// device: starting a session here must neither close it nor delete its shell.
export const LIVE_SESSION_GRACE_MS = 30 * 60_000

export async function finalizePreviousActiveSessions(
  excludeSessionId?: string,
  now: number = Date.now(),
): Promise<void> {
  const sessions = await db.sessions.orderBy('startedAt').reverse().limit(ACTIVE_SCAN_LIMIT).toArray()
  const active = sessions.filter(session =>
    session.status === 'active'
    && session.id !== excludeSessionId
    // Cheap pre-filter before reading messages: a session that started
    // within the grace window is live by definition.
    && now - session.startedAt >= LIVE_SESSION_GRACE_MS)
  if (active.length === 0) return

  let partsPromise: Promise<Part[]> | null = null
  for (const session of active) {
    const messages = await sessionMessages.getAll(session.id)
    const lastActivity = messages.reduce((latest, message) => Math.max(latest, message.timestamp), session.startedAt)
    if (now - lastActivity < LIVE_SESSION_GRACE_MS) continue
    const hasUser = messages.some(message => message.speaker === 'user')
    const hasCompanion = messages.some(message => message.speaker === 'therapist')

    // An automatic opener with no writer turn is navigation debris, not a
    // conversation. Remove both the nested messages and its parent shell.
    if (!hasUser) {
      await Promise.all(messages.map(message => sessionMessages.delete(session.id, message.id)))
      await db.sessions.delete(session.id)
      continue
    }

    const closed: Partial<Session> = {
      status: 'closed',
      endedAt: lastActivity,
      phase: 'closing',
      reflectionStatus: session.memoryAperture === 'fresh' || !hasCompanion ? 'complete' : 'pending',
      ...(session.memoryAperture === 'fresh' || !hasCompanion ? { reflectedAt: Date.now() } : {}),
    }
    await db.sessions.update(session.id, closed)

    if (session.memoryAperture === 'fresh' || !hasCompanion) continue
    partsPromise ??= db.parts.toArray()
    void partsPromise
      .then(parts => reflectOnSession(session.id, messages, parts))
      .catch(() => db.sessions.update(session.id, { reflectionStatus: 'failed' }).catch(() => {}))
  }
}
