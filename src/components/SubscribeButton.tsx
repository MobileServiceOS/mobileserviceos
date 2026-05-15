import { useState } from 'react';
import type { Settings } from '@/types';
import { _auth } from '@/lib/firebase';
import { addToast } from '@/lib/toast';
import { startCheckout, createPortalLink } from '@/lib/stripeSync';
import { isBillingExempt, resolvePlan } from '@/lib/planAccess';

// ─────────────────────────────────────────────────────────────────────
//  SubscribeButton — production subscription CTA
//
//  Renders the right action for the right user, no clutter.
//
//  Decision matrix:
//
//    Account state              | Pro button       | Core button
//    ────────────────────────── | ──────────────── | ──────────────────
//    Billing exempt             | (no render)      | (no render)
//    Trialing                   | Start Pro …      | Start Core …
//    Active on Pro              | Current Plan ✓   | Switch to Core
//    Active on Core             | Upgrade to Pro   | Current Plan ✓
//    Past due                   | Manage billing   | Manage billing
//    Canceled / inactive        | Subscribe to Pro | Subscribe to Core
//
//  The "Current Plan" badge is a non-interactive button — it's visually
//  the most premium signal and doesn't tempt the user into clicking
//  something that would create a duplicate subscription.
//
//  Switch direction (Core ↔ Pro) routes through the Stripe Customer
//  Portal where the user can change their subscription plan. We
//  don't try to charge a new Checkout Session over an existing one —
//  Stripe handles proration cleanly via the portal.
//
//  If a plan's Stripe price ID isn't configured at build time, this
//  button simply does not render. The parent component should check
//  hasPriceId() before placing the card on the page.
// ─────────────────────────────────────────────────────────────────────

interface Props {
  settings: Settings;
  /** Which plan this button is for. */
  plan: 'pro' | 'core';
}

// Read both price IDs once at module load. Vite STATICALLY inlines
// these at build time — but only when accessed via the literal
// `import.meta.env.VITE_X` pattern. Any dynamic access (typed cast,
// destructuring through a generic Record, computed property) defeats
// the static replacement and leaves the value undefined in production.
//
// The // @ts-ignore is necessary because TypeScript doesn't know
// about Vite-injected env vars without a separate vite-env.d.ts.
const PRICE_IDS = {
  // @ts-ignore — Vite injects this at build time
  pro: (import.meta.env.VITE_STRIPE_PRO_PRICE_ID as string | undefined) || '',
  // @ts-ignore — Vite injects this at build time
  core: (import.meta.env.VITE_STRIPE_CORE_PRICE_ID as string | undefined) || '',
} as const;

// Surface in console at boot — helps diagnose "cards not showing"
// issues without having to grep the bundle.
// eslint-disable-next-line no-console
console.info('[subscribe] price IDs configured:', {
  pro: PRICE_IDS.pro ? `${PRICE_IDS.pro.slice(0, 12)}…` : 'MISSING',
  core: PRICE_IDS.core ? `${PRICE_IDS.core.slice(0, 12)}…` : 'MISSING',
});

/**
 * Check if a given plan has a configured Stripe price ID at build
 * time. Use this in parent components to decide whether to render
 * the entire plan card — keeps the UI clean by hiding unconfigured
 * plans entirely instead of showing disabled placeholders.
 */
export function hasPriceId(plan: 'pro' | 'core'): boolean {
  return Boolean(PRICE_IDS[plan]);
}

export function SubscribeButton({ settings, plan }: Props) {
  const [busy, setBusy] = useState(false);

  // Defensive exemption check.
  if (isBillingExempt(settings)) return null;

  const planLabel = plan === 'pro' ? 'Pro' : 'Core';

  // No price ID for this plan → show a clear inline diagnostic
  // instead of silently hiding. A hidden card is worse than a
  // visible error: the user sees nothing wrong, the dev has nothing
  // to grep for. With the diagnostic, both audiences know exactly
  // what's missing.
  const priceId = PRICE_IDS[plan];
  if (!priceId) {
    return (
      <button
        className="btn"
        disabled
        style={{
          width: '100%',
          marginTop: 8,
          background: 'var(--s2)',
          border: '1px solid var(--border)',
          color: 'var(--t3)',
          fontWeight: 600,
          fontSize: 12,
          cursor: 'not-allowed',
          opacity: 1,
          padding: '12px 10px',
          lineHeight: 1.3,
        }}
        title={`Missing build-time env var VITE_STRIPE_${plan.toUpperCase()}_PRICE_ID`}
      >
        {planLabel} checkout unavailable
      </button>
    );
  }

  const status = settings.subscriptionStatus;
  const isPaid = status === 'active' || status === 'past_due';
  const pastDue = status === 'past_due';
  const isTrialing = status === 'trialing';
  const currentPlan = resolvePlan(settings);
  const isThisCurrentPlan = isPaid && currentPlan === plan;

  // ─── Current plan: non-interactive badge ─────────────────────
  if (isThisCurrentPlan) {
    return (
      <button
        className="btn"
        disabled
        style={{
          width: '100%',
          marginTop: 8,
          background: 'rgba(200,164,74,.1)',
          border: '1px solid rgba(200,164,74,.4)',
          color: 'var(--brand-primary)',
          fontWeight: 700,
          cursor: 'default',
          opacity: 1,
        }}
      >
        ✓ Current Plan
      </button>
    );
  }

  // ─── Click handler ───────────────────────────────────────────
  const handleClick = async () => {
    const uid = _auth?.currentUser?.uid;
    if (!uid) {
      addToast('Please sign in first', 'warn');
      return;
    }
    setBusy(true);
    // Safety timeout — if startCheckout's internal 10s timeout for
    // some reason doesn't fire (e.g., promise chain swallowed),
    // make absolutely sure the button doesn't get stuck. 12s gives
    // the internal timeout a beat to surface its own error.
    const stuckGuard = setTimeout(() => {
      // eslint-disable-next-line no-console
      console.warn('[SubscribeButton] stuck-guard fired — checkout never completed');
      setBusy(false);
      addToast('Checkout could not start. Please try again.', 'error');
    }, 12_000);
    try {
      if (isPaid) {
        // User has an active subscription — switching plans goes
        // through the Stripe Customer Portal, which handles proration
        // and avoids duplicate subscriptions.
        const url = await createPortalLink();
        window.location.assign(url);
      } else {
        await startCheckout(uid, priceId);
      }
      // If we reach here without a redirect, the operation succeeded
      // but didn't navigate away — unusual, but clear the guard.
      clearTimeout(stuckGuard);
    } catch (e) {
      clearTimeout(stuckGuard);
      addToast((e as Error).message || 'Checkout could not start. Please try again.', 'error');
      setBusy(false);
    }
    // Intentionally don't reset busy on success — redirect is mid-flight.
  };

  // ─── Compute button label based on context ──────────────────
  let label: string;
  if (busy) {
    label = 'Opening Stripe…';
  } else if (pastDue) {
    label = 'Update payment method';
  } else if (isPaid) {
    // User is on the OTHER plan → offer the swap
    label = plan === 'pro' ? 'Upgrade to Pro' : 'Switch to Core';
  } else if (isTrialing) {
    // User is already trialing on the other plan — switch to this one
    label = plan === 'pro' ? 'Switch trial to Pro' : 'Switch trial to Core';
  } else {
    // Fresh signup with no subscription yet — start the 14-day trial
    label = `Start ${planLabel} Trial`;
  }

  // ─── Pro = gold primary, Core = secondary outline ───────────
  const isPrimary = plan === 'pro';

  return (
    <button
      className={isPrimary ? 'btn primary' : 'btn secondary'}
      onClick={handleClick}
      disabled={busy}
      style={{ width: '100%', marginTop: 8 }}
    >
      {label}
    </button>
  );
}

export default SubscribeButton;
