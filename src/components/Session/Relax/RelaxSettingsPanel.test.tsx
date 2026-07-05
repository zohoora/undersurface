import React from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, screen, fireEvent } from '@testing-library/react'
import type { RelaxSettings } from '../../../hooks/useRelaxSession'

void React

vi.mock('../../../i18n', () => ({ t: (k: string) => k }))
vi.mock('../../../store/globalConfig', () => ({ getGlobalConfig: () => ({ features: {} }) }))
vi.mock('../../../hooks/useSoundscapePrefetch', () => ({
  useSoundscapePrefetch: () => ({ status: 'idle', audio: null, errorKind: null, canGenerate: false, generate: vi.fn() }),
}))

import { RelaxSettingsPanel } from './RelaxSettingsPanel'

const initial: RelaxSettings = {
  duration: 5, sessionType: 'breathwork', audioTrack: 'none', audioVolume: 0.5, voiceEnabled: false, visualMode: 'full',
}

afterEach(() => cleanup())

describe('RelaxSettingsPanel — Drift entry card', () => {
  it('renders the Drift card only when onEnterDrift is provided, and invokes it on click', () => {
    const onEnterDrift = vi.fn()
    render(<RelaxSettingsPanel initial={initial} onBegin={() => {}} onCancel={() => {}} onEnterDrift={onEnterDrift} />)
    const card = screen.getByText('drift.card.title')
    expect(card).not.toBeNull()
    fireEvent.click(card)
    expect(onEnterDrift).toHaveBeenCalled()
  })

  it('hides the Drift card when onEnterDrift is absent (flag off / grounding)', () => {
    render(<RelaxSettingsPanel initial={initial} onBegin={() => {}} onCancel={() => {}} />)
    expect(screen.queryByText('drift.card.title')).toBeNull()
  })
})
