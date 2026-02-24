import type { PartMemory, UserProfile, Session } from '../types'
import { db } from '../store/db'

export interface TherapistContext {
  recentSessionNotes: { note: string; date: number }[]
  relevantMemories: PartMemory[]
  userProfile: UserProfile | null
}

const MEMORY_SOURCE_PARTS = ['open', 'weaver', 'still']

export async function loadTherapistContext(): Promise<TherapistContext> {
  // Load all three in parallel
  const [sessions, memories, profiles] = await Promise.all([
    db.sessions.orderBy('startedAt').reverse().toArray() as Promise<Session[]>,
    Promise.all(
      MEMORY_SOURCE_PARTS.map(partId =>
        db.memories.where('partId').equals(partId).toArray() as Promise<PartMemory[]>,
      ),
    ),
    db.userProfile.toArray() as Promise<UserProfile[]>,
  ])

  // Extract notes from the 5 most recent closed sessions
  const recentSessionNotes = sessions
    .filter(s => s.status === 'closed' && s.sessionNote)
    .slice(0, 5)
    .map(s => ({ note: s.sessionNote!, date: s.endedAt ?? s.startedAt }))

  // Combine and sort memories, take most recent 12
  const allMemories = memories
    .flat()
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 12)

  const userProfile = profiles.length > 0 ? profiles[0] : null

  return { recentSessionNotes, relevantMemories: allMemories, userProfile }
}
