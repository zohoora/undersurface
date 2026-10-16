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

/** users/{uid}/folioPreferences/current */
export interface FolioPreferences {
  id: 'current'
  firstVisitSeenAt?: number
  reduceMotion?: boolean
  /** H3: let kept things come back on their own. Off by default. */
  returnEnabled?: boolean
}
