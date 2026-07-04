import { describe, it, expect } from 'vitest'
import { applyPartObservations, selectProposalCandidate, mergeLexicon } from './userPartTracker'
import type { UserPart } from '../types'

const NOW = 1_750_000_000_000
const DAY = 86_400_000

function makePart(over: Partial<UserPart>): UserPart {
  return {
    id: 'p1',
    name: 'the part that braces',
    description: 'braces before good news',
    stance: 'protective',
    status: 'candidate',
    evidence: [{ sessionId: 's0', quote: 'here we go again', observedAt: NOW - DAY }],
    sessionsSeen: 1,
    dismissedCount: 0,
    lastActiveAt: NOW - DAY,
    createdAt: NOW - DAY,
    updatedAt: NOW - DAY,
    ...over,
  }
}

describe('applyPartObservations', () => {
  it('matches an existing part by id: appends evidence, bumps sessionsSeen, updates stance', () => {
    const existing = [makePart({})]
    const { updates, creates } = applyPartObservations(
      existing,
      [{ partId: 'p1', quote: 'I felt myself brace when he called', stance: 'protective — softening lately' }],
      'sess-2',
      NOW,
    )

    expect(creates).toHaveLength(0)
    expect(updates).toHaveLength(1)
    expect(updates[0].sessionsSeen).toBe(2)
    expect(updates[0].evidence).toHaveLength(2)
    expect(updates[0].stance).toBe('protective — softening lately')
    expect(updates[0].lastActiveAt).toBe(NOW)
  })

  it('does NOT bump sessionsSeen twice for the same session', () => {
    const existing = [makePart({ evidence: [{ sessionId: 'sess-2', quote: 'earlier', observedAt: NOW - 1 }] })]
    const { updates } = applyPartObservations(
      existing,
      [{ partId: 'p1', quote: 'again in the same session', stance: 'protective' }],
      'sess-2',
      NOW,
    )
    expect(updates[0].sessionsSeen).toBe(1) // unchanged — same session
    expect(updates[0].evidence).toHaveLength(2) // evidence still appended
  })

  it('caps evidence at 8, keeping the newest', () => {
    const evidence = Array.from({ length: 8 }, (_, i) => ({ sessionId: `s${i}`, quote: `q${i}`, observedAt: NOW - (10 - i) }))
    const existing = [makePart({ evidence })]
    const { updates } = applyPartObservations(
      existing,
      [{ partId: 'p1', quote: 'the ninth', stance: 'protective' }],
      'sess-9',
      NOW,
    )
    expect(updates[0].evidence).toHaveLength(8)
    expect(updates[0].evidence.at(-1)!.quote).toBe('the ninth')
    expect(updates[0].evidence[0].quote).toBe('q1') // oldest dropped
  })

  it('creates a new candidate from a tentativeName observation', () => {
    const { creates } = applyPartObservations(
      [],
      [{ tentativeName: 'the list-maker', description: 'turns feelings into tasks', stance: 'managerial', quote: 'I just made another list instead' }],
      'sess-3',
      NOW,
    )
    expect(creates).toHaveLength(1)
    expect(creates[0]).toMatchObject({
      name: 'the list-maker',
      status: 'candidate',
      sessionsSeen: 1,
      dismissedCount: 0,
    })
    expect(creates[0].evidence[0].quote).toBe('I just made another list instead')
  })

  it('never resurrects or updates a retired part', () => {
    const existing = [makePart({ status: 'retired' })]
    const { updates, creates } = applyPartObservations(
      existing,
      [{ partId: 'p1', quote: 'still here', stance: 'protective' }],
      'sess-4',
      NOW,
    )
    expect(updates).toHaveLength(0)
    expect(creates).toHaveLength(0)
  })

  it('drops new candidates when the candidate cap (5) is full', () => {
    const existing = Array.from({ length: 5 }, (_, i) => makePart({ id: `c${i}` }))
    const { creates } = applyPartObservations(
      existing,
      [{ tentativeName: 'the sixth', description: 'd', stance: 's', quote: 'q' }],
      'sess-5',
      NOW,
    )
    expect(creates).toHaveLength(0)
  })

  it('drops malformed observations silently and truncates oversized quotes', () => {
    const { updates, creates } = applyPartObservations(
      [makePart({})],
      [
        { nonsense: true },
        42,
        { partId: 'does-not-exist', quote: 'q', stance: 's' },
        { partId: 'p1', quote: 'w '.repeat(60), stance: 's' },
      ] as never,
      'sess-6',
      NOW,
    )
    expect(creates).toHaveLength(0)
    expect(updates).toHaveLength(1)
    // 15-word cap on quotes
    expect(updates[0].evidence.at(-1)!.quote.split(/\s+/).length).toBeLessThanOrEqual(15)
  })

  it('accepts at most 2 observations per session (precision cap)', () => {
    const { creates } = applyPartObservations(
      [],
      [
        { tentativeName: 'a', description: 'd', stance: 's', quote: 'q1' },
        { tentativeName: 'b', description: 'd', stance: 's', quote: 'q2' },
        { tentativeName: 'c', description: 'd', stance: 's', quote: 'q3' },
      ],
      'sess-7',
      NOW,
    )
    expect(creates).toHaveLength(2)
  })
})

describe('selectProposalCandidate', () => {
  it('selects a candidate with sessionsSeen >= 2, no dismissals, never proposed', () => {
    const parts = [makePart({ sessionsSeen: 2 })]
    expect(selectProposalCandidate(parts, NOW)?.id).toBe('p1')
  })

  it('skips below-threshold, dismissed, recently-proposed, and non-candidate parts', () => {
    expect(selectProposalCandidate([makePart({ sessionsSeen: 1 })], NOW)).toBeNull()
    expect(selectProposalCandidate([makePart({ sessionsSeen: 3, dismissedCount: 1 })], NOW)).toBeNull()
    expect(selectProposalCandidate([makePart({ sessionsSeen: 3, proposedAt: NOW - DAY })], NOW)).toBeNull()
    expect(selectProposalCandidate([makePart({ sessionsSeen: 3, status: 'active' })], NOW)).toBeNull()
  })

  it('re-arms a proposal older than 7 days (model may have ignored the marker)', () => {
    const parts = [makePart({ sessionsSeen: 3, proposedAt: NOW - 8 * DAY })]
    expect(selectProposalCandidate(parts, NOW)?.id).toBe('p1')
  })

  it('prefers the most-seen candidate when several are eligible', () => {
    const parts = [
      makePart({ id: 'a', sessionsSeen: 2 }),
      makePart({ id: 'b', sessionsSeen: 4 }),
    ]
    expect(selectProposalCandidate(parts, NOW)?.id).toBe('b')
  })
})

describe('mergeLexicon', () => {
  it('appends new phrases, reinforces existing ones to the end, caps at 12', () => {
    const existing = Array.from({ length: 12 }, (_, i) => `phrase-${i}`)
    const merged = mergeLexicon(existing, ['the basement', 'phrase-3'])
    expect(merged).toHaveLength(12)
    expect(merged!.at(-1)).toBe('phrase-3')       // reinforced → moved to end
    expect(merged!.at(-2)).toBe('the basement')   // new → appended
    expect(merged).not.toContain('phrase-0')      // oldest dropped
    expect(merged!.filter(p => p === 'phrase-3')).toHaveLength(1) // no dupes
  })

  it('returns null for malformed/empty input and filters oversized phrases', () => {
    expect(mergeLexicon(['a'], 'not-an-array')).toBeNull()
    expect(mergeLexicon(['a'], [])).toBeNull()
    expect(mergeLexicon(['a'], [42, '', 'x'.repeat(41)])).toBeNull()
  })

  it('takes at most 3 phrases per session', () => {
    const merged = mergeLexicon([], ['a', 'b', 'c', 'd'])
    expect(merged).toEqual(['a', 'b', 'c'])
  })
})
