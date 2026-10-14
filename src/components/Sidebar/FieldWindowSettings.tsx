import { useEffect, useState } from 'react'
import { useTranslation } from '../../i18n'
import { db } from '../../store/db'
import { getSettings } from '../../store/settings'
import type {
  CompanionPreferences,
  FieldWindow,
  FieldWindowDay,
  FieldWindowPreferences,
  FieldWindowPurpose,
} from '../../types'
import {
  MIN_FIELD_WINDOW_MINUTES,
  minuteToTime,
  timeToMinute,
  windowWithEnd,
  windowWithStart,
} from './fieldWindowSettingsLogic'
import { currentTimestamp } from '../../store/timestamp'

const DAYS: Array<{ day: FieldWindowDay; short: string; title: string }> = [
  { day: 0, short: 'Su', title: 'Sunday' },
  { day: 1, short: 'Mo', title: 'Monday' },
  { day: 2, short: 'Tu', title: 'Tuesday' },
  { day: 3, short: 'We', title: 'Wednesday' },
  { day: 4, short: 'Th', title: 'Thursday' },
  { day: 5, short: 'Fr', title: 'Friday' },
  { day: 6, short: 'Sa', title: 'Saturday' },
]

function newWindow(index = 0): FieldWindow {
  return {
    id: `window-${index + 1}`,
    label: index === 0 ? 'After work' : 'A useful moment',
    days: [1, 2, 3, 4, 5],
    startMinute: 17 * 60,
    endMinute: 19 * 60,
    purpose: 'settle',
    enabled: true,
  }
}

function defaultPreferences(): FieldWindowPreferences {
  return {
    enabled: false,
    timezone: getSettings().timezone,
    maxPerWeek: 2,
    windows: [newWindow()],
    updatedAt: 0,
  }
}

async function persistFieldWindows(value: FieldWindowPreferences, exists: boolean): Promise<void> {
  if (exists) {
    await db.companionPreferences.update('current', { fieldWindows: value, updatedAt: value.updatedAt })
    return
  }
  const initial: CompanionPreferences = {
    id: 'current',
    fieldMosaicEnabled: true,
    outcomeSampling: 'light',
    fieldWindows: value,
    updatedAt: value.updatedAt,
  }
  await db.companionPreferences.add(initial)
}

const inputStyle = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '5px 7px',
  border: '1px solid var(--border-subtle)',
  borderRadius: 4,
  background: 'var(--surface-primary)',
  color: 'var(--text-primary)',
  fontSize: 11,
} as const

export function FieldWindowSettings({ isOpen }: { isOpen: boolean }) {
  const tr = useTranslation()
  const [preferences, setPreferences] = useState<FieldWindowPreferences>(() => defaultPreferences())
  const [exists, setExists] = useState(false)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!isOpen) return
    let cancelled = false
    void db.companionPreferences.get('current').then(value => {
      if (cancelled) return
      setExists(Boolean(value))
      if (value?.fieldWindows) {
        setPreferences({ ...defaultPreferences(), ...value.fieldWindows })
      }
      setLoaded(true)
    })
    return () => { cancelled = true }
  }, [isOpen])

  const save = (transform: (current: FieldWindowPreferences) => FieldWindowPreferences) => {
    const next = { ...transform(preferences), updatedAt: currentTimestamp() }
    setPreferences(next)
    void persistFieldWindows(next, exists).then(() => setExists(true))
  }

  const updateWindow = (id: string, partial: Partial<FieldWindow>) => {
    save(current => ({
      ...current,
      windows: current.windows.map(window => window.id === id ? { ...window, ...partial } : window),
    }))
  }

  const toggleDay = (window: FieldWindow, day: FieldWindowDay) => {
    const days = window.days.includes(day)
      ? window.days.filter(value => value !== day)
      : [...window.days, day].sort()
    if (days.length > 0) updateWindow(window.id, { days })
  }

  if (!loaded) return null

  return (
    <div style={{ borderTop: '1px solid var(--border-light)', paddingTop: 10, marginTop: 2 }}>
      <div style={{ fontSize: 11, color: 'var(--text-primary)' }}>{tr['ps.field.title']}</div>
      <div style={{ fontSize: 10, color: 'var(--text-ghost)', lineHeight: 1.45, marginTop: 3 }}>
        {tr['ps.field.description']}
      </div>
      <label style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 8, color: 'var(--text-secondary)', fontSize: 11 }}>
        {tr['ps.field.enable']}
        <input
          type="checkbox"
          checked={preferences.enabled}
          onChange={event => save(current => ({
            ...current,
            enabled: event.target.checked,
            // Every explicit opt-in is fresh consent. The server ignores
            // consent older than an SMS STOP/UNLINK, so never reuse it.
            ...(event.target.checked ? { consentAt: currentTimestamp() } : {}),
          }))}
        />
      </label>
      {preferences.enabled && (
        <div style={{ display: 'grid', gap: 10, marginTop: 9 }}>
          <label style={{ display: 'grid', gap: 3, color: 'var(--text-secondary)', fontSize: 10 }}>
            {tr['ps.field.timezone']}
            <input value={preferences.timezone} onChange={event => save(current => ({ ...current, timezone: event.target.value.trim() }))} style={inputStyle} />
          </label>
          <label style={{ display: 'grid', gap: 3, color: 'var(--text-secondary)', fontSize: 10 }}>
            {tr['ps.field.max']}
            <select value={preferences.maxPerWeek} onChange={event => save(current => ({ ...current, maxPerWeek: Number(event.target.value) as 1 | 2 | 3 }))} style={inputStyle}>
              <option value={1}>1</option>
              <option value={2}>2</option>
              <option value={3}>3</option>
            </select>
          </label>
          {preferences.windows.map((window, index) => (
            <div key={window.id} style={{ border: '1px solid var(--border-light)', borderRadius: 6, padding: 8 }}>
              <input
                aria-label={tr['ps.field.label']}
                value={window.label}
                maxLength={60}
                onChange={event => updateWindow(window.id, { label: event.target.value })}
                style={inputStyle}
              />
              <div style={{ display: 'flex', gap: 3, marginTop: 7 }}>
                {DAYS.map(item => (
                  <button
                    key={item.day}
                    type="button"
                    title={item.title}
                    aria-pressed={window.days.includes(item.day)}
                    onClick={() => toggleDay(window, item.day)}
                    style={{ flex: 1, border: '1px solid var(--border-subtle)', borderRadius: 3, padding: '4px 0', background: window.days.includes(item.day) ? 'var(--surface-secondary)' : 'transparent', color: 'var(--text-secondary)', fontSize: 9, cursor: 'pointer' }}
                  >
                    {item.short}
                  </button>
                ))}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 7 }}>
                <label style={{ color: 'var(--text-ghost)', fontSize: 9 }}>
                  {tr['ps.field.from']}
                  <input type="time" value={minuteToTime(window.startMinute)} onChange={event => {
                    const minute = timeToMinute(event.target.value)
                    const next = minute === null ? null : windowWithStart(window, minute)
                    if (next) updateWindow(window.id, next)
                  }} style={{ ...inputStyle, marginTop: 2 }} />
                </label>
                <label style={{ color: 'var(--text-ghost)', fontSize: 9 }}>
                  {tr['ps.field.to']}
                  <input type="time" min={minuteToTime(Math.min(window.startMinute + MIN_FIELD_WINDOW_MINUTES, 23 * 60 + 59))} value={minuteToTime(window.endMinute)} onChange={event => {
                    const minute = timeToMinute(event.target.value)
                    const next = minute === null ? null : windowWithEnd(window, minute)
                    if (next) updateWindow(window.id, next)
                  }} style={{ ...inputStyle, marginTop: 2 }} />
                </label>
              </div>
              <select aria-label={tr['ps.field.purpose']} value={window.purpose} onChange={event => updateWindow(window.id, { purpose: event.target.value as FieldWindowPurpose })} style={{ ...inputStyle, marginTop: 7 }}>
                <option value="notice">{tr['ps.field.notice']}</option>
                <option value="settle">{tr['ps.field.settle']}</option>
                <option value="act">{tr['ps.field.act']}</option>
              </select>
              {preferences.windows.length > 1 && (
                <button type="button" onClick={() => save(current => ({ ...current, windows: current.windows.filter(item => item.id !== window.id) }))} style={{ border: 0, background: 'none', color: 'var(--text-ghost)', fontSize: 9, padding: '6px 0 0', cursor: 'pointer' }}>
                  {tr['ps.field.remove']}
                </button>
              )}
              {index === preferences.windows.length - 1 && preferences.windows.length < 3 && (
                <button type="button" onClick={() => save(current => {
                  const nextIndex = current.windows.reduce((max, item) => {
                    const match = /^window-(\d+)$/.exec(item.id)
                    return Math.max(max, match ? Number(match[1]) : 0)
                  }, 0)
                  return { ...current, windows: [...current.windows, newWindow(nextIndex)] }
                })} style={{ border: 0, background: 'none', color: 'var(--text-secondary)', fontSize: 9, padding: '6px 0 0 10px', cursor: 'pointer' }}>
                  {tr['ps.field.add']}
                </button>
              )}
            </div>
          ))}
          <div style={{ fontSize: 9, color: 'var(--text-ghost)', lineHeight: 1.4 }}>{tr['ps.field.note']}</div>
        </div>
      )}
    </div>
  )
}
