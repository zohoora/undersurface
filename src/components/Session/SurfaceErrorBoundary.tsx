import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import * as Sentry from '@sentry/react'
import { t } from '../../i18n'

interface Props {
  /** Which surface failed, for diagnostics only. */
  surface: 'room' | 'voice'
  /** Return the writer to Talk; the session (and any draft) stays mounted. */
  onExit: () => void
  children: ReactNode
}

interface State {
  hasError: boolean
}

// A local boundary around an overlay surface (Room, Speak). A failed lazy
// chunk or a render error there must not escalate to the root boundary, which
// would replace the whole session and lose the composer draft.
export class SurfaceErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`SurfaceErrorBoundary (${this.props.surface}) caught:`, error, info.componentStack)
    Sentry.captureException(error, {
      tags: { area: `surface_${this.props.surface}` },
      contexts: { react: { componentStack: info.componentStack ?? '' } },
    })
  }

  private exit = () => {
    this.setState({ hasError: false })
    this.props.onExit()
  }

  render() {
    if (!this.state.hasError) return this.props.children
    return (
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={t('surface.error.body')}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 1000,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 16,
          padding: '0 16px',
          textAlign: 'center',
          background: 'var(--bg-primary)',
          color: 'var(--text-primary)',
          fontFamily: "'Inter', sans-serif",
        }}
      >
        <p style={{ margin: 0, fontSize: 15 }}>{t('surface.error.body')}</p>
        <button
          type="button"
          autoFocus
          onClick={this.exit}
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
          {t('surface.error.back')}
        </button>
      </div>
    )
  }
}
