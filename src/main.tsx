import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import * as Sentry from '@sentry/react'
import './index.css'
import App from './App.tsx'
import { ErrorBoundary } from './components/ErrorBoundary.tsx'
import { AuthProvider } from './auth/AuthContext.tsx'

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
    // Filter out non-critical service worker registration failures
    if (message === 'Rejected' && event.exception?.values?.[0]?.stacktrace?.frames?.some(
      f => f.filename?.includes('registerSW')
    )) {
      return null
    }
    // Filter out DOM manipulation errors from browser extensions / Chrome Translate
    if (message.includes('removeChild') || message.includes('insertBefore')) {
      return null
    }
    // Filter out Safari IndexedDB connection loss — known WebKit bug, not actionable
    if (message.includes('Connection to Indexed Database server lost')) {
      return null
    }
    // Filter out errors from obfuscated third-party scripts injected by in-app browsers
    if (/_0x[a-f0-9]{4,}/.test(message)) {
      return null
    }
    return event
  },
})

// Safari sometimes kills IndexedDB connections (known WebKit bug).
// Catch the unhandled rejection and prompt the user to refresh.
window.addEventListener('unhandledrejection', (event) => {
  const msg = String(event.reason?.message ?? event.reason ?? '')
  if (msg.includes('Connection to Indexed Database server lost')) {
    event.preventDefault()
    // Only show once
    if (document.getElementById('idb-lost-banner')) return
    const banner = document.createElement('div')
    banner.id = 'idb-lost-banner'
    Object.assign(banner.style, {
      position: 'fixed',
      top: '0',
      left: '0',
      right: '0',
      zIndex: '99999',
      padding: '14px 20px',
      background: '#1a1a2e',
      color: '#e0def4',
      fontFamily: "'Inter', sans-serif",
      fontSize: '14px',
      textAlign: 'center',
      boxShadow: '0 2px 12px rgba(0,0,0,0.3)',
    })
    banner.appendChild(document.createTextNode('Connection interrupted \u2014 please '))
    const btn = document.createElement('button')
    btn.textContent = 'refresh the page'
    Object.assign(btn.style, {
      background: 'none', border: '1px solid #e0def4', color: '#e0def4',
      borderRadius: '4px', padding: '4px 12px', marginLeft: '8px',
      cursor: 'pointer', fontFamily: 'inherit', fontSize: '13px',
    })
    btn.addEventListener('click', () => window.location.reload())
    banner.appendChild(btn)
    document.body.appendChild(banner)
  }
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <AuthProvider>
        <App />
      </AuthProvider>
    </ErrorBoundary>
  </StrictMode>,
)
