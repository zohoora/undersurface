// Step inside's sound (build plan §4, H1; `folioStepInsideSound`, web only).
// Room's forest and drone tracks only, never ocean: no water near anything
// that may touch distress. The writer chooses it; nothing plays by default.
// Standing distance maps to Web Audio: closer is quieter and darker (a gain
// and a low-pass filter). Where Web Audio or the bucket's CORS isn't
// available (a local build, an old browser), volume alone follows distance.

export type SoundChoice = 'silence' | 'forest' | 'drone'
export const SOUND_CHOICES: SoundChoice[] = ['silence', 'forest', 'drone']

const SEED_AUDIO_BASE = 'https://storage.googleapis.com/undersurfaceme.firebasestorage.app/seed-audio/v1'
export const SOUND_URLS: Record<Exclude<SoundChoice, 'silence'>, string> = {
  forest: `${SEED_AUDIO_BASE}/forest.mp3`,
  drone: `${SEED_AUDIO_BASE}/drone.mp3`,
}

/** Standing distance, back (0) to closest (2): text scale, and the sound's gain and cutoff. */
export const STANDS = [
  { scale: 1, gain: 0.5, cutoff: 9000 },
  { scale: 1.14, gain: 0.34, cutoff: 3200 },
  { scale: 1.3, gain: 0.22, cutoff: 1100 },
] as const
export type Stand = 0 | 1 | 2

const storageKey = (uid: string) => `us.folioSound.${uid}`

/** The last choice on this device (cleared on sign-out with Folio's other keys). */
export function readSoundChoice(uid: string): SoundChoice {
  try {
    const v = localStorage.getItem(storageKey(uid))
    return v === 'forest' || v === 'drone' ? v : 'silence'
  } catch {
    return 'silence'
  }
}

export function writeSoundChoice(uid: string, choice: SoundChoice): void {
  try { localStorage.setItem(storageKey(uid), choice) } catch { /* a convenience */ }
}

interface Graph { ctx: AudioContext; gain: GainNode; filter: BiquadFilterNode }

export interface InsideSoundDeps {
  createAudio?: () => HTMLAudioElement
  createContext?: () => AudioContext | null
}

export class InsideSound {
  private audio: HTMLAudioElement | null = null
  private graph: Graph | null = null
  private stand: Stand = 1
  private stopped = false
  private readonly createAudio: () => HTMLAudioElement
  private readonly createContext: () => AudioContext | null

  constructor(deps: InsideSoundDeps = {}) {
    this.createAudio = deps.createAudio ?? (() => new Audio())
    this.createContext = deps.createContext ?? (() => {
      const Ctx = (globalThis as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
        ?? (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      try { return Ctx ? new Ctx() : null } catch { return null }
    })
  }

  get playing(): SoundChoice {
    return this.current
  }
  private current: SoundChoice = 'silence'

  /** Start a track (or silence) at a standing distance. Called from the writer's own action. */
  play(choice: SoundChoice, stand: Stand): void {
    this.teardown()
    this.stopped = false
    this.current = choice
    this.stand = stand
    if (choice === 'silence') return
    const url = SOUND_URLS[choice]
    const ctx = this.createContext()
    if (ctx) {
      const audio = this.newAudio(url, true)
      try {
        const source = ctx.createMediaElementSource(audio)
        const filter = ctx.createBiquadFilter()
        filter.type = 'lowpass'
        const gain = ctx.createGain()
        source.connect(filter)
        filter.connect(gain)
        gain.connect(ctx.destination)
        this.graph = { ctx, gain, filter }
        this.audio = audio
        this.applyStand(true)
        // A bucket without CORS for this origin fails the request: fall back.
        audio.addEventListener('error', () => { if (!this.stopped && this.audio === audio) this.fallback(url) }, { once: true })
        void ctx.resume?.().catch(() => {})
        void audio.play().catch(() => {})
        return
      } catch {
        try { void ctx.close() } catch { /* nothing to do */ }
        this.graph = null
      }
    }
    this.fallback(url)
  }

  setStand(stand: Stand): void {
    this.stand = stand
    this.applyStand(false)
  }

  /** The tab is hidden: stop sounding at once. */
  pause(): void {
    this.audio?.pause()
  }

  resume(): void {
    if (this.stopped || !this.audio) return
    void this.graph?.ctx.resume?.().catch(() => {})
    void this.audio.play().catch(() => {})
  }

  /** Leaving, or shore: stop at once and release everything. */
  stop(): void {
    this.stopped = true
    this.teardown()
    this.current = 'silence'
  }

  private fallback(url: string): void {
    this.teardown()
    const audio = this.newAudio(url, false)
    this.audio = audio
    this.applyStand(true)
    void audio.play().catch(() => {})
  }

  private newAudio(url: string, cors: boolean): HTMLAudioElement {
    const audio = this.createAudio()
    audio.loop = true
    audio.preload = 'auto'
    if (cors) audio.crossOrigin = 'anonymous'
    audio.src = url
    return audio
  }

  private applyStand(immediate: boolean): void {
    const s = STANDS[this.stand]
    if (this.graph) {
      const { ctx, gain, filter } = this.graph
      if (immediate) {
        gain.gain.value = s.gain
        filter.frequency.value = s.cutoff
      } else {
        gain.gain.setTargetAtTime(s.gain, ctx.currentTime, 0.25)
        filter.frequency.setTargetAtTime(s.cutoff, ctx.currentTime, 0.25)
      }
      if (this.audio) this.audio.volume = 1
    } else if (this.audio) {
      this.audio.volume = s.gain
    }
  }

  private teardown(): void {
    if (this.audio) {
      this.audio.pause()
      this.audio.removeAttribute('src')
      try { this.audio.load() } catch { /* jsdom */ }
    }
    this.audio = null
    if (this.graph) {
      try { void this.graph.ctx.close() } catch { /* nothing to do */ }
    }
    this.graph = null
  }
}
