import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'
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

// Faded-in controls: opacity 0 until their anchor carries data-shown.
const FADED_IN = '[data-folio-corner], .folio-foldhint-anchor[data-shown] .folio-foldhint'

/**
 * Wait until nothing on the page is moving, so contrast is read at rest.
 * A fixed sleep raced on a slower runner: axe sampled the corner mid-fade
 * (#675F56 at ~76% over the paper, 3.38:1 instead of 5.67:1). Folio has no
 * infinite animations, so this always settles.
 */
export async function atRest(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate((selector) =>
    [...document.querySelectorAll(selector)].every((el) => getComputedStyle(el).opacity === '1')
    && document.getAnimations().every((a) => a.playState !== 'running'),
  FADED_IN), { timeout: 4000 }).toBe(true)
}
