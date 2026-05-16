import * as admin from 'firebase-admin';
import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import Stripe from 'stripe';
import type { Request, Response } from 'express';
import { applyReferralReward } from './applyReferralReward';
import { evaluateFraud } from './fraudGuard';
import type { ReferralDoc } from './types';

// ─────────────────────────────────────────────────────────────────────
//  stripeWebhook.ts — standalone Stripe webhook handler
//
//  This is a FALLBACK / ALTERNATIVE to the Firebase Stripe Extension's
//  built-in webhook. It implements the same downstream effects but
//  with full control over verification, idempotency, and referral
//  reward triggering.
//
//  ⚠️  CRITICAL — DO NOT REGISTER BOTH ENDPOINTS IN STRIPE  ⚠️
//
//  Your Stripe Dashboard webhook configuration must point at EXACTLY
//  ONE endpoint:
//
//    • The extension's `ext-firestore-stripe-payments-handleWebhookEvents`
//      OR
//    • This function (`stripeWebhook`)
//
//  Registering both will cause double-processing: referrals get
//  rewarded twice, customer balance gets credited twice, and the
//  Firestore mirror writes race against each other. Pick one.
//
//  This file's purpose is to give you migration flexibility. If you
//  ever uninstall the extension, point Stripe at this URL instead:
//    https://us-central1-mobile-service-os.cloudfunctions.net/stripeWebhook
//
//  Idempotency:
//    Every Stripe event has a unique event.id. We record processed
//    event IDs in /stripeWebhookEvents/{eventId}. A second delivery
//    of the same event is detected and skipped.
//
//  Signature verification:
//    Uses Stripe.webhooks.constructEvent with the STRIPE_WEBHOOK_SECRET
//    environment secret. Reject any unverifiable payload with 400.
//
//  Events handled:
//    • checkout.session.completed       — subscription created
//    • customer.subscription.updated    — status transitions
//    • customer.subscription.deleted    — cancellation
//    • invoice.paid                     — first paid invoice = reward trigger
//    • invoice.payment_failed           — past_due state
//
//  Downstream side effects:
//    1. Update businesses/{businessId}/settings/main with the
//       canonical subscription state (status, plan, trialEndsAt).
//       SKIPPED for billingExempt accounts.
//    2. On invoice.paid for the FIRST paid invoice of a referred
//       account, trigger the referral reward flow (with fraud check).
// ─────────────────────────────────────────────────────────────────────

const STRIPE_SECRET_KEY = defineSecret('STRIPE_SECRET_KEY');
const STRIPE_WEBHOOK_SECRET = defineSecret('STRIPE_WEBHOOK_SECRET');

let _stripe: Stripe | null = null;
function getStripe(): Stripe {
  if (_stripe) return _stripe;
  const secret = STRIPE_SECRET_KEY.value();
  if (!secret) throw new Error('STRIPE_SECRET_KEY not configured');
  _stripe = new Stripe(secret, { apiVersion: '2023-10-16' });
  return _stripe;
}

export const stripeWebhook = onRequest(
  {
    region: 'us-central1',
    secrets: [STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET],
    timeoutSeconds: 60,
    memory: '256MiB',
    // Important: raw body is required for signature verification.
    // onRequest preserves the raw body on req.rawBody for us.
    cors: false,
    invoker: 'public',
  },
  async (req: Request, res: Response) => {
    // ─── 1. Verify HTTP method ─────────────────────────────────
    if (req.method !== 'POST') {
      res.status(405).send('Method not allowed');
      return;
    }

    // ─── 2. Verify signature ───────────────────────────────────
    const sig = req.headers['stripe-signature'];
    if (!sig || typeof sig !== 'string') {
      res.status(400).send('Missing Stripe-Signature header');
      return;
    }

    const webhookSecret = STRIPE_WEBHOOK_SECRET.value();
    if (!webhookSecret) {
      // eslint-disable-next-line no-console
      console.error('[stripeWebhook] STRIPE_WEBHOOK_SECRET not configured');
      res.status(500).send('Server misconfiguration');
      return;
    }

    const stripe = getStripe();
    let event: Stripe.Event;
    try {
      // req.rawBody is a Buffer provided by Firebase Functions for
      // onRequest handlers. constructEvent requires the raw bytes,
      // NOT the parsed JSON, to compute the HMAC over.
      const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
      if (!rawBody) {
        // eslint-disable-next-line no-console
        console.error('[stripeWebhook] req.rawBody missing');
        res.status(400).send('Missing raw body');
        return;
      }
      event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[stripeWebhook] signature verification failed:', (err as Error).message);
      res.status(400).send(`Webhook Error: ${(err as Error).message}`);
      return;
    }

    // ─── 3. Idempotency check ──────────────────────────────────
    const db = admin.firestore();
    const eventDocRef = db.collection('stripeWebhookEvents').doc(event.id);
    try {
      // Transactional create: if the doc already exists, we've
      // already processed this event. setDoc with create-if-missing
      // semantics via runTransaction.
      const already = await db.runTransaction(async (tx) => {
        const snap = await tx.get(eventDocRef);
        if (snap.exists) return true;
        tx.set(eventDocRef, {
          type: event.type,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          processed: false,
        });
        return false;
      });
      if (already) {
        // eslint-disable-next-line no-console
        console.info('[stripeWebhook] duplicate event skipped', { eventId: event.id, type: event.type });
        res.status(200).send('Already processed');
        return;
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[stripeWebhook] idempotency check failed:', (err as Error).message);
      // Continue anyway — better to risk a duplicate than to ack-and-
      // drop the event. Stripe will retry on a 5xx response, but we
      // want to attempt processing before giving up.
    }

    // ─── 4. Dispatch ───────────────────────────────────────────
    try {
      switch (event.type) {
        case 'checkout.session.completed':
          await handleCheckoutCompleted(stripe, db, event.data.object as Stripe.Checkout.Session);
          break;
        case 'customer.subscription.updated':
        case 'customer.subscription.created':
          await handleSubscriptionUpdated(stripe, db, event.data.object as Stripe.Subscription);
          break;
        case 'customer.subscription.deleted':
          await handleSubscriptionDeleted(db, event.data.object as Stripe.Subscription);
          break;
        case 'invoice.paid':
        case 'invoice.payment_succeeded':
          await handleInvoicePaid(stripe, db, event.data.object as Stripe.Invoice);
          break;
        case 'invoice.payment_failed':
          await handleInvoicePaymentFailed(db, event.data.object as Stripe.Invoice);
          break;
        default:
          // Unhandled events are not errors — Stripe sends many
          // event types we don't care about. ACK and move on.
          // eslint-disable-next-line no-console
          console.info('[stripeWebhook] unhandled event type', { type: event.type });
      }

      // Mark processed for audit.
      await eventDocRef.set({
        processed: true,
        processedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });

      res.status(200).send('OK');
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[stripeWebhook] handler failed:', {
        eventId: event.id,
        type: event.type,
        error: (err as Error).message,
      });
      // 5xx → Stripe retries with exponential backoff.
      res.status(500).send('Handler error');
    }
  },
);

// ─────────────────────────────────────────────────────────────────────
//  Handler: checkout.session.completed
// ─────────────────────────────────────────────────────────────────────

async function handleCheckoutCompleted(
  stripe: Stripe,
  db: admin.firestore.Firestore,
  session: Stripe.Checkout.Session,
): Promise<void> {
  // Skip non-subscription sessions (one-off payments).
  if (session.mode !== 'subscription') return;

  const customerId = typeof session.customer === 'string'
    ? session.customer
    : session.customer?.id;
  if (!customerId) return;

  // Resolve the customer to a Firebase uid via the Stripe customer's
  // metadata.firebaseUID (extension stores this; we mirror the
  // convention).
  const customer = await stripe.customers.retrieve(customerId);
  if (customer.deleted) return;
  const uid = (customer.metadata?.firebaseUID || '') as string;
  if (!uid) return;

  const subscriptionId = typeof session.subscription === 'string'
    ? session.subscription
    : session.subscription?.id;

  // Don't write subscription state here — we'll get the full picture
  // in customer.subscription.updated which fires immediately after.
  // This handler exists mainly to record the linkage.
  // eslint-disable-next-line no-console
  console.info('[stripeWebhook] checkout completed', { uid, customerId, subscriptionId });
}

// ─────────────────────────────────────────────────────────────────────
//  Handler: customer.subscription.updated / created
// ─────────────────────────────────────────────────────────────────────

async function handleSubscriptionUpdated(
  stripe: Stripe,
  db: admin.firestore.Firestore,
  subscription: Stripe.Subscription,
): Promise<void> {
  const customerId = typeof subscription.customer === 'string'
    ? subscription.customer
    : subscription.customer.id;

  // Resolve uid from Stripe customer metadata.
  const customer = await stripe.customers.retrieve(customerId);
  if (customer.deleted) return;
  const uid = (customer.metadata?.firebaseUID || '') as string;
  if (!uid) {
    // eslint-disable-next-line no-console
    console.warn('[stripeWebhook] subscription event with no firebaseUID metadata', {
      subscriptionId: subscription.id,
      customerId,
    });
    return;
  }

  // businessId == uid for owner accounts.
  const businessId = uid;
  const settingsRef = db.collection('businesses').doc(businessId).collection('settings').doc('main');

  // Read the current settings to check billingExempt. NEVER mirror
  // Stripe state onto an exempt account — that would downgrade the
  // founder.
  const settingsSnap = await settingsRef.get();
  const currentSettings = settingsSnap.data() || {};
  if (currentSettings.billingExempt === true) {
    // eslint-disable-next-line no-console
    console.info('[stripeWebhook] skipping mirror for exempt account', { uid });
    return;
  }

  // Map Stripe status to app status. Stripe's vocabulary matches ours
  // for the most part: active, trialing, past_due, canceled, unpaid,
  // incomplete, incomplete_expired.
  const mappedStatus = mapStripeStatus(subscription.status);

  // Resolve plan from price metadata (msos_plan = 'core' | 'pro').
  let plan: 'core' | 'pro' | undefined;
  const items = subscription.items.data;
  if (items && items.length > 0) {
    const product = items[0].price.product;
    if (typeof product === 'string') {
      // Need to fetch the product to read metadata.
      try {
        const prod = await stripe.products.retrieve(product);
        const planMeta = (prod.metadata?.msos_plan || '').toLowerCase();
        if (planMeta === 'core' || planMeta === 'pro') plan = planMeta;
      } catch {
        /* non-fatal — leave plan unset */
      }
    } else if (product && !product.deleted) {
      const planMeta = (product.metadata?.msos_plan || '').toLowerCase();
      if (planMeta === 'core' || planMeta === 'pro') plan = planMeta;
    }
  }

  const trialEnd = subscription.trial_end
    ? new Date(subscription.trial_end * 1000).toISOString()
    : null;
  const trialStart = subscription.trial_start
    ? new Date(subscription.trial_start * 1000).toISOString()
    : null;

  const updatePayload: Record<string, unknown> = {
    subscriptionStatus: mappedStatus,
  };
  if (plan) updatePayload.plan = plan;
  if (trialEnd) updatePayload.trialEndsAt = trialEnd;
  if (trialStart) updatePayload.trialStartedAt = trialStart;

  await settingsRef.set(updatePayload, { merge: true });

  // ─── Referral lifecycle hooks ────────────────────────────────
  // Advance referral status based on the new subscription state.
  await advanceReferralForUid(db, uid, mappedStatus, subscription.id, customerId);
}

// ─────────────────────────────────────────────────────────────────────
//  Handler: customer.subscription.deleted
// ─────────────────────────────────────────────────────────────────────

async function handleSubscriptionDeleted(
  db: admin.firestore.Firestore,
  subscription: Stripe.Subscription,
): Promise<void> {
  // Find the business that owned this subscription via the
  // customers/{uid}/subscriptions/{subId} mirror (written by the
  // extension; even when bypassed by this webhook, we still want
  // to honor the existing mirror schema).
  const customerId = typeof subscription.customer === 'string'
    ? subscription.customer
    : subscription.customer.id;

  // Locate via stripeCustomerId on settings — slower but reliable.
  const settingsQuery = await db
    .collectionGroup('settings')
    .where('stripeCustomerId', '==', customerId)
    .limit(1)
    .get();
  if (settingsQuery.empty) return;
  const settingsDoc = settingsQuery.docs[0];
  const settings = settingsDoc.data();
  if (settings.billingExempt === true) return;

  await settingsDoc.ref.set({
    subscriptionStatus: 'canceled',
  }, { merge: true });

  // Mark in-flight referral as canceled (won't pay out).
  const businessId = settingsDoc.ref.parent.parent?.id;
  if (businessId) {
    const refQuery = await db
      .collection('referrals')
      .where('referredBusinessId', '==', businessId)
      .where('status', 'in', ['pending', 'trialing'])
      .limit(1)
      .get();
    if (!refQuery.empty) {
      await refQuery.docs[0].ref.update({
        status: 'canceled',
        canceledAt: new Date().toISOString(),
      });
    }
  }
}

// ─────────────────────────────────────────────────────────────────────
//  Handler: invoice.paid — THE referral reward trigger
// ─────────────────────────────────────────────────────────────────────

async function handleInvoicePaid(
  stripe: Stripe,
  db: admin.firestore.Firestore,
  invoice: Stripe.Invoice,
): Promise<void> {
  // Only act on subscription invoices that ACTUALLY moved money.
  // Skip $0 invoices (these fire during trial start with amount_paid=0).
  if (!invoice.subscription) return;
  if ((invoice.amount_paid || 0) === 0) {
    // eslint-disable-next-line no-console
    console.info('[stripeWebhook] skipping $0 invoice (trial start, not paid conversion)', {
      invoiceId: invoice.id,
    });
    return;
  }

  // Also skip invoices that don't represent a subscription cycle
  // payment (proration adjustments, manual invoices, etc).
  if (invoice.billing_reason !== 'subscription_cycle'
    && invoice.billing_reason !== 'subscription_create') {
    // eslint-disable-next-line no-console
    console.info('[stripeWebhook] skipping non-cycle invoice', {
      invoiceId: invoice.id,
      billing_reason: invoice.billing_reason,
    });
    return;
  }

  const customerId = typeof invoice.customer === 'string'
    ? invoice.customer
    : invoice.customer?.id;
  if (!customerId) return;

  // Resolve uid.
  const customer = await stripe.customers.retrieve(customerId);
  if (customer.deleted) return;
  const uid = (customer.metadata?.firebaseUID || '') as string;
  if (!uid) return;

  // Find referral doc.
  const refQuery = await db
    .collection('referrals')
    .where('referredUid', '==', uid)
    .limit(1)
    .get();
  if (refQuery.empty) return;
  const refSnap = refQuery.docs[0];
  const referral = { id: refSnap.id, ...(refSnap.data() as Omit<ReferralDoc, 'id'>) };

  // Already rewarded? Idempotent return.
  if (referral.status === 'rewarded') return;
  // Terminal failures don't reward.
  if (referral.status === 'fraudulent' || referral.status === 'canceled') return;

  // ─── Fraud check ──────────────────────────────────────────────
  const fraudResult = await evaluateFraud({
    referral,
    stripe,
    db,
    referredStripeCustomerId: customerId,
  });
  if (fraudResult.flags.length > 0) {
    await refSnap.ref.update({
      status: 'fraudulent',
      fraudFlags: fraudResult.flags,
      stripeCustomerId: customerId,
      stripeSubscriptionId: typeof invoice.subscription === 'string'
        ? invoice.subscription
        : invoice.subscription?.id,
    });
    // eslint-disable-next-line no-console
    console.warn('[stripeWebhook] referral flagged fraudulent', {
      referralId: referral.id,
      flags: fraudResult.flags,
    });
    return;
  }

  // ─── Mark converted, apply reward ─────────────────────────────
  await refSnap.ref.update({
    status: 'converted',
    convertedAt: new Date().toISOString(),
    firstSuccessfulPaymentAt: new Date().toISOString(),
    stripeCustomerId: customerId,
    stripeSubscriptionId: typeof invoice.subscription === 'string'
      ? invoice.subscription
      : invoice.subscription?.id,
  });

  try {
    const { balanceTransactionId, creditAmountUsd } = await applyReferralReward({
      stripe,
      db,
      referrerBusinessId: referral.referrerBusinessId,
      referralId: referral.id,
    });
    await refSnap.ref.update({
      status: 'rewarded',
      rewardedAt: new Date().toISOString(),
      stripeBalanceTransactionId: balanceTransactionId,
      creditAmountUsd,
    });
    // Counter increment happens in firestoreTriggers.onReferralStatusChanged,
    // which is idempotent via the _counterIncremented marker.

    // eslint-disable-next-line no-console
    console.info('[stripeWebhook] referral rewarded', {
      referralId: referral.id,
      creditAmountUsd,
      balanceTransactionId,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[stripeWebhook] reward application failed', {
      referralId: referral.id,
      error: (err as Error).message,
    });
    // Leave in `converted` for manual admin retry.
  }
}

// ─────────────────────────────────────────────────────────────────────
//  Handler: invoice.payment_failed
// ─────────────────────────────────────────────────────────────────────

async function handleInvoicePaymentFailed(
  db: admin.firestore.Firestore,
  invoice: Stripe.Invoice,
): Promise<void> {
  const customerId = typeof invoice.customer === 'string'
    ? invoice.customer
    : invoice.customer?.id;
  if (!customerId) return;

  // Update the business settings to past_due. The Stripe subscription
  // status itself will also fire customer.subscription.updated which
  // sets this — this handler is a fallback if the subscription event
  // is delayed.
  const settingsQuery = await db
    .collectionGroup('settings')
    .where('stripeCustomerId', '==', customerId)
    .limit(1)
    .get();
  if (settingsQuery.empty) return;
  const settingsDoc = settingsQuery.docs[0];
  if (settingsDoc.data().billingExempt === true) return;

  await settingsDoc.ref.set({
    subscriptionStatus: 'past_due',
    lastInvoiceFailedAt: new Date().toISOString(),
  }, { merge: true });
}

// ─────────────────────────────────────────────────────────────────────
//  Shared utility: advance referral state on subscription changes
// ─────────────────────────────────────────────────────────────────────

async function advanceReferralForUid(
  db: admin.firestore.Firestore,
  uid: string,
  status: string,
  stripeSubscriptionId: string,
  stripeCustomerId: string,
): Promise<void> {
  const refQuery = await db
    .collection('referrals')
    .where('referredUid', '==', uid)
    .limit(1)
    .get();
  if (refQuery.empty) return;
  const refSnap = refQuery.docs[0];
  const referral = refSnap.data() as ReferralDoc;

  if (status === 'trialing' && referral.status === 'pending') {
    await refSnap.ref.update({
      status: 'trialing',
      trialingAt: new Date().toISOString(),
      stripeCustomerId,
      stripeSubscriptionId,
    });
  } else if (status === 'canceled'
    && (referral.status === 'pending' || referral.status === 'trialing')) {
    await refSnap.ref.update({
      status: 'canceled',
      canceledAt: new Date().toISOString(),
    });
  }
  // Note: 'active' → reward is handled by handleInvoicePaid, NOT here.
  // We need the actual paid invoice as proof of payment, not just
  // a status flip (status can flip to active before charge succeeds
  // in some edge cases).
}

// ─────────────────────────────────────────────────────────────────────
//  Map Stripe subscription status string → app status union
// ─────────────────────────────────────────────────────────────────────

type AppSubscriptionStatus = 'active' | 'trialing' | 'past_due' | 'canceled' | 'unpaid' | 'incomplete' | 'incomplete_expired' | 'paused' | 'inactive';

function mapStripeStatus(stripeStatus: Stripe.Subscription.Status): AppSubscriptionStatus {
  switch (stripeStatus) {
    case 'active': return 'active';
    case 'trialing': return 'trialing';
    case 'past_due': return 'past_due';
    case 'canceled': return 'canceled';
    case 'unpaid': return 'unpaid';
    case 'incomplete': return 'incomplete';
    case 'incomplete_expired': return 'incomplete_expired';
    case 'paused': return 'paused';
    default: return 'inactive';
  }
}
