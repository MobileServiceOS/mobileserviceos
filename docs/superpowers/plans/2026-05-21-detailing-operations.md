# Detailing Operations Implementation Plan (Phase 2.3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the complete detailing operator workflow described in [docs/superpowers/specs/2026-05-21-detailing-operations-design.md](../specs/2026-05-21-detailing-operations-design.md) — vehicle size + package picker + add-ons multi-select on AddJob, completed `package_multiplier` engine, detailing invoice template populated, dashboard metrics, AddBusinessModal exposure.

**Architecture:** Strictly additive on top of the Phase 2.1 detailing skeleton. Reuses the existing runtime-config dispatcher pattern. One new optional Job field (`detailingAddons`), three additive type widenings, no firestore.rules changes, no new collections, no new dependencies.

**Tech Stack:** TypeScript strict mode, React 18. Test runner: `npx tsx`.

**Commit cadence:** one focused commit per task; never squash. `npm run build` + relevant `npx tsx tests/<file>.test.ts` after every task.

---

## File Structure

**Files to create:**

| File | Responsibility |
|---|---|
| `tests/calcPackageMultiplierQuote.test.ts` | Quote calculator math |
| `tests/computePackageMultiplierPrice.test.ts` | Direct-cost breakdown |
| `tests/detailingInvoiceLineItems.test.ts` | Invoice template line composition |
| `tests/detailingDashboardMetrics.test.ts` | The 5 dashboard metric `compute` functions |

**Files to modify:**

| File | Change |
|---|---|
| `src/types/index.ts` | Add `Job.detailingAddons?`, `QuoteForm.detailingAddons?` |
| `src/config/businessTypes/types.ts` | Add `BusinessTypeService.isAddOn?`, `PackageMultiplierPricingModel.defaultMinServiceCharge?`, `BusinessTypeCopy.packageLabel?` |
| `src/lib/deserializers.ts` | Deserialize `detailingAddons` |
| `src/config/businessTypes/detailing.ts` | Populate services (8 packages + 7 add-ons), dashboardMetrics (5), defaultMinServiceCharge, packageLabel |
| `src/config/businessTypes/pricing/packageMult.ts` | Replace stub with full engine (`computePackageMultiplierPrice` + `calcPackageMultiplierQuote`) |
| `src/config/businessTypes/invoice/detailing.ts` | Replace stub `buildLineItems` |
| `src/pages/AddJob.tsx` | Vehicle-size chip block + detailing-add-ons multi-select; route Service section title via `vertical.copy.packageLabel` |
| `src/components/AddBusinessModal.tsx` | Add Detailing entry to vertical picker |

---

## Task 1: Schema widening + deserializer

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/config/businessTypes/types.ts`
- Modify: `src/lib/deserializers.ts`

- [ ] **Step 1: Add `Job.detailingAddons` + widen `QuoteForm`**

Open `src/types/index.ts`. Find the `Job` interface — append at the bottom (after the Sub-Project B `assignedToUid` field, before the closing brace):

```ts
  // ─── Detailing (Phase 2.3) ───────────────────────────────────────
  /** Optional add-on service ids selected on AddJob. Each id resolves
   *  to a service in the active vertical's catalog at invoice render
   *  time. Tire / mechanic jobs leave this undefined. */
  detailingAddons?: ReadonlyArray<string>;
```

Find the `QuoteForm` interface (search for `interface QuoteForm`). Append `detailingAddons?: ReadonlyArray<string>` next to its existing optional fields:

```ts
  vehicleSize?: string;
  detailingAddons?: ReadonlyArray<string>;
```

- [ ] **Step 2: Widen `BusinessTypeService`, `PackageMultiplierPricingModel`, `BusinessTypeCopy`**

Open `src/config/businessTypes/types.ts`. Append `isAddOn` to `BusinessTypeService`:

```ts
export interface BusinessTypeService {
  id: string;
  label: string;
  defaultBasePrice: number;
  defaultMinProfit: number;
  enabledByDefault: boolean;
  /** Detailing-only: when true, this service renders in the AddJob
   *  add-ons multi-select rather than the primary Service chip-grid.
   *  Other verticals leave undefined; the AddJob renderer treats
   *  undefined as `false`. */
  isAddOn?: boolean;
}
```

Add `defaultMinServiceCharge` to `PackageMultiplierPricingModel`:

```ts
export interface PackageMultiplierPricingModel {
  kind: 'package_multiplier';
  vehicleSizeMultipliers: Record<string, number>;
  /** Service-floor minimum; the engine raises the suggested price to
   *  this when the computed value would be lower. Mirrors the
   *  labor_parts engine's `defaultMinServiceCharge`. */
  defaultMinServiceCharge?: number;
}
```

Add `packageLabel` to `BusinessTypeCopy`:

```ts
export interface BusinessTypeCopy {
  jobNounSingular: string;
  jobNounPlural: string;
  emptyJobsHint: string;
  inventoryLabel: string;
  /** Optional override for the AddJob "Service" section title. When
   *  defined, replaces "Service" — used by detailing to render
   *  "Package" instead. Undefined verticals keep the default. */
  packageLabel?: string;
}
```

- [ ] **Step 3: Deserialize `detailingAddons`**

In `src/lib/deserializers.ts`, find `deserializeJob`. Add the field handler next to `vehicleSize`:

```ts
    vehicleSize: raw.vehicleSize == null ? undefined : asString(raw.vehicleSize),
    detailingAddons: Array.isArray(raw.detailingAddons)
      ? (raw.detailingAddons as unknown[]).map((v) => asString(v))
      : undefined,
```

- [ ] **Step 4: Verify build**

```bash
npm run build
```
Expected: TS clean — no consumers depend on the new fields yet.

- [ ] **Step 5: Commit**

```bash
git add src/types/index.ts src/config/businessTypes/types.ts src/lib/deserializers.ts
git commit -m "feat(types): Phase 2.3 detailing schema widening (Job.detailingAddons + BusinessTypeService.isAddOn + packageMultiplier.defaultMinServiceCharge + packageLabel)"
```

---

## Task 2: Populate `detailing.ts` config

**Files:**
- Modify: `src/config/businessTypes/detailing.ts`

- [ ] **Step 1: Add `defaultMinServiceCharge` to the pricing model**

Open `src/config/businessTypes/detailing.ts`. Find the existing `pricingModel: { kind: 'package_multiplier', ... }` block and add the new field:

```ts
  pricingModel: {
    kind: 'package_multiplier',
    vehicleSizeMultipliers: {
      Sedan: 1.0,
      SUV: 1.25,
      Truck: 1.3,
      'XL SUV': 1.5,
      Van: 1.4,
    },
    defaultMinServiceCharge: 40,
  },
```

- [ ] **Step 2: Populate the services array**

Replace the existing `services: [],` with the full catalog (8 packages + 7 add-ons):

```ts
  services: [
    // ─── Packages ─────────────────────────────────────────────────
    { id: 'Express Wash',         label: 'Express Wash',         defaultBasePrice: 40,  defaultMinProfit: 25,  enabledByDefault: true },
    { id: 'Full Wash & Wax',      label: 'Full Wash & Wax',      defaultBasePrice: 90,  defaultMinProfit: 55,  enabledByDefault: true },
    { id: 'Interior Detail',      label: 'Interior Detail',      defaultBasePrice: 120, defaultMinProfit: 70,  enabledByDefault: true },
    { id: 'Exterior Detail',      label: 'Exterior Detail',      defaultBasePrice: 130, defaultMinProfit: 75,  enabledByDefault: true },
    { id: 'Full Detail',          label: 'Full Detail',          defaultBasePrice: 220, defaultMinProfit: 130, enabledByDefault: true },
    { id: 'Premium Detail',       label: 'Premium Detail',       defaultBasePrice: 320, defaultMinProfit: 180, enabledByDefault: true },
    { id: 'Headlight Restoration',label: 'Headlight Restoration',defaultBasePrice: 80,  defaultMinProfit: 50,  enabledByDefault: true },
    { id: 'Engine Bay Detail',    label: 'Engine Bay Detail',    defaultBasePrice: 90,  defaultMinProfit: 60,  enabledByDefault: true },

    // ─── Add-ons ──────────────────────────────────────────────────
    { id: 'Pet Hair Removal',     label: 'Pet Hair Removal',     defaultBasePrice: 30, defaultMinProfit: 25, enabledByDefault: true, isAddOn: true },
    { id: 'Odor Treatment',       label: 'Odor Treatment',       defaultBasePrice: 50, defaultMinProfit: 40, enabledByDefault: true, isAddOn: true },
    { id: 'Headliner Cleaning',   label: 'Headliner Cleaning',   defaultBasePrice: 40, defaultMinProfit: 30, enabledByDefault: true, isAddOn: true },
    { id: 'Stain Treatment',      label: 'Stain Treatment',      defaultBasePrice: 35, defaultMinProfit: 28, enabledByDefault: true, isAddOn: true },
    { id: 'Ceramic Spray Coating',label: 'Ceramic Spray Coating',defaultBasePrice: 60, defaultMinProfit: 45, enabledByDefault: true, isAddOn: true },
    { id: 'Tire Shine',           label: 'Tire Shine',           defaultBasePrice: 15, defaultMinProfit: 12, enabledByDefault: true, isAddOn: true },
    { id: 'Glass Treatment',      label: 'Glass Treatment',      defaultBasePrice: 25, defaultMinProfit: 20, enabledByDefault: true, isAddOn: true },
  ],
```

- [ ] **Step 3: Add `packageLabel` to copy block**

Find the existing `copy: { ... }` block and add `packageLabel`:

```ts
  copy: {
    jobNounSingular: 'detail',
    jobNounPlural: 'details',
    emptyJobsHint: 'No jobs logged yet — quote a detail to get started.',
    inventoryLabel: 'Detailing Supplies',
    packageLabel: 'Package',
  },
```

- [ ] **Step 4: Populate `dashboardMetrics`**

The detailing config currently ends with `dashboardMetrics: [],`. Replace with the 5-metric array:

```ts
  dashboardMetrics: [
    {
      id: 'details_this_week',
      label: 'Details this week',
      format: 'number',
      compute: (jobs, _s) => jobs.filter(isThisWeek).length,
    },
    {
      id: 'revenue_week',
      label: 'Revenue (week)',
      format: 'currency',
      compute: (jobs, _s) =>
        r2(jobs.filter(isThisWeek).reduce((sum, j) => sum + Number(j.revenue || 0), 0)),
    },
    {
      id: 'avg_ticket',
      label: 'Avg ticket',
      format: 'currency',
      compute: (jobs, _s) => {
        const completed = jobs.filter(isThisWeek).filter((j) => j.status === 'Completed');
        if (completed.length === 0) return 0;
        return r2(completed.reduce((sum, j) => sum + Number(j.revenue || 0), 0) / completed.length);
      },
    },
    {
      id: 'repeat_customer_pct',
      label: 'Repeat customers',
      format: 'percent',
      compute: (jobs, _s) => {
        const weekJobs = jobs.filter(isThisWeek);
        if (weekJobs.length === 0) return 0;
        const earlierPhones = new Set(
          jobs
            .filter((j) => !isThisWeek(j) && j.status === 'Completed' && j.customerPhone)
            .map((j) => j.customerPhone),
        );
        const repeats = weekJobs.filter((j) => j.customerPhone && earlierPhones.has(j.customerPhone)).length;
        return repeats / weekJobs.length;
      },
    },
    {
      id: 'addons_pct',
      label: 'Add-on attach rate',
      format: 'percent',
      compute: (jobs, _s) => {
        const completedThisWeek = jobs.filter(isThisWeek).filter((j) => j.status === 'Completed');
        if (completedThisWeek.length === 0) return 0;
        const withAddOns = completedThisWeek.filter(
          (j) => Array.isArray((j as Job & { detailingAddons?: ReadonlyArray<string> }).detailingAddons)
            && ((j as Job & { detailingAddons?: ReadonlyArray<string> }).detailingAddons!.length > 0),
        ).length;
        return withAddOns / completedThisWeek.length;
      },
    },
  ],
```

- [ ] **Step 5: Add helper + imports**

The dashboardMetrics array references `isThisWeek` + `r2` — add at the top of the file:

```ts
import type { BusinessTypeConfig } from './types';
import type { Job, Settings } from '@/types';
import { r2 } from '@/lib/round';

function startOfWeekIso(): string {
  // Match mechanic.ts: America/New_York Sunday-start week
  const now = new Date();
  const day = now.getDay();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day);
  return start.toISOString().slice(0, 10);
}

function isThisWeek(job: Pick<Job, 'date'>): boolean {
  if (!job.date) return false;
  return job.date >= startOfWeekIso();
}
```

(The `Settings` import may be needed for the compute signatures; check if it's already there.)

- [ ] **Step 6: Verify build**

```bash
npm run build
```
Expected: TS clean.

- [ ] **Step 7: Commit**

```bash
git add src/config/businessTypes/detailing.ts
git commit -m "feat(detailing-config): populate services (8 packages + 7 add-ons), 5 dashboard metrics, defaultMinServiceCharge, packageLabel"
```

---

## Task 3: `package_multiplier` engine completion + tests

**Files:**
- Modify: `src/config/businessTypes/pricing/packageMult.ts`
- Create: `tests/calcPackageMultiplierQuote.test.ts`
- Create: `tests/computePackageMultiplierPrice.test.ts`

- [ ] **Step 1: Replace the stub engine**

Open `src/config/businessTypes/pricing/packageMult.ts` and **replace its entire contents** with:

```ts
// src/config/businessTypes/pricing/packageMult.ts
// ═══════════════════════════════════════════════════════════════════
//  Package-multiplier pricing engine — used by the detailing vertical.
//
//  packageCost      = settings.servicePricing[job.service].basePrice
//                     × vehicleSizeMultiplier[job.vehicleSize]
//  addOnsCost       = Σ basePrice for id in job.detailingAddons
//                     (flat-priced, NO multiplier applied)
//  travelCost       = chargeable miles × costPerMile
//  directCost       = packageCost + addOnsCost + travelCost
//  suggested        = ceil((directCost + targetProfit) / 5) × 5
//                     floored at model.defaultMinServiceCharge
//  premium          = ceil(suggested × 1.25 / 5) × 5
//
//  All numbers rounded via r2 for determinism (same as the other
//  engines).
// ═══════════════════════════════════════════════════════════════════

import type { Job, Settings, QuoteForm, QuoteResult } from '@/types';
import type { PackageMultiplierPricingModel } from '../types';
import { r2 } from '@/lib/round';

export interface PackageMultBreakdown {
  revenue: number;
  vehicleSize: string;
  vehicleSizeMultiplier: number;
  packageCost: number;
  addOnsCost: number;
  addOnIds: ReadonlyArray<string>;
  travelCost: number;
  travelMiles: number;
  travelChargeable: number;
  freeMilesIncluded: number;
  directCost: number;
  profit: number;
  profitMargin: number;
  quantity: number;
  belowMinServiceCharge: boolean;
  minServiceCharge: number;
}

type DetailingJobShape = Job & {
  vehicleSize?: string;
  detailingAddons?: ReadonlyArray<string>;
};

export function computePackageMultiplierPrice(
  j: DetailingJobShape,
  s: Settings,
  model: PackageMultiplierPricingModel,
): PackageMultBreakdown {
  const revenue = Number(j.revenue || 0);
  const vehicleSize = j.vehicleSize || 'Sedan';
  const multiplier = model.vehicleSizeMultipliers[vehicleSize] ?? 1;

  const sp = s.servicePricing || {};
  const packageBase = Number(sp[j.service]?.basePrice ?? 0);
  const packageCost = r2(packageBase * multiplier);

  const addOnIds = j.detailingAddons ?? [];
  let addOnsAccumulator = 0;
  for (const id of addOnIds) {
    addOnsAccumulator += Number(sp[id]?.basePrice ?? 0);
  }
  const addOnsCost = r2(addOnsAccumulator);

  const miles = Number(j.miles || 0);
  const freeMiles = Number(s.freeMilesIncluded || 0);
  const chargeable = Math.max(0, miles - freeMiles);
  const travelCost = r2(chargeable * Number(s.costPerMile || 0.65));

  const directCost = r2(packageCost + addOnsCost + travelCost);
  const profit = r2(revenue - directCost);

  const minServiceCharge = Number(model.defaultMinServiceCharge ?? 40);
  const belowMinServiceCharge = revenue > 0 && revenue < minServiceCharge;

  return {
    revenue: r2(revenue),
    vehicleSize,
    vehicleSizeMultiplier: multiplier,
    packageCost,
    addOnsCost,
    addOnIds,
    travelCost,
    travelMiles: miles,
    travelChargeable: chargeable,
    freeMilesIncluded: freeMiles,
    directCost,
    profit,
    profitMargin: revenue > 0 ? profit / revenue : 0,
    quantity: Math.max(1, Math.floor(Number(j.qty) || 1)),
    belowMinServiceCharge,
    minServiceCharge,
  };
}

export function calcPackageMultiplierQuote(
  form: QuoteForm,
  settings: Settings,
  model: PackageMultiplierPricingModel,
): QuoteResult {
  const sp = settings.servicePricing || {};
  const sd = sp[form.service] || { basePrice: 100, minProfit: 50, enabled: true };
  const vehicleSize = form.vehicleSize || 'Sedan';
  const multiplier = model.vehicleSizeMultipliers[vehicleSize] ?? 1;

  const packageCost = Number(sd.basePrice ?? 0) * multiplier;

  const addOnIds = form.detailingAddons ?? [];
  let addOnsCost = 0;
  for (const id of addOnIds) {
    addOnsCost += Number(sp[id]?.basePrice ?? 0);
  }

  const miles = Number(form.miles || 0);
  const freeMiles = Number(settings.freeMilesIncluded || 0);
  const chargeable = Math.max(0, miles - freeMiles);
  const travelCost = chargeable * Number(settings.costPerMile || 0.65);

  const directCost = packageCost + addOnsCost + travelCost;
  const targetProfit = Number(sd.minProfit || 0);
  const minServiceCharge = Number(model.defaultMinServiceCharge ?? 40);

  const raw = Math.max(directCost + targetProfit, minServiceCharge);
  const suggested = Math.ceil(raw / 5) * 5;
  const premium = Math.ceil((suggested * 1.25) / 5) * 5;

  return {
    suggested,
    premium,
    directCosts: r2(directCost),
    targetProfit,
  };
}
```

- [ ] **Step 2: Write `tests/computePackageMultiplierPrice.test.ts`**

```ts
// tests/computePackageMultiplierPrice.test.ts
// Run: npx tsx tests/computePackageMultiplierPrice.test.ts

import { computePackageMultiplierPrice } from '@/config/businessTypes/pricing/packageMult';
import type { Job, Settings } from '@/types';
import type { PackageMultiplierPricingModel } from '@/config/businessTypes/types';

let passed = 0;
let failed = 0;
const check = (label: string, cond: boolean): void => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}`); }
};

const model: PackageMultiplierPricingModel = {
  kind: 'package_multiplier',
  vehicleSizeMultipliers: { Sedan: 1.0, SUV: 1.25, Truck: 1.3, 'XL SUV': 1.5, Van: 1.4 },
  defaultMinServiceCharge: 40,
};

const baseSettings: Settings = {
  costPerMile: 0.65,
  freeMilesIncluded: 5,
  servicePricing: {
    'Full Detail':       { basePrice: 220, minProfit: 130, enabled: true },
    'Pet Hair Removal':  { basePrice: 30,  minProfit: 25,  enabled: true },
    'Tire Shine':        { basePrice: 15,  minProfit: 12,  enabled: true },
  },
} as Settings;

const baseJob = (over: Partial<Job> & { vehicleSize?: string; detailingAddons?: ReadonlyArray<string> } = {}): Job => ({
  id: 'j', date: '2026-05-21', service: 'Full Detail', vehicleType: 'Car',
  area: '', payment: 'Cash', status: 'Completed', source: 'Google',
  customerName: '', customerPhone: '', tireSize: '', qty: 1,
  revenue: 0, tireCost: 0, materialCost: 0, miles: 0, note: '',
  emergency: false, lateNight: false, highway: false, weekend: false,
  tireSource: 'Inventory', inventoryDeductions: null, paymentStatus: 'Paid',
  invoiceGenerated: false, invoiceSent: false, reviewRequested: false,
  ...over,
} as Job);

console.log('\n┌─ computePackageMultiplierPrice ───────────────────');

// Sedan × 1.0 baseline
{
  const b = computePackageMultiplierPrice(baseJob({ vehicleSize: 'Sedan' }), baseSettings, model);
  check('Sedan: packageCost = 220 × 1.0 = 220', b.packageCost === 220);
  check('Sedan: multiplier 1.0', b.vehicleSizeMultiplier === 1.0);
  check('Sedan: vehicleSize echoed', b.vehicleSize === 'Sedan');
}

// SUV × 1.25
{
  const b = computePackageMultiplierPrice(baseJob({ vehicleSize: 'SUV' }), baseSettings, model);
  check('SUV: packageCost = 220 × 1.25 = 275', b.packageCost === 275);
  check('SUV: multiplier 1.25', b.vehicleSizeMultiplier === 1.25);
}

// XL SUV × 1.5
{
  const b = computePackageMultiplierPrice(baseJob({ vehicleSize: 'XL SUV' }), baseSettings, model);
  check('XL SUV: packageCost = 220 × 1.5 = 330', b.packageCost === 330);
}

// Missing vehicleSize → Sedan default
{
  const b = computePackageMultiplierPrice(baseJob({ vehicleSize: undefined }), baseSettings, model);
  check('missing vehicleSize → Sedan default', b.vehicleSize === 'Sedan');
  check('missing vehicleSize → multiplier 1.0', b.vehicleSizeMultiplier === 1.0);
}

// Add-ons flat (NO multiplier)
{
  const b = computePackageMultiplierPrice(
    baseJob({ vehicleSize: 'XL SUV', detailingAddons: ['Pet Hair Removal', 'Tire Shine'] }),
    baseSettings, model,
  );
  check('add-ons flat-priced (no multiplier): 30 + 15 = 45',
    b.addOnsCost === 45);
  check('add-ons NOT multiplied by 1.5', b.addOnsCost === 45 && b.addOnsCost !== 67.5);
}

// Unknown add-on id ignored
{
  const b = computePackageMultiplierPrice(
    baseJob({ detailingAddons: ['Pet Hair Removal', 'Unknown Service'] }),
    baseSettings, model,
  );
  check('unknown add-on id contributes 0', b.addOnsCost === 30);
}

// Empty / missing add-ons
{
  const b = computePackageMultiplierPrice(baseJob({ detailingAddons: [] }), baseSettings, model);
  check('empty detailingAddons → addOnsCost 0', b.addOnsCost === 0);
}
{
  const b = computePackageMultiplierPrice(baseJob({ detailingAddons: undefined }), baseSettings, model);
  check('undefined detailingAddons → addOnsCost 0', b.addOnsCost === 0);
}

// Missing service from pricing → packageCost 0
{
  const b = computePackageMultiplierPrice(baseJob({ service: 'Unknown Package' }), baseSettings, model);
  check('missing service → packageCost 0', b.packageCost === 0);
}

// Travel math
{
  const b = computePackageMultiplierPrice(baseJob({ miles: 12 }), baseSettings, model);
  check('travel: chargeable 7 mi × 0.65 = 4.55', b.travelCost === 4.55);
  check('travel: chargeable miles 7', b.travelChargeable === 7);
}
{
  const b = computePackageMultiplierPrice(baseJob({ miles: 3 }), baseSettings, model);
  check('travel suppressed below freeMiles', b.travelCost === 0);
}

// directCost = packageCost + addOnsCost + travelCost
{
  const b = computePackageMultiplierPrice(
    baseJob({ vehicleSize: 'SUV', detailingAddons: ['Pet Hair Removal'], miles: 12 }),
    baseSettings, model,
  );
  check('directCost = 275 + 30 + 4.55 = 309.55',
    b.directCost === 309.55);
}

// belowMinServiceCharge flag
{
  const b = computePackageMultiplierPrice(baseJob({ revenue: 25 }), baseSettings, model);
  check('revenue 25 < min 40 → belowMinServiceCharge true',
    b.belowMinServiceCharge === true);
}
{
  const b = computePackageMultiplierPrice(baseJob({ revenue: 0 }), baseSettings, model);
  check('revenue 0 → belowMinServiceCharge false (no quote yet)',
    b.belowMinServiceCharge === false);
}

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
```

- [ ] **Step 3: Write `tests/calcPackageMultiplierQuote.test.ts`**

```ts
// tests/calcPackageMultiplierQuote.test.ts
// Run: npx tsx tests/calcPackageMultiplierQuote.test.ts

import { calcPackageMultiplierQuote } from '@/config/businessTypes/pricing/packageMult';
import type { QuoteForm, Settings } from '@/types';
import type { PackageMultiplierPricingModel } from '@/config/businessTypes/types';

let passed = 0;
let failed = 0;
const check = (label: string, cond: boolean): void => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}`); }
};

const model: PackageMultiplierPricingModel = {
  kind: 'package_multiplier',
  vehicleSizeMultipliers: { Sedan: 1.0, SUV: 1.25, Truck: 1.3, 'XL SUV': 1.5, Van: 1.4 },
  defaultMinServiceCharge: 40,
};

const settings: Settings = {
  costPerMile: 0.65,
  freeMilesIncluded: 5,
  servicePricing: {
    'Full Detail':      { basePrice: 220, minProfit: 130, enabled: true },
    'Express Wash':     { basePrice: 40,  minProfit: 25,  enabled: true },
    'Pet Hair Removal': { basePrice: 30,  minProfit: 25,  enabled: true },
  },
} as Settings;

const baseForm = (over: Partial<QuoteForm> = {}): QuoteForm => ({
  service: 'Full Detail',
  vehicleType: 'Car',
  miles: '',
  tireCost: '',
  materialCost: '',
  qty: 1,
  revenue: '',
  emergency: false, lateNight: false, highway: false, weekend: false,
  ...over,
} as QuoteForm);

console.log('\n┌─ calcPackageMultiplierQuote ──────────────────────');

// Sedan baseline: packageCost 220 + 130 profit = 350, ceil to 5 → 350
{
  const q = calcPackageMultiplierQuote(baseForm({ vehicleSize: 'Sedan' }), settings, model);
  check('Sedan suggested = 350', q.suggested === 350);
  check('Sedan premium = ceil(350 × 1.25 / 5) × 5 = 440', q.premium === 440);
}

// SUV: 220 × 1.25 = 275 + 130 = 405 → 405
{
  const q = calcPackageMultiplierQuote(baseForm({ vehicleSize: 'SUV' }), settings, model);
  check('SUV suggested = 405', q.suggested === 405);
}

// Add-on adds flat 30 (no multiplier)
{
  const q = calcPackageMultiplierQuote(
    baseForm({ vehicleSize: 'XL SUV', detailingAddons: ['Pet Hair Removal'] }),
    settings, model,
  );
  // packageCost: 220 × 1.5 = 330
  // addOns: 30
  // target profit: 130
  // raw: 330 + 30 + 130 = 490 → 490
  check('XL SUV + Pet Hair = 490', q.suggested === 490);
}

// Missing vehicleSize → Sedan default
{
  const q = calcPackageMultiplierQuote(baseForm({ vehicleSize: undefined }), settings, model);
  check('missing vehicleSize → defaults to Sedan/1.0', q.suggested === 350);
}

// Floor at minServiceCharge
{
  const q = calcPackageMultiplierQuote(
    baseForm({ service: 'Unknown Service', vehicleSize: 'Sedan' }),
    settings, model,
  );
  // service unknown → defaults to basePrice 100, minProfit 50
  // packageCost: 100; raw: 100 + 50 = 150 → 150 (above min 40)
  check('unknown service → uses default 100 + 50 = 150', q.suggested === 150);
}

// Express Wash with travel
{
  const q = calcPackageMultiplierQuote(
    baseForm({ service: 'Express Wash', vehicleSize: 'Sedan', miles: 10 }),
    settings, model,
  );
  // packageCost: 40; travel: 5 × 0.65 = 3.25; target: 25
  // raw: 40 + 3.25 + 25 = 68.25 → ceil to 70
  check('Express Wash + travel 10mi = 70', q.suggested === 70);
}

// directCosts in result
{
  const q = calcPackageMultiplierQuote(
    baseForm({ vehicleSize: 'SUV', detailingAddons: ['Pet Hair Removal'] }),
    settings, model,
  );
  check('directCosts = 275 + 30 + 0 = 305', q.directCosts === 305);
  check('targetProfit echoed', q.targetProfit === 130);
}

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
```

- [ ] **Step 4: Run + verify**

```bash
npx tsx tests/computePackageMultiplierPrice.test.ts
npx tsx tests/calcPackageMultiplierQuote.test.ts
npm run build
```
Expected: each test prints `N passed, 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add src/config/businessTypes/pricing/packageMult.ts tests/computePackageMultiplierPrice.test.ts tests/calcPackageMultiplierQuote.test.ts
git commit -m "feat(detailing): package_multiplier engine (computePrice + calcQuote) + comprehensive tests"
```

---

## Task 4: Detailing invoice template + test

**Files:**
- Modify: `src/config/businessTypes/invoice/detailing.ts`
- Create: `tests/detailingInvoiceLineItems.test.ts`

- [ ] **Step 1: Read the existing detailing template stub**

```bash
cat src/config/businessTypes/invoice/detailing.ts
```

Locate the existing `buildLineItems` function. It's a stub from Phase 2.1.

- [ ] **Step 2: Replace `buildLineItems` with the populated version**

```ts
import type { Job, Settings } from '@/types';
import type { PricingBreakdownTagged } from '@/config/businessTypes/pricing';
import type { InvoiceTemplate, InvoiceLineItem } from './types';

export const DETAILING_INVOICE_TEMPLATE: InvoiceTemplate = {
  // ... existing subtitle, resolveServiceName, footerCopy,
  // servicePerformedFields, notesLabel — keep as-is ...

  buildLineItems: (
    job: Job,
    breakdown: PricingBreakdownTagged,
    serviceName: string,
    settings: Settings,
  ): ReadonlyArray<InvoiceLineItem> => {
    const items: InvoiceLineItem[] = [];

    if (breakdown.model !== 'package_multiplier') {
      // Defensive fallback (vertical / engine misconfiguration).
      items.push({
        description: 'Service total',
        amount: Number(job.revenue || 0),
      });
      return items;
    }

    // Package line — main service × vehicle-size multiplier.
    if (breakdown.packageCost > 0) {
      const mult = breakdown.vehicleSizeMultiplier;
      const multLabel = mult === 1
        ? breakdown.vehicleSize
        : `${breakdown.vehicleSize} (${mult}×)`;
      items.push({
        description: `${serviceName} — ${multLabel}`,
        amount: breakdown.packageCost,
      });
    }

    // Add-on lines, in the order they appear on the Job.
    const sp = settings.servicePricing || {};
    for (const id of breakdown.addOnIds) {
      const price = Number(sp[id]?.basePrice ?? 0);
      if (price <= 0) continue;
      items.push({
        description: id,
        amount: price,
      });
    }

    // Travel line.
    if (breakdown.travelCost > 0) {
      items.push({
        description: `Travel (${breakdown.travelChargeable} mi)`,
        amount: breakdown.travelCost,
      });
    }

    return items;
  },
};
```

(Adjust the exact import path / export name to match the existing file structure. Keep `subtitle`, `resolveServiceName`, `footerCopy`, `servicePerformedFields`, `notesLabel` from the existing template — only `buildLineItems` is replaced.)

If the existing template stub doesn't currently accept `settings` in `buildLineItems`, the `InvoiceTemplate` interface may need widening. Check the contract in `src/config/businessTypes/invoice/types.ts`:

```bash
grep -n "buildLineItems" src/config/businessTypes/invoice/types.ts
```

If `settings` isn't already in the signature, the mechanic invoice template (which also reads `settings.servicePricing` for parts/add-on lookup) would already have surfaced this — confirm it's present, otherwise widen the type contract first.

- [ ] **Step 3: Write `tests/detailingInvoiceLineItems.test.ts`**

```ts
// tests/detailingInvoiceLineItems.test.ts
// Run: npx tsx tests/detailingInvoiceLineItems.test.ts

import { DETAILING_INVOICE_TEMPLATE } from '@/config/businessTypes/invoice/detailing';
import type { Job, Settings } from '@/types';
import type { PricingBreakdownTagged } from '@/config/businessTypes/pricing';

let passed = 0;
let failed = 0;
const check = (label: string, cond: boolean): void => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}`); }
};

const settings: Settings = {
  servicePricing: {
    'Full Detail':      { basePrice: 220, minProfit: 130, enabled: true },
    'Pet Hair Removal': { basePrice: 30,  minProfit: 25,  enabled: true },
    'Tire Shine':       { basePrice: 15,  minProfit: 12,  enabled: true },
  },
} as Settings;

const baseJob = (over: Partial<Job> = {}): Job => ({
  id: 'j', date: '2026-05-21', service: 'Full Detail', vehicleType: 'Car',
  area: '', payment: 'Cash', status: 'Completed', source: 'Google',
  customerName: '', customerPhone: '', tireSize: '', qty: 1,
  revenue: 325, tireCost: 0, materialCost: 0, miles: 0, note: '',
  emergency: false, lateNight: false, highway: false, weekend: false,
  tireSource: 'Inventory', inventoryDeductions: null, paymentStatus: 'Paid',
  invoiceGenerated: false, invoiceSent: false, reviewRequested: false,
  ...over,
} as Job);

const mkBreakdown = (over: Partial<{
  packageCost: number;
  addOnIds: ReadonlyArray<string>;
  travelCost: number;
  travelChargeable: number;
  vehicleSize: string;
  vehicleSizeMultiplier: number;
}> = {}): PricingBreakdownTagged => ({
  model: 'package_multiplier',
  revenue: 325,
  vehicleSize: 'SUV',
  vehicleSizeMultiplier: 1.25,
  packageCost: 275,
  addOnsCost: 45,
  addOnIds: ['Pet Hair Removal', 'Tire Shine'],
  travelCost: 5.20,
  travelMiles: 8,
  travelChargeable: 8,
  freeMilesIncluded: 0,
  directCost: 325.20,
  profit: 0,
  profitMargin: 0,
  quantity: 1,
  belowMinServiceCharge: false,
  minServiceCharge: 40,
  ...over,
} as PricingBreakdownTagged);

console.log('\n┌─ DETAILING_INVOICE_TEMPLATE.buildLineItems ───────');

// Full mix: package + 2 add-ons + travel
{
  const lines = DETAILING_INVOICE_TEMPLATE.buildLineItems(
    baseJob(), mkBreakdown(), 'Full Detail', settings,
  );
  check('full mix: 4 lines', lines.length === 4);
  check('first line is package with SUV 1.25× annotation',
    lines[0].description.includes('Full Detail') && lines[0].description.includes('1.25'));
  check('package amount = 275', lines[0].amount === 275);
  check('second line: Pet Hair Removal $30',
    lines[1].description === 'Pet Hair Removal' && lines[1].amount === 30);
  check('third line: Tire Shine $15',
    lines[2].description === 'Tire Shine' && lines[2].amount === 15);
  check('fourth line: Travel with mi count',
    lines[3].description.includes('8 mi') && lines[3].amount === 5.2);
}

// No add-ons
{
  const lines = DETAILING_INVOICE_TEMPLATE.buildLineItems(
    baseJob(),
    mkBreakdown({ addOnIds: [], addOnsCost: 0 }),
    'Full Detail', settings,
  );
  check('empty add-ons: 2 lines (package + travel)',
    lines.length === 2);
}

// No travel
{
  const lines = DETAILING_INVOICE_TEMPLATE.buildLineItems(
    baseJob(),
    mkBreakdown({ travelCost: 0, travelChargeable: 0 }),
    'Full Detail', settings,
  );
  const hasTravel = lines.some((l) => l.description.toLowerCase().includes('travel'));
  check('zero travel: no travel line', !hasTravel);
}

// Sedan (1.0×) — no multiplier suffix
{
  const lines = DETAILING_INVOICE_TEMPLATE.buildLineItems(
    baseJob(),
    mkBreakdown({ vehicleSize: 'Sedan', vehicleSizeMultiplier: 1, packageCost: 220 }),
    'Full Detail', settings,
  );
  check('Sedan: description has "Sedan" but NO multiplier suffix',
    lines[0].description.includes('Sedan') && !lines[0].description.includes('×'));
}

// XL SUV (1.5×)
{
  const lines = DETAILING_INVOICE_TEMPLATE.buildLineItems(
    baseJob(),
    mkBreakdown({ vehicleSize: 'XL SUV', vehicleSizeMultiplier: 1.5, packageCost: 330 }),
    'Full Detail', settings,
  );
  check('XL SUV: description shows 1.5×',
    lines[0].description.includes('XL SUV') && lines[0].description.includes('1.5'));
}

// Unknown add-on id → skipped
{
  const lines = DETAILING_INVOICE_TEMPLATE.buildLineItems(
    baseJob(),
    mkBreakdown({ addOnIds: ['Pet Hair Removal', 'Unknown Service'], addOnsCost: 30 }),
    'Full Detail', settings,
  );
  // packageCost 275 + 1 add-on + travel = 3 lines (unknown skipped)
  check('unknown add-on id skipped', lines.length === 3);
}

// Zero packageCost → no package line
{
  const lines = DETAILING_INVOICE_TEMPLATE.buildLineItems(
    baseJob({ service: 'Unknown' }),
    mkBreakdown({ packageCost: 0, addOnIds: [], travelCost: 0 }),
    'Unknown', settings,
  );
  check('zero packageCost, no add-ons, no travel: 0 lines',
    lines.length === 0);
}

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
```

- [ ] **Step 4: Run + verify**

```bash
npx tsx tests/detailingInvoiceLineItems.test.ts
npm run build
```

- [ ] **Step 5: Commit**

```bash
git add src/config/businessTypes/invoice/detailing.ts tests/detailingInvoiceLineItems.test.ts
git commit -m "feat(detailing-invoice): populate buildLineItems (package + add-ons + travel) + tests"
```

---

## Task 5: Dashboard metrics test

**Files:**
- Create: `tests/detailingDashboardMetrics.test.ts`

The metrics live in `DETAILING_CONFIG.dashboardMetrics` (declared in Task 2). This test exercises them independently to confirm correctness.

- [ ] **Step 1: Write the test**

```ts
// tests/detailingDashboardMetrics.test.ts
// Run: npx tsx tests/detailingDashboardMetrics.test.ts

import { DETAILING_CONFIG } from '@/config/businessTypes/detailing';
import type { Job, Settings } from '@/types';

let passed = 0;
let failed = 0;
const check = (label: string, cond: boolean): void => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}`); }
};

const settings: Settings = {} as Settings;

// Helper: today's ISO date in YYYY-MM-DD
function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}
function lastWeekISO(): string {
  const d = new Date();
  d.setDate(d.getDate() - 8);
  return d.toISOString().slice(0, 10);
}

const j = (over: Partial<Job> & { detailingAddons?: ReadonlyArray<string> } = {}): Job => ({
  id: 'j', date: todayISO(), service: 'Full Detail', vehicleType: 'Car',
  area: '', payment: 'Cash', status: 'Completed', source: 'Google',
  customerName: 'John', customerPhone: '5550001234',
  tireSize: '', qty: 1, revenue: 200, tireCost: 0, materialCost: 0,
  miles: 0, note: '', emergency: false, lateNight: false, highway: false, weekend: false,
  tireSource: 'Inventory', inventoryDeductions: null, paymentStatus: 'Paid',
  invoiceGenerated: false, invoiceSent: false, reviewRequested: false,
  ...over,
} as Job);

// Locate metrics by id
const metric = (id: string) => {
  const m = DETAILING_CONFIG.dashboardMetrics.find((x) => x.id === id);
  if (!m) throw new Error(`metric ${id} not found`);
  return m;
};

console.log('\n┌─ details_this_week ───────────────────────────────');
{
  const m = metric('details_this_week');
  check('counts week jobs',
    m.compute([j({ id: 'a' }), j({ id: 'b' }), j({ id: 'c', date: lastWeekISO() })], settings) === 2);
  check('empty list → 0', m.compute([], settings) === 0);
}

console.log('\n┌─ revenue_week ────────────────────────────────────');
{
  const m = metric('revenue_week');
  check('sums revenue across week jobs',
    m.compute([j({ revenue: 200 }), j({ revenue: 350 }), j({ revenue: 75, date: lastWeekISO() })], settings) === 550);
  check('empty → 0', m.compute([], settings) === 0);
}

console.log('\n┌─ avg_ticket ──────────────────────────────────────');
{
  const m = metric('avg_ticket');
  check('avg of 2 completed jobs',
    m.compute([j({ revenue: 200 }), j({ revenue: 400 })], settings) === 300);
  check('skips Pending jobs',
    m.compute([j({ revenue: 200 }), j({ revenue: 1000, status: 'Pending' })], settings) === 200);
  check('no completed week jobs → 0', m.compute([], settings) === 0);
}

console.log('\n┌─ repeat_customer_pct ─────────────────────────────');
{
  const m = metric('repeat_customer_pct');
  // 1 repeat customer this week (John, who had a job last week), 1 brand new
  const jobs = [
    j({ id: 'old', date: lastWeekISO(), customerPhone: '5550001234', status: 'Completed' }),
    j({ id: 'this1', customerPhone: '5550001234' }), // repeat
    j({ id: 'this2', customerPhone: '5559999999' }), // new
  ];
  check('1/2 week customers are repeat = 0.5',
    m.compute(jobs, settings) === 0.5);
  check('no week jobs → 0', m.compute([], settings) === 0);
}

console.log('\n┌─ addons_pct ──────────────────────────────────────');
{
  const m = metric('addons_pct');
  const jobs = [
    j({ id: 'a', detailingAddons: ['Pet Hair Removal'] }),
    j({ id: 'b', detailingAddons: [] }),
    j({ id: 'c' }),
    j({ id: 'd', detailingAddons: ['Tire Shine', 'Glass Treatment'] }),
  ];
  check('2/4 jobs have add-ons = 0.5', m.compute(jobs, settings) === 0.5);
  check('zero completed week jobs → 0', m.compute([], settings) === 0);
  check('all jobs with add-ons → 1.0',
    m.compute([j({ detailingAddons: ['x'] }), j({ detailingAddons: ['y'] })], settings) === 1);
}

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
```

- [ ] **Step 2: Run + verify**

```bash
npx tsx tests/detailingDashboardMetrics.test.ts
```

- [ ] **Step 3: Commit**

```bash
git add tests/detailingDashboardMetrics.test.ts
git commit -m "test(detailing): dashboard metrics coverage (5 cards)"
```

---

## Task 6: AddJob — vehicle-size chip block + add-ons multi-select

**Files:**
- Modify: `src/pages/AddJob.tsx`

- [ ] **Step 1: Locate the Service section + insertion site**

```bash
grep -n "form-group-title.*Service\|vehicleSize" src/pages/AddJob.tsx | head -10
```

You're looking for the Service form-group block (the chip-grid mapping over `vertical.services`). Vehicle Size + Add-ons should render BEFORE Service when `vertical.features.vehicleSizeMultiplier === true`. Add-ons render AFTER the Service block.

- [ ] **Step 2: Wire the Service chip-grid to filter add-ons + render via packageLabel**

Find the existing Service chip-grid (search for `enabledServices.map`). Modify the filter to exclude add-ons:

```tsx
const packageServices = useMemo(
  () => vertical.services.filter((s) => !s.isAddOn && enabledServiceIds.has(s.id)),
  [vertical.services, enabledServiceIds],
);
```

Replace the `enabledServices.map` call inside the Service block with `packageServices.map`. Update the section title to use `vertical.copy.packageLabel ?? 'Service'`:

```tsx
<div className="form-group-title">{vertical.copy.packageLabel || 'Service'}</div>
```

(If `enabledServices` is computed elsewhere, replicate the package-only filter there.)

- [ ] **Step 3: Add the vehicle-size chip block BEFORE the Service block**

Find the Service block opening (`<div className="form-group card-anim">` wrapping the Service title). Immediately before it, insert:

```tsx
{vertical.features.vehicleSizeMultiplier && (
  <div className="form-group card-anim">
    <div className="form-group-title">Vehicle size</div>
    <div className="chip-grid">
      {Object.keys(
        (vertical.pricingModel.kind === 'package_multiplier'
          ? vertical.pricingModel.vehicleSizeMultipliers
          : {}),
      ).map((sz) => (
        <button
          key={sz}
          type="button"
          className={'chip' + (job.vehicleSize === sz ? ' active' : '')}
          onClick={() => set('vehicleSize', sz)}
        >
          {sz}
        </button>
      ))}
    </div>
  </div>
)}
```

(`set('vehicleSize', sz)` uses the existing `set` helper in AddJob.)

- [ ] **Step 4: Add the add-ons multi-select AFTER the Service block**

Find the closing `</div>` of the Service block. Insert immediately after:

```tsx
{vertical.key === 'detailing' && (() => {
  const addOns = vertical.services.filter((s) => s.isAddOn && enabledServiceIds.has(s.id));
  if (addOns.length === 0) return null;
  const selected = new Set(job.detailingAddons ?? []);
  const toggle = (id: string): void => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    set('detailingAddons', Array.from(next) as unknown as Job['detailingAddons']);
  };
  return (
    <div className="form-group card-anim">
      <div className="form-group-title">
        Add-ons <span style={{ fontWeight: 400, color: 'var(--t3)', fontSize: 11 }}>(tap any that apply)</span>
      </div>
      <div className="chip-grid">
        {addOns.map((s) => (
          <button
            key={s.id}
            type="button"
            className={'chip' + (selected.has(s.id) ? ' active' : '')}
            onClick={() => toggle(s.id)}
          >
            {s.label}
          </button>
        ))}
      </div>
    </div>
  );
})()}
```

- [ ] **Step 5: Confirm `enabledServiceIds` (or equivalent) exists**

Run:

```bash
grep -n "enabledServices\|enabledServiceIds" src/pages/AddJob.tsx | head -5
```

If the existing code uses an `enabledServices: string[]` array instead of a `Set`, adapt the filter to use `.includes()` instead of `.has()`. The intent is identical.

- [ ] **Step 6: Verify build**

```bash
npm run build
```

- [ ] **Step 7: Commit**

```bash
git add src/pages/AddJob.tsx
git commit -m "feat(addjob): detailing vehicle-size chip block + add-ons multi-select + packageLabel override"
```

---

## Task 7: AddBusinessModal — expose Detailing

**Files:**
- Modify: `src/components/AddBusinessModal.tsx`

- [ ] **Step 1: Add the Detailing entry**

Open `src/components/AddBusinessModal.tsx`. Find the existing vertical picker array (currently `[{ tire }, { mechanic }]` — search for `'Mobile Tire'`). Add the third entry:

```tsx
{([
  { key: 'tire' as VerticalKey, label: 'Mobile Tire & Roadside' },
  { key: 'mechanic' as VerticalKey, label: 'Mobile Mechanic' },
  { key: 'detailing' as VerticalKey, label: 'Mobile Car Wash & Detailing' },
]).map((opt) => {
```

(The picker iterates and renders each option as a button. No other changes needed — selection state, signup payload, and seeding via `servicePricingFromVertical()` all work uniformly.)

- [ ] **Step 2: Verify build**

```bash
npm run build
```

- [ ] **Step 3: Commit**

```bash
git add src/components/AddBusinessModal.tsx
git commit -m "feat(onboarding): expose Detailing in AddBusinessModal vertical picker"
```

---

## Task 8: Final smoke + push + tag

- [ ] **Step 1: Re-run every test file**

```bash
for t in tests/jobLifecycle.test.ts tests/mechanicJobDerivation.test.ts tests/mechanicDeductionDiff.test.ts tests/mechanicDeductionRollback.test.ts tests/softStockWarning.test.ts tests/mechanicInvoiceLineItems.test.ts tests/technicianPermissions.test.ts tests/scopedJobs.test.ts tests/jobEditPermission.test.ts tests/jobDeletePermission.test.ts tests/assignableMembers.test.ts tests/transitionJobStage.test.ts tests/canTransitionToStage.test.ts tests/historyEntries.test.ts tests/groupJobsByStage.test.ts tests/renderTemplate.test.ts tests/buildTemplateVars.test.ts tests/dispatchNotifications.test.ts tests/openMessagingUri.test.ts tests/visibleNotifications.test.ts tests/computePackageMultiplierPrice.test.ts tests/calcPackageMultiplierQuote.test.ts tests/detailingInvoiceLineItems.test.ts tests/detailingDashboardMetrics.test.ts; do
  result=$(npx tsx "$t" 2>&1 | grep -E "^\s+[0-9]+ passed" | tail -1)
  echo "$t → $result"
done
```
Expected: every file prints `N passed, 0 failed`.

- [ ] **Step 2: Final clean build**

```bash
npm run build
```

- [ ] **Step 3: Confirm commit log**

```bash
git log --oneline origin/main..HEAD
```
Expected: ~8 commits, focused, granular.

- [ ] **Step 4: Push**

```bash
git push origin main
```

- [ ] **Step 5: Run §16 spec smoke checklist on production**

After deploy lands:

**Owner regression (tire + mechanic):**
- Tire account: Dashboard / AddJob / Inventory / Settings / Invoice / StagePicker / NotificationsBell unchanged
- Mechanic account: same

**AddBusinessModal:**
- Detailing appears in dropdown
- Selecting Detailing → creates business with populated service catalog seeded

**Detailing flow:**
- Vehicle size chips render (5 sizes)
- Package chips render (8 packages)
- Add-ons multi-select chips render (7 add-ons)
- Pick Full Detail + SUV → live breakdown shows package × 1.25
- Add 2 add-ons → flat-priced additions, no multiplier
- Save job → appears on History
- Generate invoice → package line with `(SUV 1.25×)`, add-on lines, travel
- Dashboard shows 5 detailing metrics
- Multi-job same customer → repeat_customer_pct correct
- Stage picker on JobDetailModal works (lifecycle from Phase 2.1)
- Customer SMS/email notifications surface on relevant transitions (Phase 2.2-D)

**Cross-cutting:**
- No console errors
- Bundle delta ≤ +6 kB gzipped

- [ ] **Step 6: Tag stable**

```bash
git tag phase-2.3-detailing-stable $(git rev-parse HEAD)
git push origin phase-2.3-detailing-stable
```

---

## Phase summary

After all 8 tasks land:

| Surface | Result |
|---|---|
| Types | `Job.detailingAddons?`; `QuoteForm.detailingAddons?`; `BusinessTypeService.isAddOn?`; `PackageMultiplierPricingModel.defaultMinServiceCharge?`; `BusinessTypeCopy.packageLabel?` |
| Detailing config | 8 packages + 7 add-ons; 5 dashboard metrics; defaultMinServiceCharge 40; packageLabel "Package" |
| Pricing engine | `package_multiplier` engine completed; flat-priced add-ons, package × multiplier |
| Invoice | Package line with `(SUV 1.25×)` annotation + per-add-on lines + travel |
| AddJob | Vehicle-size chip block + add-ons multi-select for detailing; existing Service chip-grid filters out add-ons |
| AddBusinessModal | Detailing exposed as a third vertical option |
| Tests | 4 new files; ~70 new assertions |
| Backward compat | Tire / mechanic workflows byte-identical; existing detailing accounts gain the populated workflow on next render |
| Schema | One new optional Job field; type widenings purely additive |
| firestore.rules | No changes |

Phase 2.3 complete after the tag lands. Detailing operators can run real jobs end-to-end on the app.
