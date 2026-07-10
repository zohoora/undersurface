import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
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
  it('does not expose Fresh eyes as a persistent preference', async () => {
    render(<CompanionPreferencesSection isOpen />)

    expect(screen.queryByText(/light memory/i)).toBeNull()
    expect(screen.queryByText(/counterstory/i)).toBeNull()
    expect(screen.queryByRole('checkbox', { name: 'Start new sessions with Fresh eyes' })).toBeNull()
    expect(screen.getByRole('checkbox', { name: 'Field mosaic' })).toBeInTheDocument()
  })
})
