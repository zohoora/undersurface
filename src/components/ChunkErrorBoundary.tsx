import { Component } from 'react'
import type { CSSProperties, ErrorInfo, ReactNode } from 'react'
import * as Sentry from '@sentry/react'
import { t } from '../i18n'
import type { TranslationKey } from '../i18n'
import { isDOMManipulationError } from '../utils/domManipulationError'

interface Props {
  /** Which lazily loaded area failed, for diagnostics only. */
  area: string
  /**
   * `page` fills the viewport (a whole route such as Admin or Onboarding);
   * `inline` sits in the content flow so everything around it — the sidebar,
   * the crisis resources card — keeps rendering; `compact` is the same inside
   * a small container (a sidebar tab, a settings sheet).
   */
  variant?: 'page' | 'inline' | 'compact'
  /** Message key; defaults to the generic error title. */
  messageKey?: TranslationKey
  children: ReactNode
}

interface State {
  hasError: boolean
}

// Catches a lazily loaded area whose chunk could not load (offline, or a stale
// deploy after `lazyWithRetry` already used its one reload) and shows a calm
// message instead of a blank screen or an endless reload. Retrying is a
// deliberate tap: React caches a rejected lazy import, so the retry reloads
// the page rather than re-rendering the same failure.
export class ChunkErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(error: Error): State {
    // Same exemption as the root boundary: extension/Translate DOM mutations
    // are not app failures.
    if (isDOMManipulationError(error)) return { hasError: false }
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (isDOMManipulationError(error)) return
    console.error(`ChunkErrorBoundary (${this.props.area}) caught:`, error, info.componentStack)
    Sentry.captureException(error, {
      tags: { area: `lazy_${this.props.area}` },
      contexts: { react: { componentStack: info.componentStack ?? '' } },
    })
  }

  render() {
    if (!this.state.hasError) return this.props.children
    const variant = this.props.variant ?? 'inline'
    const containerStyle: CSSProperties = variant === 'page'
      ? {
        position: 'fixed',
        inset: 0,
        justifyContent: 'center',
        padding: '0 16px',
        background: 'var(--bg-primary)',
      }
      : variant === 'inline'
        ? { maxWidth: 680, margin: '0 auto', padding: '120px 16px 40px' }
        : { padding: '16px 8px' }
    const compact = variant === 'compact'
    const message = t(this.props.messageKey ?? 'error.title')
    return (
      <div
        role="alert"
        style={{
          ...containerStyle,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: compact ? 10 : 16,
          textAlign: 'center',
          color: 'var(--text-primary)',
          fontFamily: "'Inter', sans-serif",
        }}
      >
        <p style={{ margin: 0, fontSize: compact ? 12 : 15, lineHeight: 1.5 }}>{message}</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{
            minHeight: 44,
            padding: '8px 20px',
            border: '1px solid var(--border-subtle)',
            borderRadius: 6,
            background: 'var(--surface-primary)',
            color: 'var(--text-primary)',
            fontSize: 13,
            cursor: 'pointer',
          }}
        >
          {t('app.tryAgain')}
        </button>
      </div>
    )
  }
}
