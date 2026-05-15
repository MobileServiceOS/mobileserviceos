import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions/v1';
import Stripe from 'stripe';
import { applyReferralReward } from './applyReferralReward';
import type { ReferralDoc } from './types';

// ─────────────────────────────────────────────────────────────────────
//  Admin callable functions for the referral system
//
//  These are HTTPS callables (require auth context). Only the Wheel
//  Rush founder email is allowed to invoke them. Used by an admin
//  panel (future enhancement) or directly via Firebase Functions
//  shell for manual intervention.
//
//  Functions:
//
//    adminApplyReferralReward(referralId)
//      Manually apply a referral reward. Idempotent — if already
//      rewarded, returns success without re-applying. If the
//      referral is in `fraudulent` state, requires `force: true`.
//
//    adminRevokeReferralReward(referralId, reason)
//      Marks a referral as fraudulent and undoes any previously-
//      applied credit by creating a POSITIVE balance transaction
//      on the referrer's Stripe customer.
// ─────────────────────────────────────────────────────────────────────

const FOUNDER_EMAILS = new Set([
  'contact@wheelrush.net',
]);

function assertAdmin(context: functions.https.CallableContext): string {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Sign-in required.');
  }
  const email = (context.auth.token.email || '').toLowerCase();
  if (!FOUNDER_EMAILS.has(email)) {
    throw new functions.https.HttpsError('permission-denied', 'Admin-only function.');
  }
  return email;
}

let _stripe: Stripe | null = null;
function getStripeClient(): Stripe {
  if (_stripe) return _stripe;
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) {
    throw new functions.https.HttpsError('failed-precondition', 'STRIPE_SECRET_KEY not configured');
  }
  _stripe = new Stripe(secret, { apiVersion: '2023-10-16' });
  return _stripe;
}

export const adminApplyReferralReward = functions
  .runWith({
    secrets: ['STRIPE_SECRET_KEY'],
    timeoutSeconds: 60,
  })
  .https.onCall(async (data, context) => {
    const adminEmail = assertAdmin(context);
    const { referralId, force } = data as { referralId?: string; force?: boolean };
    if (!referralId) {
      throw new functions.https.HttpsError('invalid-argument', 'referralId is required.');
    }

    const db = admin.firestore();
    const refRef = db.collection('referrals').doc(referralId);
    const refSnap = await refRef.get();
    if (!refSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'Referral not found.');
    }
    const referral = { id: refSnap.id, ...(refSnap.data() as Omit<ReferralDoc, 'id'>) };

    // Already rewarded — return success without re-applying.
    if (referral.status === 'rewarded') {
      return { ok: true, alreadyRewarded: true, referral };
    }

    // Fraudulent state requires explicit force flag.
    if (referral.status === 'fraudulent' && !force) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        `Referral is flagged fraudulent (${(referral.fraudFlags || []).join(', ')}). Pass force=true to override.`,
      );
    }

    const stripe = getStripeClient();
    const { balanceTransactionId, creditAmountUsd } = await applyReferralReward({
      stripe,
      db,
      referrerBusinessId: referral.referrerBusinessId,
      referralId: referral.id,
    });

    await refRef.update({
      status: 'rewarded',
      rewardedAt: new Date().toISOString(),
      stripeBalanceTransactionId: balanceTransactionId,
      creditAmountUsd,
      notes: `${referral.notes || ''}\n[${new Date().toISOString()}] Manual reward by ${adminEmail}`.trim(),
    });

    // Increment referrer tallies (Admin SDK bypasses rules lock).
    await db.collection('businesses')
      .doc(referral.referrerBusinessId)
      .collection('settings')
      .doc('main')
      .set({
        referralCreditsMonths: admin.firestore.FieldValue.increment(1),
        totalSuccessfulReferrals: admin.firestore.FieldValue.increment(1),
      }, { merge: true });

    return { ok: true, balanceTransactionId, creditAmountUsd };
  });

export const adminRevokeReferralReward = functions
  .runWith({
    secrets: ['STRIPE_SECRET_KEY'],
    timeoutSeconds: 60,
  })
  .https.onCall(async (data, context) => {
    const adminEmail = assertAdmin(context);
    const { referralId, reason } = data as { referralId?: string; reason?: string };
    if (!referralId) {
      throw new functions.https.HttpsError('invalid-argument', 'referralId is required.');
    }

    const db = admin.firestore();
    const refRef = db.collection('referrals').doc(referralId);
    const refSnap = await refRef.get();
    if (!refSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'Referral not found.');
    }
    const referral = { id: refSnap.id, ...(refSnap.data() as Omit<ReferralDoc, 'id'>) };

    // If reward was applied, REVERSE the Stripe balance transaction
    // by creating a positive offset.
    if (referral.status === 'rewarded' && referral.stripeBalanceTransactionId) {
      const stripe = getStripeClient();
      // Find the referrer's Stripe customer id.
      const referrerCustDoc = await db
        .collection('customers')
        .doc(referral.referrerBusinessId)
        .get();
      const stripeCustomerId = (referrerCustDoc.data() as { stripeId?: string })?.stripeId;
      const amountCents = Math.round((referral.creditAmountUsd || 39) * 100);

      if (stripeCustomerId) {
        await stripe.customers.createBalanceTransaction(
          stripeCustomerId,
          {
            amount: amountCents, // positive = debit (cancels prior credit)
            currency: 'usd',
            description: `Referral reward revoked (referral ${referralId}, reason: ${reason || 'fraud'})`,
            metadata: {
              msos_referral_id: referralId,
              msos_reward_type: 'revoke',
              msos_revoke_reason: reason || 'unspecified',
            },
          },
          {
            idempotencyKey: `referral_revoke:${referralId}`,
          },
        );

        // Decrement the referrer's tally.
        await db.collection('businesses')
          .doc(referral.referrerBusinessId)
          .collection('settings')
          .doc('main')
          .set({
            referralCreditsMonths: admin.firestore.FieldValue.increment(-1),
            // totalSuccessfulReferrals is NOT decremented — it's a
            // historical count, not a current-credit gauge.
          }, { merge: true });
      }
    }

    await refRef.update({
      status: 'fraudulent',
      fraudFlags: [...(referral.fraudFlags || []), 'admin_revoked'],
      notes: `${referral.notes || ''}\n[${new Date().toISOString()}] Revoked by ${adminEmail}. Reason: ${reason || 'unspecified'}`.trim(),
    });

    return { ok: true, revoked: true };
  });
