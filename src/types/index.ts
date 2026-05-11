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
   * Pricing controls for multi-tire jobs. The `utils.ts` `calcQuote` function
   * reads this as a nested object (e.g. `settings.multiTirePricing
   * .replacementMultipliers.two`) so the shape MUST stay nested. If you want
   * flat field names later, that's a refactor across utils.ts + AddJob +
   * Dashboard + Settings — not a type-only change.
   *
   *   replacementMultipliers.{two,three,four}  multiplies target profit
   *     when replacing 2/3/4 tires in one job. Default 1.6 / 2.0 / 2.4.
   *
   *   installationByQuantity.{one,two,three,four}  flat labor price when the
   *     customer supplies the tires. Default 60 / 110 / 165 / 220.
   *     The 4-tire $220 is the industry anchor.
   */
  multiTirePricing?: MultiTirePricing;

  /**
   * Invoice line-item layout for customer-facing PDFs.
   *   • 'transparent' — split Tire Replacement into Tire / Mobile Service &
   *     Dispatch / Mounting & Balancing (travel cost absorbed into dispatch).
   *   • 'single'      — print the service as one combined line.
   *
   * The codebase reads this as a string literal union. Default 'transparent'.
   */
  invoicePricingStyle?: 'transparent' | 'single';
}

/**
 * Nested type referenced from Settings.multiTirePricing.
 *
 * Why nested rather than flat? Two reasons:
 *   1. Existing pricing logic in `utils.ts` reads the nested form
 *      (`.replacementMultipliers.two`, `.installationByQuantity.four`).
 *   2. Grouping multipliers vs installation prices makes intent clearer
 *      and lets us add per-group settings later without flattening more.
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
