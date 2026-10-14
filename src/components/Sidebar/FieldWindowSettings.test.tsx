import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

let stored: Record<string, unknown> | null = null
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
  },
}))

vi.mock('../../store/settings', () => ({
  getSettings: () => ({ timezone: 'America/Toronto', language: 'en' }),
  registerSettingsInvalidator: () => () => {},
}))

const { FieldWindowSettings } = await import('./FieldWindowSettings')
const {
  MIN_FIELD_WINDOW_MINUTES,
  minuteToTime,
  timeToMinute,
  windowWithEnd,
  windowWithStart,
} = await import('./fieldWindowSettingsLogic')

afterEach(() => {
  cleanup()
  stored = null
  vi.clearAllMocks()
})

describe('FieldWindowSettings', () => {
  it('converts browser time values without timezone arithmetic', () => {
    expect(minuteToTime(17 * 60 + 5)).toBe('17:05')
    expect(timeToMinute('17:05')).toBe(17 * 60 + 5)
    expect(timeToMinute('25:00')).toBeNull()
  })

  it('requires an explicit opt-in and persists a consent timestamp', async () => {
    render(<FieldWindowSettings isOpen />)
    const checkbox = await screen.findByRole('checkbox', { name: 'Allow occasional SMS in these windows' })
    expect(checkbox).not.toBeChecked()
    fireEvent.click(checkbox)
    await waitFor(() => expect(add).toHaveBeenCalledWith(expect.objectContaining({
      fieldWindows: expect.objectContaining({
        enabled: true,
        timezone: 'America/Toronto',
        maxPerWeek: 2,
        consentAt: expect.any(Number),
      }),
    })))
    expect(screen.getByText('No more than one message can arrive in a window or day. Every message says that no reply is needed. Turn this off at any time.')).toBeInTheDocument()
  })

  it('updates an existing preference doc without replacing companion settings', async () => {
    stored = {
      id: 'current',
      defaultMemoryAperture: 'fresh',
      fieldMosaicEnabled: false,
      outcomeSampling: 'off',
      fieldWindows: {
        enabled: true,
        timezone: 'America/Toronto',
        maxPerWeek: 1,
        consentAt: 5,
        windows: [{ id: 'w1', label: 'Lunch', days: [1], startMinute: 720, endMinute: 780, purpose: 'notice', enabled: true }],
        updatedAt: 5,
      },
      updatedAt: 5,
    }
    render(<FieldWindowSettings isOpen />)
    fireEvent.change(await screen.findByDisplayValue('1'), { target: { value: '3' } })
    await waitFor(() => expect(update).toHaveBeenCalledWith('current', expect.objectContaining({
      fieldWindows: expect.objectContaining({ maxPerWeek: 3 }),
    })))
    expect(update.mock.calls.at(-1)?.[1]).not.toHaveProperty('defaultMemoryAperture')
  })

  it('keeps every window at least 15 minutes long', () => {
    const window = { startMinute: 17 * 60, endMinute: 17 * 60 + 30 }
    // Moving the start late pushes the end along.
    expect(windowWithStart(window, 17 * 60 + 25)).toEqual({ startMinute: 17 * 60 + 25, endMinute: 17 * 60 + 40 })
    expect(windowWithStart(window, 16 * 60)).toEqual({ startMinute: 16 * 60, endMinute: 17 * 60 + 30 })
    expect(windowWithStart(window, 23 * 60 + 50)).toBeNull()
    // The end cannot come within 15 minutes of the start.
    expect(windowWithEnd(window, 17 * 60 + MIN_FIELD_WINDOW_MINUTES)).toEqual({ startMinute: 17 * 60, endMinute: 17 * 60 + 15 })
    expect(windowWithEnd(window, 17 * 60 + 14)).toBeNull()
    expect(windowWithEnd(window, 16 * 60)).toBeNull()
  })

  it('refuses an end time that would make the window shorter than 15 minutes', async () => {
    stored = {
      id: 'current',
      fieldMosaicEnabled: true,
      outcomeSampling: 'light',
      fieldWindows: {
        enabled: true,
        timezone: 'America/Toronto',
        maxPerWeek: 1,
        consentAt: 5,
        windows: [{ id: 'w1', label: 'Lunch', days: [1], startMinute: 720, endMinute: 780, purpose: 'notice', enabled: true }],
        updatedAt: 5,
      },
      updatedAt: 5,
    }
    render(<FieldWindowSettings isOpen />)
    const end = await screen.findByDisplayValue('13:00')
    fireEvent.change(end, { target: { value: '12:10' } })
    expect(update).not.toHaveBeenCalled()
    fireEvent.change(end, { target: { value: '12:15' } })
    await waitFor(() => expect(update).toHaveBeenCalledWith('current', expect.objectContaining({
      fieldWindows: expect.objectContaining({
        windows: [expect.objectContaining({ startMinute: 720, endMinute: 735 })],
      }),
    })))
  })

  it('stamps fresh consent on every explicit opt-in', async () => {
    stored = {
      id: 'current',
      fieldMosaicEnabled: true,
      outcomeSampling: 'light',
      fieldWindows: {
        enabled: false,
        timezone: 'America/Toronto',
        maxPerWeek: 1,
        consentAt: 5,
        windows: [{ id: 'w1', label: 'Lunch', days: [1], startMinute: 720, endMinute: 780, purpose: 'notice', enabled: true }],
        updatedAt: 5,
      },
      updatedAt: 5,
    }
    render(<FieldWindowSettings isOpen />)
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Allow occasional SMS in these windows' }))
    await waitFor(() => expect(update).toHaveBeenCalled())
    const fieldWindows = (update.mock.calls.at(-1)?.[1] as { fieldWindows: { enabled: boolean; consentAt: number } }).fieldWindows
    expect(fieldWindows.enabled).toBe(true)
    expect(fieldWindows.consentAt).toBeGreaterThan(5)
  })
})
