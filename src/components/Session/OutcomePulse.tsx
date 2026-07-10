import { useEffect, useState } from 'react'
import { db } from '../../store/db'
import type { DelayedOutcome, ImmediateOutcome, OutcomeHorizon, SessionMessage } from '../../types'
import { writeAgencyOutcome, writeFieldWindowTimingOutcome, writeHorizonOutcome, writeImmediateMessageOutcome } from '../../store/interventionOutcomes'
import { useTranslation } from '../../i18n'

export function OutcomePulse({ message, sessionId }: { message: SessionMessage; sessionId: string }) {
  const transfer = message.researchArm?.startsWith('transfer_') === true
  const [stage, setStage] = useState<'loading' | 'immediate' | 'agency' | 'done'>('loading')
  const tr = useTranslation()
  const id = `message-${message.id}`

  useEffect(() => {
    void db.interventionOutcomes.get(id).then(value => {
      if (!value?.immediate) setStage('immediate')
      else if (transfer && !value.agency) setStage('agency')
      else setStage('done')
    })
  }, [id, transfer])

  if (stage === 'loading' || stage === 'done') return null
  const pick = async (immediate: ImmediateOutcome) => {
    setStage('loading')
    try {
      await writeImmediateMessageOutcome(id, message, sessionId, immediate)
      setStage(transfer ? 'agency' : 'done')
    } catch {
      setStage('immediate')
    }
  }
  const pickAgency = async (agency: 'more' | 'same' | 'less') => {
    setStage('loading')
    try {
      await writeAgencyOutcome(id, agency)
      setStage('done')
    } catch {
      setStage('agency')
    }
  }
  return (
    <div role="group" aria-label="Did that help?" style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 5, margin: '-10px 0 18px', color: 'var(--text-ghost)', font: "9px 'Inter', sans-serif" }}>
      {stage === 'immediate' ? (
        <>
          <span>{tr['ps.outcome.immediate.prompt']}</span>
          {([['helped', tr['ps.outcome.immediate.yes']], ['nothing', tr['ps.outcome.immediate.no']], ['worse', tr['ps.outcome.immediate.worse']], ['not_wanted', tr['ps.outcome.immediate.unwanted']]] as Array<[ImmediateOutcome, string]>).map(([value, label]) => (
            <button key={value} onClick={() => void pick(value)} style={{ border: '1px solid var(--border-light)', borderRadius: 999, padding: '3px 6px', background: 'transparent', color: 'var(--text-secondary)', fontSize: 9, cursor: 'pointer' }}>{label}</button>
          ))}
        </>
      ) : (
        <>
          <span>{tr['ps.outcome.agency.prompt']}</span>
          {([['more', tr['ps.outcome.agency.more']], ['same', tr['ps.outcome.agency.same']], ['less', tr['ps.outcome.agency.less']]] as const).map(([value, label]) => (
            <button key={value} onClick={() => void pickAgency(value)} style={{ border: '1px solid var(--border-light)', borderRadius: 999, padding: '3px 6px', background: 'transparent', color: 'var(--text-secondary)', fontSize: 9, cursor: 'pointer' }}>{label}</button>
          ))}
        </>
      )}
      <button onClick={() => setStage('done')} aria-label="Skip" style={{ border: 0, background: 'transparent', color: 'var(--text-ghost)', cursor: 'pointer' }}>×</button>
    </div>
  )
}

export function DelayedOutcomePulse({ sessionId }: { sessionId: string }) {
  const tr = useTranslation()
  const [candidate, setCandidate] = useState<{ id: string; horizon: OutcomeHorizon } | null>(null)
  useEffect(() => {
    void db.interventionOutcomes.orderBy('createdAt').reverse().limit(24).toArray().then(items => {
      const now = Date.now()
      const fieldTimingPending = items.some(item => (
        item.intervention === 'field_window'
        && !item.immediate
        && !item.timingAskedAt
        && item.fieldWindowArm
        && now - item.createdAt >= 30 * 60_000
      ))
      if (fieldTimingPending) {
        setCandidate(null)
        return
      }
      const eligible = items.filter(item => item.sessionId !== sessionId && item.immediate)
      const nextDay = eligible.find(item => (
        now - item.createdAt >= 20 * 60 * 60_000
        && !item.horizonAskedAt?.next_day
        && !item.horizonOutcomes?.some(value => value.horizon === 'next_day')
      ))
      if (nextDay) {
        setCandidate({ id: nextDay.id, horizon: 'next_day' })
        return
      }
      const laterToday = eligible.find(item => (
        now - item.createdAt >= 2 * 60 * 60_000
        && !item.horizonAskedAt?.later_today
        && !item.horizonOutcomes?.some(value => value.horizon === 'later_today')
        && !item.delayedAskedAt
      ))
      setCandidate(laterToday ? { id: laterToday.id, horizon: 'later_today' } : null)
    })
  }, [sessionId])
  if (!candidate) return null
  const pick = async (delayed: DelayedOutcome) => {
    await writeHorizonOutcome(candidate.id, candidate.horizon, delayed)
    setCandidate(null)
  }
  const skip = async () => {
    await writeHorizonOutcome(candidate.id, candidate.horizon)
    setCandidate(null)
  }
  return (
    <div role="group" aria-label="Did anything stay with you?" style={{ border: '1px solid var(--border-subtle)', borderRadius: 10, padding: 10, margin: '8px 0 18px', font: "10px/1.4 'Inter', sans-serif", color: 'var(--text-secondary)' }}>
      <div style={{ marginBottom: 7 }}>{candidate.horizon === 'next_day' ? tr['ps.outcome.nextDay.prompt'] : tr['ps.outcome.laterToday.prompt']}</div>
      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
        {([['stayed', tr['ps.outcome.delayed.stayed']], ['used', tr['ps.outcome.delayed.used']], ['nothing', tr['ps.outcome.delayed.nothing']], ['regret', tr['ps.outcome.delayed.regret']], ['changed_mind', tr['ps.outcome.delayed.changed']]] as Array<[DelayedOutcome, string]>).map(([value, label]) => <button key={value} onClick={() => void pick(value)} style={{ border: '1px solid var(--border-light)', borderRadius: 999, padding: '3px 7px', background: 'transparent', color: 'var(--text-primary)', fontSize: 9, cursor: 'pointer' }}>{label}</button>)}
        <button onClick={() => void skip()} style={{ border: 0, background: 'transparent', color: 'var(--text-ghost)', cursor: 'pointer' }}>×</button>
      </div>
    </div>
  )
}

export function FieldWindowTimingPulse({ sessionId }: { sessionId: string }) {
  const tr = useTranslation()
  const [candidate, setCandidate] = useState<{
    id: string
    arm: 'field_check_in' | 'field_no_contact'
    label?: string
  } | null>(null)

  useEffect(() => {
    void db.interventionOutcomes.orderBy('createdAt').reverse().limit(48).toArray().then(items => {
      const item = items.find(outcome => (
        outcome.intervention === 'field_window'
        && !outcome.immediate
        && !outcome.timingAskedAt
        && outcome.fieldWindowArm
        && Date.now() - outcome.createdAt >= 30 * 60_000
        && outcome.sessionId !== sessionId
      ))
      setCandidate(item?.fieldWindowArm ? {
        id: item.id,
        arm: item.fieldWindowArm,
        label: item.windowLabel,
      } : null)
    })
  }, [sessionId])

  if (!candidate) return null
  const pick = async (outcome?: ImmediateOutcome) => {
    await writeFieldWindowTimingOutcome(candidate.id, outcome)
    setCandidate(null)
  }
  return (
    <div role="group" aria-label={tr['ps.field.outcome.label']} style={{ border: '1px solid var(--border-subtle)', borderRadius: 10, padding: 10, margin: '8px 0 18px', font: "10px/1.4 'Inter', sans-serif", color: 'var(--text-secondary)' }}>
      <div style={{ marginBottom: 3, color: 'var(--text-ghost)', fontSize: 9 }}>{candidate.label}</div>
      <div style={{ marginBottom: 7 }}>{candidate.arm === 'field_check_in' ? tr['ps.field.outcome.sent'] : tr['ps.field.outcome.quiet']}</div>
      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
        <button onClick={() => void pick('helped')} style={{ border: '1px solid var(--border-light)', borderRadius: 999, padding: '3px 7px', background: 'transparent', color: 'var(--text-primary)', fontSize: 9, cursor: 'pointer' }}>{tr['ps.field.outcome.fit']}</button>
        <button onClick={() => void pick('nothing')} style={{ border: '1px solid var(--border-light)', borderRadius: 999, padding: '3px 7px', background: 'transparent', color: 'var(--text-primary)', fontSize: 9, cursor: 'pointer' }}>{tr['ps.field.outcome.neutral']}</button>
        <button onClick={() => void pick('not_wanted')} style={{ border: '1px solid var(--border-light)', borderRadius: 999, padding: '3px 7px', background: 'transparent', color: 'var(--text-primary)', fontSize: 9, cursor: 'pointer' }}>{tr['ps.field.outcome.bad']}</button>
        <button aria-label="Skip" onClick={() => void pick()} style={{ border: 0, background: 'transparent', color: 'var(--text-ghost)', cursor: 'pointer' }}>×</button>
      </div>
    </div>
  )
}
