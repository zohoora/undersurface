import { useEffect, useId, useState } from 'react'
import { db } from '../../store/db'
import { useTranslation } from '../../i18n'
import type { TranslationStrings } from '../../i18n/translations/en'
import type { ImmediateOutcome, SessionSurface } from '../../types'
import { cardBodyStyle, cardChipStyle, cardInputStyle, cardNoteStyle, cardQuietButtonStyle } from './cardControls'

// Room replaced the Relax and Drift surfaces, so arcs recorded against those
// legacy values read as Room.
function surfaceName(tr: TranslationStrings, surface: SessionSurface): string {
  switch (surface) {
    case 'talk': return tr['session.bottomBar.talk']
    case 'journal': return tr['session.bottomBar.journal']
    case 'speak': return tr['session.bottomBar.speak']
    default: return tr['session.bottomBar.room']
  }
}

export function SurfaceArcGuide({ surface, startedAt, onReturn }: { surface: SessionSurface; startedAt: number; onReturn: () => void }) {
  const tr = useTranslation()
  const [remaining, setRemaining] = useState(90)
  useEffect(() => {
    if (surface !== 'journal') return
    const tick = () => setRemaining(Math.max(0, 90 - Math.floor((Date.now() - startedAt) / 1000)))
    tick()
    const id = window.setInterval(tick, 1000)
    return () => window.clearInterval(id)
  }, [surface, startedAt])
  const guidance = surface === 'journal'
    ? `${tr['surfaceArc.journal.guide']} ${remaining > 0 ? tr['surfaceArc.journal.remaining'].replace('{seconds}', String(remaining)) : tr['surfaceArc.journal.complete']}`
    : tr['surfaceArc.other.guide']
  return (
    <div style={{ border: '1px solid var(--border-subtle)', borderRadius: 10, padding: '6px 6px 6px 12px', margin: '10px 0', display: 'flex', alignItems: 'center', gap: 10, ...cardBodyStyle }}>
      <span style={{ flex: 1 }}>{guidance}</span>
      <button type="button" onClick={onReturn} style={{ ...cardChipStyle(), color: 'var(--text-primary)' }}>{tr['surfaceArc.returnToTalk']}</button>
    </div>
  )
}

// Module-level so Date.now() stays out of render-scoped closures (React
// Compiler purity rule).
async function persistArcOutcome(outcomeId: string, immediate: ImmediateOutcome, note: string): Promise<void> {
  await db.interventionOutcomes.update(outcomeId, {
    immediate,
    note: note.trim().slice(0, 240),
    updatedAt: Date.now(),
  })
}

export function SurfaceArcReturn({ outcomeId, surface, onDone }: { outcomeId: string; surface: SessionSurface; onDone: () => void }) {
  const tr = useTranslation()
  const noteId = useId()
  const [note, setNote] = useState('')
  const finish = async (immediate: ImmediateOutcome) => {
    await persistArcOutcome(outcomeId, immediate, note)
    onDone()
  }
  const outcomes: Array<[ImmediateOutcome, string]> = [
    ['helped', tr['surfaceArc.outcome.helped']],
    ['nothing', tr['surfaceArc.outcome.nothing']],
    ['worse', tr['surfaceArc.outcome.worse']],
    ['not_wanted', tr['surfaceArc.outcome.notWanted']],
  ]
  return (
    <div role="group" aria-labelledby={`${noteId}-label`} style={{ border: '1px solid var(--border-subtle)', borderRadius: 10, padding: 12, margin: '8px 0 18px', ...cardBodyStyle }}>
      <label id={`${noteId}-label`} htmlFor={noteId} style={{ display: 'block' }}>
        {tr['surfaceArc.return.prompt'].replace('{surface}', surfaceName(tr, surface))}
      </label>
      <div style={{ ...cardNoteStyle, marginTop: 2 }} id={`${noteId}-hint`}>{tr['surfaceArc.return.hint']}</div>
      <input
        id={noteId}
        value={note}
        onChange={event => setNote(event.target.value)}
        aria-describedby={`${noteId}-hint`}
        style={{ ...cardInputStyle, marginTop: 8 }}
      />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
        {outcomes.map(([value, label]) => (
          <button key={value} type="button" onClick={() => void finish(value)} style={cardChipStyle()}>{label}</button>
        ))}
        <button type="button" onClick={onDone} style={cardQuietButtonStyle}>{tr['surfaceArc.skip']}</button>
      </div>
    </div>
  )
}
