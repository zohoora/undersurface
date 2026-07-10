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
        visual_risk: 0,
        response_mode: 'offer_action',
      }) } }],
    }))

    const result = await generateSmsTurn({
      text: 'Presentation in ten minutes',
      risk: 0,
      history: [{ direction: 'inbound', body: 'I expected to freeze', createdAt: 100 }],
      companionContext: {
        recentSessionNotes: [{ note: 'The writer was preparing for a presentation.', date: 100 }],
        activeValues: [{ name: 'craft', description: 'doing careful work' }],
      },
      apiKey: 'test-key',
      fetchImpl: fetchMock as typeof fetch,
    })

    expect(result).toEqual({
      reply: 'That sounds tight. What is the smallest next step?',
      fieldNote: 'Presentation anxiety immediately before speaking.',
      visualRisk: 0,
      responseMode: 'offer_action',
    })
    const init = fetchMock.mock.calls[0][1] as RequestInit
    const body = JSON.parse(String(init.body))
    expect(body.model).toBe('gpt-5.5')
    expect(body.reasoning_effort).toBe('none')
    expect(body.response_format.json_schema.name).toBe('sms_turn')
    expect(body.response_format.json_schema.schema.required).toContain('response_mode')
    expect(body.messages[0].content).toContain('carrier SMS')
    expect(body.messages[0].content).toContain('Decide how much response')
    expect(body.messages[0].content).toContain('FIELD-NOTE DECISION')
    expect(body.messages[0].content).toContain('MMS IMAGES')
    expect(body.messages[0].content).toContain('not identity evidence')
    expect(body.messages[0].content).toContain('SHARED COMPANION KERNEL')
    expect(body.messages[0].content).toContain('Notes from recent sessions')
    expect(body.messages[0].content).toContain('doing careful work')
    expect(body.messages[1].content[0].text).toContain('untrusted_recent_sms_context')
    expect(body.messages[1].content[0].text).toContain('Presentation in ten minutes')
  })

  it('does not carry a note when the model declines to save', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({
      choices: [{ message: { content: JSON.stringify({
        reply: 'I am here.',
        save: false,
        field_note: null,
        visual_risk: 0,
        response_mode: 'witness',
      }) } }],
    }))

    await expect(generateSmsTurn({
      text: 'Hi',
      risk: 0,
      history: [],
      apiKey: 'test-key',
      fetchImpl: fetchMock as typeof fetch,
    })).resolves.toEqual({ reply: 'I am here.', fieldNote: null, visualRisk: 0, responseMode: 'witness' })
  })

  it('sends image-only MMS as a multimodal content array', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({
      choices: [{ message: { content: JSON.stringify({
        reply: 'That looks like a packed waiting room. What feels most present about being there?',
        save: false,
        field_note: null,
        visual_risk: 0,
        response_mode: 'clarify',
      }) } }],
    }))

    const result = await generateSmsTurn({
      text: '',
      risk: 0,
      history: [],
      images: [{ contentType: 'image/jpeg', dataUrl: 'data:image/jpeg;base64,AQID' }],
      failedImageCount: 1,
      apiKey: 'test-key',
      fetchImpl: fetchMock as typeof fetch,
    })

    expect(result.visualRisk).toBe(0)
    const init = fetchMock.mock.calls[0][1] as RequestInit
    const body = JSON.parse(String(init.body))
    expect(body.response_format.json_schema.schema.required).toContain('visual_risk')
    expect(body.messages[1].content).toHaveLength(2)
    expect(body.messages[1].content[0].text).toContain('without a caption')
    expect(body.messages[1].content[0].text).toContain('Images that could not be loaded: 1')
    expect(body.messages[1].content[1]).toEqual({
      type: 'image_url',
      image_url: { url: 'data:image/jpeg;base64,AQID', detail: 'auto' },
    })
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
