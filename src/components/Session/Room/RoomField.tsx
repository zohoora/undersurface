import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from '../../../i18n'
import { useRoomSession, type RoomConfig } from '../../../hooks/useRoomSession'
import { useModalA11y } from '../../../hooks/useModalA11y'
import { useSettings } from '../../../store/settings'
import type { MemoryAperture, RoomApproach, RoomAudioTrack, RoomDuration, RoomVoiceDensity } from '../../../types'

interface Props {
  parentSessionId: string | null
  memoryAperture: MemoryAperture
  buildInstructions: (config: RoomConfig) => string
  rememberedConfig?: Partial<Pick<RoomConfig, 'approach' | 'duration' | 'voiceDensity' | 'audioTrack'>>
  voiceAvailable: boolean
  /** `ownerSessionId` is the session this Room started in (see useRoomSession). */
  onUserTranscript: (text: string, ownerSessionId: string | null) => void
  onAssistantTranscript: (text: string, ownerSessionId: string | null) => void
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
  const room = useRoomSession({
    parentSessionId,
    memoryAperture,
    onUserTranscript,
    onAssistantTranscript,
    // A spoken "end" returns to Talk, not to Room's choose screen.
    onEndRequested: onClose,
  })

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

  const begin = () => {
    if (starting) return
    setStarting(true)
    try {
      const instructions = buildInstructions(config)
      void room.start(config, instructions).finally(() => setStarting(false))
    } catch {
      setStarting(false)
    }
  }

  const finishAndClose = (completed = true) => {
    room.finish(completed)
    onClose()
  }

  // Room is a modal surface: focus moves in on open, Tab stays inside, Escape
  // leaves (the same safe exit as Leave), and focus returns to whatever opened
  // it. The handler identity is stable so the a11y effect runs once per mount.
  const panelRef = useRef<HTMLElement | null>(null)

  // Everything behind Room — the session list, sidebar, Talk composer — is
  // inert while it is open, so no background session can be selected. Room
  // itself is portaled outside #root. Declared before useModalA11y so this
  // cleanup runs first and focus can return to the launcher.
  useEffect(() => {
    const root = document.getElementById('root')
    if (!root || (panelRef.current && root.contains(panelRef.current))) return
    const alreadyInert = root.hasAttribute('inert')
    root.setAttribute('inert', '')
    root.setAttribute('aria-hidden', 'true')
    return () => {
      if (!alreadyInert) root.removeAttribute('inert')
      root.removeAttribute('aria-hidden')
    }
  }, [])
  const leaveRef = useRef<() => void>(() => {})
  useEffect(() => {
    leaveRef.current = () => {
      if (room.phase === 'choosing') onClose()
      else {
        room.finish(false)
        onClose()
      }
    }
  })
  const leave = useCallback(() => leaveRef.current(), [])
  useModalA11y(panelRef, leave)

  // Each phase (choosing → threshold → immersion → return) replaces the
  // controls. If the focused control just disappeared, keep focus inside Room.
  useEffect(() => {
    const panel = panelRef.current
    if (!panel) return
    const active = document.activeElement
    if (!active || active === document.body || !panel.contains(active)) panel.focus()
  }, [room.phase])

  // With focus on the panel itself (after a phase change), Tab / Shift+Tab
  // enter the controls from the matching end instead of leaving Room.
  const onPanelKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const panel = panelRef.current
    if (event.key !== 'Tab' || !panel || document.activeElement !== panel) return
    const items = Array.from(panel.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ))
    if (items.length === 0) return
    event.preventDefault()
    ;(event.shiftKey ? items[items.length - 1] : items[0]).focus()
  }

  return createPortal(
    <section
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      tabIndex={-1}
      onKeyDown={onPanelKeyDown}
      className={`room-field room-field--${room.phase} room-field--${room.config?.audioTrack ?? audioTrack}`}
      aria-label={tr['room.aria']}
    >
      <button
        type="button"
        className="room-close"
        aria-label={tr['room.controls.leave']}
        onClick={leave}
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

          <button type="button" className="room-primary" onClick={begin} disabled={starting}>
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
              <span>{room.voiceError}</span>
              <button type="button" onClick={() => void room.retryVoice()}>{tr['room.voice.retry']}</button>
              <button type="button" onClick={room.continueQuietly}>{tr['room.voice.continueQuietly']}</button>
            </div>
          )}
          {room.audioState === 'blocked' && (
            <button type="button" className="room-audio-retry" onClick={room.retryAudio}>{tr['room.audio.retry']}</button>
          )}
          {room.audioState === 'loading' && <p className="room-media-loading">{tr['room.audio.loading']}</p>}
          <button type="button" className="room-primary" onClick={room.enter}>{tr['room.threshold.enter']}</button>
        </div>
      )}

      {room.phase === 'immersing' && (
        <div className="room-immersive">
          <div className={`room-breathing-field ${room.assistantSpeaking ? 'is-speaking' : ''}`} aria-hidden="true" />
          {room.caption && <p className="room-caption room-caption--immersive">{room.caption}</p>}
          {(room.voiceError || room.voiceState === 'connecting' || room.audioState === 'loading' || room.audioState === 'blocked') && (
            <div className="room-media-status">
              {!room.voiceError && room.voiceState === 'connecting' && <span>{tr['room.voice.connecting']}</span>}
              {room.audioState === 'loading' && <span>{tr['room.audio.loading']}</span>}
              {room.voiceError && (
                <>
                  <span>{room.voiceError}</span>
                  <button type="button" onClick={() => void room.retryVoice()}>{tr['room.voice.retry']}</button>
                  <button type="button" onClick={room.continueQuietly}>{tr['room.voice.continueQuietly']}</button>
                </>
              )}
              {room.audioState === 'blocked' && <button type="button" onClick={room.retryAudio}>{tr['room.audio.retry']}</button>}
            </div>
          )}
          <div className="room-controls" role="group" aria-label={tr['room.controls.aria']}>
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
    </section>,
    document.body,
  )
}

export default RoomField
