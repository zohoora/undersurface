import { describe, it, expect, vi, beforeEach } from 'vitest'

const chatCompletionMock = vi.fn()

vi.mock('../ai/openrouter', () => ({
  chatCompletion: (...args: unknown[]) => chatCompletionMock(...args),
}))

vi.mock('../ai/partPrompts', () => ({
  languageDirective: () => '',
}))

const { generateClosingPhrase } = await import('./closingEngine')

beforeEach(() => {
  chatCompletionMock.mockReset()
})

describe('generateClosingPhrase', () => {
  it('trims the model response before returning', async () => {
    chatCompletionMock.mockResolvedValue('  Carry that with you.  \n')
    const result = await generateClosingPhrase('I wrote about the river today.')
    expect(result).toBe('Carry that with you.')
  })

  it('uses the last 600 chars of the writer text as the user message', async () => {
    chatCompletionMock.mockResolvedValue('ok')
    const longText = 'a'.repeat(2000) + 'TAIL_MARKER'
    await generateClosingPhrase(longText)
    const [messages] = chatCompletionMock.mock.calls[0]
    const userMsg = (messages as Array<{ role: string; content: string }>).find(m => m.role === 'user')!
    expect(userMsg.content.length).toBe(600)
    expect(userMsg.content.endsWith('TAIL_MARKER')).toBe(true)
  })

  it('falls back to a placeholder when text is empty (blank-page sessions)', async () => {
    chatCompletionMock.mockResolvedValue('ok')
    await generateClosingPhrase('')
    const [messages] = chatCompletionMock.mock.calls[0]
    const userMsg = (messages as Array<{ role: string; content: string }>).find(m => m.role === 'user')!
    expect(userMsg.content).toBe('The writer opened a blank page today.')
  })

  it('invokes The Weaver persona in the system prompt (load-bearing)', async () => {
    // The closing prompt is hardcoded in closingEngine.ts and intentionally
    // not behind a part-id lookup (see CLAUDE.md). If this test breaks,
    // someone changed the persona — verify the change is deliberate.
    chatCompletionMock.mockResolvedValue('ok')
    await generateClosingPhrase('today')
    const [messages] = chatCompletionMock.mock.calls[0]
    const sysMsg = (messages as Array<{ role: string; content: string }>).find(m => m.role === 'system')!
    expect(sysMsg.content).toContain('The Weaver')
  })
})
