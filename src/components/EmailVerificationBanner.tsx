  import { useEffect, useState } from 'react';
import { sendEmailVerification } from 'firebase/auth';
import { _auth } from '@/lib/firebase';
import { addToast } from '@/lib/toast';

// ─────────────────────────────────────────────────────────────────────
//  EmailVerificationBanner
//
//  Renders ONLY when:
//    - User is signed in via email/password (provider 'password')
//    - emailVerified === false
//    - User hasn't dismissed for this session
//
//  Behavior:
//    - Slim amber strip at the top of the app
//    - "Resend" button calls sendEmailVerification (rate-limited by Firebase)
//    - "I verified" button reloads the user object to refresh the
//      emailVerified flag (Firebase doesn't push this; we have to pull)
//    - "✕" dismiss button hides for the session (sessionStorage)
//
//  Google sign-ins are pre-verified, so this never renders for them.
//  Re-rendered automatically every 30s to pick up verification via
//  reload() so users who just clicked the email link see it clear.
// ─────────────────────────────────────────────────────────────────────

const DISMISS_KEY = 'msos_email_verify_dismissed';

export function EmailVerificationBanner() {
  const [tick, setTick] = useState(0);
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState<boolean>(() => {
    try {
      return sessionStorage.getItem(DISMISS_KEY) === '1';
    } catch {
      return false;
    }
  });

  // Re-render every 30s so the banner picks up verification status
  // without requiring the user to manually refresh. Cheap because the
  // banner does nothing when verified.
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30000);
    return () => clearInterval(id);
  }, []);

  // Eagerly reload the user object whenever this component mounts —
  // catches the common flow where the user clicks the email link in
  // another tab, comes back to the app, and expects the banner gone.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (_auth?.currentUser) {
          await _auth.currentUser.reload();
          if (!cancelled) setTick((t) => t + 1);
        }
      } catch { /* */ }
    })();
    return () => { cancelled = true; };
  }, [tick]);

  const u = _auth?.currentUser;
  if (!u) return null;
  if (u.emailVerified) return null;
  if (dismissed) return null;

  // Only show for email/password sign-ins. Google = pre-verified.
  const providerId = u.providerData?.[0]?.providerId;
  if (providerId !== 'password') return null;

  const resend = async () => {
    if (!u) return;
    setBusy(true);
    try {
      await sendEmailVerification(u);
      addToast('Verification email sent — check your inbox', 'success');
    } catch (e) {
      const msg = (e as Error).message || 'Failed to send';
      const friendly = /too-many-requests/i.test(msg)
        ? 'Hold on — too many attempts. Try again in a few minutes.'
        : msg;
      addToast(friendly, 'error');
    } finally {
      setBusy(false);
    }
  };

  const refresh = async () => {
    if (!u) return;
    setBusy(true);
    try {
      await u.reload();
      setTick((t) => t + 1);
      if (_auth?.currentUser?.emailVerified) {
        addToast('Email verified ✓', 'success');
      } else {
        addToast('Not verified yet — check the email link', 'warn');
      }
    } finally {
      setBusy(false);
    }
  };

  const dismiss = () => {
    try { sessionStorage.setItem(DISMISS_KEY, '1'); } catch { /* */ }
    setDismissed(true);
  };

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        background: 'rgba(245,158,11,.12)',
        borderBottom: '1px solid rgba(245,158,11,.3)',
        color: 'var(--t1)',
        padding: '10px 14px',
        display: 'flex', alignItems: 'center', gap: 10,
        fontSize: 12, lineHeight: 1.4,
        flexWrap: 'wrap',
      }}
    >
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ fontWeight: 700, color: 'var(--amber, #f59e0b)' }}>Verify your email</span>
        <span style={{ color: 'var(--t2)', marginLeft: 8 }}>
          {u.email || 'Your inbox'} · check for the link
        </span>
      </span>
      <button
        onClick={resend}
        disabled={busy}
        style={{
          padding: '5px 10px',
          background: 'transparent',
          color: 'var(--t1)',
          border: '1px solid var(--border2)',
          borderRadius: 6,
          fontSize: 11, fontWeight: 700,
          cursor: 'pointer',
          opacity: busy ? 0.5 : 1,
        }}
      >
        Resend
      </button>
      <button
        onClick={refresh}
        disabled={busy}
        style={{
          padding: '5px 10px',
          background: 'var(--brand-primary)',
          color: '#000',
          border: 'none',
          borderRadius: 6,
          fontSize: 11, fontWeight: 800,
          cursor: 'pointer',
          opacity: busy ? 0.5 : 1,
        }}
      >
        I verified
      </button>
      <button
        onClick={dismiss}
        aria-label="Dismiss"
        style={{
          padding: '5px 8px',
          background: 'transparent',
          color: 'var(--t3)',
          border: 'none',
          fontSize: 14, fontWeight: 700,
          cursor: 'pointer',
        }}
      >
        ✕
      </button>
    </div>
  );
}
