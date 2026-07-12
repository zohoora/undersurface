import type {
  CompanionResponseMode,
  ConductorCandidate,
  ConductorDecision,
  ConductorReason,
  PersonalProtocol,
  ResearchArm,
  ResearchEvent,
  Session,
  SessionMessage,
  SessionResearchContext,
  SessionSurface,
} from '../types'
import { buildExperimentDirective, type ResearchAssignment } from './personalScience'

export const CONDUCTOR_PROTOCOL_VERSION = 1
export const CONDUCTOR_PROMPT_VERSION = 'adaptive-conductor-v1'
export const CONDUCTOR_APP_VERSION = '2026-07-11.1'
export const CONDUCTOR_SHADOW_FLOOR = 3

const SURFACE_ARMS: Partial<Record<SessionSurface, ResearchArm>> = {
  journal: 'journal_arc',
  speak: 'speak_arc',
  room: 'room_arc',
}
const SURFACE_ARM_SET = new Set<ResearchArm>(Object.values(SURFACE_ARMS))

export interface ConductorPlan {
  event: ResearchEvent
  assignment: ResearchAssignment | null
}

export interface ConductorOptions {
  grounding?: boolean
  availableSurfaces: SessionSurface[]
  recentEvents?: ResearchEvent[]
  protocols?: PersonalProtocol[]
  now?: number
  forcePhase?: 'shadow' | 'live'
}

function hashString(value: string): number {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function responseModeForArm(arm: ResearchArm): CompanionResponseMode {
  if (arm === 'continue_talk' || arm === 'generated_response') return 'reflect'
  if (SURFACE_ARM_SET.has(arm) || arm === 'offer_journal_arc') return 'handoff'
  if (arm.startsWith('transfer_')) {
    return arm === 'transfer_companion_led' ? 'reflect' : arm === 'transfer_independent' ? 'offer_quiet' : 'user_first'
  }
  if (arm === 'single_hypothesis' || arm === 'ambiguity_prism') return 'reflect'
  if (arm === 'field_check_in') return 'clarify'
  if (arm === 'field_no_contact' || arm === 'designed_silence') return 'offer_quiet'
  return arm as CompanionResponseMode
}

function contextFor(session: Session, now: number): SessionResearchContext {
  const context = session.researchContext
  if (context && !context.skipped && context.state && context.capacity && context.need) return context
  return { state: 'open', capacity: 'few_minutes', need: 'witness', capturedAt: now }
}

function contextMatches(protocol: PersonalProtocol, context: SessionResearchContext): boolean {
  return (!protocol.context?.state || protocol.context.state === context.state)
    && (!protocol.context?.capacity || protocol.context.capacity === context.capacity)
    && (!protocol.context?.need || protocol.context.need === context.need)
}

function rankCandidates(
  text: string,
  context: SessionResearchContext,
  availableSurfaces: SessionSurface[],
  protocols: PersonalProtocol[],
): ConductorCandidate[] {
  const scores = new Map<ResearchArm, { score: number; reasons: Set<ConductorReason> }>()
  const available = new Set(availableSurfaces)
  const add = (arm: ResearchArm, score: number, reason: ConductorReason) => {
    if (SURFACE_ARM_SET.has(arm)) {
      const surface = Object.entries(SURFACE_ARMS).find(([, value]) => value === arm)?.[0] as SessionSurface | undefined
      if (!surface || !available.has(surface)) return
    }
    const current = scores.get(arm) ?? { score: 0, reasons: new Set<ConductorReason>() }
    current.score += score
    current.reasons.add(reason)
    scores.set(arm, current)
  }

  add('witness', 24, 'ordinary_fit')
  add('reflect', 22, 'ordinary_fit')
  add('clarify', 16, 'ordinary_fit')
  add('make_concrete', 15, 'ordinary_fit')
  add('user_first', 14, 'ordinary_fit')
  add('offer_action', 12, 'ordinary_fit')
  add('offer_quiet', 13, 'ordinary_fit')
  add('close_warmly', 8, 'ordinary_fit')
  for (const arm of Object.values(SURFACE_ARMS)) add(arm, 8, 'ordinary_fit')

  if (context.need === 'witness') {
    add('witness', 58, 'ambient_need'); add('reflect', 28, 'ambient_need')
  } else if (context.need === 'settle') {
    add('room_arc', 58, 'ambient_need')
    add('offer_quiet', 42, 'ambient_need'); add('witness', 28, 'ambient_need')
  } else if (context.need === 'perspective') {
    add('make_concrete', 52, 'ambient_need'); add('user_first', 38, 'ambient_need')
    add('reflect', 30, 'ambient_need'); add('journal_arc', 26, 'ambient_need')
  } else if (context.need === 'action') {
    add('offer_action', 58, 'ambient_need'); add('make_concrete', 32, 'ambient_need')
    add('user_first', 28, 'ambient_need')
  }

  if (context.capacity === 'brief') {
    add('close_warmly', 30, 'limited_capacity'); add('offer_quiet', 25, 'limited_capacity')
    add('room_arc', 12, 'limited_capacity')
    add('journal_arc', -12, 'limited_capacity'); add('speak_arc', -12, 'limited_capacity')
  }
  if (context.state === 'looping') {
    add('make_concrete', 40, 'looping'); add('room_arc', 24, 'looping'); add('offer_quiet', 18, 'looping')
  } else if (context.state === 'stirred') {
    add('witness', 34, 'stirred'); add('room_arc', 25, 'stirred')
  } else if (context.state === 'flat') {
    add('user_first', 28, 'ambient_need'); add('speak_arc', 22, 'ambient_need')
  }

  const normalized = text.normalize('NFKC').toLowerCase()
  const words = normalized.trim().split(/\s+/).filter(Boolean)
  if (/\b(write|writing|journal|put (?:it|this) down|privately)\b/.test(normalized)) add('journal_arc', 78, 'explicit_writing')
  if (/\b(say (?:it|this) out loud|speak it|talk out loud|hear myself)\b/.test(normalized)) add('speak_arc', 78, 'explicit_speaking')
  if (/\b(tired|exhausted|overwhelmed|tense|tight|panicky|activated|body|shoulders|chest)\b/.test(normalized)) {
    add('room_arc', 54, 'body_activation'); add('offer_quiet', 20, 'body_activation')
  }
  if (/\b(breathe|breathing|calm down|settle my body|slow down)\b/.test(normalized)) add('room_arc', 58, 'body_activation')
  if (/\b(what should i do|how do i|next step|need a plan|help me decide)\b/.test(normalized)) add('offer_action', 42, 'action_language')
  if (/\b(that(?:'s| is) enough|good ?night|done for now|leave it there|need to stop|stop here)\b/.test(normalized)) add('close_warmly', 90, 'closing_language')
  if (words.length >= 120) {
    add('journal_arc', 32, 'long_form'); add('reflect', 22, 'long_form')
  }

  for (const protocol of protocols) {
    if (protocol.status !== 'active' || !contextMatches(protocol, context)) continue
    if (protocol.transferStatus === 'graduated') {
      add('user_first', 38, 'transfer_fading'); add('offer_quiet', 32, 'transfer_fading'); add('close_warmly', 18, 'transfer_fading')
    } else if (!protocol.preferredArm.startsWith('transfer_')) {
      add(protocol.preferredArm, 38, 'writer_protocol')
    }
  }

  return [...scores.entries()]
    .map(([arm, value]) => ({ arm, score: Math.max(0, value.score), reasons: [...value.reasons] }))
    .sort((left, right) => right.score - left.score || left.arm.localeCompare(right.arm))
    .slice(0, 5)
}

function confidenceFor(candidates: ConductorCandidate[]): ConductorDecision['confidence'] {
  const first = candidates[0]?.score ?? 0
  const second = candidates[1]?.score ?? 0
  const margin = first - second
  if (first >= 78 && margin >= 18) return 'high'
  if (first >= 60 && margin >= 8) return 'medium'
  return 'low'
}

export function planAdaptiveConductor(
  session: Session,
  messages: SessionMessage[],
  options: ConductorOptions,
): ConductorPlan | null {
  if (options.grounding || session.memoryAperture === 'fresh' || session.status !== 'active') return null
  const userMessages = messages.filter(message => message.speaker === 'user')
  const therapistMessages = messages.filter(message => message.speaker === 'therapist')
  if (userMessages.length < 2 || therapistMessages.length === 0) return null
  if (therapistMessages.at(-1)?.researchEventId?.startsWith('conductor-')) return null

  const recentEvents = (options.recentEvents ?? []).filter(event => event.protocolId === 'adaptive-conductor-v1')
  const thisSession = recentEvents.filter(event => event.sessionId === session.id)
  if (thisSession.length >= 2 || thisSession.some(event => event.status === 'delivered' || event.status === 'overridden')) return null

  const lastUser = userMessages.at(-1)
  if (!lastUser) return null
  const now = options.now ?? Date.now()
  const context = contextFor(session, now)
  const availableSurfaces = [...new Set(['talk' as const, ...options.availableSurfaces.filter(surface => surface !== 'talk')])]
  const candidates = rankCandidates(lastUser.content, context, availableSurfaces, options.protocols ?? [])
  if (candidates.length < 2) return null
  const confidence = confidenceFor(candidates)
  const shadowDecisionsBefore = recentEvents.filter(event => event.status === 'shadow').length
  const seedText = `${session.id}:${lastUser.id}:adaptive-conductor-v1`
  const seed = hashString(seedText)
  const learningTransferActive = (options.protocols ?? []).some(protocol =>
    protocol.status === 'active' && protocol.transferStatus === 'learning' && contextMatches(protocol, context),
  )
  const canGoLive = shadowDecisionsBefore >= CONDUCTOR_SHADOW_FLOOR
    && confidence !== 'low'
    && !learningTransferActive
    && seed % 2 === 0
  const phase = options.forcePhase ?? (canGoLive ? 'live' : 'shadow')

  const recommendedArm = candidates[0].arm
  const assignedArm = phase === 'live'
    ? (seed % 4 < 2 ? recommendedArm : SURFACE_ARM_SET.has(recommendedArm) ? 'continue_talk' : candidates.find(candidate => !SURFACE_ARM_SET.has(candidate.arm) && candidate.arm !== recommendedArm)?.arm ?? 'reflect')
    : recommendedArm
  const responseMode = responseModeForArm(assignedArm)
  const decision: ConductorDecision = {
    phase,
    confidence,
    candidates,
    availableSurfaces,
    shadowDecisionsBefore,
  }
  const fixedSurface = SURFACE_ARM_SET.has(assignedArm)
  const event: ResearchEvent = {
    id: `conductor-${lastUser.id}`,
    protocolId: 'adaptive-conductor-v1',
    protocolVersion: CONDUCTOR_PROTOCOL_VERSION,
    assignmentKind: phase === 'live' ? 'randomized' : 'observational',
    status: phase === 'live' ? 'assigned' : 'shadow',
    source: 'talk',
    sessionId: session.id,
    eligibilityPoint: `user-turn-${userMessages.length}`,
    assignmentSeed: seedText,
    assignedArm,
    responseMode,
    context: { state: context.state, capacity: context.capacity, need: context.need },
    provider: fixedSurface ? 'deterministic' : 'openai',
    deliveryFidelity: fixedSurface ? 'deterministic' : 'prompt_assigned',
    ...(!fixedSurface ? { modelVersion: 'gpt-5.5' } : {}),
    promptVersion: CONDUCTOR_PROMPT_VERSION,
    appVersion: CONDUCTOR_APP_VERSION,
    conductorDecision: decision,
    createdAt: now,
    updatedAt: now,
  }
  if (phase === 'shadow') return { event, assignment: null }
  return {
    event,
    assignment: {
      event,
      delivery: fixedSurface ? 'fixed_surface_offer' : 'model',
      responseMode,
      directive: fixedSurface ? undefined : buildExperimentDirective(assignedArm),
    },
  }
}

export function isConductorSurfaceArm(arm?: ResearchArm): arm is 'journal_arc' | 'speak_arc' | 'room_arc' {
  return Boolean(arm && SURFACE_ARM_SET.has(arm))
}

export function conductorSurfaceForArm(arm: ResearchArm): SessionSurface | null {
  const match = Object.entries(SURFACE_ARMS).find(([, candidate]) => candidate === arm)
  return match ? match[0] as SessionSurface : null
}
