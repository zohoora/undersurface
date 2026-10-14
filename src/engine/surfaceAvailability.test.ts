import { describe, expect, it } from 'vitest'
import { canOpenSurface, isRoomEnabled, isVoiceEnabled } from './surfaceAvailability'
import type { GlobalConfig } from '../admin/adminTypes'

const features = (over: Partial<GlobalConfig['features']>) => over as GlobalConfig['features']

describe('isRoomEnabled', () => {
  it('honours an explicit roomEnabled flag over the legacy flags', () => {
    expect(isRoomEnabled(features({ roomEnabled: true }))).toBe(true)
    expect(isRoomEnabled(features({ roomEnabled: false, relaxEnabled: true, driftEnabled: true }))).toBe(false)
  })

  it('falls back to relaxEnabled || driftEnabled only when roomEnabled is unset', () => {
    expect(isRoomEnabled(features({ relaxEnabled: true }))).toBe(true)
    expect(isRoomEnabled(features({ driftEnabled: true }))).toBe(true)
    expect(isRoomEnabled(features({}))).toBe(false)
    expect(isRoomEnabled(null)).toBe(false)
    expect(isRoomEnabled(undefined)).toBe(false)
  })
})

describe('canOpenSurface (TECH_ISSUES #12)', () => {
  const none = { voiceEnabled: false, roomEnabled: false, grounding: false }

  it('never opens Speak (direct or arc) while voice is disabled', () => {
    expect(canOpenSurface('speak', none)).toBe(false)
    expect(canOpenSurface('speak-arc', none)).toBe(false)
    expect(canOpenSurface('speak', { ...none, voiceEnabled: true })).toBe(true)
  })

  it('never opens Room (or its legacy relax/drift targets) when unavailable or grounded', () => {
    for (const target of ['room', 'room-arc', 'relax', 'relax-arc', 'drift-arc']) {
      expect(canOpenSurface(target, none)).toBe(false)
      expect(canOpenSurface(target, { ...none, roomEnabled: true, grounding: true })).toBe(false)
      expect(canOpenSurface(target, { ...none, roomEnabled: true })).toBe(true)
    }
  })

  it('leaves Talk, Journal and non-surface targets alone', () => {
    expect(canOpenSurface('talk', none)).toBe(true)
    expect(canOpenSurface('journal', none)).toBe(true)
    expect(canOpenSurface('journal-arc', none)).toBe(true)
    expect(canOpenSurface('real-talk-on', none)).toBe(true)
  })
})

describe('isVoiceEnabled', () => {
  it('is strictly opt-in', () => {
    expect(isVoiceEnabled(features({ voiceEnabled: true }))).toBe(true)
    expect(isVoiceEnabled(features({}))).toBe(false)
    expect(isVoiceEnabled(null)).toBe(false)
  })
})
