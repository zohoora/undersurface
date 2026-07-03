import { describe, it, expect, vi, beforeEach } from 'vitest'

interface Doc { id: string }

// Mutable state the mocked db reads from; reset per test.
const state: {
  thoughts: Doc[]
  weather: Doc[]
  countThrows: boolean
  deleted: string[]
} = { thoughts: [], weather: [], countThrows: false, deleted: [] }

function makeProxy(get: () => Doc[]) {
  return {
    count: async () => {
      if (state.countThrows) throw new Error('offline')
      return get().length
    },
    orderBy: () => ({
      limit: (n: number) => ({
        // ascending → oldest first; arrays are seeded oldest→newest
        toArray: async () => get().slice(0, n),
      }),
    }),
    delete: async (id: string) => {
      state.deleted.push(id)
      const arr = get()
      const i = arr.findIndex(d => d.id === id)
      if (i >= 0) arr.splice(i, 1)
    },
  }
}

vi.mock('../store/db', () => ({
  db: {
    thoughts: makeProxy(() => state.thoughts),
    innerWeather: makeProxy(() => state.weather),
  },
}))

const { pruneGrowthCollections } = await import('./memoryPruner')

beforeEach(() => {
  state.thoughts = []
  state.weather = []
  state.countThrows = false
  state.deleted = []
})

describe('pruneGrowthCollections', () => {
  it('deletes the oldest excess beyond the keep threshold', async () => {
    // 700 thoughts, keep 500 → delete oldest 200.
    state.thoughts = Array.from({ length: 700 }, (_, i) => ({ id: `t${i}` }))

    const result = await pruneGrowthCollections()

    expect(result.thoughts).toBe(200)
    expect(state.deleted).toContain('t0') // oldest removed
    expect(state.deleted).not.toContain('t699') // newest kept
    expect(state.thoughts).toHaveLength(500)
  })

  it('is a no-op when under the keep threshold', async () => {
    state.thoughts = Array.from({ length: 100 }, (_, i) => ({ id: `t${i}` }))

    const result = await pruneGrowthCollections()

    expect(result.thoughts).toBe(0)
    expect(state.deleted).toHaveLength(0)
  })

  it('skips pruning when count() throws (e.g. offline)', async () => {
    state.thoughts = Array.from({ length: 700 }, (_, i) => ({ id: `t${i}` }))
    state.countThrows = true

    const result = await pruneGrowthCollections()

    expect(result.thoughts).toBe(0)
    expect(state.deleted).toHaveLength(0)
  })

  it('caps deletions to the batch limit in a single run', async () => {
    // 1000 thoughts, keep 500 → excess 500, but batch limit is 200.
    state.thoughts = Array.from({ length: 1000 }, (_, i) => ({ id: `t${i}` }))

    const result = await pruneGrowthCollections()

    expect(result.thoughts).toBe(200)
    expect(state.thoughts).toHaveLength(800)
  })
})
