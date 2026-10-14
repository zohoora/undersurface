import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const room = vi.hoisted(() => ({
  phase: 'choosing' as 'choosing' | 'threshold' | 'immersing' | 'returning',
  config: null as null | { approach: string; voiceDensity: string; audioTrack: string },
  voiceError: null as string | null,
  finish: vi.fn(),
  continueQuietly: vi.fn(),
  retryVoice: vi.fn(async () => {}),
  setVoiceDensity: vi.fn(),
  changeSound: vi.fn(),
  options: null as null | { onEndRequested?: () => void },
}))

vi.mock('../../../hooks/useRoomSession', () => ({
  useRoomSession: (options: { onEndRequested?: () => void }) => {
    room.options = options
    return {
      phase: room.phase,
      config: room.config,
      elapsedMs: 0,
      extendedMs: 0,
      caption: '',
      audioState: 'idle',
      voiceState: 'connected',
      voiceError: room.voiceError,
      assistantSpeaking: false,
      userSpeaking: false,
      muted: false,
      start: vi.fn(async () => {}),
      enter: vi.fn(),
      finish: room.finish,
      stay: vi.fn(),
      changeSound: room.changeSound,
      retryAudio: vi.fn(),
      retryVoice: room.retryVoice,
      continueQuietly: room.continueQuietly,
      setVoiceDensity: room.setVoiceDensity,
      toggleMute: vi.fn(),
    }
  },
}))

vi.mock('../../../store/settings', () => ({
  useSettings: () => ({
    lastRoomApproach: 'listen_first',
    lastRoomDuration: 5,
    lastRoomAudio: 'ocean',
    lastRoomVoiceDensity: 'sparse',
    lastRoomAudioVolume: 0.4,
  }),
}))

vi.mock('../../../i18n', () => ({
  useTranslation: () => new Proxy({}, { get: (_target, key: string) => `t:${key}` }),
}))

const { RoomField } = await import('./RoomField')

void React

function roomElement(onClose: () => void) {
  return (
    <RoomField
      parentSessionId="sess-1"
      memoryAperture="pattern"
      buildInstructions={() => 'room'}
      voiceAvailable
      onUserTranscript={vi.fn()}
      onAssistantTranscript={vi.fn()}
      onClose={onClose}
    />
  )
}

// Mirrors the app: the session UI (and the Room launcher) live inside #root.
function renderRoom(onClose = vi.fn()) {
  const appRoot = document.createElement('div')
  appRoot.id = 'root'
  document.body.appendChild(appRoot)
  const launcher = document.createElement('button')
  launcher.textContent = 'launcher'
  appRoot.appendChild(launcher)
  launcher.focus()
  const host = document.createElement('div')
  appRoot.appendChild(host)
  const view = render(roomElement(onClose), { container: host })
  return { onClose, appRoot, launcher, view }
}

afterEach(() => { document.getElementById('root')?.remove() })

beforeEach(() => {
  vi.clearAllMocks()
  room.phase = 'choosing'
  room.config = null
  room.voiceError = null
})

afterEach(() => { cleanup() })

describe('RoomField — modal semantics (TECH_ISSUES #32)', () => {
  it('is a labelled modal dialog that takes focus on open', () => {
    renderRoom()
    const dialog = screen.getByRole('dialog')
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(dialog.getAttribute('aria-label')).toBe('t:room.aria')
    expect(dialog.contains(document.activeElement)).toBe(true)
  })

  it('Escape leaves Room (finishing a live room first)', () => {
    room.phase = 'immersing'
    room.config = { approach: 'lead_me', voiceDensity: 'sparse', audioTrack: 'ocean' }
    const { onClose } = renderRoom()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(room.finish).toHaveBeenCalledWith(false)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('labels the in-room control group from i18n', () => {
    room.phase = 'immersing'
    room.config = { approach: 'lead_me', voiceDensity: 'sparse', audioTrack: 'ocean' }
    renderRoom()
    expect(screen.getByRole('group', { name: 't:room.controls.aria' })).toBeTruthy()
  })
})

describe('RoomField — lifecycle wiring (TECH_ISSUES #31)', () => {
  it('a spoken "end" closes back to Talk via onClose', () => {
    const { onClose } = renderRoom()
    room.options?.onEndRequested?.()
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('"Continue quietly" clears the voice error through the hook', () => {
    room.phase = 'immersing'
    room.config = { approach: 'lead_me', voiceDensity: 'sparse', audioTrack: 'ocean' }
    room.voiceError = 'voice.error.disconnected'
    renderRoom()
    fireEvent.click(screen.getByRole('button', { name: 't:room.voice.continueQuietly' }))
    expect(room.continueQuietly).toHaveBeenCalledTimes(1)
  })
})

describe('RoomField — keyboard boundary (Codex review T6)', () => {
  it('makes the rest of the app inert while open and returns focus to the launcher on exit', () => {
    const { appRoot, launcher, view } = renderRoom()
    expect(appRoot.hasAttribute('inert')).toBe(true)
    const dialog = screen.getByRole('dialog')
    expect(appRoot.contains(dialog)).toBe(false) // portaled outside the inert tree
    expect(document.activeElement).not.toBe(launcher)
    view.unmount()
    expect(appRoot.hasAttribute('inert')).toBe(false)
    expect(document.activeElement).toBe(launcher)
  })

  it('keeps focus inside Room when a phase change removes the focused control', () => {
    room.phase = 'threshold'
    room.config = { approach: 'listen_first', voiceDensity: 'sparse', audioTrack: 'ocean' }
    const { view } = renderRoom()
    const enter = screen.getByRole('button', { name: 't:room.threshold.enter' })
    enter.focus()
    room.phase = 'immersing'
    view.rerender(roomElement(vi.fn()))
    const dialog = screen.getByRole('dialog')
    expect(dialog.contains(document.activeElement)).toBe(true)
  })

  it('Tab and Shift+Tab from the dialog itself enter its controls from the matching end', () => {
    room.phase = 'immersing'
    room.config = { approach: 'lead_me', voiceDensity: 'sparse', audioTrack: 'ocean' }
    renderRoom()
    const dialog = screen.getByRole('dialog')
    dialog.focus()
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true })
    const buttons = Array.from(dialog.querySelectorAll('button'))
    expect(document.activeElement).toBe(buttons[buttons.length - 1])
    dialog.focus()
    fireEvent.keyDown(dialog, { key: 'Tab' })
    expect(document.activeElement).toBe(buttons[0])
  })
})
