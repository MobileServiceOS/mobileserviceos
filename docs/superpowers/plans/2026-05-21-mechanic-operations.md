# Mechanic Operations Implementation Plan (Phase 2.2 / Sub-Project A)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the full mechanic-vertical workflow — structured parts on jobs, atomic inventory deduction, mechanic-aware invoice rendering — described in [docs/superpowers/specs/2026-05-21-mechanic-operations-design.md](../specs/2026-05-21-mechanic-operations-design.md).

**Architecture:** Strictly additive widening on top of Phase 2.1's runtime-config registry. New optional fields on `InventoryItem` / `Job` / `Settings`; new pure helpers in `src/lib/mechanicJob.ts`; mechanic-only branch in the existing `saveJob` callback in `App.tsx`; new dispatcher-rendered `MechanicInventoryView` + `PartsSection` components. Tire workflows are byte-identical throughout.

**Tech Stack:** TypeScript strict mode, React 18, Firestore (`writeBatch` for atomic mechanic save). No new dependencies. Tests via `npx tsx` + the existing `check(label, condition)` runner.

**Commit cadence:** one focused commit per task, never squash. Each task ends with `npm run build` + (where applicable) `npx tsx tests/<file>.test.ts`. Push only after Task 16's smoke validation passes.

---

## File Structure

**Files to create:**

| File | Responsibility |
|---|---|
| `src/lib/mechanicJob.ts` | Pure helpers: derive, diff, rollback, warn, build line items |
| `src/components/inventory/MechanicInventoryView.tsx` | Mechanic inventory list + filter + add/edit sheet |
| `src/components/addJob/PartsSection.tsx` | Mechanic parts entry block on AddJob |
| `tests/mechanicJobDerivation.test.ts` | `deriveLegacyPartsCost`, `derivePartsMarginSnapshot` |
| `tests/mechanicDeductionDiff.test.ts` | `diffPartsForDeduction`, `buildPartsInventoryDeductions` |
| `tests/mechanicDeductionRollback.test.ts` | `rollbackPartsDeductions` |
| `tests/softStockWarning.test.ts` | `shouldWarnOnDeduction` |
| `tests/mechanicInvoiceLineItems.test.ts` | `buildMechanicLineItems` |

**Files to modify:**

| File | Change |
|---|---|
| `src/types/index.ts` | Widen `InventoryItem`, add `JobPartLine`, widen `Job`, widen `Settings` |
| `src/lib/defaults.ts` | DEFAULT_SETTINGS additions: `laborRate`, `lowStockThreshold`, `warrantyPolicy`, `partsMarkupDefault` |
| `src/lib/deserializers.ts` | Deserialize new optional fields on Job + Settings |
| `src/config/businessTypes/mechanic.ts` | Widen `inventoryFields` with all new fields + option lists |
| `src/config/businessTypes/invoice/mechanic.ts` | Replace `buildLineItems` body with `buildMechanicLineItems` consumer |
| `src/pages/Inventory.tsx` | Dispatcher branches to `MechanicInventoryView` for mechanic vertical |
| `src/pages/AddJob.tsx` | Render `PartsSection` for mechanic vertical |
| `src/App.tsx` | Mechanic branch in `saveJob` + `deleteJob` |
| `src/components/settings/PricingSection.tsx` (or BusinessSection) | Add `laborRate`, `partsMarkupDefault`, `warrantyPolicy`, `lowStockThreshold` editors |

---

## Task 1: Widen `InventoryItem` with mechanic-specific fields

**Files:**
- Modify: `src/types/index.ts` (the `InventoryItem` interface)
- Modify: `src/lib/deserializers.ts` (deserializer for the new optional fields)

- [ ] **Step 1: Locate and widen the `InventoryItem` interface**

Open `src/types/index.ts`. Find the `InventoryItem` interface (currently has `partNumber`, `partName`, `supplier`, `unitCost` from Phase 2.1). Add the new mechanic-specific optional fields right after `unitCost`:

```ts
  // ─── Mechanic-specific optional fields (Phase 2.1 + 2.2) ─────────
  partNumber?: string;
  partName?: string;
  supplier?: string;
  unitCost?: number;

  // Phase 2.2 mechanic widening:
  retailPrice?: number;
  category?: string;
  subcategory?: string;
  laborHoursDefault?: number;
  compatibleVehicles?: ReadonlyArray<string>;
  warrantyDays?: number;
  locationBin?: string;
```

(The existing `category?: string` is already declared on the detailing block — when widening, REMOVE the detailing-only `category` declaration so we don't have two and TS errors. `category` is now shared between mechanic + detailing.)

- [ ] **Step 2: Update `deserializeInventoryItem`**

In `src/lib/deserializers.ts`, the function currently reads only `id, size, qty, cost, notes, condition, brand, model`. Extend it to read the mechanic fields too:

```ts
export function deserializeInventoryItem(raw: RawDoc): InventoryItem {
  return {
    id: asString(raw.id),
    size: asString(raw.size),
    qty: asNumber(raw.qty),
    cost: asNumber(raw.cost),
    notes: asString(raw.notes, ''),
    condition: asString(raw.condition, 'New'),
    brand: asString(raw.brand, ''),
    model: asString(raw.model, ''),

    // Mechanic-specific (all optional; undefined when absent)
    partNumber: raw.partNumber == null ? undefined : asString(raw.partNumber),
    partName: raw.partName == null ? undefined : asString(raw.partName),
    supplier: raw.supplier == null ? undefined : asString(raw.supplier),
    unitCost: raw.unitCost == null ? undefined : asNumber(raw.unitCost),
    retailPrice: raw.retailPrice == null ? undefined : asNumber(raw.retailPrice),
    category: raw.category == null ? undefined : asString(raw.category),
    subcategory: raw.subcategory == null ? undefined : asString(raw.subcategory),
    laborHoursDefault: raw.laborHoursDefault == null ? undefined : asNumber(raw.laborHoursDefault),
    compatibleVehicles: Array.isArray(raw.compatibleVehicles)
      ? (raw.compatibleVehicles as string[]).map((v) => asString(v))
      : undefined,
    warrantyDays: raw.warrantyDays == null ? undefined : asNumber(raw.warrantyDays),
    locationBin: raw.locationBin == null ? undefined : asString(raw.locationBin),
  };
}
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: TypeScript clean, Vite emit succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/types/index.ts src/lib/deserializers.ts
git commit -m "feat(types): widen InventoryItem with mechanic Phase 2.2 fields"
```

---

## Task 2: Add `JobPartLine` + widen `Job`

**Files:**
- Modify: `src/types/index.ts`

- [ ] **Step 1: Add the `JobPartLine` interface**

In `src/types/index.ts`, add immediately above the `Job` interface:

```ts
export interface JobPartLine {
  name: string;
  qty: number;
  unitPrice: number;
  unitCost: number;
  source: 'inventory' | 'bought_for_job' | 'special_order';
  inventoryItemId?: string;
  supplier?: string;
  warrantyDays?: number;
}

export interface PartsMarginSnapshot {
  revenue: number;
  costBasis: number;
  margin: number;
}
```

- [ ] **Step 2: Widen the `Job` interface**

Append at the bottom of the `Job` interface (after the lifecycle fields landed in the earlier foundation work):

```ts
  // ─── Mechanic parts (Phase 2.2 Sub-Project A) ────────────────────
  /** Structured parts on this job. Sum of (qty × unitPrice) mirrors
   *  to `partsCost` on save for legacy reader compat. */
  parts?: ReadonlyArray<JobPartLine>;
  /** Inventory deductions made by this mechanic-job save. Same shape
   *  as the existing tire `inventoryDeductions`; populated only by
   *  the mechanic save branch. */
  partsInventoryDeductions?: InventoryDeduction[] | null;
  /** Per-job margin snapshot. Populated only when every part line
   *  has unitCost > 0 (a single zero invalidates the whole snapshot). */
  partsMarginSnapshot?: PartsMarginSnapshot;
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/types/index.ts
git commit -m "feat(types): add JobPartLine + widen Job with parts/partsInventoryDeductions/partsMarginSnapshot"
```

---

## Task 3: Widen `Settings` with mechanic-related fields + defaults

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/lib/defaults.ts`

- [ ] **Step 1: Widen the `Settings` interface**

In `src/types/index.ts`, append at the bottom of the `Settings` interface (before the closing `}`):

```ts
  // ─── Mechanic-related (Phase 2.2 Sub-Project A) ──────────────────
  /** Hourly labor rate. Mechanic uses this; falls back to
   *  mechanic.pricingModel.defaultLaborRate when undefined. */
  laborRate?: number;
  /** Threshold below which inventory rows show ⚠ LOW badge. */
  lowStockThreshold?: number;
  /** Multiplier applied to unitCost when auto-suggesting retailPrice
   *  in the inventory add/edit sheet. Default 1.5. */
  partsMarkupDefault?: number;
  /** Free-text warranty policy printed at the bottom of mechanic
   *  invoices when set. */
  warrantyPolicy?: string;
```

- [ ] **Step 2: Add defaults**

In `src/lib/defaults.ts`, update `DEFAULT_SETTINGS` — add the four new fields with sensible defaults inside the literal:

```ts
export const DEFAULT_SETTINGS: Settings = {
  // ... existing fields ...
  freeMilesIncluded: 5,
  tireRepairTargetProfit: 90,
  tireReplacementTargetProfit: 110,

  // Phase 2.2 mechanic settings:
  laborRate: 95,
  lowStockThreshold: 2,
  partsMarkupDefault: 1.5,
  warrantyPolicy: '',
};
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/types/index.ts src/lib/defaults.ts
git commit -m "feat(types,defaults): Settings widens with laborRate/lowStockThreshold/partsMarkupDefault/warrantyPolicy"
```

---

## Task 4: Pure helpers — `src/lib/mechanicJob.ts` (derivations + diff + rollback + warn)

**Files:**
- Create: `src/lib/mechanicJob.ts`

- [ ] **Step 1: Write the helpers**

Create `src/lib/mechanicJob.ts` with:

```ts
// src/lib/mechanicJob.ts
// ═══════════════════════════════════════════════════════════════════
//  Pure helpers for the mechanic parts + inventory workflow.
//  See docs/superpowers/specs/2026-05-21-mechanic-operations-design.md
//  Every function in this file is pure: no I/O, no globals, no React.
// ═══════════════════════════════════════════════════════════════════

import type { Job, JobPartLine, InventoryItem, InventoryDeduction, PartsMarginSnapshot } from '@/types';
import { r2 } from '@/lib/round';

// ─────────────────────────────────────────────────────────────────
//  Derivation: parts → legacy partsCost mirror
// ─────────────────────────────────────────────────────────────────

export function deriveLegacyPartsCost(parts: ReadonlyArray<JobPartLine>): number {
  return r2(parts.reduce((s, l) => s + Number(l.qty || 0) * Number(l.unitPrice || 0), 0));
}

// ─────────────────────────────────────────────────────────────────
//  Derivation: parts → margin snapshot (only when every line has
//  non-zero unitCost — a single zero invalidates the whole snapshot)
// ─────────────────────────────────────────────────────────────────

export function derivePartsMarginSnapshot(
  parts: ReadonlyArray<JobPartLine>,
): PartsMarginSnapshot | undefined {
  if (parts.length === 0) return undefined;
  for (const l of parts) {
    if (!Number.isFinite(Number(l.unitCost)) || Number(l.unitCost) <= 0) return undefined;
  }
  const revenue = r2(parts.reduce((s, l) => s + Number(l.qty || 0) * Number(l.unitPrice || 0), 0));
  const costBasis = r2(parts.reduce((s, l) => s + Number(l.qty || 0) * Number(l.unitCost || 0), 0));
  return { revenue, costBasis, margin: r2(revenue - costBasis) };
}

// ─────────────────────────────────────────────────────────────────
//  Inventory deduction diff (edit-job semantics)
// ─────────────────────────────────────────────────────────────────

/**
 * Compares the new parts list against the previously-saved parts list.
 * Returns the net delta per inventory item id (negative = additional
 * deduction needed; positive = refund into inventory). Lines not
 * sourced from inventory contribute nothing.
 */
export function diffPartsForDeduction(
  oldParts: ReadonlyArray<JobPartLine> | undefined,
  newParts: ReadonlyArray<JobPartLine>,
): Record<string, number> {
  const delta: Record<string, number> = {};
  const oldByItem: Record<string, number> = {};
  for (const l of oldParts ?? []) {
    if (l.source === 'inventory' && l.inventoryItemId) {
      oldByItem[l.inventoryItemId] = (oldByItem[l.inventoryItemId] || 0) + Number(l.qty || 0);
    }
  }
  const newByItem: Record<string, number> = {};
  for (const l of newParts) {
    if (l.source === 'inventory' && l.inventoryItemId) {
      newByItem[l.inventoryItemId] = (newByItem[l.inventoryItemId] || 0) + Number(l.qty || 0);
    }
  }
  const allIds = new Set([...Object.keys(oldByItem), ...Object.keys(newByItem)]);
  for (const id of allIds) {
    const oldQty = oldByItem[id] || 0;
    const newQty = newByItem[id] || 0;
    const d = newQty - oldQty;
    if (d !== 0) delta[id] = -d; // negative because save deducts (subtracts qty)
  }
  return delta;
}

// ─────────────────────────────────────────────────────────────────
//  partsInventoryDeductions[] builder
// ─────────────────────────────────────────────────────────────────

/** Build the `partsInventoryDeductions[]` snapshot from the current
 *  parts list. Uses the existing tire-shape `InventoryDeduction`
 *  (`{ id, size, qty, cost }`) — mechanic sets `size = ''` and `cost
 *  = unitCost`. */
export function buildPartsInventoryDeductions(
  parts: ReadonlyArray<JobPartLine>,
): InventoryDeduction[] {
  const out: InventoryDeduction[] = [];
  for (const l of parts) {
    if (l.source === 'inventory' && l.inventoryItemId) {
      out.push({
        id: l.inventoryItemId,
        size: '',
        qty: Number(l.qty || 0),
        cost: Number(l.unitCost || 0),
      });
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────
//  Rollback (delete / cancel a mechanic job)
// ─────────────────────────────────────────────────────────────────

/** For a deleted/cancelled job, returns the per-item refund map
 *  (positive numbers = qty to add back to inventory). */
export function rollbackPartsDeductions(
  job: Pick<Job, 'partsInventoryDeductions'>,
): Record<string, number> {
  const refund: Record<string, number> = {};
  for (const d of job.partsInventoryDeductions ?? []) {
    if (!d || !d.id) continue;
    refund[d.id] = (refund[d.id] || 0) + Number(d.qty || 0);
  }
  return refund;
}

// ─────────────────────────────────────────────────────────────────
//  Soft warning at save-time
// ─────────────────────────────────────────────────────────────────

/** Returns true when the line's inventory deduction would push the
 *  on-hand qty negative. The save flow surfaces a confirmation
 *  dialog only when this is true. Non-inventory sources never warn. */
export function shouldWarnOnDeduction(
  line: JobPartLine,
  inventory: ReadonlyArray<InventoryItem>,
  oldLineQty: number = 0,
): boolean {
  if (line.source !== 'inventory' || !line.inventoryItemId) return false;
  const item = inventory.find((i) => i.id === line.inventoryItemId);
  if (!item) return false;
  const onHand = Number(item.qty || 0);
  const incrementalQty = Number(line.qty || 0) - oldLineQty;
  return incrementalQty > onHand;
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/lib/mechanicJob.ts
git commit -m "feat(mechanic): pure helpers (derive/diff/rollback/warn) for mechanic parts workflow"
```

---

## Task 5: Helper tests — derivation + diff + rollback + warn

**Files:**
- Create: `tests/mechanicJobDerivation.test.ts`
- Create: `tests/mechanicDeductionDiff.test.ts`
- Create: `tests/mechanicDeductionRollback.test.ts`
- Create: `tests/softStockWarning.test.ts`

- [ ] **Step 1: Write `tests/mechanicJobDerivation.test.ts`**

```ts
// tests/mechanicJobDerivation.test.ts
import {
  deriveLegacyPartsCost,
  derivePartsMarginSnapshot,
} from '@/lib/mechanicJob';
import type { JobPartLine } from '@/types';

let passed = 0;
let failed = 0;
const check = (label: string, cond: boolean): void => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}`); }
};
const line = (over: Partial<JobPartLine> = {}): JobPartLine => ({
  name: 'p', qty: 1, unitPrice: 10, unitCost: 5, source: 'inventory', inventoryItemId: 'i1', ...over,
});

console.log('\n┌─ deriveLegacyPartsCost ─────────────────────────────');
check('empty array → 0', deriveLegacyPartsCost([]) === 0);
check('single line: 2 × $45 = $90', deriveLegacyPartsCost([line({ qty: 2, unitPrice: 45 })]) === 90);
check('multi-line sums correctly', deriveLegacyPartsCost([
  line({ qty: 1, unitPrice: 45 }), line({ qty: 2, unitPrice: 12 }), line({ qty: 4, unitPrice: 8 }),
]) === 101);
check('r2 rounding determinism (0.1+0.2)*1=0.3', deriveLegacyPartsCost([line({ qty: 1, unitPrice: 0.1 }), line({ qty: 1, unitPrice: 0.2 })]) === 0.3);

console.log('\n┌─ derivePartsMarginSnapshot ─────────────────────────');
check('empty array → undefined', derivePartsMarginSnapshot([]) === undefined);
{
  const r = derivePartsMarginSnapshot([line({ qty: 2, unitPrice: 45, unitCost: 30 })]);
  check('single line snapshot revenue', r?.revenue === 90);
  check('single line snapshot costBasis', r?.costBasis === 60);
  check('single line snapshot margin', r?.margin === 30);
}
{
  const r = derivePartsMarginSnapshot([line({ unitCost: 0 })]);
  check('zero unitCost invalidates snapshot', r === undefined);
}
{
  const r = derivePartsMarginSnapshot([line({ unitCost: 5 }), line({ unitCost: 0 })]);
  check('any zero-cost line invalidates whole snapshot', r === undefined);
}

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
```

- [ ] **Step 2: Write `tests/mechanicDeductionDiff.test.ts`**

```ts
// tests/mechanicDeductionDiff.test.ts
import { diffPartsForDeduction, buildPartsInventoryDeductions } from '@/lib/mechanicJob';
import type { JobPartLine } from '@/types';

let passed = 0;
let failed = 0;
const check = (label: string, cond: boolean): void => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}`); }
};
const inv = (id: string, qty: number): JobPartLine => ({
  name: id, qty, unitPrice: 10, unitCost: 5, source: 'inventory', inventoryItemId: id,
});
const oneOff = (qty: number): JobPartLine => ({
  name: 'oneoff', qty, unitPrice: 10, unitCost: 0, source: 'bought_for_job',
});

console.log('\n┌─ diffPartsForDeduction ─────────────────────────────');
check('empty old + empty new → no diff', Object.keys(diffPartsForDeduction([], [])).length === 0);
check('new line on i1 qty 2 → delta i1 = -2', diffPartsForDeduction(undefined, [inv('i1', 2)]).i1 === -2);
check('removed line on i1 qty 2 → delta i1 = +2', diffPartsForDeduction([inv('i1', 2)], []).i1 === 2);
check('qty bumped 1 → 3 → delta i1 = -2', diffPartsForDeduction([inv('i1', 1)], [inv('i1', 3)]).i1 === -2);
check('qty reduced 3 → 1 → delta i1 = +2', diffPartsForDeduction([inv('i1', 3)], [inv('i1', 1)]).i1 === 2);
check('identical input → empty diff', Object.keys(diffPartsForDeduction([inv('i1', 2)], [inv('i1', 2)])).length === 0);
check('one-off lines never appear in diff', Object.keys(diffPartsForDeduction([], [oneOff(3)])).length === 0);
{
  const d = diffPartsForDeduction([inv('i1', 2)], [oneOff(2)]);
  check('source change inventory→bought_for_job refunds i1', d.i1 === 2);
  check('source change does not deduct elsewhere', Object.keys(d).length === 1);
}

console.log('\n┌─ buildPartsInventoryDeductions ─────────────────────');
{
  const out = buildPartsInventoryDeductions([inv('i1', 2), oneOff(1), inv('i2', 1)]);
  check('returns 2 entries (only inventory-sourced)', out.length === 2);
  check('entries use existing InventoryDeduction shape', out[0].id === 'i1' && out[0].size === '' && out[0].qty === 2 && out[0].cost === 5);
}

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
```

- [ ] **Step 3: Write `tests/mechanicDeductionRollback.test.ts`**

```ts
// tests/mechanicDeductionRollback.test.ts
import { rollbackPartsDeductions } from '@/lib/mechanicJob';
import type { Job } from '@/types';

let passed = 0;
let failed = 0;
const check = (label: string, cond: boolean): void => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}`); }
};

console.log('\n┌─ rollbackPartsDeductions ───────────────────────────');
{
  const r = rollbackPartsDeductions({ partsInventoryDeductions: null } as Job);
  check('null deductions → empty refund', Object.keys(r).length === 0);
}
{
  const r = rollbackPartsDeductions({ partsInventoryDeductions: undefined } as Job);
  check('undefined deductions → empty refund', Object.keys(r).length === 0);
}
{
  const r = rollbackPartsDeductions({
    partsInventoryDeductions: [
      { id: 'i1', size: '', qty: 2, cost: 5 },
      { id: 'i2', size: '', qty: 1, cost: 10 },
    ],
  } as Job);
  check('two distinct items → both refunded', Object.keys(r).length === 2);
  check('item i1 refund 2', r.i1 === 2);
  check('item i2 refund 1', r.i2 === 1);
}
{
  const r = rollbackPartsDeductions({
    partsInventoryDeductions: [
      { id: 'i1', size: '', qty: 2, cost: 5 },
      { id: 'i1', size: '', qty: 3, cost: 5 },
    ],
  } as Job);
  check('duplicate ids aggregated', r.i1 === 5);
}

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
```

- [ ] **Step 4: Write `tests/softStockWarning.test.ts`**

```ts
// tests/softStockWarning.test.ts
import { shouldWarnOnDeduction } from '@/lib/mechanicJob';
import type { JobPartLine, InventoryItem } from '@/types';

let passed = 0;
let failed = 0;
const check = (label: string, cond: boolean): void => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}`); }
};
const inv = (id: string, qty: number): InventoryItem => ({
  id, size: '', qty, cost: 5, partName: id,
} as InventoryItem);
const line = (over: Partial<JobPartLine>): JobPartLine => ({
  name: 'p', qty: 1, unitPrice: 10, unitCost: 5, source: 'inventory', inventoryItemId: 'i1', ...over,
});

console.log('\n┌─ shouldWarnOnDeduction ─────────────────────────────');
check('qty 2 > onHand 1 → warn', shouldWarnOnDeduction(line({ qty: 2 }), [inv('i1', 1)]) === true);
check('qty 1 === onHand 1 → no warn', shouldWarnOnDeduction(line({ qty: 1 }), [inv('i1', 1)]) === false);
check('qty 1 < onHand 5 → no warn', shouldWarnOnDeduction(line({ qty: 1 }), [inv('i1', 5)]) === false);
check('non-inventory source never warns', shouldWarnOnDeduction(line({ source: 'bought_for_job' }), [inv('i1', 0)]) === false);
check('item not found → no warn', shouldWarnOnDeduction(line({ inventoryItemId: 'missing' }), [inv('i1', 5)]) === false);
check('edit: qty 3, oldLineQty 2 (delta 1), onHand 1 → no warn', shouldWarnOnDeduction(line({ qty: 3 }), [inv('i1', 1)], 2) === false);
check('edit: qty 5, oldLineQty 2 (delta 3), onHand 1 → warn', shouldWarnOnDeduction(line({ qty: 5 }), [inv('i1', 1)], 2) === true);

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
```

- [ ] **Step 5: Run all four tests**

```bash
npx tsx tests/mechanicJobDerivation.test.ts
npx tsx tests/mechanicDeductionDiff.test.ts
npx tsx tests/mechanicDeductionRollback.test.ts
npx tsx tests/softStockWarning.test.ts
```

Expected: each prints `N passed, 0 failed`.

- [ ] **Step 6: Commit**

```bash
git add tests/mechanicJobDerivation.test.ts tests/mechanicDeductionDiff.test.ts tests/mechanicDeductionRollback.test.ts tests/softStockWarning.test.ts
git commit -m "test(mechanic): coverage for derivation, diff, rollback, soft-stock warn"
```

---

## Task 6: Mechanic invoice line-item builder + test

**Files:**
- Modify: `src/lib/mechanicJob.ts` (add `buildMechanicLineItems`)
- Create: `tests/mechanicInvoiceLineItems.test.ts`

- [ ] **Step 1: Add `buildMechanicLineItems` + supporting types**

Append to `src/lib/mechanicJob.ts`:

```ts
import type { Settings } from '@/types';

export interface MechanicLineItem {
  label: string;
  detail?: string;
  amount: number;
  group: 'labor' | 'parts' | 'fees' | 'travel';
}

export function buildMechanicLineItems(
  job: Pick<Job, 'laborHours' | 'parts' | 'partsCost' | 'diagnosticFee' | 'miles'>,
  settings: Pick<Settings, 'laborRate' | 'freeMilesIncluded' | 'costPerMile'>,
): MechanicLineItem[] {
  const out: MechanicLineItem[] = [];

  // Labor
  const hrs = Number(job.laborHours || 0);
  if (hrs > 0) {
    const rate = Number(settings.laborRate || 95);
    out.push({
      label: 'Labor',
      detail: `${hrs} hrs × $${rate}/hr`,
      amount: r2(hrs * rate),
      group: 'labor',
    });
  }

  // Parts — itemized when parts[] populated, legacy aggregate otherwise
  if (job.parts && job.parts.length > 0) {
    for (const p of job.parts) {
      const detailBase = `${p.qty} × $${Number(p.unitPrice).toFixed(2)}`;
      const detail = p.warrantyDays ? `${detailBase} (${p.warrantyDays}d warranty)` : detailBase;
      out.push({
        label: p.name,
        detail,
        amount: r2(Number(p.qty) * Number(p.unitPrice)),
        group: 'parts',
      });
    }
  } else if (Number(job.partsCost || 0) > 0) {
    out.push({
      label: 'Parts',
      amount: r2(Number(job.partsCost)),
      group: 'parts',
    });
  }

  // Diagnostic fee
  const diag = Number(job.diagnosticFee || 0);
  if (diag > 0) {
    out.push({
      label: 'Diagnostic fee',
      amount: r2(diag),
      group: 'fees',
    });
  }

  // Travel
  const miles = Number(job.miles || 0);
  const freeMi = Number(settings.freeMilesIncluded || 0);
  const chargeable = Math.max(0, miles - freeMi);
  if (chargeable > 0) {
    const cpm = Number(settings.costPerMile || 0.65);
    out.push({
      label: 'Travel',
      detail: `${chargeable} mi @ $${cpm}/mi`,
      amount: r2(chargeable * cpm),
      group: 'travel',
    });
  }

  return out;
}
```

- [ ] **Step 2: Write the test**

```ts
// tests/mechanicInvoiceLineItems.test.ts
import { buildMechanicLineItems } from '@/lib/mechanicJob';

let passed = 0;
let failed = 0;
const check = (label: string, cond: boolean): void => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}`); }
};

console.log('\n┌─ buildMechanicLineItems ────────────────────────────');
{
  const lines = buildMechanicLineItems(
    { laborHours: 3, parts: [], partsCost: 0, diagnosticFee: 0, miles: 0 },
    { laborRate: 95, freeMilesIncluded: 0, costPerMile: 0.65 },
  );
  check('labor-only: 1 line', lines.length === 1);
  check('labor-only: amount = 3 × 95', lines[0].amount === 285);
  check('labor-only: group is labor', lines[0].group === 'labor');
}
{
  const lines = buildMechanicLineItems(
    { laborHours: 0, parts: [
      { name: 'Brake pad set', qty: 1, unitPrice: 45, unitCost: 28, source: 'inventory', inventoryItemId: 'i1' },
      { name: 'Brake fluid',   qty: 2, unitPrice: 12, unitCost: 7,  source: 'inventory', inventoryItemId: 'i2', warrantyDays: 90 },
    ], partsCost: 69, diagnosticFee: 0, miles: 0 },
    { laborRate: 95, freeMilesIncluded: 0, costPerMile: 0.65 },
  );
  check('parts-only itemized: 2 lines', lines.length === 2);
  check('parts line 1 amount', lines[0].amount === 45);
  check('parts line 2 amount', lines[1].amount === 24);
  check('warranty annotation present', lines[1].detail?.includes('90d warranty') === true);
}
{
  const lines = buildMechanicLineItems(
    { laborHours: 0, parts: undefined, partsCost: 75, diagnosticFee: 0, miles: 0 },
    { laborRate: 95, freeMilesIncluded: 0, costPerMile: 0.65 },
  );
  check('legacy mechanic doc (no parts[]): 1 aggregate parts line', lines.length === 1);
  check('legacy aggregate label = "Parts"', lines[0].label === 'Parts');
  check('legacy aggregate amount = partsCost', lines[0].amount === 75);
}
{
  const lines = buildMechanicLineItems(
    { laborHours: 2, parts: [], partsCost: 0, diagnosticFee: 89, miles: 0 },
    { laborRate: 95, freeMilesIncluded: 0, costPerMile: 0.65 },
  );
  check('diagnostic fee line emitted', lines.find((l) => l.group === 'fees')?.amount === 89);
}
{
  const lines = buildMechanicLineItems(
    { laborHours: 0, parts: [], partsCost: 0, diagnosticFee: 0, miles: 12 },
    { laborRate: 95, freeMilesIncluded: 5, costPerMile: 0.65 },
  );
  check('travel: chargeable 7 mi × 0.65 = 4.55', lines.find((l) => l.group === 'travel')?.amount === 4.55);
}
{
  const lines = buildMechanicLineItems(
    { laborHours: 0, parts: [], partsCost: 0, diagnosticFee: 0, miles: 3 },
    { laborRate: 95, freeMilesIncluded: 5, costPerMile: 0.65 },
  );
  check('travel suppressed when miles below freeMiles', lines.find((l) => l.group === 'travel') === undefined);
}
{
  const lines = buildMechanicLineItems(
    { laborHours: 0, parts: [], partsCost: 0, diagnosticFee: 0, miles: 0 },
    { laborRate: 95, freeMilesIncluded: 0, costPerMile: 0.65 },
  );
  check('all-zero job emits no lines', lines.length === 0);
}

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
```

- [ ] **Step 3: Run the test**

```bash
npx tsx tests/mechanicInvoiceLineItems.test.ts
```

Expected: `N passed, 0 failed`.

- [ ] **Step 4: Commit**

```bash
git add src/lib/mechanicJob.ts tests/mechanicInvoiceLineItems.test.ts
git commit -m "feat(mechanic): buildMechanicLineItems + invoice line-item tests"
```

---

## Task 7: Widen `mechanic.ts` `inventoryFields` + add `partsField` jobField

**Files:**
- Modify: `src/config/businessTypes/mechanic.ts`

- [ ] **Step 1: Replace the existing `inventoryFields` array with the full spec**

In `src/config/businessTypes/mechanic.ts`, replace the existing `inventoryFields` block with:

```ts
  inventoryFields: [
    { key: 'partName',         label: 'Part Name',            type: 'text' },
    { key: 'partNumber',       label: 'Part Number',          type: 'text' },
    { key: 'brand',            label: 'Brand',                type: 'text' },
    { key: 'supplier',         label: 'Supplier',             type: 'text' },
    { key: 'category',         label: 'Category',             type: 'select', options: [
      'Engine', 'Brakes', 'Suspension', 'Electrical', 'Cooling System',
      'Tires/Wheels', 'Fluids', 'Filters', 'Diagnostics', 'HVAC',
    ] },
    { key: 'subcategory',      label: 'Subcategory',          type: 'text' },
    { key: 'qty',              label: 'Quantity',             type: 'number' },
    { key: 'unitCost',         label: 'Unit Cost ($)',        type: 'number' },
    { key: 'retailPrice',      label: 'Retail Price ($)',     type: 'number' },
    { key: 'condition',        label: 'Condition',            type: 'select', options: ['New', 'Used', 'Refurbished', 'Remanufactured'] },
    { key: 'laborHoursDefault',label: 'Default Labor Hours',  type: 'number' },
    { key: 'warrantyDays',     label: 'Warranty Days',        type: 'number' },
    { key: 'locationBin',      label: 'Location / Bin',       type: 'text' },
    { key: 'compatibleVehicles',label: 'Compatible Vehicles', type: 'text' },
    { key: 'notes',            label: 'Notes',                type: 'text' },
  ],
```

- [ ] **Step 2: Update `jobFields` — remove `partsCost` (replaced by parts[]) and remove `mileage` if it's mis-typed**

Replace the existing `jobFields` array with:

```ts
  jobFields: [
    { key: 'laborHours',       label: 'Labor Hours',          type: 'number', required: false },
    { key: 'diagnosticCode',   label: 'Diagnostic Code',      type: 'text',   required: false },
    { key: 'diagnosticFee',    label: 'Diagnostic Fee ($)',   type: 'number', required: false },
    { key: 'vehicleMakeModel', label: 'Vehicle Make / Model', type: 'text',   required: false },
    { key: 'mileage',          label: 'Vehicle Mileage',      type: 'number', required: false },
  ],
```

(The `parts` array is not a `jobField` — it's rendered via the dedicated `PartsSection` component the AddJob page mounts for mechanic verticals. The single-number `partsCost` field is removed from the form; it remains on the Job type as the legacy mirror.)

- [ ] **Step 3: Update `dashboardMetrics` to read `partsMarginSnapshot`**

Find the `parts_margin` metric (Phase 2.1 added one). Update its `compute` to prefer `partsMarginSnapshot.margin` when present, fall back to a derived calc otherwise:

Locate the existing metric and replace its `compute` body:

```ts
    {
      id: 'parts_margin',
      label: 'Parts Margin %',
      compute: (jobs) => {
        let totalMargin = 0;
        let totalRevenue = 0;
        for (const j of jobs) {
          const snap = j.partsMarginSnapshot;
          if (snap && snap.revenue > 0) {
            totalMargin  += snap.margin;
            totalRevenue += snap.revenue;
          }
        }
        if (totalRevenue <= 0) return 0;
        return totalMargin / totalRevenue;
      },
      format: 'percent',
    },
```

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/config/businessTypes/mechanic.ts
git commit -m "feat(mechanic-config): widen inventoryFields + jobFields; partsMarginSnapshot dashboard metric"
```

---

## Task 8: `MechanicInventoryView` component + dispatcher wiring

**Files:**
- Create: `src/components/inventory/MechanicInventoryView.tsx`
- Modify: `src/pages/Inventory.tsx` (dispatcher branch)

- [ ] **Step 1: Create the component**

Create `src/components/inventory/MechanicInventoryView.tsx`:

```tsx
// src/components/inventory/MechanicInventoryView.tsx
// ═══════════════════════════════════════════════════════════════════
//  Mechanic-vertical inventory surface. Mobile-first: search, filter,
//  category-grouped list, full-screen add/edit sheet. Reads/writes the
//  canonical InventoryItem shape — no shadow types, no parallel store.
// ═══════════════════════════════════════════════════════════════════

import { useMemo, useState } from 'react';
import type { InventoryItem, Settings } from '@/types';
import type { BusinessTypeConfig } from '@/config/businessTypes/types';
import { uid } from '@/lib/utils';

interface Props {
  inventory: InventoryItem[];
  onSave: (items: InventoryItem[]) => void;
  vertical: BusinessTypeConfig;
  settings: Settings;
}

export function MechanicInventoryView({ inventory, onSave, vertical, settings }: Props) {
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('');
  const [supplierFilter, setSupplierFilter] = useState<string>('');
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<InventoryItem | null>(null);

  const lowStockThreshold = Number(settings.lowStockThreshold ?? 2);

  const categoryOptions = useMemo(() => {
    const f = vertical.inventoryFields.find((x) => x.key === 'category');
    return f?.options ?? [];
  }, [vertical]);
  const conditionOptions = useMemo(() => {
    const f = vertical.inventoryFields.find((x) => x.key === 'condition');
    return f?.options ?? ['New', 'Used'];
  }, [vertical]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return inventory.filter((it) => {
      if (lowStockOnly && Number(it.qty || 0) > lowStockThreshold) return false;
      if (categoryFilter && it.category !== categoryFilter) return false;
      if (supplierFilter && it.supplier !== supplierFilter) return false;
      if (term) {
        const hay = [it.partName, it.partNumber, it.brand, it.supplier]
          .filter(Boolean).map((s) => String(s).toLowerCase()).join(' ');
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }, [inventory, search, categoryFilter, supplierFilter, lowStockOnly, lowStockThreshold]);

  const grouped = useMemo(() => {
    const buckets: Record<string, InventoryItem[]> = {};
    for (const it of filtered) {
      const key = it.category || 'Uncategorized';
      (buckets[key] = buckets[key] || []).push(it);
    }
    return buckets;
  }, [filtered]);

  const suppliers = useMemo(() => {
    const set = new Set<string>();
    for (const it of inventory) if (it.supplier) set.add(it.supplier);
    return Array.from(set).sort();
  }, [inventory]);

  const openNew = (): void => {
    setEditingId(null);
    setDraft({
      id: uid(),
      size: '',
      qty: 0,
      cost: 0,
      partName: '',
      partNumber: '',
      brand: '',
      supplier: '',
      category: '',
      subcategory: '',
      unitCost: 0,
      retailPrice: 0,
      condition: 'New',
      laborHoursDefault: undefined,
      warrantyDays: undefined,
      locationBin: '',
      compatibleVehicles: [],
      notes: '',
      _isNew: true,
    });
  };

  const openEdit = (it: InventoryItem): void => {
    setEditingId(it.id);
    setDraft({ ...it });
  };

  const close = (): void => {
    setEditingId(null);
    setDraft(null);
  };

  const persist = (): void => {
    if (!draft) return;
    // Mirror unitCost → cost for the existing tire-shape deduction engine.
    const finalItem: InventoryItem = {
      ...draft,
      cost: Number(draft.unitCost ?? draft.cost ?? 0),
    };
    const next = editingId
      ? inventory.map((i) => (i.id === editingId ? finalItem : i))
      : [...inventory, finalItem];
    onSave(next);
    close();
  };

  const remove = (): void => {
    if (!editingId) return;
    onSave(inventory.filter((i) => i.id !== editingId));
    close();
  };

  return (
    <div style={{ padding: 12 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
        <strong>Parts inventory</strong>
        <span style={{ color: '#888', fontSize: 12 }}>({inventory.length})</span>
      </div>

      <input
        type="text"
        placeholder="Search part #, name, brand"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={{ width: '100%', padding: 10, fontSize: 16, marginBottom: 8 }}
      />

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} style={{ padding: 6 }}>
          <option value="">All categories</option>
          {categoryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={supplierFilter} onChange={(e) => setSupplierFilter(e.target.value)} style={{ padding: 6 }}>
          <option value="">All suppliers</option>
          {suppliers.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 14 }}>
          <input type="checkbox" checked={lowStockOnly} onChange={(e) => setLowStockOnly(e.target.checked)} />
          Low stock only
        </label>
      </div>

      {Object.keys(grouped).length === 0 && (
        <div style={{ padding: 16, color: '#888', textAlign: 'center' }}>
          {inventory.length === 0 ? 'No parts yet — tap "+ Add part".' : 'No matches.'}
        </div>
      )}

      {Object.entries(grouped).map(([cat, items]) => {
        const isCollapsed = !!collapsed[cat];
        return (
          <div key={cat} style={{ marginBottom: 12 }}>
            <button
              onClick={() => setCollapsed((m) => ({ ...m, [cat]: !isCollapsed }))}
              style={{ width: '100%', textAlign: 'left', padding: 8, background: '#f4f4f4', border: 0, fontWeight: 700 }}
            >
              {isCollapsed ? '▸' : '▾'} {cat.toUpperCase()} ({items.length})
            </button>
            {!isCollapsed && (
              <div>
                {items.map((it) => {
                  const onHand = Number(it.qty || 0);
                  const isLow = onHand <= lowStockThreshold;
                  return (
                    <button
                      key={it.id}
                      onClick={() => openEdit(it)}
                      style={{ display: 'block', width: '100%', textAlign: 'left', padding: 10, border: '1px solid #eee', background: 'white' }}
                    >
                      <div style={{ fontWeight: 600 }}>{it.partName || '(unnamed)'} <span style={{ color: '#888', fontSize: 12 }}>{it.partNumber}</span></div>
                      <div style={{ fontSize: 13, color: '#555' }}>
                        qty {onHand} · ${Number(it.retailPrice ?? 0).toFixed(2)} retail · ${Number(it.unitCost ?? it.cost ?? 0).toFixed(2)} cost
                        {isLow && <span style={{ color: '#c0392b', marginLeft: 8 }}>⚠ LOW</span>}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      <button onClick={openNew} style={{ position: 'sticky', bottom: 8, width: '100%', padding: 12, fontSize: 16, fontWeight: 700 }}>
        + Add part
      </button>

      {draft && (
        <EditSheet
          draft={draft}
          setDraft={setDraft}
          categoryOptions={categoryOptions}
          conditionOptions={conditionOptions}
          markupDefault={Number(settings.partsMarkupDefault ?? 1.5)}
          onSave={persist}
          onCancel={close}
          onDelete={editingId ? remove : undefined}
        />
      )}
    </div>
  );
}

interface SheetProps {
  draft: InventoryItem;
  setDraft: (it: InventoryItem) => void;
  categoryOptions: ReadonlyArray<string>;
  conditionOptions: ReadonlyArray<string>;
  markupDefault: number;
  onSave: () => void;
  onCancel: () => void;
  onDelete?: () => void;
}

function EditSheet({ draft, setDraft, categoryOptions, conditionOptions, markupDefault, onSave, onCancel, onDelete }: SheetProps) {
  const num = (s: string): number | undefined => {
    const n = Number(s);
    return Number.isFinite(n) ? n : undefined;
  };
  const update = (patch: Partial<InventoryItem>): void => setDraft({ ...draft, ...patch });

  // Auto-suggest retail when unitCost edited and retail is empty / equal to prior derived.
  const handleUnitCost = (raw: string): void => {
    const u = num(raw) ?? 0;
    const suggested = Math.round(u * markupDefault * 100) / 100;
    const retailEmpty = !Number(draft.retailPrice);
    update({ unitCost: u, retailPrice: retailEmpty ? suggested : draft.retailPrice });
  };

  const isValid = !!draft.partName && !!draft.partNumber && Number(draft.qty) >= 0 && Number(draft.unitCost) >= 0 && Number(draft.retailPrice) >= 0 && !!draft.category;

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 100, display: 'flex', flexDirection: 'column' }}>
      <div style={{ background: 'white', flex: 1, overflowY: 'auto', padding: 16 }}>
        <h3>{draft._isNew ? 'Add part' : 'Edit part'}</h3>
        <Row label="Part name *"><input value={draft.partName || ''} onChange={(e) => update({ partName: e.target.value })} /></Row>
        <Row label="Part number *"><input value={draft.partNumber || ''} onChange={(e) => update({ partNumber: e.target.value })} /></Row>
        <Row label="Brand"><input value={draft.brand || ''} onChange={(e) => update({ brand: e.target.value })} /></Row>
        <Row label="Supplier"><input value={draft.supplier || ''} onChange={(e) => update({ supplier: e.target.value })} /></Row>
        <Row label="Category *">
          <select value={draft.category || ''} onChange={(e) => update({ category: e.target.value })}>
            <option value="">(select)</option>
            {categoryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </Row>
        <Row label="Subcategory"><input value={draft.subcategory || ''} onChange={(e) => update({ subcategory: e.target.value })} /></Row>
        <Row label="Quantity *"><input type="number" value={draft.qty ?? 0} onChange={(e) => update({ qty: num(e.target.value) ?? 0 })} /></Row>
        <Row label="Unit cost ($) *"><input type="number" value={draft.unitCost ?? 0} onChange={(e) => handleUnitCost(e.target.value)} /></Row>
        <Row label="Retail price ($) *"><input type="number" value={draft.retailPrice ?? 0} onChange={(e) => update({ retailPrice: num(e.target.value) ?? 0 })} /></Row>
        <Row label="Condition">
          <select value={draft.condition || 'New'} onChange={(e) => update({ condition: e.target.value })}>
            {conditionOptions.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </Row>
        <Row label="Default labor hours"><input type="number" value={draft.laborHoursDefault ?? ''} onChange={(e) => update({ laborHoursDefault: num(e.target.value) })} /></Row>
        <Row label="Warranty days"><input type="number" value={draft.warrantyDays ?? ''} onChange={(e) => update({ warrantyDays: num(e.target.value) })} /></Row>
        <Row label="Location / bin"><input value={draft.locationBin || ''} onChange={(e) => update({ locationBin: e.target.value })} /></Row>
        <Row label="Compatible vehicles (comma-separated)">
          <input
            value={(draft.compatibleVehicles ?? []).join(', ')}
            onChange={(e) => update({ compatibleVehicles: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
          />
        </Row>
        <Row label="Notes"><textarea value={draft.notes || ''} onChange={(e) => update({ notes: e.target.value })} /></Row>
      </div>
      <div style={{ display: 'flex', gap: 8, padding: 12, background: '#f4f4f4' }}>
        <button onClick={onCancel} style={{ flex: 1, padding: 12 }}>Cancel</button>
        {onDelete && <button onClick={onDelete} style={{ flex: 1, padding: 12, color: '#c0392b' }}>Delete</button>}
        <button onClick={onSave} disabled={!isValid} style={{ flex: 2, padding: 12, fontWeight: 700 }}>Save</button>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 12, color: '#555', marginBottom: 2 }}>{label}</div>
      {children}
    </div>
  );
}
```

- [ ] **Step 2: Wire `Inventory.tsx` dispatcher**

In `src/pages/Inventory.tsx`, find the existing dispatcher block (around line 95-103). Add a mechanic branch BEFORE the generic fallback:

```tsx
import { MechanicInventoryView } from '@/components/inventory/MechanicInventoryView';

// ... inside the dispatcher function ...
if (vertical.key === 'mechanic') {
  return <MechanicInventoryView inventory={inventory} onSave={onSave} vertical={vertical} settings={settings} />;
}
if (vertical.key === 'detailing' || vertical.key !== 'tire') {
  return <GenericInventoryView inventory={inventory} onSave={onSave} vertical={vertical} />;
}
return <TireInventoryView inventory={inventory} onSave={onSave} />;
```

(Confirm the dispatcher function receives `settings` as a prop; if it doesn't currently, add it to the props interface and pass it through from the caller.)

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/components/inventory/MechanicInventoryView.tsx src/pages/Inventory.tsx
git commit -m "feat(inventory): MechanicInventoryView + dispatcher wiring"
```

---

## Task 9: `PartsSection` (AddJob mechanic parts entry block)

**Files:**
- Create: `src/components/addJob/PartsSection.tsx`
- Modify: `src/pages/AddJob.tsx` (mount PartsSection for mechanic vertical)

- [ ] **Step 1: Create the component**

Create `src/components/addJob/PartsSection.tsx`:

```tsx
// src/components/addJob/PartsSection.tsx
// ═══════════════════════════════════════════════════════════════════
//  Mechanic AddJob parts entry block. Mobile-first: tap "+ Add part",
//  autocomplete from inventory, default source = bought_for_job for
//  unbound typed names. Inventory-bound rows auto-fill unitPrice /
//  unitCost / source / inventoryItemId.
// ═══════════════════════════════════════════════════════════════════

import { useMemo, useState } from 'react';
import type { JobPartLine, InventoryItem } from '@/types';

interface Props {
  parts: ReadonlyArray<JobPartLine>;
  inventory: ReadonlyArray<InventoryItem>;
  onChange: (next: ReadonlyArray<JobPartLine>) => void;
}

export function PartsSection({ parts, inventory, onChange }: Props) {
  const [adding, setAdding] = useState(false);

  const update = (idx: number, patch: Partial<JobPartLine>): void => {
    const next = parts.map((p, i) => (i === idx ? { ...p, ...patch } : p));
    onChange(next);
  };
  const remove = (idx: number): void => {
    onChange(parts.filter((_, i) => i !== idx));
  };
  const append = (line: JobPartLine): void => {
    onChange([...parts, line]);
    setAdding(false);
  };

  return (
    <div>
      <div style={{ fontWeight: 700, marginBottom: 6 }}>Parts {parts.length > 0 ? `(${parts.length})` : ''}</div>
      {parts.map((p, i) => <PartRow key={i} part={p} inventory={inventory} onUpdate={(patch) => update(i, patch)} onRemove={() => remove(i)} />)}
      {adding ? (
        <PartRowNew inventory={inventory} onCommit={append} onCancel={() => setAdding(false)} />
      ) : (
        <button onClick={() => setAdding(true)} style={{ padding: 10, width: '100%', marginTop: 4 }}>+ Add part</button>
      )}
    </div>
  );
}

interface RowProps {
  part: JobPartLine;
  inventory: ReadonlyArray<InventoryItem>;
  onUpdate: (patch: Partial<JobPartLine>) => void;
  onRemove: () => void;
}

function PartRow({ part, onUpdate, onRemove }: RowProps) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div style={{ border: '1px solid #eee', padding: 8, marginBottom: 4 }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <input value={part.name} onChange={(e) => onUpdate({ name: e.target.value })} style={{ flex: 2 }} />
        <input type="number" value={part.qty} onChange={(e) => onUpdate({ qty: Number(e.target.value) || 0 })} style={{ width: 50 }} />
        <input type="number" value={part.unitPrice} onChange={(e) => onUpdate({ unitPrice: Number(e.target.value) || 0 })} style={{ width: 70 }} placeholder="$" />
        <button onClick={() => setExpanded((v) => !v)} style={{ width: 30 }}>⋯</button>
      </div>
      {expanded && (
        <div style={{ marginTop: 6, fontSize: 13 }}>
          <div>
            Source:{' '}
            <select value={part.source} onChange={(e) => onUpdate({ source: e.target.value as JobPartLine['source'], inventoryItemId: e.target.value === 'inventory' ? part.inventoryItemId : undefined })}>
              <option value="inventory">From inventory</option>
              <option value="bought_for_job">Bought for this job</option>
              <option value="special_order">Special order</option>
            </select>
          </div>
          <div>Unit cost: <input type="number" value={part.unitCost} onChange={(e) => onUpdate({ unitCost: Number(e.target.value) || 0 })} style={{ width: 80 }} /></div>
          {part.source !== 'inventory' && (
            <div>Supplier: <input value={part.supplier || ''} onChange={(e) => onUpdate({ supplier: e.target.value })} /></div>
          )}
          <div>Warranty days: <input type="number" value={part.warrantyDays ?? ''} onChange={(e) => onUpdate({ warrantyDays: Number(e.target.value) || undefined })} style={{ width: 60 }} /></div>
          <button onClick={onRemove} style={{ color: '#c0392b', marginTop: 4 }}>Remove</button>
        </div>
      )}
    </div>
  );
}

interface NewRowProps {
  inventory: ReadonlyArray<InventoryItem>;
  onCommit: (line: JobPartLine) => void;
  onCancel: () => void;
}

function PartRowNew({ inventory, onCommit, onCancel }: NewRowProps) {
  const [name, setName] = useState('');
  const [qty, setQty] = useState<number>(1);
  const [unitPrice, setUnitPrice] = useState<number>(0);

  const suggestions = useMemo(() => {
    const term = name.trim().toLowerCase();
    if (!term) return [];
    const matches = inventory.filter((i) => {
      const hay = [i.partName, i.partNumber, i.brand].filter(Boolean).map((s) => String(s).toLowerCase()).join(' ');
      return hay.includes(term);
    });
    // In-stock first, then alphabetical by partName
    matches.sort((a, b) => {
      const aOK = Number(a.qty || 0) > 0 ? 0 : 1;
      const bOK = Number(b.qty || 0) > 0 ? 0 : 1;
      if (aOK !== bOK) return aOK - bOK;
      return String(a.partName || '').localeCompare(String(b.partName || ''));
    });
    return matches.slice(0, 5);
  }, [name, inventory]);

  const pickSuggestion = (it: InventoryItem): void => {
    onCommit({
      name: it.partName || it.partNumber || '',
      qty,
      unitPrice: Number(it.retailPrice ?? 0),
      unitCost: Number(it.unitCost ?? it.cost ?? 0),
      source: 'inventory',
      inventoryItemId: it.id,
      warrantyDays: it.warrantyDays,
    });
  };

  const commitUnbound = (): void => {
    if (!name.trim()) { onCancel(); return; }
    onCommit({
      name: name.trim(),
      qty,
      unitPrice,
      unitCost: 0,
      source: 'bought_for_job',
    });
  };

  return (
    <div style={{ border: '1px solid #88f', padding: 8, marginBottom: 4 }}>
      <div style={{ display: 'flex', gap: 6 }}>
        <input
          placeholder="Part name or #"
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={{ flex: 2 }}
          autoFocus
        />
        <input type="number" value={qty} onChange={(e) => setQty(Number(e.target.value) || 1)} style={{ width: 50 }} />
        <input type="number" value={unitPrice} onChange={(e) => setUnitPrice(Number(e.target.value) || 0)} placeholder="$" style={{ width: 70 }} />
      </div>
      {suggestions.length > 0 && (
        <div style={{ marginTop: 4 }}>
          {suggestions.map((it) => {
            const onHand = Number(it.qty || 0);
            return (
              <button key={it.id} onClick={() => pickSuggestion(it)} style={{ display: 'block', width: '100%', textAlign: 'left', padding: 6, fontSize: 13 }}>
                {it.partName || it.partNumber} ({onHand > 0 ? `qty ${onHand}` : '0 — special order'}, ${Number(it.retailPrice ?? 0).toFixed(2)})
              </button>
            );
          })}
        </div>
      )}
      <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
        <button onClick={onCancel} style={{ flex: 1, padding: 6 }}>Cancel</button>
        <button onClick={commitUnbound} style={{ flex: 1, padding: 6, fontWeight: 700 }}>✓ Add</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Mount `PartsSection` in `AddJob.tsx` for mechanic vertical**

In `src/pages/AddJob.tsx`, locate where the mechanic-vertical job fields render (it should be a block guarded by `if (vertical.key === 'mechanic')` or similar). Add a `<PartsSection>` invocation. Pass `parts` from the draft, `inventory` from props, and an `onChange` that updates `jobDraft.parts`.

Exact insertion site: find the existing `<DynamicJobField>` rendering block for mechanic, and place `<PartsSection>` immediately after it.

```tsx
import { PartsSection } from '@/components/addJob/PartsSection';

// ... within AddJob render, mechanic block ...
{vertical.key === 'mechanic' && (
  <PartsSection
    parts={jobDraft.parts ?? []}
    inventory={inventory}
    onChange={(parts) => setJobDraft({ ...jobDraft, parts })}
  />
)}
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/components/addJob/PartsSection.tsx src/pages/AddJob.tsx
git commit -m "feat(addjob): PartsSection with inventory autocomplete + source picker (mechanic vertical)"
```

---

## Task 10: Mechanic save branch in `App.tsx` (atomic batch deduction)

**Files:**
- Modify: `src/App.tsx` (`saveJob` callback + `deleteJob` callback)

- [ ] **Step 1: Add mechanic save branch to `saveJob`**

In `src/App.tsx`, locate `saveJob` (line ~581). The existing tire branch is guarded by `if (j.tireSource === 'Inventory' && j.tireSize)`. After the entire `try { ... } catch { ... }` block resolves the tire path, the mechanic branch needs to run BEFORE the job write. The cleanest insertion is to add a mechanic branch parallel to the tire one, gated on `vertical.key === 'mechanic'`. We use `getBusinessTypeConfig(settings.businessType)` to read the active vertical.

Add these imports near the top of `App.tsx` if not already present:

```ts
import { getBusinessTypeConfig } from '@/config/businessTypes/registry';
import {
  diffPartsForDeduction,
  buildPartsInventoryDeductions,
  deriveLegacyPartsCost,
  derivePartsMarginSnapshot,
  shouldWarnOnDeduction,
} from '@/lib/mechanicJob';
```

Inside `saveJob`, after the existing tire deduction block and before the `const finalJob` construction, add:

```ts
// ─── Mechanic parts deduction branch (Phase 2.2) ────────────────
let mechanicDeductions: { id: string; size: string; qty: number; cost: number }[] | null = null;
let mechanicPartsCost = 0;
let mechanicMarginSnapshot: ReturnType<typeof derivePartsMarginSnapshot> = undefined;

const verticalConfig = getBusinessTypeConfig(settings.businessType);
if (verticalConfig.key === 'mechanic' && Array.isArray(j.parts) && j.parts.length > 0) {
  // Soft-warn for any line that would push qty negative
  const oldJob = isEditing ? jobs.find((x) => x.id === editingJobId) : undefined;
  const oldParts = oldJob?.parts ?? [];
  for (const line of j.parts) {
    if (line.source !== 'inventory' || !line.inventoryItemId) continue;
    const oldLine = oldParts.find((p) => p.inventoryItemId === line.inventoryItemId);
    const oldQty = oldLine ? Number(oldLine.qty || 0) : 0;
    if (shouldWarnOnDeduction(line, workingInv, oldQty)) {
      const item = workingInv.find((i) => i.id === line.inventoryItemId);
      const onHand = Number(item?.qty || 0);
      // eslint-disable-next-line no-alert
      const confirmed = window.confirm(`Only ${onHand} in stock — deduct anyway?`);
      if (!confirmed) return null;
    }
  }

  // Compute deltas (positive = refund, negative = deduct)
  const delta = diffPartsForDeduction(oldParts, j.parts);
  const invWrites: Promise<void>[] = [];
  for (const [itemId, change] of Object.entries(delta)) {
    const idx = workingInv.findIndex((i) => i.id === itemId);
    if (idx < 0) continue;
    const cur = Number(workingInv[idx].qty || 0);
    const next = cur + change; // delta is signed; deduction is negative
    workingInv[idx] = { ...workingInv[idx], qty: next };
    invWrites.push(fbSetFast(invCol, itemId, workingInv[idx]));
  }
  setInventoryRaw(workingInv);
  log('mechanic-inv-writes-issued');
  await Promise.all(invWrites);
  log('mechanic-inv-writes-acked');

  mechanicDeductions = buildPartsInventoryDeductions(j.parts);
  mechanicPartsCost = deriveLegacyPartsCost(j.parts);
  mechanicMarginSnapshot = derivePartsMarginSnapshot(j.parts);
}
```

Then in the `finalJob` literal construction, fold in the mechanic mirrors:

```ts
const finalJob: Job = {
  ...j,
  id: j.id || uid(),
  tireCost: computedTireCost,
  inventoryDeductions: deductions,
  lastEditedAt: new Date().toISOString(),
  createdByUid: j.createdByUid || currentUid,
  createdAt: j.createdAt || new Date().toISOString(),
  // Phase 2.2 mechanic mirrors:
  partsInventoryDeductions: mechanicDeductions,
  partsCost: verticalConfig.key === 'mechanic' && Array.isArray(j.parts) && j.parts.length > 0
    ? mechanicPartsCost
    : j.partsCost,
  partsMarginSnapshot: mechanicMarginSnapshot,
};
```

- [ ] **Step 2: Add mechanic refund to `deleteJob`**

In `src/App.tsx`, locate `deleteJob` (~line 696). It currently handles tire deductions. Add mechanic refund symmetric to it:

After the tire-refund block, add:

```ts
const j2 = jobs.find((x) => x.id === id);
const mechDeds = j2 && Array.isArray(j2.partsInventoryDeductions) ? j2.partsInventoryDeductions : null;
if (mechDeds) {
  const inv = [...(inventoryRef.current || [])];
  for (const d of mechDeds) {
    const idx = inv.findIndex((i) => i.id === d.id);
    if (idx >= 0) {
      inv[idx] = { ...inv[idx], qty: Number(inv[idx].qty || 0) + Number(d.qty || 0) };
      await fbSetFast(invCol, d.id, inv[idx]);
    }
  }
  setInventoryRaw(inv);
}
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx
git commit -m "feat(savejob): mechanic atomic deduction branch + soft-warn dialog + delete refund"
```

---

## Task 11: Wire mechanic invoice template to `buildMechanicLineItems`

**Files:**
- Modify: `src/config/businessTypes/invoice/mechanic.ts`

- [ ] **Step 1: Replace the mechanic template's line-items builder**

Open `src/config/businessTypes/invoice/mechanic.ts`. The Phase 2.1 mechanic template stub likely has a placeholder `buildLineItems` returning an empty array or a flat aggregate. Replace its body to delegate to `buildMechanicLineItems` from `@/lib/mechanicJob`.

The invoice's `LineItem` type may differ slightly from `MechanicLineItem` — adapt by mapping the `group` field shape if needed. Read the existing `InvoiceTemplate` interface in `src/config/businessTypes/invoice/types.ts` first to confirm the exact `LineItem` shape, then adapt the call.

```ts
import { buildMechanicLineItems } from '@/lib/mechanicJob';
import type { InvoiceTemplate } from './types';

export const MECHANIC_INVOICE_TEMPLATE: InvoiceTemplate = {
  // ... existing subtitle, resolveServiceName, footerCopy, servicePerformedFields, notesLabel ...
  buildLineItems: (job, settings) => {
    const lines = buildMechanicLineItems(job, settings);
    return lines.map((l) => ({
      label: l.label,
      detail: l.detail,
      amount: l.amount,
    }));
  },
};
```

(If the existing `InvoiceTemplate.LineItem` already has a `group` field, pass it through; otherwise drop it as above.)

For the warranty policy footer, extend `footerCopy` to consult `settings.warrantyPolicy`:

```ts
  footerCopy: (job, settings) => {
    const base = '...existing footer text...';
    const policy = settings.warrantyPolicy?.trim();
    return policy ? `${base}\n\n${policy}` : base;
  },
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/config/businessTypes/invoice/mechanic.ts
git commit -m "feat(invoice): mechanic template consumes buildMechanicLineItems + warrantyPolicy footer"
```

---

## Task 12: Settings UI editors for the new mechanic-related settings

**Files:**
- Modify: one of `src/components/settings/PricingSection.tsx`, `BusinessSection.tsx`, or `VerticalDefaultsSection.tsx` (whichever currently hosts mechanic-related editors)

- [ ] **Step 1: Locate the right section**

Run: `grep -n "laborRate\|costPerMile" src/components/settings/*.tsx` to find which file currently exposes labor-rate-like settings.

Add four new editors in that file (`laborRate`, `lowStockThreshold`, `partsMarkupDefault`, `warrantyPolicy`):

```tsx
<Row label="Labor rate ($/hr)">
  <input type="number" value={settings.laborRate ?? 95} onChange={(e) => onChange({ ...settings, laborRate: Number(e.target.value) || 95 })} />
</Row>
<Row label="Low-stock threshold (parts ≤ X show ⚠)">
  <input type="number" value={settings.lowStockThreshold ?? 2} onChange={(e) => onChange({ ...settings, lowStockThreshold: Number(e.target.value) || 0 })} />
</Row>
<Row label="Parts markup default (cost × this = retail)">
  <input type="number" step="0.1" value={settings.partsMarkupDefault ?? 1.5} onChange={(e) => onChange({ ...settings, partsMarkupDefault: Number(e.target.value) || 1.5 })} />
</Row>
<Row label="Warranty policy (printed on mechanic invoices)">
  <textarea value={settings.warrantyPolicy ?? ''} onChange={(e) => onChange({ ...settings, warrantyPolicy: e.target.value })} />
</Row>
```

The exact `Row` / `<input>` shape may differ — adapt to the existing component conventions in that file.

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/settings/
git commit -m "feat(settings): expose laborRate, lowStockThreshold, partsMarkupDefault, warrantyPolicy editors"
```

---

## Task 13: Final smoke validation + cleanup

- [ ] **Step 1: Re-run every test file**

```bash
npx tsx tests/jobLifecycle.test.ts
npx tsx tests/mechanicJobDerivation.test.ts
npx tsx tests/mechanicDeductionDiff.test.ts
npx tsx tests/mechanicDeductionRollback.test.ts
npx tsx tests/softStockWarning.test.ts
npx tsx tests/mechanicInvoiceLineItems.test.ts
```

Expected: every file prints `N passed, 0 failed`.

- [ ] **Step 2: Final clean build**

```bash
npm run build
```

Expected: `tsc --noEmit` clean, Vite emit, no circular-dep warnings.

- [ ] **Step 3: Verify commit history is granular**

```bash
git log --oneline origin/main..HEAD
```

Expected: roughly 12 commits, each focused on one task from this plan, each with a clear `feat(...) / test(...)` prefix.

- [ ] **Step 4: Push and run the §11.4 spec smoke checklist on production**

```bash
git push origin main
```

After deploy lands, hand-execute the §11.4 checklist from the spec against `app.mobileserviceos.app`:

- Tire account regression (5 items)
- Mechanic account flow (10 items)
- Cross-cutting (3 items)

No final commit needed — this task is verification only.

---

## Phase summary

After all 13 tasks land:

| Surface | State |
|---|---|
| Types | `InventoryItem` widened (mechanic-extended); `JobPartLine` + `PartsMarginSnapshot` added; `Job` widened with `parts? / partsInventoryDeductions? / partsMarginSnapshot?`; `Settings` widened with `laborRate / lowStockThreshold / partsMarkupDefault / warrantyPolicy` |
| Helpers | `src/lib/mechanicJob.ts` — 6 pure functions (derive × 2, diff, build, rollback, warn) + invoice line-item builder |
| Tests | 5 new test files, ~50 assertions, all `npx tsx`-runnable |
| Config | `mechanic.ts` `inventoryFields` widened to 16 fields with category/condition option lists; dashboard `parts_margin` metric reads `partsMarginSnapshot` |
| UI | `MechanicInventoryView` lists/edits parts catalog; `PartsSection` enters parts on AddJob with inventory autocomplete + source picker |
| Save | `saveJob` mechanic branch — atomic deduction + soft-warn dialog; `deleteJob` mechanic refund |
| Invoice | Mechanic template emits itemized parts + aggregate labor + diagnostic + travel; legacy fallback for old jobs with `parts` undefined |
| Settings | 4 new editors visible to mechanic operators |
| Backward compat | Tire workflows byte-identical; legacy mechanic jobs render via aggregate-line fallback |
