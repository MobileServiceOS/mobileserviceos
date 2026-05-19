// ═══════════════════════════════════════════════════════════════════
//  src/lib/verticals.ts — Multi-vertical architecture (STAGE 1)
// ═══════════════════════════════════════════════════════════════════
//
//  WHAT THIS IS
//  ────────────
//  The foundation for supporting multiple business verticals (mobile
//  tire, mobile mechanic, mobile car wash) inside one Mobile Service
//  OS codebase. It defines ONE shape, `VerticalConfig`, that every
//  vertical satisfies, plus the tire vertical as the first config.
//
//  STAGE 1 SCOPE — IMPORTANT
//  ─────────────────────────
//  This file is PURELY ADDITIVE and currently DORMANT. Nothing in the
//  live render path imports it yet. It exists so later stages have a
//  stable foundation to build on. Removing this file returns the app
//  to its exact prior state — that is the Stage 1 rollback.
//
//  The tire app behaves EXACTLY the same with or without this file
//  present, because no existing module reads it. The wiring happens
//  in later stages, deliberately and incrementally.
//
//  BACK-COMPAT GUARANTEE
//  ─────────────────────
//  The tire VerticalConfig below mirrors the EXISTING tire catalog
//  exactly — every service id is a verbatim copy of the strings
//  already stored on live jobs and in DEFAULT_SERVICE_PRICING
//  (src/lib/defaults.ts). When later stages read a current tire job
//  through this layer, it resolves perfectly. No job data is ever
//  rewritten — the code adapts to the data, never the reverse.
//
//  An old settings doc with no `businessType` field is treated as
//  'tire' (see verticalContext.ts) — so every existing operator is
//  automatically correct with zero migration.
// ═══════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────
//  VerticalKey — stable identifier stored on settings.businessType
// ─────────────────────────────────────────────────────────────

/**
 * Identifies a business vertical. Persisted (in later stages) on the
 * business's `settings/main` doc as `businessType`.
 *
 * An absent/undefined value on an old doc is interpreted as 'tire'
 * for full backward compatibility — see resolveVerticalKey().
 */
export type VerticalKey = 'tire' | 'mechanic' | 'carwash';

/** The default vertical for any business with no explicit type. */
export const DEFAULT_VERTICAL_KEY: VerticalKey = 'tire';

// ─────────────────────────────────────────────────────────────
//  Building-block shapes
// ─────────────────────────────────────────────────────────────

/** One service a vertical offers (e.g. "Flat Tire Repair"). */
export interface VerticalService {
  /**
   * Stable service ID. For the tire vertical these MATCH the exact
   * strings already stored on live jobs and in DEFAULT_SERVICE_PRICING
   * — so existing tire jobs stay valid when read through this layer.
   */
  id: string;
  /** Display label shown in the UI. */
  label: string;
  /** Seed base price when a business of this vertical first onboards. */
  defaultBasePrice: number;
  /** Seed minimum profit target for this service. */
  defaultMinProfit: number;
  /** Whether the service is enabled by default in a fresh business. */
  enabledByDefault: boolean;
}

/** Field types a vertical-specific Job/Inventory field can take. */
export type VerticalFieldType = 'text' | 'number' | 'select' | 'boolean';

/**
 * One vertical-specific field shown on a Job for this vertical.
 *
 * The SHARED base Job (customer, location, payment, technician,
 * profit, status) is NOT described here — it stays in the existing
 * `Job` type, untouched. This only describes what DIFFERS per
 * vertical (tire: tireSize/condition; mechanic: laborHours/partsCost;
 * carwash: packageTier/addOns).
 */
export interface VerticalJobField {
  /** The Job-object key this field reads/writes. */
  key: string;
  label: string;
  type: VerticalFieldType;
  /** Options when `type` is 'select'. */
  options?: string[];
  /** Whether the field is required to save a job. */
  required: boolean;
}

/** One vertical-specific inventory field. */
export interface VerticalInventoryField {
  key: string;
  label: string;
  type: Exclude<VerticalFieldType, 'boolean'>;
  options?: string[];
}

/**
 * Vertical-specific copy, so empty states and labels never say
 * "tire" inside a mechanic or car wash business.
 */
export interface VerticalCopy {
  /** Singular job noun used in sentences, e.g. "tire repair". */
  jobNounSingular: string;
  /** Plural job noun, e.g. "tire repairs". */
  jobNounPlural: string;
  /** Dashboard empty-state hint. */
  emptyJobsHint: string;
  /** Inventory section title, e.g. "Tire Inventory" / "Parts". */
  inventoryLabel: string;
}

// ─────────────────────────────────────────────────────────────
//  Pricing models
//  ───────────────
//  Each vertical declares HOW its pricing engine behaves. This is a
//  discriminated union on `kind` so later stages can switch on it
//  exhaustively. STAGE 1 ships all three model shapes defined, but
//  only the tire model ('flat') is actually used — mechanic and
//  detailing models are dormant until Stage 3 / Stage 4.
//
//  The tire app's pricing behavior does NOT change: tire declares
//  the 'flat' model, which describes exactly what the existing
//  pricing engine already does (base price + vehicle add-on).
// ─────────────────────────────────────────────────────────────

/**
 * Flat pricing — tire & roadside. A service has a base price and the
 * vehicle type adds a fixed amount. This is the CURRENT, unchanged
 * tire behavior; the model just gives it an explicit name.
 */
export interface FlatPricingModel {
  kind: 'flat';
}

/**
 * Labor + parts pricing — mobile mechanic. Price is built from billed
 * labor hours at an hourly rate, plus parts cost with a markup
 * percentage, plus an optional diagnostic fee, with a minimum service
 * charge as a floor. Dormant until Stage 3.
 */
export interface LaborPartsPricingModel {
  kind: 'labor_parts';
  /** Default hourly labor rate seeded for a fresh mechanic business. */
  defaultLaborRate: number;
  /** Default markup percentage applied to parts cost (e.g. 25 = +25%). */
  defaultPartsMarkupPct: number;
  /** Default diagnostic fee seeded for a fresh mechanic business. */
  defaultDiagnosticFee: number;
  /** Minimum service charge — the price floor for any job. */
  defaultMinServiceCharge: number;
}

/**
 * Package + multiplier pricing — mobile auto detailing. A package has
 * a base price that is multiplied by a vehicle-size factor, plus
 * fixed-price add-ons. Dormant until Stage 4.
 */
export interface PackageMultiplierPricingModel {
  kind: 'package_multiplier';
  /**
   * Vehicle-size multipliers, keyed by size label. e.g.
   * { Sedan: 1.0, SUV: 1.25, Truck: 1.3, 'XL SUV': 1.5, Van: 1.4 }
   */
  vehicleSizeMultipliers: Record<string, number>;
}

/**
 * The pricing model for a vertical — a discriminated union. Switch on
 * `.kind` to handle each vertical's pricing exhaustively.
 */
export type PricingModel =
  | FlatPricingModel
  | LaborPartsPricingModel
  | PackageMultiplierPricingModel;

/**
 * THE config object. One per vertical. The app (in later stages)
 * reads the active vertical's config instead of hardcoding tire
 * assumptions anywhere.
 */
export interface VerticalConfig {
  key: VerticalKey;
  /** Operator-facing vertical name, e.g. "Mobile Tire & Roadside". */
  displayName: string;
  /** Short name for the business-switcher pill. */
  shortName: string;
  /**
   * How this vertical's pricing engine behaves. Tire is 'flat'
   * (current behavior). Mechanic and detailing use richer models
   * that stay dormant until their stages.
   */
  pricingModel: PricingModel;
  /** The services this vertical offers. */
  services: VerticalService[];
  /** Vertical-specific Job fields (added on top of the base Job). */
  jobFields: VerticalJobField[];
  /** Vertical-specific inventory fields. */
  inventoryFields: VerticalInventoryField[];
  /** Vertical-specific UI copy. */
  copy: VerticalCopy;
  /** Default expense categories seeded for a fresh business. */
  defaultExpenseCategories: string[];
}

// ═══════════════════════════════════════════════════════════════════
//  TIRE VERTICAL CONFIG
//  ────────────────────
//  Mirrors the EXISTING tire catalog verbatim. Every service `id`
//  below is copied exactly from DEFAULT_SERVICE_PRICING in
//  src/lib/defaults.ts (basePrice / minProfit included), so a live
//  tire job read through this layer resolves with zero mismatch.
//
//  This config is intentionally the single source of truth for the
//  tire vertical going forward — but in Stage 1 nothing reads it yet.
// ═══════════════════════════════════════════════════════════════════

export const TIRE_VERTICAL: VerticalConfig = {
  key: 'tire',
  displayName: 'Mobile Tire & Roadside',
  shortName: 'Tire & Roadside',
  // Tire uses flat pricing — base price per service + vehicle add-on.
  // This is the existing, unchanged tire pricing behavior.
  pricingModel: { kind: 'flat' },
  services: [
    { id: 'Flat Tire Repair',         label: 'Flat Tire Repair',         defaultBasePrice: 90,  defaultMinProfit: 90,  enabledByDefault: true },
    { id: 'Tire Replacement',         label: 'Tire Replacement',         defaultBasePrice: 120, defaultMinProfit: 110, enabledByDefault: true },
    { id: 'Tire Installation',        label: 'Tire Installation',        defaultBasePrice: 120, defaultMinProfit: 110, enabledByDefault: true },
    { id: 'Mounting & Balancing',     label: 'Mounting & Balancing',     defaultBasePrice: 100, defaultMinProfit: 80,  enabledByDefault: true },
    { id: 'Spare Tire Installation',  label: 'Spare Tire Installation',  defaultBasePrice: 95,  defaultMinProfit: 70,  enabledByDefault: true },
    { id: 'Spare Change',             label: 'Spare Change',             defaultBasePrice: 85,  defaultMinProfit: 65,  enabledByDefault: true },
    { id: 'Tire Rotation',            label: 'Tire Rotation',            defaultBasePrice: 80,  defaultMinProfit: 60,  enabledByDefault: true },
    { id: 'Wheel Lock Removal',       label: 'Wheel Lock Removal',       defaultBasePrice: 85,  defaultMinProfit: 65,  enabledByDefault: true },
    { id: 'Roadside Tire Assistance', label: 'Roadside Tire Assistance', defaultBasePrice: 100, defaultMinProfit: 70,  enabledByDefault: true },
    { id: 'Mobile Tire Service',      label: 'Mobile Tire Service',      defaultBasePrice: 150, defaultMinProfit: 110, enabledByDefault: true },
    { id: 'Jump Start',               label: 'Jump Start',               defaultBasePrice: 75,  defaultMinProfit: 60,  enabledByDefault: true },
    { id: 'Fuel Delivery',            label: 'Fuel Delivery',            defaultBasePrice: 85,  defaultMinProfit: 65,  enabledByDefault: true },
    { id: 'Lockout',                  label: 'Lockout',                  defaultBasePrice: 75,  defaultMinProfit: 60,  enabledByDefault: true },
    { id: 'Fleet Tire Service',       label: 'Fleet Tire Service',       defaultBasePrice: 200, defaultMinProfit: 160, enabledByDefault: false },
    { id: 'Heavy-Duty Tire Service',  label: 'Heavy-Duty Tire Service',  defaultBasePrice: 350, defaultMinProfit: 280, enabledByDefault: false },
  ],
  jobFields: [
    { key: 'tireSize',        label: 'Tire Size',         type: 'text',    required: false },
    { key: 'tireCondition',   label: 'Tire Condition',    type: 'select',  required: false, options: ['new', 'used', 'damaged'] },
    { key: 'wheelLockRemoved', label: 'Wheel Lock Removed', type: 'boolean', required: false },
  ],
  inventoryFields: [
    { key: 'tireSize',  label: 'Tire Size',  type: 'text' },
    { key: 'rimSize',   label: 'Rim Size (in)', type: 'number' },
    { key: 'brand',     label: 'Brand',      type: 'text' },
    { key: 'condition', label: 'Condition',  type: 'select', options: ['new', 'used', 'damaged'] },
  ],
  copy: {
    jobNounSingular: 'tire job',
    jobNounPlural: 'tire jobs',
    emptyJobsHint: 'No jobs logged yet — quote a tire repair to get started.',
    inventoryLabel: 'Tire Inventory',
  },
  defaultExpenseCategories: ['Tire Cost', 'Labor', 'Equipment', 'Vehicle', 'Insurance', 'Misc'],
};

// ─────────────────────────────────────────────────────────────
//  Vertical registry
//  ──────────────────
//  Stage 1 ships ONLY the tire vertical. Mechanic and car wash
//  configs are added in Stage 3 and Stage 4 respectively — each is
//  just one more VerticalConfig object registered here. No other
//  code changes shape when they are added.
// ─────────────────────────────────────────────────────────────

/**
 * All registered verticals, keyed by VerticalKey.
 *
 * Stage 1: tire only. Mechanic (Stage 3) and carwash (Stage 4) will
 * be appended here. Code that consumes verticals should always go
 * through getVerticalConfig() rather than reading this map directly,
 * so an unknown/missing key safely falls back to tire.
 */
// ═══════════════════════════════════════════════════════════════════
//  MOBILE MECHANIC VERTICAL CONFIG  (STAGE 3a)
//  ──────────────────────────────────────────
//  Dormant until Stage 3b wires verticals into the UI. Adding this
//  object and registering it below changes NO behavior — the tire
//  app does not read it.
//
//  Pricing model: labor_parts. A mechanic job's price is built from
//  billed labor hours x labor rate, plus parts cost x (1 + markup),
//  plus an optional diagnostic fee, floored at a minimum charge.
//  The per-service defaultBasePrice below is a typical all-in
//  starting quote shown before the labor/parts breakdown is filled
//  in — an operator edits these during onboarding, exactly like the
//  tire vertical's seed prices. They are starting points, not fixed.
//
//  Scope per the agreed spec: 20 core mobile-friendly services, 7
//  add-ons. Deliberately excludes engine/transmission rebuilds and
//  deep teardown work — not mobile-suitable.
// ═══════════════════════════════════════════════════════════════════

export const MECHANIC_VERTICAL: VerticalConfig = {
  key: 'mechanic',
  displayName: 'Mobile Mechanic',
  shortName: 'Mechanic',
  // Labor + parts pricing. Seeded starting values — an operator
  // adjusts these during onboarding to their own rates.
  pricingModel: {
    kind: 'labor_parts',
    defaultLaborRate: 110,        // $/hour — typical mobile mechanic rate
    defaultPartsMarkupPct: 25,    // +25% on parts cost
    defaultDiagnosticFee: 90,     // flat diagnostic/callout fee
    defaultMinServiceCharge: 95,  // price floor for any job
  },
  // 20 core services. defaultBasePrice = typical all-in starting
  // quote; defaultMinProfit = seed minimum profit target.
  services: [
    { id: 'Diagnostics',                label: 'Diagnostics',                  defaultBasePrice: 90,  defaultMinProfit: 70,  enabledByDefault: true },
    { id: 'Check Engine Light Diagnosis', label: 'Check Engine Light Diagnosis', defaultBasePrice: 100, defaultMinProfit: 80,  enabledByDefault: true },
    { id: 'Oil Change',                 label: 'Oil Change',                   defaultBasePrice: 90,  defaultMinProfit: 45,  enabledByDefault: true },
    { id: 'Battery Replacement',        label: 'Battery Replacement',          defaultBasePrice: 120, defaultMinProfit: 60,  enabledByDefault: true },
    { id: 'Brake Pads & Rotors',        label: 'Brake Pads & Rotors',          defaultBasePrice: 280, defaultMinProfit: 130, enabledByDefault: true },
    { id: 'Alternator Replacement',     label: 'Alternator Replacement',       defaultBasePrice: 320, defaultMinProfit: 140, enabledByDefault: true },
    { id: 'Starter Replacement',        label: 'Starter Replacement',          defaultBasePrice: 300, defaultMinProfit: 135, enabledByDefault: true },
    { id: 'Spark Plug Replacement',     label: 'Spark Plug Replacement',       defaultBasePrice: 160, defaultMinProfit: 85,  enabledByDefault: true },
    { id: 'Belt Replacement',           label: 'Belt Replacement',             defaultBasePrice: 150, defaultMinProfit: 80,  enabledByDefault: true },
    { id: 'Serpentine Belt',            label: 'Serpentine Belt',              defaultBasePrice: 150, defaultMinProfit: 80,  enabledByDefault: true },
    { id: 'Hose Replacement',           label: 'Hose Replacement',             defaultBasePrice: 130, defaultMinProfit: 70,  enabledByDefault: true },
    { id: 'Radiator Replacement',       label: 'Radiator Replacement',         defaultBasePrice: 360, defaultMinProfit: 150, enabledByDefault: true },
    { id: 'Thermostat Replacement',     label: 'Thermostat Replacement',       defaultBasePrice: 180, defaultMinProfit: 90,  enabledByDefault: true },
    { id: 'Suspension Work',            label: 'Suspension Work',              defaultBasePrice: 350, defaultMinProfit: 150, enabledByDefault: true },
    { id: 'Pre-Purchase Inspection',    label: 'Pre-Purchase Inspection',      defaultBasePrice: 130, defaultMinProfit: 100, enabledByDefault: true },
    { id: 'Mobile Tune-Up',             label: 'Mobile Tune-Up',               defaultBasePrice: 200, defaultMinProfit: 110, enabledByDefault: true },
    { id: 'Fluid Services',             label: 'Fluid Services',               defaultBasePrice: 110, defaultMinProfit: 55,  enabledByDefault: true },
    { id: 'Fuel Pump Replacement',      label: 'Fuel Pump Replacement',        defaultBasePrice: 400, defaultMinProfit: 170, enabledByDefault: true },
    { id: 'Ignition Coil Replacement',  label: 'Ignition Coil Replacement',    defaultBasePrice: 190, defaultMinProfit: 95,  enabledByDefault: true },
    { id: 'General Repair',             label: 'General Repair',               defaultBasePrice: 120, defaultMinProfit: 60,  enabledByDefault: true },
    // 7 add-ons — surcharges layered on top of a base service.
    // Listed in the same catalog; an operator enables/prices them
    // like any other service. defaultMinProfit ≈ basePrice since
    // add-ons are essentially pure margin.
    { id: 'Emergency Service',          label: 'Emergency Service',            defaultBasePrice: 75,  defaultMinProfit: 70,  enabledByDefault: true },
    { id: 'Same-Day Service',           label: 'Same-Day Service',             defaultBasePrice: 50,  defaultMinProfit: 48,  enabledByDefault: true },
    { id: 'After Hours',                label: 'After Hours',                  defaultBasePrice: 65,  defaultMinProfit: 62,  enabledByDefault: true },
    { id: 'Highway Call',               label: 'Highway Call',                 defaultBasePrice: 80,  defaultMinProfit: 75,  enabledByDefault: true },
    { id: 'Parts Pickup',               label: 'Parts Pickup',                 defaultBasePrice: 45,  defaultMinProfit: 40,  enabledByDefault: true },
    { id: 'Travel Fee',                 label: 'Travel Fee',                   defaultBasePrice: 40,  defaultMinProfit: 38,  enabledByDefault: true },
    { id: 'Fleet Service',              label: 'Fleet Service',                defaultBasePrice: 250, defaultMinProfit: 180, enabledByDefault: false },
  ],
  // Mechanic-specific job fields layered on the shared base Job.
  jobFields: [
    { key: 'laborHours',      label: 'Labor Hours',       type: 'number',  required: false },
    { key: 'partsCost',       label: 'Parts Cost',        type: 'number',  required: false },
    { key: 'diagnosticCode',  label: 'Diagnostic Code',   type: 'text',    required: false },
    { key: 'vehicleMakeModel', label: 'Vehicle Make / Model', type: 'text', required: false },
    { key: 'mileage',         label: 'Vehicle Mileage',   type: 'number',  required: false },
  ],
  inventoryFields: [
    { key: 'partNumber',  label: 'Part Number',  type: 'text' },
    { key: 'partName',    label: 'Part Name',    type: 'text' },
    { key: 'supplier',    label: 'Supplier',     type: 'text' },
    { key: 'unitCost',    label: 'Unit Cost',    type: 'number' },
    { key: 'quantity',    label: 'Quantity',     type: 'number' },
  ],
  copy: {
    jobNounSingular: 'repair job',
    jobNounPlural: 'repair jobs',
    emptyJobsHint: 'No jobs logged yet — quote a repair to get started.',
    inventoryLabel: 'Parts Inventory',
  },
  defaultExpenseCategories: ['Parts', 'Labor', 'Tools & Equipment', 'Vehicle', 'Insurance', 'Misc'],
};

// ─────────────────────────────────────────────────────────────
//  Vertical registry
//  ──────────────────
//  Stage 3a registers tire + mechanic. Car wash / detailing
//  (Stage 4) will be appended here. Code that consumes verticals
//  should always go through getVerticalConfig() rather than
//  reading this map directly, so an unknown/missing key safely
//  falls back to tire.
// ─────────────────────────────────────────────────────────────

export const VERTICAL_REGISTRY: Partial<Record<VerticalKey, VerticalConfig>> = {
  tire: TIRE_VERTICAL,
  mechanic: MECHANIC_VERTICAL,
};

/**
 * Resolve a VerticalConfig for the given key. Falls back to the tire
 * vertical when the key is missing, undefined, or not yet registered
 * — guaranteeing every call site gets a valid config and existing
 * tire businesses keep working no matter what.
 */
export function getVerticalConfig(key: VerticalKey | null | undefined): VerticalConfig {
  if (key && VERTICAL_REGISTRY[key]) {
    return VERTICAL_REGISTRY[key] as VerticalConfig;
  }
  return TIRE_VERTICAL;
}

/**
 * Build a servicePricing map (the shape stored on a business's
 * settings/main doc) from a vertical's service catalog.
 *
 * Each VerticalService becomes one { enabled, basePrice, minProfit }
 * entry keyed by the service id. Used when seeding a NEW business so
 * a mechanic business is created with mechanic services and a tire
 * business with tire services. The shape matches DEFAULT_SERVICE_
 * PRICING exactly, so every downstream consumer (the job service
 * picker, pricing engine, settings) works unchanged.
 */
export function servicePricingFromVertical(
  config: VerticalConfig,
): Record<string, { enabled: boolean; basePrice: number; minProfit: number }> {
  const out: Record<string, { enabled: boolean; basePrice: number; minProfit: number }> = {};
  for (const svc of config.services) {
    out[svc.id] = {
      enabled: svc.enabledByDefault,
      basePrice: svc.defaultBasePrice,
      minProfit: svc.defaultMinProfit,
    };
  }
  return out;
}
