import { Component } from 'react'
import type { ReactNode, ErrorInfo } from 'react'

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
          background: '#FAF8F5',
          fontFamily: "'Spectral', serif",
          color: '#4A453F',
          gap: 16,
        }}>
          <div style={{ fontSize: 18 }}>Something went wrong</div>
          <button
            onClick={() => window.location.reload()}
            style={{
              fontFamily: "'Inter', sans-serif",
              fontSize: 13,
              padding: '8px 20px',
              border: '1px solid #D5D0CA',
              borderRadius: 6,
              background: 'white',
              color: '#4A453F',
              cursor: 'pointer',
            }}
          >
            Reload
          </button>
        </div>
      )
    }

    return this.props.children
  }
}
