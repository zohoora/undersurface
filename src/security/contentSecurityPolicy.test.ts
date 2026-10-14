import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  META_UNSUPPORTED_DIRECTIVES,
  cspMetaTag,
  deriveNativeCsp,
  parseCsp,
  webCspFromFirebaseJson,
} from './contentSecurityPolicy'

const ROOT = resolve(__dirname, '../..')
const firebaseJson = readFileSync(resolve(ROOT, 'firebase.json'), 'utf8')
const indexHtml = readFileSync(resolve(ROOT, 'index.html'), 'utf8')
const viteConfig = readFileSync(resolve(ROOT, 'vite.config.ts'), 'utf8')
const packageJson = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')) as { scripts: Record<string, string> }

const web = parseCsp(webCspFromFirebaseJson(firebaseJson))
const native = parseCsp(deriveNativeCsp(webCspFromFirebaseJson(firebaseJson)))

// Hosts the app must reach, by directive. Ads/GA4 per Google's tag-platform
// CSP guide plus the hosts the live console showed blocked on 2026-10-14
// (ad.doubleclick.net/ccm collect, www.google.ca/pagead/1p-user-list).
const REQUIRED: Record<string, string[]> = {
  'script-src': [
    'https://www.googletagmanager.com', 'https://www.googleadservices.com', 'https://googleads.g.doubleclick.net',
    'https://www.google.com', 'https://apis.google.com', 'https://cdn.jsdelivr.net', "'wasm-unsafe-eval'",
  ],
  'connect-src': [
    'https://*.googleapis.com', 'https://*.firebaseio.com', 'https://*.sentry.io', 'https://api.openai.com',
    'https://cdn.jsdelivr.net', 'https://www.googletagmanager.com', 'https://*.google-analytics.com',
    'https://www.googleadservices.com', 'https://googleads.g.doubleclick.net', 'https://ad.doubleclick.net',
    'https://pagead2.googlesyndication.com', 'https://www.google.com', 'https://www.google.ca',
    // The service worker re-fetches font files for its runtime cache, and a
    // worker's own fetches are governed by connect-src, not font-src.
    'https://fonts.gstatic.com',
  ],
  'img-src': [
    'data:', 'blob:', 'https://storage.googleapis.com', 'https://lh3.googleusercontent.com',
    'https://www.googletagmanager.com', 'https://www.googleadservices.com', 'https://googleads.g.doubleclick.net',
    'https://ad.doubleclick.net', 'https://pagead2.googlesyndication.com', 'https://www.google.com', 'https://www.google.ca',
  ],
  'media-src': ['blob:', 'https://storage.googleapis.com'],
  'worker-src': ['blob:'],
  'frame-src': ['https://undersurfaceme.firebaseapp.com', 'https://accounts.google.com', 'https://www.googletagmanager.com'],
  'style-src': ['https://fonts.googleapis.com'],
  'font-src': ['https://fonts.gstatic.com'],
}

describe('web CSP (firebase.json header)', () => {
  it('is the only policy web visitors get: index.html carries no CSP meta', () => {
    expect(indexHtml).not.toMatch(/http-equiv=["']Content-Security-Policy["']/i)
  })

  it.each(Object.entries(REQUIRED))('%s allows every host the app needs', (directive, sources) => {
    const allowed = web.get(directive) ?? []
    for (const source of sources) expect(allowed, `${directive} ${source}`).toContain(source)
  })

  it('lists the same regional Google domains for Ads in img-src and connect-src', () => {
    const regional = (directive: string) => (web.get(directive) ?? []).filter((s) => /^https:\/\/www\.google\.(?!com$)[a-z.]+$/.test(s)).sort()
    expect(regional('img-src').length).toBeGreaterThanOrEqual(20)
    expect(regional('connect-src')).toEqual(regional('img-src'))
  })

  it('no longer allows the retired ElevenLabs soundscape endpoint', () => {
    expect(webCspFromFirebaseJson(firebaseJson)).not.toContain('elevenlabs')
  })

  it('keeps the framing, base-uri and form-action locks', () => {
    expect(web.get('frame-ancestors')).toEqual(["'none'"])
    expect(web.get('base-uri')).toEqual(["'self'"])
    expect(web.get('form-action')).toEqual(["'self'"])
    expect(web.get('default-src')).toEqual(["'self'"])
  })
})

describe('native CSP (meta injected for Capacitor builds)', () => {
  it('is never stricter than the web header for any directive a meta tag can carry', () => {
    for (const [directive, sources] of web) {
      if (META_UNSUPPORTED_DIRECTIVES.includes(directive)) continue
      const nativeSources = native.get(directive) ?? []
      for (const source of sources) expect(nativeSources, `${directive} ${source}`).toContain(source)
    }
  })

  it('adds the Capacitor origins and the production API host', () => {
    expect(native.get('default-src')).toEqual(expect.arrayContaining(['capacitor:', 'https://localhost']))
    expect(native.get('connect-src')).toEqual(expect.arrayContaining(['capacitor:', 'https://localhost', 'https://undersurface.me']))
    expect(native.get('img-src')).toContain('capacitor:')
    expect(native.get('media-src')).toContain('capacitor:')
  })

  it('drops directives a meta policy cannot carry', () => {
    for (const directive of META_UNSUPPORTED_DIRECTIVES) expect(native.has(directive)).toBe(false)
  })

  it('is injected only for CAPACITOR_BUILD=1, and every cap:* script builds that way', () => {
    expect(viteConfig).toContain("nativeCspMeta(process.env.CAPACITOR_BUILD === '1')")
    expect(packageJson.scripts['build:native']).toContain('CAPACITOR_BUILD=1')
    const capScripts = Object.entries(packageJson.scripts).filter(([name]) => name.startsWith('cap:'))
    expect(capScripts.length).toBeGreaterThan(0)
    for (const [name, command] of capScripts) expect(command, name).toContain('npm run build:native')
  })

  it('renders an attribute-safe meta tag', () => {
    expect(cspMetaTag(`default-src 'self' "x"`)).toBe(`<meta http-equiv="Content-Security-Policy" content="default-src 'self' &quot;x&quot;" />`)
  })
})

describe('parseCsp', () => {
  it('keeps only the first occurrence of a directive, per the CSP spec', () => {
    const parsed = parseCsp("img-src 'self'; IMG-SRC https://a.example; ;  connect-src https://b.example ")
    expect(parsed.get('img-src')).toEqual(["'self'"])
    expect(parsed.get('connect-src')).toEqual(['https://b.example'])
  })
})
