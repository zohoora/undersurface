import type { PartMemory, UserProfile } from '../types'
import { db } from '../store/db'

export interface TherapistContext {
  recentSessionNotes: { note: string; date: number }[]
  relevantMemories: PartMemory[]
  userProfile: UserProfile | null
}

export interface FutureSelfContext extends TherapistContext {
  voiceExcerpts: string[]
}

const MEMORY_SOURCE_PARTS = ['open', 'weaver', 'still']

export async function loadTherapistContext(): Promise<TherapistContext> {
  // Load all three in parallel
  const [sessions, memories, profiles] = await Promise.all([
    db.sessions.orderBy('startedAt').reverse().toArray(),
    Promise.all(
      MEMORY_SOURCE_PARTS.map(partId =>
        db.memories.where('partId').equals(partId).toArray(),
      ),
    ),
    db.userProfile.toArray(),
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

/**
 * Samples short, emotionally anchored quotes from the user's own recent entries
 * so the Future Self persona can mimic the writer's voice, rhythm, and diction.
 *
 * Strategy:
 * - Look at up to 20 most recent entries
 * - Split each into sentences (supports English, Hindi danda, CJK fullwidth)
 * - Keep sentences between 20 and 160 chars (too short = filler; too long = runs)
 * - Score by emotional keyword density + first-person markers — prefer texture
 * - Return up to `count` quotes, deduplicated by 6-word prefix
 */
export async function loadVoiceExcerpts(count = 8): Promise<string[]> {
  const entries = await db.entries.orderBy('updatedAt').reverse().toArray()
  const recent = entries.slice(0, 20)

  // Simple emotional-texture scorer: higher score = more first-person, more feeling words
  const FEELING_MARKERS = /\b(i|me|my|feel|felt|feeling|think|thought|want|wish|hope|fear|afraid|tired|angry|sad|happy|lonely|love|hate|lost|stuck|ache|heavy|small|soft|quiet|alone|again|still|maybe|sometimes|something|nothing)\b/gi

  type Scored = { text: string; score: number }
  const candidates: Scored[] = []

  for (const entry of recent) {
    const text = entry.plainText ?? ''
    if (!text.trim()) continue

    // Split on sentence-ending punctuation (ASCII . ! ?, Hindi danda ।, CJK fullwidth 。！？)
    const sentences = text.split(/[.!?।。！？\n]+/).map(s => s.trim()).filter(Boolean)

    for (const s of sentences) {
      if (s.length < 20 || s.length > 160) continue
      // Skip lines that look like markdown headings, bullets, or quotes of others
      if (/^[#>*-]/.test(s)) continue

      const markerCount = (s.match(FEELING_MARKERS) ?? []).length
      if (markerCount === 0) continue

      candidates.push({ text: s, score: markerCount / Math.sqrt(s.length) })
    }
  }

  candidates.sort((a, b) => b.score - a.score)

  // Deduplicate by first 6 words to avoid near-identical sentences
  const seen = new Set<string>()
  const out: string[] = []
  for (const c of candidates) {
    const key = c.text.toLowerCase().split(/\s+/).slice(0, 6).join(' ')
    if (seen.has(key)) continue
    seen.add(key)
    out.push(c.text)
    if (out.length >= count) break
  }

  return out
}

export async function loadFutureSelfContext(voiceExcerptCount = 8): Promise<FutureSelfContext> {
  const [therapistCtx, voiceExcerpts] = await Promise.all([
    loadTherapistContext(),
    loadVoiceExcerpts(voiceExcerptCount),
  ])
  return { ...therapistCtx, voiceExcerpts }
}
