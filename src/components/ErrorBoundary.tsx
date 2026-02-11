import { Component } from 'react'
import type { ReactNode, ErrorInfo } from 'react'
import * as Sentry from '@sentry/react'
import { t } from '../i18n'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('ErrorBoundary caught:', error, info.componentStack)
    Sentry.captureException(error, { contexts: { react: { componentStack: info.componentStack ?? '' } } })
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          position: 'fixed',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--bg-primary)',
          fontFamily: "'Spectral', serif",
          color: 'var(--text-primary)',
          gap: 16,
        }}>
          <div style={{ fontSize: 18 }}>{t('error.title')}</div>
          <button
            onClick={() => window.location.reload()}
            style={{
              fontFamily: "'Inter', sans-serif",
              fontSize: 13,
              padding: '8px 20px',
              border: '1px solid var(--border-subtle)',
              borderRadius: 6,
              background: 'var(--surface-primary)',
              color: 'var(--text-primary)',
              cursor: 'pointer',
            }}
          >
            {t('error.reload')}
          </button>
        </div>
      )
    }

    return this.props.children
  }
}
