import { useState } from 'react';
import type { Settings } from '@/types';
import { _auth } from '@/lib/firebase';
import { addToast } from '@/lib/toast';
import { startCheckout, createPortalLink } from '@/lib/stripeSync';
import { isBillingExempt, resolvePlan } from '@/lib/planAccess';
import { PRO_PRICE_LINE, CORE_PRICE_LINE } from '@/lib/pricing-display';

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

// Read both price IDs once at module load. Vite inlines these at build
// time. If a secret isn't injected, the corresponding string is empty
// and the button refuses to render.
const PRICE_IDS = (() => {
  try {
    const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
    return {
      pro: env?.VITE_STRIPE_PRO_PRICE_ID || '',
      core: env?.VITE_STRIPE_CORE_PRICE_ID || '',
    };
  } catch {
    return { pro: '', core: '' };
  }
})();

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

  // No price ID for this plan → don't render anything. The parent
  // card should also not exist in this state.
  const priceId = PRICE_IDS[plan];
  if (!priceId) return null;

  const status = settings.subscriptionStatus;
  const isPaid = status === 'active' || status === 'past_due';
  const pastDue = status === 'past_due';
  const isTrialing = status === 'trialing';
  const currentPlan = resolvePlan(settings);
  const isThisCurrentPlan = isPaid && currentPlan === plan;

  const planLabel = plan === 'pro' ? 'Pro' : 'Core';
  const priceLine = plan === 'pro' ? PRO_PRICE_LINE : CORE_PRICE_LINE;

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
    } catch (e) {
      addToast((e as Error).message || 'Could not start checkout', 'error');
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
    label = `Start ${planLabel} · ${priceLine}`;
  } else {
    label = `Subscribe to ${planLabel} · ${priceLine}`;
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
