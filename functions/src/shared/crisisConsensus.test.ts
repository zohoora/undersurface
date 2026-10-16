import { describe, expect, it, vi } from 'vitest'
import {
  CRISIS_VOTES,
  classifyByConsensus,
  crisisMajority,
  parseCrisisVote,
  settleCrisisVotes,
} from './crisisClassifier'
import type { CrisisVote } from './crisisClassifier'

// The three-vote consensus every crisis channel uses (folio-build-plan §8.G):
// majority, else the middle of three, else the higher of two, else the one.

const v = (risk: 0 | 1 | 2): CrisisVote => ({ risk, reason: `r${risk}` })
const risks = (vote: CrisisVote | null) => vote?.risk ?? null

/** A call that resolves when the test says so, and records its abort. */
function deferredCall() {
  let resolve!: (vote: CrisisVote | null) => void
  let reject!: (error: unknown) => void
  let signal!: AbortSignal
  const promise = new Promise<CrisisVote | null>((res, rej) => { resolve = res; reject = rej })
  return {
    ask: (s: AbortSignal) => { signal = s; return promise },
    resolve,
    reject,
    get aborted() { return signal?.aborted ?? false },
  }
}

describe('settleCrisisVotes', () => {
  it.each([
    [[], null],
    [[2], 2],
    [[0], 0],
    [[0, 2], 2],
    [[0, 1], 1],
    [[1, 2], 2],
    [[2, 0], 2],
    [[0, 1, 2], 1],
    [[2, 1, 0], 1],
    [[2, 0, 2], 2],
    [[0, 0, 2], 0],
    [[1, 1, 1], 1],
  ] as Array<[Array<0 | 1 | 2>, 0 | 1 | 2 | null]>)('%j → %s', (votes, expected) => {
    expect(risks(settleCrisisVotes(votes.map(v)))).toBe(expected)
  })

  it('keeps the reason of a vote that decided', () => {
    expect(settleCrisisVotes([v(0), v(2)])).toEqual({ risk: 2, reason: 'r2' })
  })
})

describe('crisisMajority', () => {
  it('needs two agreeing votes', () => {
    expect(crisisMajority([v(2)])).toBeNull()
    expect(crisisMajority([v(0), v(2)])).toBeNull()
    expect(risks(crisisMajority([v(0), v(2), v(2)]))).toBe(2)
  })
})

describe('parseCrisisVote', () => {
  it('reads a valid vote and rejects anything else', () => {
    expect(parseCrisisVote('{"risk":2,"reason":"plan"}')).toEqual({ risk: 2, reason: 'plan' })
    expect(parseCrisisVote('{"risk":0}')).toEqual({ risk: 0 })
    expect(parseCrisisVote('{"risk":7}')).toBeNull()
    expect(parseCrisisVote('{"risk":"2"}')).toBeNull()
    expect(parseCrisisVote('nope')).toBeNull()
    expect(parseCrisisVote(undefined)).toBeNull()
  })
})

describe('classifyByConsensus', () => {
  it('asks three times at once', async () => {
    const ask = vi.fn(async () => v(0))
    await classifyByConsensus(ask)
    expect(CRISIS_VOTES).toBe(3)
    expect(ask).toHaveBeenCalledTimes(3)
  })

  it('answers as soon as two votes agree and cancels the third call', async () => {
    const calls = [deferredCall(), deferredCall(), deferredCall()]
    let i = 0
    const result = classifyByConsensus((s) => calls[i++].ask(s))
    calls[0].resolve(v(2))
    calls[1].resolve(v(2))
    expect(risks(await result)).toBe(2)
    expect(calls[2].aborted).toBe(true)
  })

  it('waits for the third vote when the first two disagree', async () => {
    const calls = [deferredCall(), deferredCall(), deferredCall()]
    let i = 0
    let decided = false
    const result = classifyByConsensus((s) => calls[i++].ask(s)).then((r) => { decided = true; return r })
    calls[0].resolve(v(0))
    calls[1].resolve(v(2))
    await Promise.resolve()
    expect(decided).toBe(false)
    calls[2].resolve(v(0))
    expect(risks(await result)).toBe(0)
  })

  it('takes the middle of three different votes', async () => {
    const queue = [v(2), v(0), v(1)]
    expect(risks(await classifyByConsensus(async () => queue.shift() ?? null))).toBe(1)
  })

  it('takes the higher vote when one call failed and the others disagree', async () => {
    const queue = [v(0), null, v(2)]
    expect(risks(await classifyByConsensus(async () => queue.shift() ?? null))).toBe(2)
  })

  it('counts a rejected or throwing call as a failure', async () => {
    let n = 0
    const result = await classifyByConsensus(async () => {
      n += 1
      if (n === 1) throw new Error('network')
      return n === 2 ? v(1) : v(0)
    })
    expect(risks(result)).toBe(1)
    const sync = await classifyByConsensus(() => { throw new Error('sync') })
    expect(sync).toBeNull()
  })

  it('is null when every call fails', async () => {
    expect(await classifyByConsensus(async () => null)).toBeNull()
  })

  it('settles with the votes in hand at the deadline and cancels the rest', async () => {
    vi.useFakeTimers()
    try {
      const calls = [deferredCall(), deferredCall(), deferredCall()]
      let i = 0
      const result = classifyByConsensus((s) => calls[i++].ask(s), { deadlineMs: 4000 })
      calls[0].resolve(v(2))
      await vi.advanceTimersByTimeAsync(4000)
      expect(risks(await result)).toBe(2)
      expect(calls[1].aborted).toBe(true)
      expect(calls[2].aborted).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('is null at the deadline with no votes', async () => {
    vi.useFakeTimers()
    try {
      const result = classifyByConsensus(() => new Promise<CrisisVote | null>(() => {}), { deadlineMs: 100 })
      await vi.advanceTimersByTimeAsync(100)
      expect(await result).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('stops when the caller goes away', async () => {
    const parent = new AbortController()
    const calls = [deferredCall(), deferredCall(), deferredCall()]
    let i = 0
    const result = classifyByConsensus((s) => calls[i++].ask(s), { signal: parent.signal })
    parent.abort()
    expect(await result).toBeNull()
    expect(calls.every((c) => c.aborted)).toBe(true)
  })

  it('ignores votes that arrive after the decision', async () => {
    const calls = [deferredCall(), deferredCall(), deferredCall()]
    let i = 0
    const result = classifyByConsensus((s) => calls[i++].ask(s))
    calls[0].resolve(v(0))
    calls[1].resolve(v(0))
    expect(risks(await result)).toBe(0)
    calls[2].resolve(v(2))
    calls[2].reject(new Error('late'))
    expect(risks(await result)).toBe(0)
  })
})
