# Phase 2.1 — Vertical Config Runtime

**Status:** Draft for review
**Date:** 2026-05-20
**Author:** Claude (under direction from MobileServiceOS owner)
**Depends on:** `1ee9122` Stabilize Add Business flow and dev/PWA service worker
**Blocks:** Phase 2.2 (Mechanic full slice), Phase 2.3 (Detailing full slice), and every Phase 2.x that touches per-vertical UI

## 1. Context

Mobile Service OS today ships three layers of vertical (a.k.a. business-type) abstraction:

- [src/lib/verticals.ts](../../../src/lib/verticals.ts) — `VerticalConfig` interface + `TIRE_VERTICAL` + `MECHANIC_VERTICAL` registry. Labelled "Stage 1, dormant".
- [src/lib/verticalContext.ts](../../../src/lib/verticalContext.ts) — pure `resolveVerticalKey(settings)` / `resolveVertical(settings)` helpers with explicit tire-fallback for legacy docs. Labelled "Stage 1, dormant".
- [src/lib/useActiveVertical.ts](../../../src/lib/useActiveVertical.ts) — React hook `useActiveVertical()` that resolves the active business's config off `BrandContext`. Labelled "Stage 3b-1, dormant".

All three are dormant — nothing in the live render path imports them. Meanwhile every UI surface that should be vertical-aware hardcodes tire concepts:

| File | LOC | Tire references | What's coupled |
|---|---:|---:|---|
| [src/pages/AddJob.tsx](../../../src/pages/AddJob.tsx) | 704 | 56 | Service picker, tireSource/tireSize/tireBrand/condition fields, tire-cost computation, quick quote |
| [src/lib/invoice.ts](../../../src/lib/invoice.ts) | 677 | 25 | `customerFriendlyServiceName` mapping table, line-item template, footer copy |
| [src/pages/Inventory.tsx](../../../src/pages/Inventory.tsx) | 587 | 17 | Tire-shape inventory item (tireSize/rimSize/brand/condition) |
| [src/components/Onboarding.tsx](../../../src/components/Onboarding.tsx) | 435 | 14 | Service catalog confirmation, tire-pricing wizard |
| [src/pages/Dashboard.tsx](../../../src/pages/Dashboard.tsx) | 702 | 11 | Empty-state copy, KPI labels, top-services list |
| [src/pages/Settings.tsx](../../../src/pages/Settings.tsx) | 2050 | 6 | Service price editor, vehicle pricing editor |
| [src/lib/pricing.ts](../../../src/lib/pricing.ts) | 48 | 6 | `computeBreakdown(job, settings)` assumes flat-pricing + tire-cost field |
| **Total** | **5,203** | **135** | |

Existing tire accounts have no `businessType` field on their settings doc. The resolver in `verticalContext.ts` already handles that — absent/unknown values fall back to `'tire'` — but because nothing reads it, the safety net hasn't been exercised in production yet.

`createBusiness` (post-`1ee9122`) is the only code path that reads `verticals.ts` at runtime, and only to seed `servicePricing` on a new business's `settings/main`. Pricing engine, job form, invoice, dashboard, and inventory all stay tire-shaped regardless of `businessType`.

## 2. Goal

Promote the dormant vertical layer to the single runtime source of truth for everything that varies between business types. Tire stays bit-for-bit identical (its config mirrors the existing tire defaults exactly). The mechanic vertical, which already creates correctly via `createBusiness`, becomes visually and functionally distinct in every UI surface — without any new mechanic-specific code beyond the config and one pricing-engine implementation.

Phrased as a single sentence: **after Phase 2.1, swapping `settings.businessType` from `'tire'` to `'mechanic'` (or vice versa) changes the running app's behavior end-to-end via config alone.**

## 3. Non-goals (deliberately deferred)

These all sit on top of Phase 2.1's foundation; none are in scope here.

- **Detailing as a fully populated vertical.** Phase 2.1 ships only a skeleton `detailing.ts` whose pricing model is `package_multiplier` and whose service list is empty. This proves the registry tolerates an unfilled third vertical. Phase 2.3 fills it.
- **Mechanic-specific UI features beyond what config alone unlocks.** VIN field, photo gallery, parts-supplier tracking, diagnostic notes, before/after photos — all Phase 2.2.
- **Job-pipeline statuses, scheduling, calendar, technician payouts, CRM, analytics.** Phases 2.4–2.10.
- **Firestore schema migration.** No existing job, settings, or inventory doc is rewritten by this phase. Phase 2.1 is a code refactor, not a data migration.
- **`firestore.rules` changes.** Rules stay untouched.
- **`firebase.json`, hosting, or PWA service-worker changes.** Untouched.
- **Strict-mode TypeScript enablement** if it isn't already on. (`tsconfig.json` says strict — already on.) Phase 2.1 just preserves it.
- **Rewriting any component that's already vertical-clean** (the four context files, App.tsx, `firebase.ts`, etc.). Touch only what's tire-coupled.

## 4. Architecture

### 4.1 File layout

```
src/
  config/
    businessTypes/
      types.ts          # BusinessTypeConfig, BusinessTypeKey, sub-interfaces
      registry.ts       # BUSINESS_TYPE_REGISTRY, getBusinessTypeConfig(), feature flags
      tire.ts           # TIRE_CONFIG: exact mirror of today's tire defaults
      mechanic.ts       # MECHANIC_CONFIG: populated for the slice that exists today
      detailing.ts      # DETAILING_CONFIG: skeleton only (package_multiplier model, empty service list)
      pricing/
        flat.ts         # computeFlatPrice(job, settings)  — tire's existing engine, extracted
        laborParts.ts   # computeLaborPartsPrice(job, settings) — minimal mechanic engine
        packageMult.ts  # computePackageMultiplierPrice(job, settings) — stub that returns the base price for now (filled in 2.3)
        index.ts        # getPricingEngine(model) -> engine
      invoice/
        tire.ts         # invoice column schema + customer-friendly service name map for tire
        mechanic.ts     # same, for mechanic
        detailing.ts    # skeleton
        index.ts        # getInvoiceTemplate(key) -> template
  lib/
    verticals.ts        # DEPRECATED SHIM — re-exports from config/businessTypes for back-compat
    verticalContext.ts  # unchanged (already pure + correct)
    useActiveVertical.ts # unchanged (re-exports the same hook surface; reads through the shim)
    pricing.ts          # becomes a thin dispatcher: pick engine by active vertical, delegate
    invoice.ts          # becomes a thin dispatcher: pick template by active vertical, delegate
```

The old `src/lib/verticals.ts` is preserved as a deprecation shim that re-exports the new symbols. Every existing `import { VerticalConfig, getVerticalConfig, … } from '@/lib/verticals'` keeps working byte-for-byte; we migrate call sites opportunistically, not in a big-bang.

### 4.2 Types

```ts
// src/config/businessTypes/types.ts

// NOTE: the existing dormant code uses `'carwash'` as the third key
// (see src/lib/verticals.ts and KNOWN_VERTICAL_KEYS in
// src/lib/verticalContext.ts). Phase 2.1 renames this enum value to
// `'detailing'` to match the user-specified file name and the
// product-facing nomenclature ("Mobile Car Wash / Detailing"). The
// rename is safe because:
//   - No production business has `businessType: 'carwash'` — the
//     AddBusinessModal only offers tire + mechanic today.
//   - The dormant verticalContext resolver still defaults unknown
//     keys to 'tire', so even if a stale 'carwash' string is
//     somehow stored, it degrades safely.
//   - The shim at src/lib/verticals.ts maps the old `'carwash'`
//     literal to `'detailing'` for any forward-compat reads.
export type BusinessTypeKey = 'tire' | 'mechanic' | 'detailing';

export const DEFAULT_BUSINESS_TYPE_KEY: BusinessTypeKey = 'tire';

/** Carried forward verbatim from VerticalConfig; renamed for clarity. */
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

  // NEW in 2.1 — fields the existing dormant config did not include
  // because nothing yet read them.
  features: BusinessTypeFeatures;
  invoiceTemplateKey: BusinessTypeKey;  // points into invoice/<key>.ts
  dashboardMetrics: DashboardMetricSpec[];
}

export interface BusinessTypeFeatures {
  /** Show the inventory-deduction flow on Add Job. Tire = true; mechanic/detailing = false today. */
  inventoryDeduction: boolean;
  /** Show before/after photo capture on Add Job. Detailing = true; others = false. */
  photoCapture: boolean;
  /** Show VIN / mileage / diagnostic-notes fields. Mechanic = true; others = false. */
  vehicleDiagnostics: boolean;
  /** Show vehicle-size selector with package multipliers. Detailing = true; others = false. */
  vehicleSizeMultiplier: boolean;
  /** Show wheel-lock / spare-change category. Tire only. */
  roadsideAddons: boolean;
}

export interface DashboardMetricSpec {
  /** Stable id used for memo keys, e.g. 'revenue_week'. */
  id: string;
  /** Label rendered on the card. */
  label: string;
  /** How to compute the value from a job list + settings. */
  compute: (jobs: ReadonlyArray<Job>, settings: Settings) => number;
  /** How to format for display (currency / number / percentage). */
  format: 'currency' | 'number' | 'percent';
}

// PricingModel is unchanged (already declared in verticals.ts).
// BusinessTypeService, BusinessTypeJobField, BusinessTypeInventoryField,
// BusinessTypeCopy are renames of the existing VerticalService /
// VerticalJobField / VerticalInventoryField / VerticalCopy.
```

Backward-compat aliases live alongside:

```ts
// Re-exported from the shim at src/lib/verticals.ts:
export type VerticalKey = BusinessTypeKey;
export type VerticalConfig = BusinessTypeConfig;
// …and the rest of the old type names.
```

Migration of call sites from `VerticalConfig` → `BusinessTypeConfig` happens opportunistically; not a 2.1 blocker.

### 4.3 Registry

```ts
// src/config/businessTypes/registry.ts

import type { BusinessTypeConfig, BusinessTypeKey } from './types';
import { TIRE_CONFIG } from './tire';
import { MECHANIC_CONFIG } from './mechanic';
import { DETAILING_CONFIG } from './detailing';

export const BUSINESS_TYPE_REGISTRY: Readonly<Record<BusinessTypeKey, BusinessTypeConfig>> = {
  tire: TIRE_CONFIG,
  mechanic: MECHANIC_CONFIG,
  detailing: DETAILING_CONFIG,
};

export function getBusinessTypeConfig(
  key: BusinessTypeKey | null | undefined,
): BusinessTypeConfig {
  if (key && BUSINESS_TYPE_REGISTRY[key]) {
    return BUSINESS_TYPE_REGISTRY[key];
  }
  return TIRE_CONFIG;
}

/**
 * Top-level feature-flag lookup. UI gates that depend on a feature
 * call this rather than checking `config.features.<x>` directly, so
 * we have one chokepoint for cross-cutting toggles (kill switches,
 * staged rollouts).
 */
export function hasFeature(
  key: BusinessTypeKey | null | undefined,
  feature: keyof BusinessTypeConfig['features'],
): boolean {
  return getBusinessTypeConfig(key).features[feature];
}
```

The shim at [src/lib/verticals.ts](../../../src/lib/verticals.ts) re-exports `BUSINESS_TYPE_REGISTRY` as `VERTICAL_REGISTRY`, `getBusinessTypeConfig` as `getVerticalConfig`, etc., so [src/lib/createBusiness.ts](../../../src/lib/createBusiness.ts) (and any other consumer that lands before the rename pass) keeps working without an import change.

### 4.4 Pricing engine

The existing `PricingModel` discriminated union (`flat | labor_parts | package_multiplier`) already exists in `verticals.ts`. Phase 2.1 wires each variant to an engine:

```ts
// src/config/businessTypes/pricing/index.ts

import type { Job, Settings } from '@/types';
import type { PricingModel } from '../types';
import { computeFlatPrice, type FlatBreakdown } from './flat';
import { computeLaborPartsPrice, type LaborPartsBreakdown } from './laborParts';
import { computePackageMultiplierPrice, type PackageMultBreakdown } from './packageMult';

export type PricingBreakdown =
  | (FlatBreakdown & { model: 'flat' })
  | (LaborPartsBreakdown & { model: 'labor_parts' })
  | (PackageMultBreakdown & { model: 'package_multiplier' });

export function computePrice(
  job: Job,
  settings: Settings,
  model: PricingModel,
): PricingBreakdown {
  switch (model.kind) {
    case 'flat':
      return { ...computeFlatPrice(job, settings), model: 'flat' };
    case 'labor_parts':
      return { ...computeLaborPartsPrice(job, settings, model), model: 'labor_parts' };
    case 'package_multiplier':
      return { ...computePackageMultiplierPrice(job, settings, model), model: 'package_multiplier' };
  }
}
```

[src/lib/pricing.ts](../../../src/lib/pricing.ts)'s existing `computeBreakdown(job, settings)` becomes a thin adapter that resolves the active model from settings and dispatches to `computePrice`. Public signature unchanged; return type widens to include `model` so call sites can branch when they need to. All current call sites just read `revenue`, `profit`, `directCost`, etc. — those fields exist on all three breakdown shapes (the union is a superset of today's `PricingBreakdown` for the tire `flat` case, plus extra fields for the other two).

Mechanic's `computeLaborPartsPrice` is a small but non-trivial implementation in 2.1:
- inputs: `laborHours`, `partsCost`, `diagnosticFee`, `revenue`, `miles`
- outputs: `revenue`, `laborCost`, `partsCost`, `partsMarkupAmount`, `diagnosticFee`, `travelCost`, `directCost`, `profit`, `profitMargin`
- the model carries `defaultLaborRate`, `defaultPartsMarkupPct`, `defaultMinServiceCharge`, `defaultDiagnosticFee` — all already declared in the existing `LaborPartsPricingModel` type.

Detailing's `computePackageMultiplierPrice` is a stub in 2.1: it returns `{ revenue, directCost: 0, profit: revenue, profitMargin: 1 }`. The real implementation lands in 2.3. The stub keeps the union exhaustive without claiming behavior we haven't designed yet.

### 4.5 Invoice template

```ts
// src/config/businessTypes/invoice/types.ts

export interface InvoiceTemplate {
  /** Header subtitle, e.g. 'Mobile Tire & Roadside Service'. */
  subtitle: string;
  /** Customer-friendly service name resolver. Each vertical has its own map. */
  resolveServiceName: (raw: string | null | undefined) => string;
  /** Footer disclaimer/warranty boilerplate, vertical-specific. */
  footerCopy: string;
  /** Which job fields to render as the line-item description. */
  lineItemFields: ReadonlyArray<keyof Job>;
}
```

[src/lib/invoice.ts](../../../src/lib/invoice.ts) keeps its public function signatures (`generateInvoicePDF`, etc.). Internally it resolves the active business-type template and reads `subtitle` / `resolveServiceName` / `footerCopy` / `lineItemFields` from it instead of from hardcoded constants. The existing `customerFriendlyServiceName` table moves into `invoice/tire.ts`.

### 4.6 Dashboard metrics

[src/pages/Dashboard.tsx](../../../src/pages/Dashboard.tsx) reads `config.dashboardMetrics` from `useActiveVertical()` and renders one card per spec. Tire's spec set mirrors today's cards (revenue this week, profit this week, average ticket, top services). Mechanic gets a different spec set (revenue this week, parts cost ratio, labor hours billed, average ticket). Detailing's spec set is empty in 2.1 (renders zero cards until 2.3).

Each `DashboardMetricSpec` is a pure function over `(jobs, settings)`; the page doesn't change shape, it just iterates the config-provided list.

### 4.7 Onboarding service catalog

[src/components/Onboarding.tsx](../../../src/components/Onboarding.tsx) currently reads `DEFAULT_SERVICE_PRICING` from `defaults.ts` (tire-only) when seeding service prices. In 2.1, Onboarding reads `config.services` from the active business-type config and seeds the same shape. For first-time tire signups (no `businessType` field), the resolver returns `TIRE_CONFIG` and the seeded list is identical to today's.

## 5. Touchpoint inventory

The complete list of files Phase 2.1 must touch, with the change shape per file:

| File | Change kind | Tire back-compat strategy |
|---|---|---|
| `src/config/businessTypes/types.ts` | NEW | n/a |
| `src/config/businessTypes/registry.ts` | NEW | TIRE_CONFIG is the fallback for unknown keys |
| `src/config/businessTypes/tire.ts` | NEW | Verbatim port of TIRE_VERTICAL + features/dashboardMetrics |
| `src/config/businessTypes/mechanic.ts` | NEW | Verbatim port of MECHANIC_VERTICAL + features/dashboardMetrics |
| `src/config/businessTypes/detailing.ts` | NEW | Skeleton: empty services, `package_multiplier` model |
| `src/config/businessTypes/pricing/flat.ts` | NEW | Exact extraction of current `computeBreakdown` body |
| `src/config/businessTypes/pricing/laborParts.ts` | NEW | New, but only called when `model.kind === 'labor_parts'` |
| `src/config/businessTypes/pricing/packageMult.ts` | NEW | Stub for 2.3 |
| `src/config/businessTypes/pricing/index.ts` | NEW | n/a |
| `src/config/businessTypes/invoice/tire.ts` | NEW | Carries the existing `customerFriendlyServiceName` table |
| `src/config/businessTypes/invoice/mechanic.ts` | NEW | New mechanic-specific service-name map |
| `src/config/businessTypes/invoice/detailing.ts` | NEW | Skeleton |
| `src/config/businessTypes/invoice/index.ts` | NEW | n/a |
| `src/lib/verticals.ts` | REPLACE with shim | Re-exports the new symbols under old names |
| `src/lib/verticalContext.ts` | NO CHANGE | Already pure + correct |
| `src/lib/useActiveVertical.ts` | NO CHANGE | Already correct (reads through the shim) |
| `src/lib/pricing.ts` | EDIT — dispatcher | Same exported signature; behaviour identical for tire (model='flat') |
| `src/lib/invoice.ts` | EDIT — dispatcher | Same exported signatures; behaviour identical for tire |
| `src/lib/defaults.ts` | EDIT — deprecate constants | `DEFAULT_SERVICE_PRICING` becomes `tire.ts`'s service map re-exported; `DEFAULT_VEHICLE_PRICING` ditto. JSDoc adds `@deprecated read from active config instead` |
| `src/pages/AddJob.tsx` | EDIT — read config | Service picker, job-field rendering, and pricing dispatch all read `useActiveVertical()`. Tire renders identically because TIRE_CONFIG matches today's layout |
| `src/pages/Dashboard.tsx` | EDIT — read config | Card list comes from `config.dashboardMetrics` |
| `src/pages/Inventory.tsx` | EDIT — read config | Item-field renderer reads `config.inventoryFields` |
| `src/pages/Settings.tsx` | EDIT — read config | Service-price editor + vehicle-pricing editor render from `config.services` / `config.pricingModel` |
| `src/components/Onboarding.tsx` | EDIT — read config | Seeds from `config.services` instead of `DEFAULT_SERVICE_PRICING` |

Anything not in this table is **out of scope** for 2.1.

## 6. Migration strategy

Phase 2.1 is intentionally divided into safe milestones, each of which leaves `npm run build` green and the tire workflow operational. The order matters: types and pricing first, UI last.

**Milestone A — Types & registry foundation, no behavior change.**
- Create `src/config/businessTypes/types.ts`, `registry.ts`, `tire.ts`, `mechanic.ts`, `detailing.ts`.
- Make `src/lib/verticals.ts` a re-export shim. Every existing import keeps resolving.
- Build green. Tire workflow untouched.
- Commit. Verify Add Business still seeds correctly (it now resolves the same config through a one-hop indirection).

**Milestone B — Pricing engine extraction, tire behavior identical.**
- Create `pricing/flat.ts`, `pricing/laborParts.ts`, `pricing/packageMult.ts`, `pricing/index.ts`.
- Rewrite `src/lib/pricing.ts` as a dispatcher.
- Build green. Tire `computeBreakdown` returns numerically identical results (golden-output test if practical).
- Commit.

**Milestone C — Invoice template extraction.**
- Create `invoice/tire.ts` (containing the existing service-name map verbatim), `invoice/mechanic.ts`, `invoice/detailing.ts`, `invoice/index.ts`.
- Rewrite `src/lib/invoice.ts` to dispatch via active config.
- Generate one tire invoice; compare to a pre-change snapshot for byte equality on the line items + subtitle + footer.
- Commit.

**Milestone D — Dashboard, Inventory, Settings, AddJob, Onboarding read from config.**
- Each component change is independently committable; build green after each.
- Each component's tire render output is visually identical to today (TIRE_CONFIG mirrors current defaults).
- Mechanic businesses now show mechanic services/copy/fields end-to-end.
- Commit per component (5 commits, each tiny).

**Milestone E — Defaults file deprecation.**
- `src/lib/defaults.ts`: keep `DEFAULT_SETTINGS`, `EMPTY_JOB`, etc. Mark `DEFAULT_SERVICE_PRICING` / `DEFAULT_VEHICLE_PRICING` as `@deprecated` and have them re-export the tire-config maps.
- Commit.

Each milestone runs `npm run build` and, where applicable, manual smoke tests on the dev server. The order means: even if Phase 2.1 has to be paused mid-stream (e.g. for a hotfix), the codebase at every milestone boundary is shippable.

## 7. Schema

**No Firestore schema change.** `settings.businessType` is already an optional string field (added by `createBusiness` for new businesses; absent for legacy tire businesses). `verticalContext.resolveVerticalKey` already handles both cases.

**One enum value rename:** `'carwash'` → `'detailing'`. The existing dormant code in `src/lib/verticals.ts` declared `VerticalKey = 'tire' | 'mechanic' | 'carwash'` but no production business has ever had `businessType: 'carwash'` written to it (the AddBusinessModal only exposes tire + mechanic). The shim at `src/lib/verticals.ts` maps a read of `'carwash'` to `'detailing'` for any forward-compat lookups, and the resolver still defaults any unknown string to `'tire'`. No data migration needed.

**No TypeScript type widening that breaks existing code.** `Settings` does NOT yet declare `businessType` (the dormant resolver reads it via a structural cast). 2.1 adds it as an optional field to `Settings` so call sites can read it without the cast.

**Job schema** stays unchanged for 2.1. Mechanic-specific fields (`laborHours`, `partsCost`, `diagnosticCode`, `vehicleMakeModel`, `mileage`) are already declared in `MECHANIC_VERTICAL.jobFields`; the form renders them but they're optional fields on the existing Job type, not a new schema.

## 8. Risks & rollback

**Risk: a tire user sees a visual or numerical regression.**
- Mitigation: TIRE_CONFIG is a verbatim port. Each milestone is independently verified against today's behavior before committing.
- Detection: dev-server smoke test per milestone; revenue/profit numbers compared on an existing tire account.
- Rollback: revert the offending commit. Milestones A–E are independent, so we can rollback granularly.

**Risk: mechanic businesses created during the migration window have partial config coverage.**
- Mitigation: Phase 2.1 doesn't ship mechanic-specific UI features beyond what the config alone unlocks. A mechanic business created today (post-`1ee9122`, pre-2.1) renders tire-shaped UI; after 2.1, it renders mechanic-shaped UI. Their stored data is unaffected.

**Risk: the dormant `verticals.ts` API surface gets used by an unexpected consumer during the migration.**
- Mitigation: the shim preserves every existing export. The only consumer today is `createBusiness`; the shim keeps it working.

**Risk: pricing-engine extraction introduces floating-point drift.**
- Mitigation: the extracted `computeFlatPrice` is the existing `computeBreakdown` body verbatim; same `r2()` rounding helper.

**Schema-breaking refactor escape hatch:** per the user's directive, no schema change ships without explicit approval. This spec contains none. If Milestone D reveals one is needed (it shouldn't), Phase 2.1 pauses, a follow-up spec is written, and approval is sought before continuing.

## 9. Validation plan

Per milestone (A–E), the gate before commit is:

1. `npm run build` exits 0 with no TypeScript errors.
2. `git status` is clean for tracked files except the intended changes.
3. Dev-server smoke test on an existing tire account:
   - Sign in.
   - Dashboard renders identically to today (revenue, profit, top services).
   - Add a job → save → invoice generates with identical line items.
   - Inventory list renders with tire columns.
   - Settings → service pricing renders with all tire services.
4. Dev-server smoke test on a freshly-created mechanic business (Add Business → Mobile Mechanic):
   - Dashboard renders mechanic-specific cards.
   - Add Job shows mechanic services (Diagnostics, Battery Replacement, etc.) and the mechanic-specific job fields declared in MECHANIC_CONFIG (`laborHours`, `partsCost`, `diagnosticCode`, `vehicleMakeModel`, `mileage`) — note this is the **basic schema-driven UI**; the rich diagnostics workflow (VIN field, before/after photos, parts-supplier tracking, warranty notes) is intentionally out-of-scope and lands in Phase 2.2.
   - Inventory uses mechanic columns (part number, supplier, unit cost).
   - Invoice subtitle says "Mobile Mechanic Service".
   - Saving a mechanic job runs `computeLaborPartsPrice` and shows a numerically-sensible breakdown (revenue, labor cost, parts cost + markup, diagnostic fee, profit, profit margin).

After Milestone E (final): re-run the GitHub Actions deploy locally via `npm run build && npx vite preview`, then through the live dev server. No console errors. No `[brand]` permission-denied. No `[createBusiness]` step failures.

## 10. Out-of-scope follow-ups

These are the natural next sub-projects. Each gets its own spec → plan → implementation cycle.

- **Phase 2.2 — Mechanic full slice.** VIN/mileage/diagnostic-notes UI on Add Job. Parts-supplier tracking. Before/after photo capture. Mechanic-specific inventory categories (fluids/batteries/filters) within the existing `inventoryFields` schema. Warranty notes on invoice. Adds real `computeLaborPartsPrice` polish (currently 2.1 ships a working but minimal version).
- **Phase 2.3 — Detailing full slice.** Populates `detailing.ts`. Real `computePackageMultiplierPrice`. Vehicle-size selector UI. Add-on package picker. Recurring-membership data model. Photo gallery (before/after/customer-approval).
- **Phase 2.4 — Job pipeline & technician assignment.** Adds `status` enum (`scheduled | en_route | arrived | in_progress | completed | paid`), `assignedTechnicianUid`, `scheduledAt` timestamp slot.
- **Phase 2.5 — Calendar/dispatch UI.** Built on 2.4's data model.
- **Phase 2.6 — Technician payouts.** Per-job commission, payout history, weekly payroll summary.
- **Phase 2.7 — CRM.** Customers as a top-level Firestore collection with reminders + tags + LTV.
- **Phase 2.8 — Analytics dashboard.** Filtered breakdowns (business / tech / service / date range).
- **Phase 2.9 — Estimates & deposits.** Estimate → invoice conversion. Signature capture. Partial payments.
- **Phase 2.10 — White-label foundation.** Branded subdomains, per-business colors, Stripe checkout enablement.

## 11. Open questions for review

None blocking. The following are intentional design calls; flag any you want to revisit before implementation.

- **Rename `VerticalConfig` → `BusinessTypeConfig` everywhere, or keep the alias permanent?** Spec proposes alias-permanent + opportunistic call-site rename, on the grounds that the rename is pure churn.
- **Should `DashboardMetricSpec.compute` be sync or allow async (e.g. for cards backed by Firestore queries)?** Spec proposes sync only for 2.1; async metric specs deferred to 2.8 when filtered analytics arrive.
- **Should Onboarding's "Confirm your services" step pre-check every service in `config.services`, or just the `enabledByDefault: true` ones?** Spec proposes "only `enabledByDefault: true`" to match today's tire-onboarding default state exactly.

---

**Reviewer:** please respond with approval or change requests in this thread. Once approved, the next step is `superpowers:writing-plans` to produce the milestone-by-milestone implementation plan.
