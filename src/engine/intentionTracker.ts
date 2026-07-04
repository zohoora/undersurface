import type { SessionIntention } from '../types'
import { generateId } from '../store/db'

// Pure lifecycle engine for session intentions ("the thread"). Precision-first
// and warm by construction: outcomes only ever come matched by id, a released
// intention closes silently, and the avoidance path fires exactly once.
// Spec: docs/superpowers/specs/2026-07-04-intentions-and-stance-design.md

export const OPEN_INTENTIONS_CAP = 3
const TEXT_CHAR_CAP = 160
export const NOT_YET_PATTERN_THRESHOLD = 3

export function openIntentions(all: SessionIntention[]): SessionIntention[] {
  return all.filter((i) => i.status === 'open')
}

// Which open intentions the opener may weave in — highest notYetCount first
// (the slipping ones need the light most), then oldest.
export function orderForFollowUp(all: SessionIntention[]): SessionIntention[] {
  return openIntentions(all).sort(
    (a, b) => b.notYetCount - a.notYetCount || a.createdAt - b.createdAt,
  )
}

// Create a new open intention, releasing the oldest when the cap is full.
// Returns the docs to persist; never mutates inputs.
export function createIntention(
  all: SessionIntention[],
  text: string,
  sessionId: string,
  now: number,
  valueId?: string,
): { create: SessionIntention; release: SessionIntention | null } | null {
  const trimmed = text.trim().slice(0, TEXT_CHAR_CAP)
  if (!trimmed) return null
  const open = openIntentions(all)
  // Duplicate guard: same text already open → nothing to do.
  if (open.some((i) => i.text.toLowerCase() === trimmed.toLowerCase())) return null

  const release = open.length >= OPEN_INTENTIONS_CAP
    ? [...open].sort((a, b) => a.createdAt - b.createdAt)[0]
    : null

  return {
    create: {
      id: generateId(),
      text: trimmed,
      sessionId,
      status: 'open',
      askedCount: 0,
      notYetCount: 0,
      patternNamed: false,
      ...(valueId ? { valueId } : {}),
      createdAt: now,
      updatedAt: now,
    },
    release: release ? { ...release, status: 'released', resolvedAt: now, updatedAt: now } : null,
  }
}

// Apply reflection-detected outcomes (matched by id). Unknown ids and
// malformed entries are dropped silently. Returns changed copies.
export function applyIntentionOutcomes(
  all: SessionIntention[],
  outcomes: unknown,
  now: number,
): SessionIntention[] {
  if (!Array.isArray(outcomes)) return []
  const updates: SessionIntention[] = []
  const touched = new Set<string>()

  for (const raw of outcomes) {
    if (typeof raw !== 'object' || raw === null) continue
    const r = raw as Record<string, unknown>
    if (typeof r.id !== 'string' || touched.has(r.id)) continue
    const intention = all.find((i) => i.id === r.id && i.status === 'open')
    if (!intention) continue

    const note = typeof r.note === 'string' && r.note.trim()
      ? r.note.trim().slice(0, 200)
      : undefined

    switch (r.outcome) {
      case 'kept':
      case 'adapted':
        updates.push({ ...intention, status: r.outcome, resolvedAt: now, outcomeNote: note, updatedAt: now })
        break
      case 'released':
        updates.push({ ...intention, status: 'released', resolvedAt: now, outcomeNote: note, updatedAt: now })
        break
      case 'not_yet':
        updates.push({ ...intention, notYetCount: intention.notYetCount + 1, updatedAt: now })
        break
      default:
        continue
    }
    touched.add(r.id)
  }
  return updates
}

// The one intention (if any) whose repeated slipping should be named this
// session — once, ever. The caller marks patternNamed after the build that
// carried the instruction.
export function selectPatternToName(all: SessionIntention[]): SessionIntention | null {
  return (
    openIntentions(all).find(
      (i) => i.notYetCount >= NOT_YET_PATTERN_THRESHOLD && !i.patternNamed,
    ) ?? null
  )
}
