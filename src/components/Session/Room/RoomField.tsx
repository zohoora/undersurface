import { useMemo, useState } from 'react'
import { useTranslation } from '../../../i18n'
import { useRoomSession, type RoomConfig } from '../../../hooks/useRoomSession'
import { useSettings } from '../../../store/settings'
import type { MemoryAperture, RoomApproach, RoomAudioTrack, RoomDuration, RoomVoiceDensity } from '../../../types'

interface Props {
  parentSessionId: string | null
  memoryAperture: MemoryAperture
  buildInstructions: (config: RoomConfig) => Promise<string>
  rememberedConfig?: Partial<Pick<RoomConfig, 'approach' | 'duration' | 'voiceDensity' | 'audioTrack'>>
  voiceAvailable: boolean
  onUserTranscript: (text: string) => void
  onAssistantTranscript: (text: string) => void
  onClose: () => void
}

const APPROACHES: RoomApproach[] = ['listen_first', 'lead_me', 'quiet_company']
const DURATIONS: RoomDuration[] = [2, 5, 10]
const SOUNDS: RoomAudioTrack[] = ['ocean', 'forest', 'drone', 'binaural', 'none']

export function RoomField({
  parentSessionId,
  memoryAperture,
  buildInstructions,
  rememberedConfig,
  voiceAvailable,
  onUserTranscript,
  onAssistantTranscript,
  onClose,
}: Props) {
  const tr = useTranslation()
  const settings = useSettings()
  const rememberedApproach = rememberedConfig?.approach ?? settings.lastRoomApproach
  const [approach, setApproach] = useState<RoomApproach>(voiceAvailable ? rememberedApproach : 'quiet_company')
  const [duration, setDuration] = useState<RoomDuration>(rememberedConfig?.duration ?? settings.lastRoomDuration)
  const [audioTrack, setAudioTrack] = useState<RoomAudioTrack>(rememberedConfig?.audioTrack ?? settings.lastRoomAudio)
  const [starting, setStarting] = useState(false)
  const room = useRoomSession({ parentSessionId, memoryAperture, onUserTranscript, onAssistantTranscript })

  const rememberedDensity = rememberedConfig?.voiceDensity ?? settings.lastRoomVoiceDensity
  const voiceDensity: RoomVoiceDensity = approach === 'quiet_company'
    ? 'quiet'
    : rememberedDensity === 'quiet' ? 'sparse' : rememberedDensity
  const config = useMemo<RoomConfig>(() => ({
    approach,
    duration,
    audioTrack,
    voiceDensity,
    audioVolume: settings.lastRoomAudioVolume,
  }), [approach, audioTrack, duration, settings.lastRoomAudioVolume, voiceDensity])

  const begin = async () => {
    if (starting) return
    setStarting(true)
    try {
      const instructions = await buildInstructions(config)
      await room.start(config, instructions)
    } finally {
      setStarting(false)
    }
  }

  const finishAndClose = (completed = true) => {
    room.finish(completed)
    onClose()
  }

  return (
    <section
      className={`room-field room-field--${room.phase} room-field--${room.config?.audioTrack ?? audioTrack}`}
      aria-label={tr['room.aria']}
    >
      <button
        type="button"
        className="room-close"
        aria-label={tr['room.controls.leave']}
        onClick={() => room.phase === 'choosing' ? onClose() : finishAndClose(false)}
      >
        ×
      </button>
      <div className="room-atmosphere" aria-hidden="true">
        <div className="room-atmosphere__wash room-atmosphere__wash--one" />
        <div className="room-atmosphere__wash room-atmosphere__wash--two" />
        <div className="room-atmosphere__horizon" />
      </div>

      {room.phase === 'choosing' && (
        <div className="room-choose">
          <p className="room-eyebrow">{tr['room.choose.eyebrow']}</p>
          <h2>{tr['room.choose.title']}</h2>
          <p className="room-subtitle">{tr['room.choose.subtitle']}</p>

          <div className="room-approaches" role="radiogroup" aria-label={tr['room.choose.title']}>
            {APPROACHES.filter(item => voiceAvailable || item === 'quiet_company').map(item => (
              <button
                key={item}
                type="button"
                role="radio"
                aria-checked={approach === item}
                className="room-approach"
                onClick={() => setApproach(item)}
              >
                <span>{tr[`room.approach.${item === 'listen_first' ? 'listen' : item === 'lead_me' ? 'lead' : 'quiet'}.title`]}</span>
                <small>{tr[`room.approach.${item === 'listen_first' ? 'listen' : item === 'lead_me' ? 'lead' : 'quiet'}.body`]}</small>
              </button>
            ))}
          </div>

          <div className="room-choices-row">
            <fieldset>
              <legend>{tr['room.length.label']}</legend>
              <div className="room-pills">
                {DURATIONS.map(item => (
                  <button key={item} type="button" aria-pressed={duration === item} onClick={() => setDuration(item)}>
                    {tr[`room.length.${item}`]}
                  </button>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend>{tr['room.sound.label']}</legend>
              <div className="room-pills">
                {SOUNDS.map(item => (
                  <button key={item} type="button" aria-pressed={audioTrack === item} onClick={() => setAudioTrack(item)}>
                    {tr[`room.sound.${item}`]}
                  </button>
                ))}
              </div>
            </fieldset>
          </div>

          <button type="button" className="room-primary" onClick={() => void begin()} disabled={starting}>
            {starting ? tr['room.preparing'] : tr['room.begin']}
          </button>
        </div>
      )}

      {room.phase === 'threshold' && (
        <div className="room-threshold">
          <div className={`room-presence ${room.assistantSpeaking ? 'is-speaking' : ''} ${room.userSpeaking ? 'is-listening' : ''}`} aria-hidden="true" />
          <h2>{tr['room.threshold.title']}</h2>
          <p>{tr['room.threshold.body']}</p>
          <p className="room-voice-state">
            {room.voiceState === 'connecting'
              ? tr['room.voice.connecting']
              : room.assistantSpeaking
                ? tr['room.voice.speaking']
                : tr['room.voice.listening']}
          </p>
          {room.caption && <p className="room-caption">{room.caption}</p>}
          {room.voiceError && (
            <div className="room-voice-error">
              <span>{tr['room.voice.error']}</span>
              <button type="button" onClick={() => room.setVoiceDensity('quiet')}>{tr['room.voice.continueQuietly']}</button>
            </div>
          )}
          <button type="button" className="room-primary" onClick={room.enter}>{tr['room.threshold.enter']}</button>
        </div>
      )}

      {room.phase === 'immersing' && (
        <div className="room-immersive">
          <div className={`room-breathing-field ${room.assistantSpeaking ? 'is-speaking' : ''}`} aria-hidden="true" />
          {room.caption && <p className="room-caption room-caption--immersive">{room.caption}</p>}
          <div className="room-controls" aria-label="Room controls">
            {room.config?.voiceDensity !== 'quiet' && (
              <button type="button" onClick={() => room.setVoiceDensity(room.config?.voiceDensity === 'present' ? 'sparse' : 'quiet')}>{tr['room.controls.less']}</button>
            )}
            {room.config?.approach !== 'quiet_company' && room.config?.voiceDensity !== 'present' && (
              <button type="button" onClick={() => room.setVoiceDensity(room.config?.voiceDensity === 'quiet' ? 'sparse' : 'present')}>{tr['room.controls.more']}</button>
            )}
            {room.config?.voiceDensity !== 'quiet' && <button type="button" onClick={() => room.setVoiceDensity('quiet')}>{tr['room.controls.quiet']}</button>}
            <button type="button" onClick={room.changeSound}>{tr['room.controls.sound']}</button>
            <button type="button" onClick={() => finishAndClose(false)}>{tr['room.controls.leave']}</button>
          </div>
        </div>
      )}

      {room.phase === 'returning' && (
        <div className="room-return">
          <h2>{tr['room.return.title']}</h2>
          <p>{tr['room.return.body']}</p>
          <div className="room-return__actions">
            <button type="button" onClick={room.stay}>{tr['room.return.stay']}</button>
            <button type="button" onClick={() => finishAndClose()}>{tr['room.return.words']}</button>
            <button type="button" onClick={() => finishAndClose()}>{tr['room.return.done']}</button>
          </div>
        </div>
      )}
    </section>
  )
}

export default RoomField
