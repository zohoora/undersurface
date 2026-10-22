// Folio's stored shapes (docs/vision/2026-10-15-folio-v4.md §6.6, with the
// build plan's additions). Paths are under users/{uid}/.

/** A companion note the writer chose to keep (H2, Ask). Always labelled. */
export interface FolioNote {
  id: string
  /** The paragraph it sits beside. */
  pid: string
  text: string
  createdAt: number
}

/** users/{uid}/folioPages/{pageId} */
export interface FolioPage {
  id: string
  createdAt: number
  updatedAt: number
  /** ProseMirror JSON, stringified: one atomic field, no nested-depth limit. */
  doc: string
  schemaVersion: 2
  /** Random, new on every save. */
  revId: string
  /** The revision this one was built on; null on create (compare-and-swap). */
  parentRevId: string | null
  /** Display and diagnostics only; correctness uses revId. */
  rev: number
  editorId: string
  /** First ~120 characters, for the pages list. */
  preview: string
  foldCount: number
  /** C4's checked set: 16-hex check keys of units whose samples were classified. */
  safety: { checked: string[] }
  notes?: FolioNote[]
}

/**
 * users/{uid}/folioTraces/{traceId}: a kept composition (draft 4 §3.7, C3).
 * The app never rewrites a kept field; the rules reject updates to them.
 */
export interface FolioTrace {
  id: string
  keptAt: number
  source: { pageId: string; foldId: string; revId: string | null }
  /** Keeping the same fold again links to the trace it kept before. */
  previousTraceId?: string
  /** A corrected copy names the trace it corrects (build plan §3.5). */
  correctedFromId?: string
  /** The lifted line, exact, as plain text. */
  surface: string
  gap: 0 | 1 | 2 | 3 | 4
  /**
   * The composition as ProseMirror JSON (`Composition` in kept/keep.ts),
   * stringified like the page, so italic, hard breaks and paragraphs survive
   * exactly. Plain text is derived from it.
   */
  composition: string
  author: 'writer'
  /** Involvement level 4+: the companion kept it (the words are still the writer's). */
  keptBy?: 'companion'
  title?: string
  /** The companion named it; renaming makes the name the writer's. */
  titleBy?: 'companion' | null
  /** 07:00 writer-local on the chosen date, as epoch ms; null when cleared. */
  comeBackAt?: number | null
  comeBackTz?: string | null
  /** When the writer asked; the slip quotes it back. */
  comeBackSetAt?: number | null
  /** The last time the slip was set aside with "Not now". */
  lastComeBackShownAt?: number | null
  /** lastGroundingAt within 72 h of keptAt (used only by H3). */
  groundedNearKeep: boolean
  /** H3: the writer let this one come back on its own. Off unless true. */
  returnEligible?: boolean
  /** H3: when Return last showed it (it rests 60 days after). */
  lastReturnShownAt?: number | null
  /** C4's checked set for the between, the beneath and each entry. */
  safety: { checked: string[] }
  schemaVersion: 2
}

/** users/{uid}/folioTraces/{traceId}/entries/{entryId}: added beside a trace, never edited. */
export interface FolioTraceEntry {
  id: string
  addedAt: number
  text: string
  author: 'writer'
}

/** users/{uid}/folioPreferences/current */
export interface FolioPreferences {
  id: 'current'
  firstVisitSeenAt?: number
  reduceMotion?: boolean
  /** H3: let kept things come back on their own. Off by default. */
  returnEnabled?: boolean
  /** Companion involvement, 1–5 (absent: 1 for writers who were here before it, else 3). */
  involvement?: 1 | 2 | 3 | 4 | 5
  /** The one-time line saying the companion can now take part was dismissed. */
  involvementIntroSeenAt?: number
  /**
   * What the writer has already met, so each first-time line shows once per
   * account (docs/vision/2026-10-22-folio-first-moment.md §5): `lifts` counts
   * the writer's own lifts (the corner's words stay until 2); the rest are
   * when it first happened.
   */
  learned?: FolioLearned
}

export interface FolioLearned {
  lifts?: number
  fold?: number
  keep?: number
  mark?: number
}
