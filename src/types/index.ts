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
  /** When the job was marked paid. ISO timestamp. */
  paidAt?: string;
  /** How the payment was collected. Set by the Mark Paid action. */
  paymentMethod?: PaymentMethod;
  /** Future-ready: partial-payment / deposit / refund tracking. None of
   *  these are written today — they exist so the schema doesn't need a
   *  breaking migration when partial-payment UI ships. */
  amountPaid?: number;
  balanceDue?: number;
  paymentHistory?: PaymentEvent[];
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
  createdByUid?: string;
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
  multiTirePricing?: MultiTirePricing;
  invoicePricingStyle?: 'transparent' | 'single';
  plan?: Plan;
  subscriptionStatus?: SubscriptionStatus;
  trialStartedAt?: string;
  trialEndsAt?: string;
  maxUsers?: number;
  allowTechnicianPriceOverride?: boolean;
  featureFlags?: FeatureFlags;
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

export type PaymentMethod = 'Cash' | 'Zelle' | 'Cash App' | 'Card' | 'Other';

/**
 * Forward-ready payment event for partial-payments/deposits/refunds.
 * Not consumed by current UI — the `paymentStatus` + `paidAt` +
 * `paymentMethod` fields drive everything today. Existence here lets us
 * append events without a breaking schema change later.
 */
export interface PaymentEvent {
  at: string;
  amount: number;
  method: PaymentMethod;
  kind: 'payment' | 'deposit' | 'refund';
  note?: string;
}


export interface MultiTirePricing {
  replacementMultipliers: { two: number; three: number; four: number };
  installationByQuantity: { one: number; two: number; three: number; four: number };
}

export type Plan = 'core' | 'pro';
export type SubscriptionStatus = 'trialing' | 'active' | 'inactive' | 'past_due' | 'canceled';
export type Role = 'owner' | 'admin' | 'technician';
export type MemberStatus = 'active' | 'invited' | 'disabled';

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

export interface FeatureFlags {
  teamAccess?: boolean;
  technicianRoles?: boolean;
  advancedReports?: boolean;
  prioritySupport?: boolean;
}
