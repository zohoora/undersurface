import type { TranslationStrings } from '../i18n/translations/en'
import type { Gap } from './page/schema'
import type { FolioStrings } from './page/strings'
import { getLanguageCode } from '../i18n'
import { getSettings } from '../store/settings'
import { shortDate } from './kept/dates'

// The editor core's copy, from the active language's `folio.*` keys.

function truncate(line: string): string {
  return line.length > 60 ? `${line.slice(0, 57)}…` : line
}

export function folioStringsFrom(t: TranslationStrings): FolioStrings {
  const distance = (gap: Gap) => t[`folio.distance.${gap}` as const]
  const fill = (template: string, gap: Gap) => template.replace('{distance}', distance(gap)).replace('{n}', String(gap + 1))
  return {
    openBeneath: t['folio.openBeneath'],
    closeBeneath: t['folio.closeBeneath'],
    undersideLabel: (line, gap) => fill(t['folio.undersideLabel'].replace('{line}', truncate(line)), gap),
    distanceName: distance,
    protectedOpened: t['folio.protectedOpened'],
    undoOpened: t['folio.undoOpened'],
    lifted: t['folio.lifted'],
    unlifted: t['folio.unlifted'],
    farther: (gap) => fill(t['folio.farther.announce'], gap),
    closer: (gap) => fill(t['folio.closer.announce'], gap),
    closerBlocked: t['folio.closerBlocked'],
    alreadyLifted: t['folio.alreadyLifted'],
    betweenHint: t['folio.betweenHint'],
    creaseOpen: t['folio.crease.open'],
    creaseClose: t['folio.crease.close'],
    foldFound: (line, open) => (open ? t['folio.foldFound.open'] : t['folio.foldFound.closed']).replace('{line}', truncate(line)),
    fromDate: (keptAt) => t['folio.fromDate'].replace('{date}', shortDate(keptAt, getLanguageCode(), getSettings().timezone)),
  }
}
