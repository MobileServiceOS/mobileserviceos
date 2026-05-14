import { useState } from 'react';
import type { Settings } from '@/types';
import { _auth } from '@/lib/firebase';
import { addToast } from '@/lib/toast';
import { startCheckout, createPortalLink } from '@/lib/stripeSync';
import { isBillingExempt } from '@/lib/planAccess';
import { PRO_PRICE_LINE } from '@/lib/pricing-display';

// ─────────────────────────────────────────────────────────────────────
//  SubscribeButton
//
//  Drop-in button for the Settings → Subscription accordion. Auto-
//  detects which Stripe flow to launch:
//
//    - subscriptionStatus is 'active' / 'past_due'  → Stripe Customer Portal
//      (manage card, cancel, view invoices)
//
//    - subscriptionStatus is 'trialing' / 'inactive' / 'canceled' →
//      Stripe Checkout Session (start or restart paid subscription)
//
//  Billing-exempt accounts (VIP / founder / comp / internal) render
//  NOTHING — these accounts bypass Stripe entirely and the parent
//  Settings page already hides them, but defending here too keeps the
//  component safe to drop in anywhere without the caller having to
//  pre-check the exemption flag.
//
//  The Stripe price ID is read from VITE_STRIPE_PRO_PRICE_ID at build
//  time. Setting up the env var is the only step required after the
//  Stripe Extension is installed and the Pro product is configured in
//  the Stripe dashboard. See docs/STRIPE-SETUP.md for the full setup.
//
//  If the env var is missing (e.g. during development before Stripe
//  is wired), the button shows "Billing coming soon" and is disabled
//  rather than crashing on click.
// ─────────────────────────────────────────────────────────────────────

interface Props {
  settings: Settings;
}

// Read the Pro price ID from Vite env. The value is inlined at build
// time by Vite — if the env var isn't set in CI when `npm run build`
// runs, we fall through to an empty string and the button renders
// disabled. Cast through `unknown` so TS doesn't complain in setups
// without `vite/client` types loaded.
const PRO_PRICE_ID: string = (() => {
  try {
    const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
    return env?.VITE_STRIPE_PRO_PRICE_ID || '';
  } catch {
    return '';
  }
})();

export function SubscribeButton({ settings }: Props) {
  const [busy, setBusy] = useState(false);

  // Defensive exemption check: billing-exempt accounts never see any
  // Stripe UI — including this button. Returning null here means the
  // button can be dropped into any layout without the caller having to
  // gate on `isBillingExempt()` separately.
  if (isBillingExempt(settings)) {
    return null;
  }

  // Resolve which CTA to show based on subscription state. Active/past
  // accounts get portal access; everyone else gets checkout.
  const status = settings.subscriptionStatus;
  const isPaid = status === 'active' || status === 'past_due';

  // Pre-flight: if the price ID isn't configured, show a friendly
  // disabled state rather than a broken click. Same applies if the
  // user isn't authed yet (race condition during initial load).
  if (!PRO_PRICE_ID) {
    return (
      <button
        className="btn secondary"
        disabled
        style={{ width: '100%', opacity: 0.6 }}
        title="Stripe price ID not configured — see docs/STRIPE-SETUP.md"
      >
        Billing coming soon
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
        // Portal: redirects user to Stripe-hosted billing page.
        const url = await createPortalLink();
        window.location.assign(url);
      } else {
        // Checkout: creates a session, listens for the URL, then
        // redirects. startCheckout resolves only AFTER assigning
        // window.location, so resetting `busy` below is mostly
        // a safety net in case the redirect is blocked.
        await startCheckout(uid, PRO_PRICE_ID);
      }
    } catch (e) {
      addToast((e as Error).message || 'Could not start checkout', 'error');
      setBusy(false);
    }
    // Intentionally do not setBusy(false) on success — the redirect
    // is in flight and resetting state would briefly flash the
    // button back to active before navigation completes.
  };

  return (
    <button
      className="btn primary"
      onClick={handleClick}
      disabled={busy}
      style={{ width: '100%' }}
    >
      {busy
        ? 'Opening Stripe…'
        : isPaid
          ? 'Manage billing'
          : `Subscribe to Pro · ${PRO_PRICE_LINE}`}
    </button>
  );
}

export default SubscribeButton;
