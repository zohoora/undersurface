import { describe, expect, it } from 'vitest'
import { canOpenFolio, folioSwitches } from './access'

describe('Folio access and switches', () => {
  it('opens for everyone only when folioEnabled is true; admins and the claim always', () => {
    expect(canOpenFolio({ folioEnabled: true } as never, 'someone@example.com', null)).toBe(true)
    expect(canOpenFolio({} as never, 'someone@example.com', null)).toBe(false)
    expect(canOpenFolio({} as never, 'zohoora@gmail.com', null)).toBe(true)
    expect(canOpenFolio(null, 'folio-test@undersurface.me', { folio: true })).toBe(true)
    expect(canOpenFolio({ folioEnabled: false } as never, 'someone@example.com', { folio: false })).toBe(false)
  })

  it('every sub-switch is on unless explicitly false', () => {
    expect(folioSwitches(null)).toEqual({ between: true, distance: true, liftToday: true, ask: true, stepInside: true, stepInsideSound: true, returnOn: true, involvement: true, guides: true })
    expect(folioSwitches({ folioDistance: false, folioAsk: false } as never)).toMatchObject({ distance: false, ask: false, between: true })
  })
})
