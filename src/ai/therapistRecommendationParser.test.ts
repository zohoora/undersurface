import { describe, it, expect } from 'vitest'
import { parseRecommendations } from './therapistRecommendationParser'

describe('parseRecommendations', () => {
  it('returns a single text segment when there are no recommendations', () => {
    const result = parseRecommendations('I hear you. Tell me more about that.')
    expect(result).toEqual([
      { type: 'text', text: 'I hear you. Tell me more about that.' },
    ])
  })

  it('extracts a single recommendation surrounded by text', () => {
    const input = "I'm noticing a pattern. [Can I be more direct with you?](#switch:real-talk-on) It might help."
    const result = parseRecommendations(input)
    expect(result).toEqual([
      { type: 'text', text: "I'm noticing a pattern. " },
      { type: 'recommendation', phrase: 'Can I be more direct with you?', target: 'real-talk-on' },
      { type: 'text', text: ' It might help.' },
    ])
  })

  it('handles multiple recommendations in one message', () => {
    const input = '[Write about it](#switch:journal) or [say it aloud](#switch:speak).'
    const result = parseRecommendations(input)
    expect(result).toHaveLength(4)
    expect(result[0]).toEqual({ type: 'recommendation', phrase: 'Write about it', target: 'journal' })
    expect(result[1]).toEqual({ type: 'text', text: ' or ' })
    expect(result[2]).toEqual({ type: 'recommendation', phrase: 'say it aloud', target: 'speak' })
    expect(result[3]).toEqual({ type: 'text', text: '.' })
  })

  it('preserves a recommendation at the very start of the message', () => {
    const input = '[Be more direct?](#switch:real-talk-on) Tell me what you really think.'
    const result = parseRecommendations(input)
    expect(result[0]).toEqual({ type: 'recommendation', phrase: 'Be more direct?', target: 'real-talk-on' })
  })

  it('preserves a recommendation at the very end of the message', () => {
    const input = "There's more here than words. [Write about it](#switch:journal)"
    const result = parseRecommendations(input)
    expect(result[result.length - 1]).toEqual({ type: 'recommendation', phrase: 'Write about it', target: 'journal' })
  })

  it('does not match plain Markdown links (no #switch: prefix)', () => {
    const input = 'See [this article](https://example.com) for more.'
    const result = parseRecommendations(input)
    expect(result).toEqual([{ type: 'text', text: 'See [this article](https://example.com) for more.' }])
  })

  it('does not match Markdown emphasis without the link form', () => {
    const input = 'Sometimes the *body knows* things the mind does not.'
    const result = parseRecommendations(input)
    expect(result).toEqual([{ type: 'text', text: 'Sometimes the *body knows* things the mind does not.' }])
  })

  it('returns the recommendation target verbatim, even if unknown to this version', () => {
    const input = '[Try this](#switch:future-mode) sometime.'
    const result = parseRecommendations(input)
    expect(result[0]).toEqual({ type: 'recommendation', phrase: 'Try this', target: 'future-mode' })
  })

  it('handles streaming-style partial input gracefully (open bracket not closed)', () => {
    const input = "I'm noticing a pattern. [Can I be more"
    const result = parseRecommendations(input)
    expect(result).toEqual([{ type: 'text', text: "I'm noticing a pattern. [Can I be more" }])
  })

  it('parses a reversible surface arc', () => {
    expect(parseRecommendations('[take this to the page](#switch:journal-arc)')).toEqual([
      { type: 'recommendation', phrase: 'take this to the page', target: 'journal-arc' },
    ])
  })

  it('parses the optimal-ending marker as an end-session action', () => {
    expect(parseRecommendations('[We can leave it here.](#end:session)')).toEqual([
      { type: 'recommendation', phrase: 'We can leave it here.', target: 'end-session' },
    ])
  })
})
