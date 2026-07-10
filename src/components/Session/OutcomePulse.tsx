import { useEffect, useState } from 'react'
import { db } from '../../store/db'
import type { DelayedOutcome, ImmediateOutcome, SessionMessage } from '../../types'
import { writeDelayedOutcome, writeImmediateMessageOutcome } from '../../store/interventionOutcomes'

export function OutcomePulse({ message, sessionId }: { message: SessionMessage; sessionId: string }) {
  const [done, setDone] = useState(false)
  const id = `message-${message.id}`

  useEffect(() => {
    void db.interventionOutcomes.get(id).then(value => setDone(Boolean(value?.immediate)))
  }, [id])

  if (done) return null
  const pick = async (immediate: ImmediateOutcome) => {
    setDone(true)
    await writeImmediateMessageOutcome(id, message, sessionId, immediate)
  }
  return (
    <div role="group" aria-label="Did that help?" style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 5, margin: '-10px 0 18px', color: 'var(--text-ghost)', font: "9px 'Inter', sans-serif" }}>
      <span>did that help?</span>
      {([['helped', 'yes'], ['nothing', 'not really'], ['worse', 'made it worse'], ['not_wanted', 'not what I wanted']] as Array<[ImmediateOutcome, string]>).map(([value, label]) => (
        <button key={value} onClick={() => void pick(value)} style={{ border: '1px solid var(--border-light)', borderRadius: 999, padding: '3px 6px', background: 'transparent', color: 'var(--text-secondary)', fontSize: 9, cursor: 'pointer' }}>{label}</button>
      ))}
      <button onClick={() => setDone(true)} aria-label="Skip" style={{ border: 0, background: 'transparent', color: 'var(--text-ghost)', cursor: 'pointer' }}>×</button>
    </div>
  )
}

export function DelayedOutcomePulse({ sessionId }: { sessionId: string }) {
  const [outcomeId, setOutcomeId] = useState<string | null>(null)
  useEffect(() => {
    void db.interventionOutcomes.orderBy('createdAt').reverse().limit(24).toArray().then(items => {
      const candidate = items.find(item => item.sessionId !== sessionId && item.immediate && !item.delayed && !item.delayedAskedAt && Date.now() - item.createdAt > 2 * 60 * 60_000)
      setOutcomeId(candidate?.id ?? null)
    })
  }, [sessionId])
  if (!outcomeId) return null
  const pick = async (delayed: DelayedOutcome) => {
    await writeDelayedOutcome(outcomeId, delayed)
    setOutcomeId(null)
  }
  const skip = async () => {
    await writeDelayedOutcome(outcomeId)
    setOutcomeId(null)
  }
  return (
    <div role="group" aria-label="Did anything stay with you?" style={{ border: '1px solid var(--border-subtle)', borderRadius: 10, padding: 10, margin: '8px 0 18px', font: "10px/1.4 'Inter', sans-serif", color: 'var(--text-secondary)' }}>
      <div style={{ marginBottom: 7 }}>From last time, did anything stay with you?</div>
      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
        {([['stayed', 'stayed with me'], ['used', 'I used it'], ['nothing', 'not really'], ['regret', 'I regret it'], ['changed_mind', 'I see it differently']] as Array<[DelayedOutcome, string]>).map(([value, label]) => <button key={value} onClick={() => void pick(value)} style={{ border: '1px solid var(--border-light)', borderRadius: 999, padding: '3px 7px', background: 'transparent', color: 'var(--text-primary)', fontSize: 9, cursor: 'pointer' }}>{label}</button>)}
        <button onClick={() => void skip()} style={{ border: 0, background: 'transparent', color: 'var(--text-ghost)', cursor: 'pointer' }}>×</button>
      </div>
    </div>
  )
}
