# Phase 2.1 — Vertical Config Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Mobile Service OS from "tire defaults everywhere + dormant vertical config" to "vertical config is the single runtime source of truth." Tire renders byte-for-byte identically (TIRE_CONFIG mirrors current defaults); mechanic businesses (already created correctly by `createBusiness`) become visually + functionally distinct end-to-end.

**Architecture:** A typed registry under `src/config/businessTypes/` keyed by `BusinessTypeKey = 'tire' | 'mechanic' | 'detailing'`. Each business type contributes a `BusinessTypeConfig` (services, pricing model, job/inventory fields, copy, dashboard metrics, invoice template, feature flags). Pricing engines and invoice templates are dispatched off the active config. The old `src/lib/verticals.ts` becomes a re-export shim so every existing import keeps working without a rename pass.

**Tech Stack:** TypeScript strict mode (already on), React 18, Firebase Firestore client SDK (read paths only — no schema changes), Vite 5 build, no test framework currently configured.

**Implementation references:**
- Spec: [docs/superpowers/specs/2026-05-20-vertical-config-runtime-design.md](../specs/2026-05-20-vertical-config-runtime-design.md)
- User-approved decisions (from spec §11): permanent alias `VerticalConfig` → `BusinessTypeConfig`, `carwash` → `detailing` enum rename, sync `DashboardMetricSpec.compute`, Onboarding pre-checks only `enabledByDefault: true` services.

**Testing note:** This repo has no configured test runner (`package.json` defines only `dev`/`build`/`preview`/`lint`/`deploy:rules`). The `tests/` directory contains type-checkable `.test.ts` files but `npm test` is not wired up. Per-task verification therefore uses:
- `npm run build` — passes `tsc --noEmit` strict-mode type checks AND completes the Vite production build.
- Manual dev-server smoke test on tire + mechanic accounts after milestone D.
- Where a task adds a pure function with a numerical answer, a typed assertion block is included inline as documentation of the expected behavior (compiles via tsc, runs nowhere — wire vitest in later if you want them executable).

---

## Milestone A — Types & Registry Foundation

Goal: every new symbol from the design exists, with TIRE_CONFIG/MECHANIC_CONFIG verbatim ports of today's content. No behavior change. `npm run build` green before and after each task.

### Task A.1: Create the types module

**Files:**
- Create: `src/config/businessTypes/types.ts`

- [ ] **Step 1: Write the new types module**

```ts
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
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: build succeeds (this file has no consumers yet; `tsc --noEmit` exits 0).

- [ ] **Step 3: Commit**

```bash
git add src/config/businessTypes/types.ts
git commit -m "feat(business-types): add BusinessTypeConfig type contract"
```

---

### Task A.2: Port TIRE_VERTICAL to tire.ts (verbatim + new fields)

**Files:**
- Create: `src/config/businessTypes/tire.ts`

Reference: existing TIRE_VERTICAL block in [src/lib/verticals.ts](../../../src/lib/verticals.ts) lines 226-268. Copy the `services`, `jobFields`, `inventoryFields`, `copy`, `defaultExpenseCategories` arrays verbatim; only add the new `features`, `invoiceTemplateKey`, `dashboardMetrics` fields.

- [ ] **Step 1: Create tire.ts**

```ts
// src/config/businessTypes/tire.ts
// ═══════════════════════════════════════════════════════════════════
//  Tire vertical config — verbatim port of TIRE_VERTICAL from the
//  dormant src/lib/verticals.ts. Every service id, base price, min
//  profit, job field, inventory field, and copy string is copied
//  exactly so existing tire accounts render byte-for-byte identically
//  after Phase 2.1 wires this config into the runtime.
//
//  features.* values mirror today's tire-only assumptions
//  (inventoryDeduction true, roadsideAddons true, everything else
//  false). dashboardMetrics mirrors today's Dashboard cards.
// ═══════════════════════════════════════════════════════════════════

import type { BusinessTypeConfig } from './types';
import type { Job, Settings } from '@/types';
import { r2 } from '@/lib/utils';

// ─── Dashboard metric helpers (pure, sync) ─────────────────────────
// These compute today's Dashboard card values. Moving them onto the
// config is a code-organization change only — every value matches
// what Dashboard.tsx renders today.

function startOfWeekIso(): string {
  // Match the existing Dashboard week boundary: America/New_York,
  // week starts Sunday. The implementation in Dashboard.tsx uses
  // the same TODAY() helper from defaults.ts; we redo it inline so
  // tire.ts has no implicit dependency on a tire-specific util.
  const now = new Date();
  const day = now.getDay(); // 0 = Sunday
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day);
  return start.toISOString().slice(0, 10);
}

function isThisWeek(job: Pick<Job, 'date'>): boolean {
  if (!job.date) return false;
  return job.date >= startOfWeekIso();
}

function revenueOf(job: Pick<Job, 'revenue'>): number {
  return Number(job.revenue || 0);
}

function profitOf(job: Job, s: Settings): number {
  const revenue = revenueOf(job);
  const tireCost = Number(job.tireCost || 0);
  const materialCost = Number(job.materialCost || job.miscCost || 0);
  const miles = Number(job.miles || 0);
  const freeMiles = Number(s.freeMilesIncluded || 0);
  const chargeable = Math.max(0, miles - freeMiles);
  const travelCost = r2(chargeable * Number(s.costPerMile || 0.65));
  return r2(revenue - tireCost - materialCost - travelCost);
}

export const TIRE_CONFIG: BusinessTypeConfig = {
  key: 'tire',
  displayName: 'Mobile Tire & Roadside',
  shortName: 'Tire & Roadside',
  pricingModel: { kind: 'flat' },

  // ─── services: VERBATIM from src/lib/verticals.ts:233-249 ────────
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
    { key: 'tireSize',         label: 'Tire Size',         type: 'text',    required: false },
    { key: 'tireCondition',    label: 'Tire Condition',    type: 'select',  required: false, options: ['new', 'used', 'damaged'] },
    { key: 'wheelLockRemoved', label: 'Wheel Lock Removed', type: 'boolean', required: false },
  ],

  inventoryFields: [
    { key: 'tireSize',  label: 'Tire Size',     type: 'text' },
    { key: 'rimSize',   label: 'Rim Size (in)', type: 'number' },
    { key: 'brand',     label: 'Brand',         type: 'text' },
    { key: 'condition', label: 'Condition',     type: 'select', options: ['new', 'used', 'damaged'] },
  ],

  copy: {
    jobNounSingular: 'tire job',
    jobNounPlural: 'tire jobs',
    emptyJobsHint: 'No jobs logged yet — quote a tire repair to get started.',
    inventoryLabel: 'Tire Inventory',
  },

  defaultExpenseCategories: ['Tire Cost', 'Labor', 'Equipment', 'Vehicle', 'Insurance', 'Misc'],

  // ─── NEW in 2.1 ──────────────────────────────────────────────────

  features: {
    inventoryDeduction: true,
    photoCapture: false,
    vehicleDiagnostics: false,
    vehicleSizeMultiplier: false,
    roadsideAddons: true,
  },

  invoiceTemplateKey: 'tire',

  dashboardMetrics: [
    {
      id: 'revenue_week',
      label: 'Revenue this week',
      format: 'currency',
      compute: (jobs, _settings) =>
        r2(jobs.filter(isThisWeek).reduce((sum, j) => sum + revenueOf(j), 0)),
    },
    {
      id: 'profit_week',
      label: 'Profit this week',
      format: 'currency',
      compute: (jobs, settings) =>
        r2(jobs.filter(isThisWeek).reduce((sum, j) => sum + profitOf(j, settings), 0)),
    },
    {
      id: 'avg_ticket',
      label: 'Average ticket',
      format: 'currency',
      compute: (jobs, _settings) => {
        const completed = jobs.filter((j) => j.status === 'Completed');
        if (completed.length === 0) return 0;
        const total = completed.reduce((sum, j) => sum + revenueOf(j), 0);
        return r2(total / completed.length);
      },
    },
  ],
};
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: succeeds. tire.ts has no consumers yet (registry.ts is next).

- [ ] **Step 3: Commit**

```bash
git add src/config/businessTypes/tire.ts
git commit -m "feat(business-types): tire config (verbatim port + features/dashboardMetrics)"
```

---

### Task A.3: Port MECHANIC_VERTICAL to mechanic.ts

**Files:**
- Create: `src/config/businessTypes/mechanic.ts`

Reference: existing MECHANIC_VERTICAL block in [src/lib/verticals.ts](../../../src/lib/verticals.ts) lines 307-377. Copy the services, jobFields, inventoryFields, copy, defaultExpenseCategories arrays verbatim.

- [ ] **Step 1: Create mechanic.ts**

```ts
// src/config/businessTypes/mechanic.ts
// ═══════════════════════════════════════════════════════════════════
//  Mechanic vertical config — verbatim port of MECHANIC_VERTICAL
//  from the dormant src/lib/verticals.ts. Service catalog and field
//  schemas come over unchanged. New in 2.1: features flags,
//  invoiceTemplateKey, and dashboardMetrics tailored to mechanic work
//  (revenue, average ticket, labor hours billed this week).
// ═══════════════════════════════════════════════════════════════════

import type { BusinessTypeConfig } from './types';
import type { Job, Settings } from '@/types';
import { r2 } from '@/lib/utils';

function isThisWeek(job: Pick<Job, 'date'>): boolean {
  if (!job.date) return false;
  const now = new Date();
  const day = now.getDay();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day)
    .toISOString().slice(0, 10);
  return job.date >= start;
}

function revenueOf(job: Pick<Job, 'revenue'>): number {
  return Number(job.revenue || 0);
}

export const MECHANIC_CONFIG: BusinessTypeConfig = {
  key: 'mechanic',
  displayName: 'Mobile Mechanic',
  shortName: 'Mechanic',

  pricingModel: {
    kind: 'labor_parts',
    defaultLaborRate: 110,
    defaultPartsMarkupPct: 25,
    defaultDiagnosticFee: 90,
    defaultMinServiceCharge: 95,
  },

  // ─── services: VERBATIM from src/lib/verticals.ts:322-354 ────────
  services: [
    { id: 'Diagnostics',                  label: 'Diagnostics',                  defaultBasePrice: 90,  defaultMinProfit: 70,  enabledByDefault: true },
    { id: 'Check Engine Light Diagnosis', label: 'Check Engine Light Diagnosis', defaultBasePrice: 100, defaultMinProfit: 80,  enabledByDefault: true },
    { id: 'Oil Change',                   label: 'Oil Change',                   defaultBasePrice: 90,  defaultMinProfit: 45,  enabledByDefault: true },
    { id: 'Battery Replacement',          label: 'Battery Replacement',          defaultBasePrice: 120, defaultMinProfit: 60,  enabledByDefault: true },
    { id: 'Brake Pads & Rotors',          label: 'Brake Pads & Rotors',          defaultBasePrice: 280, defaultMinProfit: 130, enabledByDefault: true },
    { id: 'Alternator Replacement',       label: 'Alternator Replacement',       defaultBasePrice: 320, defaultMinProfit: 140, enabledByDefault: true },
    { id: 'Starter Replacement',          label: 'Starter Replacement',          defaultBasePrice: 300, defaultMinProfit: 135, enabledByDefault: true },
    { id: 'Spark Plug Replacement',       label: 'Spark Plug Replacement',       defaultBasePrice: 160, defaultMinProfit: 85,  enabledByDefault: true },
    { id: 'Belt Replacement',             label: 'Belt Replacement',             defaultBasePrice: 150, defaultMinProfit: 80,  enabledByDefault: true },
    { id: 'Serpentine Belt',              label: 'Serpentine Belt',              defaultBasePrice: 150, defaultMinProfit: 80,  enabledByDefault: true },
    { id: 'Hose Replacement',             label: 'Hose Replacement',             defaultBasePrice: 130, defaultMinProfit: 70,  enabledByDefault: true },
    { id: 'Radiator Replacement',         label: 'Radiator Replacement',         defaultBasePrice: 360, defaultMinProfit: 150, enabledByDefault: true },
    { id: 'Thermostat Replacement',       label: 'Thermostat Replacement',       defaultBasePrice: 180, defaultMinProfit: 90,  enabledByDefault: true },
    { id: 'Suspension Work',              label: 'Suspension Work',              defaultBasePrice: 350, defaultMinProfit: 150, enabledByDefault: true },
    { id: 'Pre-Purchase Inspection',      label: 'Pre-Purchase Inspection',      defaultBasePrice: 130, defaultMinProfit: 100, enabledByDefault: true },
    { id: 'Mobile Tune-Up',               label: 'Mobile Tune-Up',               defaultBasePrice: 200, defaultMinProfit: 110, enabledByDefault: true },
    { id: 'Fluid Services',               label: 'Fluid Services',               defaultBasePrice: 110, defaultMinProfit: 55,  enabledByDefault: true },
    { id: 'Fuel Pump Replacement',        label: 'Fuel Pump Replacement',        defaultBasePrice: 400, defaultMinProfit: 170, enabledByDefault: true },
    { id: 'Ignition Coil Replacement',    label: 'Ignition Coil Replacement',    defaultBasePrice: 190, defaultMinProfit: 95,  enabledByDefault: true },
    { id: 'General Repair',               label: 'General Repair',               defaultBasePrice: 120, defaultMinProfit: 60,  enabledByDefault: true },
    { id: 'Emergency Service',            label: 'Emergency Service',            defaultBasePrice: 75,  defaultMinProfit: 70,  enabledByDefault: true },
    { id: 'Same-Day Service',             label: 'Same-Day Service',             defaultBasePrice: 50,  defaultMinProfit: 48,  enabledByDefault: true },
    { id: 'After Hours',                  label: 'After Hours',                  defaultBasePrice: 65,  defaultMinProfit: 62,  enabledByDefault: true },
    { id: 'Highway Call',                 label: 'Highway Call',                 defaultBasePrice: 80,  defaultMinProfit: 75,  enabledByDefault: true },
    { id: 'Parts Pickup',                 label: 'Parts Pickup',                 defaultBasePrice: 45,  defaultMinProfit: 40,  enabledByDefault: true },
    { id: 'Travel Fee',                   label: 'Travel Fee',                   defaultBasePrice: 40,  defaultMinProfit: 38,  enabledByDefault: true },
    { id: 'Fleet Service',                label: 'Fleet Service',                defaultBasePrice: 250, defaultMinProfit: 180, enabledByDefault: false },
  ],

  jobFields: [
    { key: 'laborHours',       label: 'Labor Hours',          type: 'number', required: false },
    { key: 'partsCost',        label: 'Parts Cost',           type: 'number', required: false },
    { key: 'diagnosticCode',   label: 'Diagnostic Code',      type: 'text',   required: false },
    { key: 'vehicleMakeModel', label: 'Vehicle Make / Model', type: 'text',   required: false },
    { key: 'mileage',          label: 'Vehicle Mileage',      type: 'number', required: false },
  ],

  inventoryFields: [
    { key: 'partNumber', label: 'Part Number', type: 'text' },
    { key: 'partName',   label: 'Part Name',   type: 'text' },
    { key: 'supplier',   label: 'Supplier',    type: 'text' },
    { key: 'unitCost',   label: 'Unit Cost',   type: 'number' },
    { key: 'quantity',   label: 'Quantity',    type: 'number' },
  ],

  copy: {
    jobNounSingular: 'repair job',
    jobNounPlural: 'repair jobs',
    emptyJobsHint: 'No jobs logged yet — quote a repair to get started.',
    inventoryLabel: 'Parts Inventory',
  },

  defaultExpenseCategories: ['Parts', 'Labor', 'Tools & Equipment', 'Vehicle', 'Insurance', 'Misc'],

  features: {
    inventoryDeduction: false,
    photoCapture: false,
    vehicleDiagnostics: true,
    vehicleSizeMultiplier: false,
    roadsideAddons: false,
  },

  invoiceTemplateKey: 'mechanic',

  dashboardMetrics: [
    {
      id: 'revenue_week',
      label: 'Revenue this week',
      format: 'currency',
      compute: (jobs, _s) =>
        r2(jobs.filter(isThisWeek).reduce((sum, j) => sum + revenueOf(j), 0)),
    },
    {
      id: 'labor_hours_week',
      label: 'Labor hours billed (week)',
      format: 'number',
      compute: (jobs, _s) =>
        r2(jobs.filter(isThisWeek).reduce(
          (sum, j) => sum + Number((j as Job & { laborHours?: number }).laborHours || 0),
          0,
        )),
    },
    {
      id: 'avg_ticket',
      label: 'Average ticket',
      format: 'currency',
      compute: (jobs, _s) => {
        const completed = jobs.filter((j) => j.status === 'Completed');
        if (completed.length === 0) return 0;
        return r2(completed.reduce((sum, j) => sum + revenueOf(j), 0) / completed.length);
      },
    },
  ],
};
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/config/businessTypes/mechanic.ts
git commit -m "feat(business-types): mechanic config (verbatim port + features/dashboardMetrics)"
```

---

### Task A.4: Detailing skeleton

**Files:**
- Create: `src/config/businessTypes/detailing.ts`

- [ ] **Step 1: Create detailing.ts skeleton**

```ts
// src/config/businessTypes/detailing.ts
// ═══════════════════════════════════════════════════════════════════
//  Detailing vertical config — SKELETON for Phase 2.1.
//
//  Phase 2.1 ships the registry slot + pricing-model declaration so
//  the union type stays exhaustive and a "Add Business → Detailing"
//  attempt (if exposed to the UI later) can resolve a valid config.
//
//  Service catalog, job fields, inventory fields, real
//  vehicleSizeMultipliers, and a populated dashboardMetrics array
//  are deferred to Phase 2.3 (Detailing full slice). Until then this
//  config renders an empty service picker and an empty dashboard —
//  acceptable because the AddBusinessModal does NOT currently expose
//  Detailing as a selectable business type. The slot exists for
//  forward compatibility.
// ═══════════════════════════════════════════════════════════════════

import type { BusinessTypeConfig } from './types';

export const DETAILING_CONFIG: BusinessTypeConfig = {
  key: 'detailing',
  displayName: 'Mobile Car Wash & Detailing',
  shortName: 'Detailing',

  pricingModel: {
    kind: 'package_multiplier',
    vehicleSizeMultipliers: {
      Sedan: 1.0,
      SUV: 1.25,
      Truck: 1.3,
      'XL SUV': 1.5,
      Van: 1.4,
    },
  },

  services: [],
  jobFields: [],
  inventoryFields: [],

  copy: {
    jobNounSingular: 'detail',
    jobNounPlural: 'details',
    emptyJobsHint: 'No jobs logged yet — quote a detail to get started.',
    inventoryLabel: 'Detailing Supplies',
  },

  defaultExpenseCategories: ['Chemicals', 'Supplies', 'Equipment', 'Vehicle', 'Insurance', 'Misc'],

  features: {
    inventoryDeduction: false,
    photoCapture: true,
    vehicleDiagnostics: false,
    vehicleSizeMultiplier: true,
    roadsideAddons: false,
  },

  invoiceTemplateKey: 'detailing',

  dashboardMetrics: [],
};
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/config/businessTypes/detailing.ts
git commit -m "feat(business-types): detailing skeleton config (filled in Phase 2.3)"
```

---

### Task A.5: Registry + feature-flag accessor

**Files:**
- Create: `src/config/businessTypes/registry.ts`

- [ ] **Step 1: Create registry.ts**

```ts
// src/config/businessTypes/registry.ts
// ═══════════════════════════════════════════════════════════════════
//  Business-type registry — strongly-typed lookup by key. No dynamic
//  plugin loading (per Phase 2.1 architectural directive: "Favor
//  strongly typed registries over dynamic runtime injection").
// ═══════════════════════════════════════════════════════════════════

import type { BusinessTypeConfig, BusinessTypeKey } from './types';
import { TIRE_CONFIG } from './tire';
import { MECHANIC_CONFIG } from './mechanic';
import { DETAILING_CONFIG } from './detailing';

export const BUSINESS_TYPE_REGISTRY: Readonly<Record<BusinessTypeKey, BusinessTypeConfig>> = {
  tire: TIRE_CONFIG,
  mechanic: MECHANIC_CONFIG,
  detailing: DETAILING_CONFIG,
};

/**
 * Resolve a BusinessTypeConfig for the given key. Unknown / null /
 * undefined keys safely degrade to TIRE_CONFIG — every existing
 * tire business (whose settings doc has no `businessType` field)
 * resolves correctly through this path.
 */
export function getBusinessTypeConfig(
  key: BusinessTypeKey | null | undefined,
): BusinessTypeConfig {
  if (key && BUSINESS_TYPE_REGISTRY[key]) {
    return BUSINESS_TYPE_REGISTRY[key];
  }
  return TIRE_CONFIG;
}

/**
 * Top-level feature lookup. UI gates that depend on a feature call
 * this rather than checking `config.features.<x>` directly so we
 * have one chokepoint for cross-cutting toggles.
 */
export function hasFeature(
  key: BusinessTypeKey | null | undefined,
  feature: keyof BusinessTypeConfig['features'],
): boolean {
  return getBusinessTypeConfig(key).features[feature];
}

// Re-export types so callers can `import { … } from '@/config/businessTypes/registry'`
// and get everything they need without importing types.ts separately.
export type {
  BusinessTypeConfig,
  BusinessTypeKey,
  BusinessTypeService,
  BusinessTypeJobField,
  BusinessTypeInventoryField,
  BusinessTypeCopy,
  BusinessTypeFeatures,
  DashboardMetricSpec,
  PricingModel,
  FlatPricingModel,
  LaborPartsPricingModel,
  PackageMultiplierPricingModel,
} from './types';

export { DEFAULT_BUSINESS_TYPE_KEY } from './types';
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: succeeds. The registry pulls in all three configs; type errors here would mean a config file diverged from the type contract.

- [ ] **Step 3: Commit**

```bash
git add src/config/businessTypes/registry.ts
git commit -m "feat(business-types): typed registry with feature-flag accessor"
```

---

### Task A.6: Widen Settings.businessType to include `'detailing'`

**Files:**
- Modify: `src/types/index.ts:461-471`

- [ ] **Step 1: Read the current type**

The current declaration at [src/types/index.ts:458-472](../../../src/types/index.ts#L458-L472) (lines may shift slightly — anchor on the field comment):

```ts
  /**
   * Which business vertical this is — 'tire' | 'mechanic' | 'carwash'.
   * Optional for back-compat: legacy tire businesses have no
   * businessType field and resolve to 'tire' via verticalContext.
   */
  businessType?: 'tire' | 'mechanic' | 'carwash';
```

- [ ] **Step 2: Replace with the new union**

```ts
  /**
   * Which business vertical this is — see BusinessTypeKey in
   * src/config/businessTypes/types.ts.
   * Optional for back-compat: legacy tire businesses have no
   * businessType field and resolve to 'tire' via verticalContext.
   *
   * Phase 2.1 renamed 'carwash' to 'detailing' to match product
   * nomenclature; safe rename because no production business has
   * ever had businessType: 'carwash' written.
   */
  businessType?: 'tire' | 'mechanic' | 'detailing';
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: succeeds. The string-union change is binary-compatible with every existing read path (resolveVerticalKey handles unknown strings by falling back to `'tire'`).

- [ ] **Step 4: Commit**

```bash
git add src/types/index.ts
git commit -m "feat(types): rename Settings.businessType 'carwash' -> 'detailing'"
```

---

### Task A.7: Update KNOWN_VERTICAL_KEYS for the rename

**Files:**
- Modify: `src/lib/verticalContext.ts:46-50`

- [ ] **Step 1: Read the current Set**

Current at [src/lib/verticalContext.ts:46-50](../../../src/lib/verticalContext.ts#L46-L50):

```ts
const KNOWN_VERTICAL_KEYS: ReadonlySet<string> = new Set<VerticalKey>([
  'tire',
  'mechanic',
  'carwash',
]);
```

- [ ] **Step 2: Replace**

```ts
const KNOWN_VERTICAL_KEYS: ReadonlySet<string> = new Set<VerticalKey>([
  'tire',
  'mechanic',
  'detailing',
]);
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/lib/verticalContext.ts
git commit -m "feat(verticals): KNOWN_VERTICAL_KEYS - 'carwash' -> 'detailing'"
```

---

### Task A.8: Convert src/lib/verticals.ts to a back-compat shim

**Files:**
- Modify: `src/lib/verticals.ts` (full file replace)

This is the lynchpin of back-compat. Every existing `import { … } from '@/lib/verticals'` keeps working without an edit.

- [ ] **Step 1: Read the current file (already understood — it's the dormant scaffolding from earlier).**

- [ ] **Step 2: Replace with the shim**

```ts
// src/lib/verticals.ts
// ═══════════════════════════════════════════════════════════════════
//  DEPRECATED RE-EXPORT SHIM
//  ────────────────────────
//  As of Phase 2.1 (commit reference: <fill in after merge>), the
//  vertical configs live under `src/config/businessTypes/`. This
//  module re-exports the new symbols under the old names so every
//  existing `import { … } from '@/lib/verticals'` keeps compiling
//  with zero edits. New code SHOULD import from
//  `@/config/businessTypes/registry` directly.
//
//  KEEP this shim for one full release cycle. Remove only after the
//  call-site rename pass (tracked separately, not a Phase 2.1 task).
// ═══════════════════════════════════════════════════════════════════

import {
  BUSINESS_TYPE_REGISTRY,
  getBusinessTypeConfig,
} from '@/config/businessTypes/registry';
import type {
  BusinessTypeConfig,
  BusinessTypeKey,
  BusinessTypeService,
  BusinessTypeJobField,
  BusinessTypeInventoryField,
  BusinessTypeCopy,
  PricingModel,
  FlatPricingModel,
  LaborPartsPricingModel,
  PackageMultiplierPricingModel,
} from '@/config/businessTypes/types';

// ─── Back-compat type aliases ──────────────────────────────────────
// Old names map to new ones. Every existing call site keeps working
// without an edit.

/** @deprecated use BusinessTypeKey from '@/config/businessTypes/registry' */
export type VerticalKey = BusinessTypeKey;

/** @deprecated use BusinessTypeConfig from '@/config/businessTypes/registry' */
export type VerticalConfig = BusinessTypeConfig;

/** @deprecated use BusinessTypeService from '@/config/businessTypes/registry' */
export type VerticalService = BusinessTypeService;

/** @deprecated use BusinessTypeJobField from '@/config/businessTypes/registry' */
export type VerticalJobField = BusinessTypeJobField;

/** @deprecated use BusinessTypeInventoryField from '@/config/businessTypes/registry' */
export type VerticalInventoryField = BusinessTypeInventoryField;

/** @deprecated use BusinessTypeCopy from '@/config/businessTypes/registry' */
export type VerticalCopy = BusinessTypeCopy;

/** @deprecated use PricingModel from '@/config/businessTypes/registry' */
export type { PricingModel, FlatPricingModel, LaborPartsPricingModel, PackageMultiplierPricingModel };

// ─── Back-compat constants / functions ─────────────────────────────

/** @deprecated import { TIRE_CONFIG } from '@/config/businessTypes/tire' */
export { TIRE_CONFIG as TIRE_VERTICAL } from '@/config/businessTypes/tire';

/** @deprecated import { MECHANIC_CONFIG } from '@/config/businessTypes/mechanic' */
export { MECHANIC_CONFIG as MECHANIC_VERTICAL } from '@/config/businessTypes/mechanic';

/** @deprecated import { BUSINESS_TYPE_REGISTRY } from '@/config/businessTypes/registry' */
export const VERTICAL_REGISTRY: Partial<Record<BusinessTypeKey, BusinessTypeConfig>> =
  BUSINESS_TYPE_REGISTRY;

/** @deprecated use DEFAULT_BUSINESS_TYPE_KEY from '@/config/businessTypes/registry' */
export const DEFAULT_VERTICAL_KEY: BusinessTypeKey = 'tire';

/** @deprecated use getBusinessTypeConfig from '@/config/businessTypes/registry' */
export function getVerticalConfig(
  key: BusinessTypeKey | null | undefined,
): BusinessTypeConfig {
  return getBusinessTypeConfig(key);
}

// ─── servicePricingFromVertical: preserved for createBusiness.ts ───
// Already used by Phase 1 (createBusiness step 2). Kept here so the
// import path stays stable. Future move target: a new shape-conversion
// module under @/config/businessTypes/ — not in 2.1.

/** Build a servicePricing map from a vertical's service catalog. */
export function servicePricingFromVertical(
  config: BusinessTypeConfig,
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
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: succeeds. Every existing `import { … } from '@/lib/verticals'` resolves through the shim.

- [ ] **Step 4: Smoke test on dev server**

```bash
npm run dev
```

Open `http://localhost:5173`. Sign in as a tire account. Confirm:
- Dashboard renders.
- Settings → Service Pricing shows the 15 tire services.
- No `Missing or insufficient permissions` in console.
- No `[brand] settings listener error`.

Stop the dev server.

- [ ] **Step 5: Commit**

```bash
git add src/lib/verticals.ts
git commit -m "refactor(verticals): convert to back-compat shim re-exporting @/config/businessTypes"
```

**Milestone A checkpoint:** `npm run build` green; tire workflow unchanged; new registry callable from the new path AND the old path; no consumer has migrated yet.

---

## Milestone B — Pricing Engine Extraction

Goal: extract today's pricing function into per-model engines; the public surface of `src/lib/pricing.ts` stays identical so callers don't notice.

### Task B.1: Extract the flat pricing engine

**Files:**
- Create: `src/config/businessTypes/pricing/flat.ts`

Reference: [src/lib/pricing.ts](../../../src/lib/pricing.ts) — today's entire `computeBreakdown` function body becomes the new flat engine.

- [ ] **Step 1: Create flat.ts**

```ts
// src/config/businessTypes/pricing/flat.ts
// ═══════════════════════════════════════════════════════════════════
//  Flat-pricing engine — used by the tire vertical.
//
//  Computation is VERBATIM identical to today's
//  src/lib/pricing.ts::computeBreakdown. The dispatcher at
//  pricing/index.ts wraps the result with `model: 'flat'` for type
//  discrimination. Every existing call site that reads
//  `breakdown.revenue / profit / directCost / …` continues to work.
// ═══════════════════════════════════════════════════════════════════

import type { Job, Settings } from '@/types';
import { r2 } from '@/lib/utils';

export interface FlatBreakdown {
  revenue: number;
  tireCost: number;
  materialCost: number;
  travelCost: number;
  travelMiles: number;
  travelChargeable: number;
  freeMilesIncluded: number;
  directCost: number;
  profit: number;
  profitMargin: number;
  quantity: number;
}

export function computeFlatPrice(
  j: Pick<Job, 'revenue' | 'tireCost' | 'materialCost' | 'miscCost' | 'miles' | 'qty'>,
  s: Settings,
): FlatBreakdown {
  const revenue = Number(j.revenue || 0);
  const tireCost = Number(j.tireCost || 0);
  const materialCost = Number(j.materialCost || j.miscCost || 0);
  const miles = Number(j.miles || 0);
  const freeMiles = Number(s.freeMilesIncluded || 0);
  const chargeable = Math.max(0, miles - freeMiles);
  const travelCost = r2(chargeable * Number(s.costPerMile || 0.65));
  const directCost = r2(tireCost + materialCost + travelCost);
  const profit = r2(revenue - directCost);
  return {
    revenue: r2(revenue),
    tireCost: r2(tireCost),
    materialCost: r2(materialCost),
    travelCost,
    travelMiles: miles,
    travelChargeable: chargeable,
    freeMilesIncluded: freeMiles,
    directCost,
    profit,
    profitMargin: revenue > 0 ? profit / revenue : 0,
    quantity: Math.max(1, Math.floor(Number(j.qty) || 1)),
  };
}
```

- [ ] **Step 2: Inline numerical sanity check (documentation, not a runner)**

A quick mental check: a tire job with `revenue: 200, tireCost: 50, materialCost: 10, miles: 15, qty: 1`, settings with `freeMilesIncluded: 5, costPerMile: 0.65`, should produce:
- chargeable miles: max(0, 15 - 5) = 10
- travelCost: r2(10 * 0.65) = 6.50
- directCost: r2(50 + 10 + 6.50) = 66.50
- profit: r2(200 - 66.50) = 133.50
- profitMargin: 133.50 / 200 = 0.6675

This matches what `computeBreakdown` returns today for the same inputs.

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: succeeds. No call site uses flat.ts yet (the wiring lands in B.5).

- [ ] **Step 4: Commit**

```bash
git add src/config/businessTypes/pricing/flat.ts
git commit -m "feat(pricing): extract flat engine (verbatim from src/lib/pricing.ts)"
```

---

### Task B.2: Labor+parts pricing engine (mechanic)

**Files:**
- Create: `src/config/businessTypes/pricing/laborParts.ts`

- [ ] **Step 1: Create laborParts.ts**

```ts
// src/config/businessTypes/pricing/laborParts.ts
// ═══════════════════════════════════════════════════════════════════
//  Labor+parts pricing engine — used by the mechanic vertical.
//
//  Inputs the form will collect (declared in MECHANIC_CONFIG.jobFields):
//   - laborHours      (number; optional)
//   - partsCost       (number; optional)
//   - revenue         (the customer-facing total entered by tech)
//   - miles           (travel — same as tire's travel calc)
//
//  This engine treats `revenue` as the source of truth for what the
//  customer was charged (matching today's flat-engine semantics
//  for tire). The breakdown reverses the costs to show profit and
//  what each line cost the business:
//    directCost = laborCost + partsCost + partsMarkupAmount
//                 + diagnosticFee + travelCost
//    where laborCost = laborHours * defaultLaborRate from the model
//          partsMarkupAmount = partsCost * defaultPartsMarkupPct / 100
//          diagnosticFee = 0 unless the job included diagnostics
//                          (the form will set it via a checkbox in 2.2;
//                          for 2.1 the engine accepts a `diagnosticFee`
//                          override on the job, default 0)
//
//  All numbers rounded via r2 like the flat engine.
// ═══════════════════════════════════════════════════════════════════

import type { Job, Settings } from '@/types';
import type { LaborPartsPricingModel } from '../types';
import { r2 } from '@/lib/utils';

export interface LaborPartsBreakdown {
  revenue: number;
  laborHours: number;
  laborRate: number;
  laborCost: number;
  partsCost: number;
  partsMarkupPct: number;
  partsMarkupAmount: number;
  diagnosticFee: number;
  travelCost: number;
  travelMiles: number;
  travelChargeable: number;
  freeMilesIncluded: number;
  directCost: number;
  profit: number;
  profitMargin: number;
  quantity: number;
}

// ─── Optional mechanic-specific Job fields ─────────────────────────
// 2.1 hasn't extended the Job type with these yet; we read them via
// a widened cast so the engine compiles without a schema change.
// The Job type extension lands in Phase 2.2's first task.
type MechanicJobShape = Job & {
  laborHours?: number | string;
  partsCost?: number | string;
  diagnosticFee?: number | string;
};

export function computeLaborPartsPrice(
  j: MechanicJobShape,
  s: Settings,
  model: LaborPartsPricingModel,
): LaborPartsBreakdown {
  const revenue = Number(j.revenue || 0);
  const laborHours = Number(j.laborHours || 0);
  const laborRate = Number(model.defaultLaborRate);
  const laborCost = r2(laborHours * laborRate);

  const partsCost = Number(j.partsCost || 0);
  const partsMarkupPct = Number(model.defaultPartsMarkupPct);
  const partsMarkupAmount = r2(partsCost * (partsMarkupPct / 100));

  const diagnosticFee = Number(j.diagnosticFee || 0);

  const miles = Number(j.miles || 0);
  const freeMiles = Number(s.freeMilesIncluded || 0);
  const chargeable = Math.max(0, miles - freeMiles);
  const travelCost = r2(chargeable * Number(s.costPerMile || 0.65));

  const directCost = r2(
    laborCost + partsCost + partsMarkupAmount + diagnosticFee + travelCost,
  );
  const profit = r2(revenue - directCost);

  return {
    revenue: r2(revenue),
    laborHours,
    laborRate,
    laborCost,
    partsCost: r2(partsCost),
    partsMarkupPct,
    partsMarkupAmount,
    diagnosticFee: r2(diagnosticFee),
    travelCost,
    travelMiles: miles,
    travelChargeable: chargeable,
    freeMilesIncluded: freeMiles,
    directCost,
    profit,
    profitMargin: revenue > 0 ? profit / revenue : 0,
    quantity: Math.max(1, Math.floor(Number(j.qty) || 1)),
  };
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/config/businessTypes/pricing/laborParts.ts
git commit -m "feat(pricing): labor+parts engine for mechanic vertical"
```

---

### Task B.3: Package-multiplier stub (detailing)

**Files:**
- Create: `src/config/businessTypes/pricing/packageMult.ts`

- [ ] **Step 1: Create stub**

```ts
// src/config/businessTypes/pricing/packageMult.ts
// ═══════════════════════════════════════════════════════════════════
//  Package-multiplier pricing engine — STUB for Phase 2.1.
//
//  Filled in by Phase 2.3 (Detailing full slice). For now the
//  engine returns a trivial breakdown so the dispatcher's switch
//  remains exhaustive. The detailing vertical has no UI consumers
//  in 2.1, so this stub is never actually called at runtime.
// ═══════════════════════════════════════════════════════════════════

import type { Job, Settings } from '@/types';
import type { PackageMultiplierPricingModel } from '../types';
import { r2 } from '@/lib/utils';

export interface PackageMultBreakdown {
  revenue: number;
  vehicleSize: string;
  vehicleSizeMultiplier: number;
  directCost: number;
  profit: number;
  profitMargin: number;
  quantity: number;
}

export function computePackageMultiplierPrice(
  j: Job & { vehicleSize?: string },
  _s: Settings,
  model: PackageMultiplierPricingModel,
): PackageMultBreakdown {
  const revenue = Number(j.revenue || 0);
  const vehicleSize = j.vehicleSize || 'Sedan';
  const multiplier = model.vehicleSizeMultipliers[vehicleSize] ?? 1;
  return {
    revenue: r2(revenue),
    vehicleSize,
    vehicleSizeMultiplier: multiplier,
    directCost: 0,
    profit: r2(revenue),
    profitMargin: revenue > 0 ? 1 : 0,
    quantity: Math.max(1, Math.floor(Number(j.qty) || 1)),
  };
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/config/businessTypes/pricing/packageMult.ts
git commit -m "feat(pricing): package-multiplier stub (filled in Phase 2.3)"
```

---

### Task B.4: Pricing dispatcher

**Files:**
- Create: `src/config/businessTypes/pricing/index.ts`

- [ ] **Step 1: Create dispatcher**

```ts
// src/config/businessTypes/pricing/index.ts
// ═══════════════════════════════════════════════════════════════════
//  Pricing dispatcher — picks the engine by PricingModel.kind.
//
//  Public callers should NOT import this directly; they call the
//  thin wrapper in src/lib/pricing.ts which resolves the active
//  business type via verticalContext and dispatches here.
// ═══════════════════════════════════════════════════════════════════

import type { Job, Settings } from '@/types';
import type { PricingModel } from '../types';
import { computeFlatPrice, type FlatBreakdown } from './flat';
import { computeLaborPartsPrice, type LaborPartsBreakdown } from './laborParts';
import { computePackageMultiplierPrice, type PackageMultBreakdown } from './packageMult';

export type PricingBreakdownTagged =
  | (FlatBreakdown & { model: 'flat' })
  | (LaborPartsBreakdown & { model: 'labor_parts' })
  | (PackageMultBreakdown & { model: 'package_multiplier' });

export function computePrice(
  job: Job,
  settings: Settings,
  model: PricingModel,
): PricingBreakdownTagged {
  switch (model.kind) {
    case 'flat':
      return { ...computeFlatPrice(job, settings), model: 'flat' };
    case 'labor_parts':
      return { ...computeLaborPartsPrice(job, settings, model), model: 'labor_parts' };
    case 'package_multiplier':
      return { ...computePackageMultiplierPrice(job, settings, model), model: 'package_multiplier' };
  }
}

export type { FlatBreakdown, LaborPartsBreakdown, PackageMultBreakdown };
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/config/businessTypes/pricing/index.ts
git commit -m "feat(pricing): dispatcher for flat/labor_parts/package_multiplier models"
```

---

### Task B.5: Rewrite src/lib/pricing.ts as a thin dispatcher

**Files:**
- Modify: `src/lib/pricing.ts` (full file replace)

Existing public surface to preserve: `computeBreakdown(job, settings) -> PricingBreakdown` and the `PricingBreakdown` interface itself. Every consumer reads `revenue / profit / directCost / quantity` — those fields exist on FlatBreakdown.

- [ ] **Step 1: Replace src/lib/pricing.ts**

```ts
// src/lib/pricing.ts
// ═══════════════════════════════════════════════════════════════════
//  Pricing — thin compatibility wrapper that dispatches to the
//  active business type's engine.
//
//  Public surface: computeBreakdown(job, settings) returning a
//  PricingBreakdown identical to what this module exported before
//  Phase 2.1. Tire businesses hit the flat engine (same numbers as
//  before); mechanic businesses hit the labor+parts engine; detailing
//  businesses hit the package-multiplier stub.
//
//  Old export name preserved so every existing call site
//  (`computeBreakdown(j, s)`) keeps compiling and behaving identically
//  for tire.
// ═══════════════════════════════════════════════════════════════════

import type { Job, Settings } from '@/types';
import { resolveVertical } from '@/lib/verticalContext';
import { computePrice, type PricingBreakdownTagged } from '@/config/businessTypes/pricing';

// Preserve the original PricingBreakdown shape (every existing caller
// reads only these fields). It happens to be the shape of FlatBreakdown.
export interface PricingBreakdown {
  revenue: number;
  tireCost: number;
  materialCost: number;
  travelCost: number;
  travelMiles: number;
  travelChargeable: number;
  freeMilesIncluded: number;
  directCost: number;
  profit: number;
  profitMargin: number;
  quantity: number;
}

/**
 * Compute the per-job pricing breakdown for the active business type.
 *
 * For tire (flat model) the return value is byte-for-byte identical
 * to the pre-Phase-2.1 implementation. For mechanic/detailing the
 * shape is widened — non-flat fields (laborCost, partsMarkupAmount,
 * vehicleSizeMultiplier, etc.) are present on the tagged breakdown
 * but require callers to narrow on `.model`. Existing call sites
 * only read the shared fields and continue working unchanged.
 */
export function computeBreakdown(
  j: Job,
  s: Settings,
): PricingBreakdown {
  const config = resolveVertical(s);
  const tagged = computePrice(j, s, config.pricingModel);

  // Normalize the tagged breakdown into the legacy PricingBreakdown
  // shape — every caller reads these fields. Non-flat engines fill
  // tireCost/materialCost with 0 (mechanic uses partsCost+laborCost
  // semantically, not tireCost — but exposing them as 0 keeps the
  // shared shape intact).
  switch (tagged.model) {
    case 'flat':
      return {
        revenue: tagged.revenue,
        tireCost: tagged.tireCost,
        materialCost: tagged.materialCost,
        travelCost: tagged.travelCost,
        travelMiles: tagged.travelMiles,
        travelChargeable: tagged.travelChargeable,
        freeMilesIncluded: tagged.freeMilesIncluded,
        directCost: tagged.directCost,
        profit: tagged.profit,
        profitMargin: tagged.profitMargin,
        quantity: tagged.quantity,
      };
    case 'labor_parts':
      return {
        revenue: tagged.revenue,
        tireCost: 0,
        materialCost: tagged.partsCost + tagged.partsMarkupAmount + tagged.laborCost + tagged.diagnosticFee,
        travelCost: tagged.travelCost,
        travelMiles: tagged.travelMiles,
        travelChargeable: tagged.travelChargeable,
        freeMilesIncluded: tagged.freeMilesIncluded,
        directCost: tagged.directCost,
        profit: tagged.profit,
        profitMargin: tagged.profitMargin,
        quantity: tagged.quantity,
      };
    case 'package_multiplier':
      return {
        revenue: tagged.revenue,
        tireCost: 0,
        materialCost: 0,
        travelCost: 0,
        travelMiles: 0,
        travelChargeable: 0,
        freeMilesIncluded: 0,
        directCost: tagged.directCost,
        profit: tagged.profit,
        profitMargin: tagged.profitMargin,
        quantity: tagged.quantity,
      };
  }
}

/**
 * Tagged-breakdown accessor for callers that need engine-specific
 * fields. Phase 2.2+ UI uses this directly. computeBreakdown remains
 * the back-compat shim for tire's existing call sites.
 */
export function computeBreakdownTagged(
  j: Job,
  s: Settings,
): PricingBreakdownTagged {
  const config = resolveVertical(s);
  return computePrice(j, s, config.pricingModel);
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: succeeds. Existing call sites read `revenue / profit / directCost / etc.` from the returned `PricingBreakdown`; the dispatcher returns exactly that shape for tire.

- [ ] **Step 3: Smoke test on dev server**

```bash
npm run dev
```

Sign in as a tire account. Add a quick job (Add → Tire Replacement → fill revenue $200, tireCost $50, miles 15, qty 1 → save). Open the job detail. Profit and direct cost should match the same job before this change. Check the dashboard "Profit this week" card adjusts correctly.

Stop the dev server.

- [ ] **Step 4: Commit**

```bash
git add src/lib/pricing.ts
git commit -m "refactor(pricing): dispatch via active business type, preserve tire numbers"
```

**Milestone B checkpoint:** `npm run build` green; tire pricing is byte-identical to before; mechanic + detailing engines exist but no UI calls them yet.

---

## Milestone C — Invoice Template Extraction

Goal: per-vertical invoice templates. Tire invoice output is byte-identical to before; mechanic gets a mechanic-styled invoice; detailing gets a skeleton.

### Task C.1: Invoice template types

**Files:**
- Create: `src/config/businessTypes/invoice/types.ts`

- [ ] **Step 1: Create types**

```ts
// src/config/businessTypes/invoice/types.ts
// ═══════════════════════════════════════════════════════════════════
//  Invoice template type contract — one InvoiceTemplate per business
//  type. The PDF generator in src/lib/invoice.ts reads these
//  per-vertical settings to produce a vertical-appropriate invoice.
// ═══════════════════════════════════════════════════════════════════

import type { Job } from '@/types';

export interface InvoiceTemplate {
  /** Header subtitle, e.g. "Mobile Tire & Roadside Service". */
  subtitle: string;
  /**
   * Resolve a stored service name into the customer-friendly form
   * used on the printed invoice. Each vertical owns its map.
   */
  resolveServiceName: (raw: string | null | undefined) => string;
  /** Footer disclaimer / warranty boilerplate, vertical-specific. */
  footerCopy: string;
  /**
   * Which Job fields render in the line-item description column.
   * Tire: ['tireSize', 'tireBrand', 'tireModel']
   * Mechanic: ['vehicleMakeModel', 'mileage', 'diagnosticCode']
   * Detailing: ['vehicleSize'] (filled in 2.3)
   */
  lineItemFields: ReadonlyArray<keyof Job>;
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/config/businessTypes/invoice/types.ts
git commit -m "feat(invoice): per-vertical InvoiceTemplate type contract"
```

---

### Task C.2: Tire invoice template

**Files:**
- Create: `src/config/businessTypes/invoice/tire.ts`

Reference: today's `customerFriendlyServiceName` function in [src/lib/invoice.ts](../../../src/lib/invoice.ts) lines 17-47.

- [ ] **Step 1: Create tire invoice template**

```ts
// src/config/businessTypes/invoice/tire.ts
// ═══════════════════════════════════════════════════════════════════
//  Tire invoice template — extracts today's customerFriendlyServiceName
//  table from src/lib/invoice.ts verbatim. Existing tire invoices
//  render byte-for-byte identically after this lands.
// ═══════════════════════════════════════════════════════════════════

import type { InvoiceTemplate } from './types';

function resolveTireServiceName(raw: string | null | undefined): string {
  if (!raw) return 'Mobile Tire Service';
  const k = raw.trim().toLowerCase();

  // VERBATIM order from src/lib/invoice.ts (specific keys first).
  const map: Array<[string, string]> = [
    ['tire repair',           'Flat Tire Repair Service'],
    ['flat tire',             'Flat Tire Repair Service'],
    ['tire replacement',      'Mobile Tire Replacement Service'],
    ['tire installation',     'Tire Installation Service'],
    ['tire change',           'Mobile Tire Replacement Service'],
    ['spare',                 'Spare Tire Installation'],
    ['mount',                 'Tire Mount & Balance'],
    ['balance',               'Tire Mount & Balance'],
    ['roadside',              'Emergency Roadside Tire Service'],
    ['emergency',             'Emergency Roadside Tire Service'],
    ['rotation',              'Tire Rotation Service'],
    ['tractor-trailer',       'Commercial Tire Service'],
    ['semi',                  'Commercial Tire Service'],
    ['plug',                  'Flat Tire Repair Service'],
    ['patch',                 'Flat Tire Repair Service'],
    ['tire',                  'Mobile Tire Service'],
    ['service',               'Mobile Tire Service'],
    ['dispatch',              'Mobile Tire Service'],
  ];

  for (const [needle, friendly] of map) {
    if (k.includes(needle)) return friendly;
  }
  return raw;
}

export const TIRE_INVOICE_TEMPLATE: InvoiceTemplate = {
  subtitle: 'Mobile Tire & Roadside Service',
  resolveServiceName: resolveTireServiceName,
  footerCopy:
    'All work is guaranteed for 30 days against defects in workmanship. ' +
    'Customer is responsible for following any care/break-in instructions provided.',
  lineItemFields: ['tireSize', 'tireBrand', 'tireModel'] as const,
};
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/config/businessTypes/invoice/tire.ts
git commit -m "feat(invoice): extract tire template (verbatim from src/lib/invoice.ts)"
```

---

### Task C.3: Mechanic invoice template

**Files:**
- Create: `src/config/businessTypes/invoice/mechanic.ts`

- [ ] **Step 1: Create mechanic template**

```ts
// src/config/businessTypes/invoice/mechanic.ts
// ═══════════════════════════════════════════════════════════════════
//  Mechanic invoice template. Service-name map is mechanic-friendly
//  (diagnostic → "Diagnostic Service", etc.). Footer mentions parts
//  warranty separately from labor warranty. Line items show vehicle
//  make/model and mileage.
// ═══════════════════════════════════════════════════════════════════

import type { InvoiceTemplate } from './types';

function resolveMechanicServiceName(raw: string | null | undefined): string {
  if (!raw) return 'Mobile Mechanic Service';
  const k = raw.trim().toLowerCase();

  const map: Array<[string, string]> = [
    ['diagnostic',          'Vehicle Diagnostic Service'],
    ['check engine',        'Check Engine Light Diagnosis'],
    ['oil change',          'Oil & Filter Change'],
    ['battery',             'Battery Replacement Service'],
    ['brake',               'Brake System Service'],
    ['alternator',          'Alternator Replacement'],
    ['starter',             'Starter Replacement'],
    ['spark plug',          'Spark Plug Replacement'],
    ['serpentine',          'Serpentine Belt Replacement'],
    ['belt',                'Belt Replacement Service'],
    ['hose',                'Cooling System Hose Replacement'],
    ['radiator',            'Radiator Replacement'],
    ['thermostat',          'Thermostat Replacement'],
    ['suspension',          'Suspension Repair'],
    ['pre-purchase',        'Pre-Purchase Inspection'],
    ['tune-up',             'Mobile Tune-Up Service'],
    ['fluid',               'Vehicle Fluid Service'],
    ['fuel pump',           'Fuel Pump Replacement'],
    ['ignition coil',       'Ignition Coil Replacement'],
    ['repair',              'Mobile Mechanic Service'],
    ['service',             'Mobile Mechanic Service'],
  ];

  for (const [needle, friendly] of map) {
    if (k.includes(needle)) return friendly;
  }
  return raw;
}

export const MECHANIC_INVOICE_TEMPLATE: InvoiceTemplate = {
  subtitle: 'Mobile Mechanic Service',
  resolveServiceName: resolveMechanicServiceName,
  footerCopy:
    'Labor is guaranteed for 90 days. Parts carry the manufacturer warranty included with each part. ' +
    'No-start and intermittent issues may require return visits for proper diagnosis.',
  lineItemFields: ['vehicleMakeModel', 'mileage', 'diagnosticCode'] as const,
};
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: succeeds. The `lineItemFields` typed `keyof Job` clause requires `vehicleMakeModel`/`mileage`/`diagnosticCode` to exist on `Job`. If `tsc` errors here, those fields need to be added to `Job` as optional — Step 3 below performs that extension.

- [ ] **Step 3: If Job type errors, extend Job in src/types/index.ts**

Find the `export interface Job {` block. Add at the end of the field list:

```ts
  // ─── Mechanic-specific job fields (declared optional so tire jobs
  // are unaffected). Form binding lands in Phase 2.2's Add Job rework.
  laborHours?: number;
  partsCost?: number;
  diagnosticCode?: string;
  vehicleMakeModel?: string;
  mileage?: number;
  diagnosticFee?: number;

  // ─── Detailing-specific job field (filled in Phase 2.3).
  vehicleSize?: string;
```

Re-run `npm run build`.

- [ ] **Step 4: Commit**

```bash
git add src/config/businessTypes/invoice/mechanic.ts src/types/index.ts
git commit -m "feat(invoice): mechanic template + optional mechanic/detailing Job fields"
```

---

### Task C.4: Detailing invoice skeleton

**Files:**
- Create: `src/config/businessTypes/invoice/detailing.ts`

- [ ] **Step 1: Create detailing template skeleton**

```ts
// src/config/businessTypes/invoice/detailing.ts
// ═══════════════════════════════════════════════════════════════════
//  Detailing invoice template — SKELETON for Phase 2.1. Service-name
//  map and line-item fields filled in by Phase 2.3.
// ═══════════════════════════════════════════════════════════════════

import type { InvoiceTemplate } from './types';

export const DETAILING_INVOICE_TEMPLATE: InvoiceTemplate = {
  subtitle: 'Mobile Car Wash & Detailing',
  resolveServiceName: (raw) => raw || 'Mobile Detailing Service',
  footerCopy:
    'All work performed to industry standards. Customer must inspect ' +
    'and approve before technician leaves the site.',
  lineItemFields: ['vehicleSize'] as const,
};
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/config/businessTypes/invoice/detailing.ts
git commit -m "feat(invoice): detailing template skeleton (filled in Phase 2.3)"
```

---

### Task C.5: Invoice template registry

**Files:**
- Create: `src/config/businessTypes/invoice/index.ts`

- [ ] **Step 1: Create invoice index**

```ts
// src/config/businessTypes/invoice/index.ts

import type { BusinessTypeKey } from '../types';
import type { InvoiceTemplate } from './types';
import { TIRE_INVOICE_TEMPLATE } from './tire';
import { MECHANIC_INVOICE_TEMPLATE } from './mechanic';
import { DETAILING_INVOICE_TEMPLATE } from './detailing';

export const INVOICE_TEMPLATE_REGISTRY: Readonly<Record<BusinessTypeKey, InvoiceTemplate>> = {
  tire: TIRE_INVOICE_TEMPLATE,
  mechanic: MECHANIC_INVOICE_TEMPLATE,
  detailing: DETAILING_INVOICE_TEMPLATE,
};

export function getInvoiceTemplate(
  key: BusinessTypeKey | null | undefined,
): InvoiceTemplate {
  if (key && INVOICE_TEMPLATE_REGISTRY[key]) {
    return INVOICE_TEMPLATE_REGISTRY[key];
  }
  return TIRE_INVOICE_TEMPLATE;
}

export type { InvoiceTemplate };
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/config/businessTypes/invoice/index.ts
git commit -m "feat(invoice): per-vertical template registry"
```

---

### Task C.6: Rewrite src/lib/invoice.ts to use the registry

**Files:**
- Modify: `src/lib/invoice.ts` lines 11-47 (the inline `customerFriendlyServiceName` function and its callers within the file)

Strategy: keep the public `generateInvoicePDF` function signature identical. Internally:
1. Resolve the active business type from settings.
2. Look up the matching template via `getInvoiceTemplate`.
3. Replace the inline `customerFriendlyServiceName` call sites with `template.resolveServiceName`.
4. Render the subtitle from `template.subtitle`.
5. Render the footer from `template.footerCopy`.

- [ ] **Step 1: Read invoice.ts to confirm exact line numbers of the changes**

Run: `grep -n "customerFriendlyServiceName\|Mobile Tire & Roadside\|All work is guaranteed" src/lib/invoice.ts`
Expected: shows the function definition (lines ~17-47), the subtitle string (somewhere in the header builder), and the footer text.

- [ ] **Step 2: At the top of src/lib/invoice.ts, add the import**

```ts
import { getInvoiceTemplate } from '@/config/businessTypes/invoice';
import { resolveVerticalKey } from '@/lib/verticalContext';
```

- [ ] **Step 3: Delete the inline `customerFriendlyServiceName` function (lines ~17-47)**

It's now in `src/config/businessTypes/invoice/tire.ts`.

- [ ] **Step 4: In `generateInvoicePDF` (or the main render function), resolve the template before any string rendering**

```ts
// At the top of the function body, before any PDF writes:
const businessTypeKey = resolveVerticalKey(settings);
const template = getInvoiceTemplate(businessTypeKey);
```

- [ ] **Step 5: Replace every `customerFriendlyServiceName(...)` call with `template.resolveServiceName(...)`**

There should be one or two call sites in the same function.

- [ ] **Step 6: Replace the hardcoded subtitle string (likely `'Mobile Tire & Roadside Service'`) with `template.subtitle`**

- [ ] **Step 7: Replace the hardcoded footer text with `template.footerCopy`**

- [ ] **Step 8: Verify build**

Run: `npm run build`
Expected: succeeds. TypeScript catches any signature drift in `getInvoiceTemplate` consumer code.

- [ ] **Step 9: Smoke test — generate a tire invoice**

```bash
npm run dev
```

Sign in as a tire account. Open a completed job. Generate an invoice. The PDF should look IDENTICAL to one generated before this change:
- Header subtitle: "Mobile Tire & Roadside Service"
- Service names: same friendly mappings
- Footer: same warranty language

If anything differs, the template extraction missed a string — revert and audit.

Stop the dev server.

- [ ] **Step 10: Commit**

```bash
git add src/lib/invoice.ts
git commit -m "refactor(invoice): dispatch template via active business type"
```

**Milestone C checkpoint:** `npm run build` green; tire invoice output byte-identical; mechanic + detailing templates exist but no business renders them yet (Settings.businessType for live tire accounts is undefined → resolves to tire).

---

## Milestone D — UI Consumers Read From Config

Goal: every page that today hardcodes tire concepts reads from `useActiveVertical()`. Tire continues to render identically; mechanic businesses now look mechanic-styled end-to-end.

The order is intentionally lowest-blast-radius first: Dashboard → Inventory → Settings → Onboarding → AddJob. AddJob is last because it's the most complex and most user-visible.

### Task D.1: Dashboard reads dashboardMetrics from active config

**Files:**
- Modify: `src/pages/Dashboard.tsx`

- [ ] **Step 1: Read Dashboard.tsx to identify the metric cards**

Run: `grep -n "Revenue\|Profit\|Average ticket\|Top services\|This week" src/pages/Dashboard.tsx`
Expected: shows the cards' label strings + the calls that compute their values.

- [ ] **Step 2: Add the import**

At the top of `Dashboard.tsx`:

```ts
import { useActiveVertical } from '@/lib/useActiveVertical';
```

- [ ] **Step 3: Inside the Dashboard component, resolve the active config**

```ts
const vertical = useActiveVertical();
```

- [ ] **Step 4: Replace the three hardcoded metric cards with a `vertical.dashboardMetrics.map(...)` block**

```tsx
{vertical.dashboardMetrics.map((m) => {
  const value = m.compute(jobs, settings);
  const display =
    m.format === 'currency' ? money(value) :
    m.format === 'percent'  ? `${(value * 100).toFixed(1)}%` :
                              String(value);
  return (
    <div key={m.id} className="metric-card">
      <div className="metric-label">{m.label}</div>
      <div className="metric-value">{display}</div>
    </div>
  );
})}
```

(Match the existing card markup classes; the snippet above uses placeholder names — replace with the real ones from the current Dashboard render tree.)

- [ ] **Step 5: Update empty-state copy from "No jobs logged yet — quote a tire repair…" to `vertical.copy.emptyJobsHint`**

Find the existing empty-state string and replace.

- [ ] **Step 6: Verify build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 7: Smoke test**

```bash
npm run dev
```

Tire account: Dashboard renders with the same three cards (Revenue this week / Profit this week / Average ticket) and same numbers.
Mechanic account: Dashboard renders three cards (Revenue this week / Labor hours billed (week) / Average ticket).

Stop dev server.

- [ ] **Step 8: Commit**

```bash
git add src/pages/Dashboard.tsx
git commit -m "refactor(dashboard): read metrics from active business type config"
```

---

### Task D.2: Inventory reads inventoryFields from active config

**Files:**
- Modify: `src/pages/Inventory.tsx`

- [ ] **Step 1: Read Inventory.tsx to find the field schema**

Run: `grep -n "tireSize\|rimSize\|brand\|condition" src/pages/Inventory.tsx`
Expected: shows where the four tire columns are referenced in the table header and row renderer.

- [ ] **Step 2: Add the imports**

```ts
import { useActiveVertical } from '@/lib/useActiveVertical';
```

- [ ] **Step 3: Inside the Inventory component**

```ts
const vertical = useActiveVertical();
const fields = vertical.inventoryFields;
```

- [ ] **Step 4: Replace the hardcoded table header with a `fields.map(...)` block**

```tsx
<thead>
  <tr>
    {fields.map((f) => <th key={f.key}>{f.label}</th>)}
    <th>Quantity</th>
    <th></th>
  </tr>
</thead>
```

- [ ] **Step 5: Replace the hardcoded row renderer**

For each row, render one cell per `fields[i]` reading `item[f.key]` (cast to a record so TypeScript accepts the dynamic key access):

```tsx
{fields.map((f) => {
  const value = (item as Record<string, unknown>)[f.key];
  return <td key={f.key}>{f.type === 'number' ? Number(value || 0) : String(value || '')}</td>;
})}
```

Cell input rendering follows the same pattern (text vs number select inputs).

- [ ] **Step 6: Replace the section title with `vertical.copy.inventoryLabel`**

- [ ] **Step 7: Verify build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 8: Smoke test**

```bash
npm run dev
```

Tire: Inventory page shows 4 columns (Tire Size, Rim Size, Brand, Condition) — same as before.
Mechanic: Inventory page shows 5 columns (Part Number, Part Name, Supplier, Unit Cost, Quantity).

Stop dev server.

- [ ] **Step 9: Commit**

```bash
git add src/pages/Inventory.tsx
git commit -m "refactor(inventory): render columns from active business type inventoryFields"
```

---

### Task D.3: Settings reads services/pricingModel from active config

**Files:**
- Modify: `src/pages/Settings.tsx`

The Settings page contains the service-pricing editor (today hardcoded to DEFAULT_SERVICE_PRICING) and the vehicle-pricing editor (today hardcoded to DEFAULT_VEHICLE_PRICING).

- [ ] **Step 1: Locate the service-pricing editor**

Run: `grep -n "servicePricing\|DEFAULT_SERVICE_PRICING" src/pages/Settings.tsx | head -10`
Expected: shows the editor's data source and the iteration over keys.

- [ ] **Step 2: Add the import**

```ts
import { useActiveVertical } from '@/lib/useActiveVertical';
```

- [ ] **Step 3: Inside the Settings component, resolve the active config**

```ts
const vertical = useActiveVertical();
```

- [ ] **Step 4: When listing services in the editor, iterate `vertical.services` rather than DEFAULT_SERVICE_PRICING keys**

```tsx
{vertical.services.map((svc) => {
  const stored = settings.servicePricing?.[svc.id];
  const enabled = stored?.enabled ?? svc.enabledByDefault;
  const basePrice = stored?.basePrice ?? svc.defaultBasePrice;
  const minProfit = stored?.minProfit ?? svc.defaultMinProfit;
  return (
    <ServicePricingRow
      key={svc.id}
      service={svc}
      enabled={enabled}
      basePrice={basePrice}
      minProfit={minProfit}
      onChange={…}
    />
  );
})}
```

(`ServicePricingRow` here is a placeholder for whatever row component or inline markup the existing editor uses; adapt to match.)

- [ ] **Step 5: Vehicle-pricing editor — gate on the active pricing model**

The vehicle-pricing editor only makes sense for `pricingModel.kind === 'flat'` (tire's add-on-per-vehicle-type pricing). For mechanic/detailing, hide the section entirely.

```tsx
{vertical.pricingModel.kind === 'flat' && (
  <VehiclePricingEditor … />
)}
```

- [ ] **Step 6: Verify build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 7: Smoke test**

```bash
npm run dev
```

Tire account: Settings → Service Pricing shows the 15 tire services with the same default prices/min profits. Vehicle Pricing section is visible.

Mechanic account: Settings → Service Pricing shows the 27 mechanic services. Vehicle Pricing section is HIDDEN.

Stop dev server.

- [ ] **Step 8: Commit**

```bash
git add src/pages/Settings.tsx
git commit -m "refactor(settings): render service editor from active business type config"
```

---

### Task D.4: Onboarding seeds from active config services

**Files:**
- Modify: `src/components/Onboarding.tsx`

- [ ] **Step 1: Find the service-confirmation step**

Run: `grep -n "servicePricing\|DEFAULT_SERVICE_PRICING\|enabledByDefault" src/components/Onboarding.tsx`
Expected: shows where Onboarding pre-checks services and writes them back to settings.

- [ ] **Step 2: Add the import**

```ts
import { useActiveVertical } from '@/lib/useActiveVertical';
```

- [ ] **Step 3: Inside the Onboarding component**

```ts
const vertical = useActiveVertical();
```

- [ ] **Step 4: Seed the service-confirmation step from `vertical.services`**

Pre-check exactly the services where `enabledByDefault === true` (per spec §11 decision #4).

```tsx
const initialServiceState = useMemo<Record<string, boolean>>(() => {
  const out: Record<string, boolean> = {};
  for (const svc of vertical.services) {
    out[svc.id] = svc.enabledByDefault;
  }
  return out;
}, [vertical]);
```

- [ ] **Step 5: Verify build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 6: Smoke test**

```bash
npm run dev
```

This requires a fresh signup. The easier check: sign in as the existing tire account and confirm Onboarding doesn't trigger (since `onboardingComplete: true`). For a true verification, create a brand-new mechanic business via Add Business → step through Onboarding → confirm the service list is mechanic services with the right pre-check state.

Stop dev server.

- [ ] **Step 7: Commit**

```bash
git add src/components/Onboarding.tsx
git commit -m "refactor(onboarding): seed services from active business type config"
```

---

### Task D.5: AddJob renders services + jobFields from active config

**Files:**
- Modify: `src/pages/AddJob.tsx`

This is the biggest single-file change in Phase 2.1. AddJob currently hardcodes:
- The service picker (tire services from DEFAULT_SERVICE_PRICING).
- Tire-only fields (`tireSize`, `tireBrand`, `tireModel`, `tireSource`, `tireCondition`, etc.).
- Inventory-deduction flow (specific to tire).
- Quick-quote pricing (calls `computeBreakdown` — already routes through the dispatcher after B.5).

Strategy: feature-flag the inventory-deduction + tire-specific fields behind `vertical.features.inventoryDeduction` and `vertical.features.vehicleDiagnostics`. Iterate `vertical.jobFields` for any vertical-specific fields beyond the shared ones (customer name, phone, service, revenue, miles, etc.).

- [ ] **Step 1: Add the imports**

```ts
import { useActiveVertical } from '@/lib/useActiveVertical';
import type { BusinessTypeJobField } from '@/config/businessTypes/registry';
```

- [ ] **Step 2: Inside AddJob, resolve the active config**

```ts
const vertical = useActiveVertical();
```

- [ ] **Step 3: Replace the hardcoded service picker source**

The service picker today iterates `settings.servicePricing` (which was seeded from tire defaults). Continue reading from `settings.servicePricing` (so user-edited prices win) but order/filter by `vertical.services`:

```ts
const availableServices = useMemo(() =>
  vertical.services
    .map((svc) => {
      const stored = settings.servicePricing?.[svc.id];
      return {
        id: svc.id,
        label: svc.label,
        enabled: stored?.enabled ?? svc.enabledByDefault,
        basePrice: stored?.basePrice ?? svc.defaultBasePrice,
        minProfit: stored?.minProfit ?? svc.defaultMinProfit,
      };
    })
    .filter((s) => s.enabled),
[vertical, settings.servicePricing],
);
```

Pass `availableServices` to the picker component / dropdown.

- [ ] **Step 4: Gate the tire-only fields behind `vertical.features.roadsideAddons` / `inventoryDeduction`**

Find the JSX block that renders tireSize / tireBrand / tireModel / tireSource / tireCondition / inventory-deduction flow. Wrap it:

```tsx
{vertical.features.roadsideAddons && (
  <>
    {/* existing tire-specific fields */}
  </>
)}

{vertical.features.inventoryDeduction && (
  <>
    {/* existing inventory-deduction flow */}
  </>
)}
```

- [ ] **Step 5: Add a DynamicJobField helper at the top of the file (outside the AddJob component)**

```tsx
function DynamicJobField({
  field, value, onChange, disabled,
}: {
  field: BusinessTypeJobField;
  value: unknown;
  onChange: (v: unknown) => void;
  disabled?: boolean;
}) {
  const id = `job-field-${field.key}`;
  switch (field.type) {
    case 'text':
      return (
        <div>
          <label htmlFor={id}>{field.label}</label>
          <input
            id={id}
            type="text"
            value={String(value ?? '')}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
          />
        </div>
      );
    case 'number':
      return (
        <div>
          <label htmlFor={id}>{field.label}</label>
          <input
            id={id}
            type="number"
            inputMode="decimal"
            value={value === undefined || value === null ? '' : String(value)}
            onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
            disabled={disabled}
          />
        </div>
      );
    case 'select':
      return (
        <div>
          <label htmlFor={id}>{field.label}</label>
          <select
            id={id}
            value={String(value ?? '')}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
          >
            <option value="">—</option>
            {(field.options || []).map((opt) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        </div>
      );
    case 'boolean':
      return (
        <div>
          <label htmlFor={id}>
            <input
              id={id}
              type="checkbox"
              checked={Boolean(value)}
              onChange={(e) => onChange(e.target.checked)}
              disabled={disabled}
            />
            {field.label}
          </label>
        </div>
      );
  }
}
```

(Adapt the className / style props to match the existing AddJob styling — the snippet above shows structure only.)

- [ ] **Step 6: Render the dynamic fields list inside the AddJob form body**

```tsx
{vertical.jobFields.map((field) => (
  <DynamicJobField
    key={field.key}
    field={field}
    value={(job as Record<string, unknown>)[field.key]}
    onChange={(v) => setJob({ ...job, [field.key]: v } as typeof job)}
    disabled={busy}
  />
))}
```

Tire's existing fields (`tireSize`/`tireCondition`/`wheelLockRemoved`) are listed in TIRE_CONFIG.jobFields, so they render here for tire too — REMOVE the duplicate hardcoded markup for those three fields elsewhere in the form to avoid double rendering.

Note: the existing labour-hours/parts-cost/diagnostic-code/mileage/vehicleMakeModel fields now appear for mechanic businesses via this loop, with no extra code.

- [ ] **Step 7: Update the section header copy**

Replace "Tire Details" (or similar) section heading with `vertical.copy.jobNounSingular`. Capitalize via:

```ts
const sectionHeading = vertical.copy.jobNounSingular.charAt(0).toUpperCase() + vertical.copy.jobNounSingular.slice(1);
// 'tire job' -> 'Tire job'; 'repair job' -> 'Repair job'; 'detail' -> 'Detail'
```

- [ ] **Step 8: Verify build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 9: Smoke test on tire**

```bash
npm run dev
```

Sign in as a tire account. Open Add Job. Confirm:
- Service picker shows the 13 enabled-by-default tire services.
- Tire-specific fields (tireSize, tireBrand, tireModel, tireSource) are visible.
- Inventory-deduction flow works exactly as before.
- Saving a job produces the same pricing breakdown as before.

- [ ] **Step 10: Smoke test on mechanic**

Switch to (or create) a mechanic business. Open Add Job. Confirm:
- Service picker shows mechanic services (Diagnostics, Battery Replacement, …).
- Mechanic fields (laborHours, partsCost, diagnosticCode, vehicleMakeModel, mileage) are visible.
- Tire fields are HIDDEN.
- Inventory-deduction flow is HIDDEN.
- Save a job → pricing breakdown uses labor+parts engine.

Stop dev server.

- [ ] **Step 11: Commit**

```bash
git add src/pages/AddJob.tsx
git commit -m "refactor(add-job): render service picker + job fields from active config"
```

**Milestone D checkpoint:** `npm run build` green; tire workflow fully verified; mechanic businesses now display mechanic services, fields, copy, inventory columns, dashboard cards, and invoice subtitle end-to-end.

---

## Milestone E — Defaults Deprecation

Goal: `src/lib/defaults.ts` stops being the canonical source for service/vehicle pricing. Tire-specific constants there become re-exports of the tire-config maps with `@deprecated` notes.

### Task E.1: Re-point DEFAULT_SERVICE_PRICING / DEFAULT_VEHICLE_PRICING to tire config

**Files:**
- Modify: `src/lib/defaults.ts`

- [ ] **Step 1: Read defaults.ts to find the two constants**

Run: `grep -n "DEFAULT_SERVICE_PRICING\|DEFAULT_VEHICLE_PRICING" src/lib/defaults.ts`
Expected: shows the two object literal declarations.

- [ ] **Step 2: At the top of defaults.ts, add the import**

```ts
import { TIRE_CONFIG } from '@/config/businessTypes/tire';
import { servicePricingFromVertical } from '@/lib/verticals';
```

- [ ] **Step 3: Replace the DEFAULT_SERVICE_PRICING object literal**

```ts
/**
 * @deprecated Read service pricing from the active business type's
 * config via useActiveVertical().services, or
 * settings.servicePricing for user-edited values. This constant is
 * retained for back-compat with code that hasn't been migrated yet
 * and is now a thin re-derivation from TIRE_CONFIG. New code should
 * NOT import it.
 */
export const DEFAULT_SERVICE_PRICING: Record<string, ServicePricing> =
  servicePricingFromVertical(TIRE_CONFIG);
```

- [ ] **Step 4: Replace the DEFAULT_VEHICLE_PRICING object literal**

The existing vehicle-pricing object isn't yet in any vertical config — leave it as is, but mark `@deprecated`:

```ts
/**
 * @deprecated Vehicle-add-on pricing is tire-specific (flat
 * pricing model only). Read from `settings.vehiclePricing` for
 * the user-edited map; new tire businesses seed this via
 * createBusiness with sanitizeMapKeys applied to handle the
 * 'SUV / Truck' slash. This constant is kept only to satisfy
 * tire's existing fallbacks in pricing-display.ts and similar.
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
```

(The constant body stays the same; only the JSDoc changes.)

- [ ] **Step 5: Verify build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 6: Smoke test — full tire workflow regression check**

```bash
npm run dev
```

This is the FINAL milestone check. Sign in as the existing tire account. Verify end-to-end:
1. Dashboard renders identically (revenue, profit, top services).
2. Add Job → service picker shows tire services with current prices.
3. Save a job → pricing breakdown matches old behavior numerically.
4. Inventory → 4 columns (tireSize, rimSize, brand, condition) — same data.
5. Settings → Service Pricing → 15 tire services, default prices.
6. Settings → Vehicle Pricing → 8 vehicle types, default add-on profits.
7. Generate an invoice → byte-identical PDF to pre-Phase-2.1 generation.
8. Add Business (already verified in Phase 1) still works.

If any of these regress, do NOT commit; bisect to find the offending milestone change.

Stop dev server.

- [ ] **Step 7: Commit**

```bash
git add src/lib/defaults.ts
git commit -m "refactor(defaults): mark tire pricing constants @deprecated, derive from TIRE_CONFIG"
```

**Milestone E checkpoint (and Phase 2.1 complete):** `npm run build` green; tire account behavior end-to-end identical; mechanic businesses render mechanic-styled UI throughout; detailing slot exists but unexposed; `firestore.rules` untouched; no schema migration.

---

## Phase 2.1 Final Verification Checklist

Run before pushing the Phase 2.1 commits:

- [ ] `npm run build` succeeds with no TypeScript errors and no warnings beyond the existing chunk-size warning.
- [ ] `git log --oneline origin/main..HEAD` shows ~25 small commits, each with a focused message and one logical change.
- [ ] `git diff --stat origin/main..HEAD` does NOT include `firestore.rules`, `firebase.json`, or any unrelated file.
- [ ] No new dependencies added to `package.json` (no `npm install`).
- [ ] Dev-server smoke test on the existing tire account passes end-to-end (all 8 checks in Task E.1 Step 6).
- [ ] Dev-server smoke test on a freshly-created mechanic business passes:
  - Add Job shows mechanic services + mechanic job fields.
  - No tire-specific UI visible.
  - Inventory shows mechanic columns.
  - Dashboard shows mechanic metrics.
  - Invoice subtitle says "Mobile Mechanic Service".
- [ ] `gh auth status` confirms push will work, then `git push origin main`.

Once pushed, watch the GitHub Actions deploy. Smoke test the production URL the same way before declaring Phase 2.1 complete.

---

## Out-of-Scope Follow-ups (separate plans)

Per the spec §10, these are deferred:

- **Phase 2.2 — Mechanic full slice** (VIN, photos, parts supplier, warranty, real diagnostics workflow).
- **Phase 2.3 — Detailing full slice** (services, real package-multiplier pricing, photo gallery).
- **Phase 2.4 — Job pipeline + technician assignment.**
- **Phase 2.5 — Calendar / dispatch UI.**
- **Phase 2.6 — Technician payouts.**
- **Phase 2.7 — CRM.**
- **Phase 2.8 — Analytics dashboard with filters.**
- **Phase 2.9 — Estimates + deposits + signature capture.**
- **Phase 2.10 — White-label foundation.**

Each is its own brainstorming → spec → plan → implementation cycle.
