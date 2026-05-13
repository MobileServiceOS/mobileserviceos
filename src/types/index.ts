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
  | 'success';

// ─────────────────────────────────────────────────────────────────────
//  Plan / Billing
// ─────────────────────────────────────────────────────────────────────

/**
 * Subscription tier. Mobile Service OS offers a single plan (Pro,
 * $99/mo with a 14-day free trial). The alias remains in the type
 * system so existing call sites (`isProEntitled`, plan-gating
 * helpers, future Stripe wiring) compile without churn; the literal
 * set has simply collapsed to one value.
 *
 * Any historical Firestore documents that wrote `'core'` are still
 * readable at the JS level — TypeScript will flag them on read so
 * we surface and clean them up. The runtime resolver treats anything
 * other than 'pro' as Core-equivalent (no branding), but with this
 * literal narrowing no new 'core' values should appear.
 */
export type Plan = 'pro';

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
   *  attribution on invoices and job cards. */
  createdByUid?: string;
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
