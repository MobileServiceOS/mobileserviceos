import type Stripe from 'stripe';
import type { Firestore } from 'firebase-admin/firestore';

// ─────────────────────────────────────────────────────────────────────
//  applyReferralReward
//
//  Applies a free-month credit to the referrer's Stripe customer
//  balance. The credit amount equals the referrer's CURRENT monthly
//  plan price (so a Pro referrer gets $89.99 off, a Core referrer
//  gets $39 off).
//
//  Implementation: Stripe Customer Balance Transaction.
//  https://stripe.com/docs/billing/customer/balance
//
//  Negative balance credits reduce the next invoice. They stack —
//  10 referrals = 10 months covered. No expiration unless explicitly
//  set on the balance transaction (we don't set one).
//
//  Idempotency: passes an `idempotency_key` derived from the referral
//  ID, so retries from a partially-failed function execution don't
//  double-credit.
// ─────────────────────────────────────────────────────────────────────

export interface ApplyReferralRewardOpts {
  stripe: Stripe;
  db: Firestore;
  referrerBusinessId: string;
  referralId: string;
}

export interface ApplyReferralRewardResult {
  balanceTransactionId: string;
  creditAmountUsd: number;
}

export async function applyReferralReward(opts: ApplyReferralRewardOpts): Promise<ApplyReferralRewardResult> {
  const { stripe, db, referrerBusinessId, referralId } = opts;

  // Look up the referrer's Stripe customer ID. Stored on the referrer's
  // /customers/{uid} doc (uid == businessId for owner accounts) by the
  // Stripe Extension when they subscribed.
  const referrerCustomerDoc = await db
    .collection('customers')
    .doc(referrerBusinessId)
    .get();

  if (!referrerCustomerDoc.exists) {
    throw new Error(`Referrer ${referrerBusinessId} has no Stripe customer doc`);
  }
  const stripeCustomerId = (referrerCustomerDoc.data() as { stripeId?: string })?.stripeId;
  if (!stripeCustomerId) {
    throw new Error(`Referrer ${referrerBusinessId} has no stripeId on customer doc`);
  }

  // Determine credit amount = referrer's current monthly price.
  // Read the referrer's most recent active subscription via the
  // Stripe Extension's mirror.
  const referrerSubsSnap = await db
    .collection('customers')
    .doc(referrerBusinessId)
    .collection('subscriptions')
    .where('status', 'in', ['active', 'trialing', 'past_due'])
    .limit(1)
    .get();

  let creditAmountUsd = 39; // default to Core price as a safe floor
  let creditAmountCents = 3900;

  if (!referrerSubsSnap.empty) {
    const sub = referrerSubsSnap.docs[0].data();
    // The extension stores price info under `items[0].price.unit_amount`
    // (in cents). Fall back to the default if structure is unexpected.
    const items = sub.items || sub.prices || [];
    const firstItem = Array.isArray(items) ? items[0] : null;
    const unitAmount = firstItem?.price?.unit_amount ?? firstItem?.unit_amount;
    if (typeof unitAmount === 'number' && unitAmount > 0) {
      creditAmountCents = unitAmount;
      creditAmountUsd = unitAmount / 100;
    }
  }

  // Apply the credit. NEGATIVE amount = credit (reduces invoice).
  const balanceTransaction = await stripe.customers.createBalanceTransaction(
    stripeCustomerId,
    {
      amount: -creditAmountCents,
      currency: 'usd',
      description: `Referral reward — free month (referral ${referralId})`,
      metadata: {
        msos_referral_id: referralId,
        msos_reward_type: 'free_month',
      },
    },
    {
      // Idempotency: if this function retries with the same key,
      // Stripe returns the original transaction instead of creating
      // a duplicate. KEY MUST BE UNIQUE PER LOGICAL OPERATION.
      idempotencyKey: `referral_reward:${referralId}`,
    },
  );

  return {
    balanceTransactionId: balanceTransaction.id,
    creditAmountUsd,
  };
}
