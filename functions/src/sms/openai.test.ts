import { describe, expect, it, vi } from 'vitest'
import { classifySmsCrisis, generateSmsTurn } from './openai'

function response(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as Response
}

describe('SMS OpenAI adapter', () => {
  it('uses the calibrated structured classifier contract', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({
      choices: [{ message: { content: '{"risk":1,"reason":"ambiguous finality"}' } }],
    }))

    const result = await classifySmsCrisis('I do not think I can keep going', 'test-key', fetchMock as typeof fetch)

    expect(result).toEqual({ risk: 1, reason: 'ambiguous finality' })
    const init = fetchMock.mock.calls[0][1] as RequestInit
    const body = JSON.parse(String(init.body))
    expect(body.model).toBe('gpt-5-nano')
    expect(body.response_format.json_schema.name).toBe('crisis_risk')
    expect(body.reasoning_effort).toBe('minimal')
  })

  it('fails open when the classifier is unavailable or malformed', async () => {
    const unavailable = vi.fn().mockResolvedValue(response({}, false, 503))
    const malformed = vi.fn().mockResolvedValue(response({ choices: [{ message: { content: 'nope' } }] }))

    await expect(classifySmsCrisis('text', 'key', unavailable as typeof fetch)).resolves.toEqual({ risk: 0 })
    await expect(classifySmsCrisis('text', 'key', malformed as typeof fetch)).resolves.toEqual({ risk: 0 })
  })

  it('lets gpt-5.5 choose SMS length and a durable field note through structured output', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({
      choices: [{ message: { content: JSON.stringify({
        reply: '**That sounds tight.** What is the smallest next step?',
        save: true,
        field_note: 'Presentation anxiety immediately before speaking.',
      }) } }],
    }))

    const result = await generateSmsTurn({
      text: 'Presentation in ten minutes',
      risk: 0,
      history: [{ direction: 'inbound', body: 'I expected to freeze', createdAt: 100 }],
      apiKey: 'test-key',
      fetchImpl: fetchMock as typeof fetch,
    })

    expect(result).toEqual({
      reply: 'That sounds tight. What is the smallest next step?',
      fieldNote: 'Presentation anxiety immediately before speaking.',
    })
    const init = fetchMock.mock.calls[0][1] as RequestInit
    const body = JSON.parse(String(init.body))
    expect(body.model).toBe('gpt-5.5')
    expect(body.reasoning_effort).toBe('none')
    expect(body.response_format.json_schema.name).toBe('sms_turn')
    expect(body.messages[0].content).toContain('carrier SMS')
    expect(body.messages[0].content).toContain('Decide how much response')
    expect(body.messages[0].content).toContain('FIELD-NOTE DECISION')
    expect(body.messages[0].content).toContain('not identity evidence')
    expect(body.messages[1].content).toContain('untrusted_recent_sms_context')
    expect(body.messages[1].content).toContain('Presentation in ten minutes')
  })

  it('does not carry a note when the model declines to save', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({
      choices: [{ message: { content: JSON.stringify({
        reply: 'I am here.',
        save: false,
        field_note: null,
      }) } }],
    }))

    await expect(generateSmsTurn({
      text: 'Hi',
      risk: 0,
      history: [],
      apiKey: 'test-key',
      fetchImpl: fetchMock as typeof fetch,
    })).resolves.toEqual({ reply: 'I am here.', fieldNote: null })
  })

  it('rejects malformed structured turn output', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({
      choices: [{ message: { content: '{"reply":"hello"}' } }],
    }))

    await expect(generateSmsTurn({
      text: 'Hi',
      risk: 0,
      history: [],
      apiKey: 'test-key',
      fetchImpl: fetchMock as typeof fetch,
    })).rejects.toThrow('openai_malformed')
  })
})
