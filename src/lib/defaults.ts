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
// Seed value for new-tenant Settings + Review Automation preview pane.
// Operators see this as the editable starter template. When the
// reviewSmsTemplate field is LEFT EMPTY, the server picks at random
// from DEFAULT_REVIEW_TEMPLATES (see reviewTemplate.ts) per send so
// consecutive auto-texts don't read byte-identical. This constant
// matches DEFAULT_REVIEW_TEMPLATES[0] — operator's V1.
export const DEFAULT_REVIEW_TEMPLATE =
  `Hi {firstName}, thank you for choosing {businessName} for your {serviceType} service in {city}. If you were happy with the service today, we'd appreciate a quick Google review:

{reviewLink}

Your feedback helps other drivers find reliable mobile tire service when they need it most.`;

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

// Real service area, pulled from actual job history. Used as the default
// service-cities list (and the BrandContext fallback when a business hasn't
// set its own) so the Settings field is pre-populated rather than blank.
export const DEFAULT_SERVICE_CITIES: string[] = [
  'Miami', 'West Park', 'Hollywood', 'Miramar', 'Aventura', 'Fort Lauderdale',
  'Miami Gardens', 'Hialeah', 'Tamiami', 'North Miami Beach', 'North Miami',
  'Hallandale Beach', 'Plantation', 'Sunrise', 'Davie', 'Doral', 'Tamarac',
  'Coconut Creek', 'North Lauderdale', 'Kendall', 'Brickell', 'Miami Lakes',
  'Miami Beach',
];

/** Coalesce a stored brand to the product defaults: a blank tagline becomes
 *  the default tagline and an empty service-cities list becomes the default
 *  service area, so both render (header / invoice / Settings) even for
 *  businesses whose stored brand predates these defaults. A business that
 *  set its own non-blank tagline / non-empty cities keeps them. */
export function resolveBrandDefaults(brand: Brand): Brand {
  return {
    ...brand,
    tagline: (brand.tagline || '').trim() || DEFAULT_BRAND.tagline,
    serviceCities: (brand.serviceCities && brand.serviceCities.length)
      ? brand.serviceCities
      : DEFAULT_BRAND.serviceCities,
  };
}

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
  tagline: 'We rush. You roll.',
  state: '',
  mainCity: '',
  fullLocationLabel: '',
  serviceCities: DEFAULT_SERVICE_CITIES,
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
// Batch C (2026-06-05): seed order is Sedan → SUV → Truck → Van first,
// then heavier rigs in capacity order, per the Add Job audit (D5).
// Existing tenants keep whatever order they've already persisted to
// settings.vehiclePricing — only fresh-deploy tenants see this seed.
//
// Key change vs. the prior seed: 'Car' renamed to 'Sedan', and the
// combined 'SUV / Truck' split into 'SUV' + 'Truck' so the top of the
// chip-grid matches the spec exactly. AddOn profits are kept aligned
// (Truck/SUV stay at the prior $20 SUV/Truck shared rate).
export const DEFAULT_VEHICLE_PRICING: Record<string, VehiclePricing> = {
  'Sedan':           { addOnProfit: 0 },
  'SUV':             { addOnProfit: 20 },
  'Truck':           { addOnProfit: 20 },
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

export const PAYMENT_STATUSES: PaymentStatus[] = ['Paid', 'Pending Payment', 'Partial Payment', 'Refunded', 'Cancelled'];
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
  // Batch C (2026-06-05): EMPTY_JOB.vehicleType matches the new
  // DEFAULT_VEHICLE_PRICING top key (was 'Car'). Tenants that don't
  // touch vehicle pricing get a 'Sedan'-defaulted draft.
  vehicleType: 'Sedan',
  area: '',
  // Payment is collected as a deliberate step, not assumed at logging.
  // Leave the legacy free-text method empty (no method until paid) and
  // start every job unpaid — see paymentStatus below.
  payment: '',
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
  // Every new job is born unpaid. The operator collects payment as an
  // explicit step (Mark Paid), or marks it paid on the spot via the
  // Payment Status chips in the New Job form.
  paymentStatus: 'Pending Payment',
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
