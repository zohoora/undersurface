import { describe, it, expect, vi, beforeEach } from 'vitest'
import { extractCompletedSentence, correctSentence, _resetThrottle, isCJK, shouldTriggerAutocorrect } from './llmCorrect'

// Mock firebase/auth
vi.mock('firebase/auth', () => ({
  getAuth: () => ({
    currentUser: { getIdToken: () => Promise.resolve('mock-token') },
  }),
}))

// Mock i18n
vi.mock('../i18n', () => ({
  getLLMLanguageName: () => 'English',
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

  // CJK tests
  it('extracts Chinese sentence ending with 。', () => {
    const result = extractCompletedSentence('我今天去了超市。下一句话')
    expect(result).toEqual({
      sentence: '我今天去了超市。',
      start: 0,
      end: 8,
    })
  })

  it('extracts Japanese sentence ending with 。', () => {
    const result = extractCompletedSentence('今日は公園に行きました。次の文')
    expect(result).toEqual({
      sentence: '今日は公園に行きました。',
      start: 0,
      end: 12,
    })
  })

  it('extracts CJK sentence after ！', () => {
    const result = extractCompletedSentence('太棒了！接着写')
    expect(result).toEqual({
      sentence: '太棒了！',
      start: 0,
      end: 4,
    })
  })

  it('skips short CJK sentences (< 4 chars)', () => {
    const result = extractCompletedSentence('好的。 ')
    expect(result).toBeNull()
  })

  it('handles multiple CJK sentences (extracts last)', () => {
    const result = extractCompletedSentence('第一句话结束了。第二句话也结束了。继续')
    expect(result).toEqual({
      sentence: '第二句话也结束了。',
      start: 8,
      end: 17,
    })
  })

  // Hindi tests
  it('extracts Hindi sentence ending with danda ।', () => {
    const result = extractCompletedSentence('मैंने आज बहुत काम किया। ')
    expect(result).toEqual({
      sentence: 'मैंने आज बहुत काम किया।',
      start: 0,
      end: 23,
    })
  })

  // Thai test — no punctuation, graceful skip
  it('returns null for Thai text (no standard sentence punctuation)', () => {
    const result = extractCompletedSentence('ฉันไปที่ร้านค้า ')
    expect(result).toBeNull()
  })

  // Non-English abbreviation tests
  it('skips French abbreviation Mme.', () => {
    const result = extractCompletedSentence('Bonjour Mme. ')
    expect(result).toBeNull()
  })

  it('skips Spanish abbreviation Sra.', () => {
    const result = extractCompletedSentence('Hola Sra. ')
    expect(result).toBeNull()
  })

  it('skips German abbreviation z.b.', () => {
    const result = extractCompletedSentence('Zum Beispiel z.b. ')
    expect(result).toBeNull()
  })
})

describe('isCJK', () => {
  it('detects Chinese characters', () => {
    expect(isCJK('我今天去了超市')).toBe(true)
  })

  it('detects Japanese hiragana', () => {
    expect(isCJK('こんにちは')).toBe(true)
  })

  it('detects Japanese katakana', () => {
    expect(isCJK('カタカナ')).toBe(true)
  })

  it('returns false for English text', () => {
    expect(isCJK('Hello world')).toBe(false)
  })

  it('returns false for Hindi text', () => {
    expect(isCJK('नमस्ते')).toBe(false)
  })
})

describe('shouldTriggerAutocorrect', () => {
  it('triggers on space after period', () => {
    expect(shouldTriggerAutocorrect(' ', 'Hello world.')).toBe(true)
  })

  it('triggers on space after Hindi danda', () => {
    expect(shouldTriggerAutocorrect(' ', 'मैंने काम किया।')).toBe(true)
  })

  it('triggers on space after CJK fullwidth period', () => {
    expect(shouldTriggerAutocorrect(' ', '我去了超市。')).toBe(true)
  })

  it('triggers on next character after CJK fullwidth period', () => {
    expect(shouldTriggerAutocorrect('下', '我去了超市。')).toBe(true)
  })

  it('does not trigger on CJK punct after CJK punct', () => {
    expect(shouldTriggerAutocorrect('。', '我去了超市。')).toBe(false)
  })

  it('does not trigger on space without preceding punctuation', () => {
    expect(shouldTriggerAutocorrect(' ', 'Hello world')).toBe(false)
  })

  it('does not trigger on regular character after Latin period', () => {
    // Latin text uses space as trigger, not next char
    expect(shouldTriggerAutocorrect('N', 'Hello world.')).toBe(false)
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

  it('returns null when word count differs greatly (hallucination)', async () => {
    _resetThrottle()
    mockApiResponse('I went to the store and bought some groceries for the whole family.')
    const result = await correctSentence('I went to teh store yestreday.')
    expect(result).toBeNull()
  })

  it('allows small word count differences (split words)', async () => {
    _resetThrottle()
    mockApiResponse('I am not sure why I am feeling this way.')
    const result = await correctSentence('I am nt o s ure wyh I am feeeieng this awy.')
    expect(result).toBe('I am not sure why I am feeling this way.')
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

  it('skips word-count validation for CJK text', async () => {
    _resetThrottle()
    // CJK correction that changes characters but not length significantly
    mockApiResponse('我今天去了超市买了很多东西。')
    const result = await correctSentence('我今天去了超市买了很多东西。')
    // Same text = no correction needed
    expect(result).toBeNull()
  })

  it('accepts CJK correction with different word segmentation', async () => {
    _resetThrottle()
    // Word count would differ wildly for CJK but that's expected
    mockApiResponse('我今天去了超市。')
    const result = await correctSentence('我今天去了趄市。')
    expect(result).toBe('我今天去了超市。')
  })
})
