import type {
  CompanionPreferences,
  CompanionResponseMode,
  InterventionOutcome,
  PersonalProtocol,
  ResearchArm,
  ResearchEvent,
  ResearchProtocolId,
  Session,
  SessionMessage,
  SessionResearchContext,
  TransferLevel,
} from '../types'
import { containsAmbiguityPrism } from '../ai/ambiguityPrismParser'

export const PERSONAL_SCIENCE_APP_VERSION = '2026-07-10.2'
export const PERSONAL_SCIENCE_PROMPT_VERSION = 'personal-science-v2'
export const PERSONAL_SCIENCE_PROTOCOL_VERSION = 1
export const TRANSFER_LEVELS: TransferLevel[] = ['companion_led', 'user_first', 'minimal_cue', 'independent']
const TRANSFERABLE_ARMS: ResearchArm[] = ['witness', 'reflect', 'clarify', 'make_concrete', 'user_first', 'offer_action', 'offer_quiet', 'close_warmly']

export interface ResearchAssignment {
  event: ResearchEvent
  delivery: 'model' | 'fixed_silence' | 'fixed_journal_offer' | 'fixed_transfer'
  responseMode: CompanionResponseMode
  directive?: string
}

export function validateResearchDelivery(
  assignment: ResearchAssignment,
  finalizedText: string,
): { delivered: true } | { delivered: false; reason: string } {
  if (assignment.event.assignedArm === 'ambiguity_prism' && !containsAmbiguityPrism(finalizedText)) {
    return { delivered: false, reason: 'prism_marker_contract_failed' }
  }
  return { delivered: true }
}

export interface ResearchFinding {
  id: string
  protocolId: Exclude<ResearchProtocolId, 'naturalistic-sms-v1' | 'transfer-ladder-v1' | 'field-window-timing-v1'>
  preferredArm: ResearchArm
  comparedArms: ResearchArm[]
  context: Omit<SessionResearchContext, 'capturedAt' | 'skipped'>
  ratedEvents: number
  preferredSamples: number
  helpedCount: number
  negativeCount: number
  confidence: PersonalProtocol['confidence']
  evidenceEventIds: string[]
}

export interface TransferEvidence {
  status: 'not_started' | 'collecting' | 'ready' | 'hold' | 'graduated'
  currentLevel: TransferLevel
  nextLevel?: TransferLevel
  ratedEvents: number
  currentSamples: number
  nextSamples: number
  nextAgencyMore: number
  nextNegative: number
  evidenceEventIds: string[]
}

export interface HalfLifeEvidence {
  status: 'early' | 'carried' | 'faded' | 'mixed'
  laterTodayReports: number
  laterTodayUseful: number
  nextDayReports: number
  nextDayUseful: number
  regretCount: number
  evidenceEventIds: string[]
}

export function isTransferableArm(arm: ResearchArm): boolean {
  return TRANSFERABLE_ARMS.includes(arm)
}

function hashString(value: string): number {
  let hash = 2166136261
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function completeContext(
  context?: SessionResearchContext,
): context is SessionResearchContext & Required<Pick<SessionResearchContext, 'state' | 'capacity' | 'need'>> {
  return Boolean(context && !context.skipped && context.state && context.capacity && context.need)
}

function armForResponseGrammar(seed: number, need: NonNullable<SessionResearchContext['need']>): CompanionResponseMode {
  const arms: Record<NonNullable<SessionResearchContext['need']>, CompanionResponseMode[]> = {
    witness: ['witness', 'clarify', 'offer_quiet'],
    settle: ['offer_quiet', 'witness', 'handoff'],
    perspective: ['reflect', 'make_concrete', 'user_first'],
    action: ['offer_action', 'make_concrete', 'user_first'],
  }
  const candidates = arms[need]
  return candidates[seed % candidates.length]
}

function responseModeForArm(arm: ResearchArm): CompanionResponseMode {
  if (arm === 'transfer_companion_led') return 'reflect'
  if (arm === 'transfer_user_first' || arm === 'transfer_minimal_cue') return 'user_first'
  if (arm === 'transfer_independent') return 'offer_quiet'
  if (arm === 'designed_silence') return 'offer_quiet'
  if (arm === 'offer_journal_arc' || arm === 'journal_arc' || arm === 'speak_arc' || arm === 'relax_arc' || arm === 'drift_arc') return 'handoff'
  if (arm === 'generated_response' || arm === 'continue_talk') return 'reflect'
  if (arm === 'field_check_in') return 'clarify'
  if (arm === 'field_no_contact') return 'offer_quiet'
  if (arm === 'single_hypothesis' || arm === 'ambiguity_prism') return 'reflect'
  return arm
}

function deliveryForArm(arm: ResearchArm): ResearchAssignment['delivery'] {
  if (arm === 'transfer_user_first' || arm === 'transfer_minimal_cue' || arm === 'transfer_independent') return 'fixed_transfer'
  if (arm === 'designed_silence') return 'fixed_silence'
  if (arm === 'offer_journal_arc') return 'fixed_journal_offer'
  return 'model'
}

function transferArm(level: TransferLevel): ResearchArm {
  return `transfer_${level}` as ResearchArm
}

export function transferLevelForArm(arm?: ResearchArm): TransferLevel | undefined {
  if (!arm?.startsWith('transfer_')) return undefined
  const value = arm.slice('transfer_'.length)
  return TRANSFER_LEVELS.includes(value as TransferLevel) ? value as TransferLevel : undefined
}

export function nextTransferLevel(level: TransferLevel): TransferLevel | undefined {
  const index = TRANSFER_LEVELS.indexOf(level)
  return index >= 0 ? TRANSFER_LEVELS[index + 1] : undefined
}

export function buildExperimentDirective(arm: ResearchArm, preferredArm?: ResearchArm): string | undefined {
  if (arm === 'designed_silence' || arm === 'offer_journal_arc' || deliveryForArm(arm) === 'fixed_transfer') return undefined
  if (arm === 'transfer_companion_led') {
    const move = preferredArm && !preferredArm.startsWith('transfer_') ? preferredArm : 'reflect'
    return `TRANSFER LADDER TURN (writer explicitly enrolled this protocol): perform ${move} as the single primary move. Do not ask the writer to generate it first and do not mention the ladder, assignment, or protocol. Persona, safety, grounding, and the writer's explicit request still outrank this structural assignment.`
  }
  if (arm === 'generated_response') {
    return `PERSONAL SCIENCE TURN (writer opted in): respond naturally using the shared response grammar. Do not mention the experiment, assignment, or internal mode. The interface explains that a comparison occurred.`
  }
  if (arm === 'continue_talk') {
    return `PERSONAL SCIENCE TURN (writer opted in): remain in Talk for this response. Do not offer or emit a surface-switch marker. Choose the most fitting ordinary response move. Do not mention the experiment or assignment.`
  }
  if (arm === 'single_hypothesis') {
    return `AMBIGUITY STUDY TURN (writer opted in): offer ONE bounded, tentative interpretation of the current situation. Use possibility language and leave room for correction. Do not stack alternatives, diagnose, mention the study, or emit prism/rich-action markers.`
  }
  if (arm === 'ambiguity_prism') {
    return `AMBIGUITY PRISM TURN (writer opted in): briefly say that several possibilities may coexist, then emit EXACTLY three distinct, nonexclusive hypotheses on separate lines using these exact wrappers:
[<first short possibility>](#prism:h1)
[<second short possibility>](#prism:h2)
[<third short possibility>](#prism:h3)
At least one must be an ordinary state or situational explanation such as fatigue, timing, or overload. Do not diagnose, imply hidden trauma, repeat one idea three ways, select a winner, ask a follow-up question, mention the study, or emit any other marker.`
  }
  return `PERSONAL SCIENCE TURN (writer opted in): use ${arm} as the single primary response move for this turn. Follow that move faithfully without naming it, the experiment, or the assignment. Persona, safety, grounding, and the writer's explicit request still outrank this structural assignment.`
}

export function assignmentFromEvent(event: ResearchEvent): ResearchAssignment {
  return {
    event,
    delivery: deliveryForArm(event.assignedArm),
    responseMode: event.responseMode ?? responseModeForArm(event.assignedArm),
    directive: buildExperimentDirective(event.assignedArm, event.responseMode),
  }
}

function contextMatches(protocol: PersonalProtocol, context: SessionResearchContext): boolean {
  const conditions = protocol.context ?? {}
  return (!conditions.state || conditions.state === context.state)
    && (!conditions.capacity || conditions.capacity === context.capacity)
    && (!conditions.need || conditions.need === context.need)
}

export function planResearchTurn(
  session: Session,
  messages: SessionMessage[],
  preferences: CompanionPreferences | undefined,
  options: { now?: number; forceEligible?: boolean; grounding?: boolean; protocols?: PersonalProtocol[] } = {},
): ResearchAssignment | null {
  if (options.grounding) return null
  if (session.memoryAperture === 'fresh') return null
  if (preferences?.personalScienceEnabled !== true || !preferences.personalScienceConsentAt) return null
  if (session.status !== 'active' || !completeContext(session.researchContext)) return null

  const userMessages = messages.filter(message => message.speaker === 'user')
  const therapistMessages = messages.filter(message => message.speaker === 'therapist')
  if (userMessages.length < 2 || therapistMessages.length === 0) return null
  if (therapistMessages.at(-1)?.researchEventId) return null

  const priorEvents = therapistMessages.filter(message => message.researchEventId)
  if (priorEvents.length >= 2) return null

  const lastUser = userMessages.at(-1)
  if (!lastUser) return null
  const assignmentSeed = `${session.id}:${lastUser.id}:personal-science-v1`
  const seed = hashString(assignmentSeed)
  if (!options.forceEligible && seed % 2 !== 0) return null

  const transferProtocol = (options.protocols ?? []).find(protocol =>
    protocol.status === 'active'
      && protocol.transferStatus === 'learning'
      && Boolean(protocol.transferLevel)
      && isTransferableArm(protocol.preferredArm)
      && contextMatches(protocol, session.researchContext!),
  )

  if (transferProtocol?.transferLevel) {
    const currentLevel = transferProtocol.transferLevel
    const nextLevel = nextTransferLevel(currentLevel)
    if (nextLevel) {
      const transferSeedText = `${session.id}:${lastUser.id}:transfer-ladder-v1:${transferProtocol.id}:${currentLevel}`
      const transferSeed = hashString(transferSeedText)
      const level = transferSeed % 2 === 0 ? currentLevel : nextLevel
      const assignedArm = transferArm(level)
      const preferredMode = responseModeForArm(transferProtocol.preferredArm)
      const responseMode = level === 'companion_led'
        ? preferredMode
        : responseModeForArm(assignedArm)
      const now = options.now ?? Date.now()
      const delivery = deliveryForArm(assignedArm)
      const event: ResearchEvent = {
        id: `research-${lastUser.id}`,
        protocolId: 'transfer-ladder-v1',
        protocolVersion: PERSONAL_SCIENCE_PROTOCOL_VERSION,
        assignmentKind: 'randomized',
        status: 'assigned',
        source: 'talk',
        sessionId: session.id,
        eligibilityPoint: `transfer-${currentLevel}-to-${nextLevel}-user-turn-${userMessages.length}`,
        assignmentSeed: transferSeedText,
        assignedArm,
        responseMode,
        personalProtocolId: transferProtocol.id,
        transferLevel: level,
        context: {
          state: session.researchContext.state,
          capacity: session.researchContext.capacity,
          need: session.researchContext.need,
        },
        provider: delivery === 'model' ? 'openai' : 'deterministic',
        deliveryFidelity: delivery === 'model' ? 'prompt_assigned' : 'deterministic',
        ...(delivery === 'model' ? { modelVersion: 'gpt-5.5' } : {}),
        promptVersion: PERSONAL_SCIENCE_PROMPT_VERSION,
        appVersion: PERSONAL_SCIENCE_APP_VERSION,
        createdAt: now,
        updatedAt: now,
      }
      return {
        event,
        delivery,
        responseMode,
        directive: buildExperimentDirective(assignedArm, transferProtocol.preferredArm),
      }
    }
  }

  const protocolCount = session.researchContext.need === 'perspective' ? 4 : 3
  const protocolIndex = Math.floor(seed / 2) % protocolCount
  let protocolId: ResearchEvent['protocolId']
  let assignedArm: ResearchArm
  let assignmentKind: ResearchEvent['assignmentKind'] = 'randomized'
  const matchingProtocol = (options.protocols ?? []).find(protocol =>
    protocol.status === 'active'
      && protocol.transferStatus !== 'graduated'
      && contextMatches(protocol, session.researchContext!),
  )
  const policy = preferences.protocolPolicy ?? 'balanced'
  const usePersonalized = Boolean(matchingProtocol)
    && (policy === 'use_what_helped' || (policy === 'balanced' && seed % 3 !== 0))

  if (usePersonalized && matchingProtocol) {
    protocolId = matchingProtocol.protocolId
    assignedArm = matchingProtocol.preferredArm
    assignmentKind = 'personalized'
  } else if (protocolIndex === 0) {
    protocolId = 'response-grammar-v1'
    assignedArm = armForResponseGrammar(seed, session.researchContext.need)
  } else if (protocolIndex === 1) {
    protocolId = 'subtraction-v1'
    assignedArm = seed % 4 < 2 ? 'generated_response' : 'designed_silence'
  } else if (protocolIndex === 2) {
    protocolId = 'surface-choreography-v1'
    assignedArm = seed % 4 < 2 ? 'continue_talk' : 'offer_journal_arc'
  } else {
    protocolId = 'ambiguity-prism-v1'
    const ambiguitySeed = hashString(`${assignmentSeed}:ambiguity-arm`)
    assignedArm = ambiguitySeed % 2 === 0 ? 'single_hypothesis' : 'ambiguity_prism'
  }

  const now = options.now ?? Date.now()
  const responseMode = responseModeForArm(assignedArm)
  const event: ResearchEvent = {
    id: `research-${lastUser.id}`,
    protocolId,
    protocolVersion: PERSONAL_SCIENCE_PROTOCOL_VERSION,
    assignmentKind,
    status: 'assigned',
    source: 'talk',
    sessionId: session.id,
    eligibilityPoint: `${assignmentKind === 'personalized' ? 'personal-protocol-' : ''}user-turn-${userMessages.length}`,
    assignmentSeed,
    assignedArm,
    responseMode,
    context: {
      state: session.researchContext.state,
      capacity: session.researchContext.capacity,
      need: session.researchContext.need,
    },
    provider: deliveryForArm(assignedArm) === 'model' ? 'openai' : 'deterministic',
    deliveryFidelity: deliveryForArm(assignedArm) === 'model' ? 'prompt_assigned' : 'deterministic',
    ...(deliveryForArm(assignedArm) === 'model' ? { modelVersion: 'gpt-5.5' } : {}),
    promptVersion: PERSONAL_SCIENCE_PROMPT_VERSION,
    appVersion: PERSONAL_SCIENCE_APP_VERSION,
    createdAt: now,
    updatedAt: now,
  }
  return {
    event,
    delivery: deliveryForArm(assignedArm),
    responseMode,
    directive: buildExperimentDirective(assignedArm),
  }
}

function scoreOutcome(outcome: InterventionOutcome): number {
  const immediate = {
    helped: 1,
    nothing: 0,
    worse: -1,
    not_wanted: -0.75,
  }[outcome.immediate ?? 'nothing']
  const delayed = {
    stayed: 0.5,
    used: 1,
    nothing: 0,
    regret: -1,
    changed_mind: 0.25,
  }[outcome.delayed ?? 'nothing']
  return immediate + delayed
}

function contextKey(event: ResearchEvent): string {
  const context = event.context ?? {}
  return `${event.protocolId}:${context.state ?? 'unknown'}:${context.capacity ?? 'unknown'}:${context.need ?? 'unknown'}`
}

export function deriveResearchFindings(
  events: ResearchEvent[],
  outcomes: InterventionOutcome[],
  reviewedProtocols: PersonalProtocol[] = [],
): ResearchFinding[] {
  const outcomesByEvent = new Map(
    outcomes.filter(outcome => outcome.researchEventId).map(outcome => [outcome.researchEventId!, outcome]),
  )
  const reviewedKeys = new Set(reviewedProtocols.map(protocol => protocol.findingKey))
  const groups = new Map<string, ResearchEvent[]>()

  for (const event of events) {
    if (event.protocolId === 'transfer-ladder-v1' || event.protocolId === 'field-window-timing-v1') continue
    if (event.assignmentKind !== 'randomized' || event.status !== 'delivered' || !event.deliveredArm) continue
    if (!outcomesByEvent.has(event.id)) continue
    const key = contextKey(event)
    groups.set(key, [...(groups.get(key) ?? []), event])
  }

  const findings: ResearchFinding[] = []
  for (const [key, group] of groups) {
    if (reviewedKeys.has(key) || group.length < 3) continue
    const armStats = new Map<ResearchArm, { score: number; samples: number; helped: number; negative: number; ids: string[] }>()
    for (const event of group) {
      const arm = event.deliveredArm!
      const outcome = outcomesByEvent.get(event.id)!
      const stats = armStats.get(arm) ?? { score: 0, samples: 0, helped: 0, negative: 0, ids: [] }
      stats.score += scoreOutcome(outcome)
      stats.samples += 1
      stats.helped += outcome.immediate === 'helped' || outcome.delayed === 'used' || outcome.delayed === 'stayed' ? 1 : 0
      stats.negative += outcome.immediate === 'worse' || outcome.immediate === 'not_wanted' || outcome.delayed === 'regret' ? 1 : 0
      stats.ids.push(event.id)
      armStats.set(arm, stats)
    }
    if (armStats.size < 2) continue
    const ranked = [...armStats.entries()].sort((a, b) => (b[1].score / b[1].samples) - (a[1].score / a[1].samples))
    const [bestArm, best] = ranked[0]
    const second = ranked[1][1]
    if ((best.score / best.samples) - (second.score / second.samples) < 0.25) continue
    const first = group[0]
    if (first.protocolId === 'naturalistic-sms-v1' || first.protocolId === 'transfer-ladder-v1' || first.protocolId === 'field-window-timing-v1') continue
    findings.push({
      id: key,
      protocolId: first.protocolId,
      preferredArm: bestArm,
      comparedArms: ranked.map(([arm]) => arm),
      context: first.context ?? {},
      ratedEvents: group.length,
      preferredSamples: best.samples,
      helpedCount: best.helped,
      negativeCount: best.negative,
      confidence: group.length >= 12 ? 'repeated' : group.length >= 6 ? 'emerging' : 'early',
      evidenceEventIds: group.map(event => event.id),
    })
  }
  return findings.sort((a, b) => b.ratedEvents - a.ratedEvents)
}

function isNegativeOutcome(outcome: InterventionOutcome): boolean {
  return outcome.immediate === 'worse'
    || outcome.immediate === 'not_wanted'
    || outcome.delayed === 'regret'
}

function transferScore(outcome: InterventionOutcome): number {
  const agency = outcome.agency === 'more' ? 0.75 : outcome.agency === 'less' ? -0.75 : 0
  return scoreOutcome(outcome) + agency
}

export function deriveTransferEvidence(
  protocol: PersonalProtocol,
  events: ResearchEvent[],
  outcomes: InterventionOutcome[],
): TransferEvidence {
  const currentLevel = protocol.transferLevel ?? 'companion_led'
  if (protocol.transferStatus === 'graduated') {
    return {
      status: 'graduated',
      currentLevel: 'independent',
      ratedEvents: 0,
      currentSamples: 0,
      nextSamples: 0,
      nextAgencyMore: 0,
      nextNegative: 0,
      evidenceEventIds: [],
    }
  }
  if (!protocol.transferStatus || protocol.transferStatus === 'not_started' || protocol.transferStatus === 'paused') {
    return {
      status: 'not_started', currentLevel, ratedEvents: 0, currentSamples: 0,
      nextSamples: 0, nextAgencyMore: 0, nextNegative: 0, evidenceEventIds: [],
    }
  }
  const nextLevel = nextTransferLevel(currentLevel)
  if (!nextLevel) {
    return {
      status: 'ready', currentLevel, ratedEvents: 0, currentSamples: 0,
      nextSamples: 0, nextAgencyMore: 0, nextNegative: 0, evidenceEventIds: [],
    }
  }
  const outcomesByEvent = new Map(
    outcomes.filter(outcome => outcome.researchEventId).map(outcome => [outcome.researchEventId!, outcome]),
  )
  const relevant = events.filter(event =>
    event.protocolId === 'transfer-ladder-v1'
      && event.personalProtocolId === protocol.id
      && event.assignmentKind === 'randomized'
      && event.status === 'delivered'
      && Boolean(event.deliveredArm)
      && outcomesByEvent.has(event.id)
      && (!protocol.transferStartedAt || event.createdAt >= protocol.transferStartedAt)
      && (event.transferLevel === currentLevel || event.transferLevel === nextLevel),
  )
  const byLevel = (level: TransferLevel) => relevant.filter(event => event.transferLevel === level)
  const currentEvents = byLevel(currentLevel)
  const nextEvents = byLevel(nextLevel)
  const nextOutcomes = nextEvents.map(event => outcomesByEvent.get(event.id)!)
  const evidence: Omit<TransferEvidence, 'status'> = {
    currentLevel,
    nextLevel,
    ratedEvents: relevant.length,
    currentSamples: currentEvents.length,
    nextSamples: nextEvents.length,
    nextAgencyMore: nextOutcomes.filter(outcome => outcome.agency === 'more').length,
    nextNegative: nextOutcomes.filter(isNegativeOutcome).length,
    evidenceEventIds: relevant.map(event => event.id),
  }
  if (relevant.length < 6 || currentEvents.length < 2 || nextEvents.length < 2) {
    return { status: 'collecting', ...evidence }
  }
  const mean = (rows: ResearchEvent[]) => rows.reduce((sum, event) => sum + transferScore(outcomesByEvent.get(event.id)!), 0) / rows.length
  const currentMean = mean(currentEvents)
  const nextMean = mean(nextEvents)
  const hasRegret = nextOutcomes.some(outcome => outcome.delayed === 'regret')
  const ready = nextMean >= currentMean - 0.25
    && evidence.nextNegative <= 1
    && !hasRegret
    && evidence.nextAgencyMore >= 1
  return { status: ready ? 'ready' : 'hold', ...evidence }
}

export function deriveHalfLifeEvidence(
  protocol: PersonalProtocol,
  events: ResearchEvent[],
  outcomes: InterventionOutcome[],
): HalfLifeEvidence {
  const seedIds = new Set(protocol.evidenceEventIds)
  const relevantIds = new Set(events
    .filter(event => seedIds.has(event.id) || event.personalProtocolId === protocol.id)
    .map(event => event.id))
  const relevant = outcomes.filter(outcome => outcome.researchEventId && relevantIds.has(outcome.researchEventId))
  const horizonRows = relevant.flatMap(outcome => outcome.horizonOutcomes ?? [])
  const laterToday = horizonRows.filter(row => row.horizon === 'later_today')
  const nextDay = horizonRows.filter(row => row.horizon === 'next_day')
  const useful = (outcome: InterventionOutcome['delayed']) => outcome === 'stayed' || outcome === 'used'
  const evidence: Omit<HalfLifeEvidence, 'status'> = {
    laterTodayReports: laterToday.length,
    laterTodayUseful: laterToday.filter(row => useful(row.outcome)).length,
    nextDayReports: nextDay.length,
    nextDayUseful: nextDay.filter(row => useful(row.outcome)).length,
    regretCount: horizonRows.filter(row => row.outcome === 'regret').length,
    evidenceEventIds: relevant.map(outcome => outcome.researchEventId!),
  }
  if (horizonRows.length < 3) return { status: 'early', ...evidence }
  if (evidence.nextDayUseful >= 2 && evidence.regretCount === 0) return { status: 'carried', ...evidence }
  if (evidence.laterTodayUseful > 0 && evidence.nextDayReports > 0 && evidence.nextDayUseful === 0) {
    return { status: 'faded', ...evidence }
  }
  return { status: 'mixed', ...evidence }
}

export function labelForResearchArm(arm: ResearchArm): string {
  return ({
    witness: 'being witnessed',
    reflect: 'a concise reflection',
    clarify: 'one precise question',
    make_concrete: 'making it concrete',
    user_first: 'finding your words first',
    offer_action: 'one small action',
    offer_quiet: 'a quiet pause',
    handoff: 'changing the form',
    close_warmly: 'a warm ending',
    generated_response: 'a generated response',
    designed_silence: 'designed silence',
    continue_talk: 'continuing in Talk',
    offer_journal_arc: 'a short Journal arc',
    journal_arc: 'a Journal arc',
    speak_arc: 'a Speak arc',
    relax_arc: 'a Relax arc',
    drift_arc: 'a Drift arc',
    transfer_companion_led: 'the companion leading',
    transfer_user_first: 'you going first',
    transfer_minimal_cue: 'a minimal cue',
    transfer_independent: 'trying it independently',
    field_check_in: 'a field-window check-in',
    field_no_contact: 'deliberate quiet',
    single_hypothesis: 'one tentative interpretation',
    ambiguity_prism: 'several tentative possibilities',
  })[arm]
}
