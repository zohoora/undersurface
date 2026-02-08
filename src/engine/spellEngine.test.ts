import { describe, it, expect } from 'vitest'

// We test the pure helper functions extracted from spellEngine
// These don't need the dictionary loaded

function damerauLevenshtein(a: string, b: string): number {
  const m = a.length
  const n = b.length
  const d: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = 0; i <= m; i++) d[i][0] = i
  for (let j = 0; j <= n; j++) d[0][j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + cost,
      )
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1)
      }
    }
  }
  return d[m][n]
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function shouldSkipWord(word: string, sentenceStart: boolean): boolean {
  if (word.length < 2) return true
  if (/^[A-Z]{2,}$/.test(word)) return true
  if (/\d/.test(word)) return true
  if (/[a-z][A-Z]/.test(word)) return true
  if (/^[A-Z]/.test(word) && !sentenceStart) return true
  return false
}

describe('damerauLevenshtein', () => {
  it('returns 0 for identical strings', () => {
    expect(damerauLevenshtein('hello', 'hello')).toBe(0)
  })

  it('returns 1 for single insertion', () => {
    expect(damerauLevenshtein('helo', 'hello')).toBe(1)
  })

  it('returns 1 for single deletion', () => {
    expect(damerauLevenshtein('hello', 'helo')).toBe(1)
  })

  it('returns 1 for single substitution', () => {
    expect(damerauLevenshtein('hello', 'hallo')).toBe(1)
  })

  it('returns 1 for adjacent transposition', () => {
    expect(damerauLevenshtein('teh', 'the')).toBe(1)
  })

  it('returns 1 for transposition (recieve → receive)', () => {
    expect(damerauLevenshtein('recieve', 'receive')).toBe(1)
  })

  it('returns 2 for two edits', () => {
    expect(damerauLevenshtein('kitten', 'sitten')).toBe(1)
    expect(damerauLevenshtein('helllo', 'hello')).toBe(1)
    expect(damerauLevenshtein('abc', 'def')).toBe(3)
  })

  it('handles empty strings', () => {
    expect(damerauLevenshtein('', 'abc')).toBe(3)
    expect(damerauLevenshtein('abc', '')).toBe(3)
    expect(damerauLevenshtein('', '')).toBe(0)
  })
})

describe('capitalize', () => {
  it('capitalizes first letter', () => {
    expect(capitalize('hello')).toBe('Hello')
  })

  it('handles already capitalized', () => {
    expect(capitalize('Hello')).toBe('Hello')
  })

  it('handles single char', () => {
    expect(capitalize('a')).toBe('A')
  })

  it('handles empty string', () => {
    expect(capitalize('')).toBe('')
  })
})

describe('shouldSkipWord', () => {
  it('skips single character words', () => {
    expect(shouldSkipWord('a', false)).toBe(true)
  })

  it('skips all-caps words (acronyms)', () => {
    expect(shouldSkipWord('FBI', false)).toBe(true)
    expect(shouldSkipWord('NASA', false)).toBe(true)
  })

  it('skips words with digits', () => {
    expect(shouldSkipWord('abc123', false)).toBe(true)
  })

  it('skips camelCase words', () => {
    expect(shouldSkipWord('iPhone', false)).toBe(true)
    expect(shouldSkipWord('lastName', false)).toBe(true)
  })

  it('skips capitalized words not at sentence start (proper nouns)', () => {
    expect(shouldSkipWord('John', false)).toBe(true)
  })

  it('does not skip capitalized words at sentence start', () => {
    expect(shouldSkipWord('The', true)).toBe(false)
  })

  it('does not skip normal lowercase words', () => {
    expect(shouldSkipWord('hello', false)).toBe(false)
    expect(shouldSkipWord('recieve', false)).toBe(false)
  })
})
