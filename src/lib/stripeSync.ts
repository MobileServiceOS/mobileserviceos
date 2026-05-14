import {
  collection,
  doc,
  getDoc,
  getFirestore,
  onSnapshot,
  query,
  setDoc,
  where,
  type Unsubscribe,
} from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import type { SubscriptionStatus, Plan } from '@/types';

// ─────────────────────────────────────────────────────────────────────
//  Stripe → Firestore subscription mirror
//
//  This module bridges the Stripe Firebase Extension's subscription
//  documents into Mobile Service OS's existing Settings.subscriptionStatus
//  field. The extension writes per-user subscription docs at:
//
//    customers/{uid}/subscriptions/{subscriptionId}
//
//  Each doc has fields like `status`, `current_period_end`, `cancel_at`,
//  and a `price.product.metadata` map we use to identify the Mobile
//  Service OS plan. The mirror function listens to this collection,
//  picks the most authoritative subscription, and writes the result
//  to:
//
//    businesses/{businessId}/settings/main
//      .subscriptionStatus, .plan, .trialEndsAt
//
//  Why mirror rather than read directly:
//    - Existing app code already reads from Settings; mirroring keeps
//      the gating logic (planAccess.ts, invoice.ts, Settings UI) free
//      of any Stripe-specific knowledge.
//    - Settings can be edited offline-first; the mirror updates when
//      online without disturbing local state.
//    - Multiple subscription edge cases (trialing → past_due → active)
//      collapse into the canonical SubscriptionStatus union we already
//      have.
//
//  Lifecycle: call attachStripeSync(uid, businessId) once after sign-in.
//  The function returns an unsubscribe handle — call it on sign-out
//  or unmount.
// ─────────────────────────────────────────────────────────────────────

/**
 * Shape of the subscription document written by the Stripe Firebase
 * Extension. Only the fields we read are declared here; the extension
 * writes many more, all of which we leave alone.
 *
 * See: https://github.com/invertase/firestore-stripe-payments
 */
interface StripeSubscriptionDoc {
  /** Stripe subscription status. We map this onto our internal
   *  SubscriptionStatus union via the table in mapStripeStatus(). */
  status?: string;
  /** Timestamp (Firestore Timestamp) for when the current period —
   *  including any trial — ends. We use this as trialEndsAt while
   *  status is 'trialing'. */
  current_period_end?: { toMillis(): number } | null;
  /** Trial-specific end timestamp. When present, takes precedence over
   *  current_period_end for the trialEndsAt mirror. */
  trial_end?: { toMillis(): number } | null;
  /** Cancellation timestamp. When set, the subscription will not renew
   *  but remains valid until current_period_end. */
  cancel_at?: { toMillis(): number } | null;
  /** Nested price → product → metadata. Mobile Service OS expects a
   *  metadata key `msos_plan` on the Stripe product, set to either
   *  'pro' or 'core'. */
  price?: {
    product?: {
      metadata?: Record<string, string>;
    };
  };
}

/**
 * Map a raw Stripe status string onto our SubscriptionStatus union.
 * Anything unrecognized falls back to 'inactive' (safe-by-default —
 * the UI will treat the user as Core).
 *
 * Stripe statuses: incomplete, incomplete_expired, trialing, active,
 * past_due, canceled, unpaid, paused.
 */
function mapStripeStatus(raw: string | undefined): SubscriptionStatus {
  switch (raw) {
    case 'trialing': return 'trialing';
    case 'active':   return 'active';
    case 'past_due': return 'past_due';
    case 'unpaid':   return 'past_due';
    case 'canceled': return 'canceled';
    // Treat incomplete/incomplete_expired/paused as inactive — the
    // user has not yet successfully started paying. They'll see the
    // Core experience until Stripe confirms an active subscription.
    case 'incomplete':
    case 'incomplete_expired':
    case 'paused':
    default:
      return 'inactive';
  }
}

/**
 * Extract the Mobile Service OS plan from a Stripe subscription doc.
 * Stripe products are configured with a metadata field `msos_plan`
 * (set during the Stripe dashboard setup; see docs/STRIPE-SETUP.md).
 * Defaults to 'pro' when missing — every product we sell is Pro
 * for now, so a missing metadata field reasonably falls through.
 */
function extractPlan(d: StripeSubscriptionDoc): Plan {
  const raw = d.price?.product?.metadata?.msos_plan;
  if (raw === 'core' || raw === 'pro') return raw;
  return 'pro';
}

/**
 * Pick the most authoritative subscription from a list of docs. The
 * extension writes one doc per Stripe subscription; a customer may
 * theoretically have multiple (legacy + current). The priority order:
 *
 *   1. active       — currently paying
 *   2. trialing     — in trial
 *   3. past_due     — needs payment update
 *   4. unpaid
 *   5. canceled
 *   6. incomplete / incomplete_expired / paused / unknown
 *
 * Within the same priority bucket, the one with the most recent
 * current_period_end wins (most-recent subscription).
 */
function pickPrimary(docs: StripeSubscriptionDoc[]): StripeSubscriptionDoc | null {
  if (!docs.length) return null;
  const rank: Record<string, number> = {
    active:                 1,
    trialing:               2,
    past_due:               3,
    unpaid:                 4,
    canceled:               5,
    incomplete:             6,
    incomplete_expired:     6,
    paused:                 6,
  };
  return [...docs].sort((a, b) => {
    const ra = rank[a.status || ''] ?? 9;
    const rb = rank[b.status || ''] ?? 9;
    if (ra !== rb) return ra - rb;
    const ea = a.current_period_end?.toMillis() ?? 0;
    const eb = b.current_period_end?.toMillis() ?? 0;
    return eb - ea;
  })[0] ?? null;
}

/**
 * Attach a real-time listener to the user's Stripe subscription docs.
 * On every change, compute the canonical (plan, status, trialEndsAt)
 * triple and write it to the business's Settings doc.
 *
 * Returns an Unsubscribe function. Call it when the user signs out or
 * the component unmounts to stop the listener and prevent leaks.
 *
 * Idempotent: if the computed triple matches what's already on disk,
 * the write is a no-op via Firestore's merge semantics.
 *
 * Safe to call before the Stripe Extension is installed — the
 * customers/{uid}/subscriptions collection simply stays empty and no
 * writes ever fire.
 */
export function attachStripeSync(uid: string, businessId: string): Unsubscribe {
  const db = getFirestore();
  // The extension creates subscription docs only for "valid" Stripe
  // statuses; canceled/past_due are still written so the listener
  // captures the downgrade. We listen to ALL docs and let pickPrimary
  // disambiguate.
  const subsRef = collection(db, 'customers', uid, 'subscriptions');
  const q = query(subsRef, where('status', 'in', [
    'trialing',
    'active',
    'past_due',
    'unpaid',
    'canceled',
    'incomplete',
    'incomplete_expired',
    'paused',
  ]));

  return onSnapshot(q, async (snap) => {
    const docs: StripeSubscriptionDoc[] = [];
    snap.forEach((d) => { docs.push(d.data() as StripeSubscriptionDoc); });

    const primary = pickPrimary(docs);

    // No subscription doc → user has never started checkout. Don't
    // touch Settings — they're still on whatever the app assigned
    // during onboarding (typically pro + trialing).
    if (!primary) return;

    const status = mapStripeStatus(primary.status);
    const plan = extractPlan(primary);
    // Prefer trial_end over current_period_end while trialing, since
    // current_period_end is sometimes set far in the future for annual
    // plans even during their trial window.
    const trialEndMs =
      primary.trial_end?.toMillis() ??
      primary.current_period_end?.toMillis() ??
      null;
    const trialEndsAt = trialEndMs ? new Date(trialEndMs).toISOString() : undefined;

    try {
      // ─── Billing exemption guardrail ──────────────────────────────
      // Before touching the Settings doc, read it and check the
      // exemption flag. If `billingExempt === true`, this account is
      // immune to Stripe-driven downgrades; we skip the mirror
      // entirely so a failed payment, cancellation, or any other
      // Stripe event can never silently demote a VIP/founder account.
      //
      // The read is cheap (single-document fetch) and runs once per
      // snapshot event — not per request. Stripe webhook traffic for
      // a single user is bursty but low-volume in absolute terms, so
      // the extra read is well within Firestore's free tier.
      const settingsRef = doc(db, 'businesses', businessId, 'settings', 'main');
      const settingsSnap = await getDoc(settingsRef);
      const currentSettings = settingsSnap.data();
      if (currentSettings?.billingExempt === true) {
        // eslint-disable-next-line no-console
        console.info(
          '[stripeSync] mirror skipped — account is billing-exempt',
          {
            businessId,
            stripeStatus: status,
            override: currentSettings.subscriptionOverride || 'lifetime',
          },
        );
        return;
      }

      await setDoc(
        settingsRef,
        {
          plan,
          subscriptionStatus: status,
          ...(trialEndsAt ? { trialEndsAt } : {}),
        },
        { merge: true },
      );
    } catch (err) {
      // Swallow — a failed mirror is non-fatal (next snapshot will
      // retry). Logging keeps it visible during debug without
      // surfacing a user-facing toast for a background sync.
      // eslint-disable-next-line no-console
      console.warn('[stripeSync] mirror write failed:', err);
    }
  }, (err) => {
    // eslint-disable-next-line no-console
    console.warn('[stripeSync] listener error:', err);
  });
}

/**
 * Helper for the Settings UI to launch a Stripe-hosted checkout
 * session. Writes a checkout-session-request doc that the extension
 * picks up; the extension fills in `url`; we redirect.
 *
 * @param uid       Authed user's Firebase uid
 * @param priceId   Stripe price ID (set up in the Stripe dashboard,
 *                  matches the `$89.99/month` recurring price we configured)
 * @param returnUrl Where to send the user after checkout completes or
 *                  is cancelled. Defaults to the current page.
 */
export async function startCheckout(uid: string, priceId: string, returnUrl?: string): Promise<void> {
  const db = getFirestore();
  const sessionsRef = collection(db, 'customers', uid, 'checkout_sessions');
  const sessionDoc = doc(sessionsRef);
  const here = returnUrl || window.location.href;
  await setDoc(sessionDoc, {
    price: priceId,
    success_url: here,
    cancel_url: here,
    allow_promotion_codes: true,
    // Stripe Checkout will auto-collect taxes if Stripe Tax is
    // enabled on the account; otherwise this is silently ignored.
    automatic_tax: { enabled: false },
  });
  // The extension fills in `url` on this doc once Stripe responds.
  // Listen for it and redirect.
  return new Promise<void>((resolve, reject) => {
    const unsub = onSnapshot(sessionDoc, (snap) => {
      const data = snap.data() as { url?: string; error?: { message: string } } | undefined;
      if (!data) return;
      if (data.error) {
        unsub();
        reject(new Error(data.error.message || 'Checkout failed'));
        return;
      }
      if (data.url) {
        unsub();
        window.location.assign(data.url);
        resolve();
      }
    }, (err) => {
      unsub();
      reject(err);
    });
    // Safety timeout — if Stripe never responds, surface an error
    // instead of hanging the user on a spinner forever.
    setTimeout(() => {
      unsub();
      reject(new Error('Checkout took too long — please try again'));
    }, 30_000);
  });
}

/**
 * Launch the Stripe customer portal so the user can update card,
 * cancel, or view invoices. Calls a callable Cloud Function that the
 * Stripe Extension exposes as `ext-firestore-stripe-payments-createPortalLink`.
 *
 * Returns the portal URL to redirect to. Caller is responsible for
 * window.location.assign() — kept that way so tests can intercept.
 */
export async function createPortalLink(returnUrl?: string): Promise<string> {
  const functions = getFunctions(undefined, 'us-central1');
  const call = httpsCallable<
    { returnUrl: string; locale: string },
    { url: string }
  >(functions, 'ext-firestore-stripe-payments-createPortalLink');
  const res = await call({
    returnUrl: returnUrl || window.location.href,
    locale: 'auto',
  });
  if (!res.data?.url) throw new Error('No portal URL returned');
  return res.data.url;
}
