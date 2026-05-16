/**
 * Mobile Service OS — Cloud Functions
 *
 * This is the entry barrel. Individual functions live in sibling files.
 * Each export becomes a deployable Cloud Function.
 *
 * Currently deployed functions:
 *
 *   onSubscriptionWrite (Firestore trigger)
 *     Watches /customers/{uid}/subscriptions/{id} for status changes.
 *     When a subscription transitions to its FIRST `status: active`
 *     (post-trial paid conversion), looks up the corresponding referral
 *     doc and applies a free-month credit to the referrer via Stripe
 *     Customer Balance.
 *
 *   adminApplyReferralReward (callable)
 *     Admin-only manual override. Idempotently applies the reward for
 *     a given referral ID. Useful when automated processing fails or a
 *     fraud check needs human review.
 *
 *   adminRevokeReferralReward (callable)
 *     Admin-only. Marks a referral as fraudulent and (if a credit was
 *     already applied) creates a positive balance transaction to undo
 *     the previous credit.
 */

import * as admin from 'firebase-admin';

// Initialize the Admin SDK exactly once. Functions runtime provides
// service account credentials automatically.
if (admin.apps.length === 0) {
  admin.initializeApp();
}

export { onSubscriptionWrite } from './onSubscriptionWrite';
export {
  adminApplyReferralReward,
  adminRevokeReferralReward,
} from './adminReferralTools';

// Supplementary Firestore triggers — defensive consistency layer.
// Safe to deploy alongside onSubscriptionWrite; idempotent via the
// _counterIncremented marker on referral docs.
export {
  onReferralStatusChanged,
  onSettingsTrialTransition,
  onReferralCreated,
  onReferralCodeDeleted,
} from './firestoreTriggers';

// Standalone Stripe webhook — DO NOT register in Stripe Dashboard
// if you're still using the Firebase Stripe Extension's webhook
// endpoint. See file header for migration guidance.
export { stripeWebhook } from './stripeWebhook';
