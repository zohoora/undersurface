import { describe, expect, it } from 'vitest'
import { isValidTimezone, timezoneLabel, timezoneOptions } from './timezoneOptions'

describe('timezone settings options', () => {
  it('preserves a detected IANA zone even when it is not in the common list', () => {
    const options = timezoneOptions('America/St_Johns')
    expect(options[0]).toBe('America/St_Johns')
    expect(options.filter(value => value === 'America/St_Johns')).toHaveLength(1)
  })

  it('gives same-offset cities distinct visible labels', () => {
    expect(timezoneLabel('America/Toronto', 'en')).toContain('Toronto')
    expect(timezoneLabel('America/New_York', 'en')).toContain('New York')
  })

  it('accepts IANA zones and rejects free text the scheduler cannot use', () => {
    expect(isValidTimezone('America/Toronto')).toBe(true)
    expect(isValidTimezone('UTC')).toBe(true)
    expect(isValidTimezone('Eastern time')).toBe(false)
    expect(isValidTimezone('Mars/Olympus')).toBe(false)
    expect(isValidTimezone('')).toBe(false)
  })
})
