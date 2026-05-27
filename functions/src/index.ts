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
// Phase 1 of the Stripe per-business rework (spec:
// docs/superpowers/specs/2026-05-27-stripe-per-business-design.md).
// Server-side mirror of subscription state into the specific business
// scoped by sub.metadata.businessId. Runs additively alongside the
// existing client-side attachStripeSync; Phase 3 deletes the client
// mirror once the server path is verified.
export { onOwnerSubscriptionChange } from './onOwnerSubscriptionChange';

// Scheduled daily Firestore backup → GCS. Requires one-time operator
// setup of the GCS bucket and IAM bindings — see the file header for
// the gsutil + gcloud commands.
export { scheduledFirestoreBackup } from './scheduledFirestoreBackup';
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

// Standalone Stripe webhook — kept as source for future migration
// flexibility but NOT exported here. Production uses the Firebase
// Stripe Extension's webhook (ext-firestore-stripe-payments-
// handleWebhookEvents) which writes to /customers/{uid}/subscriptions
// and triggers onSubscriptionWrite for referral rewards. The function
// previously deployed here was orphan — no Stripe webhook pointed at
// it, no STRIPE_WEBHOOK_SECRET was configured, so every accidental
// invocation returned 500.
//
// If you ever uninstall the Stripe extension, restore this export and
// point Stripe at the deployed URL. See stripeWebhook.ts header for
// the migration guide.
//
// export { stripeWebhook } from './stripeWebhook';
