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
