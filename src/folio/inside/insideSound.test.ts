import { describe, expect, it, vi } from 'vitest'
import { InsideSound, SOUND_URLS, STANDS, readSoundChoice, writeSoundChoice } from './insideSound'

// H1's sound: forest and drone only, never ocean; nothing by default; closer is
// quieter and darker; a CORS failure falls back to volume only; stops at once.

class FakeAudio {
  loop = false; preload = ''; crossOrigin: string | null = null; src = ''; volume = 1; paused = true
  private listeners = new Map<string, () => void>()
  play = vi.fn(async () => { this.paused = false })
  pause = vi.fn(() => { this.paused = true })
  load = vi.fn()
  removeAttribute = vi.fn((name: string) => { if (name === 'src') this.src = '' })
  addEventListener(type: string, fn: () => void) { this.listeners.set(type, fn) }
  fire(type: string) { this.listeners.get(type)?.() }
}

function fakeContext() {
  const param = (value: number) => ({ value, setTargetAtTime: vi.fn(function (this: { value: number }, v: number) { this.value = v }) })
  const gain = { gain: param(1), connect: vi.fn() }
  const filter = { type: '', frequency: param(20000), connect: vi.fn() }
  const ctx = {
    currentTime: 0, destination: {},
    createMediaElementSource: vi.fn(() => ({ connect: vi.fn() })),
    createBiquadFilter: vi.fn(() => filter),
    createGain: vi.fn(() => gain),
    resume: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
  }
  return { ctx, gain, filter }
}

describe('InsideSound', () => {
  it('only forest and drone, from Room\'s tracks; never ocean', () => {
    expect(Object.keys(SOUND_URLS).sort()).toEqual(['drone', 'forest'])
    expect(JSON.stringify(SOUND_URLS)).not.toMatch(/ocean/)
  })

  it('silence plays nothing', () => {
    const audios: FakeAudio[] = []
    const s = new InsideSound({ createAudio: () => { const a = new FakeAudio(); audios.push(a); return a as never }, createContext: () => fakeContext().ctx as never })
    s.play('silence', 1)
    expect(audios).toEqual([])
  })

  it('Web Audio: a gain and a low-pass; closer is quieter and darker', () => {
    const audios: FakeAudio[] = []
    const f = fakeContext()
    const s = new InsideSound({ createAudio: () => { const a = new FakeAudio(); audios.push(a); return a as never }, createContext: () => f.ctx as never })
    s.play('forest', 1)
    expect(audios[0].src).toBe(SOUND_URLS.forest)
    expect(audios[0].crossOrigin).toBe('anonymous')
    expect(audios[0].loop).toBe(true)
    expect(f.filter.type).toBe('lowpass')
    expect(f.gain.gain.value).toBe(STANDS[1].gain)
    s.setStand(2)
    expect(f.gain.gain.value).toBe(STANDS[2].gain)
    expect(f.filter.frequency.value).toBe(STANDS[2].cutoff)
    expect(STANDS[2].gain).toBeLessThan(STANDS[0].gain)
    expect(STANDS[2].cutoff).toBeLessThan(STANDS[0].cutoff)
  })

  it('a CORS failure falls back to volume only', () => {
    const audios: FakeAudio[] = []
    const f = fakeContext()
    const s = new InsideSound({ createAudio: () => { const a = new FakeAudio(); audios.push(a); return a as never }, createContext: () => f.ctx as never })
    s.play('drone', 0)
    audios[0].fire('error')
    expect(audios).toHaveLength(2)
    expect(audios[1].crossOrigin).toBeNull()
    expect(audios[1].src).toBe(SOUND_URLS.drone)
    expect(audios[1].volume).toBe(STANDS[0].gain)
    s.setStand(2)
    expect(audios[1].volume).toBe(STANDS[2].gain)
    expect(f.ctx.close).toHaveBeenCalled()
  })

  it('without Web Audio, volume follows distance', () => {
    const audios: FakeAudio[] = []
    const s = new InsideSound({ createAudio: () => { const a = new FakeAudio(); audios.push(a); return a as never }, createContext: () => null })
    s.play('forest', 2)
    expect(audios[0].crossOrigin).toBeNull()
    expect(audios[0].volume).toBe(STANDS[2].gain)
  })

  it('pauses while hidden, and stops at once, releasing the track', () => {
    const audios: FakeAudio[] = []
    const f = fakeContext()
    const s = new InsideSound({ createAudio: () => { const a = new FakeAudio(); audios.push(a); return a as never }, createContext: () => f.ctx as never })
    s.play('forest', 1)
    s.pause()
    expect(audios[0].pause).toHaveBeenCalled()
    s.resume()
    expect(audios[0].play).toHaveBeenCalledTimes(2)
    s.stop()
    expect(audios[0].src).toBe('')
    expect(f.ctx.close).toHaveBeenCalled()
    s.resume()
    expect(audios[0].play).toHaveBeenCalledTimes(2)
  })

  it('remembers the choice per device and account; defaults to silence', () => {
    const mem = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v) }, removeItem: (k: string) => { mem.delete(k) } })
    expect(readSoundChoice('u1')).toBe('silence')
    writeSoundChoice('u1', 'drone')
    expect(readSoundChoice('u1')).toBe('drone')
    expect(readSoundChoice('u2')).toBe('silence')
    localStorage.setItem('us.folioSound.u3', 'ocean')
    expect(readSoundChoice('u3')).toBe('silence')
    vi.unstubAllGlobals()
  })
})
