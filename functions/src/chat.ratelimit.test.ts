// The classifier routes (crisis_check, signal_check) have their own per-user
// limiter, so a burst of classifier calls can't starve companion turns and a
// burst of companion turns can't make the crisis check fail open with a 429.

import { describe, expect, it, vi } from 'vitest'

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

const { chat, RATE_LIMITED_CODE } = await import('./chat')
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

// An empty message list fails validation, which runs after the rate limit, so
// every allowed request answers 400 and every limited one answers 429 without
// reaching OpenAI.
async function send(uid: string, task?: string) {
  const res = makeRes()
  await handler({ method: 'POST', headers: { authorization: `Bearer ${uid}` }, body: { messages: [], task } }, res)
  return res
}

describe('chat rate limits', () => {
  it('limits ordinary requests to 30 a minute with a machine-readable code', async () => {
    for (let i = 0; i < 30; i++) expect((await send('user-ordinary')).statusCode).toBe(400)
    const limited = await send('user-ordinary')
    expect(limited.statusCode).toBe(429)
    expect(limited.body).toMatchObject({ code: RATE_LIMITED_CODE })
  })

  it('keeps the crisis check available when ordinary requests are exhausted', async () => {
    for (let i = 0; i < 31; i++) await send('user-busy-talk')
    expect((await send('user-busy-talk')).statusCode).toBe(429)
    expect((await send('user-busy-talk', 'crisis_check')).statusCode).toBe(400)
    expect((await send('user-busy-talk', 'signal_check')).statusCode).toBe(400)
  })

  it('limits classifier routes to 20 a minute, shared between crisis and signal checks', async () => {
    for (let i = 0; i < 10; i++) expect((await send('user-classifier', 'crisis_check')).statusCode).toBe(400)
    for (let i = 0; i < 10; i++) expect((await send('user-classifier', 'signal_check')).statusCode).toBe(400)
    const limited = await send('user-classifier', 'crisis_check')
    expect(limited.statusCode).toBe(429)
    expect(limited.body).toMatchObject({ code: RATE_LIMITED_CODE })
  })

  it('keeps companion turns available when classifier calls are exhausted', async () => {
    for (let i = 0; i < 21; i++) await send('user-busy-folio', 'crisis_check')
    expect((await send('user-busy-folio', 'crisis_check')).statusCode).toBe(429)
    expect((await send('user-busy-folio')).statusCode).toBe(400)
    expect((await send('user-busy-folio', 'autocorrect')).statusCode).toBe(400)
  })
})
