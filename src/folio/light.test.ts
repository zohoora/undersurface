import { describe, expect, it } from 'vitest'
import { lightForHour, writerHour } from './light'

describe('the page\'s light follows the writer-local hour', () => {
  it('has four bands', () => {
    expect([4, 5, 10, 11, 16, 17, 20, 21, 0].map(lightForHour)).toEqual(['night', 'morning', 'morning', 'afternoon', 'afternoon', 'evening', 'evening', 'night', 'night'])
  })

  it('reads the hour in the writer\'s timezone', () => {
    const noonUtc = new Date(Date.UTC(2026, 9, 16, 12, 0, 0))
    expect(writerHour('UTC', noonUtc)).toBe(12)
    expect(writerHour('America/Toronto', noonUtc)).toBe(8)
    expect(writerHour('Asia/Tokyo', noonUtc)).toBe(21)
  })
})
