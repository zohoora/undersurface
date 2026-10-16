import type { Gap } from './schema'

// The editor core's copy, injected by the host so the core stays free of the
// i18n store (and testable). FolioPage builds it from `folio.*` keys.

export interface FolioStrings {
  openBeneath: string
  closeBeneath: string
  /** "Beneath '‹line›', set ‹distance›, ‹n› of 5" (§3.10). */
  undersideLabel: (line: string, gap: Gap) => string
  distanceName: (gap: Gap) => string
  /** Live-region announcements (§3.10). */
  protectedOpened: string
  undoOpened: string
  lifted: string
  unlifted: string
  farther: (gap: Gap) => string
  closer: (gap: Gap) => string
  closerBlocked: string
  alreadyLifted: string
  /** "Writing beneath '‹line›', closed" — the discovery path's announcement. */
  foldFound: (line: string, open: boolean) => string
}

const DISTANCES: Record<Gap, string> = { 0: 'touching', 1: 'close', 2: 'apart', 3: 'far', 4: 'very far' }

function truncate(line: string): string {
  return line.length > 60 ? `${line.slice(0, 57)}…` : line
}

export const ENGLISH_STRINGS: FolioStrings = {
  openBeneath: 'Open writing beneath',
  closeBeneath: 'Close writing beneath',
  undersideLabel: (line, gap) => `Beneath '${truncate(line)}', set ${DISTANCES[gap]}, ${gap + 1} of 5`,
  distanceName: (gap) => DISTANCES[gap],
  protectedOpened: 'Writing beneath a line was kept and opened.',
  undoOpened: 'Opened writing beneath a line. Undo again to change it.',
  lifted: 'Lifted. Writing beneath.',
  unlifted: 'Unlifted.',
  farther: (gap) => `Farther: ${DISTANCES[gap]}, ${gap + 1} of 5`,
  closer: (gap) => `Closer: ${DISTANCES[gap]}, ${gap + 1} of 5`,
  closerBlocked: "There's writing between them.",
  alreadyLifted: 'This line already has something beneath it.',
  foldFound: (line, open) => `Writing beneath '${truncate(line)}', ${open ? 'open' : 'closed'}`,
}
