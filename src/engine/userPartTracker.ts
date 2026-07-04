import type { UserPart } from '../types'
import { generateId } from '../store/db'

// Pure merge engine for user-part observations from the reflection pass.
// Precision-first throughout: malformed input is dropped silently, caps favor
// omission, and retired parts are never resurrected — a part the user said
// "not quite" to twice stays gone.
// Spec: docs/superpowers/specs/2026-07-04-user-parts-model-design.md

const EVIDENCE_CAP = 8
const QUOTE_WORD_CAP = 15
const ACTIVE_CAP = 9
const CANDIDATE_CAP = 5
const OBSERVATIONS_PER_SESSION_CAP = 2
const PROPOSAL_SESSIONS_SEEN = 2
// A stamped proposal older than this re-arms — covers the model having
// ignored the marker instruction (nothing was actually offered).
const PROPOSAL_RETRY_MS = 7 * 24 * 3_600_000

interface MatchObservation {
  partId: string
  quote: string
  stance?: string
}

interface NewObservation {
  tentativeName: string
  description: string
  stance: string
  quote: string
}

function truncateQuote(quote: string): string {
  return quote.trim().split(/\s+/).slice(0, QUOTE_WORD_CAP).join(' ')
}

function asMatch(o: unknown, existing: UserPart[]): MatchObservation | null {
  if (typeof o !== 'object' || o === null) return null
  const r = o as Record<string, unknown>
  if (typeof r.partId !== 'string' || typeof r.quote !== 'string' || !r.quote.trim()) return null
  if (!existing.some((p) => p.id === r.partId && p.status !== 'retired')) return null
  return {
    partId: r.partId,
    quote: r.quote,
    stance: typeof r.stance === 'string' && r.stance.trim() ? r.stance.trim() : undefined,
  }
}

function asNew(o: unknown): NewObservation | null {
  if (typeof o !== 'object' || o === null) return null
  const r = o as Record<string, unknown>
  if (
    typeof r.tentativeName !== 'string' || !r.tentativeName.trim() ||
    typeof r.description !== 'string' || !r.description.trim() ||
    typeof r.quote !== 'string' || !r.quote.trim()
  ) return null
  return {
    tentativeName: r.tentativeName.trim().slice(0, 60),
    description: r.description.trim().slice(0, 200),
    stance: typeof r.stance === 'string' ? r.stance.trim().slice(0, 120) : '',
    quote: r.quote,
  }
}

// Merge one session's observations into the existing parts. Returns changed
// copies (updates) and brand-new candidates (creates); the caller persists.
export function applyPartObservations(
  existing: UserPart[],
  observations: unknown,
  sessionId: string,
  now: number,
): { updates: UserPart[]; creates: UserPart[] } {
  const updates: UserPart[] = []
  const creates: UserPart[] = []
  if (!Array.isArray(observations)) return { updates, creates }

  const candidateCount = existing.filter((p) => p.status === 'candidate').length
  const activeCount = existing.filter((p) => p.status === 'active').length
  let budget = OBSERVATIONS_PER_SESSION_CAP
  const touched = new Set<string>()

  for (const raw of observations) {
    if (budget <= 0) break

    const match = asMatch(raw, existing)
    if (match) {
      if (touched.has(match.partId)) continue
      const part = existing.find((p) => p.id === match.partId)!
      const alreadyThisSession = part.evidence.some((e) => e.sessionId === sessionId)
      const updated: UserPart = {
        ...part,
        evidence: [...part.evidence, { sessionId, quote: truncateQuote(match.quote), observedAt: now }].slice(-EVIDENCE_CAP),
        sessionsSeen: alreadyThisSession ? part.sessionsSeen : part.sessionsSeen + 1,
        stance: match.stance ?? part.stance,
        lastActiveAt: now,
        updatedAt: now,
      }
      updates.push(updated)
      touched.add(match.partId)
      budget--
      continue
    }

    const fresh = asNew(raw)
    if (fresh) {
      if (candidateCount + creates.length >= CANDIDATE_CAP) continue
      if (activeCount >= ACTIVE_CAP) continue
      creates.push({
        id: generateId(),
        name: fresh.tentativeName,
        description: fresh.description,
        stance: fresh.stance,
        status: 'candidate',
        evidence: [{ sessionId, quote: truncateQuote(fresh.quote), observedAt: now }],
        sessionsSeen: 1,
        dismissedCount: 0,
        lastActiveAt: now,
        createdAt: now,
        updatedAt: now,
      })
      budget--
    }
  }

  return { updates, creates }
}

const LEXICON_CAP = 12
const PHRASE_CHAR_CAP = 40
const PHRASES_PER_SESSION_CAP = 3

// Merge this session's coined phrases into the shared lexicon. Newest
// reinforcement wins position (a re-coined phrase moves to the end); cap
// drops the oldest. Returns null when nothing valid arrived (no write).
export function mergeLexicon(existing: string[] | undefined, phrases: unknown): string[] | null {
  if (!Array.isArray(phrases)) return null
  const incoming = phrases
    .filter((p): p is string => typeof p === 'string')
    .map((p) => p.trim())
    .filter((p) => p.length > 0 && p.length <= PHRASE_CHAR_CAP)
    .slice(0, PHRASES_PER_SESSION_CAP)
  if (incoming.length === 0) return null

  const merged = [...(existing ?? [])]
  for (const phrase of incoming) {
    const idx = merged.findIndex((m) => m.toLowerCase() === phrase.toLowerCase())
    if (idx >= 0) merged.splice(idx, 1)
    merged.push(phrase)
  }
  return merged.slice(-LEXICON_CAP)
}

// The one candidate (if any) eligible to be offered this session. Most-seen
// wins — the strongest evidence gets the scarce proposal slot.
export function selectProposalCandidate(parts: UserPart[], now: number): UserPart | null {
  const eligible = parts.filter(
    (p) =>
      p.status === 'candidate' &&
      p.sessionsSeen >= PROPOSAL_SESSIONS_SEEN &&
      p.dismissedCount === 0 &&
      (p.proposedAt === undefined || now - p.proposedAt > PROPOSAL_RETRY_MS),
  )
  if (eligible.length === 0) return null
  return eligible.reduce((best, p) => (p.sessionsSeen > best.sessionsSeen ? p : best))
}
