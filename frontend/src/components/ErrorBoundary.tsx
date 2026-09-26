import { Component } from 'react'
import type { ReactNode } from 'react'
import { ErrorState } from './ui'

/** Last-resort crash fallback: a rendering bug shows a professional error
 *  with recovery actions instead of a blank page. No technical details leak. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { crashed: boolean }> {
  state = { crashed: false }

  static getDerivedStateFromError(): { crashed: boolean } {
    return { crashed: true }
  }

  render() {
    if (!this.state.crashed) return this.props.children
    return (
      <div style={{ maxWidth: 640, margin: '10vh auto', padding: '0 1.25rem' }}>
        <ErrorState
          message="Something went wrong while showing this page. Your data is safe — try reloading."
          onRetry={() => window.location.reload()}
        />
      </div>
    )
  }
}
