import { afterEach, describe, expect, it } from 'vitest'
import { allowZoom, allowZoomWhileOpen } from './zoom'

const APP = 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover'

describe('Folio allows pinch zoom', () => {
  afterEach(() => { document.head.innerHTML = '' })

  it('drops maximum-scale and user-scalable, keeps the rest', () => {
    expect(allowZoom(APP)).toBe('width=device-width, initial-scale=1.0, viewport-fit=cover')
    expect(allowZoom('width=device-width')).toBe('width=device-width')
  })

  it('restores the app meta on leaving', () => {
    document.head.innerHTML = `<meta name="viewport" content="${APP}">`
    const restore = allowZoomWhileOpen()
    const meta = document.querySelector('meta[name="viewport"]')
    expect(meta?.getAttribute('content')).toBe('width=device-width, initial-scale=1.0, viewport-fit=cover')
    restore()
    expect(meta?.getAttribute('content')).toBe(APP)
  })

  it('does nothing without a viewport meta', () => {
    expect(() => allowZoomWhileOpen()()).not.toThrow()
  })
})
