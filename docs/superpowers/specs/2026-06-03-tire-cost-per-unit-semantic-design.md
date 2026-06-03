# Tire Cost Per-Unit Semantic + Per-Tire Profit Floor — Design

**Date:** 2026-06-03
**Status:** Approved
**Scope:** Tire vertical pricing math — fix two related defects so multi-tire jobs price and profit correctly:
1. The qty-multiplication asymmetry between live quote and saved breakdown (tire COGS bug).
2. Target profit not scaling with qty, plus two operator-facing Settings dials (`tireRepairTargetProfit`, `tireReplacementTargetProfit`) that are collected during onboarding but never read by the pricing engine.

---

## Problem

### Defect 1 — `tireCost` qty asymmetry

The `Job.tireCost` field is currently interpreted two different ways inside the tire pricing engine:

- `calcFlatQuote` (the live "Suggested price" tile in AddJob and Dashboard Quick Quote) — treats `tireCost` as **per-tire**: `tc = tireCost × qty`. See [src/config/businessTypes/pricing/flat.ts:50](../../../src/config/businessTypes/pricing/flat.ts#L50).
- `computeFlatPrice` (the saved-job breakdown, profit, margin) — treats `tireCost` as **total**, no qty multiply. See [src/config/businessTypes/pricing/flat.ts:82](../../../src/config/businessTypes/pricing/flat.ts#L82).
- `jobCOGS` and `weekSummary` (Dashboard, Payouts, Expenses) — also treat it as total, no qty multiply. [src/lib/utils.ts:147,202](../../../src/lib/utils.ts).
- `saveJob` stores **different values depending on `tireSource`** — Inventory stores total (sum of FIFO `d.cost × d.qty`), Bought-for-this-job stores raw per-unit input, Customer-supplied stores 0. [src/App.tsx:861,944,982](../../../src/App.tsx).

### Concrete failure case

Operator logs a "Tire Replacement" job: `qty = 4`, `tireCost = 80` (entered as per-tire because that's what the live preview rewards), `tireSource = 'Bought for this job'`, `revenue = 600`.

| Stage | Tire cost number | Profit reported |
|---|---|---|
| Live "Suggested price" preview | $320 ✓ | (uses suggested price) |
| Saved job — Dashboard breakdown | $80 ✗ | overstated by $240 |
| Weekly rollup (Payouts) | $80 ✗ | tire COGS undercounted |

Result: profit numbers shown on the saved-job card and on the weekly Payouts summary are **wrong** for any multi-tire Bought-for-this-job (or default-tire-source) record. Inventory-source jobs are correct because `saveJob` stores total — but that itself is inconsistent with how the live preview computed the number.

### Defect 2 — Target profit not scaling with qty, and dead Settings dials

Today `calcFlatQuote` computes `targetProfit = service.minProfit + vehicle.addOnProfit` — a single per-job number that does not multiply by `qty`. A 4-tire replacement targets the same profit as a 1-tire replacement. Operators logging multi-tire jobs end up with thin or zero profit because the suggested price barely covers materials.

Compounding the issue: the Settings panel exposes two fields the operator explicitly tunes during onboarding —
`tireRepairTargetProfit` (default $90) and `tireReplacementTargetProfit` (default $110). They appear in the Profit Targets accordion summary and the onboarding flow at [src/components/Onboarding.tsx:94,97,311-312](../../../src/components/Onboarding.tsx). A grep across `src/`, `tests/`, and `functions/src/` confirms they are **read-only by Settings UI and Onboarding only** — neither value is referenced by `calcFlatQuote`, `computeFlatPrice`, `jobCOGS`, `weekSummary`, or any other pricing path. The operator believes they have set a target profit; the pricing engine ignores them.

User intent (confirmed 2026-06-03): on a 4-tire install or replacement, profit should be at least $200 (i.e. per-tire profit floor ≥ $50). The fix is to **wire the existing dials into `calcFlatQuote` as per-tire profit floors**, scoped to qualifying services.

### Defect 3 — Dashboard `profitOf` helper

[src/config/businessTypes/tire.ts:43-52](../../../src/config/businessTypes/tire.ts#L43-L52) defines a `profitOf` helper that subtracts `Number(job.tireCost || 0)` from revenue with no qty multiplication. Same root cause as Defect 1. Currently this helper is defined but not wired into any active Dashboard card; it would silently misreport once enabled. Fix it now so the wiring path is clean.

### Decision

**Canonical semantic going forward: `Job.tireCost` is the per-tire cost of one tire.** Total tire COGS for a job is always `tireCost × qty`. Approved by user.

**Per-tire profit floor:** target profit for install/replacement-class services scales as `max(service.minProfit + vehicle.addOnProfit, configuredPerTireFloor × qty)`. The existing `tireRepairTargetProfit` and `tireReplacementTargetProfit` settings supply the per-tire floor. Approved by user.

---

## Architecture

Four layers change in lockstep:

1. **Schema** — add `tireCostSemantic?: 'per_unit' | 'total'` to the `Job` type. Acts as a per-document marker so saved-job readers can distinguish new (per-unit) writes from legacy (total) writes without a backfill migration.
2. **Pricing engine — COGS side** — `computeFlatPrice`, `jobCOGS`, `weekSummary`, and `tire.ts::profitOf` consult the marker. Absent → legacy behavior (no qty multiply). Present and `'per_unit'` → multiply `tireCost × qty`. `calcFlatQuote` (live preview) does not change on the COGS side — it already multiplies by qty.
3. **Pricing engine — profit floor side** — `calcFlatQuote` reads `settings.tireRepairTargetProfit` and `settings.tireReplacementTargetProfit`. For qualifying services (defined below) the target profit becomes `max(service.minProfit + vehicle.addOnProfit, perTireFloor × qty)` where `perTireFloor` is the matching setting. For non-qualifying services the behavior is unchanged. The mapping lives in a small pure helper `perTireProfitFloor(serviceName, settings)` co-located with the qty-multiplier helper in utils.
4. **saveJob** — Inventory branch divides the FIFO `planTotal` by `qty` to store the per-tire weighted average. All three tire-source branches (Inventory, Bought-for-this-job, Customer-supplied) stamp `tireCostSemantic: 'per_unit'` when they fire. Edits that do not pass through a tire-source branch leave both `tireCost` and the marker untouched, preserving legacy semantics for unrelated edits to legacy jobs.

### Qualifying-service mapping for the profit floor

| Service id (from `tire.ts` config) | Per-tire floor setting | Default ($) |
|---|---|---|
| `Flat Tire Repair` | `tireRepairTargetProfit` | 90 |
| `Tire Replacement` | `tireReplacementTargetProfit` | 110 |
| `Tire Installation` | `tireReplacementTargetProfit` | 110 |
| `Spare Tire Installation` | `tireReplacementTargetProfit` | 110 |
| all other services | (none — no per-tire floor applied) | — |

Rationale: the existing two Settings dials already separate "fix one flat" from "install new tires." `Tire Installation` and `Spare Tire Installation` are functionally tire-installs and share the replacement target so operators don't have to set three identical numbers. Mount & Balance, Rotation, Roadside, Jump Start, etc. are excluded — they are labor-driven or single-touch services where per-tire scaling doesn't reflect economics.

A service that isn't in the table prices exactly as it does today.

### Why a per-document marker over a backfill

A backfill needs to identify which legacy jobs stored `tireCost` as total (Inventory-source jobs) vs which already stored it per-unit (Bought-for-this-job and Customer-supplied). The `tireSource` field is the signal but it is operator-entered and may have changed or been blank in old records. A marker is invisible to the operator, requires no batch job, and self-heals on the next meaningful save. Legacy jobs unchanged unless edited.

### Breakdown display semantic

`computeFlatPrice` returns `breakdown.tireCost` as the **total** (per-tire × qty when the marker is `'per_unit'`). The AddJob and JobDetailModal breakdown rows ("Tire cost −$320") continue to render a total figure — what the operator actually spent on tires for the job. Storage is per-unit; display is total. The existing `breakdown.quantity` field is available for any future UI that wants to split it explicitly.

---

## Files Modified

1. `src/types/index.ts` — add `tireCostSemantic?: 'per_unit' | 'total'` to the `Job` interface. Optional (legacy jobs lack it).
2. `src/config/businessTypes/pricing/flat.ts` —
   - `computeFlatPrice` reads the marker via `tireCostMul`, computes `qtyMul`, uses `tireCost × qtyMul` in `directCost`, and returns the multiplied value as `breakdown.tireCost`.
   - `calcFlatQuote` reads `perTireProfitFloor(form.service, settings)` and replaces today's `tp = sd.minProfit + vd.addOnProfit` with `tp = Math.max(sd.minProfit + vd.addOnProfit, perTireFloor × qtyN)` where `qtyN = Math.max(1, Math.floor(Number(form.qty) || 1))`. Non-qualifying services pass `perTireFloor = 0` so the `max()` collapses to today's value — zero regression.
3. `src/lib/utils.ts` — add two small exported helpers:
   - `tireCostMul(j: Job): number` returning `j.tireCostSemantic === 'per_unit' ? Math.max(1, Math.floor(Number(j.qty) || 1)) : 1`.
   - `perTireProfitFloor(service: string, s: Settings): number` returning the matching setting per the qualifying-service table; returns `0` when the service isn't in the table or the setting is missing/zero.
   - `jobCOGS` and `weekSummary` use `tireCostMul`. `computeFlatPrice` and `calcFlatQuote` import these helpers — one source of truth, no drift.
4. `src/config/businessTypes/tire.ts` — `profitOf` helper applies `tireCostMul(job)` when subtracting `job.tireCost` from revenue. Same Defect-1 fix on the dashboard-helper path (currently defined but unwired; fix it so future wiring is safe).
5. `src/App.tsx` (`saveJob`) — Inventory branch stores `r2(planTotal / qtyN)` instead of `r2(planTotal)`. All three tire-source branches set `tireCostSemantic: 'per_unit'` on the written job. Edits that bypass all three branches preserve the existing value of both fields.
6. `src/pages/AddJob.tsx` — input label for the Tire cost field becomes "Tire cost (per tire)" so the semantic is explicit at the point of entry.
7. `tests/pricingFlatPerTire.test.ts` (new) — covers tireCost per-unit semantic (new + legacy), the inventory `planTotal / qty` rule, the mixed-batch `weekSummary` case, and the per-tire profit floor across qualifying / non-qualifying services and a range of qty values.

### Out of scope

- No batch migration of existing jobs.
- No change to the mechanic vertical (`partsCost` remains a total).
- No change to the detailing vertical (no tire fields).
- No change to invoice rendering — the invoice already uses `qty` and `revenue` correctly.
- No UI change beyond the input label.

---

## Data Flow

### New job, multi-tire Tire Replacement, Bought-for-this-job
```
Operator types: service = "Tire Replacement", tireCost = 80, qty = 4,
                tireSource = "Bought for this job"
Settings:      tireReplacementTargetProfit = 110

  ↓
calcFlatQuote
  tc = 80 × 4 = $320                                  (per-unit × qty)
  perTireFloor = 110  (Tire Replacement → replacement setting)
  tp = max(serviceMinProfit + addOnProfit, 110 × 4)
     = max($110 + $0, $440)
     = $440
  suggested = ceil(($320 + $440) / 5) × 5 = $760
  ↓ Save
saveJob "Bought-for-this-job" branch
  → j.tireCost = 80          (raw per-unit, unchanged from input)
  → j.tireCostSemantic = 'per_unit'  (stamp added)
  ↓
computeFlatPrice on read
  → qtyMul = 4              (semantic is 'per_unit')
  → directCost includes 80 × 4 = $320
  ↓
breakdown.tireCost = $320    (total, as expected by display)
jobGrossProfit = revenue - $320 - other costs
weekSummary.tireCosts sums (j.tireCost × qtyMul) per job
```

### User's stated rule satisfied
```
qty = 4 install/replacement, tireReplacementTargetProfit = 50 (operator lowers it)
  perTireFloor × qty = 50 × 4 = $200
  tp = max(serviceMinProfit + addOnProfit, $200) ≥ $200  ✓ rule satisfied

qty = 4 install/replacement at default tireReplacementTargetProfit = 110
  perTireFloor × qty = 110 × 4 = $440
  tp ≥ $440  (exceeds the user's $200 minimum)

qty = 1 install/replacement at default 110
  perTireFloor × qty = 110 × 1 = $110
  tp = max(serviceMinProfit + addOnProfit, $110)         (same as today for qty=1)
```

### New job, multi-tire, Inventory source
```
Operator picks Inventory + size, qty = 4
  → planInventoryDeduction returns plan with cost mix (e.g. 2×$75 + 2×$85)
  → planTotal = $320
  ↓
saveJob Inventory branch
  → computedTireCost = r2(320 / 4) = $80   (per-tire weighted avg)
  → j.tireCostSemantic = 'per_unit'
  ↓
Read path identical to above — produces $320 total downstream.
```

### Legacy job (saved before this fix)
```
Existing job: tireCost = 320, qty = 4, no tireCostSemantic marker
  ↓
computeFlatPrice
  → qtyMul = 1               (legacy semantic — marker absent)
  → directCost includes 320 × 1 = $320  (matches what it always was)
  ↓
breakdown.tireCost = $320
```
Numbers stay byte-identical for legacy jobs until the operator edits them through a tire-source branch.

### Legacy job edited, operator changes notes only
```
saveJob runs but no tireSource branch fires (no inventory, no purchase-price update)
  → computedTireCost = Number(j.tireCost || 0)    (unchanged)
  → j.tireCostSemantic preserved as undefined
  ↓
Job continues to read with legacy semantic. No silent corruption.
```

### Legacy job edited, operator changes tire source from Customer-supplied to Bought-for-this-job
```
saveJob "Bought-for-this-job" branch fires
  → computedTireCost = j.tirePurchasePrice ?? j.tireCost ?? 0   (raw per-unit)
  → j.tireCostSemantic = 'per_unit'   (now upgraded)
  ↓
Reads use per-unit semantic going forward — correct for the new state.
```

---

## Error Handling

- `qty` missing, 0, negative, NaN, or fractional → readers apply `Math.max(1, Math.floor(Number(qty) || 1))` so a malformed qty floors to 1 and never multiplies up an inflated tire cost.
- `planTotal === 0` in the Inventory branch (shortfall, no plan) → existing branch already skips the assignment; `computedTireCost` keeps its initial value from the function's start. Marker still stamped because the branch entered.
- `tireCostSemantic` set to an unexpected string ('total' from a future write, or anything other than 'per_unit') → reader treats as legacy (no multiply). Safe default.

---

## Testing

New file: `tests/pricingFlatPerTire.test.ts`. Hand-rolled `tsx` runner using the same pattern as existing `tests/*.test.ts` files.

Required cases:

1. `computeFlatPrice` legacy job: `{ tireCost: 320, qty: 4 }` (no marker) → tire portion of `directCost` is $320; `breakdown.tireCost === 320`.
2. `computeFlatPrice` new job: `{ tireCost: 80, qty: 4, tireCostSemantic: 'per_unit' }` → tire portion of `directCost` is $320; `breakdown.tireCost === 320`.
3. `computeFlatPrice` new job with `qty` missing → falls back to qty=1; tire portion equals `tireCost`.
4. `computeFlatPrice` new job with `qty = 0` → floors to 1; no zero-division, no infinite values.
5. `computeFlatPrice` new job with `qty = 2.7` → floors to 2; deterministic.
6. `computeFlatPrice` new job with unexpected `tireCostSemantic: 'whatever'` → treated as legacy; no multiply.
7. `jobCOGS` legacy vs new — both return the same total for equivalent inputs.
8. `weekSummary` mixed batch: one legacy job (`tireCost: 320, qty: 4`) + one new job (`tireCost: 80, qty: 4, semantic: 'per_unit'`) → `tireCosts` rolls up to $640.
9. `weekSummary` includes `partsCost` and `materialCost` correctly alongside the tire math (no regression).
10. Pure unit on the per-tire average rule: given a FIFO `planTotal = 320` and `qty = 4`, the value stored as `computedTireCost` rounds to $80; given `planTotal = 0`, `computedTireCost` is left untouched at the function's initial value.

### Profit-floor cases (calcFlatQuote)

11. `perTireProfitFloor('Tire Replacement', { tireReplacementTargetProfit: 50 })` → 50.
12. `perTireProfitFloor('Tire Installation', { tireReplacementTargetProfit: 110 })` → 110.
13. `perTireProfitFloor('Spare Tire Installation', { tireReplacementTargetProfit: 110 })` → 110.
14. `perTireProfitFloor('Flat Tire Repair', { tireRepairTargetProfit: 90 })` → 90.
15. `perTireProfitFloor('Tire Rotation', settings)` → 0 (non-qualifying — pricing unchanged).
16. `perTireProfitFloor('Tire Replacement', {})` (setting missing) → 0; `calcFlatQuote` falls back to today's `service.minProfit + addOnProfit` exactly.
17. `calcFlatQuote` for `Tire Replacement`, `qty: 4`, `tireReplacementTargetProfit: 50`, service minProfit $110, addOnProfit $0 → `tp = max($110, $200) = $200`; suggested price rounds appropriately.
18. `calcFlatQuote` for `Tire Replacement`, `qty: 4`, `tireReplacementTargetProfit: 110`, service minProfit $110, addOnProfit $0 → `tp = max($110, $440) = $440`.
19. `calcFlatQuote` for `Tire Replacement`, `qty: 1`, `tireReplacementTargetProfit: 110`, service minProfit $110, addOnProfit $0 → `tp = max($110, $110) = $110` (single-tire jobs unchanged when floor equals per-job minProfit).
20. `calcFlatQuote` for `Tire Rotation` (non-qualifying), `qty: 4` → `tp = service.minProfit + addOnProfit` exactly as today; suggested price byte-identical to pre-fix.
21. `calcFlatQuote` for `Tire Replacement`, `qty: 0` → `qtyN` floors to 1; floor calc uses 1, not 0.
22. End-to-end: `Tire Replacement`, `qty: 4`, `tireCost: 80`, `materialCost: 0`, `miles: 0`, default settings ($110 replacement target, $0 vehicle addOn, service basePrice $120, service minProfit $110) → suggested = `ceil(($320 + $440) / 5) × 5 = $760`. Verify the assertion in code matches this exact number.

### End-to-end sanity (manual, after merge)

- New "Tire Replacement" job, qty=4, tireCost entered as 80, source Bought-for-this-job, revenue $600 → AddJob breakdown panel shows Tire cost −$320 and Profit matches `600 − 320 − travel − material`. Dashboard's job card reflects the same profit. Weekly Payouts rolls $320 into tire COGS.
- New Inventory-source job, qty=4 against a stock with mixed costs ($75/$85) → saved doc shows `tireCost: 80`, `tireCostSemantic: 'per_unit'`. Breakdown shows −$320.
- Legacy job edited (notes only) → numbers unchanged; doc still lacks the marker.

---

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Reader forgets to check the marker | Centralize the `qtyMul` computation in a single helper (`tireCostMul(j: Job): number`) co-located with `jobCOGS` in utils.ts. Every reader imports it; no inline reimplementation. |
| Operator edits a legacy job and the qty gets stamped to per-unit semantic without recomputing tireCost | The three saveJob branches always recompute `computedTireCost` when they fire. The marker is only stamped inside those branches, so it can never get out of sync with the stored value. |
| Mixed account drift after partial edits | Acceptable. The system self-heals on the next tire-source-touching save; reads stay correct in the meantime because the marker is per-document. |
| Future write sets `tireCostSemantic: 'total'` explicitly (currently unused) | Reader treats anything not exactly `'per_unit'` as legacy — including `'total'`. Future maintainers wanting an explicit "total" semantic must update the reader branch logic; design leaves the door open without committing to behaviour. |
| Wiring `tireRepairTargetProfit` and `tireReplacementTargetProfit` into the pricing engine for the first time changes the suggested price for tenants who set non-default values, expecting them to take effect | This is the intent. Operators who tuned these dials during onboarding now finally get the prices they expected. Operators on defaults ($90 / $110) see suggested-price differences only on `qty > 1`. Document the change in the spec sign-off and merge commit so support can answer "why did my quotes go up?" with "the dial you set during onboarding finally works." |
| Operator already manually compensated for the dead dial by setting `servicePricing.minProfit` higher (overshooting) — now both the manual override and the wired-up dial stack | `tp = max(servicePricing.minProfit + addOn, perTireFloor × qty)` takes the maximum, not the sum, so stacking is impossible by construction. The previously-manual override stays in effect for `qty = 1`; the floor only adds value when `qty × perTireFloor` exceeds it. |

---

## Sign-off

User approved this design on 2026-06-03 in two passes:
- Pass 1: `tireCost` per-unit semantic and back-compat marker approach.
- Pass 2: Per-tire profit floor wired via the existing `tireRepairTargetProfit` / `tireReplacementTargetProfit` settings (the rule: "4-tire install/replacement profit ≥ $200"). Pass 2 surfaced Defect 3 (`profitOf` helper) as adjacent to Defect 1 and folded it into the same fix.

Implementation plan to be authored next via `writing-plans` skill.
