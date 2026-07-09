import React from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, screen } from '@testing-library/react'
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

describe('RelaxSettingsPanel', () => {
  // Separation regression (Drift v2, 2026-07-09): Drift moved out of Relax to
  // its own bottom-bar surface. The panel must never grow a Drift entry back.
  it('renders the Relax settings without any Drift entry', () => {
    render(<RelaxSettingsPanel initial={initial} onBegin={() => {}} onCancel={() => {}} />)
    expect(screen.queryByText('drift.card.title')).toBeNull()
    expect(screen.queryByText(/drift/i)).toBeNull()
    expect(screen.queryByText('relax.settings.type.label')).not.toBeNull()
  })
})
