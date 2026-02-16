import { describe, it, expect } from 'vitest'
import { parseAnnotations, isDelimiterPrefix, DELIMITER, fixGhostCapitalization } from './annotationParser'

describe('parseAnnotations', () => {
  it('returns full text as thought when no delimiter present', () => {
    const result = parseAnnotations('This is a normal thought.')
    expect(result.thoughtText).toBe('This is a normal thought.')
    expect(result.annotations).toBeNull()
  })

  it('parses highlights and ghost text after delimiter', () => {
    const input = 'Stay with that feeling.\n\n---annotations---\n{"highlights": ["that feeling"], "ghostText": "and let it breathe"}'
    const result = parseAnnotations(input)
    expect(result.thoughtText).toBe('Stay with that feeling.')
    expect(result.annotations).not.toBeNull()
    expect(result.annotations?.highlights).toEqual(['that feeling'])
    expect(result.annotations?.ghostText).toBe(' and let it breathe')
  })

  it('handles highlights only (no ghost text)', () => {
    const input = 'Keep going.\n---annotations---\n{"highlights": ["miss them", "the silence"]}'
    const result = parseAnnotations(input)
    expect(result.thoughtText).toBe('Keep going.')
    expect(result.annotations?.highlights).toEqual(['miss them', 'the silence'])
    expect(result.annotations?.ghostText).toBeUndefined()
  })

  it('handles ghost text only (no highlights)', () => {
    const input = 'Go deeper.\n---annotations---\n{"ghostText": "because I know"}'
    const result = parseAnnotations(input)
    expect(result.thoughtText).toBe('Go deeper.')
    expect(result.annotations?.ghostText).toBe(' because I know')
    expect(result.annotations?.highlights).toBeUndefined()
  })

  it('caps highlights at 5', () => {
    const highlights = ['a', 'b', 'c', 'd', 'e', 'f', 'g']
    const input = `Thought.\n---annotations---\n${JSON.stringify({ highlights })}`
    const result = parseAnnotations(input)
    expect(result.annotations?.highlights).toHaveLength(5)
  })

  it('caps ghost text at 80 characters', () => {
    const longGhost = 'a'.repeat(120)
    const input = `Thought.\n---annotations---\n${JSON.stringify({ ghostText: longGhost })}`
    const result = parseAnnotations(input)
    expect(result.annotations?.ghostText).toHaveLength(80)
  })

  it('ensures ghost text starts with a space', () => {
    const input = 'Thought.\n---annotations---\n{"ghostText": "and kept going"}'
    const result = parseAnnotations(input)
    expect(result.annotations?.ghostText).toBe(' and kept going')
  })

  it('preserves existing leading space on ghost text', () => {
    const input = 'Thought.\n---annotations---\n{"ghostText": " The sun was warm."}'
    const result = parseAnnotations(input)
    expect(result.annotations?.ghostText).toBe(' The sun was warm.')
  })

  it('handles malformed JSON gracefully', () => {
    const input = 'Thought.\n---annotations---\n{not valid json}'
    const result = parseAnnotations(input)
    expect(result.thoughtText).toBe('Thought.')
    expect(result.annotations).toBeNull()
  })

  it('handles empty JSON object', () => {
    const input = 'Thought.\n---annotations---\n{}'
    const result = parseAnnotations(input)
    expect(result.thoughtText).toBe('Thought.')
    expect(result.annotations).toBeNull()
  })

  it('filters out empty string highlights', () => {
    const input = 'Thought.\n---annotations---\n{"highlights": ["valid", "", "  ", "also valid"]}'
    const result = parseAnnotations(input)
    expect(result.annotations?.highlights).toEqual(['valid', 'also valid'])
  })

  it('handles non-string highlights gracefully', () => {
    const input = 'Thought.\n---annotations---\n{"highlights": ["valid", 42, null, "ok"]}'
    const result = parseAnnotations(input)
    expect(result.annotations?.highlights).toEqual(['valid', 'ok'])
  })

  it('trims whitespace from thought text', () => {
    const input = '  Thought with spaces.  \n---annotations---\n{"highlights": ["spaces"]}'
    const result = parseAnnotations(input)
    expect(result.thoughtText).toBe('Thought with spaces.')
  })

  it('handles delimiter at very start (empty thought)', () => {
    const input = '---annotations---\n{"highlights": ["something"]}'
    const result = parseAnnotations(input)
    expect(result.thoughtText).toBe('')
    expect(result.annotations?.highlights).toEqual(['something'])
  })

  it('splits on first delimiter occurrence', () => {
    const input = 'Thought.\n---annotations---\n{"highlights": ["a"]}'
    const result = parseAnnotations(input)
    expect(result.thoughtText).toBe('Thought.')
    expect(result.annotations?.highlights).toEqual(['a'])
  })
})

describe('isDelimiterPrefix', () => {
  it('returns true for valid prefixes', () => {
    expect(isDelimiterPrefix('-')).toBe(true)
    expect(isDelimiterPrefix('--')).toBe(true)
    expect(isDelimiterPrefix('---')).toBe(true)
    expect(isDelimiterPrefix('---a')).toBe(true)
    expect(isDelimiterPrefix('---an')).toBe(true)
    expect(isDelimiterPrefix(DELIMITER)).toBe(true)
  })

  it('returns false for non-prefixes', () => {
    expect(isDelimiterPrefix('x')).toBe(false)
    expect(isDelimiterPrefix('---x')).toBe(false)
    expect(isDelimiterPrefix('hello')).toBe(false)
  })

  it('returns true for partial delimiter matches', () => {
    // '---annotation' IS a valid prefix of '---annotations---'
    expect(isDelimiterPrefix('---annotation')).toBe(true)
    expect(isDelimiterPrefix('---annotations')).toBe(true)
    expect(isDelimiterPrefix('---annotations-')).toBe(true)
  })

  it('returns false if longer than delimiter', () => {
    expect(isDelimiterPrefix(DELIMITER + 'x')).toBe(false)
  })
})

describe('fixGhostCapitalization', () => {
  // --- English basics ---
  it('capitalizes after period', () => {
    expect(fixGhostCapitalization(' even if I try', 'make it all happen.')).toBe(' Even if I try')
  })

  it('capitalizes after exclamation mark', () => {
    expect(fixGhostCapitalization(' maybe next time', 'I can do this!')).toBe(' Maybe next time')
  })

  it('capitalizes after question mark', () => {
    expect(fixGhostCapitalization(' probably not', 'Is that even real?')).toBe(' Probably not')
  })

  it('lowercases mid-sentence', () => {
    expect(fixGhostCapitalization(' And the sky', 'I looked up at')).toBe(' and the sky')
  })

  it('handles trailing whitespace in writer text', () => {
    expect(fixGhostCapitalization(' even so', 'I finished it.   ')).toBe(' Even so')
  })

  it('preserves leading space', () => {
    expect(fixGhostCapitalization(' hello', 'Done.')).toBe(' Hello')
  })

  it('handles empty ghost text', () => {
    expect(fixGhostCapitalization('', 'Done.')).toBe('')
  })

  it('handles punctuation followed by closing quote', () => {
    expect(fixGhostCapitalization(' then I', 'she said "go."')).toBe(' Then I')
  })

  it('leaves non-letter starts unchanged', () => {
    expect(fixGhostCapitalization(' ...maybe', 'Done.')).toBe(' ...maybe')
  })

  // --- Russian (Cyrillic capitalization) ---
  it('capitalizes Cyrillic after period', () => {
    expect(fixGhostCapitalization(' может быть', 'Я закончил.')).toBe(' Может быть')
  })

  it('lowercases Cyrillic mid-sentence', () => {
    expect(fixGhostCapitalization(' Может быть', 'Я смотрю на')).toBe(' может быть')
  })

  // --- Japanese (no capitalization, CJK period 。) ---
  it('passes through Japanese unchanged after 。', () => {
    expect(fixGhostCapitalization(' それでも', '終わった。')).toBe(' それでも')
  })

  it('passes through Japanese unchanged mid-sentence', () => {
    expect(fixGhostCapitalization(' それでも', '私は思う')).toBe(' それでも')
  })

  // --- Chinese (no capitalization, CJK period 。) ---
  it('passes through Chinese unchanged after 。', () => {
    expect(fixGhostCapitalization(' 也许', '我完成了。')).toBe(' 也许')
  })

  // --- Korean (no capitalization) ---
  it('passes through Korean unchanged after period', () => {
    expect(fixGhostCapitalization(' 그래도', '끝났다.')).toBe(' 그래도')
  })

  // --- Thai (no capitalization, no sentence-ending punctuation typically) ---
  it('passes through Thai unchanged', () => {
    expect(fixGhostCapitalization(' แม้ว่า', 'ฉันเสร็จแล้ว')).toBe(' แม้ว่า')
  })

  // --- Hindi (Devanagari, purna viram ।) ---
  it('passes through Hindi unchanged after purna viram', () => {
    expect(fixGhostCapitalization(' शायद', 'मैंने किया।')).toBe(' शायद')
  })

  // --- German (Latin, same punctuation as English) ---
  it('capitalizes German after period', () => {
    expect(fixGhostCapitalization(' vielleicht', 'Ich bin fertig.')).toBe(' Vielleicht')
  })

  it('lowercases German mid-sentence', () => {
    expect(fixGhostCapitalization(' Vielleicht', 'Ich schaue auf')).toBe(' vielleicht')
  })

  // --- French (closing guillemet ») ---
  it('capitalizes after period + closing guillemet', () => {
    expect(fixGhostCapitalization(' peut-être', 'elle a dit « oui.»')).toBe(' Peut-être')
  })

  // --- Turkish (dotted/dotless i distinction) ---
  it('capitalizes Turkish i after period (JS toUpperCase gives I, not İ)', () => {
    // JS toUpperCase() is not locale-aware — 'i' → 'I', not 'İ'.
    // Acceptable trade-off: correct capitalization, wrong glyph for Turkish.
    expect(fixGhostCapitalization(' iyi', 'Bitti.')).toBe(' Iyi')
  })

  // --- Fullwidth punctuation (CJK) ---
  it('recognizes fullwidth exclamation mark ！ as sentence end', () => {
    // CJK fullwidth ！ IS a sentence end — Latin ghost text should capitalize
    expect(fixGhostCapitalization(' maybe', 'やった！')).toBe(' Maybe')
  })

  it('recognizes fullwidth question mark ？ as sentence end', () => {
    expect(fixGhostCapitalization(' perhaps', '本当？')).toBe(' Perhaps')
  })

  it('passes through CJK ghost after fullwidth ！ unchanged', () => {
    // CJK characters have no case, so they pass through regardless
    expect(fixGhostCapitalization(' それでも', 'やった！')).toBe(' それでも')
  })

  // --- Ellipsis edge case ---
  it('does not treat ellipsis as sentence end', () => {
    expect(fixGhostCapitalization(' And then', 'I was thinking...')).toBe(' and then')
  })

  it('treats single period as sentence end', () => {
    expect(fixGhostCapitalization(' and then', 'I was thinking.')).toBe(' And then')
  })

  // --- Vietnamese (Latin with diacritics) ---
  it('capitalizes Vietnamese after period', () => {
    expect(fixGhostCapitalization(' có lẽ', 'Tôi đã xong.')).toBe(' Có lẽ')
  })

  // --- Indonesian/Malay (Latin, standard punctuation) ---
  it('lowercases Indonesian mid-sentence', () => {
    expect(fixGhostCapitalization(' Dan kemudian', 'Saya melihat')).toBe(' dan kemudian')
  })
})
