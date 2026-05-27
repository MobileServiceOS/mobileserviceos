import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions/v1';

// ─────────────────────────────────────────────────────────────────────
//  onOwnerSubscriptionChange — server-side subscription state mirror
//
//  Spec: docs/superpowers/specs/2026-05-27-stripe-per-business-design.md
//
//  Phase 1 of the Stripe per-business rework. Runs ADDITIVELY alongside
//  the existing client-side attachStripeSync (src/lib/stripeSync.ts).
//  Both write to businesses/{bid}/settings/main.subscriptionStatus;
//  when they disagree we have a bug to investigate before Phase 3
//  deletes the client mirror.
//
//  Trigger path:
//    customers/{ownerUid}/subscriptions/{subId}
//
//  Routing key:
//    sub.metadata.businessId — set on the checkout-session doc by
//    SubscribeButton (Phase 2 of the rollout). Subscriptions created
//    BEFORE Phase 2 lack this metadata; we log + skip them.
//    The legacy client mirror still handles those during the
//    parallel-run window.
//
//  Outputs:
//    businesses/{bid}/settings/main: {
//      subscriptionStatus, plan, trialEndsAt,
//      stripeCustomerId, stripeSubscriptionId
//    }
//
//  Respects:
//    settings.billingExempt — never overwrites an exempt account.
//
//  Coexistence:
//    onSubscriptionWrite (referral rewards) triggers on the same path.
//    Two triggers on the same path is fine; Firestore fans out cleanly.
// ─────────────────────────────────────────────────────────────────────

type AppSubscriptionStatus =
  | 'active'
  | 'trialing'
  | 'past_due'
  | 'canceled'
  | 'inactive';

type AppPlan = 'core' | 'pro';

/**
 * Map Stripe status string → MSOS internal status. Mirrors the
 * client-side mapStripeStatus in src/lib/stripeSync.ts. Kept in
 * functions/ because functions can't import from src/.
 */
function mapStripeStatus(raw: string | undefined): AppSubscriptionStatus {
  switch (raw) {
    case 'trialing': return 'trialing';
    case 'active':   return 'active';
    case 'past_due': return 'past_due';
    case 'unpaid':   return 'past_due';
    case 'canceled': return 'canceled';
    // incomplete / incomplete_expired / paused / unknown → inactive.
    default:
      return 'inactive';
  }
}

/**
 * Extract the MSOS plan from the subscription's first price's product
 * metadata.msos_plan. Defaults to 'pro' when missing — every Stripe
 * product we sell today is Pro-priced; legacy products without the
 * metadata field fall through cleanly.
 */
function extractPlan(sub: admin.firestore.DocumentData): AppPlan {
  const items = sub.items || [];
  const first = Array.isArray(items) && items.length > 0 ? items[0] : null;
  const raw = first?.price?.product?.metadata?.msos_plan;
  if (raw === 'core' || raw === 'pro') return raw;
  return 'pro';
}

export const onOwnerSubscriptionChange = functions
  .runWith({ timeoutSeconds: 30, memory: '256MB' })
  .firestore.document('customers/{ownerUid}/subscriptions/{subId}')
  .onWrite(async (change, context) => {
    const sub = change.after.exists ? change.after.data() : null;
    if (!sub) return;

    const subId = context.params.subId as string;
    const ownerUid = context.params.ownerUid as string;

    const bid = (sub.metadata && sub.metadata.businessId) as string | undefined;
    if (!bid) {
      // Subscription has no businessId metadata. Two cases:
      //  1. Legacy sub from before the Phase 2 checkout-metadata commit
      //     ships. The client mirror still handles these.
      //  2. Subscription created through a code path that bypassed
      //     SubscribeButton (e.g. Stripe dashboard manual creation).
      //     We can't route it without the metadata.
      // Log + skip; the existing client mirror is the safety net.
      // eslint-disable-next-line no-console
      console.warn('[onOwnerSubscriptionChange] subscription missing businessId metadata; skipping', {
        subId, ownerUid, status: sub.status,
      });
      return;
    }

    const customerId = typeof sub.customer === 'string'
      ? sub.customer
      : (sub.customer && sub.customer.id) || null;

    const db = admin.firestore();
    const settingsRef = db
      .collection('businesses').doc(bid)
      .collection('settings').doc('main');

    // Read settings to honor billingExempt. Never overwrite an exempt
    // account with Stripe state — that would downgrade a founder.
    const settingsSnap = await settingsRef.get();
    if (settingsSnap.exists && settingsSnap.data()?.billingExempt === true) {
      // eslint-disable-next-line no-console
      console.info('[onOwnerSubscriptionChange] skipping exempt business', {
        bid, subId, ownerUid,
      });
      return;
    }

    const status = mapStripeStatus(sub.status as string | undefined);
    const plan = extractPlan(sub);
    const trialEnd = typeof sub.trial_end === 'number'
      ? new Date(sub.trial_end * 1000).toISOString()
      : null;

    const payload: Record<string, unknown> = {
      subscriptionStatus: status,
    };
    if (customerId) payload.stripeCustomerId = customerId;
    payload.stripeSubscriptionId = subId;
    if (plan) payload.plan = plan;
    if (trialEnd) payload.trialEndsAt = trialEnd;

    await settingsRef.set(payload, { merge: true });

    // eslint-disable-next-line no-console
    console.info('[onOwnerSubscriptionChange] mirrored subscription', {
      bid, subId, status, plan,
    });
  });
