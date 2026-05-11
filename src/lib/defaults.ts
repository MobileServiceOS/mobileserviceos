import type { Brand, Settings, Job, ServicePricing, VehiclePricing, PaymentStatus, MultiTirePricing } from '@/types';

export const APP_LOGO = 'icons/icon-rounded-192.png';

export const FALLBACK_LOGO_SVG = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80"><rect width="80" height="80" rx="18" fill="#0a0a0f"/><circle cx="40" cy="40" r="22" fill="none" stroke="#c8a44a" stroke-width="3"/><circle cx="40" cy="40" r="8" fill="#c8a44a"/></svg>'
)}`;

export const DEFAULT_BRAND: Brand = {
  businessName: 'Mobile Service OS',
  logoUrl: '',
  primaryColor: '#c8a44a',
  accentColor: '#e5c770',
  phone: '',
  email: '',
  website: '',
  reviewUrl: '',
  invoiceFooter: '',
  serviceArea: '',
  businessType: 'Mobile Tire & Roadside',
  tagline: '',
  state: '',
  mainCity: '',
  fullLocationLabel: '',
  serviceCities: [],
  serviceRadius: 25,
  onboardingComplete: false,
  onboardingCompletedAt: null,
};

// Tire & roadside service catalog only — no unrelated business types.
export const DEFAULT_SERVICE_PRICING: Record<string, ServicePricing> = {
  'Flat Tire Repair':         { enabled: true,  basePrice: 90,  minProfit: 90 },
  'Tire Replacement':         { enabled: true,  basePrice: 120, minProfit: 110 },
  'Tire Installation':        { enabled: true,  basePrice: 120, minProfit: 110 },
  'Mounting & Balancing':     { enabled: true,  basePrice: 100, minProfit: 80 },
  'Spare Tire Installation':  { enabled: true,  basePrice: 95,  minProfit: 70 },
  'Tire Rotation':            { enabled: true,  basePrice: 80,  minProfit: 60 },
  'Wheel Lock Removal':       { enabled: true,  basePrice: 85,  minProfit: 65 },
  'Roadside Tire Assistance': { enabled: true,  basePrice: 100, minProfit: 70 },
  'Mobile Tire Service':      { enabled: true,  basePrice: 150, minProfit: 110 },
  'Fleet Tire Service':       { enabled: false, basePrice: 200, minProfit: 160 },
  'Heavy-Duty Tire Service':  { enabled: false, basePrice: 350, minProfit: 280 },
};

export const DEFAULT_VEHICLE_PRICING: Record<string, VehiclePricing> = {
  'Car':             { addOnProfit: 0 },
  'SUV / Truck':     { addOnProfit: 20 },
  'Van':             { addOnProfit: 20 },
  'Commercial Van':  { addOnProfit: 40 },
  'Box Truck':       { addOnProfit: 60 },
  'Semi-Truck':      { addOnProfit: 80 },
  'Tractor-Trailer': { addOnProfit: 120 },
  'Trailer':         { addOnProfit: 30 },
};

/**
 * Default multi-tire pricing. Sub-linear replacement multipliers because
 * labor scales sub-linearly per additional tire (truck setup happens once).
 * 4-tire installation anchors at $220 — industry-typical mobile install.
 */
export const DEFAULT_MULTI_TIRE: MultiTirePricing = {
  replacementMultipliers: { two: 1.6, three: 2.0, four: 2.4 },
  installationByQuantity: { one: 60, two: 110, three: 165, four: 220 },
};

export const DEFAULT_SETTINGS: Settings = {
  businessName: 'My Business',
  owner1Name: 'Owner 1',
  owner2Name: 'Owner 2',
  owner1Active: true,
  owner2Active: true,
  profitSplit1: 50,
  profitSplit2: 50,
  weeklyGoal: 1500,
  taxRate: 25,
  costPerMile: 0.65,
  defaultTargetProfit: 100,
  invoiceTaxRate: 0,
  servicePricing: DEFAULT_SERVICE_PRICING,
  vehiclePricing: DEFAULT_VEHICLE_PRICING,
  expenses: [],
  freeMilesIncluded: 5,
  tireRepairTargetProfit: 90,
  tireReplacementTargetProfit: 110,

  // Multi-tire + invoice rendering
  multiTirePricing: DEFAULT_MULTI_TIRE,
  invoicePricingStyle: 'transparent',

  // Plan + team placeholders (no Stripe wiring yet)
  plan: 'core',
  subscriptionStatus: 'inactive',
  maxUsers: 5,
  allowTechnicianPriceOverride: false,
  featureFlags: {},
};

export const SERVICE_PHRASES: Record<string, string> = {
  'Flat Tire Repair': 'flat tire repair',
  'Tire Replacement': 'tire replacement',
  'Tire Installation': 'tire installation',
  'Mounting & Balancing': 'mounting and balancing',
  'Spare Tire Installation': 'spare tire installation',
  'Tire Rotation': 'tire rotation',
  'Wheel Lock Removal': 'wheel lock removal',
  'Roadside Tire Assistance': 'roadside tire assistance',
  'Mobile Tire Service': 'mobile tire service',
  'Fleet Tire Service': 'fleet tire service',
  'Heavy-Duty Tire Service': 'heavy-duty tire service',
};

export const SERVICE_ICONS: Record<string, string> = {
  'Flat Tire Repair': '🔧',
  'Tire Replacement': '🛞',
  'Tire Installation': '🛞',
  'Mounting & Balancing': '⚙️',
  'Spare Tire Installation': '🛞',
  'Tire Rotation': '🔄',
  'Wheel Lock Removal': '🔓',
  'Roadside Tire Assistance': '🚨',
  'Mobile Tire Service': '🚐',
  'Fleet Tire Service': '🚛',
  'Heavy-Duty Tire Service': '🚜',
};

export const PAYMENT_STATUSES: PaymentStatus[] = ['Paid', 'Pending Payment', 'Partial Payment', 'Cancelled'];

export const TIRE_MATERIAL_SERVICES = [
  'Tire Replacement',
  'Tire Installation',
  'Mounting & Balancing',
  'Mobile Tire Service',
  'Fleet Tire Service',
  'Heavy-Duty Tire Service',
];

export const LEAD_SOURCES = ['Google', 'Yelp', 'Referral', 'Repeat', 'Facebook', 'Instagram', 'TikTok', 'Thumbtack', 'Other'];
export const PAYMENT_METHODS = ['Cash', 'Zelle', 'CashApp', 'Venmo', 'Card', 'Check', 'Other'];
export const TIRE_SOURCES = ['Inventory', 'Bought for this job', 'Customer supplied'];

export const TODAY = (): string =>
  new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

export const EMPTY_JOB = (): Job => ({
  id: '',
  date: TODAY(),
  service: 'Flat Tire Repair',
  vehicleType: 'Car',
  area: '',
  payment: 'Cash',
  status: 'Completed',
  source: 'Google',
  customerName: '',
  customerPhone: '',
  tireSize: '',
  qty: 1,
  revenue: '',
  tireCost: '',
  materialCost: '',
  miscCost: '',
  miles: '',
  note: '',
  emergency: false,
  lateNight: false,
  highway: false,
  weekend: false,
  tireSource: 'Inventory',
  tireBrand: '',
  tireModel: '',
  tireVendor: '',
  tirePurchasePrice: '',
  tireCondition: '',
  tireReceiptUrl: '',
  tireNotes: '',
  inventoryDeductions: null,
  inventoryUsed: null,
  paymentStatus: 'Paid',
  invoiceGenerated: false,
  invoiceGeneratedAt: null,
  invoiceNumber: null,
  invoiceSent: false,
  invoiceSentAt: null,
  reviewRequested: false,
  reviewRequestedAt: null,
  lastEditedAt: null,
  city: '',
  state: '',
  fullLocationLabel: '',
});
