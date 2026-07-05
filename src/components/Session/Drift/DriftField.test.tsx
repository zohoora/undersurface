import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, screen, fireEvent } from '@testing-library/react'
import type { DriftApi } from '../../../hooks/useDriftSession'
import type { DriftState } from '../../../engine/driftEngine'

void React

let currentApi: DriftApi
vi.mock('../../../hooks/useDriftSession', () => ({
  useDriftSession: () => currentApi,
}))

// Voice wiring is covered by useDriftVoice.test; isolate DriftField from it.
vi.mock('../../../hooks/useDriftVoice', () => ({
  useDriftVoice: () => ({ voiceState: 'idle', assistantSpeaking: false }),
}))

// Isolate DriftField from BLS internals (Web Audio / rAF) — Task 4 tests those.
vi.mock('./BilateralStimulus', () => ({
  BilateralStimulus: ({ channel, running }: { channel: string; running: boolean }) =>
    running && channel === 'visual' ? React.createElement('div', { 'data-testid': 'bls-dot' }) : null,
}))

vi.mock('../../../i18n', () => ({ t: (k: string) => k }))

let currentSettings = { lastDriftBlsChannel: 'visual', lastDriftAudioVolume: 0.5, lastDriftVoice: false }
vi.mock('../../../store/settings', () => ({
  getSettings: () => currentSettings,
  updateSettings: vi.fn(),
}))

import { DriftField } from './DriftField'

function makeState(overrides: Partial<DriftState> = {}): DriftState {
  return {
    phase: 'arrive', setCount: 0, sameStreak: 0, inSettleRecheck: false,
    elapsedMs: 0, closureReason: null, lastInterweave: null, ...overrides,
  }
}

function makeApi(state: DriftState): DriftApi {
  return {
    state,
    transcript: [],
    streamingText: '',
    begin: vi.fn(async () => {}),
    confirmAnchor: vi.fn(),
    submitStartingPoint: vi.fn(async () => {}),
    submitBaseline: vi.fn(async () => {}),
    completeSet: vi.fn(),
    submitNotice: vi.fn(async () => {}),
    settleDone: vi.fn(),
    requestClose: vi.fn(),
    closureDone: vi.fn(async () => {}),
    abandon: vi.fn(async () => {}),
    voiceActive: false,
  }
}

function renderPhase(state: DriftState) {
  currentApi = makeApi(state)
  return render(<DriftField parentSessionId={null} hrvContext={null} voiceAvailable={false} onClose={() => {}} />)
}

beforeEach(() => {
  currentSettings = { lastDriftBlsChannel: 'visual', lastDriftAudioVolume: 0.5, lastDriftVoice: false }
})
afterEach(() => cleanup())

describe('DriftField', () => {
  it('arrive shows the not-therapy framing and NO Settle & close button', () => {
    renderPhase(makeState({ phase: 'arrive' }))
    expect(screen.queryByText('drift.arrive.notTherapy')).not.toBeNull()
    expect(screen.queryByText('drift.settleClose')).toBeNull()
  })

  it('anchor exposes the persistent Settle & close button', () => {
    renderPhase(makeState({ phase: 'anchor' }))
    expect(screen.queryByText('drift.settleClose')).not.toBeNull()
  })

  it('set renders the visual BLS dot and Skip advances the set', () => {
    renderPhase(makeState({ phase: 'set' }))
    expect(screen.queryByTestId('bls-dot')).not.toBeNull()
    fireEvent.click(screen.getByText('drift.set.skip'))
    expect(currentApi.completeSet).toHaveBeenCalled()
  })

  it('notice renders the directional pills and submits the chosen direction', () => {
    renderPhase(makeState({ phase: 'notice' }))
    fireEvent.click(screen.getByText('drift.notice.stronger'))
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: 'it is louder' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(currentApi.submitNotice).toHaveBeenCalledWith('it is louder', 'stronger')
  })

  it('a crisis closure shows the abort handoff line', () => {
    renderPhase(makeState({ phase: 'closure', closureReason: 'crisis' }))
    expect(screen.queryByText('drift.abort.handoff')).not.toBeNull()
  })

  it('Escape outside arrive requests a graceful close (never a dead exit)', () => {
    renderPhase(makeState({ phase: 'notice' }))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(currentApi.requestClose).toHaveBeenCalled()
  })
})
