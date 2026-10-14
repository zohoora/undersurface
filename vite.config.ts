import { readFileSync } from 'node:fs'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { sentryVitePlugin } from '@sentry/vite-plugin'
import { cspMetaTag, deriveNativeCsp, webCspFromFirebaseJson } from './src/security/contentSecurityPolicy'

// Built files left out of the PWA precache (see workbox.globIgnores) and the
// runtime-cache matcher for the hashed chunks among them.
const PRECACHE_IGNORES = [
  '**/assets/locale-*.js',
  '**/assets/AdminDashboard-*.js',
  '**/assets/vision_bundle-*.js',
  '**/og-image.png',
  '**/logo-*.png',
]
// Workbox tests a RegExp route against the full URL, so it is not anchored at
// the start; Workbox only accepts mid-URL matches for same-origin requests.
const ON_DEMAND_ASSET = /\/assets\/(?:locale-[a-z]{2}|AdminDashboard|vision_bundle)-[\w-]+\.js$/

// Web is governed by the single CSP header in firebase.json. Capacitor builds
// (CAPACITOR_BUILD=1, set by the cap:* scripts) have no HTTP headers, so they
// get the same policy plus native origins as a <meta> tag.
function nativeCspMeta(enabled: boolean): Plugin {
  return {
    name: 'undersurface-native-csp',
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        if (!enabled) return html
        const policy = deriveNativeCsp(webCspFromFirebaseJson(readFileSync(new URL('./firebase.json', import.meta.url), 'utf8')))
        // After the charset meta (which must stay in the first 1024 bytes) and
        // before any script the policy governs.
        const withMeta = html.replace(/(<meta charset="[^"]*"\s*\/?>)/i, `$1\n    ${cspMetaTag(policy)}`)
        if (withMeta === html) throw new Error('native CSP: no <meta charset> in index.html to anchor the policy')
        return withMeta
      },
    },
  }
}

export default defineConfig(({ mode }) => {
  // Load .env.local so SENTRY_* vars are available via process.env
  const env = loadEnv(mode, process.cwd(), '')
  Object.assign(process.env, env)
  const uploadSourceMaps = process.env.SENTRY_UPLOAD_SOURCEMAPS === '1'
  if (uploadSourceMaps && !process.env.SENTRY_AUTH_TOKEN) {
    throw new Error('SENTRY_UPLOAD_SOURCEMAPS=1 requires SENTRY_AUTH_TOKEN')
  }

  return {
  server: {
    // Keep local signed-in E2E on the same relative /api contract as Hosting.
    // Vite has no Firebase rewrites, so without this proxy every companion,
    // account, and SMS request fails locally with a 404.
    proxy: {
      '/api': {
        target: 'https://undersurface.me',
        changeOrigin: true,
      },
    },
  },
  build: {
    // Ordinary verification builds are local-only. Release builds opt in to
    // hidden source maps + upload with SENTRY_UPLOAD_SOURCEMAPS=1.
    sourcemap: uploadSourceMaps ? 'hidden' : false,
    rollupOptions: {
      output: {
        // Non-English locales are lazy chunks. Renaming them (without changing
        // how Rollup splits them) gives the service worker a stable `locale-`
        // prefix to leave out of the precache (see workbox.globIgnores).
        chunkFileNames(chunk) {
          return /\/src\/i18n\/translations\/[a-z]{2}\.ts$/.test(chunk.facadeModuleId ?? '')
            ? 'assets/locale-[name]-[hash].js'
            : 'assets/[name]-[hash].js'
        },
        manualChunks(id) {
          if (id.includes('/node_modules/firebase/') || id.includes('/node_modules/@firebase/')) return 'firebase'
          if (id.includes('/node_modules/react/') || id.includes('/node_modules/react-dom/') || id.includes('/node_modules/framer-motion/')) return 'react-vendor'
          if (id.includes('@tiptap') || id.includes('prosemirror')) return 'editor'
          if (id.includes('@sentry')) return 'sentry'
        },
      },
    },
  },
  plugins: [
    nativeCspMeta(process.env.CAPACITOR_BUILD === '1'),
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false,
      workbox: {
        // Activate new releases as soon as their files are safely precached.
        // clientsClaim updates the controller, but we intentionally do not
        // force-reload an open reflection session; the next navigation/reload
        // gets the new shell without an update prompt or multi-day stale wait.
        skipWaiting: true,
        clientsClaim: true,
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
        // Precache only what every visitor needs. Locale chunks (one language
        // per user), the admin dashboard, the MediaPipe bundle (webcam HRV
        // only) and marketing images are cached at runtime on first use.
        globIgnores: PRECACHE_IGNORES,
        runtimeCaching: [
          {
            // Content-hashed, so a cached copy never goes stale.
            urlPattern: ON_DEMAND_ASSET,
            handler: 'CacheFirst',
            options: {
              cacheName: 'on-demand-assets',
              expiration: { maxEntries: 40, maxAgeSeconds: 60 * 60 * 24 * 60 },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: { cacheName: 'google-fonts-cache', expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 } },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: { cacheName: 'gstatic-fonts-cache', expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 } },
          },
        ],
      },
    }),
    uploadSourceMaps && sentryVitePlugin({
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
      disable: false,
    }),
  ],
}})
