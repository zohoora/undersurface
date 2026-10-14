import type { RoomCommand, RoomDuration, RoomVoiceDensity } from '../types'

export type RoomCueKind = 'arrival' | 'company' | 'return'

export interface RoomCue {
  kind: RoomCueKind
  atMs: number
}

const MINUTE = 60_000

/**
 * One clock owns Room's arc. The model may choose the words, but it never
 * chooses when a phase begins or when another cue is due.
 */
export function buildRoomScore(duration: RoomDuration, density: RoomVoiceDensity, extendedMs = 0): RoomCue[] {
  const total = duration * MINUTE
  if (density === 'quiet') return []

  const cues: RoomCue[] = [{ kind: 'arrival', atMs: 0 }]
  if (density === 'present') {
    cues.push({ kind: 'company', atMs: Math.round(total * 0.34) })
    if (duration >= 5) cues.push({ kind: 'company', atMs: Math.round(total * 0.66) })
  } else if (duration >= 5) {
    cues.push({ kind: 'company', atMs: Math.round(total * 0.56) })
  }
  // "Stay another minute" moves the opening-out cue with the end of the arc.
  cues.push({ kind: 'return', atMs: Math.max(30_000, total + extendedMs - 35_000) })
  return cues
}

/**
 * How long a due cue may wait for a quiet moment (no active response, writer
 * not speaking, voice connected) before it is dropped rather than delivered
 * late. A late cue is worse than none: no "arrival" in the middle of a room.
 */
export const ROOM_CUE_GRACE_MS = 15_000

/**
 * Cues scheduled inside one clock tick, (fromExclusive, toInclusive]. Cues
 * that fall before the window are past and are never replayed, so a density
 * change (a new score) or a voice reconnect cannot fire a burst of old cues.
 */
export function roomCuesInWindow(cues: RoomCue[], fromExclusive: number, toInclusive: number): RoomCue[] {
  return cues.filter(cue => cue.atMs > fromExclusive && cue.atMs <= toInclusive)
}

export function roomVoiceDensityAfter(
  current: RoomVoiceDensity,
  command: RoomCommand,
): RoomVoiceDensity {
  if (command === 'quiet') return 'quiet'
  if (command === 'less_voice') {
    return current === 'present' ? 'sparse' : 'quiet'
  }
  if (command === 'more_voice') {
    return current === 'quiet' ? 'sparse' : 'present'
  }
  return current
}

// Spoken Room controls are deliberately narrow: only a SHORT, WHOLE utterance
// that is itself a control counts. Ordinary speech that merely contains a
// control word ("at the end of the day…", "my boss wouldn't stop talking",
// "I want it all to end") is conversation, never a command — a false positive
// can close Room or switch the microphone off mid-disclosure. Bare "end" or
// "finish" never counts. English-only: other languages fall back to the
// on-screen controls and the model-side instruction.
const MAX_COMMAND_WORDS = 6
const LEAD = String.raw`(?:(?:ok(?:ay)?|alright|so|um+|uh+|hey|please|just)\s+)*(?:(?:could|can|would|will) (?:you|we) (?:please )?|(?:let's|let us) |i(?:'d| would) like (?:to |you to )?|i want (?:to |you to )?)?`
const TAIL = String.raw`(?:\s+(?:please|now|then|thanks|thank you|a (?:bit|little)|for (?:a (?:bit|while|minute|moment)|now|me)))*`

const COMMAND_PATTERNS: Array<[RoomCommand, string]> = [
  // Order matters only where phrases overlap ("no more voice" is quiet).
  ['quiet', String.raw`(?:be quiet|stay quiet|no more voice|silence|stop talking)`],
  ['less_voice', String.raw`(?:(?:less|fewer) (?:voice|words|talking)|talk less|speak less|more quiet)`],
  ['more_voice', String.raw`(?:more voice|talk more|speak more|say more|guide me more)`],
  ['change_sound', String.raw`(?:(?:change|switch) (?:the )?(?:sound|soundscape|background)|(?:a )?(?:different|another|new) (?:sound|soundscape|background))`],
  ['stay', String.raw`(?:stay here|stay (?:a (?:bit|little) )?longer|(?:another|one more) minute|a little longer|keep going|not yet)`],
  ['end', String.raw`(?:that(?:'s| is) enough|i(?:'m| am) done|stop (?:now|here)|(?:end|leave|finish|close|exit) (?:the |this )?room)`],
]
const COMPILED_PATTERNS = COMMAND_PATTERNS.map(([command, core]) => [command, new RegExp(`^${LEAD}${core}${TAIL}$`)] as const)

function normalizeUtterance(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[^\p{L}\p{N}'\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Whether spoken Room controls are recognized for this UI language. */
export function roomVoiceCommandsSupported(language: string): boolean {
  return language.toLowerCase().startsWith('en')
}

export function detectRoomCommand(text: string, language = 'en'): RoomCommand | null {
  if (!roomVoiceCommandsSupported(language)) return null
  const normalized = normalizeUtterance(text)
  if (!normalized) return null
  if (normalized.split(' ').length > MAX_COMMAND_WORDS) return null
  for (const [command, pattern] of COMPILED_PATTERNS) {
    if (pattern.test(normalized)) return command
  }
  return null
}

export function roomCueInstruction(kind: RoomCueKind, density: RoomVoiceDensity): string {
  if (kind === 'arrival') {
    return density === 'present'
      ? 'Offer a warm, unhurried beginning in two or three natural sentences. Help the person arrive without sounding like a meditation recording. Do not ask for a rating.'
      : 'Offer one warm, simple sentence that helps the person arrive, then leave silence. Do not sound scripted and do not ask a question.'
  }
  if (kind === 'company') {
    return density === 'present'
      ? 'Offer a brief, fresh piece of company based on this room and the conversation so far. Two natural sentences at most. Do not ask a question; return to silence.'
      : 'Say one brief, human line of company that fits what has happened here, then be quiet again. Do not instruct or ask a question.'
  }
  return 'Gently signal that the room is beginning to open back out. Use one or two natural sentences. Do not force an ending and do not ask for a rating.'
}
