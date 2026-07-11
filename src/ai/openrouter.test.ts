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

describe('classifySessionSignals', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
  })

  const loadClassify = async () => (await loadOpenrouter()).classifySessionSignals

  it('parses levels + theme from a valid response', async () => {
    mockFetch({
      choices: [{ message: { content: '{"withdrawal": 0, "rumination": 2, "theme": "whether quitting was a mistake"}' } }],
    })
    const classify = await loadClassify()

    const result = await classify(['msg one', 'msg two', 'msg three'])

    expect(result).toEqual({ withdrawal: 0, rumination: 2, theme: 'whether quitting was a mistake' })
  })

  it('sends task: signal_check with numbered recent messages', async () => {
    const fetchMock = vi.fn(() => Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({
        choices: [{ message: { content: '{"withdrawal": 0, "rumination": 0, "theme": ""}' } }],
      }),
      text: () => Promise.resolve(''),
    }))
    vi.stubGlobal('fetch', fetchMock)
    const classify = await loadClassify()

    await classify(['a', 'b', 'c', 'd', 'e', 'f', 'g'])

    const args = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    const body = JSON.parse(args[1].body as string)
    expect(body.task).toBe('signal_check')
    // Capped at the 6 newest messages, oldest first.
    expect(body.messages[1].content).toContain('[1] b')
    expect(body.messages[1].content).toContain('[6] g')
    expect(body.messages[1].content).not.toContain('] a')
  })

  it('omits theme when empty and truncates an oversized theme', async () => {
    mockFetch({
      choices: [{ message: { content: `{"withdrawal": 1, "rumination": 1, "theme": "${'x'.repeat(200)}"}` } }],
    })
    const classify = await loadClassify()
    const result = await classify(['hello'])
    expect(result.theme).toHaveLength(60)

    mockFetch({
      choices: [{ message: { content: '{"withdrawal": 0, "rumination": 0, "theme": ""}' } }],
    })
    const result2 = await (await loadClassify())(['hello'])
    expect(result2.theme).toBeUndefined()
  })

  it('fails open to zeros on HTTP error, malformed JSON, and out-of-range levels', async () => {
    const zeros = { withdrawal: 0, rumination: 0 }

    mockFetch('Server error', false, 500)
    expect(await (await loadClassify())(['x'])).toEqual(zeros)

    mockFetch({ choices: [{ message: { content: 'not json' } }] })
    expect(await (await loadClassify())(['x'])).toEqual(zeros)

    mockFetch({ choices: [{ message: { content: '{"withdrawal": 7, "rumination": 0, "theme": ""}' } }] })
    expect(await (await loadClassify())(['x'])).toEqual(zeros)
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

  it('parses the combined ambient marker without exposing assessment metadata', async () => {
    mockStream([
      sse('<<RISK:0;FIT:partial;MOVE:clarified;AGENCY:more;CONF:medium;STATE:looping;CAP:few_minutes;NEED:perspective>>\n\nThat distinction seems important.'),
      'data: [DONE]\n\n',
    ])
    const stream = await loadStream()

    let risk: number | null = null
    let assessment: unknown
    const tokens: string[] = []
    await stream(
      [{ role: 'user', content: 'I think I see the difference now.' }],
      {
        onToken: token => tokens.push(token),
        onRisk: value => { risk = value },
        onAmbientAssessment: value => { assessment = value },
        onComplete: () => {},
        onError: () => {},
      },
    )

    expect(risk).toBe(0)
    expect(assessment).toEqual({
      fit: 'partial', movement: 'clarified', agency: 'more', confidence: 'medium',
      state: 'looping', capacity: 'few_minutes', need: 'perspective',
    })
    expect(tokens.join('')).toBe('That distinction seems important.')
    expect(tokens.join('')).not.toContain('FIT:')
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

  // ── no-preamble paths stream immediately (C5) ──────────────────────────
  // Diary/parts callers pass no onRisk and their prompts never emit a marker.
  // The parser must NOT buffer those up to the fail-open budget — a short nudge
  // should reach onToken chunk-by-chunk, not appear all at once at stream end.

  it('forwards each chunk immediately when no onRisk is provided (no buffering)', async () => {
    mockStream([sse('Short '), sse('reply.'), 'data: [DONE]\n\n'])
    const stream = await loadStream()

    const tokens: string[] = []
    let complete = ''
    await stream(
      [{ role: 'user', content: 'hi' }],
      {
        onToken: (t) => tokens.push(t),
        onComplete: (full) => { complete = full },
        onError: () => {},
        // no onRisk
      },
    )

    // Two chunks in ⇒ two forwards out. Buffered behavior would coalesce into
    // a single flush at end (length 1).
    expect(tokens).toEqual(['Short ', 'reply.'])
    expect(complete).toBe('Short reply.')
  })

  // ── friendly API errors (quota) ────────────────────────────────────────

  it('surfaces the proxy JSON error message verbatim (quota notice)', async () => {
    const { friendlyApiError } = await import('./openrouter')
    expect(friendlyApiError(429, JSON.stringify({
      error: 'You have reached your monthly usage limit. It resets at the start of next month.',
      code: 'quota_exceeded',
    }))).toBe('You have reached your monthly usage limit. It resets at the start of next month.')
  })

  it('falls back to a generic message for a non-JSON body', async () => {
    const { friendlyApiError } = await import('./openrouter')
    expect(friendlyApiError(500, 'Internal Server Error')).toContain('API error: 500')
  })

  // ── server truncation frame (D1) ───────────────────────────────────────

  it('routes a server truncation frame to onError instead of completing', async () => {
    mockStream([
      sse('Partial answer that gets cut'),
      `data: ${JSON.stringify({ error: { type: 'length_cap' } })}\n\n`,
      'data: [DONE]\n\n',
    ])
    const stream = await loadStream()

    let completed = false
    let errored: Error | null = null
    await stream(
      [{ role: 'user', content: 'hi' }],
      {
        onToken: () => {},
        onComplete: () => { completed = true },
        onError: (e) => { errored = e },
      },
    )

    expect(completed).toBe(false)
    expect(errored).not.toBeNull()
    expect((errored as unknown as Error).message).toContain('length_cap')
  })

  // ── malformed-preamble tolerance ───────────────────────────────────────
  // The model occasionally echoes the literal `<<RISK:N>>` template, emits
  // an out-of-range digit, or uses a single newline instead of two. Without
  // tolerant stripping, the malformed bytes leak into the chat window.
  // Policy: strip whatever appears in the brackets, fail open to risk=0.

  it('strips a literal `<<RISK:N>>` placeholder echo without leaking it', async () => {
    mockStream([sse('<<RISK:N>>\n\nHey there.'), 'data: [DONE]\n\n'])
    const stream = await loadStream()

    let risk: number | null = null
    let complete = ''
    const tokens: string[] = []
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
    expect(tokens.join('')).toBe('Hey there.')
    expect(complete).toBe('Hey there.')
    expect(tokens.join('')).not.toContain('<<RISK')
  })

  it('strips an out-of-range `<<RISK:5>>` preamble and fails open to risk=0', async () => {
    mockStream([sse('<<RISK:5>>\n\nThat sounds tough.'), 'data: [DONE]\n\n'])
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

    expect(risk).toBe(0)
    expect(tokens.join('')).toBe('That sounds tough.')
    expect(tokens.join('')).not.toContain('<<RISK')
  })

  it('accepts single-newline preamble variant (`<<RISK:0>>\\n`) as risk=0', async () => {
    mockStream([sse('<<RISK:0>>\nHey.'), 'data: [DONE]\n\n'])
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

    expect(risk).toBe(0)
    expect(tokens.join('')).toBe('Hey.')
    expect(tokens.join('')).not.toContain('<<RISK')
  })

  // ── newline-less and wrapped markers (production leak, 2026-06-12) ──────
  // Observed live: the model emitted `<<RISK:N>> That sentence...` — literal
  // placeholder AND no newline, response on the same line. The pattern
  // required `\n+`, never matched, and the fail-open flush delivered the
  // marker verbatim to the chat window. The marker is unambiguously complete
  // at `>>` (payload cannot contain `>`), so matching must not depend on
  // what follows it.

  it('strips a same-line `<<RISK:N>> ` marker with no trailing newline (production leak)', async () => {
    const prose = 'That sentence, "I felt like I was dying at the time," matters, and so does the five years that came after it.'
    mockStream([sse(`<<RISK:N>> ${prose}`), 'data: [DONE]\n\n'])
    const stream = await loadStream()

    let risk: number | null = null
    let complete = ''
    const tokens: string[] = []
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
    expect(tokens.join('')).toBe(prose)
    expect(complete).toBe(prose)
    expect(tokens.join('')).not.toContain('<<RISK')
  })

  it('preserves the risk signal from a same-line `<<RISK:2>>` marker with no newline', async () => {
    mockStream([sse('<<RISK:2>> Please reach out to someone you trust.'), 'data: [DONE]\n\n'])
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

    expect(risk).toBe(2)
    expect(tokens.join('')).toBe('Please reach out to someone you trust.')
  })

  it('does not forward leading whitespace when the preamble newlines arrive in a later chunk', async () => {
    mockStream([sse('<<RISK:0>>'), sse('\n\nHey.'), 'data: [DONE]\n\n'])
    const stream = await loadStream()

    const tokens: string[] = []
    await stream(
      [{ role: 'user', content: 'hi' }],
      {
        onToken: (t) => tokens.push(t),
        onRisk: () => {},
        onComplete: () => {},
        onError: () => {},
      },
    )

    expect(tokens.join('')).toBe('Hey.')
  })

  it('scrubs an unparseable marker prefix (oversized payload) at flush time instead of leaking it', async () => {
    mockStream([sse('<<RISK:uncertain>>\n\nHey there.'), 'data: [DONE]\n\n'])
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

    expect(risk).toBe(0)
    expect(tokens.join('')).toBe('Hey there.')
    expect(tokens.join('')).not.toContain('<<RISK')
  })

  it('scrubs a markdown-wrapped marker and preserves its risk digit', async () => {
    mockStream([sse('`<<RISK:2>>`\n\nPlease reach out for help.'), 'data: [DONE]\n\n'])
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

    expect(risk).toBe(2)
    expect(tokens.join('')).toBe('Please reach out for help.')
    expect(tokens.join('')).not.toContain('<<RISK')
  })

  it('scrubs a marker preceded by a stray leading newline and preserves its risk digit', async () => {
    mockStream([sse('\n<<RISK:1>>\n\nThat sounds heavy.'), 'data: [DONE]\n\n'])
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
    expect(tokens.join('')).not.toContain('<<RISK')
  })

  // ── display-time scrub for persisted leaks ──────────────────────────────
  // Markers that escaped older parsers were persisted to Firestore and would
  // otherwise display forever. scrubLeakedRiskMarker cleans them at render.

  it('scrubLeakedRiskMarker strips a leaked leading marker from persisted content', async () => {
    const { scrubLeakedRiskMarker } = await loadOpenrouter()
    expect(scrubLeakedRiskMarker('<<RISK:N>> That sentence matters.')).toBe('That sentence matters.')
    expect(scrubLeakedRiskMarker('<<RISK:0>>\n\nHey there.')).toBe('Hey there.')
    expect(scrubLeakedRiskMarker('`<<RISK:2>>`\nPlease reach out.')).toBe('Please reach out.')
    expect(scrubLeakedRiskMarker('<<RISK:0;FIT:landed;MOVE:deepened;AG')).toBe('')
  })

  it('rejects a stream that ends during the hidden risk preamble', async () => {
    mockStream([
      sse('<<RISK:0;FIT:landed;MOVE:deepened;AG'),
      'data: [DONE]\n\n',
    ])
    const stream = await loadStream()

    const tokens: string[] = []
    let completed = false
    let error: Error | null = null
    await stream(
      [{ role: 'user', content: 'hi' }],
      {
        onToken: token => tokens.push(token),
        onRisk: () => {},
        onComplete: () => { completed = true },
        onError: value => { error = value },
      },
    )

    expect(tokens).toEqual([])
    expect(completed).toBe(false)
    expect(error).toBeInstanceOf(Error)
    expect(error?.message).toBe('stream ended during risk preamble')
  })

  it('scrubLeakedRiskMarker leaves marker-free content and mid-text quotes untouched', async () => {
    const { scrubLeakedRiskMarker } = await loadOpenrouter()
    expect(scrubLeakedRiskMarker('Hey there.')).toBe('Hey there.')
    expect(scrubLeakedRiskMarker('  indented start')).toBe('  indented start')
    const quoted = 'The system uses a <<RISK:2>> marker internally.'
    expect(scrubLeakedRiskMarker(quoted)).toBe(quoted)
  })

  it('logs a warning when stripping a malformed preamble', async () => {
    const { engineLog } = await import('../services/diagnostics')
    const engineLogMock = vi.mocked(engineLog)
    engineLogMock.mockClear()

    mockStream([sse('<<RISK:N>>\n\nHi.'), 'data: [DONE]\n\n'])
    const stream = await loadStream()

    await stream(
      [{ role: 'user', content: 'hi' }],
      { onToken: () => {}, onRisk: () => {}, onComplete: () => {}, onError: () => {} },
    )

    const warnCalls = engineLogMock.mock.calls.filter((c) => c[0] === 'warn' && c[1] === 'stream.preamble_malformed')
    expect(warnCalls.length).toBeGreaterThanOrEqual(1)
  })
})
