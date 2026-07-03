import type { PartMemory, UserProfile, PersonalFacts, RelaxSession } from '../types'
import { db } from '../store/db'

export interface TherapistContext {
  recentSessionNotes: { note: string; date: number }[]
  relevantMemories: PartMemory[]
  userProfile: UserProfile | null
  personalFacts: PersonalFacts | null
  // Most recent relax sessions across the user's history. Used at session
  // start to inform the therapist about recent breathwork/meditation work.
  recentRelaxBreaks: RelaxSession[]
}

const MEMORY_SOURCE_PARTS = ['open', 'weaver', 'still']
const RECENT_RELAX_LIMIT = 5

export async function loadTherapistContext(): Promise<TherapistContext> {
  const [sessions, memories, profiles, facts, relaxBreaks] = await Promise.all([
    // Bounded: only the 5 newest noted sessions are kept, so scanning the
    // full collection is pure read amplification. 50 newest gives ample
    // margin for closed-without-note gaps.
    db.sessions.orderBy('startedAt').reverse().limit(50).toArray(),
    Promise.all(
      MEMORY_SOURCE_PARTS.map(partId =>
        db.memories.where('partId').equals(partId).toArray(),
      ),
    ),
    db.userProfile.toArray(),
    db.personalFacts.get('current'),
    db.relaxSessions.orderBy('startedAt').reverse().limit(RECENT_RELAX_LIMIT * 2).toArray(),
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

  // Filter to completed sessions and trim. Query already returned newest-first
  // by startedAt; sort by endedAt for display ordering when both fields exist.
  const recentRelaxBreaks = relaxBreaks
    .filter(r => r.endedAt !== null)
    .slice(0, RECENT_RELAX_LIMIT)

  return {
    recentSessionNotes,
    relevantMemories: allMemories,
    userProfile,
    personalFacts: facts ?? null,
    recentRelaxBreaks,
  }
}

// Loads only the relax sessions that occurred WITHIN the given chat session.
// Used per-turn during an active chat — the therapist sees in-session breaks
// without having to reload the full context.
export async function loadInSessionRelaxBreaks(parentSessionId: string): Promise<RelaxSession[]> {
  const all = await db.relaxSessions.where('parentSessionId').equals(parentSessionId).toArray()
  return all
    .filter(r => r.endedAt !== null)
    .sort((a, b) => (a.endedAt ?? 0) - (b.endedAt ?? 0))
}
