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
 * Subscription tier. Drives feature gating (team management, advanced
 * reports, etc). Settings.plan defaults to 'core' when unset.
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
  /** Primary business this member belongs to. Always required so
   *  rules can scope reads. */
  businessId: string;
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
   * Subscription tier for this business. Drives feature gating in
   * MembershipContext (team management, advanced reports). Defaults to
   * 'core' at runtime when unset on the Firestore document.
   */
  plan?: Plan;
  /**
   * Stripe-aligned subscription state. 'trialing' during free trial,
   * 'active' once paying, 'past_due' on failed renewal, 'canceled'
   * after explicit cancel, 'inactive' for pre-Stripe accounts.
   */
  subscriptionStatus?: SubscriptionStatus;
  /** When the free trial began. Stamped on first Pro upgrade attempt. */
  trialStartedAt?: Timestamp | Date | string;
  /** When the free trial ends. Cloud Function reads this to flip
   *  subscriptionStatus → past_due / canceled if no payment by then. */
  trialEndsAt?: Timestamp | Date | string;
  /**
   * Plan-determined member cap. Set by Cloud Function on plan change.
   * UI uses this to disable invite-new-member when at capacity.
   */
  maxUsers?: number;
  /**
   * Owner-set flag: whether technicians on this business are allowed to
   * manually override the system-suggested revenue on jobs they log.
   * Pricing settings themselves remain owner-only either way.
   */
  allowTechnicianPriceOverride?: boolean;
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
