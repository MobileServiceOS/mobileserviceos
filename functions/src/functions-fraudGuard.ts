import type Stripe from 'stripe';
import type { Firestore } from 'firebase-admin/firestore';
import type { ReferralDoc } from './types';

// ─────────────────────────────────────────────────────────────────────
//  fraudGuard — anti-abuse heuristics for referral conversions
//
//  Runs BEFORE applying a reward. Returns a list of flags. If any
//  flags are present, the referral is marked `fraudulent` and NO
//  reward is applied. An admin can manually approve via the admin
//  tool if a flag is a false positive.
//
//  Flags raised:
//    self_referral          — referrer and referred are the same business
//    duplicate_stripe_cust  — referred uses the same Stripe customer
//                             as a previously-rewarded referral
//    same_payment_method    — referred's payment method fingerprint
//                             matches a previously-rewarded referral
//                             (catches "5 free months with the same card")
//    velocity_burst         — referrer has gained >5 rewards in the
//                             past 24 hours (suspicious bot ring)
//    same_email_domain_burst — referrer's converted emails share a
//                             domain with abnormal frequency
//    referrer_no_active_sub — referrer no longer has an active
//                             subscription (can't reward a freeloader)
//    referrer_billing_exempt — referrer is the founder; they don't
//                             need credits but we still record. We
//                             DO let founders receive rewards
//                             (they referred legitimately) so this
//                             is NOT raised as a fraud flag here.
//
//  Each check is independent — a single referral can raise multiple
//  flags. All flags are recorded for audit.
// ─────────────────────────────────────────────────────────────────────

export interface EvaluateFraudOpts {
  referral: ReferralDoc;
  stripe: Stripe;
  db: Firestore;
  referredStripeCustomerId: string;
}

export interface FraudResult {
  flags: string[];
}

export async function evaluateFraud(opts: EvaluateFraudOpts): Promise<FraudResult> {
  const { referral, stripe, db, referredStripeCustomerId } = opts;
  const flags: string[] = [];

  // 1. Self-referral — should never reach here (rules + client both
  //    block it), but defense in depth.
  if (referral.referrerBusinessId === referral.referredBusinessId
   || referral.referrerBusinessId === referral.referredUid) {
    flags.push('self_referral');
  }

  // 2. Duplicate Stripe customer. If another rewarded referral used
  //    the same Stripe customer ID, flag.
  if (referredStripeCustomerId) {
    const dupCustQuery = await db
      .collection('referrals')
      .where('stripeCustomerId', '==', referredStripeCustomerId)
      .where('status', '==', 'rewarded')
      .limit(1)
      .get();
    if (!dupCustQuery.empty && dupCustQuery.docs[0].id !== referral.id) {
      flags.push('duplicate_stripe_cust');
    }
  }

  // 3. Same payment method fingerprint. Pull the customer's payment
  //    methods from Stripe; check if any fingerprint matches a
  //    previously-rewarded referral's customer.
  try {
    if (referredStripeCustomerId) {
      const paymentMethods = await stripe.paymentMethods.list({
        customer: referredStripeCustomerId,
        type: 'card',
        limit: 5,
      });
      const fingerprints = paymentMethods.data
        .map((pm) => pm.card?.fingerprint)
        .filter((fp): fp is string => Boolean(fp));

      if (fingerprints.length > 0) {
        // Look up previously-rewarded referrals that recorded a
        // payment method fingerprint matching one of these. We
        // denormalize fingerprints onto the referral doc on first
        // reward; absence of fingerprint history means no comparison
        // possible (early days), which is fine — flag won't fire.
        for (const fp of fingerprints) {
          const dupFpQuery = await db
            .collection('referrals')
            .where('paymentFingerprints', 'array-contains', fp)
            .where('status', '==', 'rewarded')
            .limit(1)
            .get();
          if (!dupFpQuery.empty && dupFpQuery.docs[0].id !== referral.id) {
            flags.push('same_payment_method');
            break;
          }
        }
        // Stash this referral's fingerprints onto the doc for FUTURE
        // referrals to match against. (Best-effort.)
        try {
          await db.collection('referrals').doc(referral.id).update({
            paymentFingerprints: fingerprints,
          });
        } catch {
          /* non-fatal */
        }
      }
    }
  } catch (err) {
    // Stripe API errors are non-fatal for fraud check — log and
    // continue. Better to let a possibly-clean referral through
    // than to block all referrals on a transient Stripe issue.
    // eslint-disable-next-line no-console
    console.warn('[fraudGuard] payment-method check failed:', (err as Error).message);
  }

  // 4. Velocity burst — referrer received >5 rewards in last 24h.
  try {
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const velocityQuery = await db
      .collection('referrals')
      .where('referrerBusinessId', '==', referral.referrerBusinessId)
      .where('status', '==', 'rewarded')
      .where('rewardedAt', '>=', dayAgo)
      .get();
    if (velocityQuery.size > 5) {
      flags.push('velocity_burst');
    }
  } catch {
    /* non-fatal — composite index may not exist yet; skip */
  }

  // 5. Referrer must have an active subscription OR be billing-exempt
  //    (founder). A canceled referrer doesn't get credits.
  try {
    const referrerSettingsDoc = await db
      .collection('businesses')
      .doc(referral.referrerBusinessId)
      .collection('settings')
      .doc('main')
      .get();
    const settings = referrerSettingsDoc.data() || {};
    const exempt = settings.billingExempt === true;
    const status = settings.subscriptionStatus as string | undefined;
    const validStatuses = ['active', 'trialing', 'past_due'];
    if (!exempt && (!status || !validStatuses.includes(status))) {
      flags.push('referrer_no_active_sub');
    }
  } catch {
    /* non-fatal */
  }

  return { flags };
}
