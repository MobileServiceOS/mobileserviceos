import * as admin from "firebase-admin";
import * as functions from "firebase-functions";
import type { FraudCheckResult, ReferralDoc } from "./types";
import { MAX_REFERRAL_CREDITS } from "./types";

const db = admin.firestore();

/**
 * Run fraud checks before applying a referral reward.
 * Returns a FraudCheckResult with pass/fail, flags, and risk score.
 */
export async function checkFraud(
  referral: ReferralDoc,
  referralId: string
): Promise<FraudCheckResult> {
  const flags: string[] = [];
  let riskScore = 0;

  const { referrerId, referredId } = referral;

  // ── 1. Self-referral ──────────────────────────────────────────────
  if (referrerId === referredId) {
    flags.push("SELF_REFERRAL");
    riskScore += 100;
  }

  // ── 2. Duplicate referral pair ────────────────────────────────────
  const dupeSnap = await db
    .collection("referrals")
    .where("referrerId", "==", referrerId)
    .where("referredId", "==", referredId)
    .get();

  if (dupeSnap.size > 1) {
    flags.push("DUPLICATE_PAIR");
    riskScore += 80;
  }

  // ── 3. Referrer credit cap ────────────────────────────────────────
  const referrerSnap = await db.doc(`users/${referrerId}`).get();
  if (referrerSnap.exists) {
    const currentCredits = referrerSnap.data()?.referralCreditsMonths ?? 0;
    if (currentCredits >= MAX_REFERRAL_CREDITS) {
      flags.push("CREDIT_CAP_REACHED");
      riskScore += 50;
    }
  } else {
    flags.push("REFERRER_NOT_FOUND");
    riskScore += 90;
  }

  // ── 4. Referred user account age check ────────────────────────────
  const referredSnap = await db.doc(`users/${referredId}`).get();
  if (referredSnap.exists) {
    const createdAt = referredSnap.data()?.createdAt;
    if (createdAt) {
      const ageMs = Date.now() - createdAt.toMillis();
      const ageHours = ageMs / (1000 * 60 * 60);
      // Account created less than 1 hour before referral is suspicious
      if (ageHours < 1) {
        flags.push("NEW_ACCOUNT_SUSPICIOUS");
        riskScore += 40;
      }
    }
  } else {
    flags.push("REFERRED_USER_NOT_FOUND");
    riskScore += 90;
  }

  // ── 5. Velocity check — referrer earning too many rewards too fast
  const recentRewards = await db
    .collection("referrals")
    .where("referrerId", "==", referrerId)
    .where("status", "==", "rewarded")
    .where(
      "rewardedAt",
      ">=",
      admin.firestore.Timestamp.fromMillis(
        Date.now() - 7 * 24 * 60 * 60 * 1000
      )
    )
    .get();

  if (recentRewards.size >= 5) {
    flags.push("HIGH_VELOCITY");
    riskScore += 60;
  }

  // ── 6. Shared IP / device fingerprint (placeholder) ───────────────
  // Future: check if referrer and referred share IP or device fingerprint
  // This would require storing signup metadata

  // ── 7. Check for circular referrals ───────────────────────────────
  const reverseSnap = await db
    .collection("referrals")
    .where("referrerId", "==", referredId)
    .where("referredId", "==", referrerId)
    .limit(1)
    .get();

  if (!reverseSnap.empty) {
    flags.push("CIRCULAR_REFERRAL");
    riskScore += 100;
  }

  const passed = riskScore < 50;

  functions.logger.info(
    `Fraud check for referral ${referralId}: passed=${passed}, score=${riskScore}, flags=[${flags.join(", ")}]`
  );

  return { passed, flags, riskScore };
}
