/** Stripe subscription status values */
export type StripeSubscriptionStatus =
  | "active"
  | "trialing"
  | "past_due"
  | "canceled"
  | "unpaid"
  | "incomplete"
  | "incomplete_expired"
  | "paused";

/** Plan tier as stored in Stripe product metadata */
export type PlanTier = "core" | "pro" | "free";

/** Firebase role mapped from plan */
export type FirebaseRole = "core_subscriber" | "pro_subscriber" | "free";

/** Subscription document shape from firestore-stripe-payments extension */
export interface StripeSubscription {
  id: string;
  status: StripeSubscriptionStatus;
  product: FirebaseFirestore.DocumentReference;
  price: FirebaseFirestore.DocumentReference;
  current_period_start: FirebaseFirestore.Timestamp;
  current_period_end: FirebaseFirestore.Timestamp;
  cancel_at_period_end: boolean;
  canceled_at?: FirebaseFirestore.Timestamp;
  ended_at?: FirebaseFirestore.Timestamp;
  trial_start?: FirebaseFirestore.Timestamp;
  trial_end?: FirebaseFirestore.Timestamp;
  metadata?: Record<string, string>;
  items: Array<{
    price: {
      id: string;
      product: string;
    };
  }>;
}

/** Product metadata shape (set in Stripe Dashboard) */
export interface ProductMetadata {
  plan: PlanTier;
  tier: string;
  firebaseRole: FirebaseRole;
}

/** Referral document in Firestore */
export interface ReferralDoc {
  referrerId: string;
  referredId: string;
  referralCode: string;
  status: "pending" | "qualified" | "rewarded" | "fraudulent" | "revoked";
  createdAt: FirebaseFirestore.Timestamp;
  qualifiedAt?: FirebaseFirestore.Timestamp;
  rewardedAt?: FirebaseFirestore.Timestamp;
  revokedAt?: FirebaseFirestore.Timestamp;
  rewardMonths: number;
  fraudFlags?: string[];
  notes?: string;
}

/** Referral reward ledger entry */
export interface RewardLedgerEntry {
  referralId: string;
  referrerId: string;
  referredId: string;
  action: "credit" | "revoke";
  months: number;
  timestamp: FirebaseFirestore.Timestamp;
  idempotencyKey: string;
  adminEmail?: string;
  reason?: string;
}

/** User document fields relevant to referrals */
export interface UserReferralFields {
  referralCode?: string;
  referredBy?: string;
  referralCreditsMonths?: number;
  referralCount?: number;
}

/** Fraud check result */
export interface FraudCheckResult {
  passed: boolean;
  flags: string[];
  riskScore: number;
}

/** Active subscription statuses that count as "subscribed" */
export const ACTIVE_STATUSES: StripeSubscriptionStatus[] = [
  "active",
  "trialing",
];

/** Maximum referral credits any single user can accumulate */
export const MAX_REFERRAL_CREDITS = 12;

/** Minimum subscription age (days) before referral qualifies */
export const MIN_QUALIFICATION_DAYS = 30;
