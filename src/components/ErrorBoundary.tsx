import { Component, type ReactNode } from 'react';

interface State { hasError: boolean; error?: Error }

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { hasError: false };
  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }
  componentDidCatch(error: Error) {
    console.error('App error:', error);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 24, color: '#f87171', fontFamily: 'system-ui, sans-serif' }}>
          <h2>Something went wrong</h2>
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>{this.state.error?.message}</pre>
          <button
            onClick={() => location.reload()}
            style={{ marginTop: 12, padding: '8px 16px', borderRadius: 8, border: '1px solid #444', background: '#222', color: '#fff' }}
          >Reload</button>
        </div>
      );
    }
    return this.props.children;
  }
}
