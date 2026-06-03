# Tire Cost Per-Unit Semantic — Design

**Date:** 2026-06-03
**Status:** Approved
**Scope:** Tire vertical pricing math — fix the qty-multiplication asymmetry between live quote and saved breakdown so multi-tire jobs report correct profit, COGS, and weekly rollups.

---

## Problem

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

### Decision

**Canonical semantic going forward: `Job.tireCost` is the per-tire cost of one tire.** Total tire COGS for a job is always `tireCost × qty`. Approved by user.

---

## Architecture

Three layers change in lockstep:

1. **Schema** — add `tireCostSemantic?: 'per_unit' | 'total'` to the `Job` type. Acts as a per-document marker so saved-job readers can distinguish new (per-unit) writes from legacy (total) writes without a backfill migration.
2. **Pricing engine** — `computeFlatPrice`, `jobCOGS`, `weekSummary` consult the marker. Absent → legacy behavior (no qty multiply). Present and `'per_unit'` → multiply `tireCost × qty`. `calcFlatQuote` (live preview) does not change — it already multiplies by qty.
3. **saveJob** — Inventory branch divides the FIFO `planTotal` by `qty` to store the per-tire weighted average. All three tire-source branches (Inventory, Bought-for-this-job, Customer-supplied) stamp `tireCostSemantic: 'per_unit'` when they fire. Edits that do not pass through a tire-source branch leave both `tireCost` and the marker untouched, preserving legacy semantics for unrelated edits to legacy jobs.

### Why a per-document marker over a backfill

A backfill needs to identify which legacy jobs stored `tireCost` as total (Inventory-source jobs) vs which already stored it per-unit (Bought-for-this-job and Customer-supplied). The `tireSource` field is the signal but it is operator-entered and may have changed or been blank in old records. A marker is invisible to the operator, requires no batch job, and self-heals on the next meaningful save. Legacy jobs unchanged unless edited.

### Breakdown display semantic

`computeFlatPrice` returns `breakdown.tireCost` as the **total** (per-tire × qty when the marker is `'per_unit'`). The AddJob and JobDetailModal breakdown rows ("Tire cost −$320") continue to render a total figure — what the operator actually spent on tires for the job. Storage is per-unit; display is total. The existing `breakdown.quantity` field is available for any future UI that wants to split it explicitly.

---

## Files Modified

1. `src/types/index.ts` — add `tireCostSemantic?: 'per_unit' | 'total'` to the `Job` interface. Optional (legacy jobs lack it).
2. `src/config/businessTypes/pricing/flat.ts` — `computeFlatPrice` reads the marker, computes `qtyMul = (j.tireCostSemantic === 'per_unit') ? max(1, floor(qty)) : 1`, and uses `tireCost × qtyMul` in `directCost`. Returns the same multiplied value as `breakdown.tireCost`. `calcFlatQuote` unchanged.
3. `src/lib/utils.ts` — add a small exported helper `tireCostMul(j: Job): number` that returns `j.tireCostSemantic === 'per_unit' ? Math.max(1, Math.floor(Number(j.qty) || 1)) : 1`. `jobCOGS` and `weekSummary` use this helper rather than inlining the branch. `computeFlatPrice` in `flat.ts` also imports and uses this helper — one source of truth, no drift.
4. `src/App.tsx` (`saveJob`) — Inventory branch stores `r2(planTotal / qtyN)` instead of `r2(planTotal)`. All three tire-source branches set `tireCostSemantic: 'per_unit'` on the written job. Edits that bypass all three branches preserve the existing value of both fields.
5. `src/pages/AddJob.tsx` — input label for the Tire cost field becomes "Tire cost (per tire)" so the semantic is explicit at the point of entry.
6. `tests/pricingFlatPerTire.test.ts` (new) — covers the new semantic, the legacy semantic, the inventory `planTotal / qty` rule, and a mixed legacy/new `weekSummary` batch.

### Out of scope

- No batch migration of existing jobs.
- No change to the mechanic vertical (`partsCost` remains a total).
- No change to the detailing vertical (no tire fields).
- No change to invoice rendering — the invoice already uses `qty` and `revenue` correctly.
- No UI change beyond the input label.

---

## Data Flow

### New job, multi-tire, Bought-for-this-job
```
Operator types: tireCost = 80, qty = 4, tireSource = "Bought for this job"
  ↓
calcFlatQuote                → tc = 80 × 4 = $320      (live preview, correct)
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

---

## Sign-off

User approved this design on 2026-06-03. Implementation plan to be authored next via `writing-plans` skill.
