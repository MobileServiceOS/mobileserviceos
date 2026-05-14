import { useState } from 'react';
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signInWithPopup,
  sendEmailVerification,
  GoogleAuthProvider,
  type User,
} from 'firebase/auth';
import { _auth } from '@/lib/firebase';
import { friendlyAuthError } from '@/lib/utils';
import { APP_LOGO, FALLBACK_LOGO_SVG } from '@/lib/defaults';

interface Props {
  onAuth: (user: User) => void;
}

export function AuthScreen({ onAuth }: Props) {
  const [email, setEmail] = useState('');
  const [pass, setPass] = useState('');
  const [mode, setMode] = useState<'login' | 'signup' | 'reset'>('login');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  const submit = async () => {
    if (!email || (mode !== 'reset' && !pass)) {
      setErr('Enter your email' + (mode !== 'reset' ? ' and password.' : '.'));
      return;
    }
    if (!_auth) { setErr('Auth unavailable.'); return; }
    setBusy(true); setErr('');
    try {
      if (mode === 'reset') {
        await sendPasswordResetEmail(_auth, email);
        setResetSent(true);
      } else {
        const c = mode === 'login'
          ? await signInWithEmailAndPassword(_auth, email, pass)
          : await createUserWithEmailAndPassword(_auth, email, pass);

        // On signup with email/password, fire a verification email
        // immediately. Non-blocking — if it fails (rate-limited, etc.)
        // we don't prevent the user from proceeding. They'll see a
        // persistent banner inside the app prompting them to verify,
        // and they can resend from Settings → Account.
        //
        // Google sign-ins are already considered email-verified by
        // Firebase, so we skip them.
        if (mode === 'signup') {
          try {
            await sendEmailVerification(c.user);
          } catch (verifyErr) {
            // Log but don't block — the in-app banner will offer
            // resend. Production telemetry would capture this.
            console.warn('[auth] verification email failed:', verifyErr);
          }
        }
        onAuth(c.user);
      }
    } catch (e) {
      setErr(friendlyAuthError(e as { code?: string; message?: string }));
    } finally {
      setBusy(false);
    }
  };

  const google = async () => {
    if (!_auth) return;
    try {
      const c = await signInWithPopup(_auth, new GoogleAuthProvider());
      onAuth(c.user);
    } catch (e) {
      setErr(friendlyAuthError(e as { code?: string; message?: string }));
    }
  };

  return (
    <div className="auth-screen">
      <div className="auth-brand">
        <img src={APP_LOGO} alt="Mobile Service OS" className="auth-logo"
          onError={(e) => { (e.target as HTMLImageElement).src = FALLBACK_LOGO_SVG; }} />
        <div className="shimmer-text auth-name">Mobile Service OS</div>
        <div className="auth-tagline">Mobile Tire &amp; Roadside · OS</div>
      </div>

      <div className="auth-card">
        <div className="auth-card-title">
          {mode === 'login' ? 'Welcome back' : mode === 'signup' ? 'Create your account' : 'Reset password'}
        </div>
        <div className="auth-card-sub">
          {mode === 'login' ? 'Sign in to continue'
            : mode === 'signup' ? "We'll set up your business in the next step"
            : 'Enter your email and we will send a reset link'}
        </div>

        {resetSent && <div className="auth-banner success">Password reset email sent. Check your inbox.</div>}
        {err && <div className="auth-banner error">{err}</div>}

        <div className="auth-field">
          <label className="auth-label">Email</label>
          <input className="auth-inp2" type="email" autoComplete="email" placeholder="you@email.com"
            value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        {mode !== 'reset' && (
          <div className="auth-field">
            <label className="auth-label">Password</label>
            <input className="auth-inp2" type="password"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              placeholder="••••••••" value={pass}
              onChange={(e) => setPass(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit()} />
          </div>
        )}
        <button className="auth-btn-main" onClick={submit} disabled={busy}>
          {busy ? '...' : mode === 'login' ? 'Sign In' : mode === 'signup' ? 'Create Account' : 'Send Reset Email'}
        </button>
        {mode !== 'reset' && (
          <>
            <div className="auth-divider"><span>or</span></div>
            <button className="auth-btn-google" onClick={google}>
              <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
                <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 01-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" />
                <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z" />
                <path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.997 8.997 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" />
                <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.581-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" />
              </svg>{' '}
              Continue with Google
            </button>
          </>
        )}
        <div className="auth-links">
          <button onClick={() => { setMode((m) => (m === 'login' ? 'signup' : 'login')); setErr(''); setResetSent(false); }}>
            {mode === 'login' ? 'Need an account? Sign up'
              : mode === 'signup' ? 'Already have an account?'
              : 'Back to sign in'}
          </button>
          {mode === 'login' && (
            <button onClick={() => { setMode('reset'); setErr(''); }} className="auth-link-accent">Forgot password?</button>
          )}
        </div>
      </div>
      {/* Footer legal links — visible BEFORE signup so prospective
          users can review the policies before creating an account.
          Routed via ?legal= URL param so the link is shareable. */}
      <div style={{
        marginTop: 18, textAlign: 'center',
        fontSize: 11, color: 'var(--t3)',
      }}>
        <a
          href="?legal=privacy"
          style={{ color: 'var(--t3)', textDecoration: 'none', padding: '0 8px' }}
        >
          Privacy Policy
        </a>
        ·
        <a
          href="?legal=terms"
          style={{ color: 'var(--t3)', textDecoration: 'none', padding: '0 8px' }}
        >
          Terms of Service
        </a>
        ·
        <a
          href="?help=1"
          style={{ color: 'var(--t3)', textDecoration: 'none', padding: '0 8px' }}
        >
          Help
        </a>
      </div>
    </div>
  );
}
