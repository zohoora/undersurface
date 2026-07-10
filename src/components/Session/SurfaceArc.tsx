import { useEffect, useState } from 'react'
import { db } from '../../store/db'
import type { ImmediateOutcome, SessionSurface } from '../../types'

export function SurfaceArcGuide({ surface, startedAt, onReturn }: { surface: SessionSurface; startedAt: number; onReturn: () => void }) {
  const [remaining, setRemaining] = useState(90)
  useEffect(() => {
    if (surface !== 'journal') return
    const tick = () => setRemaining(Math.max(0, 90 - Math.floor((Date.now() - startedAt) / 1000)))
    tick()
    const id = window.setInterval(tick, 1000)
    return () => window.clearInterval(id)
  }, [surface, startedAt])
  const guidance = surface === 'journal'
    ? `Write without explaining it to the companion. ${remaining > 0 ? `${remaining}s` : 'Return whenever it feels complete.'}`
    : 'Stay with this form for as long as it is useful, then return.'
  return (
    <div style={{ border: '1px solid var(--border-subtle)', borderRadius: 10, padding: '9px 11px', margin: '10px 0', display: 'flex', alignItems: 'center', gap: 10, font: "10px/1.4 'Inter', sans-serif", color: 'var(--text-secondary)' }}>
      <span style={{ flex: 1 }}>{guidance}</span>
      <button onClick={onReturn} style={{ border: '1px solid var(--border-light)', borderRadius: 999, padding: '4px 8px', background: 'transparent', color: 'var(--text-primary)', fontSize: 9, cursor: 'pointer' }}>return to Talk</button>
    </div>
  )
}

export function SurfaceArcReturn({ outcomeId, surface, onDone }: { outcomeId: string; surface: SessionSurface; onDone: () => void }) {
  const [note, setNote] = useState('')
  const finish = async (immediate: ImmediateOutcome) => {
    await db.interventionOutcomes.update(outcomeId, {
      immediate,
      note: note.trim().slice(0, 240),
      updatedAt: Date.now(),
    })
    onDone()
  }
  return (
    <div style={{ border: '1px solid var(--border-subtle)', borderRadius: 10, padding: 11, margin: '8px 0 18px', font: "10px/1.45 'Inter', sans-serif", color: 'var(--text-secondary)' }}>
      <div>Back from {surface}. What is different now?</div>
      <input value={note} onChange={event => setNote(event.target.value)} placeholder="A word is enough (optional)" style={{ width: '100%', marginTop: 7, border: '1px solid var(--border-light)', borderRadius: 5, background: 'transparent', color: 'var(--text-primary)', padding: '5px 7px', fontSize: 10 }} />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 7 }}>
        <button onClick={() => void finish('helped')} style={pillStyle}>softer / clearer</button>
        <button onClick={() => void finish('nothing')} style={pillStyle}>about the same</button>
        <button onClick={() => void finish('worse')} style={pillStyle}>stronger / worse</button>
        <button onClick={() => void finish('not_wanted')} style={pillStyle}>not what I needed</button>
        <button onClick={onDone} style={{ ...pillStyle, borderColor: 'transparent', color: 'var(--text-ghost)' }}>skip</button>
      </div>
    </div>
  )
}

const pillStyle = {
  border: '1px solid var(--border-light)',
  borderRadius: 999,
  padding: '3px 7px',
  background: 'transparent',
  color: 'var(--text-primary)',
  fontSize: 9,
  cursor: 'pointer',
} as const
