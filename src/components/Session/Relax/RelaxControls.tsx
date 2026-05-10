import { t } from '../../../i18n'
import type { RelaxVisualMode } from '../../../types'

interface Props {
  audioMuted: boolean
  voiceMuted: boolean
  audioAvailable: boolean
  voiceAvailable: boolean
  visualMode: RelaxVisualMode
  elapsedMs: number
  durationMs: number
  // HRV biofeedback indicators. Both null when biometrics are off — render
  // nothing in that case rather than placeholder dashes.
  hrvHr?: number | null
  hrvCoherence?: number | null
  onToggleAudio: () => void
  onToggleVoice: () => void
  onCycleVisual: () => void
  onEnd: () => void
}

function fmtTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export function RelaxControls({
  audioMuted,
  voiceMuted,
  audioAvailable,
  voiceAvailable,
  visualMode,
  elapsedMs,
  durationMs,
  hrvHr,
  hrvCoherence,
  onToggleAudio,
  onToggleVoice,
  onCycleVisual,
  onEnd,
}: Props) {
  const remainingMs = Math.max(0, durationMs - elapsedMs)
  const hasBiometrics = (hrvHr ?? null) !== null

  return (
    <>
      <div
        aria-hidden
        style={{
          position: 'absolute',
          top: 'calc(18px + env(safe-area-inset-top, 0px))',
          left: 0,
          right: 0,
          textAlign: 'center',
          fontFamily: "'Inter', sans-serif",
          fontSize: 11,
          letterSpacing: '0.1em',
          color: 'rgba(220,220,230,0.4)',
          pointerEvents: 'none',
        }}
      >
        {fmtTime(remainingMs)}
      </div>

      {hasBiometrics && (
        <div
          aria-hidden
          style={{
            position: 'absolute',
            top: 'calc(40px + env(safe-area-inset-top, 0px))',
            left: 0,
            right: 0,
            display: 'flex',
            justifyContent: 'center',
            gap: 16,
            fontFamily: "'Inter', sans-serif",
            fontSize: 10,
            letterSpacing: '0.06em',
            color: 'rgba(200,210,230,0.5)',
            pointerEvents: 'none',
          }}
        >
          <span>{Math.round(hrvHr ?? 0)} bpm</span>
          {(hrvCoherence ?? null) !== null && (
            <span>coherence {(hrvCoherence ?? 0).toFixed(2)}</span>
          )}
        </div>
      )}

      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 'calc(40px + env(safe-area-inset-bottom, 0px))',
          display: 'flex',
          justifyContent: 'center',
          gap: 16,
          alignItems: 'center',
        }}
      >
        {audioAvailable && (
          <IconBtn label={audioMuted ? t('relax.controls.unmuteAudio') : t('relax.controls.muteAudio')} active={!audioMuted} onClick={onToggleAudio}>
            {audioMuted ? <IconAudioOff /> : <IconAudioOn />}
          </IconBtn>
        )}
        {voiceAvailable && (
          <IconBtn label={voiceMuted ? t('relax.controls.unmuteVoice') : t('relax.controls.muteVoice')} active={!voiceMuted} onClick={onToggleVoice}>
            {voiceMuted ? <IconVoiceOff /> : <IconVoiceOn />}
          </IconBtn>
        )}
        <IconBtn label={t('relax.controls.cycleVisual')} active={visualMode !== 'off'} onClick={onCycleVisual}>
          <IconVisual visualMode={visualMode} />
        </IconBtn>
        <button
          onClick={onEnd}
          aria-label={t('relax.controls.end')}
          style={{
            width: 60,
            height: 60,
            borderRadius: '50%',
            border: 'none',
            background: 'rgba(178,93,93,0.78)',
            color: '#fff',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="6" width="12" height="12" rx="1.5" />
          </svg>
        </button>
      </div>
    </>
  )
}

function IconBtn({ label, active, onClick, children }: { label: string; active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      style={{
        width: 46,
        height: 46,
        borderRadius: '50%',
        border: '1px solid rgba(255,255,255,0.12)',
        background: active ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.02)',
        color: active ? 'rgba(230,230,240,0.85)' : 'rgba(180,180,190,0.45)',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transition: 'all 0.2s',
        backdropFilter: 'blur(8px)',
      }}
    >
      {children}
    </button>
  )
}

const SVG_PROPS = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }

function IconAudioOn() {
  return <svg {...SVG_PROPS}><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><path d="M15.54 8.46a5 5 0 0 1 0 7.07" /></svg>
}
function IconAudioOff() {
  return <svg {...SVG_PROPS}><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><line x1="23" y1="9" x2="17" y2="15" /><line x1="17" y1="9" x2="23" y2="15" /></svg>
}
function IconVoiceOn() {
  return <svg {...SVG_PROPS}><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /></svg>
}
function IconVoiceOff() {
  return <svg {...SVG_PROPS}><line x1="1" y1="1" x2="23" y2="23" /><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" /><path d="M17 16.95A7 7 0 0 1 5 12v-2" /></svg>
}
function IconVisual({ visualMode }: { visualMode: RelaxVisualMode }) {
  if (visualMode === 'off') {
    return <svg {...SVG_PROPS}><circle cx="12" cy="12" r="2" /></svg>
  }
  return <svg {...SVG_PROPS}><circle cx="12" cy="12" r={visualMode === 'full' ? 8 : 5} /></svg>
}

export default RelaxControls
