import { useEffect, useState } from 'react';
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  type User,
} from 'firebase/auth';
import { _auth } from '@/lib/firebase';
import { friendlyAuthError } from '@/lib/utils';
import { APP_LOGO, FALLBACK_LOGO_SVG } from '@/lib/defaults';
import {
  acceptInvite,
  getInviteByToken,
  isInviteAcceptable,
} from '@/lib/invites';
import type { InviteDoc } from '@/types';

interface Props {
  /** The opaque invite token pulled from `?invite=<token>` on page load. */
  token: string;
  /** Called after auth succeeds AND the invite is accepted. The parent
   *  (App.tsx) hands this to setUser so the rest of the app proceeds
   *  through the authenticated tree. */
  onAuth: (user: User) => void;
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'invalid'; reason: string }
  | { kind: 'ready'; invite: InviteDoc };

/**
 * InviteAccept — full-screen invite onboarding for both new and
 * existing users. Replaces the generic AuthScreen when the URL has a
 * `?invite=<token>` parameter.
 *
 * UX:
 *   1. Fetch invites/{token}, validate (exists, pending, not expired)
 *   2. If invalid, show a friendly error with link to the AuthScreen
 *   3. If valid, show:
 *        - Business name + role + inviter (so the invitee knows what
 *          they're joining)
 *        - Google sign-in button (one-tap for most users)
 *        - Email + password form (toggles between sign-in / sign-up
 *          based on whether the email matches an existing account)
 *   4. After auth, call acceptInvite(token, uid, email)
 *   5. If acceptance succeeds, call onAuth(user) — App.tsx routes
 *      to BrandProvider and the rest of the app loads
 *
 * Email guard: the invite was sent to a specific email. We pre-fill
 * the email field with that value and lock it (the invitee can edit
 * it, but acceptInvite will reject any mismatch). Google sign-in
 * users see a clear error if their Google email doesn't match.
 */
export function InviteAccept({ token, onAuth }: Props) {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [pass, setPass] = useState('');
  const [emailDraft, setEmailDraft] = useState('');
  const [mode, setMode] = useState<'signup' | 'login'>('signup');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  // ─── Load invite on mount ───────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let invite;
      try {
        invite = await getInviteByToken(token);
      } catch (err) {
        if (cancelled) return;
        // Surface the real Firestore error to the UI so permission /
        // network / config issues are diagnosable from the screen
        // instead of being silently swallowed. The error's code (e.g.
        // "permission-denied") + message tell us exactly what went
        // wrong on the server side.
        const e = err as { code?: string; message?: string };
        const detail = e.code ? `${e.code}: ${e.message || ''}` : (e.message || String(err));
        setState({
          kind: 'invalid',
          reason: `Could not load the invite. ${detail}`,
        });
        return;
      }
      if (cancelled) return;
      if (!invite) {
        setState({
          kind: 'invalid',
          reason: `This invite link is invalid or no longer exists. (token: ${token.slice(0, 8)}…)`,
        });
        return;
      }
      if (invite.status === 'accepted') {
        setState({
          kind: 'invalid',
          reason: 'This invite has already been accepted. Sign in with the account you created.',
        });
        return;
      }
      if (invite.status === 'revoked') {
        setState({ kind: 'invalid', reason: 'This invite was revoked by the team owner.' });
        return;
      }
      if (!isInviteAcceptable(invite)) {
        setState({
          kind: 'invalid',
          reason: 'This invite has expired. Ask the team owner to send a new one.',
        });
        return;
      }
      setEmailDraft(invite.email);
      setState({ kind: 'ready', invite });
    })();
    return () => { cancelled = true; };
  }, [token]);

  // ─── Acceptance pipeline ────────────────────────────────────────
  // Shared across all three auth paths (Google, email login, email
  // signup). Validates the auth'd user's email against the invite,
  // calls acceptInvite, and surfaces errors as a banner.
  const finishAcceptance = async (user: User, invite: InviteDoc): Promise<boolean> => {
    const authEmail = (user.email || '').trim().toLowerCase();
    if (!authEmail) {
      setErr("Your account doesn't have an email address. Use a different sign-in method.");
      return false;
    }
    if (authEmail !== invite.email) {
      setErr(
        `This invite was sent to ${invite.email}. You signed in as ${authEmail}. ` +
        `Sign out and use the matching account, or ask for a new invite.`,
      );
      // Sign the wrong-account user back out so they're not stuck
      // in a permission-denied dashboard.
      try { await _auth?.signOut(); } catch { /* */ }
      return false;
    }
    try {
      await acceptInvite(invite.token, user.uid, authEmail);
      return true;
    } catch (e) {
      setErr((e as Error).message || 'Failed to accept invite');
      return false;
    }
  };

  // ─── Google sign-in path ────────────────────────────────────────
  const handleGoogle = async () => {
    if (state.kind !== 'ready' || busy) return;
    if (!_auth) { setErr('Auth unavailable.'); return; }
    setBusy(true); setErr('');
    try {
      const c = await signInWithPopup(_auth, new GoogleAuthProvider());
      const ok = await finishAcceptance(c.user, state.invite);
      if (ok) onAuth(c.user);
    } catch (e) {
      setErr(friendlyAuthError(e as { code?: string; message?: string }));
    } finally {
      setBusy(false);
    }
  };

  // ─── Email / password path ──────────────────────────────────────
  // We let the user toggle between signup and login. Default is
  // signup since invitees are usually new — but if they already
  // have an MSOS account on this same email, they switch to login.
  const handleEmailSubmit = async () => {
    if (state.kind !== 'ready' || busy) return;
    if (!_auth) { setErr('Auth unavailable.'); return; }
    if (!emailDraft || !pass) {
      setErr('Enter your email and a password.');
      return;
    }
    if (pass.length < 6) {
      setErr('Password must be at least 6 characters.');
      return;
    }
    setBusy(true); setErr('');
    try {
      const c = mode === 'signup'
        ? await createUserWithEmailAndPassword(_auth, emailDraft, pass)
        : await signInWithEmailAndPassword(_auth, emailDraft, pass);
      const ok = await finishAcceptance(c.user, state.invite);
      if (ok) onAuth(c.user);
    } catch (e) {
      const errObj = e as { code?: string; message?: string };
      // Auto-toggle: if signup fails with "email already in use",
      // flip to login so the user doesn't have to figure it out.
      if (mode === 'signup' && errObj.code === 'auth/email-already-in-use') {
        setMode('login');
        setErr('An account already exists for this email — sign in with your password instead.');
      } else if (mode === 'login' && errObj.code === 'auth/user-not-found') {
        setMode('signup');
        setErr("No account found — let's create one. Pick a password (at least 6 characters).");
      } else {
        setErr(friendlyAuthError(errObj));
      }
    } finally {
      setBusy(false);
    }
  };

  // ─── Render: loading ────────────────────────────────────────────
  if (state.kind === 'loading') {
    return (
      <div className="auth-screen">
        <div className="auth-brand">
          <img src={APP_LOGO} alt="" className="auth-logo"
            onError={(e) => { (e.target as HTMLImageElement).src = FALLBACK_LOGO_SVG; }} />
          <div className="shimmer-text auth-name">Mobile Service OS</div>
          <div className="auth-tagline">Checking your invite…</div>
        </div>
      </div>
    );
  }

  // ─── Render: invalid ────────────────────────────────────────────
  if (state.kind === 'invalid') {
    return (
      <div className="auth-screen">
        <div className="auth-brand">
          <img src={APP_LOGO} alt="" className="auth-logo"
            onError={(e) => { (e.target as HTMLImageElement).src = FALLBACK_LOGO_SVG; }} />
          <div className="shimmer-text auth-name">Mobile Service OS</div>
          <div className="auth-tagline">Mobile Tire &amp; Roadside · OS</div>
        </div>
        <div className="auth-card">
          <div className="auth-card-title">Invite unavailable</div>
          <div className="auth-banner error" style={{ marginTop: 14, lineHeight: 1.5 }}>
            {state.reason}
          </div>
          <button
            className="btn primary"
            style={{ width: '100%', marginTop: 18 }}
            onClick={() => {
              // Drop the ?invite param and reload — sends the user to
              // the normal AuthScreen for fresh signin/signup.
              const url = new URL(window.location.href);
              url.searchParams.delete('invite');
              window.location.href = url.toString();
            }}
          >
            Continue to sign in
          </button>
        </div>
      </div>
    );
  }

  // ─── Render: ready (the main acceptance card) ───────────────────
  const { invite } = state;
  const business = invite.businessName || 'this team';
  const inviter = invite.invitedByDisplayName;
  const roleLabel = invite.role === 'admin' ? 'Admin' : 'Technician';

  return (
    <div className="auth-screen">
      <div className="auth-brand">
        <img src={APP_LOGO} alt="" className="auth-logo"
          onError={(e) => { (e.target as HTMLImageElement).src = FALLBACK_LOGO_SVG; }} />
        <div className="shimmer-text auth-name">Mobile Service OS</div>
        <div className="auth-tagline">Mobile Tire &amp; Roadside · OS</div>
      </div>

      <div className="auth-card">
        {/* Hero — business + role + inviter. Designed to look like an
            invitation card so the invitee feels welcomed, not auth-walled. */}
        <div style={{
          padding: '14px 14px 16px',
          marginBottom: 14,
          background: 'linear-gradient(160deg, rgba(200,164,74,.10) 0%, var(--s1) 100%)',
          border: '1px solid rgba(200,164,74,.3)',
          borderRadius: 12,
        }}>
          <div style={{
            fontSize: 9, fontWeight: 800, letterSpacing: 1.5,
            textTransform: 'uppercase', color: 'var(--brand-primary)',
            marginBottom: 6,
          }}>
            You're invited
          </div>
          <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--t1)', lineHeight: 1.25 }}>
            Join {business} as a {roleLabel.toLowerCase()}
          </div>
          {inviter && (
            <div style={{ fontSize: 12, color: 'var(--t2)', marginTop: 6 }}>
              Invited by {inviter}
            </div>
          )}
          {invite.note && (
            <div style={{
              fontSize: 12, color: 'var(--t2)', marginTop: 10,
              padding: '8px 10px', background: 'var(--s2)',
              borderRadius: 8, borderLeft: '3px solid var(--brand-primary)',
              fontStyle: 'italic', lineHeight: 1.45,
            }}>
              "{invite.note}"
            </div>
          )}
        </div>

        <div className="auth-card-title">
          {mode === 'signup' ? 'Create your account' : 'Sign in to accept'}
        </div>
        <div className="auth-card-sub" style={{ marginBottom: 14 }}>
          {mode === 'signup'
            ? 'Quick setup — we just need an email and password.'
            : "Welcome back — use your existing account to accept."}
        </div>

        {err && <div className="auth-banner error">{err}</div>}

        <button
          type="button"
          className="btn secondary"
          onClick={handleGoogle}
          disabled={busy}
          style={{ width: '100%', marginBottom: 10 }}
        >
          Continue with Google
        </button>

        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          fontSize: 10, color: 'var(--t3)', textTransform: 'uppercase',
          letterSpacing: 1, fontWeight: 800, margin: '12px 0',
        }}>
          <span style={{ flex: 1, height: 1, background: 'var(--border)' }} />
          or with email
          <span style={{ flex: 1, height: 1, background: 'var(--border)' }} />
        </div>

        <div className="field">
          <label>Email</label>
          <input
            type="email"
            value={emailDraft}
            onChange={(e) => setEmailDraft(e.target.value)}
            placeholder="you@example.com"
            disabled={busy}
            autoComplete="email"
          />
          <div style={{ fontSize: 10, color: 'var(--t3)', marginTop: 4 }}>
            This invite was sent to {invite.email} — your account must match.
          </div>
        </div>
        <div className="field">
          <label>Password</label>
          <input
            type="password"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            placeholder={mode === 'signup' ? 'At least 6 characters' : 'Your password'}
            disabled={busy}
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            onKeyDown={(e) => { if (e.key === 'Enter') void handleEmailSubmit(); }}
          />
        </div>

        <button
          type="button"
          className="btn primary"
          onClick={handleEmailSubmit}
          disabled={busy}
          style={{ width: '100%' }}
        >
          {busy
            ? 'Working…'
            : mode === 'signup'
              ? `Create account & join ${business}`
              : `Sign in & join ${business}`}
        </button>

        <button
          type="button"
          className="btn ghost"
          onClick={() => { setMode((m) => (m === 'signup' ? 'login' : 'signup')); setErr(''); }}
          disabled={busy}
          style={{ width: '100%', marginTop: 10, fontSize: 12 }}
        >
          {mode === 'signup'
            ? 'Already have an account? Sign in instead'
            : 'No account yet? Create one'}
        </button>
      </div>
    </div>
  );
}
