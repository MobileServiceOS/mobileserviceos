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
}
