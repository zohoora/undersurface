import { useCallback, useEffect, useRef, useState } from 'react'
import {
  buildRoomScore,
  detectRoomCommand,
  ROOM_CUE_GRACE_MS,
  roomCueInstruction,
  roomCuesInWindow,
  roomVoiceDensityAfter,
  type RoomCue,
} from '../engine/roomEngine'
import { acquireWakeLock, reacquireWakeLockIfVisible, releaseWakeLock } from '../native/keepAwake'
import { getAuth } from 'firebase/auth'
import { db, generateId } from '../store/db'
import { updateSettings } from '../store/settings'
import { isGroundingActive } from '../store/groundingState'
import { detectCrisisKeywords } from '../../functions/src/shared/crisisFloor'
import { getLanguageCode } from '../i18n'
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
const TICK_MS = 250

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
  /**
   * Transcript forwarding into the parent session. `ownerSessionId` is the
   * session this Room belongs to; the host must drop the text if that is no
   * longer the session it would append into.
   */
  onUserTranscript?: (text: string, ownerSessionId: string | null) => void
  onAssistantTranscript?: (text: string, ownerSessionId: string | null) => void
  /** Room ended itself (spoken "end", or its parent session changed). */
  onEndRequested?: () => void
}

type RoomSnapshot = Pick<RoomSession, 'transcript' | 'commands' | 'voiceDensity' | 'audioTrack' | 'actualDurationMs'>

/**
 * One running Room. Everything that outlives a render — persistence, late
 * Realtime callbacks — is bound to this object, never to "whatever session or
 * Room is current now" (TECH_ISSUES T2/T3).
 */
interface RoomLifetime {
  roomId: string
  parentSessionId: string | null
  uid: string | null
  startedAt: number
  record: RoomSession
  /** Resolves true once the initial record exists, false if the create failed. */
  created: Promise<boolean>
  /** Per-Room write queue: progress and final writes land in call order. */
  chain: Promise<void>
  /** No further writes accepted after the final snapshot was queued. */
  finalized: boolean
  /** Media ended; late Realtime callbacks for this lifetime are dropped. */
  ended: boolean
}

function currentUid(): string | null {
  try {
    return getAuth().currentUser?.uid ?? null
  } catch {
    return null
  }
}

export function useRoomSession(options: UseRoomSessionOptions) {
  const [phase, setPhase] = useState<RoomPhase>('choosing')
  const [config, setConfig] = useState<RoomConfig | null>(null)
  const [elapsedMs, setElapsedMs] = useState(0)
  const [caption, setCaption] = useState('')
  const [extendedMs, setExtendedMs] = useState(0)
  const [audioState, setAudioState] = useState<'idle' | 'loading' | 'playing' | 'blocked'>('idle')
  const voice = useVoiceSession()

  // Latest-value refs: the clock, the transcript callbacks and the unmount
  // cleanup read these instead of closing over per-render objects, so the
  // 250 ms interval is not torn down and rebuilt on every render.
  const voiceRef = useRef(voice)
  const optionsRef = useRef(options)
  useEffect(() => {
    voiceRef.current = voice
    optionsRef.current = options
  })

  const phaseRef = useRef<RoomPhase>('choosing')
  const configRef = useRef<RoomConfig | null>(null)
  const lifetimeRef = useRef<RoomLifetime | null>(null)
  const startedAtRef = useRef(0)
  const immersionStartedAtRef = useRef(0)
  const extendedMsRef = useRef(0)
  const transcriptRef = useRef<RoomTranscriptEntry[]>([])
  const commandsRef = useRef<RoomCommand[]>([])
  // Cue clock: the end of the last evaluated tick window, and at most one cue
  // waiting for a quiet moment (see ROOM_CUE_GRACE_MS).
  const lastCueTickRef = useRef(-1)
  const pendingCueRef = useRef<RoomCue | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const endingRef = useRef(false)
  const instructionsRef = useRef('')
  const wakeLockHeldRef = useRef(false)
  const finishRef = useRef<(completed?: boolean) => void>(() => {})
  const startVoiceRef = useRef<(instructions: string) => Promise<void>>(async () => {})

  useEffect(() => { phaseRef.current = phase }, [phase])
  useEffect(() => { configRef.current = config }, [config])

  const holdWakeLock = useCallback(() => {
    if (wakeLockHeldRef.current) return
    wakeLockHeldRef.current = true
    void acquireWakeLock()
  }, [])

  // Exactly one release per acquire, whichever of finish/unmount comes first.
  const releaseHeldWakeLock = useCallback(() => {
    if (!wakeLockHeldRef.current) return
    wakeLockHeldRef.current = false
    void releaseWakeLock()
  }, [])

  // The platform drops a screen wake lock whenever the page is hidden; take it
  // back when the writer returns to a live Room.
  useEffect(() => {
    const onVisibility = () => {
      if (wakeLockHeldRef.current && document.visibilityState === 'visible') {
        void reacquireWakeLockIfVisible()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  // Snapshot everything a write needs NOW, synchronously, before any live
  // state is cleared or a promise is awaited.
  const snapshot = useCallback((lifetime: RoomLifetime): RoomSnapshot => ({
    transcript: [...transcriptRef.current],
    commands: [...commandsRef.current],
    voiceDensity: configRef.current?.voiceDensity ?? lifetime.record.voiceDensity,
    audioTrack: configRef.current?.audioTrack ?? lifetime.record.audioTrack,
    actualDurationMs: Math.max(0, Date.now() - lifetime.startedAt),
  }), [])

  const enqueueWrite = useCallback((lifetime: RoomLifetime, write: (created: boolean) => Promise<void>) => {
    lifetime.chain = lifetime.chain
      .then(async () => {
        // Never write into a different account after logout / user switch.
        if (currentUid() !== lifetime.uid) return
        await write(await lifetime.created)
      })
      .catch(error => {
        console.warn('[room] record write failed', lifetime.roomId, error)
      })
  }, [])

  const persistProgress = useCallback(() => {
    const lifetime = lifetimeRef.current
    if (!lifetime || lifetime.finalized) return
    const payload = snapshot(lifetime)
    enqueueWrite(lifetime, async created => {
      if (created) await db.roomSessions.update(lifetime.roomId, payload)
    })
  }, [enqueueWrite, snapshot])

  // Final write for a room that is ending (explicitly, by unmount, or because
  // its parent session changed). Idempotent: exactly one final write.
  const persistEnd = useCallback((completed: boolean) => {
    const lifetime = lifetimeRef.current
    if (!lifetime || lifetime.finalized) return
    lifetime.finalized = true
    lifetime.ended = true
    lifetimeRef.current = null
    const payload = {
      ...snapshot(lifetime),
      parentSessionId: lifetime.parentSessionId,
      endedAt: Date.now(),
      completed,
    }
    enqueueWrite(lifetime, async created => {
      if (created) await db.roomSessions.update(lifetime.roomId, payload)
      // The initial create failed: the final snapshot carries everything, so
      // write the whole record rather than losing the Room.
      else await db.roomSessions.add({ ...lifetime.record, ...payload })
    })
  }, [enqueueWrite, snapshot])

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
    const liveVoice = voiceRef.current
    if (next === 'quiet') {
      pendingCueRef.current = null
      liveVoice.cancelResponse()
      liveVoice.setMicEnabled(false)
    } else if (
      (liveVoice.state === 'idle' || liveVoice.state === 'error')
      && current.approach !== 'quiet_company'
      && instructionsRef.current
    ) {
      // Voice was set aside ("continue quietly" or a dropped connection):
      // asking for more voice brings the companion back.
      void startVoiceRef.current(instructionsRef.current)
    } else {
      liveVoice.setMicEnabled(true)
    }
    persistProgress()
  }, [persistProgress])

  // Restart the clock at the moment immersion begins: the first cue window
  // opens just before 0 so the arrival cue is due at once, never later.
  const beginImmersionClock = useCallback((at: number) => {
    immersionStartedAtRef.current = at
    lastCueTickRef.current = -1
    pendingCueRef.current = null
  }, [])

  const enter = useCallback(() => {
    if (phaseRef.current !== 'threshold') return
    beginImmersionClock(Date.now())
    setElapsedMs(0)
    setPhase('immersing')
    phaseRef.current = 'immersing'
  }, [beginImmersionClock])

  const applyCommand = useCallback((command: RoomCommand) => {
    commandsRef.current.push(command)
    if (command === 'change_sound') changeSound()
    else if (command === 'stay') {
      // From the Listen-first threshold, "stay" means "let it begin": the
      // immersion clock must start here or it never runs (first Room) or
      // replays every cue from a stale timestamp (later Rooms).
      if (phaseRef.current === 'threshold') enter()
      extendedMsRef.current += 60_000
      setExtendedMs(extendedMsRef.current)
      setPhase('immersing')
      phaseRef.current = 'immersing'
    } else if (command === 'end') {
      finishRef.current(false)
      optionsRef.current.onEndRequested?.()
    } else {
      const current = configRef.current
      if (current) setVoiceDensity(roomVoiceDensityAfter(current.voiceDensity, command))
    }
    persistProgress()
  }, [changeSound, enter, persistProgress, setVoiceDensity])

  const handleUserTranscript = useCallback((lifetime: RoomLifetime | null, text: string) => {
    // Late callbacks from a Room that has already ended (or been replaced)
    // must never write anywhere.
    if (!lifetime || lifetime.ended || lifetimeRef.current !== lifetime) return
    appendTranscript('user', text)
    // Persisting into the parent session runs the full L1/L2 crisis stack.
    optionsRef.current.onUserTranscript?.(text, lifetime.parentSessionId)
    // Never act on a control phrase in a turn that trips the hard floor or
    // arrives under grounding: the crisis path owns what happens next.
    if (isGroundingActive() || detectCrisisKeywords(text)) return
    const command = detectRoomCommand(text, getLanguageCode())
    if (command) applyCommand(command)
  }, [appendTranscript, applyCommand])

  const startVoice = useCallback(async (instructions: string) => {
    const lifetime = lifetimeRef.current
    if (!lifetime || lifetime.ended) return
    await voiceRef.current.start({
      instructions,
      managePlayback: true,
      onUserTranscript: text => handleUserTranscript(lifetime, text),
      onAssistantTranscript: text => {
        if (lifetime.ended || lifetimeRef.current !== lifetime) return
        appendTranscript('companion', text)
        optionsRef.current.onAssistantTranscript?.(text, lifetime.parentSessionId)
      },
    })
  }, [appendTranscript, handleUserTranscript])
  useEffect(() => { startVoiceRef.current = startVoice }, [startVoice])

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
    extendedMsRef.current = 0
    setExtendedMs(0)
    setCaption('')
    instructionsRef.current = instructions
    setConfig(nextConfig)
    configRef.current = nextConfig
    const nextPhase: RoomPhase = nextConfig.approach === 'listen_first' ? 'threshold' : 'immersing'
    setPhase(nextPhase)
    phaseRef.current = nextPhase
    immersionStartedAtRef.current = 0
    pendingCueRef.current = null
    if (nextPhase === 'immersing') beginImmersionClock(now)

    updateSettings({
      lastRoomApproach: nextConfig.approach,
      lastRoomDuration: nextConfig.duration,
      lastRoomVoiceDensity: nextConfig.voiceDensity,
      lastRoomAudio: nextConfig.audioTrack,
      lastRoomAudioVolume: nextConfig.audioVolume,
    })
    startAudio(nextConfig.audioTrack, nextConfig.audioVolume)
    holdWakeLock()

    const id = generateId()
    const record: RoomSession = {
      id,
      parentSessionId: optionsRef.current.parentSessionId,
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
      memoryAperture: optionsRef.current.memoryAperture,
    }
    lifetimeRef.current = {
      roomId: id,
      parentSessionId: record.parentSessionId,
      uid: currentUid(),
      startedAt: now,
      record,
      created: db.roomSessions.add(record).then(() => true, error => {
        // Distinguish a failed create from success: the final write then
        // stores the whole record instead of updating a missing document.
        console.warn('[room] record create failed; will write the full record at the end', id, error)
        return false
      }),
      chain: Promise.resolve(),
      finalized: false,
      ended: false,
    }

    if (nextConfig.approach !== 'quiet_company') {
      await startVoice(instructions)
    }
  }, [beginImmersionClock, holdWakeLock, startAudio, startVoice])

  const finish = useCallback((completed = phaseRef.current === 'returning') => {
    if (endingRef.current || phaseRef.current === 'choosing') return
    endingRef.current = true
    voiceRef.current.stop()
    stopAudio()
    releaseHeldWakeLock()
    persistEnd(completed)
    setPhase('choosing')
    phaseRef.current = 'choosing'
    setConfig(null)
    configRef.current = null
    setElapsedMs(0)
    setCaption('')
    instructionsRef.current = ''
    immersionStartedAtRef.current = 0
    lastCueTickRef.current = -1
    pendingCueRef.current = null
    endingRef.current = false
  }, [persistEnd, releaseHeldWakeLock, stopAudio])
  useEffect(() => { finishRef.current = finish }, [finish])

  const stay = useCallback(() => applyCommand('stay'), [applyCommand])

  // Leave voice behind without leaving Room: tear the Realtime session down
  // (which also clears its error and releases the mic) and go quiet.
  const continueQuietly = useCallback(() => {
    voiceRef.current.stop()
    pendingCueRef.current = null
    setVoiceDensity('quiet')
  }, [setVoiceDensity])

  useEffect(() => {
    if (phase !== 'immersing' && phase !== 'returning') return
    const interval = window.setInterval(() => {
      const current = configRef.current
      if (!current || !immersionStartedAtRef.current) return
      const elapsed = Date.now() - immersionStartedAtRef.current
      const durationMs = current.duration * 60_000 + extendedMsRef.current
      setElapsedMs(elapsed)

      const windowStart = lastCueTickRef.current
      lastCueTickRef.current = elapsed
      if (current.approach !== 'quiet_company' && current.voiceDensity !== 'quiet') {
        const due = roomCuesInWindow(buildRoomScore(current.duration, current.voiceDensity, extendedMsRef.current), windowStart, elapsed)
        if (due.length > 0) pendingCueRef.current = due[due.length - 1]
        const pending = pendingCueRef.current
        if (pending) {
          const liveVoice = voiceRef.current
          if (elapsed - pending.atMs > ROOM_CUE_GRACE_MS) {
            // Too late to be the cue it was meant to be.
            pendingCueRef.current = null
          } else if (
            liveVoice.state === 'connected'
            && liveVoice.promptAssistant(roomCueInstruction(pending.kind, current.voiceDensity))
          ) {
            pendingCueRef.current = null
          }
        }
      } else {
        pendingCueRef.current = null
      }
      if (elapsed >= durationMs && phaseRef.current !== 'returning') {
        setPhase('returning')
        phaseRef.current = 'returning'
      }
    }, TICK_MS)
    return () => window.clearInterval(interval)
  }, [phase])

  useEffect(() => {
    const audio = audioRef.current
    const current = configRef.current
    if (!audio || !current) return
    audio.volume = voice.assistantSpeaking
      ? Math.min(current.audioVolume, DUCKED_VOLUME)
      : current.audioVolume
  }, [voice.assistantSpeaking])

  // A running Room belongs to the session it started in. If the parent
  // session changes underneath it (history navigation, another session picked
  // from the sidebar), end it as interrupted rather than letting it continue
  // into the next session. `/session/new` adopting its real id is not a
  // change of owner.
  useEffect(() => {
    const lifetime = lifetimeRef.current
    const next = options.parentSessionId
    if (!lifetime || lifetime.ended || next === lifetime.parentSessionId) return
    if (lifetime.parentSessionId === null) {
      lifetime.parentSessionId = next
      return
    }
    finishRef.current(false)
    optionsRef.current.onEndRequested?.()
  }, [options.parentSessionId])

  // Unmount (closing the overlay, grounding, navigating away) is a
  // persist-only finish: the record gets its endedAt, voice and sound stop,
  // and the wake lock is released exactly once.
  useEffect(() => () => {
    persistEnd(phaseRef.current === 'returning')
    voiceRef.current.stop()
    stopAudio()
    releaseHeldWakeLock()
  }, [persistEnd, releaseHeldWakeLock, stopAudio])

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
    continueQuietly,
    setVoiceDensity,
    toggleMute: voice.toggleMute,
  }
}
