// Companion involvement (docs/vision/2026-10-16-folio-involvement.md): one
// slider, five levels, each including everything below it. Two axes climb
// together: what the companion reads (reach) and what it does unasked
// (initiative). The copy beside each stop names the reach first.

export type InvolvementLevel = 1 | 2 | 3 | 4 | 5

export const LEVELS: readonly InvolvementLevel[] = [1, 2, 3, 4, 5]

/** Writers who saw Folio before the slider existed stay where they were. */
export const DEFAULT_LEVEL_EXISTING: InvolvementLevel = 1
/** New writers start where the blank page is no longer blank. */
export const DEFAULT_LEVEL_NEW: InvolvementLevel = 3

export interface LevelPowers {
  /** Point at a line worth lifting (a margin mark). */
  marks: boolean
  /** A ghost question in an empty beneath or between; an opening ghost on a blank page. */
  ghosts: boolean
  /** Prefill a name and a come-back day after the writer keeps. */
  prefill: boolean
  /** Lift the marked line itself, keep, name and set a come-back. */
  arranges: boolean
  /** Unasked margin notes per visit. */
  notesPerVisit: number
  /** Arrival, distance, the between, starters, closing, Step inside, Return on. */
  dances: boolean
}

export function powersOf(level: InvolvementLevel): LevelPowers {
  return {
    marks: level >= 2,
    ghosts: level >= 3,
    prefill: level >= 3,
    arranges: level >= 4,
    notesPerVisit: level >= 5 ? 2 : level >= 4 ? 1 : 0,
    dances: level >= 5,
  }
}

export interface LevelLimits {
  /** A model call at most this often per visit. */
  callsPerVisit: number
  marksPerVisit: number
  /** Between new marks. */
  markSpacingMs: number
  ghostsPerVisit: number
  liftsPerVisit: number
  liftSpacingMs: number
  keepsPerVisit: number
}

export function limitsOf(level: InvolvementLevel): LevelLimits {
  return {
    callsPerVisit: [0, 0, 8, 12, 16, 24][level],
    marksPerVisit: level >= 2 ? 6 : 0,
    markSpacingMs: 90_000,
    ghostsPerVisit: level >= 3 ? 10 : 0,
    liftsPerVisit: level >= 5 ? 6 : level >= 4 ? 4 : 0,
    liftSpacingMs: level >= 5 ? 120_000 : 180_000,
    keepsPerVisit: level >= 4 ? 3 : 0,
  }
}

/** A stored or missing preference as a level (the admin switch off: 1). */
export function effectiveLevel(stored: unknown, opts: { switchOn: boolean; firstVisitSeenAt?: number | null }): InvolvementLevel {
  if (!opts.switchOn) return 1
  if (stored === 1 || stored === 2 || stored === 3 || stored === 4 || stored === 5) return stored
  return opts.firstVisitSeenAt ? DEFAULT_LEVEL_EXISTING : DEFAULT_LEVEL_NEW
}

// ------------------------------------------------------------ timing

/** No document change for this long: a paragraph (or the page) is at rest. */
export const REST_MS = 8_000
/** A composition rests this long, caret outside, before the companion keeps it. */
export const KEEP_REST_MS = 60_000
/** After a companion keep, the caret outside the fold this long: the companion closes it. */
export const CLOSE_REST_MS = 60_000
/** After a companion keep, this much rest with no typing: Step inside opens itself (level 5). */
export const INSIDE_REST_MS = 30_000
/** A model call that takes longer is dropped. */
export const CALL_TIMEOUT_MS = 12_000
/** An Undo of a companion act pauses that act this long. */
export const UNDO_PAUSE_MS = 10 * 60_000
/** How long a companion act's notice offers Undo. */
export const NOTICE_MS = 30_000

// ------------------------------------------------------------ sizes

export const QUESTION_MAX = 120
export const OPENING_MAX = 120
export const BETWEEN_MAX = 140
export const STARTER_MAX = 80
export const TITLE_MAX_WORDS = 5
