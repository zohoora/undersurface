// Handler-level tests for realtimeTokenApi cost controls (TECH_ISSUES_2026-10-14
// #17): server-side flag enforcement, the durable daily mint budget in
// quotas/{uid}, and upstream failures mapped to 502 with a refund.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Doc = Record<string, unknown>

let appConfig: Doc | null
let quotaDocs: Map<string, Doc>
let configReadFails: boolean

function isPlainObject(value: unknown): value is Doc {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function deepMerge(target: Doc, patch: Doc): Doc {
  const out: Doc = { ...target }
  for (const [key, value] of Object.entries(patch)) {
    out[key] = isPlainObject(value) && isPlainObject(out[key])
      ? deepMerge(out[key] as Doc, value)
      : value
  }
  return out
}

function quotaRef(uid: string) {
  return { kind: 'quota' as const, uid }
}

const firestore = {
  collection: (name: string) => ({
    doc: (id: string) => {
      if (name === 'appConfig' && id === 'global') {
        return {
          get: async () => {
            if (configReadFails) throw new Error('unavailable')
            return {
              exists: appConfig !== null,
              get: (field: string) => appConfig?.[field],
            }
          },
        }
      }
      if (name === 'quotas') return quotaRef(id)
      throw new Error(`unexpected doc ${name}/${id}`)
    },
  }),
  runTransaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
    const tx = {
      get: async (ref: { uid: string }) => {
        const data = quotaDocs.get(ref.uid)
        return { exists: !!data, data: () => data }
      },
      set: (ref: { uid: string }, value: Doc, options?: { merge?: boolean }) => {
        const existing = quotaDocs.get(ref.uid) ?? {}
        quotaDocs.set(ref.uid, options?.merge ? deepMerge(existing, value) : value)
      },
    }
    return fn(tx)
  },
}

vi.mock('firebase-admin/app', () => ({ initializeApp: vi.fn() }))
vi.mock('firebase-admin/firestore', () => ({ getFirestore: () => firestore }))
vi.mock('firebase-functions/params', () => ({
  defineSecret: vi.fn(() => ({ value: () => 'test-secret-key' })),
}))
vi.mock('firebase-functions/v2/https', () => ({
  onRequest: (_opts: unknown, handler: unknown) => handler,
}))
vi.mock('./shared/auth.js', () => ({
  verifyAuth: vi.fn(async (header: string | undefined) => header?.replace('Bearer ', '') || null),
}))

const { realtimeTokenApi, VOICE_MINTS_PER_DAY } = await import('./realtime')
const { resetFeatureFlagsCacheForTests } = await import('./shared/featureFlags')
const handler = realtimeTokenApi as unknown as (req: unknown, res: unknown) => Promise<void>

interface MockRes {
  statusCode: number
  body: unknown
  status: (code: number) => MockRes
  json: (body: unknown) => MockRes
}

function makeRes(): MockRes {
  const res: MockRes = {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this },
    json(body) { this.body = body; return this },
  }
  return res
}

async function mint(uid: string, body: unknown = { instructions: 'Be gentle.', voice: 'marin' }) {
  const res = makeRes()
  await handler({ method: 'POST', headers: { authorization: `Bearer ${uid}` }, body }, res)
  return res
}

function stubOpenAi(ok = true, status = 200) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok,
    status,
    json: async () => ({ value: 'ek_test', expires_at: 123 }),
    text: async () => '',
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

beforeEach(() => {
  appConfig = { features: { voiceEnabled: true } }
  quotaDocs = new Map()
  configReadFails = false
  resetFeatureFlagsCacheForTests()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('realtimeTokenApi — feature flags', () => {
  it('mints when voiceEnabled is on', async () => {
    const fetchMock = stubOpenAi()
    const res = await mint('flags-voice')
    expect(res.statusCode).toBe(200)
    expect(res.body).toMatchObject({ clientSecret: 'ek_test' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('mints for Room when only the legacy relax flag makes Room effective', async () => {
    appConfig = { features: { relaxEnabled: true } }
    stubOpenAi()
    expect((await mint('flags-room-legacy')).statusCode).toBe(200)
  })

  it('rejects with 403 voice_disabled when neither Speak nor Room is on, without calling OpenAI', async () => {
    appConfig = { features: { voiceEnabled: false, roomEnabled: false, relaxEnabled: true } }
    const fetchMock = stubOpenAi()
    const res = await mint('flags-off')
    expect(res.statusCode).toBe(403)
    expect(res.body).toMatchObject({ code: 'voice_disabled' })
    expect(fetchMock).not.toHaveBeenCalled()
    // A rejected request costs no budget.
    expect(quotaDocs.has('flags-off')).toBe(false)
  })

  it('rejects when the config doc is missing (experimental flags default off)', async () => {
    appConfig = null
    stubOpenAi()
    expect((await mint('flags-missing')).statusCode).toBe(403)
  })

  it('fails closed with 503 when the config cannot be read', async () => {
    configReadFails = true
    const fetchMock = stubOpenAi()
    const res = await mint('flags-error')
    expect(res.statusCode).toBe(503)
    expect(res.body).toMatchObject({ code: 'voice_config_unavailable' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('realtimeTokenApi — daily mint budget', () => {
  it('records mints durably in quotas/{uid}.daily.voiceMints', async () => {
    stubOpenAi()
    await mint('budget-count')
    await mint('budget-count')
    const doc = quotaDocs.get('budget-count') as { daily: { voiceMints: { day: string; count: number } } }
    expect(doc.daily.voiceMints.count).toBe(2)
    expect(doc.daily.voiceMints.day).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('returns 429 voice_daily_budget_exceeded once the day is spent', async () => {
    const today = new Date().toISOString().slice(0, 10)
    quotaDocs.set('budget-full', {
      period: '2026-10',
      tokensUsed: 1234,
      daily: { voiceMints: { day: today, count: VOICE_MINTS_PER_DAY } },
    })
    const fetchMock = stubOpenAi()
    const res = await mint('budget-full')
    expect(res.statusCode).toBe(429)
    expect(res.body).toMatchObject({ code: 'voice_daily_budget_exceeded' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('starts fresh on a new UTC day and preserves the monthly token fields', async () => {
    quotaDocs.set('budget-yesterday', {
      period: '2026-10',
      tokensUsed: 1234,
      daily: { voiceMints: { day: '2000-01-01', count: VOICE_MINTS_PER_DAY } },
    })
    stubOpenAi()
    expect((await mint('budget-yesterday')).statusCode).toBe(200)
    expect(quotaDocs.get('budget-yesterday')).toMatchObject({ tokensUsed: 1234, daily: { voiceMints: { count: 1 } } })
  })

  it('does not consume budget for invalid instructions', async () => {
    stubOpenAi()
    const res = await mint('budget-invalid', { instructions: '' })
    expect(res.statusCode).toBe(400)
    expect(res.body).toMatchObject({ code: 'invalid_instructions' })
    expect(quotaDocs.has('budget-invalid')).toBe(false)
  })
})

describe('realtimeTokenApi — upstream failures', () => {
  it('maps an upstream 429 to 502 voice_upstream_error and refunds the mint', async () => {
    stubOpenAi(false, 429)
    const res = await mint('upstream-429')
    expect(res.statusCode).toBe(502)
    expect(res.body).toMatchObject({ code: 'voice_upstream_error' })
    await vi.waitFor(() => {
      const doc = quotaDocs.get('upstream-429') as { daily: { voiceMints: { count: number } } }
      expect(doc.daily.voiceMints.count).toBe(0)
    })
  })

  it('maps a network failure to 502', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNRESET')))
    const res = await mint('upstream-network')
    expect(res.statusCode).toBe(502)
  })
})
