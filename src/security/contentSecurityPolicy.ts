// Content-Security-Policy helpers shared by the Vite build and its tests.
//
// The web app gets exactly one policy: the `Content-Security-Policy` header in
// firebase.json. Capacitor native builds have no HTTP headers, so the build
// injects a <meta> CSP derived from that header (see vite.config.ts) only when
// CAPACITOR_BUILD=1. Two enforced policies on web are intersected by the
// browser, which is how the site's own Google Ads calls ended up blocked.

export type CspDirectives = Map<string, string[]>

/** Sources only the native shell needs: its own origins and the API host. */
export const NATIVE_CSP_ADDITIONS: Readonly<Record<string, readonly string[]>> = {
  'default-src': ['capacitor:', 'https://localhost'],
  'connect-src': ['capacitor:', 'https://localhost', 'https://undersurface.me', 'https://*.firebaseapp.com'],
  'img-src': ['capacitor:'],
  'media-src': ['capacitor:'],
}

/** Directives a <meta> policy may not carry (browsers ignore them with a warning). */
export const META_UNSUPPORTED_DIRECTIVES: readonly string[] = ['frame-ancestors', 'report-uri', 'report-to', 'sandbox']

export function parseCsp(policy: string): CspDirectives {
  const directives: CspDirectives = new Map()
  for (const raw of policy.split(';')) {
    const [name, ...sources] = raw.trim().split(/\s+/).filter(Boolean)
    if (!name) continue
    const key = name.toLowerCase()
    // Per the CSP spec, only the first occurrence of a directive counts.
    if (!directives.has(key)) directives.set(key, sources)
  }
  return directives
}

export function serializeCsp(directives: CspDirectives): string {
  return [...directives].map(([name, sources]) => [name, ...sources].join(' ')).join('; ')
}

/** The policy a native build enforces: the web header plus native origins. */
export function deriveNativeCsp(webPolicy: string): string {
  const directives = parseCsp(webPolicy)
  for (const name of META_UNSUPPORTED_DIRECTIVES) directives.delete(name)
  for (const [name, extra] of Object.entries(NATIVE_CSP_ADDITIONS)) {
    const sources = directives.get(name) ?? [...(directives.get('default-src') ?? [])]
    for (const source of extra) if (!sources.includes(source)) sources.push(source)
    directives.set(name, sources)
  }
  return serializeCsp(directives)
}

export function cspMetaTag(policy: string): string {
  const escaped = policy.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
  return `<meta http-equiv="Content-Security-Policy" content="${escaped}" />`
}

interface FirebaseHostingHeaders {
  hosting?: { headers?: Array<{ source?: string; headers?: Array<{ key?: string; value?: string }> }> }
}

/** Reads the `**` Content-Security-Policy header out of firebase.json text. */
export function webCspFromFirebaseJson(firebaseJson: string): string {
  const config = JSON.parse(firebaseJson) as FirebaseHostingHeaders
  for (const rule of config.hosting?.headers ?? []) {
    if (rule.source !== '**') continue
    const csp = rule.headers?.find((header) => header.key?.toLowerCase() === 'content-security-policy')
    if (csp?.value) return csp.value
  }
  throw new Error('firebase.json has no Content-Security-Policy header for "**"')
}
