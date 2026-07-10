import { useState } from 'react'
import { db } from '../../store/db'
import { linkResearchOutcome } from '../../store/personalScience'
import type { AllianceRepairReason, SessionMessage, TransferLevel } from '../../types'
import { useTranslation, type TranslationKey } from '../../i18n'
import { repairReasonLabelKey } from '../../engine/allianceRepair'

const REPAIR_REASONS: AllianceRepairReason[] = ['too_fast', 'too_certain', 'too_much_advice', 'wrong_direction', 'too_many_questions', 'other']

function transferLevelKey(level: TransferLevel): TranslationKey {
  return ({
    companion_led: 'ps.transfer.level.companionLed',
    user_first: 'ps.transfer.level.userFirst',
    minimal_cue: 'ps.transfer.level.minimalCue',
    independent: 'ps.transfer.level.independent',
  } as const)[level]
}

export function ResearchMomentNotice({ message, onOverride }: { message: SessionMessage; onOverride: () => void }) {
  const tr = useTranslation()
  if (!message.researchEventId) return null
  const transferLevel = message.researchArm?.startsWith('transfer_')
    ? message.researchArm.slice('transfer_'.length) as TransferLevel
    : undefined
  const fixed = message.researchArm === 'designed_silence'
    || message.researchArm === 'offer_journal_arc'
    || Boolean(transferLevel && transferLevel !== 'companion_led')
  const notice = transferLevel
    ? tr['ps.notice.transfer'].replace('{level}', tr[transferLevelKey(transferLevel)])
    : tr['ps.notice']
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7, margin: '-14px 0 15px', color: 'var(--text-ghost)', font: "9px 'Inter', sans-serif" }}>
      <span>{notice}</span>
      {fixed && <button type="button" onClick={onOverride} style={{ border: 0, background: 'transparent', color: 'var(--text-secondary)', padding: 0, cursor: 'pointer', textDecoration: 'underline', fontSize: 9 }}>{tr['ps.override']}</button>}
    </div>
  )
}

export function AllianceRepairFeedback({
  message,
  sessionId,
  onRepair,
}: {
  message: SessionMessage
  sessionId: string
  onRepair: (reason: AllianceRepairReason) => void
}) {
  const [open, setOpen] = useState(false)
  const [done, setDone] = useState(false)
  const tr = useTranslation()
  if (done || message.speaker !== 'therapist') return null

  const pick = async (reason: AllianceRepairReason) => {
    setDone(true)
    const now = Date.now()
    const id = `repair-${message.id}`
    try {
      await db.interventionOutcomes.add({
        id,
        source: message.surface ?? 'talk',
        sourceId: message.id,
        sessionId,
        intervention: message.responseMode ?? 'reflect',
        immediate: 'not_wanted',
        repairReason: reason,
        ...(message.researchEventId ? { researchEventId: message.researchEventId } : {}),
        createdAt: now,
        updatedAt: now,
      })
      if (message.researchEventId) await linkResearchOutcome(message.researchEventId, id).catch(() => {})
    } finally {
      // A failed telemetry write must never suppress the repair the writer
      // explicitly requested.
      onRepair(reason)
    }
  }

  return (
    <div style={{ margin: '-14px 0 14px', font: "9px 'Inter', sans-serif", color: 'var(--text-ghost)' }}>
      {!open ? (
        <button type="button" onClick={() => setOpen(true)} style={{ border: 0, background: 'transparent', color: 'var(--text-ghost)', padding: 0, cursor: 'pointer', fontSize: 9 }}>{tr['ps.missed']}</button>
      ) : (
        <div role="group" aria-label="How did the response miss?" style={{ display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center' }}>
          {REPAIR_REASONS.map(reason => <button key={reason} type="button" onClick={() => void pick(reason)} style={{ border: '1px solid var(--border-light)', borderRadius: 999, background: 'transparent', color: 'var(--text-secondary)', padding: '3px 6px', cursor: 'pointer', fontSize: 9 }}>{tr[repairReasonLabelKey(reason)]}</button>)}
          <button type="button" aria-label="Dismiss" onClick={() => setOpen(false)} style={{ border: 0, background: 'transparent', color: 'var(--text-ghost)', cursor: 'pointer' }}>×</button>
        </div>
      )}
    </div>
  )
}
