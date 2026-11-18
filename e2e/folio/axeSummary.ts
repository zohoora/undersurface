import type AxeBuilder from '@axe-core/playwright'

type AxeResults = Awaited<ReturnType<AxeBuilder['analyze']>>

/**
 * One line per violating node: the rule, the node and axe's own reason (for
 * color-contrast that is the foreground, background, font and ratio), so a
 * failure in CI can be read without reproducing it. Empty when clean.
 */
export function axeSummary(results: AxeResults): string[] {
  return results.violations.flatMap((v) => v.nodes.map((n) => {
    const why = n.failureSummary?.replace(/\s+/g, ' ').trim()
    return `${v.id}: ${n.target.join(' ')}${why ? ` (${why})` : ''}`
  }))
}
