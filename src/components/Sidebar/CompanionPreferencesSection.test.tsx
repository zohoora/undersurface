import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

let stored: Record<string, unknown> | undefined
const add = vi.fn(async (value: Record<string, unknown>) => { stored = value })
const update = vi.fn(async (_id: string, value: Record<string, unknown>) => {
  stored = { ...(stored ?? {}), ...value }
})

vi.mock('../../store/db', () => ({
  db: {
    companionPreferences: {
      get: async () => stored,
      add,
      update,
    },
    userProfile: { get: vi.fn(), update: vi.fn() },
    personalFacts: { get: vi.fn(), update: vi.fn() },
    memories: { orderBy: vi.fn() },
    sessions: { orderBy: vi.fn() },
  },
}))

vi.mock('../../i18n', () => ({
  useTranslation: () => new Proxy({}, { get: (_target, key) => String(key) }),
}))

const { CompanionPreferencesSection } = await import('./CompanionPreferencesSection')

afterEach(() => {
  cleanup()
  stored = undefined
  vi.clearAllMocks()
})

describe('CompanionPreferencesSection continuity control', () => {
  it('offers one Fresh eyes default and persists only fresh or normal continuity', async () => {
    render(<CompanionPreferencesSection isOpen />)

    expect(screen.queryByText(/light memory/i)).toBeNull()
    expect(screen.queryByText(/counterstory/i)).toBeNull()
    expect(screen.getByText(/transcript still stays in history and export/i)).toBeInTheDocument()

    const toggle = screen.getByRole('checkbox', { name: 'Start new sessions with Fresh eyes' })
    expect(toggle).not.toBeChecked()
    fireEvent.click(toggle)
    await waitFor(() => expect(add).toHaveBeenCalledWith(expect.objectContaining({
      defaultMemoryAperture: 'fresh',
    })))

    fireEvent.click(toggle)
    await waitFor(() => expect(update).toHaveBeenCalledWith('current', expect.objectContaining({
      defaultMemoryAperture: 'pattern',
    })))
  })
})
