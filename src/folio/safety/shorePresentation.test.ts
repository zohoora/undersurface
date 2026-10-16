import { describe, expect, it } from 'vitest'
import { RELOAD_QUIET_MS, ShorePresentation, VISIT_IDLE_MS } from './shorePresentation'

// §5.5's presentation rules: never changes the shared state, only the page.

const make = (last: number | null = null) => new ShorePresentation({ lastActivationAt: last, now: 1_000_000 })

describe('ShorePresentation', () => {
  it('grounding brings shore with the card; its end leaves the visit in Quiet', () => {
    const s = make()
    s.groundingChanged(true)
    expect(s.getSnapshot()).toMatchObject({ presentation: 'shore', card: true })
    s.groundingChanged(false)
    expect(s.getSnapshot()).toMatchObject({ presentation: 'quiet', card: false })
  })

  it("I'm okay moves to Quiet; the same text doesn't bring the line back, new text does", () => {
    const s = make()
    s.groundingChanged(true)
    s.activation('p1', 'Some nights I wanted to end my life, he wrote,')
    s.okay()
    expect(s.getSnapshot().presentation).toBe('quiet')
    s.groundingChanged(true) // re-activated by the same settle
    s.activation('p1', 'Some nights I wanted to end my life, he wrote,')
    expect(s.getSnapshot().presentation).toBe('quiet')
    s.activation('p2', 'something new')
    expect(s.getSnapshot().presentation).toBe('shore')
  })

  it('dismissing the card during shore is I\'m okay', () => {
    const s = make()
    s.groundingChanged(true)
    s.cardDismissed()
    expect(s.getSnapshot().presentation).toBe('quiet')
  })

  it('a late risk shows the card and changes nothing else', () => {
    const s = make()
    s.lateRisk()
    expect(s.getSnapshot()).toMatchObject({ presentation: 'normal', card: true })
  })

  it('Find help re-shows a dismissed card with a new token', () => {
    const s = make()
    const before = s.getSnapshot().cardToken
    s.findHelp()
    expect(s.getSnapshot().card).toBe(true)
    expect(s.getSnapshot().cardToken).toBe(before + 1)
  })

  it('a reload within 30 minutes of an activation starts in Quiet; later, Normal', () => {
    expect(make(1_000_000 - RELOAD_QUIET_MS + 1000).getSnapshot().presentation).toBe('quiet')
    expect(make(1_000_000 - RELOAD_QUIET_MS - 1000).getSnapshot().presentation).toBe('normal')
  })

  it('a visit ends after 30 minutes hidden: Quiet returns to Normal', () => {
    const s = make()
    s.groundingChanged(true)
    s.groundingChanged(false)
    s.visibility(true, 0)
    s.visibility(false, VISIT_IDLE_MS + 1)
    expect(s.getSnapshot().presentation).toBe('normal')
  })

  it('offers words to bring only from Folio\'s own activations', () => {
    const s = make()
    s.groundingChanged(true)
    expect(s.getSnapshot().bring).toBeNull()
    s.activation('p1', 'these words')
    expect(s.getSnapshot().bring).toEqual({ text: 'these words' })
  })
})
