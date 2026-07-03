// Token-budgeted context packing.
//
// The prompt builder used to take fixed slices (6 reflections, 4 patterns, 2
// observations) regardless of how long each item was — a handful of verbose
// memories could balloon the system prompt while a page of terse ones wasted
// the budget. packByBudget instead fills a token budget: it orders items by
// priority (type) then recency and includes them until the next item would
// exceed the budget, so the prompt spends a predictable share on memory no
// matter the item lengths.

export interface PackItem {
  /** The rendered line, already sanitized/formatted. */
  text: string
  /** Lower = more important. Ties broken by recency. */
  priority: number
  /** Timestamp; newer wins within a priority tier. */
  recency: number
}

// Rough token estimate. English averages ~4 characters per token; this is a
// deliberate over-approximation (counts whitespace) so we stay safely under
// real model tokenization rather than risk overflow.
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

/**
 * Greedily select items, ordered by (priority asc, recency desc), whose
 * cumulative estimated token cost stays within `maxTokens`. A single item
 * larger than the whole budget is skipped, but later smaller items still get a
 * chance (we don't stop at the first over-budget item). Input is not mutated.
 */
export function packByBudget<T extends PackItem>(items: T[], maxTokens: number): T[] {
  if (maxTokens <= 0) return []
  const ordered = [...items].sort((a, b) =>
    a.priority !== b.priority ? a.priority - b.priority : b.recency - a.recency,
  )
  const selected: T[] = []
  let spent = 0
  for (const item of ordered) {
    const cost = estimateTokens(item.text)
    if (spent + cost > maxTokens) continue
    selected.push(item)
    spent += cost
  }
  return selected
}
