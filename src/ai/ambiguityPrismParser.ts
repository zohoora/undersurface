export interface ParsedPrismHypothesis {
  id: string
  text: string
}

export interface AmbiguityPrismParseResult {
  cleanText: string
  hypotheses: ParsedPrismHypothesis[]
  valid: boolean
}

const PRISM_MARKER = /\[([^\]\n]{1,240})\]\(#prism:([^\s)]{1,32})\)/g

export function extractAmbiguityPrism(input: string): AmbiguityPrismParseResult {
  const hypotheses: ParsedPrismHypothesis[] = Array.from(input.matchAll(PRISM_MARKER), match => ({
    id: match[2],
    text: match[1].trim(),
  }))
  const cleanText = input.replace(PRISM_MARKER, '').replace(/\n{3,}/g, '\n\n').trim()
  const valid = hypotheses.length === 3
    && hypotheses.every(hypothesis => Boolean(hypothesis.text))
    && hypotheses.every((hypothesis, index) => hypothesis.id === `h${index + 1}`)
  if (!valid) {
    // Preserve the readable phrases when a model misses the delivery contract;
    // never expose internal marker syntax to the writer.
    return {
      cleanText: input.replace(PRISM_MARKER, '$1').trim(),
      hypotheses: [],
      valid: false,
    }
  }
  return { cleanText, hypotheses, valid: true }
}

export function containsAmbiguityPrism(input: string): boolean {
  return extractAmbiguityPrism(input).valid
}
