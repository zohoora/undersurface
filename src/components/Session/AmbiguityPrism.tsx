import { useEffect, useState } from 'react'
import type { ParsedPrismHypothesis } from '../../ai/ambiguityPrismParser'
import { useTranslation } from '../../i18n'
import { recordAmbiguityPrismFeedback } from '../../store/ambiguityPrism'
import { db } from '../../store/db'
import type { PrismCorrectionEffort, PrismHypothesisFit, SessionMessage } from '../../types'

const chip = (active: boolean) => ({
  border: '1px solid var(--border-light)',
  borderRadius: 999,
  padding: '3px 7px',
  background: active ? 'var(--surface-secondary)' : 'transparent',
  color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
  fontSize: 9,
  cursor: 'pointer',
}) as const

export function AmbiguityPrism({
  message,
  sessionId,
  hypotheses,
}: {
  message: SessionMessage
  sessionId: string
  hypotheses: ParsedPrismHypothesis[]
}) {
  const tr = useTranslation()
  const [ratings, setRatings] = useState<Record<string, PrismHypothesisFit>>({})
  const [betterFrame, setBetterFrame] = useState('')
  const [effort, setEffort] = useState<PrismCorrectionEffort | undefined>()
  const [done, setDone] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    void db.interventionOutcomes.get(`message-${message.id}`).then(outcome => {
      if (outcome?.prismFeedback) setDone(true)
    })
  }, [message.id])

  if (done) {
    return <div style={{ marginTop: 8, color: 'var(--text-ghost)', fontSize: 9 }}>{tr['ps.prism.saved']}</div>
  }

  const noneFit = hypotheses.length > 0 && hypotheses.every(item => ratings[item.id] === 'not_this')
  const save = async () => {
    const reviewed = hypotheses
      .filter(item => Boolean(ratings[item.id]))
      .map(item => ({ id: item.id, text: item.text, fit: ratings[item.id] }))
    if (reviewed.length === 0 && !betterFrame.trim()) return
    setSaving(true)
    try {
      await recordAmbiguityPrismFeedback({
        message,
        sessionId,
        hypotheses: reviewed,
        noneFit,
        betterFrame,
        correctionEffort: effort,
      })
      setDone(true)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div role="region" aria-label={tr['ps.prism.title']} style={{ marginTop: 10, border: '1px solid var(--border-subtle)', borderRadius: 10, padding: 9, font: "10px/1.4 'Inter', sans-serif" }}>
      <div style={{ color: 'var(--text-primary)', marginBottom: 2 }}>{tr['ps.prism.title']}</div>
      <div style={{ color: 'var(--text-ghost)', fontSize: 9, marginBottom: 8 }}>{tr['ps.prism.note']}</div>
      <div style={{ display: 'grid', gap: 7 }}>
        {hypotheses.map(item => (
          <div key={item.id} style={{ borderTop: '1px solid var(--border-light)', paddingTop: 6 }}>
            <div style={{ color: 'var(--text-secondary)' }}>{item.text}</div>
            <div style={{ display: 'flex', gap: 4, marginTop: 5, flexWrap: 'wrap' }}>
              {(['fits', 'maybe', 'not_this'] as const).map(value => (
                <button key={value} type="button" aria-pressed={ratings[item.id] === value} onClick={() => setRatings(current => ({ ...current, [item.id]: value }))} style={chip(ratings[item.id] === value)}>
                  {tr[`ps.prism.${value === 'not_this' ? 'notThis' : value}`]}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <button type="button" onClick={() => setRatings(Object.fromEntries(hypotheses.map(item => [item.id, 'not_this'])))} style={{ ...chip(noneFit), marginTop: 8 }}>{tr['ps.prism.none']}</button>
      <label style={{ display: 'grid', gap: 3, marginTop: 8, color: 'var(--text-ghost)', fontSize: 9 }}>
        {tr['ps.prism.better']}
        <input value={betterFrame} maxLength={300} onChange={event => setBetterFrame(event.target.value)} style={{ border: '1px solid var(--border-light)', borderRadius: 4, padding: '5px 7px', background: 'transparent', color: 'var(--text-primary)', fontSize: 10 }} />
      </label>
      <div style={{ color: 'var(--text-ghost)', fontSize: 9, marginTop: 8 }}>{tr['ps.prism.effort']}</div>
      <div style={{ display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
        {(['easy', 'some_work', 'more_work'] as const).map(value => (
          <button key={value} type="button" aria-pressed={effort === value} onClick={() => setEffort(value)} style={chip(effort === value)}>{tr[`ps.prism.${value === 'some_work' ? 'someWork' : value === 'more_work' ? 'moreWork' : 'easy'}`]}</button>
        ))}
      </div>
      <button type="button" disabled={saving || (Object.keys(ratings).length === 0 && !betterFrame.trim())} onClick={() => void save()} style={{ marginTop: 9, border: '1px solid var(--border-subtle)', borderRadius: 999, padding: '4px 9px', background: 'transparent', color: 'var(--text-primary)', fontSize: 9, cursor: 'pointer' }}>
        {saving ? tr['ps.prism.saving'] : tr['ps.prism.save']}
      </button>
    </div>
  )
}
