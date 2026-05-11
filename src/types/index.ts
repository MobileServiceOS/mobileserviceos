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

  /**
   * Plan tier. `core` = solo operator, `pro` = team-enabled.
   * Drives feature gating and team-size limits. Future Stripe integration
   * will set this from a webhook; for now it's manually set or defaults to
   * `core` for new tenants.
   */
  plan?: Plan;

  /**
   * Subscription lifecycle status. Placeholder for future Stripe integration.
   * `trialing` = on free trial, `active` = paying, `inactive` = canceled or
   * never subscribed. Does NOT lock any features today — purely informational
   * until paywall is wired.
   */
  subscriptionStatus?: SubscriptionStatus;

  /**
   * ISO date when the trial ends. Placeholder for future use.
   */
  trialEndsAt?: string;

  /**
   * Maximum team members allowed under the current plan.
   *   • Core: 1 (owner only)
   *   • Pro:  5 by default
   * Owner can be added without consuming a seat.
   */
  maxUsers?: number;

  /**
   * Toggle that lets technicians override the suggested revenue on a job
   * they're working. Off by default — protects margins. Owner can flip it
   * on per business in Settings.
   */
  allowTechnicianPriceOverride?: boolean;

  /**
   * Feature flag bag. Placeholders only — actual gating is enforced by the
   * permissions helper. Stored here so it can be toggled per-tenant later.
   */
  featureFlags?: FeatureFlags;
}

/**
 * Plan tier for a business. The plan controls coarse-grained feature
 * availability (team management, multiple users) but does NOT replace the
 * fine-grained per-role permissions in `permissions.ts`.
 */
export type Plan = 'core' | 'pro';

export type SubscriptionStatus = 'trialing' | 'active' | 'inactive';

/**
 * Role of a member within a business.
 *   • `owner`      — full access, cannot be removed if last owner
 *   • `admin`      — full operational access, cannot remove owner
 *   • `technician` — field worker; limited to job logging + quoting,
 *                    no financials, no settings
 */
export type Role = 'owner' | 'admin' | 'technician';

export type MemberStatus = 'active' | 'invited' | 'disabled';

/**
 * Document stored at `businesses/{businessId}/members/{uid}`.
 *
 * For invited users who haven't signed up yet, `uid` is the pending invite
 * key (typically a generated id), `email` is the inviter-supplied address,
 * and `status` is 'invited'. When the user signs up with that email, the
 * accept flow swaps the placeholder uid for the real auth uid.
 *
 * `permissions` is OPTIONAL — when present, it overrides the role default.
 * Most members use role defaults; the override is for fine-tuning per-user.
 */
export interface MemberDoc {
  uid: string;
  email: string;
  displayName?: string;
  role: Role;
  status: MemberStatus;
  invitedBy?: string;   // uid of the inviter
  invitedAt?: string;   // ISO
  joinedAt?: string;    // ISO — set when invite is accepted
  permissions?: Partial<Permissions>;
  assignedBusinessId: string;
}

/**
 * Per-user/per-business permission set. Use through `getPermissions()` in
 * `lib/permissions.ts` rather than constructing directly — the helper
 * applies role defaults, business plan, and feature flags.
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

/**
 * Feature flags — tenant-level toggles. Empty bag for now; populated as we
 * add experimental features.
 */
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
