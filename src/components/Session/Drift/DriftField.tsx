import { useCallback, useEffect, useRef, useState } from 'react'
import { useDriftSession } from '../../../hooks/useDriftSession'
import { useDriftVoice } from '../../../hooks/useDriftVoice'
import { passMsForSoftening } from '../../../engine/driftEngine'
import type { DriftLength, NoticeDirection } from '../../../engine/driftEngine'
import { BilateralStimulus } from './BilateralStimulus'
import { DriftExchange } from './DriftExchange'
import { DriftClosing } from './DriftClosing'
import { getSettings, updateSettings } from '../../../store/settings'
import { acquireWakeLock, reacquireWakeLockIfVisible, releaseWakeLock } from '../../../native/keepAwake'
import { t } from '../../../i18n'
import type { DriftAnchorKind, DriftBlsChannel } from '../../../types'
import { engineLog } from '../../../services/diagnostics'

const CHIPS = ['drift.chip.worry', 'drift.chip.body', 'drift.chip.today', 'drift.chip.heavy', 'drift.chip.unsettled'] as const
type ChipKey = (typeof CHIPS)[number]

const LENGTHS: { value: DriftLength; key: 'drift.length.quick' | 'drift.length.short' | 'drift.length.full' }[] = [
  { value: 'quick', key: 'drift.length.quick' },
  { value: 'short', key: 'drift.length.short' },
  { value: 'full', key: 'drift.length.full' },
]

function microLineKey(direction: NoticeDirection, wave: number) {
  if (direction === 'softer') return (['drift.micro.softer1', 'drift.micro.softer2', 'drift.micro.softer3'] as const)[wave % 3]
  if (direction === 'same') return (['drift.micro.same1', 'drift.micro.same2'] as const)[wave % 2]
  return (['drift.micro.drift1', 'drift.micro.drift2'] as const)[wave % 2]
}

export interface DriftReturnSummary {
  direction: 'softer' | 'steady' | 'stronger' | 'unfinished'
  setCount: number
  reason: string | null
}

interface Props {
  parentSessionId: string | null
  hrvContext: string | null
  voiceAvailable: boolean
  onClose: (summary?: DriftReturnSummary) => void
}

const EMPTY_PARTS: string[] = []

export function DriftField({ parentSessionId, hrvContext, voiceAvailable, onClose }: Props) {
  const drift = useDriftSession(parentSessionId, hrvContext)
  const { phase, setCount, softerStreak, softerTotal, limits } = drift.state
  const { abandon, completeSet, settleDone, requestClose, recordInterruption, updateExperienceTelemetry } = drift
  const settings = getSettings()

  const [voice, setVoice] = useState(settings.lastDriftVoice)
  const [length, setLength] = useState<DriftLength>(settings.lastDriftLength)
  const [anchorKind, setAnchorKind] = useState<DriftAnchorKind>(settings.lastDriftAnchorKind ?? 'feet')
  const [blsChannel, setBlsChannel] = useState<DriftBlsChannel>(settings.lastDriftBlsChannel)
  const [chip, setChip] = useState<ChipKey>('drift.chip.unsettled')
  const [customOpen, setCustomOpen] = useState(false)
  const [customFocus, setCustomFocus] = useState('')
  const [lastDir, setLastDir] = useState<NoticeDirection | null>(null)
  const [adjusting, setAdjusting] = useState(!settings.driftHasCompleted)
  const [paused, setPaused] = useState(false)
  const primedAudioRef = useRef<AudioContext | null>(null)
  const cueRecordedRef = useRef(false)
  const firstRoundRecordedRef = useRef(false)
  const guidanceErrorRecordedRef = useRef(false)
  const roundRemainingRef = useRef(limits.setMs)
  const roundKeyRef = useRef('')

  const recordCueRequested = useCallback(() => {
    if (cueRecordedRef.current) return
    cueRecordedRef.current = true
    updateExperienceTelemetry({ firstCueRequestedAt: Date.now() })
  }, [updateExperienceTelemetry])

  const anchorCue = anchorKind === 'calm_place' ? t('drift.anchor.calmPlaceCue') : t('drift.anchor.feetCue')
  const waveHint = drift.companionCue || (setCount === 0
    ? anchorCue
    : !lastDir || lastDir === 'stronger' ? t('drift.set.hint') : t(microLineKey(lastDir, setCount)))

  const cueText = phase === 'set'
    ? waveHint
    : phase === 'notice' ? t('drift.notice.voiceCue') : phase === 'settle' ? t('drift.settle.line') : null

  const voiceOn = voice && voiceAvailable
  const driftVoice = useDriftVoice({
    enabled: voiceOn && phase !== 'arrive' && phase !== 'closed',
    cueKey: `${phase}:${setCount}`,
    cueText,
    userPartNames: EMPTY_PARTS,
    onCueRequested: recordCueRequested,
  })
  const voiceHold = voiceOn && (driftVoice.cueState === 'waiting' || driftVoice.cueState === 'speaking')
  const setActive = phase === 'set' && !voiceHold && !paused
  const settleActive = phase === 'settle' && !voiceHold && !paused

  const summary = (): DriftReturnSummary => ({
    direction: drift.state.closureReason === 'settle' || drift.state.closureReason === 'crisis'
      ? 'stronger'
      : softerTotal > 0 ? 'softer' : drift.state.closureReason ? 'steady' : 'unfinished',
    setCount,
    reason: drift.state.closureReason,
  })

  useEffect(() => { if (phase === 'closed') onClose(summary()) }, [phase]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { void abandon() }, [abandon])
  useEffect(() => () => {
    const context = primedAudioRef.current
    primedAudioRef.current = null
    if (context) void context.close()
  }, [])
  useEffect(() => {
    if (!voiceOn || phase === 'arrive' || phase === 'closed') return
    const voiceGuidanceState = driftVoice.usingDeviceVoice
      ? 'device_fallback'
      : driftVoice.voiceState === 'connected'
      ? 'connected'
      : driftVoice.voiceState === 'error' ? 'failed' : 'connecting'
    updateExperienceTelemetry({ voiceGuidanceState })
    if (voiceGuidanceState === 'failed' && !guidanceErrorRecordedRef.current) {
      guidanceErrorRecordedRef.current = true
      engineLog('warn', 'drift.guidance_failed', 'one-way Drift guidance could not connect', { sessionId: parentSessionId ?? undefined })
    }
  }, [voiceOn, phase, driftVoice.voiceState, driftVoice.usingDeviceVoice, updateExperienceTelemetry, parentSessionId])

  useEffect(() => {
    const key = phase === 'set' ? `set:${setCount}` : ''
    if (!key || roundKeyRef.current === key) return
    roundKeyRef.current = key
    roundRemainingRef.current = limits.setMs
  }, [phase, setCount, limits.setMs])

  // Pause/resume and spoken guidance preserve the round's remaining time.
  // The old timeout restarted from zero whenever audio state changed, which
  // made the displayed round, sound, and actual transition disagree.
  useEffect(() => {
    if (!setActive) return
    const startedAt = performance.now()
    const id = window.setTimeout(completeSet, roundRemainingRef.current)
    if (setCount === 0 && !firstRoundRecordedRef.current) {
      firstRoundRecordedRef.current = true
      updateExperienceTelemetry({ firstWaveStartedAt: Date.now() })
    }
    return () => {
      window.clearTimeout(id)
      roundRemainingRef.current = Math.max(0, roundRemainingRef.current - (performance.now() - startedAt))
    }
  }, [setActive, setCount, completeSet, updateExperienceTelemetry])
  useEffect(() => {
    if (!settleActive) return
    const id = window.setTimeout(settleDone, 12_000)
    return () => window.clearTimeout(id)
  }, [settleActive, settleDone])

  const inPractice = phase !== 'arrive' && phase !== 'closed'
  useEffect(() => {
    if (!inPractice) return
    void acquireWakeLock()
    return () => { void releaseWakeLock() }
  }, [inPractice])
  useEffect(() => {
    if (!inPractice) return
    const onVisibility = () => {
      if (document.hidden) {
        setPaused(true)
        recordInterruption()
      } else {
        void reacquireWakeLockIfVisible()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [inPractice, recordInterruption])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (phase === 'arrive') onClose()
      else requestClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phase, requestClose, onClose])

  const beginDrift = () => {
    // WebKit only guarantees Web Audio playback when the context is created or
    // resumed directly inside a user gesture. Prime the exact context the
    // rhythm will use before the first render of the practice.
    let audioState: 'not_requested' | 'priming' | 'failed' = 'not_requested'
    if (blsChannel === 'audio') {
      audioState = 'priming'
      try {
        primedAudioRef.current ??= new AudioContext()
        void primedAudioRef.current.resume().then(() => {
          updateExperienceTelemetry({ audioState: 'primed' })
        }).catch(() => {
          updateExperienceTelemetry({ audioState: 'failed' })
          engineLog('warn', 'drift.audio_failed', 'Drift audio context could not resume', { sessionId: parentSessionId ?? undefined })
        })
      } catch {
        audioState = 'failed'
        engineLog('warn', 'drift.audio_failed', 'Drift audio context could not be created', { sessionId: parentSessionId ?? undefined })
      }
    }
    updateSettings({
      lastDriftVoice: voice,
      lastDriftLength: length,
      lastDriftAnchorKind: anchorKind,
      lastDriftBlsChannel: blsChannel,
    })
    const custom = customFocus.trim()
    if (voice && voiceAvailable) driftVoice.primeCue('set:0', anchorCue)
    const standalone = window.matchMedia?.('(display-mode: standalone)').matches
      || Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
    void drift.begin({
      anchorKind,
      blsChannel,
      voice,
      length,
      focus: custom || t(chip),
      focusIsCustom: custom.length > 0,
      audioState,
      displayMode: standalone ? 'standalone' : 'browser',
    })
  }

  const submitCheckIn = async (text: string, direction: NoticeDirection) => {
    setLastDir(direction)
    if (text) await drift.submitNotice(text, direction)
    else drift.submitNoticeTap(direction)
  }

  const waveNumber = Math.min(setCount + (phase === 'set' ? 1 : 0), limits.setTarget)

  return (
    <div role="dialog" aria-modal="true" aria-label="Drift" style={overlayStyle}>
      <div aria-hidden style={{ ...warmthStyle, opacity: 0.05 + Math.min(setCount / limits.setTarget, 1) * 0.18 }} />

      <button
        type="button"
        aria-label={phase === 'arrive' ? t('drift.exit') : t('drift.settleClose')}
        onClick={() => phase === 'arrive' ? onClose() : requestClose()}
        style={closeBtn}
      >
        ×
      </button>

      <main key={phase} style={{ ...mainStyle, justifyContent: phase === 'arrive' ? 'flex-start' : 'center' }}>
        {phase === 'arrive' && (
          <div style={columnStyle}>
            <div style={{ font: "italic 28px/1.2 'Cormorant Garamond', serif" }}>{t('drift.arrive.title')}</div>
            <div style={{ fontSize: 14, lineHeight: 1.65, color: 'var(--text-secondary)', maxWidth: 430 }}>{t('drift.arrive.body')}</div>

            {!adjusting ? (
              <>
                <div style={rememberedStyle}>
                  <span>{t(chip)}</span><span>·</span><span>{t(LENGTHS.find((item) => item.value === length)!.key)}</span><span>·</span>
                  <span>{anchorKind === 'feet' ? t('drift.anchor.feet') : t('drift.anchor.calmPlace')}</span>
                </div>
                <button type="button" onClick={beginDrift} style={primaryBtn}>{t('drift.arrive.begin')}</button>
                <button type="button" onClick={() => setAdjusting(true)} style={textBtn}>{t('drift.arrive.adjust')}</button>
              </>
            ) : (
              <>
                <SectionLabel>{t('drift.begin.whats')}</SectionLabel>
                <div style={wrapStyle}>
                  {CHIPS.map((key) => <Choice key={key} active={!customOpen && chip === key} onClick={() => { setChip(key); setCustomOpen(false); setCustomFocus('') }}>{t(key)}</Choice>)}
                  <Choice active={customOpen} onClick={() => setCustomOpen(true)}>{t('drift.begin.somethingElse')}</Choice>
                </div>
                {customOpen && <input value={customFocus} onChange={(e) => setCustomFocus(e.target.value)} placeholder={t('drift.choose.placeholder')} aria-label={t('drift.begin.somethingElse')} autoFocus style={inputStyle} />}

                <SectionLabel>{t('drift.begin.length')}</SectionLabel>
                <div style={wrapStyle}>{LENGTHS.map(({ value, key }) => <Choice key={value} active={length === value} onClick={() => setLength(value)}>{t(key)}</Choice>)}</div>

                <SectionLabel>{t('drift.begin.anchorLabel')}</SectionLabel>
                <div style={wrapStyle}>
                  <Choice active={anchorKind === 'feet'} onClick={() => setAnchorKind('feet')}>{t('drift.anchor.feet')}</Choice>
                  <Choice active={anchorKind === 'calm_place'} onClick={() => { setAnchorKind('calm_place'); if (voiceAvailable) setVoice(true) }}>{t('drift.anchor.calmPlace')}</Choice>
                </div>

                <SectionLabel>{t('drift.arrive.rhythm')}</SectionLabel>
                <div style={wrapStyle}>
                  <Choice active={blsChannel === 'visual'} onClick={() => setBlsChannel('visual')}>{t('drift.arrive.visual')}</Choice>
                  <Choice active={blsChannel === 'audio'} onClick={() => setBlsChannel('audio')}>{t('drift.arrive.softNotes')}</Choice>
                </div>
                {blsChannel === 'audio' && <div style={helperStyle}>{t('drift.arrive.audioHelper')}</div>}

                {voiceAvailable && (
                  <label style={toggleStyle}>
                    <input type="checkbox" checked={voice} onChange={(e) => setVoice(e.target.checked)} />
                    <span><strong>{t('drift.arrive.voice')}</strong><small style={{ display: 'block', marginTop: 3, color: 'var(--text-tertiary)' }}>{t('drift.arrive.spokenHelper')}</small></span>
                  </label>
                )}
                <button type="button" onClick={beginDrift} style={primaryBtn}>{t('drift.arrive.begin')}</button>
              </>
            )}
            <div style={{ ...helperStyle, fontStyle: 'italic' }}>{t('drift.arrive.notTherapy')}</div>
          </div>
        )}

        {phase === 'set' && (
          <div style={columnStyle}>
            <div style={{ fontSize: 16, lineHeight: 1.7, color: 'var(--text-secondary)', maxWidth: 430 }}>{waveHint}</div>
            {voiceOn && driftVoice.voiceState === 'connecting' && <div role="status" style={helperStyle}>{t('drift.voice.connecting')}</div>}
            {voiceOn && driftVoice.cueState === 'failed' && <div role="status" style={helperStyle}>{t('drift.voice.unavailable')}</div>}
            {setCount === 0 && <div style={helperStyle}>{t('drift.set.butterflyHint')}</div>}
            <BilateralStimulus channel={blsChannel} running={setActive} passMs={passMsForSoftening(softerStreak)} volume={settings.lastDriftAudioVolume} audioContext={primedAudioRef.current} />
            <button type="button" onClick={completeSet} disabled={paused} style={ghostBtn}>{t('drift.set.skip')}</button>
          </div>
        )}

        {phase === 'notice' && (
          <div style={{ ...columnStyle, width: '100%' }}>
            <DriftExchange prompt={t('drift.notice.prompt')} onSubmit={submitCheckIn} submitting={drift.isSubmitting} disabled={voiceHold} />
          </div>
        )}

        {phase === 'settle' && (
          <div style={columnStyle}>
            <div style={{ fontSize: 17, lineHeight: 1.7, color: 'var(--text-secondary)', maxWidth: 430 }}>{t('drift.settle.line')}</div>
            <BilateralStimulus channel={blsChannel} running={settleActive} passMs={passMsForSoftening(0)} volume={settings.lastDriftAudioVolume} audioContext={primedAudioRef.current} />
          </div>
        )}

        {phase === 'closure' && (
          <DriftClosing
            reason={drift.state.closureReason}
            softened={softerTotal > 0}
            onSpeak={voiceOn && driftVoice.voiceState === 'connected' ? driftVoice.speak : undefined}
            onDone={() => { updateSettings({ driftHasCompleted: true }); void drift.closureDone() }}
          />
        )}
      </main>

      {(phase === 'set' || phase === 'notice' || phase === 'settle') && (
        <div data-testid="drift-progress" aria-label={`${waveNumber}/${limits.setTarget}`} style={progressStyle}>
          <span style={{ fontSize: 11, color: 'var(--text-tertiary)', marginRight: 4 }}>{t('drift.progress.wave')} {waveNumber}</span>
          {Array.from({ length: limits.setTarget }, (_, index) => <span key={index} data-filled={index < setCount} style={dotStyle(index < setCount, phase === 'set' && index === setCount)} />)}
        </div>
      )}

      {inPractice && phase !== 'closure' && (
        <div style={practiceControlsStyle}>
          <button type="button" onClick={() => setPaused((value) => !value)} style={controlBtn}>{t(paused ? 'drift.resume' : 'drift.pause')}</button>
          <button type="button" onClick={requestClose} style={controlBtn}>{t('drift.settleClose')}</button>
        </div>
      )}
      {paused && inPractice && phase !== 'closure' && (
        <div role="status" style={pauseCardStyle}>
          <div style={{ fontSize: 17 }}>{t('drift.paused.title')}</div>
          <div style={helperStyle}>{t('drift.paused.body')}</div>
          <button type="button" onClick={() => setPaused(false)} style={primaryBtn}>{t('drift.resume')}</button>
        </div>
      )}
    </div>
  )
}

function Choice({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" onClick={onClick} aria-pressed={active} style={chipBtn(active)}>{children}</button>
}
function SectionLabel({ children }: { children: React.ReactNode }) { return <div style={{ fontSize: 12, letterSpacing: '0.04em', color: 'var(--text-tertiary)', marginTop: 3 }}>{children}</div> }

const overlayStyle: React.CSSProperties = { position: 'fixed', inset: 0, zIndex: 1000, background: 'var(--bg-primary)', color: 'var(--text-primary)', overflow: 'hidden', fontFamily: "'Inter', sans-serif" }
const warmthStyle: React.CSSProperties = { position: 'absolute', inset: 0, pointerEvents: 'none', background: 'radial-gradient(ellipse at 50% 60%, color-mix(in srgb, var(--accent-warm) 55%, transparent) 0%, transparent 64%)', transition: 'opacity 1.4s ease' }
const mainStyle: React.CSSProperties = { position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 'max(76px, calc(48px + env(safe-area-inset-top))) 24px max(90px, calc(64px + env(safe-area-inset-bottom)))', textAlign: 'center', overflowY: 'auto' }
const columnStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, maxWidth: 500 }
const wrapStyle: React.CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }
const primaryBtn: React.CSSProperties = { padding: '12px 30px', borderRadius: 999, border: '1px solid var(--accent-warm)', background: 'var(--accent-warm)', color: '#fff', fontSize: 15, cursor: 'pointer', fontFamily: "'Inter', sans-serif", minWidth: 132 }
const ghostBtn: React.CSSProperties = { padding: '9px 18px', borderRadius: 999, border: '1px solid var(--border-light)', background: 'color-mix(in srgb, var(--bg-primary) 72%, transparent)', color: 'var(--text-tertiary)', fontSize: 13, cursor: 'pointer', fontFamily: "'Inter', sans-serif" }
const textBtn: React.CSSProperties = { border: 'none', background: 'transparent', color: 'var(--text-tertiary)', fontSize: 12, cursor: 'pointer' }
const helperStyle: React.CSSProperties = { fontSize: 12, lineHeight: 1.55, color: 'var(--text-tertiary)', maxWidth: 420 }
const toggleStyle: React.CSSProperties = { display: 'flex', alignItems: 'flex-start', gap: 10, textAlign: 'left', fontSize: 13, color: 'var(--text-secondary)', cursor: 'pointer', padding: '10px 14px', borderRadius: 12, border: '1px solid var(--border-subtle)', maxWidth: 330 }
const inputStyle: React.CSSProperties = { width: 'min(340px, 82vw)', background: 'transparent', border: 'none', borderBottom: '1px solid var(--border-light)', color: 'var(--text-primary)', fontSize: 15, textAlign: 'center', padding: '7px 4px', outline: 'none', fontFamily: "'Inter', sans-serif" }
const rememberedStyle: React.CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center', color: 'var(--text-secondary)', fontSize: 13, padding: '12px 18px', border: '1px solid var(--border-subtle)', borderRadius: 14 }
const closeBtn: React.CSSProperties = { position: 'absolute', zIndex: 3, top: 'calc(14px + env(safe-area-inset-top, 0px))', right: 18, width: 42, height: 42, borderRadius: '50%', border: '1px solid var(--border-subtle)', background: 'color-mix(in srgb, var(--bg-primary) 80%, transparent)', color: 'var(--text-secondary)', fontSize: 26, lineHeight: 1, cursor: 'pointer' }
const progressStyle: React.CSSProperties = { position: 'absolute', top: 'calc(24px + env(safe-area-inset-top, 0px))', left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: 8, alignItems: 'center' }
const practiceControlsStyle: React.CSSProperties = { position: 'absolute', zIndex: 3, bottom: 'calc(18px + env(safe-area-inset-bottom, 0px))', left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: 8 }
const controlBtn: React.CSSProperties = { padding: '9px 14px', borderRadius: 999, border: '1px solid var(--border-subtle)', background: 'color-mix(in srgb, var(--bg-primary) 78%, transparent)', color: 'var(--text-tertiary)', fontSize: 12, cursor: 'pointer' }
const pauseCardStyle: React.CSSProperties = { position: 'absolute', zIndex: 4, inset: 0, display: 'flex', flexDirection: 'column', gap: 16, justifyContent: 'center', alignItems: 'center', padding: 30, textAlign: 'center', background: 'color-mix(in srgb, var(--bg-primary) 94%, transparent)', backdropFilter: 'blur(8px)' }
function chipBtn(active: boolean): React.CSSProperties { return { padding: '8px 15px', borderRadius: 999, border: `1px solid ${active ? 'var(--accent-warm)' : 'var(--border-light)'}`, background: active ? 'var(--accent-warm)' : 'transparent', color: active ? '#fff' : 'var(--text-secondary)', fontSize: 13, cursor: 'pointer', fontFamily: "'Inter', sans-serif", transition: 'all 0.15s ease' } }
function dotStyle(filled: boolean, current: boolean): React.CSSProperties { return { width: current ? 10 : 8, height: current ? 10 : 8, borderRadius: 999, background: filled || current ? 'var(--accent-warm)' : 'transparent', border: `1px solid ${filled || current ? 'var(--accent-warm)' : 'var(--border-light)'}`, opacity: current ? 1 : 0.75, transition: 'all 0.5s ease' } }

export default DriftField
