import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { GlobalConfig } from './adminTypes'
import { ADMIN_CONFIG_DEFAULTS } from './adminDefaults'

const adminFetchMock = vi.fn()
vi.mock('./adminApi', () => ({
  adminFetch: (...a: unknown[]) => adminFetchMock(...a),
}))

const { AdminSettings } = await import('./AdminSettings')

function storedConfig(features: Partial<GlobalConfig['features']>): GlobalConfig {
  return {
    ...ADMIN_CONFIG_DEFAULTS,
    features: { partsEnabled: true, visualEffectsEnabled: true, autocorrectEnabled: true, ...features },
  }
}

function serve(config: GlobalConfig) {
  adminFetchMock.mockImplementation((action: string, params?: { config?: Partial<GlobalConfig> }) => {
    if (action === 'getConfig') return Promise.resolve({ config })
    if (action === 'updateConfig') return Promise.resolve({ config: { ...config, ...params?.config } })
    return Promise.resolve(null)
  })
}

async function openSection(title: string) {
  fireEvent.click(await screen.findByRole('button', { name: new RegExp(title) }))
}

function savedFeatures(): Record<string, unknown> {
  const call = adminFetchMock.mock.calls.find(c => c[0] === 'updateConfig')
  if (!call) throw new Error('updateConfig was not called')
  return (call[1] as { config: GlobalConfig }).config.features as Record<string, unknown>
}

beforeEach(() => {
  adminFetchMock.mockReset()
})

afterEach(cleanup)

describe('AdminSettings: Room', () => {
  it('shows Room as on when only a legacy Relax/Drift flag is set', async () => {
    serve(storedConfig({ driftEnabled: true }))
    render(<AdminSettings />)
    await openSection('Room')

    const toggle = screen.getByRole('checkbox', { name: /Enable Room/ })
    expect(toggle).toBeChecked()
    expect(screen.getByText(/legacy Relax \/ Drift flags/)).toBeInTheDocument()
  })

  it('shows Room as off when nothing turns it on', async () => {
    serve(storedConfig({}))
    render(<AdminSettings />)
    await openSection('Room')
    expect(screen.getByRole('checkbox', { name: /Enable Room/ })).not.toBeChecked()
  })

  it('lets an admin fully turn Room off even with legacy flags on', async () => {
    serve(storedConfig({ relaxEnabled: true, driftEnabled: true }))
    render(<AdminSettings />)
    await openSection('Room')

    fireEvent.click(screen.getByRole('checkbox', { name: /Enable Room/ }))
    expect(screen.getByRole('checkbox', { name: /Enable Room/ })).not.toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: 'Save Settings' }))

    await waitFor(() => expect(savedFeatures().roomEnabled).toBe(false))
  })

  it('has no nested Drift toggle, no Custom soundscapes toggle, and no Relax/hypnotherapy copy', async () => {
    serve(storedConfig({ relaxEnabled: true, customSoundscapesEnabled: true } as Partial<GlobalConfig['features']>))
    render(<AdminSettings />)
    await openSection('Room')

    expect(screen.queryByText(/Custom soundscapes/i)).toBeNull()
    expect(screen.queryByText(/hypnotherapy/i)).toBeNull()
    expect(screen.queryByText(/Relax Mode/i)).toBeNull()
    expect(screen.queryByRole('checkbox', { name: /Drift/ })).toBeNull()
  })

  it('never round-trips the retired customSoundscapesEnabled key', async () => {
    serve(storedConfig({ customSoundscapesEnabled: false } as Partial<GlobalConfig['features']>))
    render(<AdminSettings />)
    fireEvent.click(await screen.findByRole('button', { name: 'Save Settings' }))
    await waitFor(() => expect(savedFeatures()).not.toHaveProperty('customSoundscapesEnabled'))
  })

  it('Reset Defaults writes Room off explicitly', async () => {
    serve(storedConfig({ roomEnabled: true }))
    render(<AdminSettings />)
    fireEvent.click(await screen.findByRole('button', { name: 'Reset Defaults' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save Settings' }))
    await waitFor(() => expect(savedFeatures().roomEnabled).toBe(false))
  })
})

describe('AdminSettings: Safety & Wellbeing', () => {
  it('shows no Emergency Grounding switch or Intensity Threshold (neither controls anything)', async () => {
    serve(storedConfig({}))
    render(<AdminSettings />)
    await openSection('Safety & Wellbeing')

    expect(screen.queryByRole('checkbox', { name: /Emergency Grounding/ })).toBeNull()
    expect(screen.queryByText(/Intensity Threshold/)).toBeNull()
    // The grounding tuning that is actually read stays visible.
    expect(screen.getByText(/Auto-Exit Timeout/)).toBeInTheDocument()
    expect(screen.getByText(/Self-Role Score Bonus/)).toBeInTheDocument()
    expect(screen.getByText(/Other Role Penalty/)).toBeInTheDocument()
  })

  it('never round-trips emergencyGrounding or grounding.intensityThreshold from a stored config', async () => {
    const config = storedConfig({ emergencyGrounding: true } as Partial<GlobalConfig['features']>)
    config.grounding = { autoExitMinutes: 7, intensityThreshold: 3 } as GlobalConfig['grounding']
    serve(config)
    render(<AdminSettings />)
    fireEvent.click(await screen.findByRole('button', { name: 'Save Settings' }))
    await waitFor(() => expect(savedFeatures()).not.toHaveProperty('emergencyGrounding'))
    const call = adminFetchMock.mock.calls.find(c => c[0] === 'updateConfig')
    const grounding = (call?.[1] as { config: GlobalConfig }).config.grounding as Record<string, unknown>
    expect(grounding).not.toHaveProperty('intensityThreshold')
    expect(grounding.autoExitMinutes).toBe(7)
  })
})

describe('AdminSettings: SMS field channel', () => {
  it('shows SMS as on when the flag is absent and writes smsEnabled when switched off', async () => {
    const config = storedConfig({})
    delete (config.features as Record<string, unknown>).smsEnabled
    serve(config)
    render(<AdminSettings />)
    await openSection('SMS Field Channel')

    const toggle = screen.getByRole('checkbox', { name: /Enable SMS field channel/ })
    expect(toggle).toBeChecked()
    fireEvent.click(toggle)
    fireEvent.click(screen.getByRole('button', { name: 'Save Settings' }))

    await waitFor(() => expect(savedFeatures().smsEnabled).toBe(false))
  })
})
