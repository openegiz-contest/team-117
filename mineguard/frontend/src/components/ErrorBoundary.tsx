import { Component, type ErrorInfo, type ReactNode } from 'react'

export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('UI render failure', error, info) }
  render() {
    if (this.state.failed) return <div className="fatal"><h1>Display unavailable</h1><p>Reload after checking the MineGuard API.</p></div>
    return this.props.children
  }
}
