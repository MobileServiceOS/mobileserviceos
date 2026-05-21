// src/config/businessTypes/types.ts
// ═══════════════════════════════════════════════════════════════════
//  Business-type configuration types — single source of truth for
//  everything that varies between mobile service verticals.
//
//  This file is the type contract for `src/config/businessTypes/`.
//  Implementations live in tire.ts, mechanic.ts, detailing.ts.
//  Old names (`VerticalConfig`, `VerticalKey`, etc.) live in the
//  shim at `src/lib/verticals.ts` as permanent aliases — there is
//  NO call-site rename pass in Phase 2.1.
//
//  NOTE: the existing dormant code uses `'carwash'` as the third
//  key. Phase 2.1 renames this enum value to `'detailing'` to
//  match the product-facing nomenclature and the user-specified
//  file name. Safe because no production business has ever had
//  `businessType: 'carwash'` written — AddBusinessModal only
//  offers tire + mechanic today.
// ═══════════════════════════════════════════════════════════════════

import type { Job, Settings } from '@/types';
import type { LifecycleExtensions } from '@/config/jobs/lifecycle';

export type BusinessTypeKey = 'tire' | 'mechanic' | 'detailing';

export const DEFAULT_BUSINESS_TYPE_KEY: BusinessTypeKey = 'tire';

// ─── Pricing model (carried forward from the dormant verticals.ts) ─

export interface FlatPricingModel {
  kind: 'flat';
}

export interface LaborPartsPricingModel {
  kind: 'labor_parts';
  defaultLaborRate: number;
  defaultPartsMarkupPct: number;
  defaultDiagnosticFee: number;
  defaultMinServiceCharge: number;
}

export interface PackageMultiplierPricingModel {
  kind: 'package_multiplier';
  vehicleSizeMultipliers: Record<string, number>;
  /** Service-floor minimum; the engine raises the suggested price to
   *  this when the computed value would be lower. Mirrors the
   *  labor_parts engine's defaultMinServiceCharge. Added Phase 2.3. */
  defaultMinServiceCharge?: number;
}

export type PricingModel =
  | FlatPricingModel
  | LaborPartsPricingModel
  | PackageMultiplierPricingModel;

// ─── Service / field / copy shapes ─────────────────────────────────

export type BusinessTypeFieldType = 'text' | 'number' | 'select' | 'boolean';

export interface BusinessTypeService {
  id: string;
  label: string;
  defaultBasePrice: number;
  defaultMinProfit: number;
  enabledByDefault: boolean;
  /** Detailing-only (Phase 2.3): when true, this service renders in
   *  the AddJob add-ons multi-select rather than the primary Service
   *  chip-grid. Other verticals leave undefined; the AddJob renderer
   *  treats undefined as `false`. */
  isAddOn?: boolean;
  /** Optional grouping label for the AddJob service picker. When ANY
   *  service in a vertical declares a category, the picker switches
   *  from a flat chip-grid to a grouped view (Popular row + search +
   *  collapsible category sections). Verticals with a short service
   *  list (tire) leave this undefined and keep the flat chip-grid. */
  category?: string;
  /** When true, the service appears in the picker's compact
   *  "Popular" row above the collapsed category sections. Only
   *  meaningful in the grouped view. */
  popular?: boolean;
}

export interface BusinessTypeJobField {
  key: string;
  label: string;
  type: BusinessTypeFieldType;
  options?: string[];
  required: boolean;
}

export interface BusinessTypeInventoryField {
  key: string;
  label: string;
  type: Exclude<BusinessTypeFieldType, 'boolean'>;
  options?: string[];
}

export interface BusinessTypeCopy {
  jobNounSingular: string;
  jobNounPlural: string;
  emptyJobsHint: string;
  inventoryLabel: string;
  /** Optional override for the AddJob "Service" section title. When
   *  defined, replaces "Service" — used by detailing to render
   *  "Package". Undefined verticals keep the default. */
  packageLabel?: string;
}

// ─── Feature flags (new in 2.1) ────────────────────────────────────
// Cross-cutting UI gates. Each vertical opts in/out per feature so
// the same React tree can render different surfaces with no per-page
// `if (businessType === 'mechanic')` checks scattered around.

export interface BusinessTypeFeatures {
  /** Show the inventory-deduction flow on Add Job. Tire = true. */
  inventoryDeduction: boolean;
  /** Show before/after photo capture on Add Job. Detailing = true. */
  photoCapture: boolean;
  /** Show VIN / mileage / diagnostic-notes fields. Mechanic = true. */
  vehicleDiagnostics: boolean;
  /** Show vehicle-size selector with package multipliers. Detailing. */
  vehicleSizeMultiplier: boolean;
  /** Show wheel-lock / roadside-only addons. Tire only. */
  roadsideAddons: boolean;
}

// ─── Dashboard metric spec ─────────────────────────────────────────
// Sync only for 2.1. Async metrics (filtered analytics) arrive in
// Phase 2.8 with a separate type extension.

export interface DashboardMetricSpec {
  /** Stable id used for memo keys, e.g. 'revenue_week'. */
  id: string;
  /** Card label. */
  label: string;
  /** Pure computation over the loaded job list + settings. */
  compute: (jobs: ReadonlyArray<Job>, settings: Settings) => number;
  /** Display formatting. */
  format: 'currency' | 'number' | 'percent';
}

// ─── The config ────────────────────────────────────────────────────

/** A job-level surcharge condition (chip in AddJob → boolean on Job).
 *  Vertical-aware: tire shows emergency/lateNight/highway/weekend;
 *  detailing omits highway (no one washes cars on the highway). */
export interface JobConditionSpec {
  key: 'emergency' | 'lateNight' | 'highway' | 'weekend';
  label: string;
}

export interface BusinessTypeConfig {
  key: BusinessTypeKey;
  displayName: string;
  shortName: string;
  pricingModel: PricingModel;
  services: BusinessTypeService[];
  jobFields: BusinessTypeJobField[];
  inventoryFields: BusinessTypeInventoryField[];
  copy: BusinessTypeCopy;
  defaultExpenseCategories: string[];

  // New in 2.1:
  features: BusinessTypeFeatures;
  invoiceTemplateKey: BusinessTypeKey;
  dashboardMetrics: DashboardMetricSpec[];

  /** Applicable job-level conditions for this vertical. Surfaces in
   *  AddJob's "Conditions" chip row. Defaults to all 4 if omitted
   *  (back-compat for any config not yet migrated). */
  conditions?: ReadonlyArray<JobConditionSpec>;

  /** Optional per-vertical contributions to the universal job
   *  lifecycle (substages, applicable-stages filter, stage overrides).
   *  When undefined, the vertical inherits the universal defaults
   *  declared in src/config/jobs/universal-stages.ts. */
  lifecycle?: LifecycleExtensions;
}
