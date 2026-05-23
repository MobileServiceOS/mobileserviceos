import { useEffect, useRef, useState } from 'react';
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  onAuthStateChanged,
  type User,
} from 'firebase/auth';
import { _auth } from '@/lib/firebase';
import { friendlyAuthError } from '@/lib/utils';
import { APP_LOGO, FALLBACK_LOGO_SVG } from '@/lib/defaults';
import {
  acceptInvite,
  getInviteByToken,
  validateInvite,
} from '@/lib/invites';
import { humanizeFirestoreError } from '@/lib/firebaseErrors';
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
  // Set when busy persists past ~6s — gives the user a "still
  // working, hang tight" signal instead of an indefinite spinner.
  const [slowHint, setSlowHint] = useState(false);
  // Tracks any signed-in Firebase user so the page can offer a
  // one-tap "Accept as <email>" path when the auth state matches the
  // invite — no need to re-enter a password the user already has on
  // their device.
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  // Held to prevent a stale "slow" timer firing after the component
  // unmounts. Cleared in the finally block of every submit path.
  const slowTimerRef = useRef<number | null>(null);

  // ─── Load invite on mount ───────────────────────────────────────
  // All raw Firestore errors are routed through humanizeFirestoreError
  // so the UI never shows error codes / stack traces. Status / expiry
  // / email checks are centralized in validateInvite() so this page
  // and acceptInvite() agree on every reject reason.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let invite: InviteDoc | null = null;
      try {
        invite = await getInviteByToken(token);
      } catch (err) {
        if (cancelled) return;
        // Log the raw error for ops; surface a calm string to the user.
        // eslint-disable-next-line no-console
        console.warn('[invites] load failed', err);
        setState({ kind: 'invalid', reason: humanizeFirestoreError(err) });
        return;
      }
      if (cancelled) return;
      const verdict = validateInvite(invite);
      if (!verdict.ok) {
        setState({ kind: 'invalid', reason: verdict.reason });
        return;
      }
      const ok = invite as InviteDoc;
      setEmailDraft(ok.email);
      setState({ kind: 'ready', invite: ok });
    })();
    return () => { cancelled = true; };
  }, [token]);

  // ─── Track current Firebase auth state ─────────────────────────
  // Two roles:
  //   1. Enables the "Accept as <email>" one-tap path below for users
  //      already signed in with the invited email (e.g. opened the
  //      link in the same browser they're already signed into).
  //   2. Lets us detect a wrong-account session and offer a clean
  //      sign-out before they try to accept.
  useEffect(() => {
    if (!_auth) return;
    const unsub = onAuthStateChanged(_auth, (u) => setCurrentUser(u));
    return () => unsub();
  }, []);

  // ─── Busy lifecycle helpers ─────────────────────────────────────
  // Centralized so every submit path (Google / email-signup /
  // email-login / one-tap-existing) gets the same slow-hint timer
  // semantics. The timer fires after 6 seconds of pending work and
  // shows "Still working — connecting to the server. This sometimes
  // takes a few seconds." so the user knows the screen isn't frozen.
  const beginBusy = () => {
    setBusy(true);
    setErr('');
    setSlowHint(false);
    if (slowTimerRef.current != null) window.clearTimeout(slowTimerRef.current);
    slowTimerRef.current = window.setTimeout(() => setSlowHint(true), 6000);
  };
  const endBusy = () => {
    setBusy(false);
    setSlowHint(false);
    if (slowTimerRef.current != null) {
      window.clearTimeout(slowTimerRef.current);
      slowTimerRef.current = null;
    }
  };
  useEffect(() => () => {
    // Cleanup on unmount.
    if (slowTimerRef.current != null) window.clearTimeout(slowTimerRef.current);
  }, []);

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
    if (!_auth) { setErr('Sign-in is temporarily unavailable. Please try again.'); return; }
    beginBusy();
    try {
      const c = await signInWithPopup(_auth, new GoogleAuthProvider());
      const ok = await finishAcceptance(c.user, state.invite);
      if (ok) onAuth(c.user);
    } catch (e) {
      setErr(friendlyAuthError(e as { code?: string; message?: string }));
    } finally {
      endBusy();
    }
  };

  // ─── One-tap accept (already signed in) ─────────────────────────
  // When the user is already signed in via Firebase Auth AND their
  // email matches the invite, skip the password step entirely. This
  // hits the path where someone opens an invite link in the same
  // browser they're already signed into (most desktop users) — no
  // reason to make them re-auth.
  const handleAcceptAsCurrent = async () => {
    if (state.kind !== 'ready' || busy || !currentUser) return;
    beginBusy();
    try {
      const ok = await finishAcceptance(currentUser, state.invite);
      if (ok) onAuth(currentUser);
    } catch (e) {
      setErr(friendlyAuthError(e as { code?: string; message?: string }));
    } finally {
      endBusy();
    }
  };

  // ─── Email / password path ──────────────────────────────────────
  // We let the user toggle between signup and login. Default is
  // signup since invitees are usually new — but if they already
  // have an MSOS account on this same email, they switch to login.
  const handleEmailSubmit = async () => {
    if (state.kind !== 'ready' || busy) return;
    if (!_auth) { setErr('Sign-in is temporarily unavailable. Please try again.'); return; }
    if (!emailDraft || !pass) {
      setErr('Enter your email and a password.');
      return;
    }
    if (pass.length < 6) {
      setErr('Password must be at least 6 characters.');
      return;
    }
    beginBusy();
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
      endBusy();
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

        {/* "Accept as <email>" — only when the user is ALREADY signed
            in with the invited email. Skips re-auth entirely. */}
        {currentUser
          && currentUser.email
          && currentUser.email.toLowerCase() === invite.email
          && (
            <>
              <button
                type="button"
                className="btn primary"
                onClick={handleAcceptAsCurrent}
                disabled={busy}
                style={{ width: '100%', marginBottom: 10 }}
              >
                {busy
                  ? (slowHint ? 'Still working — almost there…' : 'Working…')
                  : `Accept as ${currentUser.email}`}
              </button>
              <div style={{
                fontSize: 11, color: 'var(--t3)', marginBottom: 12,
                textAlign: 'center', lineHeight: 1.45,
              }}>
                You're already signed in. One tap is all it takes.
              </div>
            </>
          )}

        {/* Wrong-account warning: signed in, but as a different email.
            Surface the mismatch upfront so the user signs out before
            wasting a submit. */}
        {currentUser
          && currentUser.email
          && currentUser.email.toLowerCase() !== invite.email
          && (
            <div className="auth-banner" style={{
              padding: '10px 12px', marginBottom: 12, lineHeight: 1.45,
              background: 'rgba(244,180,0,.08)',
              border: '1px solid rgba(244,180,0,.3)',
              borderRadius: 8, color: 'var(--t2)', fontSize: 12,
            }}>
              You're currently signed in as <b>{currentUser.email}</b>, but
              this invite was sent to <b>{invite.email}</b>.{' '}
              <button
                type="button"
                onClick={async () => {
                  try { await _auth?.signOut(); }
                  catch { /* */ }
                }}
                style={{
                  background: 'transparent', border: 0, padding: 0,
                  color: 'var(--brand-primary)', fontWeight: 700,
                  textDecoration: 'underline', cursor: 'pointer',
                }}
              >
                Sign out
              </button>{' '}
              and continue with the invited account.
            </div>
          )}

        <button
          type="button"
          className="btn secondary"
          onClick={handleGoogle}
          disabled={busy}
          style={{ width: '100%', marginBottom: 10 }}
        >
          {busy && !slowHint ? 'Working…' :
           busy && slowHint  ? 'Still working…' :
           'Continue with Google'}
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
            ? (slowHint ? 'Still working — connecting to the server…' : 'Working…')
            : mode === 'signup'
              ? `Create account & join ${business}`
              : `Sign in & join ${business}`}
        </button>
        {/* Slow-connection sub-text. Appears under the button so the
            user knows the screen isn't stuck — it's just a slow round
            trip. Far less alarming than a silent spinner. */}
        {busy && slowHint && (
          <div style={{
            fontSize: 11, color: 'var(--t3)', marginTop: 8,
            textAlign: 'center', lineHeight: 1.5,
          }}>
            This sometimes takes a few seconds on a slow connection.{' '}
            If nothing happens after another 20 seconds, please reload
            and try again.
          </div>
        )}

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
