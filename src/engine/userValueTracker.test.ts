import { describe, it, expect } from 'vitest'
import { applyValueObservations, selectValueProposal } from './userValueTracker'
import type { UserValue } from '../types'

const NOW = 1_750_000_000_000

function makeValue(over: Partial<UserValue>): UserValue {
  return {
    id: 'v1', name: 'being there for the girls', description: 'presence over provision',
    status: 'candidate', evidence: [{ sessionId: 's0', quote: 'what matters is being there', observedAt: NOW - 1 }],
    sessionsSeen: 1, dismissedCount: 0, lastActiveAt: NOW - 1, createdAt: NOW - 1, updatedAt: NOW - 1,
    ...over,
  }
}

describe('applyValueObservations', () => {
  it('matches by id, bumps sessionsSeen per distinct session, creates candidates', () => {
    const { updates, creates } = applyValueObservations(
      [makeValue({})],
      [
        { valueId: 'v1', quote: 'the girls come first, always' },
        { tentativeName: 'honest work', description: 'work that means something', quote: 'I cannot do meaningless work' },
      ],
      'sess-2', NOW,
    )
    expect(updates[0].sessionsSeen).toBe(2)
    expect(creates[0]).toMatchObject({ name: 'honest work', status: 'candidate' })
  })

  it('never touches retired values; drops malformed; respects candidate cap (4)', () => {
    const four = Array.from({ length: 4 }, (_, i) => makeValue({ id: `c${i}` }))
    const { creates } = applyValueObservations(four, [{ tentativeName: 'fifth', description: 'd', quote: 'q' }], 's', NOW)
    expect(creates).toHaveLength(0)

    const { updates } = applyValueObservations(
      [makeValue({ status: 'retired' })],
      [{ valueId: 'v1', quote: 'q' }, 42, { nonsense: true }] as never,
      's', NOW,
    )
    expect(updates).toHaveLength(0)
  })
})

describe('selectValueProposal', () => {
  it('same eligibility grammar as parts (seen >= 2, no dismissals, retry window)', () => {
    expect(selectValueProposal([makeValue({ sessionsSeen: 2 })], NOW)?.id).toBe('v1')
    expect(selectValueProposal([makeValue({ sessionsSeen: 1 })], NOW)).toBeNull()
    expect(selectValueProposal([makeValue({ sessionsSeen: 3, dismissedCount: 1 })], NOW)).toBeNull()
    expect(selectValueProposal([makeValue({ sessionsSeen: 3, proposedAt: NOW - 1000 })], NOW)).toBeNull()
  })
})
