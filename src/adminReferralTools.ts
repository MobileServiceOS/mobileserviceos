import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import type { ReferralDoc } from "./types";

const db = admin.firestore();

/**
 * Callable function: manually approve a referral reward.
 * Requires the caller to be an admin (checked via custom claims).
 */
export const adminApproveReferral = functions.https.onCall(
  async (data, context) => {
    // ── Auth check ──────────────────────────────────────────────────
    if (!context.auth) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "Must be signed in"
      );
    }

    const callerClaims = context.auth.token;
    if (callerClaims.role !== "owner" && callerClaims.admin !== true) {
      throw new functions.https.HttpsError(
        "permission-denied",
        "Only admins can approve referrals"
      );
    }

    const { referralId } = data;
    if (!referralId || typeof referralId !== "string") {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "referralId is required"
      );
    }

    const referralRef = db.doc(`referrals/${referralId}`);
    const referralSnap = await referralRef.get();

    if (!referralSnap.exists) {
      throw new functions.https.HttpsError("not-found", "Referral not found");
    }

    const referral = referralSnap.data() as ReferralDoc;

    if (referral.status === "rewarded") {
      return { ok: true, message: "Already rewarded" };
    }

    const rewardMonths = referral.rewardMonths || 1;
    const idempotencyKey = `referral_admin_approve:${referralId}`;

    // Check idempotency
    const existingLedger = await db
      .collection("rewardLedger")
      .where("idempotencyKey", "==", idempotencyKey)
      .limit(1)
      .get();

    if (!existingLedger.empty) {
      return { ok: true, message: "Already processed" };
    }

    await db.runTransaction(async (txn) => {
      const referrerRef = db.doc(`users/${referral.referrerId}`);

      txn.update(referrerRef, {
        referralCreditsMonths:
          admin.firestore.FieldValue.increment(rewardMonths),
        referralCount: admin.firestore.FieldValue.increment(1),
      });

      txn.update(referralRef, {
        status: "rewarded",
        rewardedAt: admin.firestore.FieldValue.serverTimestamp(),
        notes: `${referral.notes ? referral.notes + " | " : ""}Admin-approved by ${context.auth!.token.email} at ${new Date().toISOString()}`,
      });

      txn.set(db.collection("rewardLedger").doc(), {
        referralId,
        referrerId: referral.referrerId,
        referredId: referral.referredId,
        action: "credit",
        months: rewardMonths,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        idempotencyKey,
        adminEmail: context.auth!.token.email,
        reason: "Admin manual approval",
      });
    });

    functions.logger.info(
      `Admin ${context.auth.token.email} approved referral ${referralId}`
    );

    return { ok: true, rewarded: true };
  }
);

/**
 * Callable function: revoke a referral reward (fraud, abuse, etc.).
 * Decrements the referrer's credit and marks referral as revoked/fraudulent.
 */
export const adminRevokeReferral = functions.https.onCall(
  async (data, context) => {
    // ── Auth check ──────────────────────────────────────────────────
    if (!context.auth) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "Must be signed in"
      );
    }

    const callerClaims = context.auth.token;
    if (callerClaims.role !== "owner" && callerClaims.admin !== true) {
      throw new functions.https.HttpsError(
        "permission-denied",
        "Only admins can revoke referrals"
      );
    }

    const { referralId, reason, markFraudulent } = data;
    if (!referralId || typeof referralId !== "string") {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "referralId is required"
      );
    }

    const referralRef = db.doc(`referrals/${referralId}`);
    const referralSnap = await referralRef.get();

    if (!referralSnap.exists) {
      throw new functions.https.HttpsError("not-found", "Referral not found");
    }

    const referral = referralSnap.data() as ReferralDoc;

    if (referral.status === "revoked" || referral.status === "fraudulent") {
      return { ok: true, message: "Already revoked" };
    }

    const idempotencyKey = `referral_revoke:${referralId}`;

    // Check idempotency
    const existingLedger = await db
      .collection("rewardLedger")
      .where("idempotencyKey", "==", idempotencyKey)
      .limit(1)
      .get();

    if (!existingLedger.empty) {
      return { ok: true, message: "Already processed" };
    }

    const newStatus = markFraudulent ? "fraudulent" : "revoked";

    await db.runTransaction(async (txn) => {
      // Only decrement if it was previously rewarded
      if (referral.status === "rewarded") {
        const referrerRef = db.doc(`users/${referral.referrerId}`);
        txn.update(referrerRef, {
          referralCreditsMonths: admin.firestore.FieldValue.increment(-1),
        });
      }

      txn.update(referralRef, {
        status: newStatus,
        revokedAt: admin.firestore.FieldValue.serverTimestamp(),
        fraudFlags: markFraudulent
          ? admin.firestore.FieldValue.arrayUnion("ADMIN_FLAGGED")
          : referral.fraudFlags || [],
        notes: `${referral.notes ? referral.notes + " | " : ""}Revoked by ${context.auth!.token.email} at ${new Date().toISOString()}${reason ? ": " + reason : ""}`,
      });

      txn.set(db.collection("rewardLedger").doc(), {
        referralId,
        referrerId: referral.referrerId,
        referredId: referral.referredId,
        action: "revoke",
        months: referral.rewardMonths || 1,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        idempotencyKey,
        adminEmail: context.auth!.token.email,
        reason: reason || "Admin revocation",
      });
    });

    functions.logger.info(
      `Admin ${context.auth.token.email} revoked referral ${referralId} (${newStatus})`
    );

    return { ok: true, revoked: true };
  }
);

/**
 * Callable function: list all referrals with optional status filter.
 * Admin-only endpoint for the referral management dashboard.
 */
export const adminListReferrals = functions.https.onCall(
  async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "Must be signed in"
      );
    }

    const callerClaims = context.auth.token;
    if (callerClaims.role !== "owner" && callerClaims.admin !== true) {
      throw new functions.https.HttpsError(
        "permission-denied",
        "Only admins can list referrals"
      );
    }

    const { status, limit: queryLimit } = data || {};
    let query: FirebaseFirestore.Query = db.collection("referrals");

    if (status && typeof status === "string") {
      query = query.where("status", "==", status);
    }

    query = query
      .orderBy("createdAt", "desc")
      .limit(Math.min(queryLimit || 50, 100));

    const snap = await query.get();

    const referrals = snap.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    return { ok: true, referrals, count: referrals.length };
  }
);
