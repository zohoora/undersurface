import { useEffect, useMemo, useState } from 'react'
import { deriveHalfLifeEvidence, deriveResearchFindings, deriveTransferEvidence, isTransferableArm } from '../../engine/personalScience'
import { db } from '../../store/db'
import { advanceTransferPractice, pauseTransferPractice, restartTransferPractice, resumeTransferPractice, reviewFinding, startTransferPractice } from '../../store/personalScience'
import type { InterventionOutcome, PersonalProtocol, PersonalScienceNeed, PersonalScienceState, ResearchArm, ResearchEvent, TransferLevel } from '../../types'
import { useTranslation, type TranslationKey } from '../../i18n'
import { LivingHypothesesPanel } from './LivingHypothesesPanel'

function armTranslationKey(arm: ResearchArm): TranslationKey {
  return ({
    witness: 'ps.arm.witness',
    reflect: 'ps.arm.reflect',
    clarify: 'ps.arm.clarify',
    make_concrete: 'ps.arm.make_concrete',
    user_first: 'ps.arm.user_first',
    offer_action: 'ps.arm.offer_action',
    offer_quiet: 'ps.arm.offer_quiet',
    handoff: 'ps.arm.handoff',
    close_warmly: 'ps.arm.close_warmly',
    generated_response: 'ps.arm.generated_response',
    designed_silence: 'ps.arm.designed_silence',
    continue_talk: 'ps.arm.continue_talk',
    offer_journal_arc: 'ps.arm.offer_journal_arc',
    journal_arc: 'ps.arm.journal_arc',
    speak_arc: 'ps.arm.speak_arc',
    relax_arc: 'ps.arm.relax_arc',
    drift_arc: 'ps.arm.drift_arc',
    room_arc: 'ps.arm.room_arc',
    transfer_companion_led: 'ps.arm.transfer_companion_led',
    transfer_user_first: 'ps.arm.transfer_user_first',
    transfer_minimal_cue: 'ps.arm.transfer_minimal_cue',
    transfer_independent: 'ps.arm.transfer_independent',
    field_check_in: 'ps.arm.field_check_in',
    field_no_contact: 'ps.arm.field_no_contact',
    single_hypothesis: 'ps.arm.single_hypothesis',
    ambiguity_prism: 'ps.arm.ambiguity_prism',
  })[arm] as TranslationKey
}

function fill(template: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce((text, [key, value]) => text.replaceAll(`{${key}}`, String(value)), template)
}

function stateTranslationKey(state?: PersonalScienceState): TranslationKey {
  return ({ stirred: 'ps.state.stirred', flat: 'ps.state.flat', looping: 'ps.state.looping', open: 'ps.state.open' } as const)[state ?? 'open']
}

function needTranslationKey(need?: PersonalScienceNeed): TranslationKey {
  return ({ witness: 'ps.need.witness', settle: 'ps.need.settle', perspective: 'ps.need.perspective', action: 'ps.need.action' } as const)[need ?? 'witness']
}

function confidenceTranslationKey(confidence: PersonalProtocol['confidence']): TranslationKey {
  return ({ early: 'ps.confidence.early', emerging: 'ps.confidence.emerging', repeated: 'ps.confidence.repeated' } as const)[confidence]
}

function transferLevelTranslationKey(level: TransferLevel): TranslationKey {
  return ({
    companion_led: 'ps.transfer.level.companionLed',
    user_first: 'ps.transfer.level.userFirst',
    minimal_cue: 'ps.transfer.level.minimalCue',
    independent: 'ps.transfer.level.independent',
  } as const)[level]
}

function halfLifeTranslationKey(status: ReturnType<typeof deriveHalfLifeEvidence>['status']): TranslationKey {
  return ({
    early: 'ps.halflife.early',
    carried: 'ps.halflife.carried',
    faded: 'ps.halflife.faded',
    mixed: 'ps.halflife.mixed',
  } as const)[status]
}

export function WhatHelpsMeSection({ isOpen }: { isOpen: boolean }) {
  const tr = useTranslation()
  const [events, setEvents] = useState<ResearchEvent[]>([])
  const [outcomes, setOutcomes] = useState<InterventionOutcome[]>([])
  const [protocols, setProtocols] = useState<PersonalProtocol[]>([])
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    if (!isOpen) return
    let cancelled = false
    void Promise.all([
      db.researchEvents.orderBy('createdAt').reverse().limit(120).toArray(),
      db.interventionOutcomes.orderBy('createdAt').reverse().limit(160).toArray(),
      db.personalProtocols.orderBy('updatedAt').reverse().limit(40).toArray(),
    ]).then(([eventRows, outcomeRows, protocolRows]) => {
      if (cancelled) return
      setEvents(eventRows)
      setOutcomes(outcomeRows)
      setProtocols(protocolRows)
    })
    return () => { cancelled = true }
  }, [isOpen])

  const findings = useMemo(() => deriveResearchFindings(events, outcomes, protocols), [events, outcomes, protocols])
  const rated = outcomes.filter(outcome => outcome.researchEventId && (outcome.immediate || outcome.delayed || outcome.horizonOutcomes?.length)).length
  const active = protocols.filter(protocol => protocol.status === 'active')

  const keep = async (index: number, status: PersonalProtocol['status']) => {
    const arm = tr[armTranslationKey(findings[index].preferredArm)]
    const title = fill(tr['ps.atlas.defaultTitle'], { arm })
    const saved = await reviewFinding(findings[index], status, title)
    setProtocols(rows => [saved, ...rows])
  }

  const retire = async (protocol: PersonalProtocol) => {
    const updatedAt = Date.now()
    await db.personalProtocols.update(protocol.id, { status: 'retired', updatedAt })
    setProtocols(rows => rows.map(row => row.id === protocol.id ? { ...row, status: 'retired', updatedAt } : row))
  }

  const rename = async (protocol: PersonalProtocol, title: string, updatedAt: number) => {
    const trimmed = title.trim()
    if (!trimmed || trimmed === protocol.title) return
    await db.personalProtocols.update(protocol.id, { title: trimmed, updatedAt })
    setProtocols(rows => rows.map(row => row.id === protocol.id ? { ...row, title: trimmed, updatedAt } : row))
  }

  const replaceProtocol = (updated: PersonalProtocol) => {
    setProtocols(rows => rows.map(row => row.id === updated.id ? updated : row))
  }

  const runTransfer = async (
    protocol: PersonalProtocol,
    action: (value: PersonalProtocol) => Promise<PersonalProtocol>,
  ) => replaceProtocol(await action(protocol))

  return (
    <div className="settings-section">
      <button type="button" onClick={() => setExpanded(value => !value)} aria-expanded={expanded} style={{ width: '100%', display: 'flex', justifyContent: 'space-between', border: 0, background: 'transparent', padding: 0, color: 'var(--text-primary)', cursor: 'pointer' }}>
        <span className="settings-section-label" style={{ margin: 0 }}>{tr['ps.atlas.title']}</span>
        <span style={{ color: 'var(--text-ghost)', fontSize: 11 }}>{expanded ? '−' : '+'}</span>
      </button>
      <div style={{ color: 'var(--text-ghost)', fontSize: 10, lineHeight: 1.45, marginTop: 5 }}>{fill(tr['ps.atlas.rated'], { count: rated })}</div>
      {expanded && (
        <div style={{ display: 'grid', gap: 8, marginTop: 9 }}>
          {active.map(protocol => (
            <div key={protocol.id} style={{ border: '1px solid var(--border-subtle)', borderRadius: 8, padding: 8 }}>
              <input defaultValue={protocol.title} aria-label={tr['ps.atlas.protocolName']} onBlur={event => void rename(protocol, event.target.value, Date.now())} style={{ width: '100%', boxSizing: 'border-box', border: 0, borderBottom: '1px solid var(--border-light)', background: 'transparent', color: 'var(--text-primary)', fontSize: 11, padding: '2px 0 4px' }} />
              <div style={{ color: 'var(--text-ghost)', fontSize: 9, marginTop: 3 }}>{fill(tr['ps.atlas.activeEvidence'], { confidence: tr[confidenceTranslationKey(protocol.confidence)], count: protocol.evidenceEventIds.length })}</div>
              <div style={{ color: 'var(--text-ghost)', fontSize: 9, marginTop: 3 }}>{fill(tr['ps.atlas.context'], { state: tr[stateTranslationKey(protocol.context?.state)], need: tr[needTranslationKey(protocol.context?.need)] })}</div>
              {(() => {
                const halfLife = deriveHalfLifeEvidence(protocol, events, outcomes)
                return (
                  <div style={{ marginTop: 7, borderTop: '1px solid var(--border-light)', paddingTop: 6 }}>
                    <div style={{ color: 'var(--text-secondary)', fontSize: 9 }}>{tr[halfLifeTranslationKey(halfLife.status)]}</div>
                    <div style={{ color: 'var(--text-ghost)', fontSize: 9, marginTop: 2 }}>
                      {fill(tr['ps.halflife.counts'], {
                        laterUseful: halfLife.laterTodayUseful,
                        laterTotal: halfLife.laterTodayReports,
                        nextUseful: halfLife.nextDayUseful,
                        nextTotal: halfLife.nextDayReports,
                      })}
                    </div>
                  </div>
                )
              })()}
              {(() => {
                const evidence = deriveTransferEvidence(protocol, events, outcomes)
                const level = protocol.transferLevel ?? 'companion_led'
                if (protocol.transferStatus === 'graduated') {
                  return (
                    <div style={{ marginTop: 8, borderTop: '1px solid var(--border-light)', paddingTop: 7 }}>
                      <div style={{ color: 'var(--text-secondary)', fontSize: 9, lineHeight: 1.4 }}>{tr['ps.transfer.graduated']}</div>
                      <button type="button" onClick={() => void runTransfer(protocol, restartTransferPractice)} style={{ border: '1px solid var(--border-light)', borderRadius: 999, background: 'transparent', color: 'var(--text-secondary)', padding: '3px 7px', marginTop: 6, cursor: 'pointer', fontSize: 9 }}>{tr['ps.transfer.restart']}</button>
                    </div>
                  )
                }
                if (protocol.transferStatus === 'paused') {
                  return <button type="button" onClick={() => void runTransfer(protocol, resumeTransferPractice)} style={{ border: '1px solid var(--border-light)', borderRadius: 999, background: 'transparent', color: 'var(--text-secondary)', padding: '3px 7px', marginTop: 7, cursor: 'pointer', fontSize: 9 }}>{tr['ps.transfer.resume']}</button>
                }
                if (protocol.transferStatus !== 'learning') {
                  if (!isTransferableArm(protocol.preferredArm)) return null
                  return <button type="button" onClick={() => void runTransfer(protocol, startTransferPractice)} style={{ border: '1px solid var(--border-subtle)', borderRadius: 999, background: 'transparent', color: 'var(--text-primary)', padding: '4px 8px', marginTop: 7, cursor: 'pointer', fontSize: 9 }}>{tr['ps.transfer.start']}</button>
                }
                const progress = evidence.status === 'collecting'
                  ? fill(tr['ps.transfer.collecting'], { rated: evidence.ratedEvents, current: evidence.currentSamples, next: evidence.nextSamples })
                  : evidence.status === 'ready'
                    ? tr['ps.transfer.ready']
                    : tr['ps.transfer.hold']
                return (
                  <div style={{ marginTop: 8, borderTop: '1px solid var(--border-light)', paddingTop: 7 }}>
                    <div style={{ color: 'var(--text-primary)', fontSize: 9 }}>{tr[transferLevelTranslationKey(level)]}</div>
                    <div style={{ color: 'var(--text-ghost)', fontSize: 9, lineHeight: 1.4, marginTop: 3 }}>{progress}</div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                      {evidence.status === 'ready' && (
                        <button type="button" onClick={() => void runTransfer(protocol, advanceTransferPractice)} style={{ border: '1px solid var(--border-subtle)', borderRadius: 999, background: 'transparent', color: 'var(--text-primary)', padding: '3px 7px', cursor: 'pointer', fontSize: 9 }}>{level === 'minimal_cue' ? tr['ps.transfer.graduate'] : tr['ps.transfer.advance']}</button>
                      )}
                      <button type="button" onClick={() => void runTransfer(protocol, pauseTransferPractice)} style={{ border: 0, background: 'transparent', color: 'var(--text-ghost)', padding: '3px 0', cursor: 'pointer', fontSize: 9 }}>{tr['ps.transfer.pause']}</button>
                    </div>
                  </div>
                )
              })()}
              <button type="button" onClick={() => void retire(protocol)} style={{ border: 0, background: 'transparent', padding: '7px 0 0', color: 'var(--text-ghost)', cursor: 'pointer', fontSize: 9 }}>{tr['ps.atlas.retire']}</button>
            </div>
          ))}
          {findings.map((finding, index) => (
            <div key={finding.id} style={{ border: '1px solid var(--border-subtle)', borderRadius: 8, padding: 8 }}>
              <div style={{ color: 'var(--text-primary)', fontSize: 11 }}>{fill(tr['ps.atlas.finding'], { arm: tr[armTranslationKey(finding.preferredArm)], state: tr[stateTranslationKey(finding.context.state)], need: tr[needTranslationKey(finding.context.need)] })}</div>
              <div style={{ color: 'var(--text-ghost)', fontSize: 9, lineHeight: 1.4, marginTop: 4 }}>{fill(tr['ps.atlas.evidence'], { confidence: tr[confidenceTranslationKey(finding.confidence)], rated: finding.ratedEvents, helped: finding.helpedCount, samples: finding.preferredSamples, negative: finding.negativeCount })}</div>
              <div style={{ display: 'flex', gap: 6, marginTop: 7 }}>
                <button type="button" onClick={() => void keep(index, 'active')} style={{ border: '1px solid var(--border-subtle)', borderRadius: 999, background: 'transparent', color: 'var(--text-primary)', padding: '3px 7px', fontSize: 9, cursor: 'pointer' }}>{tr['ps.atlas.keep']}</button>
                <button type="button" onClick={() => void keep(index, 'rejected')} style={{ border: 0, background: 'transparent', color: 'var(--text-ghost)', padding: '3px 0', fontSize: 9, cursor: 'pointer' }}>{tr['ps.atlas.reject']}</button>
              </div>
            </div>
          ))}
          {active.length === 0 && findings.length === 0 && <div style={{ fontSize: 10, color: 'var(--text-ghost)', lineHeight: 1.45 }}>{tr['ps.atlas.none']}</div>}
          <LivingHypothesesPanel isOpen={expanded} />
          <div style={{ fontSize: 9, lineHeight: 1.4, color: 'var(--text-ghost)' }}>{tr['ps.atlas.caveat']}</div>
          <div style={{ fontSize: 9, lineHeight: 1.4, color: 'var(--text-ghost)' }}>{tr['ps.atlas.fidelity']}</div>
        </div>
      )}
    </div>
  )
}
