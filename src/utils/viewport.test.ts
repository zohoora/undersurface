import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { applyWebViewport, isAppleTouch, webViewportContent } from './viewport'

const INDEX_HTML = readFileSync(resolve(__dirname, '../../index.html'), 'utf8')
const APP = INDEX_HTML.match(/<meta name="viewport" content="([^"]+)"/)?.[1] ?? ''

const IPHONE = { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1', maxTouchPoints: 5 }
const IPAD_DESKTOP = { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15', maxTouchPoints: 5 }
const MAC = { userAgent: IPAD_DESKTOP.userAgent, maxTouchPoints: 0 }
const PIXEL = { userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36', maxTouchPoints: 5 }

describe('web viewport', () => {
  afterEach(() => { document.head.innerHTML = '' })

  it('index.html ships the native lock that the web relaxes', () => {
    expect(APP).toContain('user-scalable=no')
    expect(APP).toContain('maximum-scale=1.0')
  })

  it('tells iPhone and iPad apart from everything else', () => {
    expect(isAppleTouch(IPHONE)).toBe(true)
    expect(isAppleTouch(IPAD_DESKTOP)).toBe(true)
    expect(isAppleTouch(MAC)).toBe(false)
    expect(isAppleTouch(PIXEL)).toBe(false)
  })

  it('allows zoom everywhere off iOS', () => {
    expect(webViewportContent(APP, false)).toBe('width=device-width, initial-scale=1.0, viewport-fit=cover')
  })

  it('keeps only maximum-scale on iPhone and iPad (no focus zoom; Safari still pinches)', () => {
    const ios = webViewportContent(APP, true)
    expect(ios).toBe('width=device-width, initial-scale=1.0, viewport-fit=cover, maximum-scale=1.0')
    expect(ios).not.toContain('user-scalable')
  })

  it('rewrites the page meta at boot', () => {
    document.head.innerHTML = `<meta name="viewport" content="${APP}">`
    applyWebViewport(document, PIXEL)
    expect(document.querySelector('meta[name="viewport"]')?.getAttribute('content')).toBe('width=device-width, initial-scale=1.0, viewport-fit=cover')
  })

  it('does nothing without a viewport meta', () => {
    expect(() => applyWebViewport(document, IPHONE)).not.toThrow()
  })
})
