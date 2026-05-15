import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions/v1';
import Stripe from 'stripe';
import { applyReferralReward } from './applyReferralReward';
import { evaluateFraud } from './fraudGuard';
import type { ReferralDoc } from './types';

// ─────────────────────────────────────────────────────────────────────
//  onSubscriptionWrite — Firestore trigger that drives referral rewards
//
//  Path watched:
//    /customers/{uid}/subscriptions/{subId}
//
//  This document is written by the Stripe Firebase Extension whenever
//  a subscription event arrives via webhook. The interesting transitions
//  for the referral system are:
//
//    trialing → active   = first paid invoice succeeded. REWARD.
//    trialing → past_due = card failed at trial end. NO REWARD.
//    trialing → canceled = user canceled before first payment. NO REWARD.
//    active → active     = renewal payment. Already rewarded, no-op.
//
//  The function is idempotent: it reads the referral doc's status before
//  acting and only fires when status is `trialing` or `pending` AND the
//  new subscription state is `active`. Multiple webhook deliveries of
//  the same event are safe.
//
//  Anti-fraud:
//    Before applying any reward, runs evaluateFraud() which checks for
//    duplicate Stripe customers, same-payment-method abuse, velocity,
//    and self-referral via shared metadata. If any flag is raised, the
//    referral is moved to `fraudulent` status WITHOUT applying a
//    reward; the admin tool can manually approve if it's a false
//    positive.
// ─────────────────────────────────────────────────────────────────────

export const onSubscriptionWrite = functions
  .runWith({
    secrets: ['STRIPE_SECRET_KEY'],
    timeoutSeconds: 60,
    memory: '256MB',
  })
  .firestore.document('customers/{uid}/subscriptions/{subId}')
  .onWrite(async (change, context) => {
    const uid = context.params.uid as string;
    const subId = context.params.subId as string;
    const after = change.after.exists ? (change.after.data() || null) : null;
    if (!after) return;

    // Only proceed when the subscription is ACTIVE (post-trial paid)
    // or TRIALING (so we can record the trialing milestone on the
    // referral doc, but no reward yet).
    const status = (after.status as string) || '';
    if (status !== 'active' && status !== 'trialing') {
      // canceled / past_due / incomplete — handle via separate path
      if (status === 'canceled') {
        await markReferralCanceled(uid).catch(() => { /* non-fatal */ });
      }
      return;
    }

    const db = admin.firestore();

    // Find the referral doc for this UID. If none, this customer was
    // not referred — nothing to do.
    const refQuery = await db
      .collection('referrals')
      .where('referredUid', '==', uid)
      .limit(1)
      .get();
    if (refQuery.empty) return;
    const refDocSnap = refQuery.docs[0];
    const referral = { id: refDocSnap.id, ...(refDocSnap.data() as Omit<ReferralDoc, 'id'>) };

    // Lifecycle gate.
    // If status is trialing and referral is still pending, advance to trialing.
    if (status === 'trialing' && referral.status === 'pending') {
      await refDocSnap.ref.update({
        status: 'trialing',
        trialingAt: new Date().toISOString(),
        stripeCustomerId: (after.customer as string) || null,
        stripeSubscriptionId: subId,
      });
      return;
    }

    // Already rewarded — idempotent return.
    if (referral.status === 'rewarded') return;

    // Only an active subscription triggers the reward.
    if (status !== 'active') return;

    // The Stripe extension writes `customer` on the subscription doc
    // as a Stripe customer ID string. We need this to apply the
    // balance credit to the REFERRER (not the referred customer).
    const stripeCustomerOfReferred = (after.customer as string) || '';

    // ─── Fraud evaluation ──────────────────────────────────────
    const stripe = getStripeClient();
    const fraudResult = await evaluateFraud({
      referral,
      stripe,
      db,
      referredStripeCustomerId: stripeCustomerOfReferred,
    });

    if (fraudResult.flags.length > 0) {
      await refDocSnap.ref.update({
        status: 'fraudulent',
        fraudFlags: fraudResult.flags,
        stripeCustomerId: stripeCustomerOfReferred,
        stripeSubscriptionId: subId,
      });
      // eslint-disable-next-line no-console
      console.warn('[referral] flagged as fraudulent', {
        referralId: referral.id,
        flags: fraudResult.flags,
      });
      return;
    }

    // ─── Mark as converted, then apply reward ─────────────────
    await refDocSnap.ref.update({
      status: 'converted',
      convertedAt: new Date().toISOString(),
      firstSuccessfulPaymentAt: new Date().toISOString(),
      stripeCustomerId: stripeCustomerOfReferred,
      stripeSubscriptionId: subId,
    });

    // Apply the Stripe Customer Balance credit on the REFERRER. This
    // is where money actually moves. If it fails, the referral stays
    // in `converted` state and an admin can retry via the manual
    // reward tool.
    try {
      const { balanceTransactionId, creditAmountUsd } = await applyReferralReward({
        stripe,
        db,
        referrerBusinessId: referral.referrerBusinessId,
        referralId: referral.id,
      });

      await refDocSnap.ref.update({
        status: 'rewarded',
        rewardedAt: new Date().toISOString(),
        stripeBalanceTransactionId: balanceTransactionId,
        creditAmountUsd,
      });

      // Increment the referrer's tally fields. Admin SDK bypasses
      // rules, so the locked reward fields update cleanly.
      const referrerSettingsRef = db
        .collection('businesses')
        .doc(referral.referrerBusinessId)
        .collection('settings')
        .doc('main');
      await referrerSettingsRef.set({
        referralCreditsMonths: admin.firestore.FieldValue.increment(1),
        totalSuccessfulReferrals: admin.firestore.FieldValue.increment(1),
      }, { merge: true });

      // eslint-disable-next-line no-console
      console.info('[referral] rewarded', {
        referralId: referral.id,
        referrerBusinessId: referral.referrerBusinessId,
        creditAmountUsd,
        balanceTransactionId,
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[referral] reward application failed', {
        referralId: referral.id,
        error: (err as Error).message,
      });
      // Leave referral in `converted` state for admin manual retry.
    }
  });

/**
 * Find a referral for this uid where status is still in-flight
 * (pending/trialing) and mark it canceled. Called when the referred
 * customer's subscription itself becomes canceled before reaching
 * `active` (i.e. they bailed before the first paid month).
 */
async function markReferralCanceled(uid: string): Promise<void> {
  const db = admin.firestore();
  const refQuery = await db
    .collection('referrals')
    .where('referredUid', '==', uid)
    .where('status', 'in', ['pending', 'trialing'])
    .limit(1)
    .get();
  if (refQuery.empty) return;
  await refQuery.docs[0].ref.update({
    status: 'canceled',
    canceledAt: new Date().toISOString(),
  });
}

let _stripe: Stripe | null = null;
function getStripeClient(): Stripe {
  if (_stripe) return _stripe;
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) {
    throw new Error('STRIPE_SECRET_KEY not configured');
  }
  _stripe = new Stripe(secret, { apiVersion: '2023-10-16' });
  return _stripe;
}
