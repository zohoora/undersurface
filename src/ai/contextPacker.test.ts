import { describe, it, expect } from 'vitest'
import { packByBudget, estimateTokens, type PackItem } from './contextPacker'

const mk = (text: string, priority: number, recency: number): PackItem => ({ text, priority, recency })

describe('estimateTokens', () => {
  it('approximates ~4 chars per token, rounding up', () => {
    expect(estimateTokens('')).toBe(0)
    expect(estimateTokens('abcd')).toBe(1)
    expect(estimateTokens('abcde')).toBe(2)
  })
})

describe('packByBudget', () => {
  it('returns nothing for a non-positive budget', () => {
    expect(packByBudget([mk('a', 0, 1)], 0)).toEqual([])
    expect(packByBudget([mk('a', 0, 1)], -5)).toEqual([])
  })

  it('orders by priority ascending, then recency descending', () => {
    const items = [
      mk('low-old', 1, 100),
      mk('high-old', 0, 100),
      mk('high-new', 0, 200),
    ]
    const out = packByBudget(items, 1000).map(i => i.text)
    expect(out).toEqual(['high-new', 'high-old', 'low-old'])
  })

  it('stops including once the budget is exhausted', () => {
    // Each item ~5 tokens (20 chars). Budget of 12 tokens fits two.
    const twenty = 'x'.repeat(20)
    const items = [mk(twenty, 0, 3), mk(twenty, 0, 2), mk(twenty, 0, 1)]
    const out = packByBudget(items, 12)
    expect(out).toHaveLength(2)
  })

  it('skips an over-budget item but still packs later smaller ones', () => {
    const huge = 'y'.repeat(400) // 100 tokens
    const small = 'z'.repeat(8) // 2 tokens
    const items = [mk(huge, 0, 2), mk(small, 1, 1)]
    const out = packByBudget(items, 10).map(i => i.text)
    expect(out).toEqual([small])
  })

  it('does not mutate the input array', () => {
    const items = [mk('b', 1, 1), mk('a', 0, 1)]
    const snapshot = [...items]
    packByBudget(items, 1000)
    expect(items).toEqual(snapshot)
  })
})
