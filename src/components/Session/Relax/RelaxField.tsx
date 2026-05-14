import { useEffect, useRef } from 'react'
import { useRelaxSession, type RelaxHrvInput, type RelaxSettings } from '../../../hooks/useRelaxSession'
import { getSettings } from '../../../store/settings'
import { t } from '../../../i18n'
import { RelaxSettingsPanel } from './RelaxSettingsPanel'
import { RelaxBreathCircle } from './RelaxBreathCircle'
import { RelaxControls } from './RelaxControls'
import { RelaxClosingSummary } from './RelaxClosingSummary'
import { BiometricsBar } from '../HrvAmbientBar'

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
    // The textarea pre-fills from the prompt only — the URL must come from
    // a fresh prefetch (signed URLs expire and aren't persisted).
    return {
      duration: s.lastRelaxDuration,
      sessionType: s.lastRelaxType,
      audioTrack: s.lastRelaxAudio,
      audioVolume: s.lastRelaxAudioVolume,
      voiceEnabled: s.lastRelaxVoiceEnabled,
      visualMode: s.lastRelaxVisualMode,
      ...(s.lastRelaxCustomPrompt ? { customAudio: { url: '', prompt: s.lastRelaxCustomPrompt } } : {}),
    }
  })()

  const showBiometricsBar = hrv?.available === true && hrv.enabled === true
  const showEnableBiometricsButton = hrv?.available === true && hrv.enabled === false

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
      {/* Top biometrics bar — only when the engine is running. Mirrors the
          SessionView pattern; the consent dialog (rendered by SessionView) is
          z-indexed above this overlay so toggle prompts surface cleanly. */}
      {showBiometricsBar && (
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          zIndex: 5,
          padding: 'calc(6px + env(safe-area-inset-top, 0px)) 12px 6px',
          background: 'rgba(10,11,14,0.85)',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          backdropFilter: 'blur(8px)',
        }}>
          <div style={{ maxWidth: 640, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ flex: 1 }}>
              <BiometricsBar
                latest={hrv.latest}
                measurementCount={hrv.measurementCount ?? 0}
                isCalibrating={hrv.calibrating}
                error={hrv.error ?? null}
              />
            </div>
            {hrv.toggle && (
              <button
                onClick={hrv.toggle}
                style={{
                  padding: '3px 8px',
                  borderRadius: 6,
                  border: '1px solid rgba(255,255,255,0.14)',
                  background: 'rgba(178,93,93,0.15)',
                  color: 'rgba(220,220,230,0.8)',
                  fontFamily: "'Inter', sans-serif",
                  fontSize: 10,
                  cursor: 'pointer',
                  flexShrink: 0,
                }}
              >
                {t('relax.biometrics.stop')}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Enable-biometrics affordance when the flag is on but the engine is
          off. Triggers SessionView's consent flow if no prior consent. */}
      {showEnableBiometricsButton && hrv?.toggle && (
        <button
          onClick={hrv.toggle}
          aria-label={t('relax.biometrics.enable')}
          style={{
            position: 'absolute',
            top: 'calc(10px + env(safe-area-inset-top, 0px))',
            right: 12,
            zIndex: 5,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '6px 10px',
            borderRadius: 8,
            border: '1px solid rgba(255,255,255,0.14)',
            background: 'rgba(255,255,255,0.04)',
            color: 'rgba(220,220,230,0.7)',
            fontFamily: "'Inter', sans-serif",
            fontSize: 11,
            cursor: 'pointer',
            backdropFilter: 'blur(6px)',
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
            <circle cx="12" cy="13" r="4" />
          </svg>
          {t('relax.biometrics.enable')}
        </button>
      )}

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
            respiratoryRate={hrv?.latest?.respiratoryRate ?? null}
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
              hasTopBar={showBiometricsBar}
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
