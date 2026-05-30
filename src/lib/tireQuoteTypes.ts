// ─────────────────────────────────────────────────────────────────────
//  src/lib/tireQuoteTypes.ts — Tire Quote Engine type definitions
//
//  Phase 1 of the Tire Quote Engine feature. Consolidates every type
//  the engine needs (supplier prices, quotes, settings, search input)
//  in one module so they can be imported without pulling the entire
//  src/types/index.ts surface.
//
//  Path-based tenant isolation: every collection in MSOS lives under
//  `businesses/{businessId}/...` — same boundary used by jobs,
//  inventory, expenses, settings. We do NOT add a redundant
//  `businessId` field to each doc because the path already scopes it.
//
//  Pure types only — no React, no Firestore. Tree-shakeable.
// ─────────────────────────────────────────────────────────────────────

// ─── Supplier names ────────────────────────────────────────────────
// Default 5 suppliers per the Phase 1 spec, plus per-business
// free-form custom names (a string union catch-all). Each business
// can extend their own supplier list without touching the type.

export const DEFAULT_SUPPLIER_NAMES = [
  'ATD',
  'Advance Tire',
  'U.S. AutoForce',
  'Used Inventory',
  'Manual Entry',
] as const;

export type DefaultSupplierName = (typeof DEFAULT_SUPPLIER_NAMES)[number];

/** Supplier label on a tire price record. Locked-in defaults + any
 *  free-form custom name an operator types. Per-business; one
 *  business's "Discount Tire" is opaque to another. */
export type TireSupplierName = DefaultSupplierName | (string & {});

// ─── Categorical types ─────────────────────────────────────────────

/** Quality tier — drives the Good/Better/Best picker + per-tier
 *  profit target lookup. */
export type TireCategory = 'budget' | 'midrange' | 'premium';

/** Tire physical condition. Used tires get a separate (lower)
 *  profit target than new tires. */
export type TireCondition = 'new' | 'used';

/** Urgency tier — drives same-day / emergency / after-hours fees.
 *  'standard' is the no-fee default. */
export type Urgency = 'standard' | 'same-day' | 'emergency' | 'after-hours';

/** The kind of work the customer is asking about. Influences the
 *  service field on the converted Job. Phase 4 maps these to the
 *  tire vertical's service catalog entries. */
export type QuoteServiceType =
  | 'replacement'
  | 'used_tire'
  | 'new_tire'
  | 'emergency_replacement';

/** Quote lifecycle. 'convertedToJob' is the terminal happy path —
 *  the quote became a real job. */
export type QuoteStatus =
  | 'draft'
  | 'sent'
  | 'accepted'
  | 'declined'
  | 'convertedToJob';

/** How the quote entered MSOS. Drives funnel analytics in later
 *  phases. 'admin' = built in-app by owner/admin without a customer
 *  on the line. */
export type QuoteSource =
  | 'phone'
  | 'website'
  | 'sms'
  | 'admin'
  | 'manual';

/** Customer price rounding — psychological 9-pricing (eg. $79) is
 *  the default; 5 and 10 round to flat values. */
export type RoundPriceTo = 5 | 9 | 10;

// ─── Search input — future-proof tagged union ───────────────────────
//
// Phase 1 only implements `kind: 'size'`. Other variants are typed
// now so Phase 1's persistence layer + Firestore docs can store
// future search shapes without a schema migration. Exhaustiveness
// tests (tests/tireQuoteTypes.test.ts) verify TypeScript catches
// any new variant added later if its handler is missing.
//
// Why a tagged union: a flat optional-field bag ("maybe tireSize?
// maybe vin? maybe vehicleYear?") loses the invariant that exactly
// one search method is in play. Discriminated union forces callers
// to handle each case.

export type QuoteSearchInput =
  | { kind: 'size'; tireSize: string; brand?: string; model?: string }
  | { kind: 'brandModel'; brand: string; model: string }
  | { kind: 'vin'; vin: string }
  | { kind: 'photo'; storageRef: string }
  | { kind: 'vehicle'; year: number; make: string; vehicleModel: string }
  | { kind: 'plate'; plate: string; state: string };

export type QuoteSearchKind = QuoteSearchInput['kind'];

/** Convenience type listing every search kind. Used by exhaustiveness
 *  tests so an added variant fails CI until handled. */
export const ALL_QUOTE_SEARCH_KINDS: ReadonlyArray<QuoteSearchKind> = [
  'size',
  'brandModel',
  'vin',
  'photo',
  'vehicle',
  'plate',
];

// ─── Supplier price record ─────────────────────────────────────────
//
// Stored at: businesses/{businessId}/tireSupplierPrices/{id}
//
// `cost` is wholesale (owner/admin only — UI client-side mask).
// `quantityAvailable` lets the picker skip out-of-stock options.

export interface TireSupplierPrice {
  /** Firestore doc id. */
  id: string;
  /** Supplier label (one of DEFAULT_SUPPLIER_NAMES or a custom). */
  supplierName: TireSupplierName;
  /** Canonical tire size string, e.g. "225/65R17". Match against
   *  normalized form via extractTireSize() when comparing to job
   *  records or inventory. */
  tireSize: string;
  /** e.g. "Michelin", "Goodyear", "Pirelli". */
  brand: string;
  /** e.g. "Pilot Sport 4S", "Defender 2". */
  model: string;
  /** Wholesale cost per tire. NOT shown to technicians. */
  cost: number;
  /** Available units. 0 = out of stock; picker skips. */
  quantityAvailable: number;
  /** new vs used. Used tires fall into the 'used' profit target
   *  regardless of category. */
  condition: TireCondition;
  /** Used-tire tread depth in /32" (typically 6–10 for resale).
   *  Optional; only meaningful for used inventory. */
  treadDepth?: number;
  /** DOT date code (e.g. "2823" for week 28 of 2023). Optional;
   *  surfaced on quote cards for used tires so the customer knows
   *  how recent the tire is. New tires can also carry this if the
   *  operator tracks shelf-age. */
  dotDate?: string;
  /** Estimated arrival time in days. 0 = same-day in stock,
   *  1 = next-day delivery, etc. Drives the "Same day" / "{N}
   *  days" badge on quote result cards. Optional. */
  etaDays?: number;
  /** Quality tier — drives Good/Better/Best assignment + premium
   *  profit target lookup. */
  category: TireCategory;
  /** Run-flat tires can't use the spare workaround; flagged for
   *  customer-facing notes. */
  runFlat: boolean;
  /** EV-rated tires have higher load capacity + lower rolling
   *  resistance. Surfaced to filter on for EV customers. */
  evRated: boolean;
  /** Extra-load (XL) rating for SUVs/trucks. */
  xlLoad: boolean;
  /** Letter rating: H, V, W, Y, Z. Optional. */
  speedRating?: string;
  /** Numeric load index (typically 80–125). Optional. */
  loadIndex?: string;
  /** Free-form supplier-internal notes (lead time, MOQ, contact).
   *  NOT shown to technicians. */
  notes?: string;
  /** ISO timestamp of last edit. */
  lastUpdated: string;
  /** uid of the operator who created the record. Audit trail. */
  createdBy: string;
}

// ─── Single quote option (one tier of Good/Better/Best) ────────────
//
// Embedded inside TireQuote.quoteOptions. Captures the snapshot at
// quote-build time so future supplier price changes don't retroactively
// alter old quotes.

/** Quote result tier. New tires use good/better/best (Budget /
 *  Midrange / Premium). Used tires use a separate two-tier
 *  taxonomy (Used Economy / Used Premium) — the spec choice is to
 *  NOT force used inventory through the same 3-tier shape, since
 *  used tires don't have a "midrange" concept. */
export type QuoteOptionTier =
  | 'good' | 'better' | 'best'
  | 'used_economy' | 'used_premium';

export interface TireQuoteOption {
  tier: QuoteOptionTier;
  /** Reference back to tireSupplierPrices doc for traceability.
   *  May go stale if the source price is deleted; treat as best-effort. */
  supplierPriceId: string;
  supplierName: TireSupplierName;
  brand: string;
  model: string;
  tireSize: string;
  condition: TireCondition;
  category: TireCategory;
  /** Wholesale cost per tire at quote time. Owner/admin only. */
  costPerTire: number;
  quantity: number;
  /** Total amount the customer pays (after rounding). */
  customerPrice: number;
  /** Owner/admin only. customerPrice − tireSubtotal. */
  estimatedProfit: number;
  /** Pre-tax price when cashPriceEnabled. Optional. */
  cashPrice?: number;
  /** Tax-included price when cashPriceEnabled. Optional. */
  cardPrice?: number;
  /** Estimated arrival time in days at quote-build time.
   *  Snapshotted from the supplier price so a future ETA change
   *  on the supplier record doesn't retroactively rewrite the
   *  quote the customer was given. */
  etaDays?: number;
  /** Snapshot of supplier notes at quote-build time. */
  notes?: string;
  /** DOT date snapshot for used tires. */
  dotDate?: string;
  /** Snapshot of available quantity at quote-build time. */
  quantityAvailable?: number;
}

// ─── Full quote document ────────────────────────────────────────────
//
// Stored at: businesses/{businessId}/tireQuotes/{id}

export interface TireQuote {
  id: string;
  /** Tagged-union search input — what the customer asked for. */
  search: QuoteSearchInput;
  customerName?: string;
  customerPhone?: string;
  customerCity?: string;
  customerZip?: string;
  /** Driving distance from base. Drives the per-mile fee. */
  miles?: number;
  serviceType: QuoteServiceType;
  urgency: Urgency;
  /** Up to 5 options across both tracks:
   *    new track: good / better / best
   *    used track: used_economy / used_premium
   *  Any tier with no in-stock inventory is omitted (length 0–5). */
  quoteOptions: TireQuoteOption[];
  /** Which tier the customer picked. Undefined until selection. */
  selectedOption?: QuoteOptionTier;
  /** Quote total at selection time. Mirrors the selected option's
   *  customerPrice for fast list-view rendering. */
  customerPrice: number;
  /** Owner/admin only. Mirrors selected option's estimatedProfit. */
  estimatedProfit: number;
  status: QuoteStatus;
  source: QuoteSource;
  createdBy: string;
  createdAt: string;
  /** Populated when status === 'convertedToJob'. Bidirectional link
   *  with jobs/{id}.sourceQuoteId. */
  convertedJobId?: string;
}

// ─── Pricing settings (per-business config) ─────────────────────────
//
// Stored at: businesses/{businessId}/pricingSettings/tireQuoteEngine
// Single doc per business.

export interface TireQuoteEngineSettings {
  /** Profit target $ for used-tire quotes. Floor. */
  defaultProfitTargetUsed: number;
  /** Profit target $ for new midrange tires. */
  defaultProfitTargetNew: number;
  /** Profit target $ for premium tires. */
  defaultProfitTargetPremium: number;
  /** Base travel fee (flat, added to every quote). */
  defaultTravelFee: number;
  /** Per-mile fee charged above freeMilesIncluded. */
  perMileFee: number;
  /** Miles included in the base travel fee before perMileFee starts. */
  freeMilesIncluded: number;
  /** Sales tax rate as a decimal (0.07 = 7%). */
  taxRate: number;
  /** Surcharge for emergency urgency. */
  emergencyFee: number;
  /** Surcharge for after-hours urgency. */
  afterHoursFee: number;
  /** Surcharge for same-day urgency. */
  sameDayFee: number;
  /** Minimum profit floor. Quote price bumps up to ensure this
   *  margin is preserved even if computed profit would be lower. */
  minimumProfit: number;
  /** Rounding mode for customer-facing prices. */
  roundPriceTo: RoundPriceTo;
  /** When true, customerPrice includes tax. When false, customer
   *  sees pre-tax price; tax is added at point of sale. */
  showTaxIncludedPrice: boolean;
  /** When true, quotes show both cash (pre-tax) and card (with-tax)
   *  prices. */
  cashPriceEnabled: boolean;
}

/** Sensible defaults for a fresh business. Florida tax rate (7%)
 *  + $79 pricing convention + modest profit targets. Owner can
 *  tune everything in Settings → Tire Quote Engine. */
export const DEFAULT_TIRE_QUOTE_ENGINE_SETTINGS: TireQuoteEngineSettings = {
  defaultProfitTargetUsed: 40,
  defaultProfitTargetNew: 80,
  defaultProfitTargetPremium: 120,
  defaultTravelFee: 25,
  perMileFee: 0,
  freeMilesIncluded: 10,
  taxRate: 0.07,
  emergencyFee: 50,
  afterHoursFee: 75,
  sameDayFee: 25,
  minimumProfit: 30,
  roundPriceTo: 9,
  showTaxIncludedPrice: false,
  cashPriceEnabled: false,
};
