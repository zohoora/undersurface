// firebase-* mocks must run before importing index.ts — the module calls
// initializeApp() and defineSecret() at load time.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockVerifyIdToken = vi.fn()
const mockGetUser = vi.fn()
const mockGetUsers = vi.fn()
const mockListUsers = vi.fn()
const mockDeleteUser = vi.fn()
const mockGetAuth = vi.fn(() => ({
  verifyIdToken: mockVerifyIdToken,
  getUser: mockGetUser,
  getUsers: mockGetUsers,
  listUsers: mockListUsers,
  deleteUser: mockDeleteUser,
}))

vi.mock('firebase-admin/app', () => ({
  initializeApp: vi.fn(),
}))
vi.mock('firebase-admin/auth', () => ({
  getAuth: mockGetAuth,
}))
vi.mock('firebase-admin/firestore', () => ({
  getFirestore: vi.fn(() => ({
    collection: vi.fn(),
    collectionGroup: vi.fn(),
    batch: vi.fn(() => ({ delete: vi.fn(), commit: vi.fn().mockResolvedValue(undefined) })),
  })),
}))
vi.mock('firebase-functions/params', () => ({
  defineSecret: vi.fn(() => ({ value: () => 'test-secret-key' })),
}))
vi.mock('firebase-functions/v2/https', () => ({
  // Strip the Cloud Run wrapper so the handler is directly callable.
  onRequest: (_opts: unknown, handler: unknown) => handler,
}))

const indexModule = await import('./index')
const chat = indexModule.chat as unknown as (
  req: MockRequest,
  res: MockResponse,
) => Promise<void>
const accountApi = indexModule.accountApi as unknown as (
  req: MockRequest,
  res: MockResponse,
) => Promise<void>
const adminApi = indexModule.adminApi as unknown as (
  req: MockRequest,
  res: MockResponse,
) => Promise<void>

interface MockRequest {
  method: string
  headers: Record<string, string | undefined>
  body?: unknown
}

interface MockResponse {
  status: ReturnType<typeof vi.fn>
  json: ReturnType<typeof vi.fn>
  setHeader: ReturnType<typeof vi.fn>
  write: ReturnType<typeof vi.fn>
  end: ReturnType<typeof vi.fn>
  _statusCode: number
  _jsonBody: unknown
}

function makeReq(opts: Partial<MockRequest> = {}): MockRequest {
  return {
    method: opts.method ?? 'POST',
    headers: opts.headers ?? { authorization: 'Bearer test-token' },
    body: opts.body ?? { messages: [{ role: 'user', content: 'hi' }] },
  }
}

function makeRes(): MockResponse {
  const res = {
    _statusCode: 200,
    _jsonBody: undefined as unknown,
    status: vi.fn(function (this: MockResponse, code: number) {
      this._statusCode = code
      return this
    }),
    json: vi.fn(function (this: MockResponse, body: unknown) {
      this._jsonBody = body
      return this
    }),
    setHeader: vi.fn(),
    write: vi.fn(),
    end: vi.fn(),
  } as unknown as MockResponse
  return res
}

// Mock global fetch for OpenAI calls. Default: a non-streaming success.
function stubFetchOk(body: unknown = { choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] }) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
    body: null,
  }))
}

beforeEach(() => {
  mockVerifyIdToken.mockReset()
  mockGetUser.mockReset()
  mockGetUsers.mockReset()
  mockListUsers.mockReset()
  mockDeleteUser.mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('chat — auth', () => {
  it('returns 405 for non-POST', async () => {
    const req = makeReq({ method: 'GET' })
    const res = makeRes()
    await chat(req, res)
    expect(res._statusCode).toBe(405)
    expect(res._jsonBody).toEqual({ error: 'Method not allowed' })
  })

  it('returns 401 when Authorization header is missing', async () => {
    const req = makeReq({ headers: {} })
    const res = makeRes()
    await chat(req, res)
    expect(res._statusCode).toBe(401)
    expect(res._jsonBody).toEqual({ error: 'Authentication required' })
  })

  it('returns 401 when Authorization header lacks Bearer prefix', async () => {
    const req = makeReq({ headers: { authorization: 'Basic abc' } })
    const res = makeRes()
    await chat(req, res)
    expect(res._statusCode).toBe(401)
  })

  it('returns 401 when token verification throws', async () => {
    mockVerifyIdToken.mockRejectedValueOnce(new Error('invalid token'))
    const req = makeReq()
    const res = makeRes()
    await chat(req, res)
    expect(res._statusCode).toBe(401)
    expect(res._jsonBody).toEqual({ error: 'Authentication required' })
  })
})

describe('chat — input validation', () => {
  beforeEach(() => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'user-validation-1' })
    stubFetchOk()
  })

  it('returns 400 for empty messages array', async () => {
    const req = makeReq({ body: { messages: [] } })
    const res = makeRes()
    await chat(req, res)
    expect(res._statusCode).toBe(400)
    expect(res._jsonBody).toEqual({ error: 'Invalid messages' })
  })

  it('returns 400 when messages is not an array', async () => {
    const req = makeReq({ body: { messages: 'oops' } })
    const res = makeRes()
    await chat(req, res)
    expect(res._statusCode).toBe(400)
  })

  it('returns 400 when messages exceed MAX_MESSAGES (50)', async () => {
    const messages = Array.from({ length: 51 }, () => ({ role: 'user', content: 'x' }))
    const req = makeReq({ body: { messages } })
    const res = makeRes()
    await chat(req, res)
    expect(res._statusCode).toBe(400)
    expect(res._jsonBody).toMatchObject({ error: expect.stringContaining('Too many messages') })
  })

  it('returns 400 when a message has invalid role', async () => {
    const req = makeReq({ body: { messages: [{ role: 42, content: 'hi' }] } })
    const res = makeRes()
    await chat(req, res)
    expect(res._statusCode).toBe(400)
    expect(res._jsonBody).toEqual({ error: 'Invalid message format' })
  })

  it('returns 400 when a user message exceeds MAX_MESSAGE_CHARS (8000)', async () => {
    const tooLong = 'a'.repeat(8001)
    const req = makeReq({ body: { messages: [{ role: 'user', content: tooLong }] } })
    const res = makeRes()
    await chat(req, res)
    expect(res._statusCode).toBe(400)
    expect(res._jsonBody).toMatchObject({ error: expect.stringContaining('Message too long') })
  })

  it('does NOT enforce length limit on system messages', async () => {
    // System prompts are app-built and legitimately exceed 8k chars.
    const long = 'a'.repeat(20000)
    const req = makeReq({ body: { messages: [{ role: 'system', content: long }, { role: 'user', content: 'hi' }] } })
    const res = makeRes()
    await chat(req, res)
    expect(res._statusCode).toBe(200)
  })
})

describe('chat — rate limiting', () => {
  beforeEach(() => {
    stubFetchOk()
  })

  it('rejects request 31 in the same window with 429', async () => {
    // Use a unique uid so the rate-limit Map state is isolated from other tests.
    mockVerifyIdToken.mockResolvedValue({ uid: 'rate-limit-test-uid' })

    // 30 successful requests
    for (let i = 0; i < 30; i++) {
      const res = makeRes()
      await chat(makeReq(), res)
      expect(res._statusCode, `request ${i + 1}`).toBe(200)
    }

    // 31st: rate-limited
    const res31 = makeRes()
    await chat(makeReq(), res31)
    expect(res31._statusCode).toBe(429)
    expect(res31._jsonBody).toMatchObject({ error: expect.stringContaining('Too many requests') })
  })

  it('rate limit is per-uid (separate uids do not interfere)', async () => {
    mockVerifyIdToken.mockResolvedValueOnce({ uid: 'uid-a' })
    const resA = makeRes()
    await chat(makeReq(), resA)
    expect(resA._statusCode).toBe(200)

    mockVerifyIdToken.mockResolvedValueOnce({ uid: 'uid-b' })
    const resB = makeRes()
    await chat(makeReq(), resB)
    expect(resB._statusCode).toBe(200)
  })
})

describe('chat — upstream errors', () => {
  it('forwards OpenAI 5xx as a generic 503-style payload', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'upstream-error-uid' })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => 'upstream down',
    }))

    const res = makeRes()
    await chat(makeReq(), res)
    expect(res._statusCode).toBe(503)
    // Critically: error body is a generic message, not the upstream error text.
    // We never want raw OpenAI errors leaking to the client.
    expect(res._jsonBody).toEqual({ error: 'AI service temporarily unavailable' })
  })
})

describe('accountApi', () => {
  it('returns 405 for non-POST', async () => {
    const req = makeReq({ method: 'GET' })
    const res = makeRes()
    await accountApi(req, res)
    expect(res._statusCode).toBe(405)
  })

  it('returns 401 when not authenticated', async () => {
    const req = makeReq({ headers: {} })
    const res = makeRes()
    await accountApi(req, res)
    expect(res._statusCode).toBe(401)
  })

  it('returns 400 when action is missing', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'acct-1' })
    const req = makeReq({ body: {} })
    const res = makeRes()
    await accountApi(req, res)
    expect(res._statusCode).toBe(400)
    expect(res._jsonBody).toEqual({ error: 'Missing action' })
  })

  it('returns 400 for unknown action', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'acct-2' })
    const req = makeReq({ body: { action: 'nuke' } })
    const res = makeRes()
    await accountApi(req, res)
    expect(res._statusCode).toBe(400)
    expect(res._jsonBody).toMatchObject({ error: expect.stringContaining('Unknown action') })
  })

  it('rejects empty contact message', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'acct-3' })
    const req = makeReq({ body: { action: 'submitContact', message: '   ' } })
    const res = makeRes()
    await accountApi(req, res)
    expect(res._statusCode).toBe(400)
    expect(res._jsonBody).toMatchObject({ error: expect.stringContaining('Message is required') })
  })

  it('rejects oversized contact message (>5000 chars)', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'acct-4' })
    const req = makeReq({ body: { action: 'submitContact', message: 'a'.repeat(5001) } })
    const res = makeRes()
    await accountApi(req, res)
    expect(res._statusCode).toBe(400)
    expect(res._jsonBody).toMatchObject({ error: expect.stringContaining('too long') })
  })
})

// ADMIN_EMAILS is the only credential — no role claims, no DB lookup. Each
// test below pins one step on the privilege-escalation path.
describe('adminApi — allowlist', () => {
  it('returns 405 for non-POST', async () => {
    const req = makeReq({ method: 'GET' })
    const res = makeRes()
    await adminApi(req, res)
    expect(res._statusCode).toBe(405)
  })

  it('returns 403 when Authorization header is missing', async () => {
    const req = makeReq({ headers: {}, body: { action: 'getOverview' } })
    const res = makeRes()
    await adminApi(req, res)
    expect(res._statusCode).toBe(403)
    expect(res._jsonBody).toEqual({ error: 'Forbidden' })
  })

  it('returns 403 when token is valid but email is NOT in allowlist', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'random-user', email: 'attacker@example.com' })
    const req = makeReq({ body: { action: 'getOverview' } })
    const res = makeRes()
    await adminApi(req, res)
    expect(res._statusCode).toBe(403)
    expect(res._jsonBody).toEqual({ error: 'Forbidden' })
  })

  it('returns 403 when token has NO email field at all', async () => {
    // Anonymous auth providers — the && short-circuits to false.
    mockVerifyIdToken.mockResolvedValue({ uid: 'no-email' })
    const req = makeReq({ body: { action: 'getOverview' } })
    const res = makeRes()
    await adminApi(req, res)
    expect(res._statusCode).toBe(403)
  })

  it('returns 403 when token verification throws', async () => {
    mockVerifyIdToken.mockRejectedValue(new Error('expired'))
    const req = makeReq({ body: { action: 'getOverview' } })
    const res = makeRes()
    await adminApi(req, res)
    expect(res._statusCode).toBe(403)
  })

  it('email comparison is case-sensitive', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'mixed-case', email: 'ZOHOORA@gmail.com' })
    const req = makeReq({ body: { action: 'getOverview' } })
    const res = makeRes()
    await adminApi(req, res)
    expect(res._statusCode).toBe(403)
  })

  it('passes the allowlist gate for the canonical admin email', async () => {
    // Body shape fails AFTER the auth gate; 400 means we got past the 403.
    mockVerifyIdToken.mockResolvedValue({ uid: 'admin-uid', email: 'zohoora@gmail.com' })
    const req = makeReq({ body: {} })
    const res = makeRes()
    await adminApi(req, res)
    expect(res._statusCode).toBe(400)
    expect(res._jsonBody).toEqual({ error: 'Missing action' })
  })

  it('returns 400 for unknown admin action when email IS allowlisted', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'admin-uid', email: 'zohoora@gmail.com' })
    const req = makeReq({ body: { action: 'doSomethingSketchy' } })
    const res = makeRes()
    await adminApi(req, res)
    expect(res._statusCode).toBe(400)
    expect(res._jsonBody).toMatchObject({ error: expect.stringContaining('Unknown action') })
  })

  it('returns 400 for getUserDetail without uid (admin still must pass params)', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'admin-uid', email: 'zohoora@gmail.com' })
    const req = makeReq({ body: { action: 'getUserDetail' } })
    const res = makeRes()
    await adminApi(req, res)
    expect(res._statusCode).toBe(400)
    expect(res._jsonBody).toEqual({ error: 'Missing uid' })
  })
})

