import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('firebase/auth', () => ({
  getAuth: vi.fn(() => ({
    currentUser: {
      getIdToken: vi.fn(() => Promise.resolve('mock-token')),
    },
  })),
}))

function mockFetch(body: unknown, ok = true, status = 200) {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
    ok,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
  })))
}

describe('chatCompletion', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
  })

  async function loadChatCompletion() {
    vi.doMock('firebase/auth', () => ({
      getAuth: vi.fn(() => ({
        currentUser: {
          getIdToken: vi.fn(() => Promise.resolve('mock-token')),
        },
      })),
    }))
    const mod = await import('./openrouter')
    return mod.chatCompletion
  }

  it('returns content from valid response', async () => {
    mockFetch({ choices: [{ message: { content: 'Hello' } }] })
    const chatCompletion = await loadChatCompletion()

    const result = await chatCompletion([{ role: 'user', content: 'Hi' }])
    expect(result).toBe('Hello')
  })

  it('throws on empty choices array', async () => {
    mockFetch({ choices: [] })
    const chatCompletion = await loadChatCompletion()

    await expect(chatCompletion([{ role: 'user', content: 'Hi' }]))
      .rejects.toThrow('Empty response from OpenAI')
  })

  it('throws on missing message content', async () => {
    mockFetch({ choices: [{ message: {} }] })
    const chatCompletion = await loadChatCompletion()

    await expect(chatCompletion([{ role: 'user', content: 'Hi' }]))
      .rejects.toThrow('Empty response from OpenAI')
  })

  it('throws on null choices', async () => {
    mockFetch({ choices: null })
    const chatCompletion = await loadChatCompletion()

    await expect(chatCompletion([{ role: 'user', content: 'Hi' }]))
      .rejects.toThrow('Empty response from OpenAI')
  })

  it('throws on non-ok response', async () => {
    mockFetch('Internal Server Error', false, 500)
    const chatCompletion = await loadChatCompletion()

    await expect(chatCompletion([{ role: 'user', content: 'Hi' }]))
      .rejects.toThrow('API error: 500')
  })
})

describe('classifyCrisisRisk', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
  })

  async function loadClassify() {
    vi.doMock('firebase/auth', () => ({
      getAuth: vi.fn(() => ({
        currentUser: {
          getIdToken: vi.fn(() => Promise.resolve('mock-token')),
        },
      })),
    }))
    const mod = await import('./openrouter')
    return mod.classifyCrisisRisk
  }

  it('returns parsed risk + reason from valid classifier response', async () => {
    mockFetch({
      choices: [{ message: { content: '{"risk": 2, "reason": "explicit ideation"}' } }],
    })
    const classify = await loadClassify()

    const result = await classify('I want to die tonight')

    expect(result.risk).toBe(2)
    expect(result.reason).toBe('explicit ideation')
  })

  it('sends task: crisis_check in request body', async () => {
    const fetchMock = vi.fn(() => Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({
        choices: [{ message: { content: '{"risk": 0, "reason": "no signal"}' } }],
      }),
      text: () => Promise.resolve(''),
    }))
    vi.stubGlobal('fetch', fetchMock)
    const classify = await loadClassify()

    await classify('hello world')

    const args = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    const body = JSON.parse(args[1].body as string)
    expect(body.task).toBe('crisis_check')
    expect(body.messages).toHaveLength(2)
  })

  it('passes language through as a header line in the user message', async () => {
    const fetchMock = vi.fn(() => Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({
        choices: [{ message: { content: '{"risk": 0, "reason": "x"}' } }],
      }),
      text: () => Promise.resolve(''),
    }))
    vi.stubGlobal('fetch', fetchMock)
    const classify = await loadClassify()

    await classify('ya no quiero vivir', 'es')

    const args = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    const body = JSON.parse(args[1].body as string)
    const userMessage = body.messages[1].content as string
    expect(userMessage).toContain('Language: es')
    expect(userMessage).toContain('ya no quiero vivir')
  })

  it('fails open (returns risk=0) on non-ok response', async () => {
    mockFetch('Server error', false, 500)
    const classify = await loadClassify()

    const result = await classify('any text')

    expect(result.risk).toBe(0)
    expect(result.reason).toBeUndefined()
  })

  it('fails open on malformed JSON content', async () => {
    mockFetch({ choices: [{ message: { content: 'not json at all' } }] })
    const classify = await loadClassify()

    const result = await classify('any text')

    expect(result.risk).toBe(0)
  })

  it('fails open on out-of-range risk value', async () => {
    mockFetch({ choices: [{ message: { content: '{"risk": 5}' } }] })
    const classify = await loadClassify()

    const result = await classify('any text')

    expect(result.risk).toBe(0)
  })

  it('fails open on missing content', async () => {
    mockFetch({ choices: [{ message: {} }] })
    const classify = await loadClassify()

    const result = await classify('any text')

    expect(result.risk).toBe(0)
  })

  it('returns risk=1 when classifier returns ambiguous signal', async () => {
    mockFetch({
      choices: [{ message: { content: '{"risk": 1, "reason": "burden framing"}' } }],
    })
    const classify = await loadClassify()

    const result = await classify('everyone would be better off without me')

    expect(result.risk).toBe(1)
    expect(result.reason).toBe('burden framing')
  })
})

