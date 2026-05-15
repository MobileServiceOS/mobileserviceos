// Shared types for Cloud Functions. Mirrors the client-side ReferralDoc
// shape from src/types/index.ts. Keep these in sync if either changes.

export type ReferralStatus =
  | 'pending'
  | 'trialing'
  | 'converted'
  | 'rewarded'
  | 'canceled'
  | 'fraudulent';

export interface ReferralDoc {
  id: string;
  referrerBusinessId: string;
  referredBusinessId: string;
  referredUid: string;
  referredEmail: string;
  referralCode: string;
  status: ReferralStatus;
  createdAt: string;
  trialingAt?: string;
  convertedAt?: string;
  rewardedAt?: string;
  canceledAt?: string;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  stripeBalanceTransactionId?: string;
  firstSuccessfulPaymentAt?: string;
  creditAmountUsd?: number;
  fraudFlags?: string[];
  notes?: string;
  paymentFingerprints?: string[];
}
