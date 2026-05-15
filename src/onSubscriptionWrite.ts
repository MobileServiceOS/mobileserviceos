import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import type {
  StripeSubscription,
  ProductMetadata,
  PlanTier,
  FirebaseRole,
  StripeSubscriptionStatus,
} from "./types";
import { ACTIVE_STATUSES } from "./types";

const db = admin.firestore();

/**
 * Triggered when the Stripe extension writes/updates a subscription document
 * at customers/{uid}/subscriptions/{subscriptionId}.
 *
 * Syncs the subscription state → user doc + business settings/main.
 */
export const onSubscriptionWrite = functions.firestore
  .document("customers/{uid}/subscriptions/{subscriptionId}")
  .onWrite(async (change, context) => {
    const { uid, subscriptionId } = context.params;

    // Deletion — subscription removed entirely
    if (!change.after.exists) {
      functions.logger.info(
        `Subscription ${subscriptionId} deleted for user ${uid}`
      );
      return;
    }

    const sub = change.after.data() as StripeSubscription;
    const status = sub.status;
    const isActive = ACTIVE_STATUSES.includes(status);

    functions.logger.info(
      `Subscription ${subscriptionId} for user ${uid}: status=${status}, active=${isActive}`
    );

    // ── 1. Resolve plan tier from product metadata ──────────────────
    let plan: PlanTier = "free";
    let firebaseRole: FirebaseRole = "free";

    try {
      // The extension stores product as a DocumentReference
      const productRef = sub.product;
      if (productRef) {
        const productSnap = await productRef.get();
        if (productSnap.exists) {
          const meta = (productSnap.data()?.metadata ?? {}) as ProductMetadata;
          plan = meta.plan ?? "free";
          firebaseRole = meta.firebaseRole ?? "free";
          functions.logger.info(
            `Product metadata: plan=${plan}, firebaseRole=${firebaseRole}`
          );
        }
      }
    } catch (err) {
      functions.logger.error("Failed to resolve product metadata", err);
    }

    // ── 2. Read user doc to find businessId + check exemption ───────
    const userSnap = await db.doc(`users/${uid}`).get();
    if (!userSnap.exists) {
      functions.logger.warn(`User doc users/${uid} not found, skipping sync`);
      return;
    }

    const userData = userSnap.data()!;
    const businessId: string | undefined = userData.businessId;

    // Never downgrade a billing-exempt (founder) account
    if (userData.billingExempt === true) {
      functions.logger.info(
        `User ${uid} is billingExempt — skipping subscription sync`
      );
      return;
    }

    // ── 3. Compute the effective plan ───────────────────────────────
    // If the subscription is active/trialing → use the product's plan
    // Otherwise → "free"
    const effectivePlan: PlanTier = isActive ? plan : "free";
    const effectiveRole: FirebaseRole = isActive ? firebaseRole : "free";

    // ── 4. Build the user-doc update ────────────────────────────────
    const userUpdate: Record<string, unknown> = {
      "subscription.status": status as StripeSubscriptionStatus,
      "subscription.plan": effectivePlan,
      "subscription.role": effectiveRole,
      "subscription.stripeSubscriptionId": subscriptionId,
      "subscription.currentPeriodEnd": sub.current_period_end,
      "subscription.cancelAtPeriodEnd": sub.cancel_at_period_end ?? false,
      "subscription.updatedAt": admin.firestore.FieldValue.serverTimestamp(),
    };

    if (sub.trial_end) {
      userUpdate["subscription.trialEnd"] = sub.trial_end;
    }

    // ── 5. Write user doc ───────────────────────────────────────────
    await db.doc(`users/${uid}`).update(userUpdate);
    functions.logger.info(
      `Updated users/${uid} → plan=${effectivePlan}, status=${status}`
    );

    // ── 6. Sync to business settings/main if user has a business ───
    if (businessId) {
      const settingsUpdate: Record<string, unknown> = {
        "subscription.plan": effectivePlan,
        "subscription.status": status,
        "subscription.role": effectiveRole,
        "subscription.stripeSubscriptionId": subscriptionId,
        "subscription.currentPeriodEnd": sub.current_period_end,
        "subscription.cancelAtPeriodEnd": sub.cancel_at_period_end ?? false,
        "subscription.updatedAt": admin.firestore.FieldValue.serverTimestamp(),
      };

      await db
        .doc(`businesses/${businessId}/settings/main`)
        .set(settingsUpdate, { merge: true });

      functions.logger.info(
        `Synced to businesses/${businessId}/settings/main → plan=${effectivePlan}`
      );
    }

    // ── 7. If subscription just became active, check pending referral
    const wasPreviouslyActive =
      change.before.exists &&
      ACTIVE_STATUSES.includes(
        (change.before.data() as StripeSubscription).status
      );

    if (isActive && !wasPreviouslyActive) {
      functions.logger.info(
        `Subscription ${subscriptionId} newly active — checking for pending referral`
      );
      await qualifyPendingReferral(uid);
    }

    return;
  });

/**
 * When a referred user's subscription becomes active, mark
 * their referral as "qualified" (pending reward after MIN_QUALIFICATION_DAYS).
 */
async function qualifyPendingReferral(referredUid: string): Promise<void> {
  const referralsSnap = await db
    .collection("referrals")
    .where("referredId", "==", referredUid)
    .where("status", "==", "pending")
    .limit(1)
    .get();

  if (referralsSnap.empty) {
    functions.logger.info(`No pending referral found for ${referredUid}`);
    return;
  }

  const referralDoc = referralsSnap.docs[0];
  await referralDoc.ref.update({
    status: "qualified",
    qualifiedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  functions.logger.info(
    `Referral ${referralDoc.id} qualified — referred user ${referredUid} is now active`
  );
}
