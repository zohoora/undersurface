import { useState } from 'react'
import { useTranslation } from '../../i18n'
import { addDays, formatYmd, ymdIn } from './comeBack'
import type { ComeBackChoice } from './comeBack'

// Come back to this (draft 4 §3.8): Tomorrow · In a week · In a month ·
// Pick a day. A picked day must be after today, writer-local.

export function ComeBackChoices({ tz, onChoose, autoFocus }: { tz: string; onChoose: (choice: ComeBackChoice) => void; autoFocus?: boolean }) {
  const tr = useTranslation()
  const [picking, setPicking] = useState(false)
  const [day, setDay] = useState('')
  const [min] = useState(() => formatYmd(addDays(ymdIn(Date.now(), tz), 1)))
  return (
    <div className="folio-comeback" role="group" aria-label={tr['folio.comeBack']}>
      <button type="button" className="folio-button" autoFocus={autoFocus} onClick={() => onChoose('tomorrow')}>{tr['folio.comeBack.tomorrow']}</button>
      <button type="button" className="folio-button" onClick={() => onChoose('week')}>{tr['folio.comeBack.week']}</button>
      <button type="button" className="folio-button" onClick={() => onChoose('month')}>{tr['folio.comeBack.month']}</button>
      {!picking && <button type="button" className="folio-button" onClick={() => setPicking(true)}>{tr['folio.comeBack.pick']}</button>}
      {picking && (
        <form className="folio-comeback__pick" onSubmit={(e) => { e.preventDefault(); if (day) onChoose({ pick: day }) }}>
          <label>
            <span className="folio-visually-hidden">{tr['folio.comeBack.pickLabel']}</span>
            <input type="date" className="folio-input" min={min} value={day} onChange={(e) => setDay(e.target.value)} autoFocus />
          </label>
          <button type="submit" className="folio-button" disabled={!day || day < min}>{tr['folio.comeBack.set']}</button>
        </form>
      )}
    </div>
  )
}
