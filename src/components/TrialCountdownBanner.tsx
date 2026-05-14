import { useEffect, useState } from 'react';
import type { Settings } from '@/types';
import { isBillingExempt } from '@/lib/planAccess';

// ─────────────────────────────────────────────────────────────────────
//  TrialCountdownBanner
//
//  Renders ONLY when:
//    - subscriptionStatus === 'trialing'
//    - trialEndsAt is in the future (or recent past — see below)
//    - User isn't billingExempt
//    - User hasn't dismissed for this session (only when > 3 days left)
//
//  Color escalation:
//    - 8-14 days left → gold/subtle (informational, dismissible)
//    - 4-7 days left → amber/warning (informational, dismissible)
//    - 1-3 days left → orange/urgent (NOT dismissible)
//    - 0 days left or expired → red/locked (NOT dismissible, no subscribe = lockout)
//
//  After trialEndsAt passes, the banner stays visible until the user
//  either subscribes (subscriptionStatus → 'active') or the plan
//  resolves back to 'core'. This is the conversion-or-downgrade moment.
//
//  CTA → opens Settings → Subscription accordion via setTab + a session
//  flag the SubscriptionAccordion reads to auto-expand on mount.
// ─────────────────────────────────────────────────────────────────────

const DISMISS_KEY = 'msos_trial_banner_dismissed';

interface Props {
  settings: Settings;
  onSubscribe: () => void;
}

export function TrialCountdownBanner({ settings, onSubscribe }: Props) {
  const [dismissed, setDismissed] = useState<boolean>(() => {
    try {
      return sessionStorage.getItem(DISMISS_KEY) === '1';
    } catch {
      return false;
    }
  });

  // Re-render every minute so the countdown stays fresh without a
  // page reload. Cheap — the banner does nothing when not trialing.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  // Gate: don't render for exempt accounts (lifetime Pro / founder).
  if (isBillingExempt(settings)) return null;

  // Gate: only render during trialing status.
  if (settings.subscriptionStatus !== 'trialing') return null;

  // Resolve trial end date. Settings type accepts Timestamp | Date |
  // string; we coerce to a millisecond number for arithmetic.
  const endMs = resolveTimestampMs(settings.trialEndsAt);
  if (!endMs) return null;

  const nowMs = Date.now();
  const remainingMs = endMs - nowMs;
  const daysLeft = Math.ceil(remainingMs / (1000 * 60 * 60 * 24));

  // Past expiry: show lockout banner.
  const expired = remainingMs <= 0;

  // Urgency tiers — 1-3 days OR expired cannot be dismissed.
  const urgent = expired || daysLeft <= 3;
  const warning = !urgent && daysLeft <= 7;

  if (dismissed && !urgent) return null;

  const dismiss = () => {
    if (urgent) return;
    try { sessionStorage.setItem(DISMISS_KEY, '1'); } catch { /* */ }
    setDismissed(true);
  };

  // Theme by urgency tier.
  const theme = expired
    ? { bg: 'rgba(239,68,68,.12)', border: 'rgba(239,68,68,.35)', accent: '#ef4444' }
    : urgent
      ? { bg: 'rgba(249,115,22,.12)', border: 'rgba(249,115,22,.35)', accent: '#f97316' }
      : warning
        ? { bg: 'rgba(245,158,11,.12)', border: 'rgba(245,158,11,.30)', accent: '#f59e0b' }
        : { bg: 'rgba(200,164,74,.10)', border: 'rgba(200,164,74,.25)', accent: 'var(--brand-primary, #c8a44a)' };

  // Copy by tier.
  const title = expired
    ? 'Trial ended'
    : urgent
      ? `Trial ends in ${daysLeft} day${daysLeft !== 1 ? 's' : ''}`
      : warning
        ? `${daysLeft} days left in your trial`
        : `Free trial · ${daysLeft} days left`;

  const sub = expired
    ? 'Subscribe to keep Pro features unlocked.'
    : urgent
      ? 'Subscribe before lockout to keep Pro features.'
      : 'You have full access during your trial.';

  return (
    <div
      role={urgent ? 'alert' : 'status'}
      aria-live={urgent ? 'assertive' : 'polite'}
      style={{
        background: theme.bg,
        borderBottom: `1px solid ${theme.border}`,
        color: 'var(--t1)',
        padding: '10px 14px',
        display: 'flex', alignItems: 'center', gap: 10,
        fontSize: 12, lineHeight: 1.4,
        flexWrap: 'wrap',
      }}
    >
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ fontWeight: 800, color: theme.accent }}>{title}</span>
        <span style={{ color: 'var(--t2)', marginLeft: 8 }}>{sub}</span>
      </span>
      <button
        onClick={onSubscribe}
        style={{
          padding: '6px 12px',
          background: theme.accent,
          color: expired ? '#fff' : (urgent ? '#fff' : '#000'),
          border: 'none',
          borderRadius: 6,
          fontSize: 11, fontWeight: 800,
          cursor: 'pointer',
          whiteSpace: 'nowrap',
        }}
      >
        Subscribe →
      </button>
      {!urgent && (
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
      )}
    </div>
  );
}

/**
 * Coerce a Settings timestamp (Firestore Timestamp | Date | ISO string |
 * millis number | undefined) to a millisecond number. Returns null when
 * the value can't be resolved.
 */
function resolveTimestampMs(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const parsed = Date.parse(v);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (v instanceof Date) return v.getTime();
  // Firestore Timestamp duck-typing — has .toDate() or .seconds.
  if (typeof v === 'object') {
    const t = v as { toDate?: () => Date; seconds?: number; toMillis?: () => number };
    if (typeof t.toMillis === 'function') return t.toMillis();
    if (typeof t.toDate === 'function') return t.toDate().getTime();
    if (typeof t.seconds === 'number') return t.seconds * 1000;
  }
  return null;
}
