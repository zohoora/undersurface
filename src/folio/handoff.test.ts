import { describe, expect, it } from 'vitest'
import { clearHandoff, takeHandoff, writeHandoff } from './handoff'

describe('the Talk handoff', () => {
  it('is read once, by the account that wrote it', () => {
    writeHandoff('writer-a', 'These words.')
    expect(takeHandoff('writer-a')).toBe('These words.')
    expect(takeHandoff('writer-a')).toBeNull()
  })

  it('never reaches another account, and is consumed by the attempt', () => {
    writeHandoff('writer-a', 'Private to A.')
    expect(takeHandoff('writer-b')).toBeNull()
    expect(takeHandoff('writer-a')).toBeNull()
  })

  it('is cleared on sign-out', () => {
    writeHandoff('writer-a', 'Words.')
    clearHandoff()
    expect(takeHandoff('writer-a')).toBeNull()
  })
})
