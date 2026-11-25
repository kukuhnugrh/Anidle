import { Component, type ReactNode } from 'react';

/**
 * Catches a page that throws while rendering (e.g. a response from an older deploy), so the app shows
 * what went wrong instead of going blank. Keyed by the route in App, so navigating resets it.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="error-box">
        <p>This page could not be shown: {this.state.error.message}</p>
        <sakuga-button variant="secondary" onClick={() => location.reload()}>
          Reload
        </sakuga-button>
      </div>
    );
  }
}
