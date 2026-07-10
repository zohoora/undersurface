import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { sentryVitePlugin } from '@sentry/vite-plugin'

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
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false,
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
        runtimeCaching: [
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
