import type { PartMemory, UserProfile, PersonalFacts, RelaxSession, RuptureEvidence, CompanionSignals, UserPart, SessionIntention, StanceProfile } from '../types'
import { db } from '../store/db'
import { getGlobalConfig } from '../store/globalConfig'
import { detectOpenTimeEvidence } from './ruptureDetector'
import { RUMINATION_WATCH_ARM_STREAK } from './signalTracker'
import { selectProposalCandidate } from './userPartTracker'
import { orderForFollowUp, selectPatternToName } from './intentionTracker'

export interface TherapistContext {
  recentSessionNotes: { note: string; date: number }[]
  relevantMemories: PartMemory[]
  userProfile: UserProfile | null
  personalFacts: PersonalFacts | null
  // Most recent relax sessions across the user's history. Used at session
  // start to inform the therapist about recent breathwork/meditation work.
  recentRelaxBreaks: RelaxSession[]
  // Rupture evidence for the opener (flag-gated; null when nothing fired).
  // Persisted as pendingRepair before returning, so the stream's consume-once
  // clearing is uniform whether the evidence came from open-time detection or
  // the reflection pass.
  repairContext: { evidence: RuptureEvidence } | null
  // Armed cross-session rumination watch (streak >= 3), flag-gated.
  ruminationWatch: { theme: string } | null
  // The writer's CONFIRMED parts (their names/words), flag-gated.
  activeUserParts: { name: string; description: string; stance: string }[]
  // At most one candidate eligible to be offered this session, flag-gated.
  partProposalCandidate: { id: string; tentativeName: string; description: string; quote: string } | null
  // Open intentions ordered for follow-up (flag-gated) + whether slots remain
  // for a closing offer, + at most one slipping intention to name once.
  openIntentions: { id: string; text: string; notYetCount: number }[]
  intentionSlotsOpen: boolean
  intentionPatternToName: { id: string; text: string } | null
  // Internal stance tendencies (flag-gated).
  stanceEntries: string[]
}

const MEMORY_SOURCE_PARTS = ['open', 'weaver', 'still']
const RECENT_RELAX_LIMIT = 5

export async function loadTherapistContext(currentSessionId?: string): Promise<TherapistContext> {
  const features = getGlobalConfig()?.features
  const repairOn = features?.ruptureRepair === true
  const pivotOn = features?.ruminationPivot === true
  const userPartsOn = features?.userParts === true
  const intentionsOn = features?.sessionIntentions === true
  const stanceOn = features?.stanceAdaptation === true

  const [sessions, memories, profiles, facts, relaxBreaks, signals, allUserParts, allIntentions, stanceProfile] = await Promise.all([
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
    repairOn || pivotOn ? db.companionSignals.get('current') : Promise.resolve(undefined),
    userPartsOn ? db.userParts.toArray() : Promise.resolve([] as UserPart[]),
    intentionsOn ? db.sessionIntentions.toArray() : Promise.resolve([] as SessionIntention[]),
    stanceOn ? db.stanceProfile.get('current') : Promise.resolve(undefined as StanceProfile | undefined),
  ])

  // Extract notes from the 5 most recent closed sessions
  const recentSessionNotes = sessions
    .filter(s => s.status === 'closed' && s.sessionNote)
    .slice(0, 5)
    .map(s => ({ note: s.sessionNote!, date: s.endedAt ?? s.startedAt }))

  // Combine, dedup by content, sort newest-first, take 12. Dedup defends
  // against historical triplicated pattern memories (same string written once
  // per manager/self part before the source fix) so one pattern can't crowd out
  // the others in the prompt.
  const seenContent = new Set<string>()
  const allMemories = memories
    .flat()
    .sort((a, b) => b.timestamp - a.timestamp)
    .filter(m => {
      const key = m.content.trim().toLowerCase()
      if (seenContent.has(key)) return false
      seenContent.add(key)
      return true
    })
    .slice(0, 12)

  const userProfile = profiles.length > 0 ? profiles[0] : null

  // Filter to completed sessions and trim. Query already returned newest-first
  // by startedAt; sort by endedAt for display ordering when both fields exist.
  const recentRelaxBreaks = relaxBreaks
    .filter(r => r.endedAt !== null)
    .slice(0, RECENT_RELAX_LIMIT)

  // Rupture evidence: open-time markers (abandoned / atypical gap) computed
  // from prior sessions — excluding the session being opened, which on the
  // resume path is already in the list. Fresh evidence overwrites any stored
  // pendingRepair (newest wins, single slot); otherwise fall back to what the
  // reflection pass stored (terse ending).
  let repairContext: { evidence: RuptureEvidence } | null = null
  if (repairOn) {
    const prior = sessions.filter(s => s.id !== currentSessionId)
    const openEvidence = detectOpenTimeEvidence(prior, Date.now())
    if (openEvidence) {
      repairContext = { evidence: openEvidence }
      const updated: CompanionSignals = {
        id: 'current',
        pendingRepair: {
          evidence: openEvidence,
          sourceSessionId: prior[0]?.id ?? '',
          createdAt: Date.now(),
        },
        ruminationWatch: signals?.ruminationWatch ?? null,
        updatedAt: Date.now(),
      }
      // Await so the stream's later consume-once clear can't be overtaken.
      if (signals) await db.companionSignals.update('current', updated)
      else await db.companionSignals.add(updated)
    } else if (signals?.pendingRepair) {
      repairContext = { evidence: signals.pendingRepair.evidence }
    }
  }

  const ruminationWatch =
    pivotOn && signals?.ruminationWatch && signals.ruminationWatch.streak >= RUMINATION_WATCH_ARM_STREAK
      ? { theme: signals.ruminationWatch.theme }
      : null

  const activeUserParts = userPartsOn
    ? allUserParts
        .filter((p) => p.status === 'active')
        .map((p) => ({ name: p.name, description: p.description, stance: p.stance }))
    : []
  const candidate = userPartsOn ? selectProposalCandidate(allUserParts, Date.now()) : null
  const partProposalCandidate = candidate
    ? {
        id: candidate.id,
        tentativeName: candidate.name,
        description: candidate.description,
        quote: candidate.evidence.at(-1)?.quote ?? '',
      }
    : null

  const orderedIntentions = intentionsOn ? orderForFollowUp(allIntentions) : []
  const patternToName = intentionsOn ? selectPatternToName(allIntentions) : null

  return {
    recentSessionNotes,
    relevantMemories: allMemories,
    userProfile,
    personalFacts: facts ?? null,
    recentRelaxBreaks,
    repairContext,
    ruminationWatch,
    activeUserParts,
    partProposalCandidate,
    openIntentions: orderedIntentions.map((i) => ({ id: i.id, text: i.text, notYetCount: i.notYetCount })),
    intentionSlotsOpen: intentionsOn && orderedIntentions.length < 3,
    intentionPatternToName: patternToName ? { id: patternToName.id, text: patternToName.text } : null,
    stanceEntries: stanceOn ? stanceProfile?.entries ?? [] : [],
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
