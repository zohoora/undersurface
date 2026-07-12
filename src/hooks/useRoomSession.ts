import { useCallback, useEffect, useRef, useState } from 'react'
import { buildRoomScore, detectRoomCommand, roomCueInstruction, roomVoiceDensityAfter } from '../engine/roomEngine'
import { acquireWakeLock, releaseWakeLock } from '../native/keepAwake'
import { db, generateId } from '../store/db'
import { updateSettings } from '../store/settings'
import type {
  MemoryAperture,
  RoomApproach,
  RoomAudioTrack,
  RoomCommand,
  RoomDuration,
  RoomPhase,
  RoomSession,
  RoomTranscriptEntry,
  RoomVoiceDensity,
} from '../types'
import { useVoiceSession } from './useVoiceSession'

const SEED_AUDIO_BASE = 'https://storage.googleapis.com/undersurfaceme.firebasestorage.app/seed-audio/v1'
const AUDIO_PATHS: Record<Exclude<RoomAudioTrack, 'none'>, string> = {
  ocean: `${SEED_AUDIO_BASE}/ocean.mp3`,
  forest: `${SEED_AUDIO_BASE}/forest.mp3`,
  drone: `${SEED_AUDIO_BASE}/drone.mp3`,
  binaural: `${SEED_AUDIO_BASE}/binaural.mp3`,
}
const AUDIO_ORDER: RoomAudioTrack[] = ['ocean', 'forest', 'drone', 'binaural', 'none']
const DUCKED_VOLUME = 0.12

export interface RoomConfig {
  approach: RoomApproach
  duration: RoomDuration
  voiceDensity: RoomVoiceDensity
  audioTrack: RoomAudioTrack
  audioVolume: number
}

interface UseRoomSessionOptions {
  parentSessionId: string | null
  memoryAperture: MemoryAperture
  onUserTranscript?: (text: string) => void
  onAssistantTranscript?: (text: string) => void
}

export function useRoomSession(options: UseRoomSessionOptions) {
  const [phase, setPhase] = useState<RoomPhase>('choosing')
  const [config, setConfig] = useState<RoomConfig | null>(null)
  const [elapsedMs, setElapsedMs] = useState(0)
  const [caption, setCaption] = useState('')
  const [extendedMs, setExtendedMs] = useState(0)
  const [audioState, setAudioState] = useState<'idle' | 'loading' | 'playing' | 'blocked'>('idle')
  const voice = useVoiceSession()

  const phaseRef = useRef<RoomPhase>('choosing')
  const configRef = useRef<RoomConfig | null>(null)
  const recordIdRef = useRef<string | null>(null)
  const persistReadyRef = useRef<Promise<void>>(Promise.resolve())
  const startedAtRef = useRef(0)
  const immersionStartedAtRef = useRef(0)
  const extendedMsRef = useRef(0)
  const transcriptRef = useRef<RoomTranscriptEntry[]>([])
  const commandsRef = useRef<RoomCommand[]>([])
  const deliveredCuesRef = useRef(new Set<string>())
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const endingRef = useRef(false)
  const instructionsRef = useRef('')
  const finishRef = useRef<(completed?: boolean) => void>(() => {})

  useEffect(() => { phaseRef.current = phase }, [phase])
  useEffect(() => { configRef.current = config }, [config])

  const persistProgress = useCallback(() => {
    const id = recordIdRef.current
    if (!id) return
    void persistReadyRef.current.then(() => db.roomSessions.update(id, {
      transcript: [...transcriptRef.current],
      commands: [...commandsRef.current],
      voiceDensity: configRef.current?.voiceDensity ?? 'quiet',
      audioTrack: configRef.current?.audioTrack ?? 'none',
      actualDurationMs: startedAtRef.current ? Date.now() - startedAtRef.current : 0,
    })).catch(() => { /* best effort during a live room */ })
  }, [])

  const appendTranscript = useCallback((role: RoomTranscriptEntry['role'], content: string) => {
    const trimmed = content.trim()
    if (!trimmed) return
    transcriptRef.current.push({
      role,
      content: trimmed,
      atMs: Math.max(0, Date.now() - startedAtRef.current),
    })
    setCaption(trimmed)
    persistProgress()
  }, [persistProgress])

  const stopAudio = useCallback(() => {
    const audio = audioRef.current
    if (!audio) return
    audio.pause()
    audio.src = ''
    audio.remove()
    audioRef.current = null
    setAudioState('idle')
  }, [])

  const startAudio = useCallback((track: RoomAudioTrack, volume: number) => {
    stopAudio()
    if (track === 'none') return
    const audio = new Audio(AUDIO_PATHS[track])
    audio.loop = true
    audio.preload = 'auto'
    audio.volume = Math.max(0, Math.min(1, volume))
    audio.setAttribute('playsinline', 'true')
    audio.style.display = 'none'
    document.body.appendChild(audio)
    audioRef.current = audio
    setAudioState('loading')
    const playback = audio.play()
    if (playback && typeof playback.then === 'function') {
      void playback
        .then(() => setAudioState('playing'))
        .catch(() => setAudioState('blocked'))
    } else {
      setAudioState('playing')
    }
  }, [stopAudio])

  const retryAudio = useCallback(() => {
    const audio = audioRef.current
    if (!audio) return
    const playback = audio.play()
    if (playback && typeof playback.then === 'function') {
      void playback
        .then(() => setAudioState('playing'))
        .catch(() => setAudioState('blocked'))
    }
  }, [])

  const changeSound = useCallback(() => {
    const current = configRef.current
    if (!current) return
    const index = AUDIO_ORDER.indexOf(current.audioTrack)
    const audioTrack = AUDIO_ORDER[(index + 1) % AUDIO_ORDER.length]
    const next = { ...current, audioTrack }
    setConfig(next)
    configRef.current = next
    startAudio(audioTrack, current.audioVolume)
    updateSettings({ lastRoomAudio: audioTrack })
    persistProgress()
  }, [persistProgress, startAudio])

  const setVoiceDensity = useCallback((next: RoomVoiceDensity) => {
    const current = configRef.current
    if (!current || current.voiceDensity === next) return
    const updated = { ...current, voiceDensity: next }
    setConfig(updated)
    configRef.current = updated
    updateSettings({ lastRoomVoiceDensity: next })
    if (next === 'quiet') {
      voice.cancelResponse()
      voice.setMicEnabled(false)
    } else {
      voice.setMicEnabled(true)
    }
    persistProgress()
  }, [persistProgress, voice])

  const applyCommand = useCallback((command: RoomCommand) => {
    commandsRef.current.push(command)
    if (command === 'change_sound') changeSound()
    else if (command === 'stay') {
      extendedMsRef.current += 60_000
      setExtendedMs(extendedMsRef.current)
      setPhase('immersing')
      phaseRef.current = 'immersing'
    } else if (command === 'end') finishRef.current(false)
    else {
      const current = configRef.current
      if (current) setVoiceDensity(roomVoiceDensityAfter(current.voiceDensity, command))
    }
    persistProgress()
  }, [changeSound, persistProgress, setVoiceDensity])

  const startVoice = useCallback(async (instructions: string) => {
    await voice.start({
      instructions,
      managePlayback: true,
      onUserTranscript: text => {
        appendTranscript('user', text)
        options.onUserTranscript?.(text)
        const command = detectRoomCommand(text)
        if (command) applyCommand(command)
      },
      onAssistantTranscript: text => {
        appendTranscript('companion', text)
        options.onAssistantTranscript?.(text)
      },
    })
  }, [appendTranscript, applyCommand, options, voice])

  const retryVoice = useCallback(async () => {
    const current = configRef.current
    if (!current || current.approach === 'quiet_company' || !instructionsRef.current) return
    await startVoice(instructionsRef.current)
  }, [startVoice])

  const start = useCallback(async (nextConfig: RoomConfig, instructions: string) => {
    if (phaseRef.current !== 'choosing') return
    const now = Date.now()
    startedAtRef.current = now
    transcriptRef.current = []
    commandsRef.current = []
    deliveredCuesRef.current.clear()
    extendedMsRef.current = 0
    setExtendedMs(0)
    setCaption('')
    instructionsRef.current = instructions
    setConfig(nextConfig)
    configRef.current = nextConfig
    const nextPhase: RoomPhase = nextConfig.approach === 'listen_first' ? 'threshold' : 'immersing'
    setPhase(nextPhase)
    phaseRef.current = nextPhase
    if (nextPhase === 'immersing') immersionStartedAtRef.current = now

    updateSettings({
      lastRoomApproach: nextConfig.approach,
      lastRoomDuration: nextConfig.duration,
      lastRoomVoiceDensity: nextConfig.voiceDensity,
      lastRoomAudio: nextConfig.audioTrack,
      lastRoomAudioVolume: nextConfig.audioVolume,
    })
    startAudio(nextConfig.audioTrack, nextConfig.audioVolume)
    void acquireWakeLock()

    const id = generateId()
    recordIdRef.current = id
    const record: RoomSession = {
      id,
      parentSessionId: options.parentSessionId,
      startedAt: now,
      endedAt: null,
      approach: nextConfig.approach,
      duration: nextConfig.duration,
      voiceDensity: nextConfig.voiceDensity,
      audioTrack: nextConfig.audioTrack,
      transcript: [],
      commands: [],
      completed: false,
      actualDurationMs: 0,
      memoryAperture: options.memoryAperture,
    }
    persistReadyRef.current = db.roomSessions.add(record).then(() => undefined).catch(() => undefined)

    if (nextConfig.approach !== 'quiet_company') {
      await startVoice(instructions)
    }
  }, [options, startAudio, startVoice])

  const enter = useCallback(() => {
    if (phaseRef.current !== 'threshold') return
    immersionStartedAtRef.current = Date.now()
    deliveredCuesRef.current.clear()
    setElapsedMs(0)
    setPhase('immersing')
    phaseRef.current = 'immersing'
  }, [])

  const finish = useCallback((completed = phaseRef.current === 'returning') => {
    if (endingRef.current || phaseRef.current === 'choosing') return
    endingRef.current = true
    const id = recordIdRef.current
    const actualDurationMs = startedAtRef.current ? Date.now() - startedAtRef.current : 0
    voice.stop()
    stopAudio()
    void releaseWakeLock()
    if (id) {
      void persistReadyRef.current.then(() => db.roomSessions.update(id, {
        endedAt: Date.now(),
        completed,
        actualDurationMs,
        transcript: [...transcriptRef.current],
        commands: [...commandsRef.current],
        voiceDensity: configRef.current?.voiceDensity ?? 'quiet',
        audioTrack: configRef.current?.audioTrack ?? 'none',
      })).catch(() => {})
    }
    recordIdRef.current = null
    setPhase('choosing')
    phaseRef.current = 'choosing'
    setConfig(null)
    configRef.current = null
    setElapsedMs(0)
    setCaption('')
    instructionsRef.current = ''
    endingRef.current = false
  }, [stopAudio, voice])
  finishRef.current = finish

  const stay = useCallback(() => applyCommand('stay'), [applyCommand])

  useEffect(() => {
    if (phase !== 'immersing' && phase !== 'returning') return
    const interval = window.setInterval(() => {
      const current = configRef.current
      if (!current || !immersionStartedAtRef.current) return
      const elapsed = Date.now() - immersionStartedAtRef.current
      const durationMs = current.duration * 60_000 + extendedMsRef.current
      setElapsedMs(elapsed)

      if (current.approach !== 'quiet_company' && voice.state === 'connected') {
        for (const cue of buildRoomScore(current.duration, current.voiceDensity)) {
          const key = `${cue.kind}:${cue.atMs}`
          if (elapsed >= cue.atMs && !deliveredCuesRef.current.has(key)) {
            deliveredCuesRef.current.add(key)
            voice.promptAssistant(roomCueInstruction(cue.kind, current.voiceDensity))
          }
        }
      }
      if (elapsed >= durationMs && phaseRef.current !== 'returning') {
        setPhase('returning')
        phaseRef.current = 'returning'
      }
    }, 250)
    return () => window.clearInterval(interval)
  }, [phase, voice])

  useEffect(() => {
    const audio = audioRef.current
    const current = configRef.current
    if (!audio || !current) return
    audio.volume = voice.assistantSpeaking
      ? Math.min(current.audioVolume, DUCKED_VOLUME)
      : current.audioVolume
  }, [voice.assistantSpeaking])

  const stopVoice = voice.stop
  useEffect(() => () => {
    stopVoice()
    stopAudio()
    void releaseWakeLock()
  }, [stopAudio, stopVoice])

  return {
    phase,
    config,
    elapsedMs,
    extendedMs,
    caption,
    audioState,
    voiceState: voice.state,
    voiceError: voice.error,
    assistantSpeaking: voice.assistantSpeaking,
    userSpeaking: voice.userSpeaking,
    muted: voice.muted,
    start,
    enter,
    finish,
    stay,
    changeSound,
    retryAudio,
    retryVoice,
    setVoiceDensity,
    toggleMute: voice.toggleMute,
  }
}
