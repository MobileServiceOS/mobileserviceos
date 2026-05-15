import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import type { ReferralDoc, RewardLedgerEntry } from "./types";
import { MAX_REFERRAL_CREDITS, MIN_QUALIFICATION_DAYS } from "./types";
import { checkFraud } from "./fraudGuard";

const db = admin.firestore();

/**
 * Scheduled function that runs daily to check for qualified referrals
 * that have passed the minimum qualification period and applies rewards.
 *
 * Can also be called manually via admin tools.
 */
export const applyReferralRewards = functions.pubsub
  .schedule("every 24 hours")
  .onRun(async () => {
    functions.logger.info("Running referral reward sweep");

    const cutoff = admin.firestore.Timestamp.fromMillis(
      Date.now() - MIN_QUALIFICATION_DAYS * 24 * 60 * 60 * 1000
    );

    // Find referrals that qualified at least MIN_QUALIFICATION_DAYS ago
    const qualifiedSnap = await db
      .collection("referrals")
      .where("status", "==", "qualified")
      .where("qualifiedAt", "<=", cutoff)
      .get();

    if (qualifiedSnap.empty) {
      functions.logger.info("No referrals ready for reward");
      return;
    }

    functions.logger.info(
      `Found ${qualifiedSnap.size} referrals ready for reward`
    );

    let rewarded = 0;
    let flagged = 0;

    for (const doc of qualifiedSnap.docs) {
      const referral = doc.data() as ReferralDoc;

      try {
        const result = await processReferralReward(doc.id, referral);
        if (result === "rewarded") rewarded++;
        else if (result === "flagged") flagged++;
      } catch (err) {
        functions.logger.error(
          `Error processing referral ${doc.id}:`,
          err
        );
      }
    }

    functions.logger.info(
      `Reward sweep complete: ${rewarded} rewarded, ${flagged} flagged`
    );
  });

/**
 * Process a single referral reward with fraud checks and idempotency.
 */
export async function processReferralReward(
  referralId: string,
  referral: ReferralDoc
): Promise<"rewarded" | "flagged" | "skipped"> {
  const idempotencyKey = `referral_reward:${referralId}`;

  // ── Idempotency check ───────────────────────────────────────────
  const existingLedger = await db
    .collection("rewardLedger")
    .where("idempotencyKey", "==", idempotencyKey)
    .limit(1)
    .get();

  if (!existingLedger.empty) {
    functions.logger.info(
      `Referral ${referralId} already processed (idempotency hit)`
    );
    return "skipped";
  }

  // ── Fraud check ─────────────────────────────────────────────────
  const fraudResult = await checkFraud(referral, referralId);

  if (!fraudResult.passed) {
    functions.logger.warn(
      `Referral ${referralId} FAILED fraud check: ${fraudResult.flags.join(", ")}`
    );

    await db.doc(`referrals/${referralId}`).update({
      status: "fraudulent",
      fraudFlags: fraudResult.flags,
      notes: `Auto-flagged by fraud guard. Risk score: ${fraudResult.riskScore}`,
    });

    return "flagged";
  }

  // ── Verify referred user still has active subscription ──────────
  const referredSubs = await db
    .collection(`customers/${referral.referredId}/subscriptions`)
    .where("status", "in", ["active", "trialing"])
    .limit(1)
    .get();

  if (referredSubs.empty) {
    functions.logger.info(
      `Referred user ${referral.referredId} no longer active — skipping reward`
    );
    return "skipped";
  }

  // ── Check referrer credit cap ───────────────────────────────────
  const referrerSnap = await db.doc(`users/${referral.referrerId}`).get();
  const currentCredits = referrerSnap.data()?.referralCreditsMonths ?? 0;

  if (currentCredits >= MAX_REFERRAL_CREDITS) {
    functions.logger.info(
      `Referrer ${referral.referrerId} at credit cap (${currentCredits}/${MAX_REFERRAL_CREDITS})`
    );
    return "skipped";
  }

  const rewardMonths = referral.rewardMonths || 1;

  // ── Apply reward in a transaction ───────────────────────────────
  await db.runTransaction(async (txn) => {
    const referrerRef = db.doc(`users/${referral.referrerId}`);
    const referralRef = db.doc(`referrals/${referralId}`);
    const ledgerRef = db.collection("rewardLedger").doc();

    // Increment referrer credits
    txn.update(referrerRef, {
      referralCreditsMonths: admin.firestore.FieldValue.increment(rewardMonths),
      referralCount: admin.firestore.FieldValue.increment(1),
    });

    // Mark referral as rewarded
    txn.update(referralRef, {
      status: "rewarded",
      rewardedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Write ledger entry for audit trail
    const ledgerEntry: Omit<RewardLedgerEntry, "timestamp"> & {
      timestamp: FirebaseFirestore.FieldValue;
    } = {
      referralId,
      referrerId: referral.referrerId,
      referredId: referral.referredId,
      action: "credit",
      months: rewardMonths,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      idempotencyKey,
    };

    txn.set(ledgerRef, ledgerEntry);
  });

  functions.logger.info(
    `Rewarded referral ${referralId}: +${rewardMonths} month(s) to ${referral.referrerId}`
  );

  return "rewarded";
}
