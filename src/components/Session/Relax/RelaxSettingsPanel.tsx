import { useState } from 'react'
import { t } from '../../../i18n'
import { getGlobalConfig } from '../../../store/globalConfig'
import { useSoundscapePrefetch, type SoundscapeErrorKind } from '../../../hooks/useSoundscapePrefetch'
import { SOUNDSCAPE_PRESETS } from './soundscapePresets'
import type { RelaxAudioTrack, RelaxSessionType, RelaxVisualMode } from '../../../types'
import type { RelaxSettings } from '../../../hooks/useRelaxSession'

interface Props {
  initial: RelaxSettings
  onBegin: (settings: RelaxSettings) => void
  onCancel: () => void
}

const DURATIONS: RelaxSettings['duration'][] = [5, 10, 20]
const TYPES: RelaxSessionType[] = ['breathwork', 'body_scan', 'safe_place', 'open_awareness']
const STATIC_TRACKS: RelaxAudioTrack[] = ['none', 'ocean', 'forest', 'drone', 'binaural']
const VISUAL_MODES: RelaxVisualMode[] = ['full', 'minimal', 'off']

export function RelaxSettingsPanel({ initial, onBegin, onCancel }: Props) {
  const [duration, setDuration] = useState<RelaxSettings['duration']>(initial.duration)
  const [sessionType, setSessionType] = useState<RelaxSessionType>(initial.sessionType)
  const [audioTrack, setAudioTrack] = useState<RelaxAudioTrack>(initial.audioTrack)
  const [audioVolume, setAudioVolume] = useState(initial.audioVolume)
  const [voiceEnabled, setVoiceEnabled] = useState(initial.voiceEnabled)
  const [visualMode, setVisualMode] = useState<RelaxVisualMode>(initial.visualMode)
  const [customPrompt, setCustomPrompt] = useState(initial.customAudio?.prompt ?? '')

  const customSoundscapesEnabled = getGlobalConfig()?.features?.customSoundscapesEnabled === true
  const isCustom = audioTrack === 'custom'
  const prefetch = useSoundscapePrefetch(customPrompt, isCustom && customSoundscapesEnabled)

  const beginDisabled = isCustom && prefetch.status !== 'ready'

  // The Begin button click is the load-bearing user gesture for audio play()
  // and wake lock acquire. Both must fire synchronously inside this handler.
  const handleBegin = () => {
    if (beginDisabled) return
    onBegin({
      duration,
      sessionType,
      audioTrack,
      audioVolume,
      voiceEnabled,
      visualMode,
      customAudio: isCustom && prefetch.audio
        ? { url: prefetch.audio.url, prompt: prefetch.audio.prompt }
        : undefined,
    })
  }

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 'calc(24px + env(safe-area-inset-top, 0px)) 24px calc(24px + env(safe-area-inset-bottom, 0px))',
        color: 'rgba(230,230,240,0.9)',
        fontFamily: "'Inter', sans-serif",
        overflowY: 'auto',
      }}
    >
      <div style={{ maxWidth: 380, width: '100%', display: 'flex', flexDirection: 'column', gap: 18 }}>
        <h2 style={{ fontSize: 18, fontWeight: 400, letterSpacing: '0.05em', textAlign: 'center', margin: 0, color: 'rgba(240,240,250,0.92)' }}>
          {t('relax.settings.title')}
        </h2>

        <Group label={t('relax.settings.duration.label')}>
          {DURATIONS.map(d => (
            <Pill key={d} active={duration === d} onClick={() => setDuration(d)}>
              {t(`relax.settings.duration.${d}`)}
            </Pill>
          ))}
        </Group>

        <Group label={t('relax.settings.type.label')}>
          {TYPES.map(typ => (
            <Pill key={typ} active={sessionType === typ} onClick={() => setSessionType(typ)}>
              {t(`relax.settings.type.${typ}`)}
            </Pill>
          ))}
        </Group>

        <Group label={t('relax.settings.audio.label')}>
          {STATIC_TRACKS.map(tr => (
            <Pill key={tr} active={audioTrack === tr} onClick={() => setAudioTrack(tr)}>
              {t(`relax.settings.audio.${tr}`)}
            </Pill>
          ))}
          {customSoundscapesEnabled && (
            <Pill active={audioTrack === 'custom'} onClick={() => setAudioTrack('custom')}>
              {t('relax.settings.audio.custom')}
            </Pill>
          )}
        </Group>

        {isCustom && customSoundscapesEnabled && (
          <div>
            <label style={labelStyle}>{t('relax.settings.audio.promptLabel')}</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
              {SOUNDSCAPE_PRESETS.map(p => (
                <Pill key={p.id} active={customPrompt === p.prompt} onClick={() => setCustomPrompt(p.prompt)}>
                  {t(`relax.settings.audio.preset.${p.id}` as const)}
                </Pill>
              ))}
            </div>
            <textarea
              value={customPrompt}
              onChange={e => setCustomPrompt(e.target.value.slice(0, 200))}
              placeholder={t('relax.settings.audio.promptPlaceholder')}
              maxLength={200}
              rows={2}
              style={{
                width: '100%',
                padding: '8px 10px',
                borderRadius: 8,
                border: '1px solid rgba(255,255,255,0.14)',
                background: 'rgba(255,255,255,0.04)',
                color: 'rgba(240,240,250,0.95)',
                fontFamily: "'Inter', sans-serif",
                fontSize: 13,
                resize: 'none',
                outline: 'none',
                lineHeight: 1.4,
              }}
            />
            <div style={{ marginTop: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <button
                type="button"
                onClick={prefetch.generate}
                disabled={!prefetch.canGenerate}
                style={{
                  padding: '7px 14px',
                  borderRadius: 8,
                  border: '1px solid rgba(160,180,210,0.35)',
                  background: prefetch.canGenerate ? 'rgba(120,140,180,0.5)' : 'rgba(120,140,180,0.18)',
                  color: prefetch.canGenerate ? '#fff' : 'rgba(220,220,230,0.4)',
                  fontFamily: "'Inter', sans-serif",
                  fontSize: 12,
                  fontWeight: 500,
                  cursor: prefetch.canGenerate ? 'pointer' : 'not-allowed',
                }}
              >
                {prefetch.status === 'loading' ? t('relax.settings.audio.generating') : t('relax.settings.audio.generate')}
              </button>
              <span style={{ fontSize: 10, color: 'rgba(200,200,210,0.4)' }}>
                {customPrompt.length}/200
              </span>
            </div>
            <div style={{ marginTop: 6, minHeight: 14 }}>
              <PrefetchStatus status={prefetch.status} cached={prefetch.audio?.cached ?? false} errorKind={prefetch.errorKind} />
            </div>
            <div style={{ fontSize: 10, color: 'rgba(200,200,210,0.45)', marginTop: 4, lineHeight: 1.4 }}>
              {t('relax.settings.audio.promptHelp')}
            </div>
          </div>
        )}

        {audioTrack !== 'none' && (
          <div>
            <label style={labelStyle}>{t('relax.settings.audio.volume')}</label>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={audioVolume}
              onChange={e => setAudioVolume(parseFloat(e.target.value))}
              style={{ width: '100%', marginTop: 6, accentColor: 'rgba(160,180,210,0.8)' }}
            />
          </div>
        )}

        <Group label={t('relax.settings.voice.label')}>
          <Pill active={!voiceEnabled} onClick={() => setVoiceEnabled(false)}>
            {t('relax.settings.voice.off')}
          </Pill>
          <Pill active={voiceEnabled} onClick={() => setVoiceEnabled(true)}>
            {t('relax.settings.voice.on')}
          </Pill>
        </Group>

        <Group label={t('relax.settings.visual.label')}>
          {VISUAL_MODES.map(v => (
            <Pill key={v} active={visualMode === v} onClick={() => setVisualMode(v)}>
              {t(`relax.settings.visual.${v}`)}
            </Pill>
          ))}
        </Group>

        <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
          <button onClick={onCancel} style={cancelBtnStyle} type="button">
            {t('relax.settings.cancel')}
          </button>
          <button
            onClick={handleBegin}
            style={{ ...beginBtnStyle, opacity: beginDisabled ? 0.4 : 1, cursor: beginDisabled ? 'not-allowed' : 'pointer' }}
            type="button"
            disabled={beginDisabled}
          >
            {t('relax.settings.begin')}
          </button>
        </div>
      </div>
    </div>
  )
}

function PrefetchStatus({ status, cached, errorKind }: {
  status: ReturnType<typeof useSoundscapePrefetch>['status']
  cached: boolean
  errorKind: SoundscapeErrorKind | null
}) {
  if (status === 'idle' || status === 'loading') return null
  if (status === 'ready') {
    const label = cached ? t('relax.settings.audio.cached') : t('relax.settings.audio.ready')
    return (
      <span style={{ fontSize: 11, color: 'rgba(140,200,160,0.75)' }}>
        ✓ {label}
      </span>
    )
  }
  // status === 'error'
  const errorKey: Parameters<typeof t>[0] =
    errorKind === 'rate_limit' ? 'relax.settings.audio.error.rateLimit'
    : errorKind === 'validation' ? 'relax.settings.audio.error.validation'
    : errorKind === 'network' ? 'relax.settings.audio.error.network'
    : 'relax.settings.audio.error.provider'
  return (
    <span style={{ fontSize: 11, color: 'rgba(220,150,150,0.85)' }}>
      ! {t(errorKey)}
    </span>
  )
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 11,
  color: 'rgba(220,220,230,0.5)',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  marginBottom: 8,
}


const beginBtnStyle: React.CSSProperties = {
  flex: 1,
  padding: '12px 24px',
  border: 'none',
  borderRadius: 8,
  background: 'rgba(120,140,180,0.6)',
  color: '#fff',
  fontFamily: "'Inter', sans-serif",
  fontSize: 14,
  fontWeight: 500,
  cursor: 'pointer',
}

const cancelBtnStyle: React.CSSProperties = {
  flex: '0 0 auto',
  padding: '12px 18px',
  border: '1px solid rgba(255,255,255,0.14)',
  borderRadius: 8,
  background: 'transparent',
  color: 'rgba(220,220,230,0.7)',
  fontFamily: "'Inter', sans-serif",
  fontSize: 14,
  cursor: 'pointer',
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={labelStyle}>{label}</label>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>{children}</div>
    </div>
  )
}

function Pill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      style={{
        padding: '8px 14px',
        borderRadius: 999,
        border: `1px solid ${active ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.12)'}`,
        background: active ? 'rgba(255,255,255,0.08)' : 'transparent',
        color: active ? 'rgba(240,240,250,0.95)' : 'rgba(200,200,210,0.6)',
        cursor: 'pointer',
        fontSize: 13,
        fontFamily: "'Inter', sans-serif",
        transition: 'all 0.15s',
      }}
    >
      {children}
    </button>
  )
}

export default RelaxSettingsPanel
