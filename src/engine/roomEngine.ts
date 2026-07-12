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
export function buildRoomScore(duration: RoomDuration, density: RoomVoiceDensity): RoomCue[] {
  const total = duration * MINUTE
  if (density === 'quiet') return []

  const cues: RoomCue[] = [{ kind: 'arrival', atMs: 0 }]
  if (density === 'present') {
    cues.push({ kind: 'company', atMs: Math.round(total * 0.34) })
    if (duration >= 5) cues.push({ kind: 'company', atMs: Math.round(total * 0.66) })
  } else if (duration >= 5) {
    cues.push({ kind: 'company', atMs: Math.round(total * 0.56) })
  }
  cues.push({ kind: 'return', atMs: Math.max(30_000, total - 35_000) })
  return cues
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

export function detectRoomCommand(text: string): RoomCommand | null {
  const normalized = text.normalize('NFKC').trim().toLowerCase()
  if (/\b(?:less|fewer) (?:voice|words|talking)|talk less|more quiet\b/.test(normalized)) return 'less_voice'
  if (/\b(?:more voice|talk more|say more|guide me more)\b/.test(normalized)) return 'more_voice'
  if (/\b(?:be quiet|stay quiet|no more voice|just silence|stop talking)\b/.test(normalized)) return 'quiet'
  if (/\b(?:change|different|another) (?:the )?(?:sound|soundscape|background)\b/.test(normalized)) return 'change_sound'
  if (/\b(?:stay here|another minute|keep going|not yet)\b/.test(normalized)) return 'stay'
  if (/\b(?:end|finish|i(?:'m| am) done|that(?:'s| is) enough|stop now)\b/.test(normalized)) return 'end'
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
