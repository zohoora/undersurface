import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('firebase/auth', () => ({
  getAuth: vi.fn(() => ({
    currentUser: {
      getIdToken: vi.fn(() => Promise.resolve('mock-token')),
    },
  })),
}))

vi.mock('../store/settings', () => ({
  getSettings: vi.fn(() => ({
    openRouterModel: 'test-model',
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
    // Re-mock after resetModules
    vi.doMock('firebase/auth', () => ({
      getAuth: vi.fn(() => ({
        currentUser: {
          getIdToken: vi.fn(() => Promise.resolve('mock-token')),
        },
      })),
    }))
    vi.doMock('../store/settings', () => ({
      getSettings: vi.fn(() => ({
        openRouterModel: 'test-model',
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
      .rejects.toThrow('Empty response from OpenRouter')
  })

  it('throws on missing message content', async () => {
    mockFetch({ choices: [{ message: {} }] })
    const chatCompletion = await loadChatCompletion()

    await expect(chatCompletion([{ role: 'user', content: 'Hi' }]))
      .rejects.toThrow('Empty response from OpenRouter')
  })

  it('throws on null choices', async () => {
    mockFetch({ choices: null })
    const chatCompletion = await loadChatCompletion()

    await expect(chatCompletion([{ role: 'user', content: 'Hi' }]))
      .rejects.toThrow('Empty response from OpenRouter')
  })

  it('throws on non-ok response', async () => {
    mockFetch('Internal Server Error', false, 500)
    const chatCompletion = await loadChatCompletion()

    await expect(chatCompletion([{ role: 'user', content: 'Hi' }]))
      .rejects.toThrow('API error: 500')
  })
})
