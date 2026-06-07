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

// Weekly hard-delete of business subtrees whose owners filed a
// deletion-request. Enforces the 30-day deletion SLA promised by the
// Privacy Policy (src/pages/PrivacyTerms.tsx). Audit compliance P1
// fix (2026-05-31). No operator setup required.
export { scheduledDeletionPurge } from './scheduledDeletionPurge';
export {
  adminApplyReferralReward,
  adminRevokeReferralReward,
} from './adminReferralTools';

// SP3 task 13: Owner-only HTTPS callable that walks every job in a
// business and creates/updates Customer + Vehicle docs. Used by the
// Settings → Customer Directory → Backfill admin button.
export { backfillCustomers } from './backfillCustomers';

// SP3 task 14: Recompute Customer rollups when Jobs are written.
// Debounced 30s in-process; skips when metadata.backfillRun is present.
// CRITICAL PRIVACY: lifetimeRevenue is computed in-memory and never
// persisted on the Customer doc — only averageTicket / vipTier /
// customerStatus / jobCount / lastJobAt / lastJobId are written.
export { onJobWriteCustomerRollup } from './onJobWriteCustomerRollup';

// SP4A: review automation. Four functions:
//   - onJobCompletedReviewRequest  Firestore trigger on job writes;
//                                  guards + transactional enqueue.
//   - drainReviewRequests          Scheduled every 1 minute; flips
//                                  pending → sent via twilioClient.
//   - sendTestReviewSms            HTTPS callable; isTest:true.
//   - sendManualReviewRequest      HTTPS callable; isManual:true.
//
// All four ship dormant when Twilio env secrets are missing: the
// trigger still fires + queue still writes + drainer still polls,
// but no SMS goes out until SP4B configures TWILIO_ACCOUNT_SID /
// TWILIO_AUTH_TOKEN / TWILIO_PHONE_NUMBER.
export { onJobCompletedReviewRequest } from './onJobCompletedReviewRequest';
export { drainReviewRequests }         from './drainReviewRequests';
export { sendTestReviewSms }           from './sendTestReviewSms';
export { sendManualReviewRequest }     from './sendManualReviewRequest';

// SP4B: missed-call recovery. Four functions:
//   - twilioVoiceStatus       Public HTTPS webhook; Twilio Console
//                             points its Voice Status Callback URL here.
//   - drainOutboundSms        Scheduled every 1 minute; sibling of
//                             drainReviewRequests for the outboundSms
//                             queue.
//   - sendTestMissedCall      HTTPS callable; admin "Fire Test
//                             Missed Call" button writes a synthetic
//                             Lead + outboundSms (isTest=true).
//   - sendManualOutboundSms   HTTPS callable; LeadDetailSheet composer
//                             ad-hoc operator SMS sends.
export { twilioVoiceStatus }     from './twilioVoiceStatus';
export { drainOutboundSms }      from './drainOutboundSms';
export { sendTestMissedCall }    from './sendTestMissedCall';
export { sendManualOutboundSms } from './sendManualOutboundSms';

// Bandilero #3 — call-intelligence analytics. Ships DORMANT: records
// every inbound call into calls/{callSid}; onCallWriteRollup maintains
// daily callMetrics. Additive to (does not touch) the twilioVoiceStatus
// missed-call→Lead pipeline. Activates when the operator points a Twilio
// Status Callback at twilioCallStatus + sets the Twilio secrets.
export { twilioCallStatus }      from './twilioCallStatus';
export { onCallWriteRollup }     from './onCallWriteRollup';

// Phase 1 real-time caller-ID screen-pop. Ships DORMANT — only fires
// when the operator points the Twilio Voice URL (Phone Numbers →
// [Number] → Voice & Fax → "A Call Comes In" → Webhook) at this
// endpoint AFTER configuring T-Mobile SimRing to ring Twilio in
// parallel with their cell. See twilioIncomingCall.ts header for the
// full activation path. No client/server work required to activate —
// it's a Twilio Console + T-Mobile portal change.
//
// Spec: docs/superpowers/specs/2026-06-05-incoming-call-screenpop-design.md
export { twilioIncomingCall }    from './twilioIncomingCall';

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
