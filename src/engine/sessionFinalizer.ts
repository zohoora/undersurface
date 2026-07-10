import { db, sessionMessages } from '../store/db'
import type { Part, Session } from '../types'
import { reflectOnSession } from './sessionReflectionEngine'

const ACTIVE_SCAN_LIMIT = 20

export async function finalizePreviousActiveSessions(excludeSessionId?: string): Promise<void> {
  const sessions = await db.sessions.orderBy('startedAt').reverse().limit(ACTIVE_SCAN_LIMIT).toArray()
  const active = sessions.filter(session => session.status === 'active' && session.id !== excludeSessionId)
  if (active.length === 0) return

  let partsPromise: Promise<Part[]> | null = null
  for (const session of active) {
    const messages = await sessionMessages.getAll(session.id)
    const hasUser = messages.some(message => message.speaker === 'user')
    const hasCompanion = messages.some(message => message.speaker === 'therapist')

    // An automatic opener with no writer turn is navigation debris, not a
    // conversation. Remove both the nested messages and its parent shell.
    if (!hasUser) {
      await Promise.all(messages.map(message => sessionMessages.delete(session.id, message.id)))
      await db.sessions.delete(session.id)
      continue
    }

    const endedAt = messages.reduce((latest, message) => Math.max(latest, message.timestamp), session.startedAt)
    const closed: Partial<Session> = {
      status: 'closed',
      endedAt,
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
