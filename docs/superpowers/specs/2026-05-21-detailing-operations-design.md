# Phase 2.3 — Detailing Operations Design Spec

**Status:** Approved for implementation planning (2026-05-21)

**Owning phase:** Phase 2.3 — full slice for the detailing vertical. Same scope shape as Phase 2.2 Sub-Project A was for mechanic.

**Predecessor work:**
- Phase 2.1 — multi-vertical runtime config; detailing skeleton (empty services / jobFields / dashboardMetrics) + lifecycle config (no waiting_parts, awaiting_approval label override) + invoice template stub + `package_multiplier` pricing engine stub
- Phase 2.2 — mechanic full slice + multi-user + dispatch UI + CRM hooks (all tagged stable)

**Successor work:**
- Phase 2.4 (potential) — photo capture (before/after upload to Firebase Storage) consuming the existing `features.photoCapture` flag
- Phase 2.x (future) — recurring-membership discount layer; per-package product list with chemical consumption math

---

## 1. Goal

Land the complete detailing operator workflow: pick vehicle size + package + optional add-ons; live price preview via the completed `package_multiplier` engine; generate a detailing-shaped invoice; see detailing-specific dashboard cards. After this phase ships, a detailing operator can run a real business on the app end-to-end. AddBusinessModal exposes Detailing as a selectable business type.

**Out of scope this phase:** photo capture (Phase 2.4); recurring membership discounts; per-package product lists with chemical consumption; per-job dilution-ratio math; AI / ML price suggestions; customer-facing detailing gallery.

## 2. Hard constraints

- Tire / mechanic workflows byte-identical
- Additive migrations only (one new optional Job field)
- Detailing supplies stay **catalog-only** — no per-job consumption, no per-package product lists this phase
- Mobile-first AddJob layout
- Runtime-config-driven (no hardcoded `if (vertical === 'detailing')` in pages)
- `package_multiplier` engine mirrors the shape of the labor_parts engine (consistent dispatcher contract)
- Every commit independently revertible
- No new dependencies, no new collections, no firestore.rules changes

## 3. Architecture

Four pieces, all additive on top of the existing Phase 2.1 skeleton:

1. **Service catalog wired** — `DETAILING_CONFIG.services` populated with 8 packages + 7 add-ons. The `enabledByDefault` + `basePrice` + `minProfit` triple is reused from the existing `BusinessTypeService` shape; no new fields.
2. **`package_multiplier` pricing engine completed** — `computePackageMultiplierPrice` + `calcPackageMultiplierQuote` get real math (base × multiplier + add-ons + travel + minimum floor). Mirrors `labor_parts` engine shape so the dispatcher's switch stays uniform.
3. **AddJob detailing block** — vehicle-size single-select chips + package single-select chips (reusing the existing Service chip-grid renderer) + add-ons multi-select chips (reusing the Conditions multi-select idiom from mechanic).
4. **Detailing invoice template + dashboard metrics** — populate the existing stubs. No new components.

`AddBusinessModal` extends its dropdown to expose Detailing as a selectable business type so new operators can pick it on signup.

## 4. Schema

Single additive Job field:

```ts
export interface Job {
  // ...existing fields...
  /** Detailing-specific: optional add-on service ids selected on
   *  AddJob. Each id resolves to a service in the active vertical's
   *  catalog at invoice render time. Tire / mechanic jobs leave this
   *  undefined. */
  detailingAddons?: ReadonlyArray<string>;
}
```

Existing `Job.vehicleSize?: string` (Phase 2.1 detailing-specific field) is reused.

No changes to InventoryItem, Settings, NotificationDoc, or any other type.

## 5. Service catalog

Populated in `src/config/businessTypes/detailing.ts`. All services share the existing `BusinessTypeService` shape. Distinction between packages and add-ons is conventional only — the AddJob UI segregates them; the data model treats them identically.

### Packages (single-select on AddJob)

| `id` | label | `defaultBasePrice` | `defaultMinProfit` |
|---|---|---:|---:|
| `Express Wash` | Express Wash | 40 | 25 |
| `Full Wash & Wax` | Full Wash & Wax | 90 | 55 |
| `Interior Detail` | Interior Detail | 120 | 70 |
| `Exterior Detail` | Exterior Detail | 130 | 75 |
| `Full Detail` | Full Detail | 220 | 130 |
| `Premium Detail` | Premium Detail | 320 | 180 |
| `Headlight Restoration` | Headlight Restoration | 80 | 50 |
| `Engine Bay Detail` | Engine Bay Detail | 90 | 60 |

### Add-ons (multi-select on AddJob)

| `id` | label | `defaultBasePrice` | `defaultMinProfit` |
|---|---|---:|---:|
| `Pet Hair Removal` | Pet Hair Removal | 30 | 25 |
| `Odor Treatment` | Odor Treatment | 50 | 40 |
| `Headliner Cleaning` | Headliner Cleaning | 40 | 30 |
| `Stain Treatment` | Stain Treatment | 35 | 28 |
| `Ceramic Spray Coating` | Ceramic Spray Coating | 60 | 45 |
| `Tire Shine` | Tire Shine | 15 | 12 |
| `Glass Treatment` | Glass Treatment | 25 | 20 |

All `enabledByDefault: true`. ID strings double as service-name labels and as the service-pricing-map key (same pattern as mechanic).

**Add-on classification.** A new `BusinessTypeService` optional field is added:

```ts
export interface BusinessTypeService {
  // ...existing fields...
  /** When true, this service is rendered in the AddJob add-ons
   *  multi-select rather than the primary single-select Service
   *  chip-grid. Only meaningful for verticals whose pricingModel
   *  applies the vehicleSizeMultiplier to packages but treats
   *  add-ons as flat-priced (detailing). */
  isAddOn?: boolean;
}
```

Detailing's add-on entries set `isAddOn: true`. Tire / mechanic services don't need this field; their `BusinessTypeConfig` ignores it. The runtime-config UI dispatch uses this to pick which chip group to render in.

## 6. AddJob detailing flow

Layout (between Customer block and Travel):

```
┌─────────────────────────────────────────────┐
│ Vehicle size                                  │
│  [Sedan] [SUV] [Truck] [XL SUV] [Van]        │
├─────────────────────────────────────────────┤
│ Package                                       │
│  [Express Wash] [Full Wash & Wax]            │
│  [Interior Detail] [Exterior Detail]          │
│  [Full Detail] [Premium Detail]               │
│  [Headlight Restoration] [Engine Bay Detail]  │
├─────────────────────────────────────────────┤
│ Add-ons (tap any that apply)                  │
│  [☐ Pet Hair Removal] [☐ Odor Treatment]     │
│  [☐ Headliner Cleaning] [☐ Stain Treatment]  │
│  [☐ Ceramic Spray] [☐ Tire Shine]            │
│  [☐ Glass Treatment]                          │
└─────────────────────────────────────────────┘
```

**Vehicle size**: single-select chip group, stored on `Job.vehicleSize`. Options from `DETAILING_CONFIG.pricingModel.vehicleSizeMultipliers` keys. Default selection on new job: "Sedan" (1.0× — keeps the live breakdown sensible until the operator selects).

**Package**: single-select via the existing AddJob "Service" chip-grid renderer. Only services with `isAddOn !== true` render here. Section title overridden to "Package" via `vertical.copy.packageLabel` (optional copy field added).

**Add-ons**: multi-select chip group, stored on `Job.detailingAddons[]`. Independent boolean toggles, matching the Conditions chip pattern from mechanic. Only services with `isAddOn === true` render here.

The mechanic-specific "Conditions" surcharge chips (`emergency` / `lateNight` / `highway` / `weekend`) stay rendered for detailing too — they're universal pricing surcharges, not vertical-specific. (Conditions are already universal in AddJob; no change.)

**Live breakdown panel** (already vertical-aware from Phase 2.1) calls `calcQuoteForModel` → routes to the now-completed `calcPackageMultiplierQuote`. Updates as the tech picks vehicle size, package, and add-ons.

## 7. `package_multiplier` engine

Replace the Phase 2.1 stub in `src/config/businessTypes/pricing/packageMult.ts`:

```ts
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

export function computePackageMultiplierPrice(
  j: Job,
  s: Settings,
  model: PackageMultiplierPricingModel,
): PackageMultBreakdown {
  const revenue = Number(j.revenue || 0);
  const vehicleSize = j.vehicleSize || 'Sedan';
  const multiplier = model.vehicleSizeMultipliers[vehicleSize] ?? 1;

  // Package cost: basePrice × multiplier. Pulled from
  // settings.servicePricing if operator-edited, else vertical
  // config seed.
  const sp = s.servicePricing || {};
  const packageBase = Number(sp[j.service]?.basePrice ?? 0);
  const packageCost = r2(packageBase * multiplier);

  // Add-ons: flat-priced, NO multiplier applied.
  const addOnIds = j.detailingAddons ?? [];
  let addOnsCost = 0;
  for (const id of addOnIds) {
    addOnsCost += Number(sp[id]?.basePrice ?? 0);
  }
  addOnsCost = r2(addOnsCost);

  // Travel (same formula as flat/labor_parts engines).
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

  // Add-ons from form. QuoteForm gains a detailingAddons field
  // (see Schema section below).
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

**QuoteForm widening**: add `detailingAddons?: ReadonlyArray<string>` to the existing `QuoteForm` interface. AddJob populates this when the operator toggles add-on chips; tire / mechanic ignore it.

**`PackageMultiplierPricingModel.defaultMinServiceCharge`**: add optional `defaultMinServiceCharge?: number` to the existing model type — defaults to 40 in detailing.

## 8. Detailing invoice template

Replace the existing stub in `src/config/businessTypes/invoice/detailing.ts`. Mirrors the mechanic template's `buildLineItems` shape but with detailing-appropriate labels.

```
┌──────────────────────────────────────────────────────────────┐
│ DETAIL                                                         │
│   Full Detail            SUV (1.25×)                $275.00    │
│                                                                │
│ ADD-ONS                                                        │
│   Pet Hair Removal                                   $30.00    │
│   Tire Shine                                         $15.00    │
│                                                                │
│ TRAVEL                                                         │
│   Travel                 8 mi @ $0.65/mi              $5.20    │
│                                                                │
│ ─────────────────────────────────────────────────────────────  │
│   Subtotal                                          $325.20    │
│   Tax (8.25%)                                        $26.83    │
│   TOTAL                                             $352.03    │
└──────────────────────────────────────────────────────────────┘
```

Line composition (in order):
- **Package line**: label = service name, detail = `"{vehicleSize} ({multiplier}×)"`, amount = `breakdown.packageCost`. Skipped when `packageCost ≤ 0`.
- **Add-on lines**: one per `id` in `breakdown.addOnIds`. Label = service-pricing label for that id (or the id itself). Amount = the id's `basePrice` from `settings.servicePricing`.
- **Travel line**: existing pattern. Suppressed when chargeable miles ≤ 0.

Footer / warranty policy / Pro features unchanged.

## 9. Dashboard metrics

Populate `DETAILING_CONFIG.dashboardMetrics` with 5 cards. Each `DashboardMetricSpec` is a pure computation over the loaded job list + settings — no new listeners.

| `id` | label | format | compute summary |
|---|---|---|---|
| `details_this_week` | Details this week | number | `jobs.filter(isThisWeek).length` |
| `revenue_week` | Revenue (week) | currency | `Σ Number(j.revenue) for j in jobs.filter(isThisWeek)` |
| `avg_ticket` | Avg ticket | currency | mean revenue across week's completed jobs (returns 0 when none) |
| `repeat_customer_pct` | Repeat customers | percent | `(weekJobs where customer.phone appears in ≥1 earlier completed job) / weekJobs` |
| `addons_pct` | Add-on attach rate | percent | `(weekJobs with detailingAddons.length > 0) / weekJobs` |

Helper for week-boundary check (same as mechanic): inline `isThisWeek` using America/New_York Sunday-start week per existing convention.

## 10. AddBusinessModal exposure

Currently `AddBusinessModal` only offers tire + mechanic (the `BusinessTypeKey` union has 'detailing' but the modal's dropdown doesn't list it). Phase 2.3 wires detailing into the dropdown so new operators can pick it on signup.

Implementation: the modal already iterates `BUSINESS_TYPE_REGISTRY`; add a one-line entry for detailing alongside tire + mechanic. No new components.

The Onboarding flow already handles vertical-driven service pricing seed via `servicePricingFromVertical()` (Phase 2.1) — picking detailing seeds the new packages + add-ons as `enabledByDefault: true`.

## 11. Lifecycle integration

Already complete from Phase 2.1 epilogue:
- `applicableStages` omits `waiting_parts` ✓ (detailing has no parts)
- `awaiting_approval` stage label overridden to "Awaiting customer walk-around" ✓

No additional lifecycle work.

## 12. Notification integration

Universal stage notifications (Phase 2.2 Sub-Project D) work for detailing out of the box. Detailers will get the same:
- Owner in-app: tech_assigned / job_done / payment_received
- Customer SMS pendingActions: tech_on_the_way / tech_arrived / thank_you_review_request
- Customer email pendingAction: invoice_sent

No vertical-specific notification work this phase. Phase 2.x can add detailing-specific templates (e.g. "Detail complete — check out your before/after at {url}") if the photo phase ships first.

## 13. Backward compatibility

- **Tire and mechanic accounts:** zero behavior change. None of their config or workflows are touched. The `BusinessTypeService.isAddOn?` field is optional; existing service entries don't declare it; the AddJob renderer treats undefined as `false` (i.e. renders in the primary chip-grid, as today).
- **Existing detailing accounts** (if any created via direct businessType edit): previously rendered an empty service picker. Now they see the populated catalog + working pricing + working invoice. Settings still controls operator-edited prices.
- **Existing jobs without `detailingAddons`:** invoice fallback renders only the package line + travel. No add-on lines. No crash.
- **No firestore.rules changes.**
- **Every commit independently revertible.**

## 14. UI changes summary

| File | Change |
|---|---|
| `src/types/index.ts` | Add `Job.detailingAddons?`; widen `QuoteForm` with `detailingAddons?`; widen `BusinessTypeService` with `isAddOn?`; widen `PackageMultiplierPricingModel` with `defaultMinServiceCharge?` |
| `src/lib/deserializers.ts` | Deserialize `detailingAddons` |
| `src/config/businessTypes/detailing.ts` | Populate services (8 packages + 7 add-ons); jobFields if needed; dashboardMetrics (5 cards); add `defaultMinServiceCharge: 40` to pricingModel |
| `src/config/businessTypes/pricing/packageMult.ts` | Replace stub with full engine (computePackageMultiplierPrice + calcPackageMultiplierQuote) |
| `src/config/businessTypes/invoice/detailing.ts` | Replace stub buildLineItems with full implementation |
| `src/pages/AddJob.tsx` | Vehicle-size chip block (already exists per Phase 2.1 if `features.vehicleSizeMultiplier`); add detailing-add-ons multi-select chip block |
| `src/components/AddBusinessModal.tsx` | Add Detailing to the dropdown |

Plus 4 test files.

## 15. Testing

Pure-helper test files:

| File | Coverage |
|---|---|
| `tests/calcPackageMultiplierQuote.test.ts` | Engine math: base × multiplier, add-ons flat, travel, minimum-floor, missing vehicleSize defaults to Sedan / 1.0×, missing addOn IDs ignored gracefully |
| `tests/computePackageMultiplierPrice.test.ts` | Direct-cost computation; addOnsCost sum; multi-vehicle-size sanity (Sedan vs XL SUV); package missing from servicePricing → packageCost 0 |
| `tests/detailingInvoiceLineItems.test.ts` | Package line emitted with `(SUV 1.25×)` annotation; one line per add-on; travel line gated on chargeable miles; empty `detailingAddons` → no add-on lines; missing package → no package line |
| `tests/detailingDashboardMetrics.test.ts` | All 5 metrics compute correctly; repeat-customer detection by phone; addons attach-rate edge cases (zero jobs, all with add-ons, none with add-ons); avg_ticket 0 when no completed jobs |

~60 assertions total. `npx tsx`-runnable.

## 16. Pre-tag production smoke checklist

**Owner regression (tire + mechanic):**
- [ ] Tire account: Dashboard / AddJob / Inventory / Settings / Invoice / StagePicker / NotificationsBell — all unchanged
- [ ] Mechanic account: same

**AddBusinessModal:**
- [ ] Detailing now appears in the dropdown alongside Tire and Mechanic
- [ ] Selecting Detailing → creates a business with the populated service catalog seeded

**Detailing flow:**
- [ ] Vehicle size chips render (Sedan / SUV / Truck / XL SUV / Van)
- [ ] Package chips render (8 packages)
- [ ] Add-ons multi-select chips render (7 add-ons)
- [ ] Pick "Full Detail" + "SUV" → live breakdown shows package × 1.25
- [ ] Tap 2 add-ons → breakdown adds their flat prices, no multiplier applied
- [ ] Save job → appears on History page
- [ ] Generate invoice → shows package line with `(SUV 1.25×)`, add-on lines, travel, total
- [ ] Dashboard renders all 5 detailing metrics
- [ ] Multiple jobs same customer → repeat_customer_pct reflects correctly
- [ ] Stage picker on JobDetailModal renders (lifecycle config from Phase 2.1 already there)
- [ ] Customer SMS/email notifications surface on relevant transitions

**Cross-cutting:**
- [ ] No console errors
- [ ] Bundle delta ≤ +6 kB gzipped

## 17. Rollback path

Each implementation commit is revertible independently:

1. Schema widening — purely additive, no consumers if reverted
2. Engine implementation — replaces a stub that's never actually called (no detailing accounts active yet)
3. Detailing config catalog — additive
4. Invoice template — replaces a stub
5. Dashboard metrics — additive
6. AddJob add-ons block — additive UI; reverts cleanly
7. AddBusinessModal exposure — additive dropdown entry

The riskiest revert path is the engine (Task 2 below), because once detailing accounts have saved jobs with picked packages + add-ons, the invoice depends on the engine returning the right breakdown. Reverting to the stub would break invoice math for detailing jobs but leave the underlying data intact — operator can edit + regenerate after rolling forward again.

## 18. Performance posture

- Engine math is O(addOnIds.length) — sub-millisecond.
- Dashboard metrics are O(jobs.length) — sub-millisecond at any realistic scale.
- No new listeners, no new collections.

## 19. Open items for the implementation plan

The `writing-plans` skill must capture:

1. **AddJob detailing-block insertion site** — between Customer and Travel; reuse existing Service chip-grid wrapper but filter `vertical.services` by `isAddOn !== true` for the main grid and `isAddOn === true` for the add-ons multi-select.
2. **`isAddOn` field landing order** — type widening (Task 1) → catalog entries declared with `isAddOn: true` (Task 3) → AddJob renderer gates on it (Task 6). All additive; tire/mechanic services never set it.
3. **Default vehicleSize on new detailing jobs** — seed `'Sedan'` in `EMPTY_JOB()` only when `vertical.key === 'detailing'`, or just leave undefined and have the engine default. Plan picks: leave undefined; engine defaults to Sedan/1.0×; AddJob highlights nothing until operator picks.
4. **`packageLabel` vertical copy field** — optional `BusinessTypeCopy.packageLabel?: string` so detailing renders "Package" while tire/mechanic keep "Service". Default to "Service" when undefined.
5. **AddBusinessModal entry** — adds one option referencing `DETAILING_CONFIG.displayName`; no other modal changes.
6. **No firestore.rules changes.**
