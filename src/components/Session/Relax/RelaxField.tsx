import { useEffect, useRef } from 'react'
import { useRelaxSession, type RelaxHrvInput, type RelaxSettings } from '../../../hooks/useRelaxSession'
import { getSettings } from '../../../store/settings'
import { t } from '../../../i18n'
import { RelaxSettingsPanel } from './RelaxSettingsPanel'
import { RelaxBreathCircle } from './RelaxBreathCircle'
import { RelaxControls } from './RelaxControls'
import { RelaxClosingSummary } from './RelaxClosingSummary'

interface Props {
  parentSessionId: string | null
  onClose: () => void
  // HRV state lifted from the parent so we don't spawn a parallel HrvEngine.
  // Defaults to disabled so the overlay still works when biometrics are off
  // (Slice A behavior preserved).
  hrv?: RelaxHrvInput
}

export function RelaxField({ parentSessionId, onClose, hrv }: Props) {
  const relax = useRelaxSession(parentSessionId, hrv)
  const hasOpenedRef = useRef(false)

  useEffect(() => {
    relax.open()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Tell the parent to close once the state machine has come back around
  // to idle (after ending or cancel). hasOpenedRef gates the very first
  // render, when relax.state is still 'idle' on mount.
  useEffect(() => {
    if (relax.state !== 'idle') {
      hasOpenedRef.current = true
      return
    }
    if (hasOpenedRef.current) onClose()
  }, [relax.state, onClose])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (relax.state === 'guiding') relax.end()
      else if (relax.state === 'settings') {
        relax.cancel()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [relax, onClose])

  const initial: RelaxSettings = (() => {
    const s = getSettings()
    return {
      duration: s.lastRelaxDuration,
      sessionType: s.lastRelaxType,
      audioTrack: s.lastRelaxAudio,
      audioVolume: s.lastRelaxAudioVolume,
      voiceEnabled: s.lastRelaxVoiceEnabled,
      visualMode: s.lastRelaxVisualMode,
    }
  })()

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Relax mode"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        background: '#0a0b0e',
        overflow: 'hidden',
      }}
    >
      {relax.state === 'settings' && (
        <RelaxSettingsPanel
          initial={initial}
          onBegin={(s) => { void relax.begin(s) }}
          onCancel={() => { relax.cancel(); onClose() }}
        />
      )}

      {relax.state === 'calibrating' && relax.settings && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'rgba(220,220,230,0.7)',
            fontFamily: "'Inter', sans-serif",
            gap: 12,
          }}
        >
          <div style={{ fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(200,200,210,0.5)' }}>
            {t('relax.calibrating.title')}
          </div>
          <div style={{ fontSize: 14, color: 'rgba(220,220,230,0.6)', maxWidth: 320, textAlign: 'center' }}>
            {t('relax.calibrating.subtitle')}
          </div>
          <button
            type="button"
            onClick={() => relax.end()}
            style={{
              marginTop: 24,
              padding: '8px 14px',
              border: '1px solid rgba(255,255,255,0.14)',
              borderRadius: 8,
              background: 'transparent',
              color: 'rgba(220,220,230,0.6)',
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            {t('relax.calibrating.skip')}
          </button>
        </div>
      )}

      {(relax.state === 'guiding' || relax.state === 'ending') && relax.settings && (
        <>
          <RelaxBreathCircle
            sessionType={relax.settings.sessionType}
            visualMode={relax.settings.visualMode}
            ending={relax.state === 'ending'}
            coherence={relax.smoothedCoherence}
          />
          {relax.state === 'guiding' && (
            <RelaxControls
              audioMuted={relax.audioMuted}
              voiceMuted={relax.voiceMuted}
              audioAvailable={relax.settings.audioTrack !== 'none'}
              voiceAvailable={relax.settings.voiceEnabled}
              visualMode={relax.settings.visualMode}
              elapsedMs={relax.elapsedMs}
              durationMs={relax.durationMs}
              hrvHr={hrv?.latest?.hr ?? null}
              hrvCoherence={relax.smoothedCoherence}
              onToggleAudio={relax.toggleAudio}
              onToggleVoice={relax.toggleVoice}
              onCycleVisual={relax.cycleVisual}
              onEnd={relax.end}
            />
          )}
          {relax.state === 'ending' && (
            <RelaxClosingSummary
              elapsedMs={relax.elapsedMs}
              durationMs={relax.durationMs}
            />
          )}
        </>
      )}
    </div>
  )
}

export default RelaxField
