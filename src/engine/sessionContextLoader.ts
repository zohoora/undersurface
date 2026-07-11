import type { PartMemory, UserProfile, PersonalFacts, RelaxSession, RuptureEvidence, CompanionSignals, UserPart, SessionIntention, StanceProfile, UserValue, CompanionPromise, MemoryAperture, InterventionOutcome, AlliancePreferences, CompanionPreferences, PersonalProtocol, LivingHypothesis, ResearchEvent } from '../types'
import { db } from '../store/db'
import { getGlobalConfig } from '../store/globalConfig'
import { detectOpenTimeEvidence } from './ruptureDetector'
import { RUMINATION_WATCH_ARM_STREAK } from './signalTracker'
import { selectProposalCandidate } from './userPartTracker'
import { orderForFollowUp, selectPatternToName } from './intentionTracker'
import { selectValueProposal } from './userValueTracker'
import { isFreshEyesSession } from './freshEyes'

export interface TherapistContext {
  memoryAperture: MemoryAperture
  fieldMosaicEnabled: boolean
  outcomeContext: string[]
  companionPreferences: CompanionPreferences | null
  alliancePreferences?: AlliancePreferences
  activePersonalProtocols: PersonalProtocol[]
  recentConductorEvents: ResearchEvent[]
  livingHypotheses: Array<{ text: string; status: 'confirmed' | 'contested' }>
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
  intentionPatternToName: { id: string; text: string; valueName?: string } | null
  // Internal stance tendencies (flag-gated).
  stanceEntries: string[]
  // Confirmed values (flag-gated) + at most one value-proposal candidate.
  activeValues: { name: string; description: string }[]
  valueProposalCandidate: { id: string; tentativeName: string; description: string; quote: string } | null
  // id → name map so intentions can show which value they serve.
  valueNamesById: Record<string, string>
  // Interiority bundle (flag-gated): carried noticing (opener, consume-once),
  // disclosure inputs, due/missed promises, and whether new ones may be made.
  carriedNoticing: { text: string } | null
  disclosureContext: { entries: string[]; recentHindered?: string } | null
  duePromises: { id: string; text: string }[]
  missedPromise: { id: string; text: string } | null
  promiseSlotsOpen: boolean
  // A pending story arc awaiting consume-once delivery (storyArcs flag).
  storyArc: { text: string } | null
  // Model-selected, source-grounded notes from between-session SMS. These
  // remain weak context and must never become identity claims by themselves.
  recentFieldNotes: { text: string; date: number }[]
}

const MEMORY_SOURCE_PARTS = ['open', 'weaver', 'still']
const RECENT_RELAX_LIMIT = 5
const RECENT_FIELD_NOTE_LIMIT = 8
const FIELD_NOTE_MAX_AGE_MS = 14 * 86_400_000

export async function loadTherapistContext(currentSessionId?: string): Promise<TherapistContext> {
  const features = getGlobalConfig()?.features
  const repairOn = features?.ruptureRepair === true
  const pivotOn = features?.ruminationPivot === true
  const userPartsOn = features?.userParts === true
  const intentionsOn = features?.sessionIntentions === true
  const stanceOn = features?.stanceAdaptation === true
  const valuesOn = features?.userValues === true
  const interiorityOn = features?.companionInteriority === true
  const arcsOn = features?.storyArcs === true

  const [sessions, memories, profiles, facts, relaxBreaks, signals, allUserParts, allIntentions, stanceProfile, allValues, allPromises, fieldMoments, smsMessages, preferences, outcomes, personalProtocols, livingHypotheses, conductorEvents] = await Promise.all([
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
    repairOn || pivotOn || interiorityOn || arcsOn ? db.companionSignals.get('current') : Promise.resolve(undefined),
    userPartsOn ? db.userParts.toArray() : Promise.resolve([] as UserPart[]),
    intentionsOn ? db.sessionIntentions.toArray() : Promise.resolve([] as SessionIntention[]),
    stanceOn || interiorityOn ? db.stanceProfile.get('current') : Promise.resolve(undefined as StanceProfile | undefined),
    valuesOn ? db.userValues.toArray() : Promise.resolve([] as UserValue[]),
    interiorityOn ? db.companionPromises.toArray() : Promise.resolve([] as CompanionPromise[]),
    db.fieldMoments?.orderBy('createdAt').reverse().limit(24).toArray() ?? Promise.resolve([]),
    db.smsMessages.orderBy('createdAt').reverse().limit(24).toArray(),
    db.companionPreferences?.get('current') ?? Promise.resolve(undefined),
    db.interventionOutcomes?.orderBy('createdAt').reverse().limit(20).toArray() ?? Promise.resolve([] as InterventionOutcome[]),
    db.personalProtocols?.where('status').equals('active').toArray() ?? Promise.resolve([] as PersonalProtocol[]),
    db.livingHypotheses?.orderBy('updatedAt').reverse().limit(16).toArray() ?? Promise.resolve([] as LivingHypothesis[]),
    db.researchEvents?.orderBy('createdAt').reverse().limit(40).toArray() ?? Promise.resolve([] as ResearchEvent[]),
  ])

  const continuitySessions = sessions.filter(session => !isFreshEyesSession(session))
  const freshSessionIds = new Set(
    sessions.filter(isFreshEyesSession).map(session => session.id),
  )

  // Extract notes from the 5 most recent closed sessions
  const recentSessionNotes = continuitySessions
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
    .filter(memory => !memory.sessionId || !freshSessionIds.has(memory.sessionId))
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
    .filter(r => !r.parentSessionId || !freshSessionIds.has(r.parentSessionId))
    .slice(0, RECENT_RELAX_LIMIT)

  // Rupture evidence: open-time markers (abandoned / atypical gap) computed
  // from prior sessions — excluding the session being opened, which on the
  // resume path is already in the list. Fresh evidence overwrites any stored
  // pendingRepair (newest wins, single slot); otherwise fall back to what the
  // reflection pass stored (terse ending).
  let repairContext: { evidence: RuptureEvidence } | null = null
  if (repairOn) {
    const prior = continuitySessions.filter(s => s.id !== currentSessionId)
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

  const activeValues = valuesOn
    ? allValues.filter((v) => v.status === 'active').map((v) => ({ name: v.name, description: v.description }))
    : []
  const valueCandidate = valuesOn ? selectValueProposal(allValues, Date.now()) : null
  const valueNamesById: Record<string, string> = {}
  if (valuesOn) for (const v of allValues) if (v.status === 'active') valueNamesById[v.id] = v.name

  // Interiority: due promises (next_session always due; dated within 3 days),
  // one missed dated promise (>7 days past), disclosure inputs, carrying.
  const DAY = 86_400_000
  const activePromises = interiorityOn ? allPromises.filter((pr) => pr.status === 'active') : []
  const duePromises = activePromises
    .filter((pr) => pr.dueKind === 'next_session' || (pr.dueDate && new Date(pr.dueDate).getTime() - Date.now() < 3 * DAY && Date.now() - new Date(pr.dueDate).getTime() < 7 * DAY))
    .map((pr) => ({ id: pr.id, text: pr.text }))
  const missed = activePromises.find(
    (pr) => pr.dueKind === 'date' && pr.dueDate && Date.now() - new Date(pr.dueDate).getTime() >= 7 * DAY,
  )
  const recentHindered = interiorityOn
    ? [...(stanceProfile?.rawObservations ?? [])].reverse().find((o) => o.direction === 'hindered')?.observation
    : undefined

  const mosaicNotes = fieldMoments
    .filter(moment => moment.status !== 'dismissed')
    .filter(moment => Date.now() - moment.createdAt <= FIELD_NOTE_MAX_AGE_MS)
    .filter(moment => moment.text.trim().length > 0)
    .map(moment => ({ text: moment.text.trim(), date: moment.createdAt }))
  // Backward compatibility for model-selected notes created before the Field
  // Mosaic collection existed. New writes go to fieldMoments.
  const legacySmsNotes = smsMessages
    .filter(message => message.direction === 'inbound')
    .filter(message => Date.now() - message.createdAt <= FIELD_NOTE_MAX_AGE_MS)
    .map(message => {
      if (message.carryForward === true && message.fieldNote?.trim()) {
        return { text: message.fieldNote.trim(), date: message.createdAt }
      }
      if (message.mode === 'capture' && message.status === 'captured') {
        return { text: message.body, date: message.createdAt }
      }
      return null
    })
    .filter((note): note is { text: string; date: number } => note !== null)
  const seenFieldNotes = new Set<string>()
  const recentFieldNotes = [...mosaicNotes, ...legacySmsNotes]
    .sort((a, b) => b.date - a.date)
    .filter(note => {
      const key = note.text.toLowerCase()
      if (seenFieldNotes.has(key)) return false
      seenFieldNotes.add(key)
      return true
    })
    .slice(0, RECENT_FIELD_NOTE_LIMIT)

  return {
    // Fresh eyes is intentionally never a persistent default. Every new
    // session starts with ordinary continuity and may opt into Fresh eyes for
    // that session only.
    memoryAperture: 'pattern',
    fieldMosaicEnabled: preferences?.fieldMosaicEnabled !== false,
    companionPreferences: preferences ?? null,
    alliancePreferences: preferences?.alliance,
    activePersonalProtocols: personalProtocols,
    recentConductorEvents: conductorEvents.filter(event => event.protocolId === 'adaptive-conductor-v1'),
    livingHypotheses: livingHypotheses
      .filter(item => !item.sourceSessionId || !freshSessionIds.has(item.sourceSessionId))
      .filter(item => item.status === 'confirmed' || item.status === 'contested')
      .map(item => ({ text: item.text, status: item.status as 'confirmed' | 'contested' })),
    outcomeContext: outcomes
      .filter(outcome => !outcome.sessionId || !freshSessionIds.has(outcome.sessionId))
      .filter(outcome => outcome.immediate || outcome.delayed)
      .slice(0, 8)
      .map(outcome => `${outcome.source} ${outcome.intervention}: immediate ${outcome.immediate ?? 'not rated'}${outcome.delayed ? `; later ${outcome.delayed}` : ''}${outcome.agency ? `; agency ${outcome.agency}` : ''}`),
    recentSessionNotes,
    relevantMemories: allMemories,
    userProfile,
    personalFacts: facts ?? null,
    recentRelaxBreaks,
    repairContext,
    ruminationWatch,
    activeUserParts,
    partProposalCandidate,
    openIntentions: orderedIntentions.map((i) => ({
      id: i.id, text: i.text, notYetCount: i.notYetCount,
      serves: i.valueId ? valueNamesById[i.valueId] : undefined,
    })),
    intentionSlotsOpen: intentionsOn && orderedIntentions.length < 3,
    intentionPatternToName: patternToName
      ? { id: patternToName.id, text: patternToName.text, valueName: patternToName.valueId ? valueNamesById[patternToName.valueId] : undefined }
      : null,
    stanceEntries: stanceOn ? stanceProfile?.entries ?? [] : [],
    activeValues,
    valueProposalCandidate: valueCandidate
      ? { id: valueCandidate.id, tentativeName: valueCandidate.name, description: valueCandidate.description, quote: valueCandidate.evidence.at(-1)?.quote ?? '' }
      : null,
    valueNamesById,
    carriedNoticing: interiorityOn && signals?.carriedNoticing?.text
      ? { text: signals.carriedNoticing.text }
      : null,
    disclosureContext: interiorityOn && (stanceProfile?.entries?.length || recentHindered)
      ? { entries: stanceProfile?.entries ?? [], recentHindered }
      : null,
    duePromises,
    missedPromise: missed ? { id: missed.id, text: missed.text } : null,
    promiseSlotsOpen: interiorityOn && activePromises.length < 2,
    storyArc: arcsOn && signals?.pendingArc?.text ? { text: signals.pendingArc.text } : null,
    recentFieldNotes,
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
