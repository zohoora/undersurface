import { describe, expect, it } from 'vitest'
import { takeHandoff, writeHandoff } from './handoff'

describe('the Talk handoff', () => {
  it('is read once', () => {
    writeHandoff('These words.')
    expect(takeHandoff()).toBe('These words.')
    expect(takeHandoff()).toBeNull()
  })
})
