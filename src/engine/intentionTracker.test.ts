import { describe, it, expect } from 'vitest'
import {
  createIntention,
  applyIntentionOutcomes,
  orderForFollowUp,
  selectPatternToName,
} from './intentionTracker'
import type { SessionIntention } from '../types'

const NOW = 1_750_000_000_000

function makeIntention(over: Partial<SessionIntention>): SessionIntention {
  return {
    id: 'i1',
    text: 'call him thursday',
    sessionId: 's1',
    status: 'open',
    askedCount: 0,
    notYetCount: 0,
    patternNamed: false,
    createdAt: NOW - 1000,
    updatedAt: NOW - 1000,
    ...over,
  }
}

describe('createIntention', () => {
  it('creates an open intention in the writer’s words', () => {
    const result = createIntention([], '  Call him Thursday  ', 's9', NOW)
    expect(result?.create).toMatchObject({ text: 'Call him Thursday', status: 'open', sessionId: 's9' })
    expect(result?.release).toBeNull()
  })

  it('releases the OLDEST open intention when the cap (3) is full', () => {
    const all = [
      makeIntention({ id: 'a', createdAt: NOW - 300 }),
      makeIntention({ id: 'b', createdAt: NOW - 100 }),
      makeIntention({ id: 'c', createdAt: NOW - 200 }),
    ]
    const result = createIntention(all, 'a fourth thing', 's9', NOW)
    expect(result?.release?.id).toBe('a')
    expect(result?.release?.status).toBe('released')
  })

  it('refuses empty text and duplicate open text (case-insensitive)', () => {
    expect(createIntention([], '   ', 's9', NOW)).toBeNull()
    expect(createIntention([makeIntention({})], 'CALL HIM THURSDAY', 's9', NOW)).toBeNull()
  })
})

describe('applyIntentionOutcomes', () => {
  it('resolves kept/adapted/released and increments not_yet', () => {
    const all = [
      makeIntention({ id: 'a' }),
      makeIntention({ id: 'b' }),
      makeIntention({ id: 'c' }),
    ]
    const updates = applyIntentionOutcomes(all, [
      { id: 'a', outcome: 'kept', note: 'called and it went well' },
      { id: 'b', outcome: 'not_yet' },
      { id: 'c', outcome: 'released' },
    ], NOW)

    expect(updates.find((u) => u.id === 'a')).toMatchObject({ status: 'kept', outcomeNote: 'called and it went well' })
    expect(updates.find((u) => u.id === 'b')).toMatchObject({ status: 'open', notYetCount: 1 })
    expect(updates.find((u) => u.id === 'c')).toMatchObject({ status: 'released' })
  })

  it('ignores unknown ids, non-open intentions, malformed entries, and duplicate ids', () => {
    const all = [makeIntention({ id: 'a' }), makeIntention({ id: 'done', status: 'kept' })]
    const updates = applyIntentionOutcomes(all, [
      { id: 'ghost', outcome: 'kept' },
      { id: 'done', outcome: 'not_yet' },
      { id: 'a', outcome: 'nonsense' },
      'garbage',
      { id: 'a', outcome: 'kept' },
      { id: 'a', outcome: 'released' }, // duplicate id — first valid outcome wins
    ], NOW)
    expect(updates).toHaveLength(1)
    expect(updates[0]).toMatchObject({ id: 'a', status: 'kept' })
  })
})

describe('orderForFollowUp', () => {
  it('orders by notYetCount desc, then oldest first, open only', () => {
    const all = [
      makeIntention({ id: 'fresh', createdAt: NOW - 100 }),
      makeIntention({ id: 'slipping', notYetCount: 2, createdAt: NOW - 50 }),
      makeIntention({ id: 'oldest', createdAt: NOW - 900 }),
      makeIntention({ id: 'closed', status: 'kept', notYetCount: 5 }),
    ]
    expect(orderForFollowUp(all).map((i) => i.id)).toEqual(['slipping', 'oldest', 'fresh'])
  })
})

describe('selectPatternToName', () => {
  it('selects an open intention at 3+ not-yets that has not been named', () => {
    const all = [makeIntention({ id: 'a', notYetCount: 3 })]
    expect(selectPatternToName(all)?.id).toBe('a')
  })

  it('never re-selects once named, below threshold, or non-open', () => {
    expect(selectPatternToName([makeIntention({ notYetCount: 3, patternNamed: true })])).toBeNull()
    expect(selectPatternToName([makeIntention({ notYetCount: 2 })])).toBeNull()
    expect(selectPatternToName([makeIntention({ notYetCount: 4, status: 'released' })])).toBeNull()
  })
})
