export type PaymentStatus = 'Paid' | 'Pending Payment' | 'Partial Payment' | 'Cancelled';
export type JobStatus = 'Completed' | 'Pending' | 'Cancelled';
export type TireSource = 'Inventory' | 'Bought for this job' | 'Customer supplied';

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
}

export interface ServicePricing {
  enabled: boolean;
  basePrice: number;
  minProfit: number;
}

export interface VehiclePricing {
  addOnProfit: number;
}

export interface Expense {
  id: string;
  name: string;
  amount: number;
  active: boolean;
}

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

export interface Job {
  id: string;
  date: string;
  service: string;
  vehicleType: string;
  area: string;
  payment: string;
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
}

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

  // ── Multi-tire pricing (nested object — utils.ts reads it this shape) ──
  multiTirePricing?: MultiTirePricing;

  // ── Invoice rendering style ──
  invoicePricingStyle?: 'transparent' | 'single';

  // ── Plan + subscription + team placeholders (Stripe not wired yet) ──
  plan?: Plan;
  subscriptionStatus?: SubscriptionStatus;
  trialEndsAt?: string;
  maxUsers?: number;
  allowTechnicianPriceOverride?: boolean;
  featureFlags?: FeatureFlags;
}

/**
 * Multi-tire pricing controls.
 *
 * `replacementMultipliers.{two,three,four}` scales target profit when
 * replacing multiple tires (sub-linear by default — labor is more efficient
 * per-tire when already on-site).
 *
 * `installationByQuantity.{one,two,three,four}` is the flat labor charge
 * when the customer supplies the tires. The 4-tire $220 default is the
 * industry anchor for mobile install.
 */
export interface MultiTirePricing {
  replacementMultipliers: {
    two: number;
    three: number;
    four: number;
  };
  installationByQuantity: {
    one: number;
    two: number;
    three: number;
    four: number;
  };
}

/**
 * Plan tier for a business. Drives team-management gating; does NOT replace
 * the fine-grained per-role permissions in `lib/permissions.ts`.
 *   • core — solo operator, 1 user, all core features
 *   • pro  — multi-user team access + advanced reports
 */
export type Plan = 'core' | 'pro';

export type SubscriptionStatus = 'trialing' | 'active' | 'inactive';

/**
 * Role of a member within a business.
 *   • owner      — full access; at least one must always exist per business
 *   • admin      — full operational access except billing + can't remove owner
 *   • technician — field worker; limited to job logging + quoting, no
 *                  financials, no settings
 */
export type Role = 'owner' | 'admin' | 'technician';

export type MemberStatus = 'active' | 'invited' | 'disabled';

/**
 * Document at `businesses/{businessId}/members/{uid}`.
 *
 * For pending invites the uid may be a placeholder until the invitee signs up,
 * at which point the accept-invite flow swaps it for the real auth uid.
 * `permissions` is an OPTIONAL per-user override on top of the role defaults
 * — leave undefined for standard role-based access.
 */
export interface MemberDoc {
  uid: string;
  email: string;
  displayName?: string;
  role: Role;
  status: MemberStatus;
  invitedBy?: string;
  invitedAt?: string;
  joinedAt?: string;
  permissions?: Partial<Permissions>;
  assignedBusinessId: string;
}

/**
 * Per-user/per-business permission set. Use through `getPermissions()` in
 * `lib/permissions.ts` rather than constructing directly — the helper
 * applies role defaults, plan caps, and business overrides.
 *
 * All permissions default to FALSE so a missing/invalid role can never
 * accidentally grant access.
 */
export interface Permissions {
  canViewFinancials: boolean;
  canViewRevenue: boolean;
  canViewProfit: boolean;
  canManageExpenses: boolean;
  canManageInventory: boolean;
  canEditPricingSettings: boolean;
  canViewPricingSettings: boolean;
  canUsePricingEngine: boolean;
  canOverrideJobPrice: boolean;
  canManageTeam: boolean;
  canEditBusinessSettings: boolean;
  canUploadLogo: boolean;
  canGenerateInvoices: boolean;
  canSendReviews: boolean;
  canCreateJobs: boolean;
  canEditJobs: boolean;
  canDeleteJobs: boolean;
  canViewAdvancedReports: boolean;
  canManageBilling: boolean;
}

/** Feature flag bag — tenant-level toggles. */
export interface FeatureFlags {
  advancedReports?: boolean;
  prioritySupport?: boolean;
}

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

export type ToastType = 'success' | 'warn' | 'error' | 'info';

export interface ToastItem {
  id: string;
  msg: string;
  type: ToastType;
  ts: number;
}

export type SyncStatus = 'local' | 'syncing' | 'connected' | 'offline' | 'sync_failed';
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
