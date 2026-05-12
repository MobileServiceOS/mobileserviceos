import { Component, type ReactNode, type CSSProperties } from 'react';
import { signOut } from 'firebase/auth';
import { _auth } from '@/lib/firebase';

interface State {
  hasError: boolean;
  error?: Error;
  copied: boolean;
  signingOut: boolean;
}

/**
 * Top-level error boundary.
 *
 * Catches any unhandled render-phase exception below it and shows a
 * branded recovery screen with three escape hatches:
 *   1. Reload — fixes most transient render errors (stale state, etc.)
 *   2. Sign out — for cases where the error is auth-related or persists
 *      across reloads (corrupt user state, stuck onboarding flag)
 *   3. Copy details — gives the user something concrete to paste to
 *      support without us shipping a real telemetry pipeline yet
 *
 * Once the user takes any action we reset hasError so React re-renders
 * the tree fresh.
 *
 * Why a class component? `componentDidCatch` and `getDerivedStateFromError`
 * are class-only React APIs. There is no hooks equivalent as of React 18.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { hasError: false, copied: false, signingOut: false };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error) {
    // Log to console for now. A future batch should wire this into a
    // proper telemetry sink (Sentry, LogRocket, etc.) so we get crash
    // visibility without relying on users to report.
    console.error('[ErrorBoundary] caught:', error);
  }

  private handleReload = () => {
    window.location.reload();
  };

  private handleSignOut = async () => {
    this.setState({ signingOut: true });
    try {
      if (_auth) await signOut(_auth);
    } catch (e) {
      console.warn('[ErrorBoundary] sign-out failed:', e);
    }
    // Force a full reload AFTER sign-out so auth state, in-memory stores,
    // and the service-worker controller all re-initialize from scratch.
    // Without this, residual React state from before the error can keep
    // the user in a broken view.
    window.location.reload();
  };

  private handleCopy = async () => {
    const text = this.errorReport();
    try {
      await navigator.clipboard.writeText(text);
      this.setState({ copied: true });
      // Reset the "Copied!" label after 2s in case the user wants to try again.
      setTimeout(() => this.setState({ copied: false }), 2000);
    } catch {
      // Clipboard API unavailable (older iOS Safari, file://, etc.).
      // Fall back to a prompt so the user can manually copy.
      window.prompt('Copy this error report:', text);
    }
  };

  private errorReport(): string {
    const { error } = this.state;
    return [
      'Mobile Service OS — Error Report',
      `Time: ${new Date().toISOString()}`,
      `URL: ${typeof location !== 'undefined' ? location.href : ''}`,
      `User-Agent: ${typeof navigator !== 'undefined' ? navigator.userAgent : ''}`,
      '',
      `Message: ${error?.message || 'Unknown'}`,
      '',
      'Stack:',
      error?.stack || '(no stack)',
    ].join('\n');
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    const { error, copied, signingOut } = this.state;

    return (
      <div style={styles.screen}>
        <div style={styles.card}>
          <div style={styles.icon}>⚠️</div>

          <h1 style={styles.title}>Something went wrong</h1>
          <p style={styles.subtitle}>
            Your data is safe in the cloud. This is a display problem on this
            device only. Try one of the options below.
          </p>

          <div style={styles.actions}>
            <button
              onClick={this.handleReload}
              style={{ ...styles.btn, ...styles.btnPrimary }}
            >
              Reload app
            </button>
            <button
              onClick={this.handleSignOut}
              disabled={signingOut}
              style={{ ...styles.btn, ...styles.btnSecondary, opacity: signingOut ? 0.5 : 1 }}
            >
              {signingOut ? 'Signing out…' : 'Sign out'}
            </button>
          </div>

          <details style={styles.details}>
            <summary style={styles.detailsSummary}>Show technical details</summary>
            <div style={styles.errorBox}>
              <strong>{error?.message || 'Unknown error'}</strong>
              {error?.stack && (
                <pre style={styles.stack}>{error.stack.split('\n').slice(0, 6).join('\n')}</pre>
              )}
            </div>
            <button
              onClick={this.handleCopy}
              style={{ ...styles.btn, ...styles.btnGhost, marginTop: 10 }}
            >
              {copied ? '✓ Copied' : 'Copy error report'}
            </button>
            <p style={styles.detailsHint}>
              Paste this in an email to support so we can diagnose the issue.
            </p>
          </details>
        </div>
      </div>
    );
  }
}

// Inline styles — we can't rely on app.css being loaded if a CSS-related
// error caused the boundary to trigger. Keep this self-contained.
const styles: Record<string, CSSProperties> = {
  screen: {
    minHeight: '100vh',
    background: '#06070a',
    color: '#f4f4f5',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '24px 16px',
    boxSizing: 'border-box',
  },
  card: {
    width: '100%',
    maxWidth: 440,
    background: '#0b0d12',
    border: '1px solid #1f2430',
    borderRadius: 18,
    padding: '28px 22px',
    textAlign: 'center',
  },
  icon: {
    fontSize: 44,
    marginBottom: 8,
  },
  title: {
    fontSize: 20,
    fontWeight: 800,
    margin: '0 0 8px 0',
    color: '#f4f4f5',
  },
  subtitle: {
    fontSize: 13,
    color: '#a1a1aa',
    lineHeight: 1.55,
    margin: '0 auto 22px',
    maxWidth: 340,
  },
  actions: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    marginBottom: 18,
  },
  btn: {
    padding: '12px 16px',
    borderRadius: 10,
    fontSize: 14,
    fontWeight: 700,
    border: '1px solid transparent',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  btnPrimary: {
    background: '#c8a44a',
    color: '#06070a',
  },
  btnSecondary: {
    background: '#181c25',
    color: '#f4f4f5',
    border: '1px solid #1f2430',
  },
  btnGhost: {
    background: 'transparent',
    color: '#a1a1aa',
    border: '1px solid #1f2430',
    width: '100%',
    fontSize: 12,
    padding: '8px 12px',
  },
  details: {
    textAlign: 'left',
    borderTop: '1px solid #1f2430',
    paddingTop: 16,
    marginTop: 4,
  },
  detailsSummary: {
    cursor: 'pointer',
    fontSize: 11,
    fontWeight: 700,
    color: '#71717a',
    textTransform: 'uppercase',
    letterSpacing: '1.5px',
    listStyle: 'none',
  },
  errorBox: {
    background: '#11141b',
    border: '1px solid #1f2430',
    borderRadius: 10,
    padding: 12,
    marginTop: 10,
    fontSize: 12,
    color: '#ef4444',
    overflow: 'auto',
  },
  stack: {
    fontSize: 10,
    color: '#71717a',
    margin: '8px 0 0',
    whiteSpace: 'pre-wrap' as const,
    wordBreak: 'break-word' as const,
    maxHeight: 120,
    overflow: 'auto',
    fontFamily: 'ui-monospace, Menlo, monospace',
  },
  detailsHint: {
    fontSize: 10,
    color: '#71717a',
    margin: '8px 0 0 0',
    lineHeight: 1.5,
  },
};
