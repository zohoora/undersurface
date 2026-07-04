import type { UserValue } from '../types'
import { generateId } from '../store/db'

// Merge engine for user-value observations — same collaborative grammar as
// userPartTracker (precision-first, retired never resurrected), with values-
// specific caps. Spec: docs/superpowers/specs/2026-07-04-companion-depth-program.md

const EVIDENCE_CAP = 8
const QUOTE_WORD_CAP = 15
const ACTIVE_CAP = 6
const CANDIDATE_CAP = 4
const OBSERVATIONS_PER_SESSION_CAP = 2
const PROPOSAL_SESSIONS_SEEN = 2
const PROPOSAL_RETRY_MS = 7 * 24 * 3_600_000

function truncateQuote(quote: string): string {
  return quote.trim().split(/\s+/).slice(0, QUOTE_WORD_CAP).join(' ')
}

export function applyValueObservations(
  existing: UserValue[],
  observations: unknown,
  sessionId: string,
  now: number,
): { updates: UserValue[]; creates: UserValue[] } {
  const updates: UserValue[] = []
  const creates: UserValue[] = []
  if (!Array.isArray(observations)) return { updates, creates }

  const candidateCount = existing.filter((v) => v.status === 'candidate').length
  const activeCount = existing.filter((v) => v.status === 'active').length
  let budget = OBSERVATIONS_PER_SESSION_CAP
  const touched = new Set<string>()

  for (const raw of observations) {
    if (budget <= 0) break
    if (typeof raw !== 'object' || raw === null) continue
    const r = raw as Record<string, unknown>

    if (typeof r.valueId === 'string' && typeof r.quote === 'string' && r.quote.trim()) {
      const value = existing.find((v) => v.id === r.valueId && v.status !== 'retired')
      if (!value || touched.has(value.id)) continue
      const alreadyThisSession = value.evidence.some((e) => e.sessionId === sessionId)
      updates.push({
        ...value,
        evidence: [...value.evidence, { sessionId, quote: truncateQuote(r.quote), observedAt: now }].slice(-EVIDENCE_CAP),
        sessionsSeen: alreadyThisSession ? value.sessionsSeen : value.sessionsSeen + 1,
        lastActiveAt: now,
        updatedAt: now,
      })
      touched.add(value.id)
      budget--
      continue
    }

    if (
      typeof r.tentativeName === 'string' && r.tentativeName.trim() &&
      typeof r.description === 'string' && r.description.trim() &&
      typeof r.quote === 'string' && r.quote.trim()
    ) {
      if (candidateCount + creates.length >= CANDIDATE_CAP) continue
      if (activeCount >= ACTIVE_CAP) continue
      creates.push({
        id: generateId(),
        name: r.tentativeName.trim().slice(0, 60),
        description: r.description.trim().slice(0, 200),
        status: 'candidate',
        evidence: [{ sessionId, quote: truncateQuote(r.quote), observedAt: now }],
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

export function selectValueProposal(values: UserValue[], now: number): UserValue | null {
  const eligible = values.filter(
    (v) =>
      v.status === 'candidate' &&
      v.sessionsSeen >= PROPOSAL_SESSIONS_SEEN &&
      v.dismissedCount === 0 &&
      (v.proposedAt === undefined || now - v.proposedAt > PROPOSAL_RETRY_MS),
  )
  if (eligible.length === 0) return null
  return eligible.reduce((best, v) => (v.sessionsSeen > best.sessionsSeen ? v : best))
}
