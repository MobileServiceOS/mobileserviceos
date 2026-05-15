// ═══════════════════════════════════════════════════════════════════
//  Mobile Service OS — Canonical Type System
// ═══════════════════════════════════════════════════════════════════
//
//  Single source of truth for shared types. Components, contexts,
//  hooks, and library code MUST import from here (`@/types`) rather
//  than defining their own.
//
//  Consolidation philosophy:
//    - Additive where safe. Most existing fields are unchanged.
//    - All new fields are optional so existing Firestore documents
//      remain readable without migration.
//    - The MemberDoc shape was updated to match the membership flow
//      the rest of the app expects (businessId, invitedBy,
//      assignedBusinessId, status union). This replaces the earlier
//      draft shape — there were no production consumers yet.
//
// ═══════════════════════════════════════════════════════════════════

import type { Timestamp } from 'firebase/firestore';

// ─────────────────────────────────────────────────────────────────────
//  Status / enum types
// ─────────────────────────────────────────────────────────────────────

export type PaymentStatus = 'Paid' | 'Pending Payment' | 'Partial Payment' | 'Cancelled';
export type JobStatus = 'Completed' | 'Pending' | 'Cancelled';
export type TireSource = 'Inventory' | 'Bought for this job' | 'Customer supplied';

/**
 * Canonical payment method union — STORED VALUES (lowercase identifiers).
 * Use this in Firestore, query keys, and CSS class suffixes.
 *
 * Display labels are separate — see PaymentMethodSheet for the
 * canonical lowercase ↔ "Title Case" mapping for UI rendering.
 */
export type PaymentMethod =
  | 'cash'
  | 'card'
  | 'zelle'
  | 'venmo'
  | 'cashapp'
  | 'check'
  | 'apple_pay'
  | 'google_pay'
  | 'other';

/**
 * Current connection / write state of the local app vs Firestore.
 * Surfaced in the header pill.
 */
export type SyncStatus = 'local' | 'syncing' | 'connected' | 'offline' | 'sync_failed';

/**
 * Top-level nav tabs. Adding a tab here must also be reflected in the
 * router switch in App.tsx and in AppBottomNav.
 */
export type TabId =
  | 'dashboard'
  | 'add'
  | 'history'
  | 'customers'
  | 'payouts'
  | 'expenses'
  | 'inventory'
  | 'settings'
  | 'help'
  | 'success';

// ─────────────────────────────────────────────────────────────────────
//  Plan / Billing
// ─────────────────────────────────────────────────────────────────────

/**
 * Subscription tier. Two-tier architecture preserved internally
 * (Core $39.99/mo, Pro $89.99/mo) even though only Pro is offered publicly
 * today — this lets us turn Core marketing on later without touching
 * the type system or backend.
 *
 * Public-facing onboarding always assigns `'pro'` for new accounts.
 * The Core literal exists for future pricing experiments, internal
 * downgrade flows, and legacy Firestore documents that may still
 * have `'core'` on disk.
 *
 * All gating decisions MUST go through `src/lib/planAccess.ts` —
 * never hand-roll `plan === 'pro'` checks at call sites. The module
 * exposes `canAccessFeature()`, `hasProAccess()`, `isTeamEnabled()`
 * for typed, centralized gating.
 */
export type Plan = 'core' | 'pro';

/**
 * Stripe-aligned subscription lifecycle states. 'inactive' covers the
 * pre-Stripe period and any account whose subscription record has been
 * deleted; 'trialing' covers the free-trial window before first
 * payment.
 */
export type SubscriptionStatus =
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'inactive';

// ─────────────────────────────────────────────────────────────────────
//  Team / Membership
// ─────────────────────────────────────────────────────────────────────

/**
 * Role assigned to a member inside a business. Owners can do anything;
 * admins manage techs and view financials; technicians log jobs and
 * (per business config) optionally override prices.
 */
export type TeamRole = 'owner' | 'admin' | 'technician';

/**
 * Alias kept so legacy imports of `Role` continue to compile. Treat
 * `Role` and `TeamRole` as identical. New code can pick either.
 */
export type Role = TeamRole;

/**
 * Lifecycle state of a team member document. 'pending' = invite sent,
 * not yet accepted; 'active' = signed in and participating; 'disabled'
 * = revoked but kept for historical attribution.
 */
export type MemberStatus = 'active' | 'pending' | 'disabled';

/**
 * Firestore document shape for `businesses/{bid}/members/{memberId}`.
 *
 * The membership flow:
 *   1. Owner enters an email + role → MemberDoc written with
 *      status='pending', invitedAt, invitedBy.
 *   2. On signup, Cloud Function (future batch) resolves the email
 *      to an auth uid and updates status='active', joinedAt, uid.
 *   3. assignedBusinessId is set when an admin/tech is moved from
 *      one business to another — preserves audit trail.
 *
 * Many fields are optional because docs at different stages of the
 * lifecycle have different fields populated.
 */
export interface MemberDoc {
  /** Auth uid — populated once the member has signed up + accepted. */
  uid?: string;
  /** Email — the canonical identifier for invites before signup.
   *  Always required; how the invite is addressed. */
  email: string;
  /** Display name shown on job cards / invoices for technician
   *  attribution. Populated on accept or set manually by owner. */
  displayName?: string;
  /** Role inside this business. Owners are seeded automatically. */
  role: Role;
  /**
   * Primary business this member belongs to. Optional because the
   * owner-seed flow writes a MemberDoc before the businessId is
   * finalized on the docs side. Resolvers can default to the current
   * brand context's businessId when missing.
   */
  businessId?: string;
  /** When an admin/tech is reassigned, this tracks the previous
   *  business for audit purposes. Optional. */
  assignedBusinessId?: string;
  /** Auth uid of the owner/admin who sent the invite. */
  invitedBy?: string;
  /** Timestamp the invite was created. Accepts Firestore Timestamp,
   *  JS Date, or ISO string for cross-environment write/read. */
  invitedAt?: Timestamp | Date | string;
  /** Timestamp the member accepted and was promoted to active.
   *  Same flexible type as invitedAt. */
  joinedAt?: Timestamp | Date | string;
  /** Lifecycle state. See MemberStatus comments. */
  status: MemberStatus;
  /**
   * Per-member permission overrides. When present, these take precedence
   * over role-default permissions resolved from the user's `role`.
   * Stored as a partial map so owners can grant individual flags without
   * having to specify the full permission set. Read by permissions.ts
   * and the membership resolver.
   */
  permissions?: Partial<Permissions>;
}

// ─────────────────────────────────────────────────────────────────────
//  Invites
// ─────────────────────────────────────────────────────────────────────

/**
 * Pending team invite. Stored top-level at:
 *
 *   invites/{token}
 *
 * Token-keyed (random URL-safe string) so:
 *
 *   1. The invite link contains a single opaque identifier — no email
 *      leakage in the URL, no PII in browser history.
 *   2. The invitee can be ANY new or existing user; the link does not
 *      require a specific Firebase Auth account to exist beforehand.
 *   3. Owners can reissue invites without exposing previous tokens
 *      (rotate by revoking + creating).
 *   4. Lifecycle states (pending / accepted / expired / revoked) are
 *      tracked in-doc rather than via existence checks alone — gives
 *      a clean audit trail.
 *
 * Security: Firestore rules enforce that:
 *   - Only owner/admin of the target business creates invites for it
 *   - The invite role must be admin or technician (never owner)
 *   - Any authed user can READ a pending invite if they know the token
 *     (treated like a one-time secret in the URL)
 *   - Only an authed user whose verified token email MATCHES the
 *     invite's `email` field can transition it to `accepted` AND only
 *     if status is still `pending` AND expiresAt is in the future
 *   - Owner/admin of the inviting business can revoke (transition to
 *     `revoked`) any of their own invites
 *
 * See `firestore.rules` and `docs/INVITES-SETUP.md` for the rule block.
 */
export type InviteStatus = 'pending' | 'accepted' | 'expired' | 'revoked';

export interface InviteDoc {
  /** Random URL-safe token — also the document ID. Used as the
   *  single value in the invite link's query param (?invite=<token>). */
  id: string;
  /** Same as `id`. Stored as a field for query-friendliness and
   *  explicit-naming clarity in rule expressions. */
  token: string;
  /** Lowercased email the invite was issued to. Acceptance is gated
   *  on `request.auth.token.email.lower() == this.email`. */
  email: string;
  /** Business the invitee will be attached to on acceptance. */
  businessId: string;
  /** Role assigned on acceptance. Owner is excluded — owners are
   *  seeded on first signup, never invited. */
  role: 'admin' | 'technician';
  /** Lifecycle state. `pending` → `accepted` | `revoked` | `expired`.
   *  Expired transitions can be done client-side lazily on read, OR by
   *  a future scheduled Cloud Function. */
  status: InviteStatus;
  /** Auth uid of the user who created the invite. Required for audit
   *  trail and to satisfy the Firestore rule that limits invite creation
   *  to verified members of the target business. */
  invitedBy: string;
  /** Optional display name of the inviter — surfaced in the accepting
   *  UI ("You've been invited by Alex"). */
  invitedByDisplayName?: string;
  /** Business name at time of invite — surfaced in the accepting UI
   *  so the invitee knows which business they're joining. */
  businessName?: string;
  /** ISO timestamp the invite was created. Used for sort order. */
  invitedAt: string;
  /** ISO timestamp after which the invite cannot be accepted.
   *  Default: 14 days from invitedAt. Firestore rules block any
   *  accept transition where this is in the past. */
  expiresAt: string;
  /** ISO timestamp the invite was accepted. Null until acceptance. */
  acceptedAt?: string;
  /** Auth uid of the user who accepted. Null until acceptance. */
  acceptedByUid?: string;
  /** Optional free-form note from the inviter. */
  note?: string;
}

/**
 * Permission flags resolved from the current user's role + business plan.
 * Computed by MembershipContext and read by components to gate UI.
 *
 * Keep this aligned with MembershipContext's permission resolver — if
 * you add a flag here, the resolver must compute it.
 */
export interface Permissions {
  // Financial visibility
  canViewFinancials: boolean;
  canViewRevenue: boolean;
  canViewProfit: boolean;
  canManageExpenses: boolean;
  // Inventory
  canManageInventory: boolean;
  // Pricing
  canEditPricingSettings: boolean;
  canViewPricingSettings: boolean;
  canUsePricingEngine: boolean;
  canOverrideJobPrice: boolean;
  // Team + billing
  canManageTeam: boolean;
  canManageBilling: boolean;
  // Business settings + branding
  canEditBusinessSettings: boolean;
  canUploadLogo: boolean;
  // Customer-facing actions
  canGenerateInvoices: boolean;
  canSendReviews: boolean;
  // Jobs
  canCreateJobs: boolean;
  canEditJobs: boolean;
  canDeleteJobs: boolean;
  // Analytics
  canViewAdvancedReports: boolean;
}

// ─────────────────────────────────────────────────────────────────────
//  Brand
// ─────────────────────────────────────────────────────────────────────

export interface Brand {
  businessName: string;
  logoUrl: string;
  primaryColor: string;
  accentColor: string;
  phone: string;
  email: string;
  website: string;
  reviewUrl: string;
  invoiceFooter: string;
  serviceArea: string;
  businessType: string;
  tagline: string;
  state?: string;
  mainCity?: string;
  fullLocationLabel?: string;
  serviceCities?: string[];
  serviceRadius?: number;
  onboardingComplete?: boolean;
  onboardingCompletedAt?: string | null;
  /** When true, the invoice renders a warranty box near the footer with
   *  warrantyText. When false/missing, the box is omitted entirely. */
  warrantyEnabled?: boolean;
  /** Text shown inside the invoice warranty box when warrantyEnabled is
   *  true. Suggested defaults: "90-day workmanship warranty on eligible
   *  services." */
  warrantyText?: string;
}

// ─────────────────────────────────────────────────────────────────────
//  Pricing
// ─────────────────────────────────────────────────────────────────────

export interface ServicePricing {
  enabled: boolean;
  basePrice: number;
  minProfit: number;
}

export interface VehiclePricing {
  addOnProfit: number;
}

// ─────────────────────────────────────────────────────────────────────
//  Expenses
// ─────────────────────────────────────────────────────────────────────

export interface Expense {
  id: string;
  name: string;
  amount: number;
  active: boolean;
}

// ─────────────────────────────────────────────────────────────────────
//  Inventory
// ─────────────────────────────────────────────────────────────────────

export interface InventoryItem {
  id: string;
  size: string;
  qty: number;
  cost: number;
  notes?: string;
  condition?: string;
  brand?: string;
  model?: string;
  _isNew?: boolean;
}

export interface InventoryDeduction {
  id: string;
  size: string;
  qty: number;
  cost: number;
}

// ─────────────────────────────────────────────────────────────────────
//  Job
// ─────────────────────────────────────────────────────────────────────

export interface Job {
  id: string;
  date: string;
  service: string;
  vehicleType: string;
  area: string;
  /**
   * Legacy free-text payment label. Kept for backwards compatibility
   * with existing Firestore documents and UI components reading it.
   * NEW code should write `paymentMethod` (the typed union) instead.
   */
  payment: string;
  /**
   * Canonical typed payment method. Optional so legacy jobs that only
   * have `payment: string` remain readable. Adopting code should set
   * both fields on save until a future migration drops `payment`.
   */
  paymentMethod?: PaymentMethod;
  status: JobStatus;
  source: string;
  customerName: string;
  customerPhone: string;
  tireSize: string;
  qty: number | string;
  revenue: number | string;
  tireCost: number | string;
  materialCost: number | string;
  miscCost?: number | string;
  miles: number | string;
  note: string;
  emergency: boolean;
  lateNight: boolean;
  highway: boolean;
  weekend: boolean;
  tireSource: TireSource;
  tireBrand?: string;
  tireModel?: string;
  tireVendor?: string;
  tirePurchasePrice?: number | string;
  tireCondition?: 'New' | 'Used' | '';
  tireReceiptUrl?: string;
  tireNotes?: string;
  inventoryDeductions?: InventoryDeduction[] | string | null;
  inventoryUsed?: unknown;
  paymentStatus: PaymentStatus;
  /** ISO timestamp of when the job was marked Paid. Stamped by handleMarkPaid. */
  paidAt?: string;
  invoiceGenerated: boolean;
  invoiceGeneratedAt?: string | null;
  invoiceNumber?: string | null;
  invoiceSent: boolean;
  invoiceSentAt?: string | null;
  reviewRequested: boolean;
  reviewRequestedAt?: string | null;
  lastEditedAt?: string | null;
  city?: string;
  state?: string;
  fullLocationLabel?: string;
  /** Auth uid of the user who created the job. Used for technician
   *  attribution on invoices and job cards, plus the role-based
   *  Dashboard filter (technicians see only their own jobs). */
  createdByUid?: string;
  /** ISO timestamp of when the job was first saved. Set once on
   *  initial save; never overwritten. Used to distinguish actual
   *  job-creation time from `date` (the service date, which can be
   *  any day). */
  createdAt?: string;
}

// ─────────────────────────────────────────────────────────────────────
//  Settings
// ─────────────────────────────────────────────────────────────────────

export interface Settings {
  businessName: string;
  owner1Name: string;
  owner2Name: string;
  owner1Active: boolean;
  owner2Active: boolean;
  profitSplit1: number;
  profitSplit2: number;
  weeklyGoal: number;
  /**
   * Day of week the work week starts on. 0=Sunday, 1=Monday, ...
   * 6=Saturday. Defaults to 1 (Monday) when undefined — the most
   * common operational pattern. Used by Dashboard "This Week's
   * Profit" and Payouts "Week's Earnings" calculations.
   *
   * Editable in Settings → Business (owner/admin only).
   */
  workWeekStartDay?: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  /**
   * Weekly completed-jobs goal for individual technicians. Drives
   * the per-technician progress ring on the Dashboard. Defaults to
   * 5 when undefined — a reasonable starting target. Owners can
   * raise/lower this in Settings → Business.
   *
   * Distinct from `weeklyGoal` (which is the company-wide DOLLAR
   * goal). This is jobs, not money — keeps the technician dashboard
   * non-financial when role permissions don't allow $$ visibility.
   */
  technicianWeeklyJobsGoal?: number;
  taxRate: number;
  costPerMile: number;
  defaultTargetProfit: number;
  invoiceTaxRate: number;
  servicePricing: Record<string, ServicePricing>;
  vehiclePricing: Record<string, VehiclePricing>;
  expenses: Expense[];
  freeMilesIncluded?: number;
  tireRepairTargetProfit?: number;
  tireReplacementTargetProfit?: number;
  /**
   * Subscription tier for this business. Single value ('pro') with
   * the platform's one-plan model. Drives feature gating in
   * MembershipContext and `isProEntitled` checks. New accounts are
   * stamped 'pro' on signup; legacy 'core' docs are treated as
   * pre-migration and surfaced for cleanup at the call site.
   */
  plan?: Plan;
  /**
   * Stripe-aligned subscription state. 'trialing' during the
   * 14-day free trial, 'active' once paying, 'past_due' on failed
   * renewal, 'canceled' after explicit cancel, 'inactive' for
   * pre-Stripe accounts.
   */
  subscriptionStatus?: SubscriptionStatus;
  /** When the free trial began. Stamped on signup (Onboarding finish). */
  trialStartedAt?: Timestamp | Date | string;
  /** When the free trial ends. Cloud Function reads this to flip
   *  subscriptionStatus → past_due / canceled if no payment by then. */
  trialEndsAt?: Timestamp | Date | string;
  /**
   * Plan-determined member cap. Pro accounts default to 5 seats on
   * signup. Cloud Function may raise this for enterprise customers
   * in the future. UI uses this to disable invite-new-member when
   * at capacity.
   */
  maxUsers?: number;
  /**
   * ─── Billing Exemption (VIP / founder / lifetime accounts) ─────────
   *
   * When `billingExempt === true`, this account bypasses ALL Stripe
   * checks and is treated as Pro indefinitely. The exemption layer is
   * tenant-scoped so individual VIP accounts can be granted lifetime
   * access without affecting Stripe billing for every other business.
   *
   * Resolution rules (implemented in `src/lib/planAccess.ts`):
   *   - billingExempt === true → resolved plan is always 'pro'
   *   - Stripe webhook events MUST NOT downgrade exempt accounts; the
   *     `stripeSync.ts` mirror checks `billingExempt` before writing
   *     `subscriptionStatus` / `plan` changes from Stripe.
   *   - Firestore security rules block client-side modification of
   *     exemption fields (see firestore.rules `exemptionFieldsUnchanged`
   *     helper — only Cloud Functions with Admin SDK may write these).
   *
   * To grant lifetime access (NOT client-callable):
   *   Use the Firebase Admin SDK from a Cloud Function or the
   *   Firebase Console directly. Set on `businesses/{id}/settings/main`:
   *     billingExempt: true
   *     subscriptionOverride: 'lifetime'
   *     exemptionGrantedAt: <ISO timestamp>
   *     exemptionGrantedBy: <granter uid or 'admin'>
   *     exemptionReason: <free-form audit string>
   *
   * Currently only the Wheel Rush founder account has this set.
   * Reusable for any future VIP / founder / promotional grant via
   * Admin SDK — never via client code.
   */
  /** Master kill-switch for Stripe billing on this account. When true,
   *  every plan check resolves to Pro regardless of Stripe state. */
  billingExempt?: boolean;
  /** Categorization of the exemption type. 'lifetime' is the default
   *  for founder accounts; 'beta', 'comp', and 'internal' reserved for
   *  future grant types. Free-form string union to keep the schema
   *  flexible without a code change for each new grant category. */
  subscriptionOverride?: 'lifetime' | 'beta' | 'comp' | 'internal';
  /** ISO timestamp of when the exemption was granted. Set by
   *  `setLifetimeAccess()`. Never overwritten by the mirror. */
  exemptionGrantedAt?: string;
  /** Auth uid of the person/system that granted the exemption.
   *  Audit trail for support tickets / billing inquiries. */
  exemptionGrantedBy?: string;
  /** Free-text reason for the exemption (e.g. "Founder account",
   *  "Beta tester comp through 2027-01-01"). Surfaced in the hidden
   *  Settings panel for owner visibility. */
  exemptionReason?: string;

  // ───────────────────────────────────────────────────────────────
  // REFERRAL SYSTEM
  // ───────────────────────────────────────────────────────────────
  /**
   * Unique short referral code for this business. Generated on first
   * write of the Settings doc (via referral.ts ensureReferralCode).
   * Used in `?ref=CODE` URL params on signup. Human-readable, 6-7
   * uppercase alphanumerics. Collision-checked before commit.
   *
   * Examples: 'MSOS7F3', 'WRUSH24', 'ROAD89X'.
   */
  referralCode?: string;
  /**
   * Number of free-month credits this business has been awarded for
   * successful referrals. Each credit = 1 paid month covered by a
   * Stripe Customer Balance adjustment. Incremented by the
   * `onSubscriptionFirstPayment` Cloud Function ONLY. Client cannot
   * write this field (locked in firestore.rules).
   */
  referralCreditsMonths?: number;
  /**
   * Total count of referrals that converted to a paid subscription.
   * Audit counter — never decremented. If a fraudulent referral is
   * revoked via admin, `referralCreditsMonths` is debited but this
   * counter stays so we have a true historical count.
   */
  totalSuccessfulReferrals?: number;
  /**
   * If this business was referred by another business, stores the
   * referrer's businessId. Set during signup from the URL `ref=`
   * parameter. NEVER set by the user after signup — locked in
   * firestore.rules after initial create.
   */
  referredBy?: string;
  /**
   * The referral code that brought this business in. Stored for
   * audit even though `referredBy` is the canonical link.
   */
  referredByCode?: string;
  /**
   * Document id of the corresponding `referrals/{id}` doc that
   * tracks this business's signup. Allows fast lookup of referral
   * state from the business doc.
   */
  referralDocId?: string;

  /**
   * Owner-set flag: whether technicians on this business are allowed to
   * manually override the system-suggested revenue on jobs they log.
   * Pricing settings themselves remain owner-only either way.
   */
  allowTechnicianPriceOverride?: boolean;
  /**
   * Multi-tire job pricing configuration. When present, the pricing
   * engine applies tier-based pricing for jobs with multiple tires
   * (e.g. a 4-tire install uses different rates than a single tire).
   *
   * Sub-fields:
   *   - `replacementMultipliers`: per-quantity revenue multiplier for
   *     replacement jobs. Named tiers (`one`, `two`, `three`, `four`)
   *     match the utility resolver in `utils.ts` — quantities ≥4
   *     fall back to the `four` tier.
   *   - `installationByQuantity`: per-quantity flat install labor
   *     price for customer-supplied tire installations. Same named
   *     tier scheme; `four` covers any qty ≥4.
   *
   * Both sub-fields are required when `multiTirePricing` is set so
   * callers can chain `mt.replacementMultipliers.two` after a single
   * `if (!mt) return` guard without per-property optional chaining.
   * Individual tier values are optional — partial configs fall through
   * to `|| 0` / `|| 1` defaults in the resolver.
   *
   * Read by `replacementMultiplier()` and `installationPriceFor()` in
   * `src/lib/utils.ts`.
   */
  multiTirePricing?: {
    replacementMultipliers: {
      one?: number;
      two?: number;
      three?: number;
      four?: number;
    };
    installationByQuantity: {
      one?: number;
      two?: number;
      three?: number;
      four?: number;
    };
  };
  /**
   * Bag of feature flags toggled by the owner during onboarding and
   * by Cloud Functions on plan changes. Keys here gate experimental or
   * plan-locked features without requiring a schema migration each
   * time a flag is added or retired. Read by Onboarding + defaults.
   *
   * Known keys (non-exhaustive):
   *   - `analyticsDashboard` — unlock the analytics tab
   *   - `multiUserBeta`      — early access to team management
   *   - `aiQuoting`          — AI-assisted price suggestions
   *   - `teamAccess`         — team management UI unlocked
   *   - `technicianRoles`    — role-based access on technician accounts
   *   - `advancedReports`    — advanced analytics dashboard
   */
  featureFlags?: Record<string, boolean>;
}

// ─────────────────────────────────────────────────────────────────────
//  Quote engine
// ─────────────────────────────────────────────────────────────────────

export interface QuoteForm {
  service: string;
  vehicleType: string;
  miles?: number | string;
  tireCost?: number | string;
  materialCost?: number | string;
  miscCost?: number | string;
  qty?: number | string;
  revenue?: number | string;
  emergency?: boolean;
  lateNight?: boolean;
  highway?: boolean;
  weekend?: boolean;
}

export interface QuoteResult {
  suggested: number;
  premium: number;
  directCosts: number;
  targetProfit: number;
}

// ─────────────────────────────────────────────────────────────────────
//  Toasts
// ─────────────────────────────────────────────────────────────────────

export type ToastType = 'success' | 'warn' | 'error' | 'info';

export interface ToastItem {
  id: string;
  msg: string;
  type: ToastType;
  ts: number;
}

// ─────────────────────────────────────────────────────────────────────
//  Display label helpers — kept here so payment-method UIs across the
//  app render consistently. The canonical store value is the lowercase
//  PaymentMethod above; this is the human label for picker/badge UI.
// ─────────────────────────────────────────────────────────────────────

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: 'Cash',
  card: 'Card',
  zelle: 'Zelle',
  venmo: 'Venmo',
  cashapp: 'Cash App',
  check: 'Check',
  apple_pay: 'Apple Pay',
  google_pay: 'Google Pay',
  other: 'Other',
};

// ─────────────────────────────────────────────────────────────────────
// REFERRAL SYSTEM TYPES
//
// Top-level `referrals/{referralId}` collection tracks every referral
// signup. Lifecycle:
//
//   pending    → New business signed up via ref code, no Stripe sub yet
//   trialing   → Stripe sub created, in 14-day free trial
//   converted  → First successful PAID invoice processed (post-trial)
//   rewarded   → Credit applied to referrer's Stripe balance
//   canceled   → Referred business canceled before first paid payment
//   fraudulent → Flagged by anti-fraud heuristics, no reward granted
//
// All writes happen server-side via Cloud Functions or Admin SDK.
// Firestore rules block client writes entirely.
// ─────────────────────────────────────────────────────────────────────

export type ReferralStatus =
  | 'pending'
  | 'trialing'
  | 'converted'
  | 'rewarded'
  | 'canceled'
  | 'fraudulent';

export interface ReferralDoc {
  /** Document id — random ULID-like string. */
  id: string;
  /** Business id of the referrer (the one who shared their link). */
  referrerBusinessId: string;
  /** Business id of the new account that signed up via the link. */
  referredBusinessId: string;
  /** Auth uid of the new account. Used for tying back to the
   *  Stripe customer doc at /customers/{uid}. */
  referredUid: string;
  /** Email of the new account at signup time. Used for fraud
   *  velocity checks and human audit. */
  referredEmail: string;
  /** The exact code that was used (denormalized for audit even
   *  though we have referrerBusinessId). */
  referralCode: string;
  /** Lifecycle state. See ReferralStatus union. */
  status: ReferralStatus;

  /** ISO timestamps. */
  createdAt: string;
  /** When the new account started a Stripe trial. */
  trialingAt?: string;
  /** When the new account's first paid invoice succeeded. */
  convertedAt?: string;
  /** When the referrer's credit was applied. */
  rewardedAt?: string;
  /** When the referral was canceled (subscription canceled before
   *  first paid invoice). */
  canceledAt?: string;

  /** Stripe IDs — populated by the Cloud Function as the lifecycle
   *  progresses. */
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  stripeBalanceTransactionId?: string;
  /** ISO timestamp of the first successful paid invoice from Stripe. */
  firstSuccessfulPaymentAt?: string;
  /** Dollar amount of the credit applied (typically the referrer's
   *  current monthly plan price). Stored for audit. */
  creditAmountUsd?: number;

  /** Anti-fraud flags raised during evaluation. Empty array = clean.
   *  Cloud Function refuses to reward referrals with any flags
   *  unless an admin manually approves via the admin tool. */
  fraudFlags?: string[];
  /** Free-text admin notes — added via admin tools. */
  notes?: string;
}
