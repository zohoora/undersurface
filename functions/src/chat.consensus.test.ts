// The crisis_check route asks the classifier three times at once and answers
// with the majority as one ordinary completion (folio-build-plan §8.G), so the
// browser's parser is unchanged.

import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('firebase-admin/app', () => ({ initializeApp: vi.fn() }))
vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({
    collection: () => ({ doc: () => ({ get: async () => ({ get: () => undefined }) }) }),
  }),
}))
vi.mock('firebase-functions/params', () => ({
  defineSecret: vi.fn(() => ({ value: () => 'test-secret-key' })),
}))
vi.mock('firebase-functions/v2/https', () => ({
  onRequest: (_opts: unknown, handler: unknown) => handler,
}))
vi.mock('./shared/auth.js', () => ({
  verifyAuthWithRole: vi.fn(async (header: string) => ({ uid: header.slice('Bearer '.length), role: 'standard' })),
}))

const { chat } = await import('./chat')
const handler = chat as unknown as (req: unknown, res: unknown) => Promise<void>

function makeRes() {
  return {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) { this.statusCode = code; return this },
    json(payload: unknown) { this.body = payload; return this },
    setHeader: vi.fn(),
    write: vi.fn(),
    end: vi.fn(),
  }
}

const completion = (content: string) => ({
  ok: true,
  status: 200,
  json: async () => ({ choices: [{ message: { content } }] }),
})

let uidCounter = 0
async function check() {
  const res = makeRes()
  await handler({
    method: 'POST',
    headers: { authorization: `Bearer consensus-${uidCounter++}` },
    body: { task: 'crisis_check', messages: [{ role: 'system', content: 's' }, { role: 'user', content: 'hi' }] },
  }, res)
  return res
}

function contentOf(res: ReturnType<typeof makeRes>) {
  const body = res.body as { choices: Array<{ message: { content: string } }> }
  return JSON.parse(body.choices[0].message.content) as { risk: number; reason?: string }
}

afterEach(() => { vi.unstubAllGlobals() })

describe('chat — crisis_check consensus', () => {
  it('asks three times with the calibrated contract and answers with the majority', async () => {
    const replies = ['{"risk":0,"reason":"calm"}', '{"risk":2,"reason":"plan"}', '{"risk":2,"reason":"plan again"}']
    const fetchMock = vi.fn(async () => completion(replies.shift()!))
    vi.stubGlobal('fetch', fetchMock)

    const res = await check()

    expect(res.statusCode).toBe(200)
    expect(contentOf(res)).toEqual({ risk: 2, reason: 'plan' })
    expect(fetchMock).toHaveBeenCalledTimes(3)
    for (const call of fetchMock.mock.calls as unknown as Array<[string, RequestInit]>) {
      const body = JSON.parse(String(call[1].body))
      expect(body.model).toBe('gpt-5-nano')
      expect(body.reasoning_effort).toBe('minimal')
      expect(body.stream).toBe(false)
      expect(body.response_format.json_schema.name).toBe('crisis_risk')
      expect(body.messages).toEqual([{ role: 'system', content: 's' }, { role: 'user', content: 'hi' }])
    }
  })

  it('answers once two votes agree, without waiting for the third', async () => {
    let third: AbortSignal | undefined
    let n = 0
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => {
      n += 1
      if (n === 3) {
        third = init.signal ?? undefined
        return new Promise(() => {})
      }
      return Promise.resolve(completion('{"risk":1,"reason":"coded"}'))
    }))

    const res = await check()

    expect(contentOf(res).risk).toBe(1)
    expect(third?.aborted).toBe(true)
  })

  it('answers the higher vote when one call failed and the others disagree', async () => {
    const replies = [
      completion('{"risk":0,"reason":"a"}'),
      { ok: false, status: 500, json: async () => ({}) },
      completion('{"risk":2,"reason":"b"}'),
    ]
    vi.stubGlobal('fetch', vi.fn(async () => replies.shift()))

    expect(contentOf(await check()).risk).toBe(2)
  })

  it('fails with the upstream status when every call fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) })))
    const res = await check()
    expect(res.statusCode).toBe(503)
    expect(res.body).toMatchObject({ error: 'AI service temporarily unavailable' })
  })

  it('fails with 502 when every answer is malformed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => completion('not json')))
    const res = await check()
    expect(res.statusCode).toBe(502)
  })
})
