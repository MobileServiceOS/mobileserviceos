import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  setDoc,
  where,
  type Unsubscribe,
} from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import type { SubscriptionStatus, Plan } from '@/types';
import { _db } from '@/lib/firebase';

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
  const db = _db;
  if (!db) {
    // eslint-disable-next-line no-console
    console.warn('[stripeSync] attachStripeSync skipped — Firestore not initialized');
    return () => {}; // no-op unsubscribe; safe to call
  }
  if (!uid || !businessId) {
    // eslint-disable-next-line no-console
    console.warn('[stripeSync] attachStripeSync skipped — missing uid or businessId', { uid, businessId });
    return () => {};
  }
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
 * The session is configured with `trial_period_days: 14` so Stripe
 * issues a 14-day free trial on the resulting subscription. The user
 * is NOT charged until the trial ends, AND no card is required to
 * start the trial (Stripe's payment_method_collection: 'if_required'
 * keeps the friction minimal). When the trial expires, Stripe either
 * charges the card on file or, if none exists, flips the subscription
 * to `past_due` — which stripeSync.ts mirrors to Firestore.
 *
 * Stripe is the SOURCE OF TRUTH for trial state. The app does NOT
 * calculate trial days locally; it reads `trialEndsAt` from the
 * Settings doc which is written by the stripeSync mirror from
 * authentic Stripe subscription data.
 *
 * @param uid       Authed user's Firebase uid
 * @param priceId   Stripe price ID (Core or Pro, set up in Stripe dashboard
 *                  with `msos_plan` metadata = 'core' or 'pro')
 * @param returnUrl Where to send the user after checkout completes or
 *                  is cancelled. Defaults to the current page.
 */
export async function startCheckout(uid: string, priceId: string, returnUrl?: string): Promise<void> {
  const db = _db; if (!db) throw new Error("Firestore not initialized");
  const sessionsRef = collection(db, 'customers', uid, 'checkout_sessions');
  const sessionDoc = doc(sessionsRef);
  const here = returnUrl || window.location.href;

  // The Stripe Firebase Extension expects success_url / cancel_url to be
  // plain, fully-qualified https URLs. window.location.href can carry a
  // hash fragment (#tab) or a ?ref= referral query param — strip those
  // to a clean origin+pathname so the value handed to Stripe Checkout
  // is a stable, valid redirect target.
  let cleanReturn = here;
  try {
    const u = new URL(here);
    cleanReturn = u.origin + u.pathname;
  } catch {
    cleanReturn = here;
  }

  // The price ID is injected from a GitHub Actions secret at build time.
  // Trim defensively — a trailing newline or stray space in the secret
  // value would otherwise be sent verbatim to Stripe ("no such price").
  const cleanPrice = (priceId || '').trim();

  // ════════════════════════════════════════════════════════════════
  // DIAGNOSTIC: minimal payload.
  // Reduced to the smallest VALID subscription-checkout payload the
  // firestore-stripe-payments extension accepts. `mode` is kept —
  // without it the extension defaults to one-time 'payment' mode, not
  // a subscription. The optional fields (allow_promotion_codes,
  // trial_period_days) are removed during the 400 investigation so a
  // bad optional field can be ruled out.
  //
  // RESTORE after diagnosis — the full payload (with the 14-day trial)
  // is preserved in the comment block below.
  // ════════════════════════════════════════════════════════════════
  const payload = {
    price: cleanPrice,
    success_url: cleanReturn,
    cancel_url: cleanReturn,
    mode: 'subscription',
  };
  // FULL payload (restore after the 400 is diagnosed):
  // const payload = {
  //   mode: 'subscription',
  //   price: cleanPrice,
  //   success_url: cleanReturn,
  //   cancel_url: cleanReturn,
  //   allow_promotion_codes: true,
  //   trial_period_days: 14,
  // };

  // eslint-disable-next-line no-console
  console.info('[stripeSync] startCheckout: creating session', {
    sessionPath: sessionDoc.path,
    uid,
    payload,
  });

  try {
    await setDoc(sessionDoc, payload);
  } catch (err) {
    // Surface the FULL Firestore error. The generic rethrow below
    // hides err.code/err.message — without this, a "400 Bad Request"
    // is undiagnosable. JSON.stringify with a replacer captures the
    // non-enumerable Error fields (code/name/message) that a plain
    // stringify would drop.
    const e = err as { code?: string; message?: string; name?: string; stack?: string };
    const full = JSON.stringify(
      err,
      Object.getOwnPropertyNames(err || {}),
      2,
    );
    // eslint-disable-next-line no-console
    console.error(
      '[stripeSync] startCheckout: WRITE FAILED\n' +
        `  code:    ${e.code}\n` +
        `  name:    ${e.name}\n` +
        `  message: ${e.message}\n` +
        `  path:    ${sessionDoc.path}\n` +
        `  payload: ${JSON.stringify(payload)}\n` +
        `  full:    ${full}`,
    );
    // Include the real Firestore message in the thrown error so it
    // also surfaces in the user-facing toast (truncated) and any
    // upstream logging — no more opaque "try again".
    throw new Error(
      `Checkout could not start (${e.code || 'unknown'}): ${e.message || 'Firestore write failed'}`,
    );
  }

  // eslint-disable-next-line no-console
  console.info('[stripeSync] startCheckout: session doc written OK, awaiting extension');

  // Listen for the extension to fill in `url` (success) or `error`.
  // Returns a clean promise that resolves on redirect, rejects on
  // error/timeout. Listener is GUARANTEED to be cleaned up exactly
  // once via the cleanup function — no retry loops, no leaked
  // subscriptions.
  return new Promise<void>((resolve, reject) => {
    let finished = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let unsub: (() => void) | null = null;

    const cleanup = () => {
      if (finished) return;
      finished = true;
      if (timeoutId) { clearTimeout(timeoutId); timeoutId = null; }
      if (unsub) { try { unsub(); } catch { /* no-op */ } unsub = null; }
    };

    unsub = onSnapshot(
      sessionDoc,
      (snap) => {
        if (finished) return;
        const data = snap.data() as { url?: string; error?: { message?: string } } | undefined;
        if (!data) return;
        if (data.error) {
          // eslint-disable-next-line no-console
          console.error('[stripeSync] startCheckout: extension returned error', data.error);
          cleanup();
          reject(new Error(data.error.message || 'Checkout could not start. Please try again.'));
          return;
        }
        if (data.url) {
          // eslint-disable-next-line no-console
          console.info('[stripeSync] startCheckout: redirecting to Stripe', { url: data.url });
          cleanup();
          window.location.assign(data.url);
          resolve();
        }
      },
      (err) => {
        if (finished) return;
        // eslint-disable-next-line no-console
        console.error('[stripeSync] startCheckout: listener error', err);
        cleanup();
        reject(new Error('Checkout could not start. Please try again.'));
      },
    );

    // 10s safety timeout. If the extension's Cloud Function isn't
    // deployed yet, or webhook config is broken, we'll never get a
    // `url` back. Surface the failure instead of hanging the UI.
    timeoutId = setTimeout(() => {
      if (finished) return;
      // eslint-disable-next-line no-console
      console.warn('[stripeSync] startCheckout: 10s timeout — no response from extension', {
        sessionPath: sessionDoc.path,
        hint: 'Check that the Stripe Firebase Extension is deployed and its Cloud Functions are running.',
      });
      cleanup();
      reject(new Error('Checkout could not start. Please try again.'));
    }, 10_000);
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
