import { getLanguageCode, useTranslation } from '../../i18n'
import type { FolioTrace } from '../../types/folio'
import { shortDate } from './dates'
import { traceName } from './keep'

// The come-back slip (draft 4 §3.8): one at a time, at the top; it quotes the
// writer's own request back, with the day they asked. Open · Not now · Don't
// bring this back, and Lift into today's page when that switch is on.

export function ComeBackSlip({ trace, tz, liftToday, onOpen, onNotNow, onClear, onLiftToday }: {
  trace: FolioTrace
  tz: string
  liftToday: boolean
  onOpen: () => void
  onNotNow: () => void
  onClear: () => void
  onLiftToday: () => void
}) {
  const tr = useTranslation()
  const asked = trace.comeBackSetAt ?? trace.keptAt
  return (
    <section className="folio-slip" aria-label={tr['folio.comeBack']}>
      <div className="folio-slip__asked">{tr['folio.comeBack.slip'].replace('{date}', shortDate(asked, getLanguageCode(), tz))}</div>
      <div className="folio-slip__name">{traceName(trace)}</div>
      <div className="folio-slip__actions">
        <button type="button" className="folio-button folio-button--strong" onClick={onOpen}>{tr['folio.open']}</button>
        {liftToday && <button type="button" className="folio-button" onClick={onLiftToday}>{tr['folio.liftToday']}</button>}
        <button type="button" className="folio-button" onClick={onNotNow}>{tr['folio.notNow']}</button>
        <button type="button" className="folio-button" onClick={onClear}>{tr['folio.comeBack.clear']}</button>
      </div>
    </section>
  )
}
