import type { Brand, Settings, Job, ServicePricing, VehiclePricing, PaymentStatus, JobStatus } from '@/types';
import { TIRE_CONFIG } from '@/config/businessTypes/tire';
import { servicePricingFromVertical } from '@/lib/verticals';

export const APP_LOGO = 'icons/icon-rounded-192.png';

export const FALLBACK_LOGO_SVG = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80"><rect width="80" height="80" rx="18" fill="#0a0a0f"/><circle cx="40" cy="40" r="22" fill="none" stroke="#f4b400" stroke-width="3"/><circle cx="40" cy="40" r="8" fill="#f4b400"/></svg>'
)}`;

/**
 * Default outbound review-request SMS body. 7 placeholders, smart-empty
 * stripped (see src/lib/reviewTemplate.ts). Operator can edit in
 * Settings → Review Automation → Template editor.
 *
 * Spec: docs/superpowers/specs/2026-06-03-sp4a-review-automation-design.md
 *       §"Template engine — Default template"
 */
export const DEFAULT_REVIEW_TEMPLATE =
  'Hi {firstName}, thanks for choosing {businessName} for your {serviceType} in {city}. ' +
  'We’d appreciate a quick Google review: {reviewLink}';

/**
 * Default outbound SMS body sent on missed-call auto-text.
 * Uses ONLY {businessName} — no {firstName} — because the caller
 * may be an unknown customer at first touch; "Hi , thanks..." would
 * read awkwardly. Operators who only serve repeat customers can edit
 * to include {firstName} in Settings → Missed Call Recovery.
 *
 * Spec: docs/superpowers/specs/2026-06-04-sp4b-missed-call-recovery-design.md
 *       §"Template engine — DEFAULT_MISSED_CALL_TEMPLATE"
 */
export const DEFAULT_MISSED_CALL_TEMPLATE =
  'Hi, thanks for contacting {businessName}.\n\n' +
  'Please reply with:\n\n' +
  '1. Your location\n' +
  '2. Vehicle\n' +
  '3. Tire size (if known)\n' +
  '4. Service needed\n\n' +
  "We'll get back to you shortly.";

export const DEFAULT_BRAND: Brand = {
  businessName: 'Mobile Service OS',
  logoUrl: '',
  primaryColor: '#f4b400',
  accentColor: '#f7ca4d',
  phone: '',
  email: '',
  website: '',
  reviewUrl: '',
  invoiceFooter: '',
  serviceArea: '',
  // Vertical KEY, not display string. Previously the legacy display
  // label was here; that pre-dated the multi-vertical key/displayName
  // separation and silently leaked the wrong shape into the bootstrap
  // path (BrandContext writes DEFAULT_BRAND for a brand-new signup,
  // then Onboarding.finish() overwrites with the picker's chosen
  // key). resolveVerticalKey already maps the legacy string back to
  // 'tire', so this rename has no behavioral impact on existing docs
  // — but new bootstraps now write the canonical key from second one.
  businessType: 'tire',
  tagline: '',
  state: '',
  mainCity: '',
  fullLocationLabel: '',
  serviceCities: [],
  serviceRadius: 25,
  onboardingComplete: false,
  onboardingCompletedAt: null,
};

/**
 * @deprecated Read service pricing from the active business type's
 *   config via `useActiveVertical().services` (UI) or
 *   `getBusinessTypeConfig(key).services` (engines). Operator-edited
 *   prices come from `settings.servicePricing` on the business doc.
 *
 *   This constant is retained for back-compat with consumers that
 *   haven't migrated yet (Dashboard / AddJob fallback maps,
 *   DEFAULT_SETTINGS below, and deserializers.ts merge/strip
 *   helpers). It is now DERIVED from TIRE_CONFIG via
 *   servicePricingFromVertical(), so any future change to tire's
 *   service catalog automatically propagates here.
 *
 *   Phase 2.1 wired the new readers to vertical config directly;
 *   this constant is on a deprecation timer.
 */
export const DEFAULT_SERVICE_PRICING: Record<string, ServicePricing> =
  servicePricingFromVertical(TIRE_CONFIG);

/**
 * @deprecated Vehicle add-on pricing is a flat-pricing-model concept
 *   (tire vertical only). Mechanic and detailing pricing engines
 *   don't use a per-vehicle add-on field — mechanic flows pricing
 *   through labor + parts + diagnostic + travel, detailing through
 *   package + vehicle-size multiplier.
 *
 *   Tire businesses' operator-edited values live on
 *   `settings.vehiclePricing`. This constant is the seed shape used
 *   when no settings doc exists yet (DEFAULT_SETTINGS) and the
 *   fallback inside the flat pricing engine. It is retained for
 *   back-compat with consumers (Dashboard / AddJob Quick Quote
 *   dropdown, createBusiness initial seed) that haven't migrated to
 *   reading from `TIRE_CONFIG.pricingModel` directly.
 *
 *   Slated for relocation onto FlatPricingModel in a future phase.
 */
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
  // Phase 2.2 mechanic-related defaults
  laborRate: 95,
  lowStockThreshold: 2,
  partsMarkupDefault: 1.5,
  warrantyPolicy: '',
  // ─── Customer Directory (SP1 schema; UI in SP3) ──────────────────
  autoSaveCustomersFromJobs: true,
  // ─── Communications (SP1 schema; UI in SP4) ──────────────────────
  communicationProvider: 'twilio',
  twilioConnected: false,
  incomingCallLookupEnabled: true,
  incomingSMSLoggingEnabled: true,
  missedCallAutoTextEnabled: false,
  outboundSMSEnabled: true,
  outboundCommunicationProvider: 'native',
  // ─── Review Automation (SP4A) ─ ships OFF, operator opts in ──────
  reviewAutomationEnabled: false,
  reviewSmsTemplate: DEFAULT_REVIEW_TEMPLATE,
  reviewDelayMinutes: 0,
  googleReviewLink: '',
  // ─── Missed Call Recovery (SP4B) ─ ships OFF, operator opts in ───
  twilioPhoneNumber: '',
  missedCallTemplate: DEFAULT_MISSED_CALL_TEMPLATE,
  // missedCallAutoTextEnabled already defaulted false in SP1
  // twilioPhoneNumberSid left undefined (optional debug field)
};

export const SERVICE_PHRASES: Record<string, string> = {
  'Flat Tire Repair': 'flat tire repair',
  'Tire Replacement': 'tire replacement',
  'Tire Installation': 'tire installation',
  'Mounting & Balancing': 'mounting and balancing',
  'Spare Tire Installation': 'spare tire installation',
  'Spare Change': 'spare change',
  'Tire Rotation': 'tire rotation',
  'Wheel Lock Removal': 'wheel lock removal',
  'Roadside Tire Assistance': 'roadside tire assistance',
  'Mobile Tire Service': 'mobile tire service',
  'Jump Start': 'jump start',
  'Fuel Delivery': 'fuel delivery',
  'Lockout': 'lockout',
  'Fleet Tire Service': 'fleet tire service',
  'Heavy-Duty Tire Service': 'heavy-duty tire service',
};

export const SERVICE_ICONS: Record<string, string> = {
  'Flat Tire Repair': '🔧',
  'Tire Replacement': '🛞',
  'Tire Installation': '🛞',
  'Mounting & Balancing': '⚙️',
  'Spare Tire Installation': '🛞',
  'Spare Change': '🔁',
  'Tire Rotation': '🔄',
  'Wheel Lock Removal': '🔓',
  'Roadside Tire Assistance': '🚨',
  'Mobile Tire Service': '🚐',
  'Jump Start': '🔋',
  'Fuel Delivery': '⛽',
  'Lockout': '🔑',
  'Fleet Tire Service': '🚛',
  'Heavy-Duty Tire Service': '🚜',
};

export const PAYMENT_STATUSES: PaymentStatus[] = ['Paid', 'Pending Payment', 'Partial Payment', 'Cancelled'];
export const JOB_STATUSES: JobStatus[] = ['Completed', 'Pending', 'Cancelled'];

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
