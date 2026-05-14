import { useState } from 'react';
import type { Settings } from '@/types';
import { _auth } from '@/lib/firebase';
import { addToast } from '@/lib/toast';
import { startCheckout, createPortalLink } from '@/lib/stripeSync';
import { isBillingExempt } from '@/lib/planAccess';
import { PRO_PRICE_LINE, CORE_PRICE_LINE } from '@/lib/pricing-display';

// ─────────────────────────────────────────────────────────────────────
//  SubscribeButton
//
//  Drop-in button for the Settings → Subscription accordion. Supports
//  both Pro and Core plans. Auto-detects which flow to launch:
//
//    - subscriptionStatus is 'active' / 'past_due'  → Stripe Customer Portal
//      (manage card, cancel, view invoices). The plan prop is ignored
//      here — the portal handles everything.
//
//    - subscriptionStatus is 'trialing' / 'inactive' / 'canceled' →
//      Stripe Checkout Session using the price ID for the selected plan.
//
//  Billing-exempt accounts render NOTHING — those bypass Stripe entirely.
//
//  Stripe price IDs are read from VITE_STRIPE_PRO_PRICE_ID and
//  VITE_STRIPE_CORE_PRICE_ID at build time. If a plan's price ID is
//  missing, that plan's button shows "Coming soon" instead of crashing.
// ─────────────────────────────────────────────────────────────────────

interface Props {
  settings: Settings;
  /** Which plan this button is for. Defaults to 'pro' for back-compat
   *  with existing call sites that don't pass the prop. */
  plan?: 'pro' | 'core';
}

// Read both price IDs once at module load. Vite inlines these at build
// time. If a secret isn't injected (e.g. local dev or missing CI var),
// the corresponding string is empty and the button shows a disabled
// state instead of trying to open Stripe.
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

export function SubscribeButton({ settings, plan = 'pro' }: Props) {
  const [busy, setBusy] = useState(false);

  // Defensive exemption check.
  if (isBillingExempt(settings)) return null;

  const status = settings.subscriptionStatus;
  const isPaid = status === 'active' || status === 'past_due';

  // If user already has an active subscription, only render the manage-
  // billing button on the FIRST instance of this component on the page
  // (the Pro button). The Core button hides because there's nothing
  // to do — you can't have two simultaneous subscriptions.
  if (isPaid && plan === 'core') return null;

  const priceId = PRICE_IDS[plan];
  const priceLine = plan === 'pro' ? PRO_PRICE_LINE : CORE_PRICE_LINE;
  const planLabel = plan === 'pro' ? 'Pro' : 'Core';

  // Pre-flight: missing price ID for this plan → disabled "coming soon".
  if (!priceId) {
    return (
      <button
        className="btn secondary"
        disabled
        style={{ width: '100%', opacity: 0.6, marginTop: 8 }}
        title={`Stripe price ID not configured for ${planLabel} plan`}
      >
        {planLabel} · Coming soon
      </button>
    );
  }

  const handleClick = async () => {
    const uid = _auth?.currentUser?.uid;
    if (!uid) {
      addToast('Please sign in first', 'warn');
      return;
    }
    setBusy(true);
    try {
      if (isPaid) {
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

  return (
    <button
      className={plan === 'pro' ? 'btn primary' : 'btn secondary'}
      onClick={handleClick}
      disabled={busy}
      style={{ width: '100%', marginTop: plan === 'core' ? 8 : 0 }}
    >
      {busy
        ? 'Opening Stripe…'
        : isPaid
          ? 'Manage billing'
          : `Subscribe to ${planLabel} · ${priceLine}`}
    </button>
  );
}

export default SubscribeButton;
