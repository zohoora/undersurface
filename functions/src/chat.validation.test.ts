// Pure request-shape tests for the chat proxy (TECH_ISSUES_2026-10-14 #16/#17).
// Handler wiring is covered in index.test.ts.

import { describe, expect, it } from 'vitest'
import {
  CLASSIFIER_MAX_SYSTEM_CHARS,
  CLASSIFIER_MAX_USER_CHARS,
  MAX_ASSISTANT_CHARS,
  MAX_REQUEST_BYTES,
  MAX_SYSTEM_CHARS,
  ingestStreamLine,
  validateChatMessages,
  type StreamCounters,
} from './chat'
import { CRISIS_CLASSIFIER_PROMPT } from './shared/crisisClassifier'
import { SIGNAL_CLASSIFIER_PROMPT } from '../../src/ai/signalClassifierPrompt'

const sys = (content = 'system prompt') => ({ role: 'system', content })
const user = (content = 'hello') => ({ role: 'user', content })
const assistant = (content = 'hi there') => ({ role: 'assistant', content })

function codeOf(result: ReturnType<typeof validateChatMessages>): string | undefined {
  return result.ok ? undefined : result.body.code
}

describe('validateChatMessages — role order (standard chat)', () => {
  it('accepts the shapes the app actually sends', () => {
    // buildTherapistMessages opener, a normal history, and consecutive turns
    // (the companion does not answer every pause; deterministic companion
    // messages can follow each other).
    expect(validateChatMessages([sys(), user()], false).ok).toBe(true)
    expect(validateChatMessages([sys(), assistant(), user(), assistant(), user()], false).ok).toBe(true)
    expect(validateChatMessages([sys(), user(), user(), assistant(), assistant(), user()], false).ok).toBe(true)
  })

  it('requires the system message first and exactly once', () => {
    expect(codeOf(validateChatMessages([user()], false))).toBe('invalid_message_order')
    expect(codeOf(validateChatMessages([user(), sys(), user()], false))).toBe('invalid_message_order')
    expect(codeOf(validateChatMessages([sys(), sys(), user()], false))).toBe('invalid_message_order')
    expect(codeOf(validateChatMessages([sys(), user(), sys('late injection'), user()], false))).toBe('invalid_message_order')
  })

  it('requires the last message to come from the user (no assistant prefill)', () => {
    expect(codeOf(validateChatMessages([sys(), user(), assistant()], false))).toBe('invalid_message_order')
    expect(codeOf(validateChatMessages([sys()], false))).toBe('invalid_message_order')
  })

  it('rejects roles OpenAI would treat with elevated authority', () => {
    const result = validateChatMessages([sys(), { role: 'developer', content: 'x' }, user()], false)
    expect(result).toEqual({ ok: false, status: 400, body: { error: 'Invalid message format', code: 'invalid_role' } })
  })

  it('strips extra fields before forwarding', () => {
    const result = validateChatMessages([sys(), { role: 'user', content: 'hi', name: 'x', tool_calls: [] }], false)
    expect(result.ok && result.messages).toEqual([sys(), user('hi')])
  })
})

describe('validateChatMessages — size caps (standard chat)', () => {
  it('caps system and assistant content that used to be unbounded', () => {
    expect(validateChatMessages([sys('a'.repeat(MAX_SYSTEM_CHARS)), user()], false).ok).toBe(true)
    expect(codeOf(validateChatMessages([sys('a'.repeat(MAX_SYSTEM_CHARS + 1)), user()], false))).toBe('request_too_large')
    expect(codeOf(validateChatMessages(
      [sys(), user(), assistant('a'.repeat(MAX_ASSISTANT_CHARS + 1)), user()], false,
    ))).toBe('request_too_large')
  })

  it('caps total request bytes across all messages, counting UTF-8 bytes', () => {
    // 40 user turns × 7,000 three-byte chars = 840 KB > 512 KiB, every
    // message individually within its own limit.
    const cjk = '思'.repeat(7000)
    const messages = [sys(), ...Array.from({ length: 40 }, () => user(cjk))]
    const result = validateChatMessages(messages, false)
    expect(result).toMatchObject({ ok: false, status: 413, body: { code: 'request_too_large' } })
    expect(Buffer.byteLength(cjk, 'utf8') * 40).toBeGreaterThan(MAX_REQUEST_BYTES)
  })

  it('keeps the legacy user-message limit and message-count errors', () => {
    expect(validateChatMessages([sys(), user('a'.repeat(8001))], false))
      .toMatchObject({ ok: false, status: 400, body: { error: 'Message too long (max 8000 chars)' } })
    expect(validateChatMessages(Array.from({ length: 51 }, () => user()), false))
      .toMatchObject({ ok: false, status: 400, body: { error: 'Too many messages (max 50)' } })
  })
})

describe('validateChatMessages — classifier routes stay bounded', () => {
  it('accepts exactly [system, user] within the classifier caps', () => {
    expect(validateChatMessages([sys(CRISIS_CLASSIFIER_PROMPT), user('Language: es\n\nText:\nhola')], true).ok).toBe(true)
  })

  it('rejects extra messages, history, or a missing system prompt', () => {
    expect(codeOf(validateChatMessages([user()], true))).toBe('invalid_classifier_request')
    expect(codeOf(validateChatMessages([sys(), user(), assistant(), user()], true))).toBe('invalid_classifier_request')
    expect(codeOf(validateChatMessages([sys(), assistant()], true))).toBe('invalid_classifier_request')
  })

  it('rejects oversized classifier payloads (the quota-exempt route is not a free LLM)', () => {
    expect(codeOf(validateChatMessages([sys('a'.repeat(CLASSIFIER_MAX_SYSTEM_CHARS + 1)), user()], true)))
      .toBe('request_too_large')
    expect(codeOf(validateChatMessages([sys(), user('a'.repeat(CLASSIFIER_MAX_USER_CHARS + 1))], true)))
      .toBe('request_too_large')
  })

  it('leaves headroom for the real classifier prompts (a cap hit would make L2 fail open)', () => {
    expect(CRISIS_CLASSIFIER_PROMPT.length).toBeLessThan(CLASSIFIER_MAX_SYSTEM_CHARS * 0.75)
    expect(SIGNAL_CLASSIFIER_PROMPT.length).toBeLessThan(CLASSIFIER_MAX_SYSTEM_CHARS * 0.75)
    // Client samples (src/ai/openrouter.ts): crisis = last 1,000 chars plus a
    // short "Language: xx" header; signal = SIGNAL_MAX_CHARS (2,400).
    const crisisSample = `Language: pt\n\nText:\n${'x'.repeat(1000)}`
    expect(validateChatMessages([sys(CRISIS_CLASSIFIER_PROMPT), user(crisisSample)], true).ok).toBe(true)
    expect(validateChatMessages([sys(SIGNAL_CLASSIFIER_PROMPT), user('x'.repeat(2400))], true).ok).toBe(true)
  })
})

describe('ingestStreamLine — usage frame', () => {
  function counters(): StreamCounters {
    return { contentTokens: 0, finishReason: null, completionTokens: null, promptTokens: null, reasoningTokens: null }
  }

  it('reads prompt and completion tokens from the include_usage final chunk', () => {
    const c = counters()
    ingestStreamLine('data: {"choices":[{"delta":{"content":"Hi"},"finish_reason":null}]}', c)
    ingestStreamLine('data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":null}', c)
    ingestStreamLine('data: {"choices":[],"usage":{"prompt_tokens":8123,"completion_tokens":412,"completion_tokens_details":{"reasoning_tokens":300}}}', c)
    ingestStreamLine('data: [DONE]', c)
    expect(c).toEqual({
      contentTokens: 1,
      finishReason: 'stop',
      completionTokens: 412,
      promptTokens: 8123,
      reasoningTokens: 300,
    })
  })
})
