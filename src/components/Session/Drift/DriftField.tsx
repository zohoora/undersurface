import { useEffect, useState } from 'react'
import { useDriftSession } from '../../../hooks/useDriftSession'
import { useDriftVoice } from '../../../hooks/useDriftVoice'
import { DRIFT_LIMITS } from '../../../engine/driftEngine'
import type { DriftPhase, ClosureReason } from '../../../engine/driftEngine'
import { BilateralStimulus } from './BilateralStimulus'
import { DriftExchange } from './DriftExchange'
import { DriftClosing } from './DriftClosing'
import { getSettings, updateSettings } from '../../../store/settings'
import { t } from '../../../i18n'
import type { DriftAnchorKind } from '../../../types'

// Mid-range pass duration inside the 1500–2500ms bound.
const PASS_MS = 2000

// Scripted cue spoken aloud on entry to each phase in voice mode. The safety-copy
// phases (anchor/settle/closure/abort) are fixed i18n strings, never LLM output;
// set/notice are null — the model asks/handles the notice itself per instructions.
function voiceCue(phase: DriftPhase, closureReason: ClosureReason): string | null {
  switch (phase) {
    case 'anchor': return t('drift.anchor.body')
    case 'choose': return t('drift.choose.hint')
    case 'baseline': return t('drift.baseline.prompt')
    case 'settle': return t('drift.settle.line')
    case 'closure': return closureReason === 'crisis' ? t('drift.abort.handoff') : t('drift.closure.anchor')
    default: return null // arrive, set, notice, closed
  }
}

interface Props {
  parentSessionId: string | null
  hrvContext: string | null
  voiceAvailable: boolean
  onClose: () => void
}

// Full-screen Drift overlay. Renders per engine phase; all flow authority lives
// in the engine (via useDriftSession). Theme-aware (var(--bg/-text)) so the BLS
// dot and copy stay legible in both light and dark.
export function DriftField({ parentSessionId, hrvContext, voiceAvailable, onClose }: Props) {
  const drift = useDriftSession(parentSessionId, hrvContext)
  const { phase } = drift.state
  const settings = getSettings()
  const blsChannel = settings.lastDriftBlsChannel
  const audioVolume = settings.lastDriftAudioVolume

  const [voice, setVoice] = useState(settings.lastDriftVoice)
  // v1: begin() records the initial anchorKind; the anchor-phase choice below
  // drives the in-session anchor reference (its label + future voice cues).
  const [anchorKind, setAnchorKind] = useState<DriftAnchorKind>('calm_place')

  // Voice mode: the Realtime adapter. Utterances route by phase into the same
  // engine driver as text; the crisis floor lives inside useDriftVoice.
  const voiceOn = voice && voiceAvailable
  const driftVoice = useDriftVoice({
    enabled: voiceOn && phase !== 'arrive' && phase !== 'closed',
    phase,
    cueText: voiceCue(phase, drift.state.closureReason),
    userPartNames: [], // v1: voice persona omits user-part names; text interweave still uses them
    onUtterance: (text) => {
      if (phase === 'choose') void drift.submitStartingPoint(text)
      else if (phase === 'baseline') void drift.submitBaseline(text)
      else if (phase === 'notice') void drift.submitNotice(text, 'skipped')
    },
    // activateGrounding() inside useDriftVoice already trips useDriftSession's
    // grounding subscription → CRISIS dispatch; handling it here would double-dispatch.
    onCrisis: () => {},
  })
  // In voice mode a BLS set holds until the model finishes its spoken cue.
  const setActive = phase === 'set' && !(voiceOn && driftVoice.assistantSpeaking)

  // Close the overlay once the engine reaches its terminal phase.
  useEffect(() => { if (phase === 'closed') onClose() }, [phase, onClose])

  // If the overlay unmounts mid-practice (navigation), mark the session abandoned.
  useEffect(() => () => { void drift.abandon() }, [drift])

  // Set / settle bands auto-advance after one set duration. In voice mode the
  // set clock starts only once the BLS is actually running (after the cue).
  useEffect(() => {
    if (!setActive) return
    const id = setTimeout(() => { drift.completeSet() }, DRIFT_LIMITS.setMs)
    return () => clearTimeout(id)
  }, [setActive, drift])
  useEffect(() => {
    if (phase !== 'settle') return
    const id = setTimeout(() => { drift.settleDone() }, DRIFT_LIMITS.setMs)
    return () => clearTimeout(id)
  }, [phase, drift])

  // Escape: from arrive just closes the overlay; anywhere else it routes through
  // the engine's graceful close (settle & land) — never a dead exit mid-practice.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (phase === 'arrive') onClose()
      else drift.requestClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phase, drift, onClose])

  const beginDrift = () => {
    updateSettings({ lastDriftVoice: voice })
    void drift.begin(anchorKind, blsChannel, voice)
  }

  const showSettleClose = phase !== 'arrive' && phase !== 'closure' && phase !== 'closed'
  const lastCompanion = [...drift.transcript].reverse().find(e => e.role === 'companion')?.content ?? ''

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Drift"
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'var(--bg-primary)', color: 'var(--text-primary)',
        overflow: 'hidden', fontFamily: "'Inter', sans-serif",
      }}
    >
      {(phase === 'set' || phase === 'settle') && (
        <BilateralStimulus channel={blsChannel} running={setActive || phase === 'settle'} passMs={PASS_MS} volume={audioVolume} />
      )}

      <div style={{
        position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: 24, padding: 28, textAlign: 'center',
      }}>
        {phase === 'arrive' && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18, maxWidth: 460 }}>
            <div style={{ fontSize: 22, color: 'var(--text-primary)' }}>{t('drift.arrive.title')}</div>
            <div style={{ fontSize: 15, lineHeight: 1.65, color: 'var(--text-secondary)' }}>{t('drift.arrive.body')}</div>
            <div style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--text-tertiary)', fontStyle: 'italic' }}>{t('drift.arrive.notTherapy')}</div>
            {voiceAvailable && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-secondary)', cursor: 'pointer' }}>
                <input type="checkbox" checked={voice} onChange={(e) => setVoice(e.target.checked)} />
                {t('drift.arrive.voice')}
              </label>
            )}
            <button type="button" onClick={beginDrift} style={primaryBtn}>{t('drift.arrive.begin')}</button>
          </div>
        )}

        {phase === 'anchor' && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18, maxWidth: 460 }}>
            <div style={{ fontSize: 20, color: 'var(--text-primary)' }}>{t('drift.anchor.title')}</div>
            <div style={{ fontSize: 15, lineHeight: 1.65, color: 'var(--text-secondary)' }}>{t('drift.anchor.body')}</div>
            <div style={{ display: 'flex', gap: 12 }}>
              <button type="button" onClick={() => setAnchorKind('calm_place')} aria-pressed={anchorKind === 'calm_place'} style={choiceBtn(anchorKind === 'calm_place')}>
                {t('drift.anchor.calmPlace')}
              </button>
              <button type="button" onClick={() => setAnchorKind('feet')} aria-pressed={anchorKind === 'feet'} style={choiceBtn(anchorKind === 'feet')}>
                {t('drift.anchor.feet')}
              </button>
            </div>
            <button type="button" onClick={drift.confirmAnchor} style={primaryBtn}>{t('drift.anchor.confirm')}</button>
          </div>
        )}

        {phase === 'choose' && (
          <DriftExchange prompt={t('drift.choose.hint')} showPills={false} onSubmit={(text) => { void drift.submitStartingPoint(text) }} />
        )}

        {phase === 'baseline' && (
          <DriftExchange prompt={t('drift.baseline.prompt')} showPills={false} onSubmit={(text) => { void drift.submitBaseline(text) }} />
        )}

        {phase === 'set' && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
            <div style={{ fontSize: 15, color: 'var(--text-secondary)' }}>{t('drift.set.hint')}</div>
            {drift.state.setCount < 2 && (
              <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{t('drift.set.butterflyHint')}</div>
            )}
            <button type="button" onClick={drift.completeSet} style={ghostBtn}>{t('drift.set.skip')}</button>
          </div>
        )}

        {phase === 'notice' && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 22, width: '100%', maxWidth: 460 }}>
            {!voiceOn && (drift.streamingText || lastCompanion) && (
              <div style={{ fontSize: 15, lineHeight: 1.7, color: 'var(--text-primary)' }}>{drift.streamingText || lastCompanion}</div>
            )}
            <DriftExchange prompt={t('drift.notice.prompt')} showPills onSubmit={(text, dir) => { void drift.submitNotice(text, dir) }} />
          </div>
        )}

        {phase === 'settle' && (
          <div style={{ fontSize: 16, lineHeight: 1.7, color: 'var(--text-secondary)', maxWidth: 420 }}>{t('drift.settle.line')}</div>
        )}

        {phase === 'closure' && (
          <DriftClosing reason={drift.state.closureReason} onDone={() => { void drift.closureDone() }} />
        )}
      </div>

      {showSettleClose && (
        <button
          type="button"
          onClick={drift.requestClose}
          style={{
            position: 'absolute', bottom: 'calc(16px + env(safe-area-inset-bottom, 0px))', left: '50%', transform: 'translateX(-50%)',
            padding: '8px 16px', borderRadius: 999, border: '1px solid var(--border-subtle)',
            background: 'transparent', color: 'var(--text-tertiary)', fontSize: 12, cursor: 'pointer', fontFamily: "'Inter', sans-serif",
          }}
        >
          {t('drift.settleClose')}
        </button>
      )}
    </div>
  )
}

const primaryBtn: React.CSSProperties = {
  padding: '11px 28px', borderRadius: 999, border: '1px solid var(--accent-warm)',
  background: 'var(--accent-warm)', color: '#fff', fontSize: 15, cursor: 'pointer', fontFamily: "'Inter', sans-serif",
}
const ghostBtn: React.CSSProperties = {
  padding: '8px 18px', borderRadius: 999, border: '1px solid var(--border-light)',
  background: 'transparent', color: 'var(--text-tertiary)', fontSize: 13, cursor: 'pointer', fontFamily: "'Inter', sans-serif",
}
function choiceBtn(active: boolean): React.CSSProperties {
  return {
    padding: '10px 20px', borderRadius: 14, border: `1px solid ${active ? 'var(--accent-warm)' : 'var(--border-light)'}`,
    background: active ? 'var(--accent-warm)' : 'transparent', color: active ? '#fff' : 'var(--text-secondary)',
    fontSize: 14, cursor: 'pointer', fontFamily: "'Inter', sans-serif", transition: 'all 0.15s ease',
  }
}

export default DriftField
