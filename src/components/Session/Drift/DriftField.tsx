import { useEffect, useState } from 'react'
import { useDriftSession } from '../../../hooks/useDriftSession'
import { useDriftVoice } from '../../../hooks/useDriftVoice'
import { passMsForSoftening } from '../../../engine/driftEngine'
import type { DriftPhase, DriftLength, ClosureReason, NoticeDirection } from '../../../engine/driftEngine'
import { BilateralStimulus } from './BilateralStimulus'
import { DriftExchange } from './DriftExchange'
import { DriftClosing } from './DriftClosing'
import { getSettings, updateSettings } from '../../../store/settings'
import { t } from '../../../i18n'
import type { DriftAnchorKind } from '../../../types'

// "What's stirring?" chips — app-authored copy, safe by construction, so a
// chip start never needs a crisis check. The unsettled chip is the default.
const CHIPS = [
  'drift.chip.worry',
  'drift.chip.body',
  'drift.chip.today',
  'drift.chip.heavy',
  'drift.chip.unsettled',
] as const
type ChipKey = (typeof CHIPS)[number]

const LENGTHS: { value: DriftLength; key: 'drift.length.quick' | 'drift.length.short' | 'drift.length.full' }[] = [
  { value: 'quick', key: 'drift.length.quick' },
  { value: 'short', key: 'drift.length.short' },
  { value: 'full', key: 'drift.length.full' },
]

// Scripted cue spoken aloud on entry to each phase in voice mode. Safety-copy
// phases (settle/closure/abort) are fixed i18n strings, never LLM output. The
// anchor teaching is spoken once at the first wave (v2 has no anchor screen);
// notice is null — the model asks per its instructions.
function voiceCue(phase: DriftPhase, closureReason: ClosureReason, setCount: number): string | null {
  switch (phase) {
    case 'set': return setCount === 0 ? t('drift.anchor.body') : null
    case 'settle': return t('drift.settle.line')
    case 'closure': return closureReason === 'crisis' ? t('drift.abort.handoff') : t('drift.closure.anchor')
    default: return null // arrive, anchor, choose, baseline (transited in begin), notice, closed
  }
}

// Rotating scripted micro-line shown as the next wave's hint after a tap-only
// check-in. Deterministic (indexed by wave count) — no clock, no randomness.
function microLineKey(direction: NoticeDirection, wave: number) {
  if (direction === 'softer') {
    return (['drift.micro.softer1', 'drift.micro.softer2', 'drift.micro.softer3'] as const)[wave % 3]
  }
  if (direction === 'same') {
    return (['drift.micro.same1', 'drift.micro.same2'] as const)[wave % 2]
  }
  return (['drift.micro.drift1', 'drift.micro.drift2'] as const)[wave % 2]
}

interface Props {
  parentSessionId: string | null
  hrvContext: string | null
  voiceAvailable: boolean
  onClose: () => void
}

// Full-screen Drift overlay, v2: one begin screen (chips + length + anchor),
// short waves with visible progression, tap-first check-ins. All flow authority
// lives in the engine (via useDriftSession). Theme-aware (var(--bg/-text)).
export function DriftField({ parentSessionId, hrvContext, voiceAvailable, onClose }: Props) {
  const drift = useDriftSession(parentSessionId, hrvContext)
  const { phase, setCount, softerStreak, softerTotal, limits } = drift.state
  // Stable useCallback handlers off the API. Effects/timers depend on THESE, not
  // the whole `drift` object — which is a fresh literal each render, so keying an
  // effect on it would reset the wave/settle timers on every 1s TICK re-render
  // and run the abandon cleanup on every re-render.
  const { abandon, completeSet, settleDone, requestClose } = drift
  const settings = getSettings()
  const blsChannel = settings.lastDriftBlsChannel
  const audioVolume = settings.lastDriftAudioVolume

  const [voice, setVoice] = useState(settings.lastDriftVoice)
  const [length, setLength] = useState<DriftLength>(settings.lastDriftLength)
  const [anchorKind, setAnchorKind] = useState<DriftAnchorKind>('feet')
  const [chip, setChip] = useState<ChipKey>('drift.chip.unsettled')
  const [customOpen, setCustomOpen] = useState(false)
  const [customFocus, setCustomFocus] = useState('')
  // Last check-in direction — drives the scripted micro-line on the next wave.
  const [lastDir, setLastDir] = useState<NoticeDirection | null>(null)

  // Voice mode: the Realtime adapter. Utterances route into the same engine
  // driver as text; the crisis floor lives inside useDriftVoice.
  const voiceOn = voice && voiceAvailable
  const driftVoice = useDriftVoice({
    enabled: voiceOn && phase !== 'arrive' && phase !== 'closed',
    phase,
    cueText: voiceCue(phase, drift.state.closureReason, setCount),
    userPartNames: [], // v1 decision kept: voice persona omits user-part names
    onUtterance: (text) => {
      if (phase === 'notice') void drift.submitNotice(text, 'skipped')
    },
    // activateGrounding() inside useDriftVoice already trips useDriftSession's
    // grounding subscription → CRISIS dispatch; handling it here would double-dispatch.
    onCrisis: () => {},
  })
  // A BLS wave holds while the model speaks its cue, and the FIRST wave also
  // waits for the voice session to finish connecting (the anchor cue retries
  // on connect — speak() is a no-op before the data channel opens).
  const voiceHold = voiceOn && (driftVoice.assistantSpeaking || (setCount === 0 && driftVoice.voiceState === 'connecting'))
  const setActive = phase === 'set' && !voiceHold

  // Close the overlay once the engine reaches its terminal phase.
  useEffect(() => { if (phase === 'closed') onClose() }, [phase, onClose])

  // If the overlay unmounts mid-practice (navigation), mark the session abandoned.
  // Keyed on the stable `abandon` so it fires only on true unmount, not re-renders.
  useEffect(() => () => { void abandon() }, [abandon])

  // Wave / settle bands auto-advance after one wave duration (from the active
  // limits — fixed at begin, so these deps never churn).
  const waveMs = limits.setMs
  useEffect(() => {
    if (!setActive) return
    const id = setTimeout(() => { completeSet() }, waveMs)
    return () => clearTimeout(id)
  }, [setActive, completeSet, waveMs])
  useEffect(() => {
    if (phase !== 'settle') return
    const id = setTimeout(() => { settleDone() }, waveMs)
    return () => clearTimeout(id)
  }, [phase, settleDone, waveMs])

  // Escape: from arrive just closes the overlay; anywhere else it routes through
  // the engine's graceful close (settle & land) — never a dead exit mid-practice.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (phase === 'arrive') onClose()
      else requestClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phase, requestClose, onClose])

  const beginDrift = () => {
    updateSettings({ lastDriftVoice: voice, lastDriftLength: length })
    const custom = customFocus.trim()
    void drift.begin({
      anchorKind,
      blsChannel,
      voice,
      length,
      focus: custom || t(chip),
      focusIsCustom: custom.length > 0,
    })
  }

  const submitCheckIn = (text: string, direction: NoticeDirection) => {
    setLastDir(direction)
    if (text) void drift.submitNotice(text, direction)
    else drift.submitNoticeTap(direction)
  }

  const showSettleClose = phase !== 'arrive' && phase !== 'closure' && phase !== 'closed'
  const lastCompanion = [...drift.transcript].reverse().find(e => e.role === 'companion')?.content ?? ''
  // Wave hint: the first wave teaches, later waves carry the scripted micro-line
  // that answers the writer's last tap. Typed check-ins stream the companion on
  // the notice screen instead.
  const waveHint = setCount === 0 || !lastDir || lastDir === 'stronger'
    ? t('drift.set.hint')
    : t(microLineKey(lastDir, setCount))
  const waveNumber = Math.min(setCount + (phase === 'set' ? 1 : 0), limits.setTarget)

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
      {/* Warmth layer — deepens as waves complete; progression you can feel. */}
      <div
        aria-hidden
        style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          background: 'radial-gradient(ellipse at 50% 62%, var(--accent-warm) 0%, transparent 62%)',
          opacity: Math.min(setCount / limits.setTarget, 1) * 0.12,
          transition: 'opacity 1.6s ease',
        }}
      />

      {(phase === 'set' || phase === 'settle') && (
        <BilateralStimulus
          channel={blsChannel}
          running={setActive || phase === 'settle'}
          passMs={passMsForSoftening(softerStreak)}
          volume={audioVolume}
        />
      )}

      <div style={{
        position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: 24, padding: 28, textAlign: 'center',
      }}>
        {phase === 'arrive' && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20, maxWidth: 480 }}>
            <div style={{ fontSize: 22, color: 'var(--text-primary)' }}>{t('drift.arrive.title')}</div>
            <div style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--text-secondary)' }}>{t('drift.arrive.body')}</div>

            <div style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>{t('drift.begin.whats')}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
              {CHIPS.map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => { setChip(key); setCustomOpen(false); setCustomFocus('') }}
                  aria-pressed={!customOpen && chip === key}
                  style={chipBtn(!customOpen && chip === key)}
                >
                  {t(key)}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setCustomOpen(true)}
                aria-pressed={customOpen}
                style={chipBtn(customOpen)}
              >
                {t('drift.begin.somethingElse')}
              </button>
            </div>
            {customOpen && (
              <input
                value={customFocus}
                onChange={(e) => setCustomFocus(e.target.value)}
                placeholder={t('drift.choose.placeholder')}
                aria-label={t('drift.begin.somethingElse')}
                autoFocus
                style={{
                  width: '100%', maxWidth: 340, background: 'transparent', border: 'none',
                  borderBottom: '1px solid var(--border-light)', color: 'var(--text-primary)',
                  fontSize: 15, textAlign: 'center', padding: '6px 4px', outline: 'none',
                  fontFamily: "'Inter', sans-serif",
                }}
              />
            )}

            <div style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>{t('drift.begin.length')}</div>
            <div style={{ display: 'flex', gap: 8 }}>
              {LENGTHS.map(({ value, key }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setLength(value)}
                  aria-pressed={length === value}
                  style={chipBtn(length === value)}
                >
                  {t(key)}
                </button>
              ))}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
              <span style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>{t('drift.begin.anchorLabel')}</span>
              <button type="button" onClick={() => setAnchorKind('feet')} aria-pressed={anchorKind === 'feet'} style={chipBtn(anchorKind === 'feet')}>
                {t('drift.anchor.feet')}
              </button>
              <button type="button" onClick={() => setAnchorKind('calm_place')} aria-pressed={anchorKind === 'calm_place'} style={chipBtn(anchorKind === 'calm_place')}>
                {t('drift.anchor.calmPlace')}
              </button>
            </div>

            {voiceAvailable && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-secondary)', cursor: 'pointer' }}>
                <input type="checkbox" checked={voice} onChange={(e) => setVoice(e.target.checked)} />
                {t('drift.arrive.voice')}
              </label>
            )}

            <button type="button" onClick={beginDrift} style={primaryBtn}>{t('drift.arrive.begin')}</button>
            <div style={{ fontSize: 12, lineHeight: 1.6, color: 'var(--text-tertiary)', fontStyle: 'italic' }}>{t('drift.arrive.notTherapy')}</div>
          </div>
        )}

        {phase === 'set' && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
            <div style={{ fontSize: 15, lineHeight: 1.65, color: 'var(--text-secondary)', maxWidth: 420 }}>{waveHint}</div>
            {setCount < 1 && (
              <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{t('drift.set.butterflyHint')}</div>
            )}
            <button type="button" onClick={completeSet} style={ghostBtn}>{t('drift.set.skip')}</button>
          </div>
        )}

        {phase === 'notice' && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 22, width: '100%', maxWidth: 460 }}>
            {!voiceOn && (drift.streamingText || lastCompanion) && (
              <div style={{ fontSize: 15, lineHeight: 1.7, color: 'var(--text-primary)' }}>{drift.streamingText || lastCompanion}</div>
            )}
            <DriftExchange prompt={t('drift.notice.prompt')} onSubmit={submitCheckIn} />
          </div>
        )}

        {phase === 'settle' && (
          <div style={{ fontSize: 16, lineHeight: 1.7, color: 'var(--text-secondary)', maxWidth: 420 }}>{t('drift.settle.line')}</div>
        )}

        {phase === 'closure' && (
          <DriftClosing reason={drift.state.closureReason} softened={softerTotal > 0} onDone={() => { void drift.closureDone() }} />
        )}
      </div>

      {/* Wave progression — always visible during the practice loop. */}
      {(phase === 'set' || phase === 'notice' || phase === 'settle') && (
        <div
          data-testid="drift-progress"
          aria-label={`${waveNumber}/${limits.setTarget}`}
          style={{
            position: 'absolute', top: 'calc(20px + env(safe-area-inset-top, 0px))', left: '50%',
            transform: 'translateX(-50%)', display: 'flex', gap: 8,
          }}
        >
          {Array.from({ length: limits.setTarget }, (_, i) => (
            <span
              key={i}
              data-filled={i < setCount}
              style={{
                width: 7, height: 7, borderRadius: 999,
                background: i < setCount ? 'var(--accent-warm)' : 'transparent',
                border: '1px solid ' + (i < setCount ? 'var(--accent-warm)' : 'var(--border-light)'),
                opacity: phase === 'set' && i === setCount ? 0.9 : 0.7,
                transition: 'all 0.6s ease',
              }}
            />
          ))}
        </div>
      )}

      {showSettleClose && (
        <button
          type="button"
          onClick={requestClose}
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
  padding: '11px 30px', borderRadius: 999, border: '1px solid var(--accent-warm)',
  background: 'var(--accent-warm)', color: '#fff', fontSize: 15, cursor: 'pointer', fontFamily: "'Inter', sans-serif",
}
const ghostBtn: React.CSSProperties = {
  padding: '8px 18px', borderRadius: 999, border: '1px solid var(--border-light)',
  background: 'transparent', color: 'var(--text-tertiary)', fontSize: 13, cursor: 'pointer', fontFamily: "'Inter', sans-serif",
}
function chipBtn(active: boolean): React.CSSProperties {
  return {
    padding: '8px 16px', borderRadius: 999, border: `1px solid ${active ? 'var(--accent-warm)' : 'var(--border-light)'}`,
    background: active ? 'var(--accent-warm)' : 'transparent', color: active ? '#fff' : 'var(--text-secondary)',
    fontSize: 13, cursor: 'pointer', fontFamily: "'Inter', sans-serif", transition: 'all 0.15s ease',
  }
}

export default DriftField
