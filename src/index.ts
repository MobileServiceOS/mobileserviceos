import * as admin from "firebase-admin";

// Initialize Firebase Admin SDK (must be before any imports that use it)
admin.initializeApp();

// ── Subscription sync ───────────────────────────────────────────────
export { onSubscriptionWrite } from "./onSubscriptionWrite";

// ── Referral reward system ──────────────────────────────────────────
export { applyReferralRewards } from "./applyReferralReward";

// ── Admin referral management ───────────────────────────────────────
export {
  adminApproveReferral,
  adminRevokeReferral,
  adminListReferrals,
} from "./adminReferralTools";
