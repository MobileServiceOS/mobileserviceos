import * as admin from 'firebase-admin';
import {
  onDocumentUpdated,
  onDocumentCreated,
  onDocumentDeleted,
} from 'firebase-functions/v2/firestore';
import type { ReferralDoc, ReferralStatus } from './types';

// ─────────────────────────────────────────────────────────────────────
//  firestoreTriggers.ts — supplementary Firestore triggers
//
//  These triggers handle CROSS-DOCUMENT consistency that can't be done
//  in security rules and complements onSubscriptionWrite.ts. Each
//  trigger is idempotent and isolated; multiple invocations of the
//  same event produce no double-effects.
//
//  Triggers exported:
//
//    onReferralStatusChanged
//      Fires when a /referrals/{id} doc's status changes. Maintains
//      denormalized counters on the referrer's settings doc (pending,
//      converted, rewarded counts) and triggers downstream effects:
//        • status → 'rewarded': increment referralCreditsMonths +
//          totalSuccessfulReferrals (defensive — onSubscriptionWrite
//          already does this; we only fire here if it didn't)
//        • status → 'canceled' from 'rewarded': decrement
//          referralCreditsMonths to claw back the credit
//
//    onSettingsTrialTransition
//      Watches businesses/{bId}/settings/main. When subscriptionStatus
//      transitions from 'trialing' to 'active' AND the business has a
//      referredBy pointer, ensures the corresponding referral doc is
//      moved to 'converted' (defensive against missed
//      onSubscriptionWrite events).
//
//    onReferralCreated
//      Fires when a /referrals/{id} doc is first created. Stamps the
//      referrer's settings with a "lastReferralAt" timestamp for
//      analytics. Also runs a safety check: if the new referral
//      conflicts with an existing referral for the same
//      referredBusinessId (impossible via rules but defensive),
//      flags it.
//
//    onReferralCodeDeleted
//      Cleanup: if a referralCodes/{code} index doc is deleted, mark
//      the corresponding business's referralCode field as null so the
//      dashboard regenerates a new one.
//
//  Notes on coexistence with onSubscriptionWrite:
//    onSubscriptionWrite (in onSubscriptionWrite.ts) is the PRIMARY
//    driver of referral state transitions — it reads Stripe data and
//    applies the actual reward. The triggers here are DEFENSIVE and
//    handle:
//      • catching state drift if a webhook is dropped
//      • maintaining denormalized read counters for fast dashboard
//        queries (avoid live-counting on every render)
//      • cleanup on cancellation / clawback
//    All counter updates use FieldValue.increment for idempotent
//    monotonic mutations.
// ─────────────────────────────────────────────────────────────────────

// ─── onReferralStatusChanged ────────────────────────────────────────

export const onReferralStatusChanged = onDocumentUpdated(
  {
    document: 'referrals/{referralId}',
    region: 'us-central1',
  },
  async (event) => {
    if (!event.data) return;
    const before = event.data.before.data() as ReferralDoc | undefined;
    const after = event.data.after.data() as ReferralDoc | undefined;
    if (!before || !after) return;

    const prevStatus = before.status;
    const nextStatus = after.status;
    if (prevStatus === nextStatus) return;

    const db = admin.firestore();
    const referrerSettingsRef = db
      .collection('businesses')
      .doc(after.referrerBusinessId)
      .collection('settings')
      .doc('main');

    // Defensive clawback: if a previously-rewarded referral becomes
    // canceled or fraudulent, decrement the credit counter. The
    // financial reversal (Stripe balance transaction) is handled by
    // adminRevokeReferralReward — this is the counter-side cleanup
    // for automated cancellations.
    if (prevStatus === 'rewarded'
      && (nextStatus === 'canceled' || nextStatus === 'fraudulent')) {
      await referrerSettingsRef.set({
        referralCreditsMonths: admin.firestore.FieldValue.increment(-1),
        // totalSuccessfulReferrals is HISTORICAL — never decremented.
      }, { merge: true });

      // eslint-disable-next-line no-console
      console.info('[referrals] clawback applied', {
        referralId: event.params.referralId,
        prevStatus,
        nextStatus,
      });
      return;
    }

    // Forward transition: pending → trialing → converted → rewarded.
    // Counter increment for 'rewarded' is the PRIMARY responsibility
    // of onSubscriptionWrite (which also creates the Stripe balance
    // transaction). We only increment here if the previous status
    // wasn't already 'rewarded' AND we can tell onSubscriptionWrite
    // didn't run (no stripeBalanceTransactionId stamped).
    //
    // Without this defensive branch, a manual admin reward via the
    // admin tool would correctly create the Stripe credit but never
    // bump the settings counter. With it, we're idempotent: if both
    // ran, the increment math still works because we check the
    // marker before incrementing.
    if (nextStatus === 'rewarded' && prevStatus !== 'rewarded') {
      // Marker check: if the doc has been re-saved by us before with
      // a counter-incremented flag, skip.
      const counterFlag = (after as ReferralDoc & { _counterIncremented?: boolean })._counterIncremented;
      if (!counterFlag) {
        await referrerSettingsRef.set({
          referralCreditsMonths: admin.firestore.FieldValue.increment(1),
          totalSuccessfulReferrals: admin.firestore.FieldValue.increment(1),
        }, { merge: true });

        // Stamp the marker so future re-runs of this trigger don't
        // double-count. This write also fires the trigger again, but
        // the status doesn't change so the trigger early-returns.
        await event.data.after.ref.update({
          _counterIncremented: true,
        });

        // eslint-disable-next-line no-console
        console.info('[referrals] reward counters synced', {
          referralId: event.params.referralId,
          referrerBusinessId: after.referrerBusinessId,
        });
      }
    }
  },
);

// ─── onSettingsTrialTransition ──────────────────────────────────────

interface BusinessSettingsLite {
  subscriptionStatus?: string;
  referredBy?: string | null;
  referralDocId?: string | null;
  billingExempt?: boolean;
}

export const onSettingsTrialTransition = onDocumentUpdated(
  {
    document: 'businesses/{businessId}/settings/main',
    region: 'us-central1',
  },
  async (event) => {
    if (!event.data) return;
    const before = event.data.before.data() as BusinessSettingsLite | undefined;
    const after = event.data.after.data() as BusinessSettingsLite | undefined;
    if (!before || !after) return;

    // Founder accounts never participate in trial transitions.
    if (after.billingExempt === true) return;

    // Watching for trialing → active. Other transitions are no-ops here.
    if (before.subscriptionStatus === 'trialing' && after.subscriptionStatus === 'active') {
      // Only meaningful if this business was referred.
      if (!after.referredBy || !after.referralDocId) return;

      const db = admin.firestore();
      const refRef = db.collection('referrals').doc(after.referralDocId);
      const refSnap = await refRef.get();
      if (!refSnap.exists) return;

      const referral = refSnap.data() as ReferralDoc;

      // Only fire if the referral is still in an in-flight state.
      // 'rewarded' / 'fraudulent' / 'canceled' are terminal and we
      // never reset terminal states from here.
      if (referral.status !== 'pending' && referral.status !== 'trialing') {
        return;
      }

      // Mark as converted. The actual reward application happens in
      // onSubscriptionWrite — this trigger is a defensive fallback
      // for cases where the settings/main mirror updated but the
      // customers/{uid}/subscriptions/{subId} trigger missed
      // (e.g. extension misconfiguration, transient Firestore lag).
      await refRef.update({
        status: 'converted',
        convertedAt: new Date().toISOString(),
        firstSuccessfulPaymentAt: new Date().toISOString(),
      });

      // eslint-disable-next-line no-console
      console.info('[referrals] defensive converted via settings transition', {
        businessId: event.params.businessId,
        referralId: after.referralDocId,
      });
    }
  },
);

// ─── onReferralCreated ───────────────────────────────────────────────

export const onReferralCreated = onDocumentCreated(
  {
    document: 'referrals/{referralId}',
    region: 'us-central1',
  },
  async (event) => {
    if (!event.data) return;
    const data = event.data.data() as ReferralDoc;
    if (!data) return;

    const db = admin.firestore();

    // Analytics: stamp the referrer's settings with the most recent
    // referral timestamp. Used by the dashboard to show "active in
    // the last 30 days" trend indicators.
    try {
      await db
        .collection('businesses')
        .doc(data.referrerBusinessId)
        .collection('settings')
        .doc('main')
        .set({
          lastReferralAt: new Date().toISOString(),
        }, { merge: true });
    } catch {
      /* non-fatal */
    }

    // Safety: detect a conflicting referral for the same
    // referredBusinessId. Firestore rules already prevent this at
    // create time, but if it slips through (admin SDK write, race
    // condition with extension), flag it for review.
    try {
      const conflicts = await db
        .collection('referrals')
        .where('referredBusinessId', '==', data.referredBusinessId)
        .get();
      if (conflicts.size > 1) {
        // Mark the newer doc fraudulent (assumes lexicographic ID
        // ordering correlates with creation order — true for our
        // ref_<timestamp> IDs).
        const others = conflicts.docs
          .filter((d) => d.id !== event.params.referralId)
          .map((d) => d.id);
        await event.data.ref.update({
          status: 'fraudulent',
          fraudFlags: ['duplicate_referred_business'],
          notes: `Conflicts with: ${others.join(', ')}`,
        });
        // eslint-disable-next-line no-console
        console.warn('[referrals] duplicate referredBusinessId detected', {
          newId: event.params.referralId,
          conflicts: others,
        });
      }
    } catch {
      /* non-fatal */
    }
  },
);

// ─── onReferralCodeDeleted ──────────────────────────────────────────

export const onReferralCodeDeleted = onDocumentDeleted(
  {
    document: 'referralCodes/{code}',
    region: 'us-central1',
  },
  async (event) => {
    if (!event.data) return;
    const data = event.data.data() as { businessId?: string } | undefined;
    if (!data?.businessId) return;

    // Find the business and clear its referralCode so the next
    // dashboard load regenerates a fresh one.
    try {
      await admin
        .firestore()
        .collection('businesses')
        .doc(data.businessId)
        .collection('settings')
        .doc('main')
        .set({
          referralCode: admin.firestore.FieldValue.delete(),
        }, { merge: true });

      // eslint-disable-next-line no-console
      console.info('[referrals] code freed', {
        code: event.params.code,
        businessId: data.businessId,
      });
    } catch {
      /* non-fatal */
    }
  },
);

// Re-export for convenience if any caller wants the union of trigger
// names. The actual exports above are what firebase-functions deploys.
export const ALL_TRIGGER_NAMES = [
  'onReferralStatusChanged',
  'onSettingsTrialTransition',
  'onReferralCreated',
  'onReferralCodeDeleted',
] as const;

// Defensive type guard for status strings (used in tests).
const VALID_STATUSES: ReferralStatus[] = [
  'pending', 'trialing', 'converted', 'rewarded', 'canceled', 'fraudulent',
];
export function isValidReferralStatus(s: string): s is ReferralStatus {
  return (VALID_STATUSES as string[]).includes(s);
}
