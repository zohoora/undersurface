import { describe, it, expect, vi, beforeEach } from 'vitest'
import { extractCompletedSentence, correctSentence, _resetThrottle } from './llmCorrect'

// Mock firebase/auth
vi.mock('firebase/auth', () => ({
  getAuth: () => ({
    currentUser: { getIdToken: () => Promise.resolve('mock-token') },
  }),
}))

// Mock global fetch for correctSentence tests
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

beforeEach(() => {
  vi.clearAllMocks()
  _resetThrottle()
})

describe('extractCompletedSentence', () => {
  it('extracts sentence after ". "', () => {
    const result = extractCompletedSentence('I went to the store. ')
    expect(result).toEqual({
      sentence: 'I went to the store.',
      start: 0,
      end: 20,
    })
  })

  it('extracts sentence after "? "', () => {
    const result = extractCompletedSentence('Did you go to the store? ')
    expect(result).toEqual({
      sentence: 'Did you go to the store?',
      start: 0,
      end: 24,
    })
  })

  it('extracts sentence after "! "', () => {
    const result = extractCompletedSentence('What a great day! ')
    expect(result).toEqual({
      sentence: 'What a great day!',
      start: 0,
      end: 17,
    })
  })

  it('handles paragraph start as sentence start', () => {
    const result = extractCompletedSentence('This is a test sentence. ')
    expect(result).toEqual({
      sentence: 'This is a test sentence.',
      start: 0,
      end: 24,
    })
  })

  it('handles multiple sentences (extracts last completed one)', () => {
    const result = extractCompletedSentence('The first one ended. The second one also ended. ')
    expect(result).toEqual({
      sentence: 'The second one also ended.',
      start: 21,
      end: 47,
    })
  })

  it('skips abbreviations like Dr.', () => {
    const result = extractCompletedSentence('I visited Dr. ')
    expect(result).toBeNull()
  })

  it('skips abbreviations like etc.', () => {
    const result = extractCompletedSentence('Cats, dogs, etc. ')
    expect(result).toBeNull()
  })

  it('skips abbreviations like e.g.', () => {
    const result = extractCompletedSentence('Some animals e.g. ')
    expect(result).toBeNull()
  })

  it('skips ellipsis', () => {
    const result = extractCompletedSentence('I was thinking... ')
    expect(result).toBeNull()
  })

  it('skips short sentences (< 3 words)', () => {
    const result = extractCompletedSentence('Hi there. ')
    expect(result).toBeNull()
  })

  it('returns null when no sentence ending found', () => {
    const result = extractCompletedSentence('I am still typing')
    expect(result).toBeNull()
  })

  it('returns null for just a period without space after', () => {
    const result = extractCompletedSentence('I went to the store.')
    expect(result).toBeNull()
  })
})

describe('correctSentence', () => {
  function mockApiResponse(content: string, ok = true) {
    mockFetch.mockResolvedValueOnce({
      ok,
      json: () => Promise.resolve({
        choices: [{ message: { content } }],
      }),
    })
  }

  it('returns corrected text on valid correction', async () => {
    mockApiResponse('I went to the store yesterday.')
    const result = await correctSentence('I went to teh store yestreday.')
    expect(result).toBe('I went to the store yesterday.')
  })

  it('returns null when text unchanged', async () => {
    _resetThrottle()
    mockApiResponse('The morning light was beautiful.')
    const result = await correctSentence('The morning light was beautiful.')
    expect(result).toBeNull()
  })

  it('returns null when word count differs (hallucination)', async () => {
    _resetThrottle()
    mockApiResponse('I went to the store yesterday morning.')
    const result = await correctSentence('I went to teh store yestreday.')
    expect(result).toBeNull()
  })

  it('returns null when length ratio exceeds 30%', async () => {
    _resetThrottle()
    mockApiResponse('I went to the store yesterday and bought some things.')
    const result = await correctSentence('I went to the store.')
    expect(result).toBeNull()
  })

  it('returns null on API error', async () => {
    _resetThrottle()
    mockFetch.mockResolvedValueOnce({ ok: false })
    const result = await correctSentence('I went to teh store.')
    expect(result).toBeNull()
  })

  it('returns null on fetch failure', async () => {
    _resetThrottle()
    mockFetch.mockRejectedValueOnce(new Error('Network error'))
    const result = await correctSentence('I went to teh store.')
    expect(result).toBeNull()
  })

  it('strips markdown backticks from response', async () => {
    _resetThrottle()
    mockApiResponse('```\nI went to the store yesterday.\n```')
    const result = await correctSentence('I went to teh store yestreday.')
    expect(result).toBe('I went to the store yesterday.')
  })

  it('strips surrounding quotes from response', async () => {
    _resetThrottle()
    mockApiResponse('"I went to the store yesterday."')
    const result = await correctSentence('I went to teh store yestreday.')
    expect(result).toBe('I went to the store yesterday.')
  })
})
