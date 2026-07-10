import { describe, expect, it } from 'vitest'
import { containsAmbiguityPrism, extractAmbiguityPrism } from './ambiguityPrismParser'

describe('ambiguity prism parser', () => {
  it('extracts exactly three ordered hypotheses and strips their markers', () => {
    const parsed = extractAmbiguityPrism(`There are a few live possibilities here.

[Maybe you are afraid of disappointing them.](#prism:h1)
[Maybe anger is getting translated into duty.](#prism:h2)
[Maybe you are mostly exhausted.](#prism:h3)`)
    expect(parsed).toEqual({
      cleanText: 'There are a few live possibilities here.',
      valid: true,
      hypotheses: [
        { id: 'h1', text: 'Maybe you are afraid of disappointing them.' },
        { id: 'h2', text: 'Maybe anger is getting translated into duty.' },
        { id: 'h3', text: 'Maybe you are mostly exhausted.' },
      ],
    })
    expect(containsAmbiguityPrism(parsed.cleanText)).toBe(false)
  })

  it('rejects extra, duplicate, or unknown markers and still removes internal syntax', () => {
    const parsed = extractAmbiguityPrism('[One thought.](#prism:h1)\n[Second.](#prism:h2)\n[Third.](#prism:h3)\n[Duplicate.](#prism:h1)\n[Unknown.](#prism:h4)')
    expect(parsed.valid).toBe(false)
    expect(parsed.hypotheses).toEqual([])
    expect(parsed.cleanText).toContain('Duplicate.')
    expect(parsed.cleanText).toContain('Unknown.')
    expect(parsed.cleanText).not.toContain('#prism')
  })
})
