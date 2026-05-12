// Locks in the cross-user aggregation behavior of computeAndCacheAnalytics
// after the parallelization refactor. The risk this catches: an off-by-one in
// the per-user fan-out → merge step would produce wrong totals on the admin
// dashboard, silently. The auth/dispatch path is exercised in index.test.ts.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('firebase-admin/app', () => ({ initializeApp: vi.fn() }))

interface FakeUser {
  uid: string
  createdAt: number
  collections: Record<string, Array<Record<string, unknown>>>
}

let fakeUsers: FakeUser[]
let writtenResult: Record<string, unknown> | null

function snap(docs: Array<Record<string, unknown>>) {
  return {
    docs: docs.map(d => ({ data: () => d })),
    size: docs.length,
  }
}

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({
    collection: (name: string) => {
      if (name === 'appConfig') {
        return {
          doc: () => ({
            get: async () => ({ exists: false, data: () => null }),
            set: async (data: Record<string, unknown>) => { writtenResult = data },
          }),
        }
      }
      // users collection — chain users.doc(uid).collection(sub).get()
      return {
        doc: (uid: string) => ({
          id: uid,
          collection: (sub: string) => {
            const docs = () =>
              fakeUsers.find(u => u.uid === uid)?.collections[sub] ?? []
            const baseQuery = {
              where: () => ({
                get: async () => snap(docs()),
              }),
              get: async () => snap(docs()),
              count: () => ({ get: async () => ({ data: () => ({ count: docs().length }) }) }),
            }
            return baseQuery
          },
        }),
      }
    },
  }),
}))

vi.mock('firebase-admin/auth', () => ({
  getAuth: () => ({
    listUsers: async () => ({
      users: fakeUsers.map(u => ({
        uid: u.uid,
        email: `${u.uid}@example.com`,
        metadata: { creationTime: new Date(u.createdAt).toISOString() },
      })),
      pageToken: undefined,
    }),
  }),
}))

const { computeAndCacheAnalytics } = await import('./analytics')

const NOW = Date.parse('2026-05-12T12:00:00Z')

function user(uid: string, collections: Partial<FakeUser['collections']> = {}, createdAtOffsetDays = 30): FakeUser {
  return {
    uid,
    createdAt: NOW - createdAtOffsetDays * 86_400_000,
    collections: collections as FakeUser['collections'],
  }
}

beforeEach(() => {
  vi.useFakeTimers().setSystemTime(NOW)
  writtenResult = null
})

describe('computeAndCacheAnalytics — cross-user aggregation', () => {
  it('sums entry/word/thought counts across users and writes one analytics doc', async () => {
    fakeUsers = [
      user('alice', {
        entries: [
          { plainText: 'one two three', updatedAt: NOW - 1000, createdAt: NOW - 1000 },
          { plainText: 'four five', updatedAt: NOW - 1000, createdAt: NOW - 1000, intention: 'reflect' },
        ],
        thoughts: [{ partId: 'p1' }, { partId: 'p1' }],
        parts: [{ id: 'p1', name: 'Watcher', color: '#abc' }],
        interactions: [],
        sessionLog: [],
        innerWeather: [],
        userProfile: [],
        letters: [],
        fossils: [],
        sessions: [],
      }),
      user('bob', {
        entries: [{ plainText: 'six seven eight nine', updatedAt: NOW - 1000, createdAt: NOW - 1000 }],
        thoughts: [{ partId: 'p1' }],
        parts: [{ id: 'p1', name: 'Watcher', color: '#abc' }],
        interactions: [{}, {}],
        sessionLog: [{ duration: 60_000, startedAt: NOW - 1000 }],
        innerWeather: [{ dominantEmotion: 'calm', intensity: 0.5 }],
        userProfile: [{ id: 'profile' }],
        letters: [],
        fossils: [],
        sessions: [{ startedAt: NOW - 1000 }],
      }),
    ]

    const result = await computeAndCacheAnalytics()

    expect(result.userCount).toBe(2)
    expect(result.totalEntries).toBe(3)
    expect(result.totalWords).toBe(9)
    expect(result.totalThoughts).toBe(3)
    expect(result.totalInteractions).toBe(2)
    expect(result.totalConversations).toBe(1)
    expect(result.featureAdoption.profileAdoptionPercent).toBe(50)
    expect(result.featureAdoption.intentionUsagePercent).toBe(50)
    expect(result.activeUsers.daily).toBe(2)
    expect(result.partUsage).toEqual([{ name: 'Watcher', color: '#abc', count: 3 }])
    expect(writtenResult).not.toBeNull()
  })

  it('marks users inactive past the monthly window', async () => {
    fakeUsers = [
      user('stale', { entries: [{ updatedAt: NOW - 31 * 86_400_000, plainText: '' }] }, 60),
      user('recent', { entries: [{ updatedAt: NOW - 1000, plainText: '' }] }, 60),
    ]
    const result = await computeAndCacheAnalytics()
    expect(result.activeUsers.daily).toBe(1)
    expect(result.activeUsers.monthly).toBe(1)
  })

  it('respects bounded concurrency (no failure on > USER_CONCURRENCY users)', async () => {
    // Beyond the batch size of 10. Tests that the chunking loop doesn't drop users.
    fakeUsers = Array.from({ length: 23 }, (_, i) =>
      user(`u${i}`, { entries: [{ plainText: 'word', updatedAt: NOW, createdAt: NOW }] }),
    )
    const result = await computeAndCacheAnalytics()
    expect(result.userCount).toBe(23)
    expect(result.totalEntries).toBe(23)
  })

  it('topEmotions caps at 5 and ranks by count', async () => {
    fakeUsers = Array.from({ length: 7 }, (_, i) =>
      user(`u${i}`, {
        innerWeather: [
          { dominantEmotion: ['joy', 'fear', 'sad', 'anger', 'calm', 'rare1', 'rare2'][i], intensity: 0.5 },
        ],
      }),
    )
    // Add extra joy occurrences so it's the leader
    fakeUsers[0].collections.innerWeather!.push({ dominantEmotion: 'joy', intensity: 0.5 })
    fakeUsers[0].collections.innerWeather!.push({ dominantEmotion: 'joy', intensity: 0.5 })

    const result = await computeAndCacheAnalytics()
    expect(result.emotionalLandscape.topEmotions.length).toBeLessThanOrEqual(5)
    expect(result.emotionalLandscape.topEmotions[0].emotion).toBe('joy')
  })

  it('returns zeroed averages when no users exist', async () => {
    fakeUsers = []
    const result = await computeAndCacheAnalytics()
    expect(result.userCount).toBe(0)
    expect(result.averageWordsPerEntry).toBe(0)
    expect(result.averageEntriesPerUser).toBe(0)
    expect(result.featureAdoption.profileAdoptionPercent).toBe(0)
  })
})
