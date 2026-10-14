// Regression for TECH_ISSUES_2026-10-14 #16: a streamed turn must settle its
// quota reservation with the real usage from the include_usage frame instead
// of being charged the whole max_tokens reservation, and prompt tokens must be
// metered.

import { afterEach, describe, expect, it, vi } from 'vitest'

const checkAndReserve = vi.fn()
const reconcile = vi.fn()

vi.mock('firebase-admin/app', () => ({ initializeApp: vi.fn() }))
vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({
    collection: () => ({
      doc: () => ({
        get: async () => ({
          get: (field: string) => (field === 'quota' ? { enabled: true, monthlyTokenCap: 100_000 } : undefined),
        }),
      }),
    }),
  }),
}))
vi.mock('firebase-functions/params', () => ({
  defineSecret: vi.fn(() => ({ value: () => 'test-secret-key' })),
}))
vi.mock('firebase-functions/v2/https', () => ({
  onRequest: (_opts: unknown, handler: unknown) => handler,
}))
vi.mock('./shared/auth.js', () => ({
  verifyAuthWithRole: vi.fn(async () => ({ uid: 'quota-user-123456', role: 'standard' })),
}))
vi.mock('./shared/quota.js', () => ({
  checkAndReserve: (...args: unknown[]) => checkAndReserve(...args),
  reconcile: (...args: unknown[]) => reconcile(...args),
}))

const { chat } = await import('./chat')
const handler = chat as unknown as (req: unknown, res: unknown) => Promise<void>

function makeRes() {
  return {
    statusCode: 200,
    writableEnded: false,
    status(code: number) { this.statusCode = code; return this },
    json: vi.fn(),
    setHeader: vi.fn(),
    write: vi.fn(),
    end: vi.fn(function (this: { writableEnded: boolean }) { this.writableEnded = true }),
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  checkAndReserve.mockReset()
  reconcile.mockReset()
})

describe('chat quota settlement', () => {
  it('settles a streamed turn with the reported completion and prompt tokens', async () => {
    checkAndReserve.mockResolvedValue({ allowed: true, used: 0, cap: 100_000, reserved: 4000 })
    const encoder = new TextEncoder()
    const chunks = [
      'data: {"choices":[{"delta":{"content":"Hello"},"finish_reason":null}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
      'data: {"choices":[],"usage":{"prompt_tokens":9100,"completion_tokens":640}}\n\n',
      'data: [DONE]\n\n',
    ]
    let i = 0
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: {
        getReader: () => ({
          read: async () => (i < chunks.length
            ? { done: false, value: encoder.encode(chunks[i++]) }
            : { done: true, value: undefined }),
        }),
      },
    }))

    await handler({
      method: 'POST',
      headers: { authorization: 'Bearer t' },
      body: {
        stream: true,
        max_tokens: 4000,
        messages: [{ role: 'system', content: 's' }, { role: 'user', content: 'hi' }],
      },
    }, makeRes())

    expect(checkAndReserve).toHaveBeenCalledWith(expect.objectContaining({ reserveTokens: 4000 }))
    expect(reconcile).toHaveBeenCalledWith(expect.objectContaining({
      reservedTokens: 4000,
      actualTokens: 640,
      promptTokens: 9100,
    }))
  })

  it('meters prompt tokens on non-streamed turns too', async () => {
    checkAndReserve.mockResolvedValue({ allowed: true, used: 0, cap: 100_000, reserved: 400 })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 3000, completion_tokens: 120 },
      }),
    }))

    await handler({
      method: 'POST',
      headers: { authorization: 'Bearer t' },
      body: { max_tokens: 400, messages: [{ role: 'system', content: 's' }, { role: 'user', content: 'hi' }] },
    }, makeRes())

    expect(reconcile).toHaveBeenCalledWith(expect.objectContaining({
      reservedTokens: 400,
      actualTokens: 120,
      promptTokens: 3000,
    }))
  })

  it('routes autocorrect to the small model with minimal reasoning, still quota-counted', async () => {
    checkAndReserve.mockResolvedValue({ allowed: true, used: 0, cap: 100_000, reserved: 600 })
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: 'I went to the store.' }, finish_reason: 'stop' }], usage: { prompt_tokens: 140, completion_tokens: 30 } }),
    })
    vi.stubGlobal('fetch', fetchMock)
    const res = makeRes()

    await handler({
      method: 'POST',
      headers: { authorization: 'Bearer t' },
      body: {
        task: 'autocorrect',
        // A stale client may still send these; none of them may reach OpenAI.
        model: 'qwen/qwen-2.5-7b-instruct',
        stream: true,
        max_tokens: 4000,
        reasoning_effort: 'high',
        messages: [{ role: 'system', content: 'Fix spelling.' }, { role: 'user', content: '<user_sentence>i went to teh store.</user_sentence>' }],
      },
    }, res)

    const sent = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(sent).toMatchObject({
      model: 'gpt-5-nano',
      reasoning_effort: 'minimal',
      max_completion_tokens: 600,
      stream: false,
    })
    expect(sent).not.toHaveProperty('response_format')
    expect(checkAndReserve).toHaveBeenCalledWith(expect.objectContaining({ reserveTokens: 600 }))
    expect(reconcile).toHaveBeenCalledWith(expect.objectContaining({ reservedTokens: 600, actualTokens: 30, promptTokens: 140 }))
    expect(res.json).toHaveBeenCalled()
  })

  it('rejects an autocorrect request that carries history', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const res = makeRes()
    await handler({
      method: 'POST',
      headers: { authorization: 'Bearer t' },
      body: {
        task: 'autocorrect',
        messages: [{ role: 'system', content: 's' }, { role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }, { role: 'user', content: 'c' }],
      },
    }, res)
    expect(res.statusCode).toBe(400)
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'invalid_autocorrect_request' }))
    expect(fetchMock).not.toHaveBeenCalled()
    expect(checkAndReserve).not.toHaveBeenCalled()
  })

  it('keeps crisis checks quota-exempt', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: '{"risk":0,"reason":"x"}' } }], usage: { prompt_tokens: 3000, completion_tokens: 20 } }),
    }))

    await handler({
      method: 'POST',
      headers: { authorization: 'Bearer t' },
      body: { task: 'crisis_check', messages: [{ role: 'system', content: 's' }, { role: 'user', content: 'hi' }] },
    }, makeRes())

    expect(checkAndReserve).not.toHaveBeenCalled()
    expect(reconcile).not.toHaveBeenCalled()
  })
})
