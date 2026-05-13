import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('firebase/auth', () => ({
  getAuth: vi.fn(() => ({
    currentUser: {
      getIdToken: vi.fn(() => Promise.resolve('mock-token')),
    },
  })),
}))

vi.mock('../services/diagnostics', () => ({
  engineLog: vi.fn(),
}))

function mockFetch(body: unknown, ok = true, status = 200) {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
    ok,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
  })))
}

// vi.resetModules() in each describe's beforeEach blows away the hoisted
// firebase/auth mock at the top of the file, so re-mock before re-importing.
async function loadOpenrouter() {
  vi.doMock('firebase/auth', () => ({
    getAuth: vi.fn(() => ({
      currentUser: { getIdToken: vi.fn(() => Promise.resolve('mock-token')) },
    })),
  }))
  return import('./openrouter')
}

describe('chatCompletion', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
  })

  const loadChatCompletion = async () => (await loadOpenrouter()).chatCompletion

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

  const loadClassify = async () => (await loadOpenrouter()).classifyCrisisRisk

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

// ── streamChatCompletion preamble parsing ────────────────────────────────────
//
// The therapist response stream begins with `<<RISK:N>>\n\n` (see
// RISK_PREAMBLE_INSTRUCTIONS in therapistPrompts.ts). The parser strips it
// from the content forwarded to onToken and fires onRisk once with the
// parsed risk. These tests exercise the parser without mocking the parser
// itself — they drive real SSE bytes through a fake fetch body.

function sse(content: string): string {
  return `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`
}

function mockStream(chunks: string[]) {
  const encoder = new TextEncoder()
  let i = 0
  const reader = {
    read: () => {
      if (i >= chunks.length) return Promise.resolve({ done: true, value: undefined })
      const chunk = chunks[i++]
      return Promise.resolve({ done: false, value: encoder.encode(chunk) })
    },
  }
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
    ok: true,
    status: 200,
    body: { getReader: () => reader },
    text: () => Promise.resolve(''),
  })))
}

const loadStream = async () => (await loadOpenrouter()).streamChatCompletion

describe('streamChatCompletion — risk preamble parsing', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
  })

  it('parses `<<RISK:0>>` and strips it from forwarded content', async () => {
    mockStream([
      sse('<<RISK:0>>\n\nHey, '),
      sse('how are you?'),
      'data: [DONE]\n\n',
    ])
    const stream = await loadStream()

    const tokens: string[] = []
    let risk: number | null = null
    let complete = ''
    await stream(
      [{ role: 'user', content: 'hi' }],
      {
        onToken: (t) => tokens.push(t),
        onRisk: (r) => { risk = r },
        onComplete: (full) => { complete = full },
        onError: () => {},
      },
    )

    expect(risk).toBe(0)
    expect(tokens.join('')).toBe('Hey, how are you?')
    expect(complete).toBe('Hey, how are you?')
    expect(tokens.join('')).not.toContain('<<RISK')
  })

  it('parses `<<RISK:2>>` and fires onRisk before any content token', async () => {
    mockStream([
      sse('<<RISK:2>>\n\n'),
      sse('Please reach out for help.'),
      'data: [DONE]\n\n',
    ])
    const stream = await loadStream()

    let risk: number | null = null
    let riskFiredAt: number | null = null
    const tokens: string[] = []
    await stream(
      [{ role: 'user', content: 'hi' }],
      {
        onToken: (t) => { tokens.push(t); if (riskFiredAt === null) riskFiredAt = -1 },
        onRisk: (r) => { risk = r; riskFiredAt = tokens.length },
        onComplete: () => {},
        onError: () => {},
      },
    )

    expect(risk).toBe(2)
    // onRisk fired before any token reached onToken (token count was 0).
    expect(riskFiredAt).toBe(0)
    expect(tokens.join('')).toBe('Please reach out for help.')
  })

  it('handles preamble split across multiple stream chunks', async () => {
    mockStream([
      sse('<<RIS'),
      sse('K:1>>'),
      sse('\n\nThat sounds heavy.'),
      'data: [DONE]\n\n',
    ])
    const stream = await loadStream()

    let risk: number | null = null
    const tokens: string[] = []
    await stream(
      [{ role: 'user', content: 'hi' }],
      {
        onToken: (t) => tokens.push(t),
        onRisk: (r) => { risk = r },
        onComplete: () => {},
        onError: () => {},
      },
    )

    expect(risk).toBe(1)
    expect(tokens.join('')).toBe('That sounds heavy.')
  })

  it('fails open with risk=0 when no preamble appears within the fail-open budget', async () => {
    // A response longer than PREAMBLE_FAIL_OPEN_CHARS (80) with no
    // `<<RISK:...` prefix. Parser should accumulate until the threshold,
    // fire onRisk(0), then surface buffered content as normal response.
    // Must be non-repeating to avoid tripping the repetition-loop detector
    // that operates on the same fullText buffer once the preamble flushes.
    const longContent = 'The quick brown fox jumps over the lazy dog while a curious cat watches from afar with mild interest.'
    mockStream([sse(longContent), 'data: [DONE]\n\n'])
    const stream = await loadStream()

    let risk: number | null = null
    let complete = ''
    await stream(
      [{ role: 'user', content: 'hi' }],
      {
        onToken: () => {},
        onRisk: (r) => { risk = r },
        onComplete: (full) => { complete = full },
        onError: () => {},
      },
    )

    expect(risk).toBe(0)
    expect(complete).toBe(longContent)
  })

  it('fires onRisk(0) at end-of-stream when the response was shorter than the fail-open budget and had no preamble', async () => {
    mockStream([sse('hi'), 'data: [DONE]\n\n'])
    const stream = await loadStream()

    let risk: number | null = null
    let complete = ''
    await stream(
      [{ role: 'user', content: 'hi' }],
      {
        onToken: () => {},
        onRisk: (r) => { risk = r },
        onComplete: (full) => { complete = full },
        onError: () => {},
      },
    )

    expect(risk).toBe(0)
    expect(complete).toBe('hi')
  })

  it('only fires onRisk once per call', async () => {
    mockStream([sse('<<RISK:0>>\n\nHey.'), 'data: [DONE]\n\n'])
    const stream = await loadStream()

    const risks: number[] = []
    await stream(
      [{ role: 'user', content: 'hi' }],
      {
        onToken: () => {},
        onRisk: (r) => risks.push(r),
        onComplete: () => {},
        onError: () => {},
      },
    )

    expect(risks).toEqual([0])
  })
})

