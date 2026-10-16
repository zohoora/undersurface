import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import * as Sentry from '@sentry/react'
import { Capacitor } from '@capacitor/core'
import './index.css'
import App from './App.tsx'
import { ErrorBoundary } from './components/ErrorBoundary.tsx'
import { AuthProvider } from './auth/AuthContext.tsx'
import { initNative, dismissSplash } from './native'
import { installBackButton } from './native/backButton'
import { auth } from './firebase'
import { installGroundingPersistence } from './store/groundingPersistence'
import { reloadOnce } from './utils/lazyWithRetry'
import { removeConnectionBanner, showConnectionBanner } from './utils/connectionBanner'
import { applyWebViewport } from './utils/viewport'

// Prevent "removeChild" / "insertBefore" crashes caused by browser extensions
// and Chrome Translate mutating the DOM outside React's control.
// See: https://github.com/facebook/react/issues/11538
if (typeof Node !== 'undefined') {
  const origRemoveChild = Node.prototype.removeChild

  Node.prototype.removeChild = function <T extends Node>(child: T): T {
    if (child.parentNode !== this) return child
    return origRemoveChild.call(this, child) as T
  }
  const origInsertBefore = Node.prototype.insertBefore

  Node.prototype.insertBefore = function <T extends Node>(node: T, ref: Node | null): T {
    if (ref && ref.parentNode !== this) return node
    return origInsertBefore.call(this, node, ref) as T
  }
}

Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  environment: import.meta.env.MODE,
  enabled: import.meta.env.PROD,
  tracesSampleRate: 0.1,
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0.1,
  beforeSend(event) {
    const message = event.exception?.values?.[0]?.value ?? ''
    // Filter out DOM manipulation errors from browser extensions / Chrome Translate
    if (message.includes('removeChild') || message.includes('insertBefore')) {
      return null
    }
    // Filter out Safari IndexedDB errors — known WebKit bugs, not actionable
    if (message.includes('Connection to Indexed Database server lost')
      || message.includes('Error looking up record in object store by key range')) {
      return null
    }
    // Chromium couldn't open its IndexedDB (LevelDB) backing store — disk full,
    // profile corruption, or Android storage pressure. Firebase Auth's 800ms
    // persistence poll leaks it as a raw DOMException rejection; drop that noise.
    // Keep handled captures (tags.area=auth_redirect): those mean Auth init itself
    // failed, onAuthStateChanged never fires, and the user is stuck loading.
    if (message.includes('Internal error opening backing store')
      && event.exception?.values?.[0]?.mechanism?.type === 'auto.browser.global_handlers.onunhandledrejection') {
      return null
    }
    // Filter out errors from obfuscated third-party scripts injected by in-app browsers
    if (/_0x[a-f0-9]{4,}/.test(message)) {
      return null
    }
    // Filter out Firebase Analytics throttle/fetch errors — non-actionable,
    // usually caused by ad blockers or intermittent GA config fetches
    if (message.includes('analytics/fetch-throttle')
      || message.includes('Analytics: The config fetch request')) {
      return null
    }
    return event
  },
})

// Chromium's IndexedDB backing store failed to open. Reaches here two ways,
// both as the same raw DOMException:
//   - Firebase Auth's 800ms persistence poll, mid-session. Auth keeps the user
//     in memory, so the session keeps working. Fires on every poll tick until
//     the store recovers.
//   - Auth initialization itself failed. onAuthStateChanged never fires and
//     the user sits on the loading screen indefinitely.
// authStateReady() never settles when init fails, so it separates the cases:
// once auth has resolved, stay silent; before that, offer the refresh that
// lets Firestore and Auth fall back to non-IndexedDB storage.
// Once auth resolves the store has recovered (or never failed), so a banner
// shown during init is withdrawn rather than left over a working app.
let authResolved = false
void auth.authStateReady().then(() => {
  authResolved = true
  removeConnectionBanner()
}, () => {})

function handleBackingStoreFailure(event: PromiseRejectionEvent): void {
  event.preventDefault()
  if (!authResolved) showConnectionBanner()
}

window.addEventListener('unhandledrejection', (event) => {
  const msg = String(event.reason?.message ?? event.reason ?? '')
  // Silently swallow Firebase Analytics throttle errors — non-actionable background fetch failures
  if (msg.includes('analytics/fetch-throttle') || msg.includes('Analytics: The config fetch request')) {
    event.preventDefault()
    return
  }
  if (msg.includes('Internal error opening backing store')) {
    handleBackingStoreFailure(event)
    return
  }
  // Safari sometimes kills IndexedDB connections (known WebKit bug).
  // Catch the unhandled rejection and prompt the user to refresh.
  if (msg.includes('Connection to Indexed Database server lost')
    || msg.includes('Error looking up record in object store by key range')) {
    event.preventDefault()
    showConnectionBanner()
  }
})

// A tab still running the previous build can fail to preload an old-hash
// chunk after a deploy (the new service worker cleaned the old precache).
// Reload once to pick up the new build; if that already happened recently,
// let the error reach the nearest error boundary instead of looping.
window.addEventListener('vite:preloadError', (event) => {
  if (reloadOnce('vite-preload')) event.preventDefault()
})

// Pinch zoom on the web (WCAG 1.4.4): index.html carries the native app's
// locked viewport, relaxed here before anything renders (src/utils/viewport.ts).
if (!Capacitor.isNativePlatform()) applyWebViewport()

// Every grounding activation (any layer, any surface) stamps a
// server-readable lastGroundingAt so SMS can see a recent crisis.
installGroundingPersistence()

// Register service worker — failure is non-critical (app works without it).
// Skip on native: the bundle ships on-device, and a SW can stale Cloud Function calls.
if ('serviceWorker' in navigator && !Capacitor.isNativePlatform()) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' })
      .then((registration) => registration.update())
      .catch(() => {})
  })
}

void initNative()
void installBackButton()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <AuthProvider>
        <App />
      </AuthProvider>
    </ErrorBoundary>
  </StrictMode>,
)

// Splash stays up until first paint settles — gives auth state a moment to hydrate.
requestAnimationFrame(() => {
  setTimeout(() => { void dismissSplash() }, 400)
})
