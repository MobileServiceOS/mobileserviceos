// ═══════════════════════════════════════════════════════════════════
//  Mobile Service OS — Canonical Type System
// ═══════════════════════════════════════════════════════════════════
//
//  This file is the single source of truth for shared types across
//  the application. Components, contexts, hooks, and library code
//  MUST import their type definitions from here (`@/types`) rather
//  than defining their own.
//
//  Consolidation philosophy:
//    - Additive only. No existing field has been renamed or removed.
//    - All new fields are optional so existing Firestore documents
//      remain readable without migration.
//    - PaymentMethod, Plan, Permissions, MemberDoc, TeamRole are NEW
//      canonical exports introduced for the member/billing system.
//
//  Compatibility notes for callers reading this file:
//    - `Job.payment: string`        — legacy free-text method, kept
//    - `Job.paymentMethod?: ...`    — new canonical union, optional
//      Either is acceptable on read. New code should write
//      `paymentMethod`; old code reading `payment` continues to work.
//
// ═══════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────
//  Status / enum types
// ─────────────────────────────────────────────────────────────────────

export type PaymentStatus = 'Paid' | 'Pending Payment' | 'Partial Payment' | 'Cancelled';
export type JobStatus = 'Completed' | 'Pending' | 'Cancelled';
export type TireSource = 'Inventory' | 'Bought for this job' | 'Customer supplied';

/**
 * Canonical payment method union. Use this when you want a typed
 * dropdown / pill picker. Lowercase identifiers so they're safe to use
 * as Firestore field values, query keys, and CSS class suffixes.
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
 * Lifecycle state of a team member document. Invites are written with
 * `status: 'invited'` and flip to 'active' on first sign-in (Cloud
 * Functions side, future batch). 'inactive' means revoked but kept for
 * historical attribution.
 */
export type MemberStatus = 'invited' | 'active' | 'inactive';

/**
 * Firestore document shape for `businesses/{bid}/members/{uid}`.
 * Indexed by the member's auth uid once active. Pre-acceptance invites
 * are keyed by email-hash (Cloud Functions resolve on signup).
 */
export interface MemberDoc {
  /** Auth uid once the user has accepted. Empty for pending invites. */
  uid: string;
  /** Display name shown on job cards / invoices for technician attribution. */
  displayName: string;
  /** Email — the canonical identifier for invites before signup. */
  email: string;
  /** Role inside this business. Owners are seeded automatically. */
  role: TeamRole;
  /** Lifecycle state. See MemberStatus comments. */
  status: MemberStatus;
  /** ISO timestamp the invite was created (owner clicked "invite"). */
  invitedAt?: string;
  /** ISO timestamp the user accepted and was promoted to active. */
  acceptedAt?: string;
  /** Auth uid of the owner/admin who sent the invite. */
  invitedByUid?: string;
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
