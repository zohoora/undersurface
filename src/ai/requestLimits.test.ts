import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  fitToServerLimits,
  SERVER_MAX_ASSISTANT_CHARS,
  SERVER_MAX_MESSAGES,
  SERVER_MAX_REQUEST_BYTES,
  SERVER_MAX_USER_CHARS,
  trimToBudget,
  type LimitedMessage,
} from './requestLimits'
import { buildTherapistMessages } from './therapistPrompts'
import type { SessionMessage } from '../types'

const bytes = (messages: LimitedMessage[]) =>
  messages.reduce((sum, m) => sum + new TextEncoder().encode(m.content).length, 0)

// What validateChatMessages (functions/src/chat.ts) would reject.
function serverWouldReject(messages: LimitedMessage[]): string | null {
  if (messages.length > SERVER_MAX_MESSAGES) return 'too many messages'
  for (const m of messages) {
    if (m.role === 'user' && m.content.length > SERVER_MAX_USER_CHARS) return 'user message too long'
    if (m.role === 'assistant' && m.content.length > SERVER_MAX_ASSISTANT_CHARS) return 'assistant message too long'
  }
  if (bytes(messages) > SERVER_MAX_REQUEST_BYTES) return 'request too large'
  return null
}

describe('the limits mirror the chat function', () => {
  const source = readFileSync(resolve(__dirname, '../../functions/src/chat.ts'), 'utf8')
  const value = (name: string) => {
    const match = source.match(new RegExp(`const ${name} = ([0-9_* ]+)\\n`))
    if (!match) throw new Error(`${name} not found in functions/src/chat.ts`)
    return Function(`return ${match[1].replace(/_/g, '')}`)() as number
  }

  it.each([
    ['MAX_MESSAGE_CHARS', SERVER_MAX_USER_CHARS],
    ['MAX_ASSISTANT_CHARS', SERVER_MAX_ASSISTANT_CHARS],
    ['MAX_MESSAGES', SERVER_MAX_MESSAGES],
    ['MAX_REQUEST_BYTES', SERVER_MAX_REQUEST_BYTES],
  ])('%s', (name, mirrored) => {
    expect(value(name)).toBe(mirrored)
  })
})

describe('trimToBudget', () => {
  it('leaves text within the budget untouched', () => {
    expect(trimToBudget('short', 100)).toBe('short')
  })

  it('keeps the opening and the ending, says how much is left out, and fits', () => {
    const text = `START ${'a'.repeat(5_000)}${'b'.repeat(5_000)} END`
    const trimmed = trimToBudget(text, 2_000)
    expect(trimmed.length).toBeLessThanOrEqual(2_000)
    expect(trimmed.startsWith('START ')).toBe(true)
    expect(trimmed.endsWith(' END')).toBe(true)
    const omitted = Number(trimmed.match(/\[… (\d+) characters left out/)?.[1])
    expect(trimmed.length - trimmed.match(/\n\n\[…[^\]]*\]\n\n/)![0].length + omitted).toBe(text.length)
  })

  it('never splits a surrogate pair', () => {
    const text = '🙂'.repeat(5_000)
    const trimmed = trimToBudget(text, 1_001)
    expect(trimmed.length).toBeLessThanOrEqual(1_001)
    expect(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(trimmed)).toBe(false)
  })
})

describe('fitToServerLimits', () => {
  it('returns the same array when the request already fits', () => {
    const messages: LimitedMessage[] = [{ role: 'system', content: 'sys' }, { role: 'user', content: 'hi' }]
    expect(fitToServerLimits(messages)).toBe(messages)
  })

  it('never trims the system prompt', () => {
    const system = 's'.repeat(40_000)
    const fitted = fitToServerLimits([{ role: 'system', content: system }, { role: 'user', content: 'u'.repeat(20_000) }])
    expect(fitted[0].content).toBe(system)
    expect(fitted[1].content.length).toBeLessThan(SERVER_MAX_USER_CHARS)
  })

  it('drops the oldest history, never the latest message, when there are too many', () => {
    const messages: LimitedMessage[] = [{ role: 'system', content: 'sys' }]
    for (let i = 0; i < 60; i++) messages.push({ role: i % 2 ? 'assistant' : 'user', content: `turn ${i}` })
    messages.push({ role: 'user', content: 'latest' })
    const fitted = fitToServerLimits(messages)
    expect(fitted.length).toBe(SERVER_MAX_MESSAGES)
    expect(fitted[0].role).toBe('system')
    expect(fitted.at(-1)!.content).toBe('latest')
    expect(fitted[1].content).toBe(`turn ${60 - (SERVER_MAX_MESSAGES - 2)}`)
  })

  it('stays under the byte limit for long Japanese turns', () => {
    const messages: LimitedMessage[] = [{ role: 'system', content: 'sys' }]
    for (let i = 0; i < 30; i++) {
      messages.push({ role: 'user', content: '今日は長い一日だった。'.repeat(900) })
      messages.push({ role: 'assistant', content: 'はい。' })
    }
    messages.push({ role: 'user', content: '最後に' })
    expect(serverWouldReject(messages)).not.toBeNull()
    const fitted = fitToServerLimits(messages)
    expect(serverWouldReject(fitted)).toBeNull()
    expect(fitted.at(-1)!.content).toBe('最後に')
  })
})

describe('a Talk history with one long message', () => {
  const at = Date.UTC(2026, 10, 18, 15, 0)
  const turn = (id: string, speaker: SessionMessage['speaker'], content: string): SessionMessage => ({
    id, speaker, content, partId: null, partName: null, timestamp: at, phase: 'opening', isEmergence: false,
  })

  it('used to break the server limit and now fits', () => {
    const history = [
      turn('1', 'therapist', 'What would you like to bring today?'),
      turn('2', 'user', `I wrote my father a letter I will never send. ${'I keep going back over that summer. '.repeat(300)}`),
      turn('3', 'therapist', 'Thank you for trusting me with that.'),
      turn('4', 'user', 'Can we talk about the ending?'),
    ]
    const built = buildTherapistMessages(history, {} as Parameters<typeof buildTherapistMessages>[1])
    expect(serverWouldReject(built)).toBe('user message too long')
    const fitted = fitToServerLimits(built)
    expect(serverWouldReject(fitted)).toBeNull()
    expect(fitted.at(-1)!.content).toContain('Can we talk about the ending?')
    expect(fitted.find((m) => m.content.includes('a letter I will never send'))!.content).toContain('characters left out')
  })
})
