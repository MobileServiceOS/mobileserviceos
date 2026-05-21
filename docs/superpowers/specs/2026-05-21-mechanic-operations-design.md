# Phase 2.2 / Sub-Project A — Mechanic Operations Design Spec

**Status:** Approved for implementation planning (2026-05-21)

**Owning phase:** Phase 2.2 mechanic full-slice.

**Sub-projects in Phase 2.2 (this spec covers A only):**
- **A. Mechanic Operations** — *this spec* — priorities 1, 2, 5 from the user's directive
- B. Multi-User Foundation — technician role, permissions, assigned-tech relationship
- C. Dispatch + Lifecycle UI — dispatch board, stage-transition writers, timeline
- D. CRM Automation Hooks — `StageNotificationSpec` dispatcher, template registry, channel adapters

Each sub-project gets its own spec → plan → implementation cycle. The job-lifecycle foundation landed in Phase 2.1's epilogue (see [2026-05-20-job-lifecycle-architecture-design.md](2026-05-20-job-lifecycle-architecture-design.md)); this spec consumes its types but writes nothing to `lifecycleStage` yet (that's Sub-Project C).

---

## 1. Goal

Deliver a complete, production-grade workflow for a mechanic-vertical account: capturing a job with structured parts + labor, deducting parts from inventory atomically on save, and producing an itemized invoice. After this sub-project ships, a mechanic shop can run a real customer job end-to-end without any tire-vertical leftover surfaces leaking through.

**Out of scope this sub-project:** technician role + permissions (Sub-Project B), dispatch board (Sub-Project C), notification dispatch (Sub-Project D), labor multi-line entry, supplier-API integrations, reorder workflows, multi-vehicle invoices, customer-facing margin disclosure.

## 2. Hard constraints (carried from user direction)

- Mobile-first always — tech enters jobs from a phone in a parking lot
- No enterprise bloat / nested workflow complexity / mandatory multi-step dialogs
- No hard stock locks (no reservation system this phase)
- No CRM-style process overhead
- Additive-only schema migrations
- Universal base inventory shared across verticals; mechanic fields extend the base
- No duplicated inventory systems per vertical
- Preserve tire-vertical stability — byte-identical tire reads/writes
- Runtime-config architecture stays universal — no hardcoded `if (vertical === 'mechanic')` in pages
- Every commit independently revertible; no destructive schema rewrites

## 3. Implementation priority order

The implementation plan (next skill) sequences work in this order, derived from the user's directive:

1. Mechanic AddJob flow (drives all other surfaces)
2. Structured parts workflow (line items, autocomplete, source picker)
3. Inventory deduction path (atomic batch, edit diff, rollback)
4. Mechanic invoice rendering (itemized parts + aggregate labor)
5. Lifecycle integration (read-only — derive stage via `deriveLifecycleStage`; no writers)
6. Technician workflow speed (mobile UX polish + autocomplete perf)
7. Dashboard profitability accuracy (margin snapshot rollup matches per-job totals)

## 4. Architecture

### 4.1 Universal base + vertical extensions on one shared shape

No per-vertical inventory collection. No parallel Job table. We continue the Phase 2.1 pattern: optional fields layered onto the canonical `InventoryItem` and `Job` types, gated by `BusinessTypeConfig.inventoryFields` and `jobFields` so the same React tree renders different surfaces with no `if (businessType === 'mechanic')` branches.

```
                                          ┌── tire.ts:  inventoryFields = [size, qty, cost, brand, model, condition, notes]
   BusinessTypeConfig                     │
   .inventoryFields    ────────────────► ─┼── mechanic.ts: inventoryFields = [partNumber, partName, supplier,
   .jobFields                              │                                   category, subcategory, qty, unitCost,
                                           │                                   retailPrice, brand, condition,
                                           │                                   laborHoursDefault?, compatibleVehicles?,
                                           │                                   warrantyDays?, locationBin?, notes]
                                           │
                                           └── detailing.ts: inventoryFields = [chemicalName, category, dilutionRatio, ...]

   InventoryItem (one type, optional facets):
     base:      id, qty, cost, notes, brand, condition
     tire:      size, model
     mechanic:  partNumber, partName, supplier, category, subcategory,
                unitCost, retailPrice, laborHoursDefault, compatibleVehicles,
                warrantyDays, locationBin
     detailing: chemicalName, dilutionRatio
```

### 4.2 Inventory page surface (dispatcher pattern from Phase 2.1)

```
Inventory.tsx (router)
  ├── if vertical.key === 'tire'      → TireInventoryView      (existing, unchanged)
  ├── if vertical.key === 'mechanic'  → MechanicInventoryView  (new this phase)
  └── else                            → GenericInventoryView   (existing fallback)
```

`MechanicInventoryView` is a dedicated file (not an overload of `GenericInventoryView`) because mechanic has interactions — vehicle-compatibility chips, category grouping, low-stock badges, parts-autocomplete entry from AddJob — that don't generalize. It reads the same canonical `InventoryItem` data and renders fields per `mechanic.inventoryFields` config.

### 4.3 Parts on a Job are structured line items

`Job.parts?: ReadonlyArray<JobPartLine>` is additive. Today's `partsCost` (a flat total) is kept and becomes a **derived mirror** on new writes (sum of `qty × unitPrice` across the parts array). Old Job docs continue to read; the legacy `partsCost` reader path stays.

### 4.4 Source attribution per part line

Each `JobPartLine` carries `source: 'inventory' | 'bought_for_job' | 'special_order'`. Only `inventory` items deduct stock on save. `bought_for_job` and `special_order` capture supplier + cost for the invoice and profit math without touching the catalog.

### 4.5 Pricing engine unchanged

The `labor_parts` engine landed in Phase 2.1 already computes `revenue = laborHours × rate + partsCost + diagnosticFee + travel`. We do not change the math — we just change where `partsCost` comes from (derived sum on new writes; legacy flat number on old reads).

---

## 5. Schema

### 5.1 `InventoryItem` extensions

```ts
export interface InventoryItem {
  // ─── Universal base (every vertical) ───────────────────────────
  id: string;
  qty: number;                              // UI may label as "quantity"; field on disk stays `qty`
  cost: number;                             // legacy aggregate; tire deduction engine reads this
  notes?: string;
  brand?: string;
  condition?: string;                       // option list driven by vertical config

  // ─── Tire-only ─────────────────────────────────────────────────
  size?: string;                            // empty string on mechanic / detailing rows
  model?: string;

  // ─── Mechanic-specific (Phase 2.2) ─────────────────────────────
  partNumber?: string;                      // SKU / manufacturer part #
  partName?: string;                        // human-readable display name
  supplier?: string;                        // vendor name, free-text MVP
  category?: string;                        // vertical-config option list
  subcategory?: string;                     // optional; scoped to selected category
  unitCost?: number;                        // shop cost basis per unit; mirrors `cost` on save
  retailPrice?: number;                     // customer-charged price per unit
  laborHoursDefault?: number;               // suggested labor hours when this part is used
  compatibleVehicles?: ReadonlyArray<string>;  // free-text: "Ford F-150 2018-2024"
  warrantyDays?: number;
  locationBin?: string;                     // shelf / van location: "Van A · Shelf 2"

  // ─── Detailing-specific (Phase 2.1) ────────────────────────────
  chemicalName?: string;
  dilutionRatio?: string;

  _isNew?: boolean;
}
```

**Write rule:** when a mechanic inventory item is saved, the UI populates **both** `cost` (legacy) and `unitCost` with the same number, so the existing tire-shaped deduction engine reads the cost basis without modification. The field name `qty` on disk does not change; the UI may label it "quantity".

**Condition option list** — driven by vertical config (`condition` field's `options` array). Tire uses `['New', 'Used']`. Mechanic uses `['New', 'Used', 'Refurbished', 'Remanufactured']`. Keeps additive migration clean; new options added later require no type change.

**Category / subcategory option list** — config-driven shared lists, **not** per-account. Lives in `mechanic.inventoryFields.find(f => f.key === 'category').options` etc. Seed categories per user direction:

```
['Engine', 'Brakes', 'Suspension', 'Electrical', 'Cooling System',
 'Tires/Wheels', 'Fluids', 'Filters', 'Diagnostics', 'HVAC']
```

Subcategories optional; scoped to category. Per-account custom categories are deferred to a later phase.

### 5.2 `JobPartLine` — new line-item type

```ts
export interface JobPartLine {
  /** Display name. For inventory-bound lines this mirrors
   *  InventoryItem.partName at save time; for unbound lines it's free-text. */
  name: string;
  qty: number;
  /** Per-unit price charged to the customer. */
  unitPrice: number;
  /** Per-unit cost basis. Auto-filled from InventoryItem.unitCost when
   *  bound; entered by the tech (or left 0) for bought_for_job /
   *  special_order. Used by future parts-profitability tracking. */
  unitCost: number;
  /** Where this part came from for this job. Only 'inventory' deducts
   *  stock on save. */
  source: 'inventory' | 'bought_for_job' | 'special_order';
  /** When source === 'inventory', the InventoryItem.id to deduct. */
  inventoryItemId?: string;
  /** Free-text supplier when source is bought_for_job / special_order. */
  supplier?: string;
  /** Carry-through for warranty stamping on the invoice. */
  warrantyDays?: number;
}
```

### 5.3 `Job` widening

Three new optional fields. Old job docs continue to read with all three undefined.

```ts
export interface Job {
  // ... existing fields ...

  /** Structured parts on this job. Sum of (line.qty × line.unitPrice)
   *  is mirrored to `partsCost` on save for legacy reader compat. */
  parts?: ReadonlyArray<JobPartLine>;

  /** Inventory rows actually deducted by this job's save. Same shape
   *  as the existing tire-side `inventoryDeductions` field; populated
   *  exclusively by the mechanic deduction code path. */
  partsInventoryDeductions?: ReadonlyArray<InventoryDeduction>;

  /** Last-recomputed margin snapshot. Optional, populated only when
   *  every line has a non-zero unitCost. Pure derived from `parts`;
   *  stored on save so dashboards don't recompute per render. */
  partsMarginSnapshot?: {
    revenue: number;       // Σ qty × unitPrice
    costBasis: number;     // Σ qty × unitCost
    margin: number;        // revenue - costBasis
  };
}
```

**Why two deduction arrays:** tire's existing `inventoryDeductions` is not overloaded. Mechanic writes `partsInventoryDeductions`. Both arrays share the **existing** `InventoryDeduction` shape `{ id, size, qty, cost }` — mechanic populates `id` with the `InventoryItem.id` to deduct from, leaves `size = ''`, sets `qty = line.qty`, and sets `cost = line.unitCost` (cost basis per unit, not total). No widening of `InventoryDeduction` required this phase. The edit/rollback code iterates the **union** of both arrays so any future hybrid case (a tire shop that also stocks brake pads) works without further changes. Tire's existing edit-job code stays byte-identical.

---

## 6. AddJob UI for mechanic

Mobile-first constraint: enter a row in **3 taps max** for the common case.

### 6.1 Screen layout

Existing AddJob structure preserved. Mechanic-specific fields render via the `DynamicJobField` component (Phase 2.1) driven by `mechanic.jobFields`. New sections layer on:

```
┌─────────────────────────────────────────────┐
│ Customer / Vehicle           (existing block) │
│ Service                      (existing)       │
├─────────────────────────────────────────────┤
│ ▼ Labor                                       │  ← collapsible, expanded by default
│   [laborHours]   ($/hr from settings)         │
│   [☐ diagnostic fee]   (default $89)          │
│   [diagnosticCode]                            │
├─────────────────────────────────────────────┤
│ ▼ Parts                          (3 lines)    │
│   ┌─────────────────────────────────────┐    │
│   │ Brake pad set       1×   $45        │ ⋯  │
│   │ Brake fluid         2×   $12        │ ⋯  │
│   │ + Add part                          │    │
│   └─────────────────────────────────────┘    │
├─────────────────────────────────────────────┤
│ Travel        (existing miles block)          │
│ Notes         (existing)                      │
│                                               │
│ [Live breakdown panel — already vertical-aware]│
└─────────────────────────────────────────────┘
```

### 6.2 Parts row interaction

**"+ Add part"** opens an inline row (not a modal):

```
┌─────────────────────────────────────────────┐
│ [Part name or # _____________]  qty  unit$  │
│ Suggestions:                                  │
│  • Brake pad set     (qty 4 in stock, $45)   │
│  • Brake pad rotor   (qty 0, special order)  │
│  • Brake bleeder     (qty 1, $8)             │
└─────────────────────────────────────────────┘
```

Three behaviors:

1. **Tap a suggestion** → fields auto-fill from `InventoryItem` (`partName`, `retailPrice` → `unitPrice`, `unitCost` ← `unitCost`), `source = 'inventory'`, `inventoryItemId` bound. Tech adjusts `qty`, taps ✓.
2. **Type a name not in catalog, tap ✓** → unbound row. `source = 'bought_for_job'` by default. `unitPrice` editable, `unitCost` defaults to 0.
3. **Long-press / "⋯" menu on a row** → expanded editor: source picker (inventory / bought / special order), supplier free-text, cost basis, warranty days. 90% of jobs the tech never opens this.

### 6.3 Autocomplete behavior

- Matches against `partName`, `partNumber`, `brand` (case-insensitive substring).
- Up to 5 results. **Sort order:** in-stock first, then alphabetical by `partName`. "Most recently used" deferred.
- Stock badge ("4 in stock" / "0 — special order") rendered inline.
- **No live network query.** Inventory is already loaded into context — autocomplete is a pure filter over the in-memory array.

### 6.4 Source picker

| Source | Meaning | Deducts on save? |
|---|---|---|
| `inventory` | Bound to an `InventoryItem.id` in this account's catalog | Yes — `qty -= line.qty` |
| `bought_for_job` | Tech bought it on the way for this specific job | No |
| `special_order` | Ordered from supplier, not yet on hand | No |

**Defaults:** autocomplete-bind path sets `inventory` automatically; typed-name path sets `bought_for_job` automatically. Inventory-linked deductions only happen through explicit selection — never through typed names. Picker is opt-in via the "⋯" menu for the 10% of jobs that need it.

### 6.5 Diagnostic fee + labor + travel

- **Labor:** single `laborHours` number, multiplied by `settings.laborRate` (default from `mechanic.pricingModel.defaultLaborRate`, override in Settings). Single line this phase.
- **Diagnostic fee toggle:** auto-checks on when `diagnosticCode` has any value; tech can override either direction. Stored as `Job.diagnosticFee` (Phase 2.1 field).
- **Travel:** unchanged. Existing miles + `costPerMile` block.

### 6.6 Live breakdown panel

Already vertical-aware from Phase 2.1 — switches on `pricingModel.kind`. Picks up `parts[]` automatically; `partsCost` is the derived sum the engine already reads.

---

## 7. Inventory page (mechanic)

### 7.1 List layout

Mobile-first. Each row tappable to open edit sheet. Grouped by `category`; categories collapsible.

```
┌─────────────────────────────────────────────┐
│ Parts inventory               (42 items)     │
│ ┌─────────────────────────────────────────┐  │
│ │ 🔍 Search part #, name, brand          │  │
│ └─────────────────────────────────────────┘  │
│  Categories ▾  Suppliers ▾  Low stock only ☐ │
├─────────────────────────────────────────────┤
│ ▾ BRAKES (12)                                │
│   ┌─────────────────────────────────────┐    │
│   │ Brake pad set         ABC-1234       │   │
│   │ qty 4 · $45 retail · $28 cost        │   │
│   ├─────────────────────────────────────┤    │
│   │ Brake fluid           DOT-3-1L       │   │
│   │ qty 2 · $12 retail · $7 cost  ⚠ LOW │   │
│   └─────────────────────────────────────┘    │
│ ▾ FILTERS (8)        ...                      │
│ ▸ FLUIDS (10) collapsed                       │
│ ▸ ELECTRICAL (6) collapsed                    │
└─────────────────────────────────────────────┘
│                                  [ + Add part ] │
```

Sticky elements: search bar + "+ Add part" pinned. Category headers collapse to keep long lists scannable.

### 7.2 Search + filter

- **Search:** substring match across `partName`, `partNumber`, `brand`, `supplier`. Pure in-memory filter.
- **Categories** dropdown: options from `mechanic.inventoryFields[].options`.
- **Suppliers** dropdown: distinct `supplier` values present in loaded inventory.
- **Low-stock toggle:** filters to `qty ≤ lowStockThreshold` (default 2). The ⚠ badge fires on the same condition.

### 7.3 Add / edit sheet

Full-screen sheet. Fields render from `mechanic.inventoryFields` config, in declared order. Required fields validated client-side.

| Field | Input type | Required? | Notes |
|---|---|---|---|
| `partName` | text | yes | |
| `partNumber` | text | yes | lower-cased for autocomplete match |
| `brand` | text + chip suggestions | no | from current inventory brands |
| `supplier` | text + chip suggestions | no | same pattern |
| `category` | select (config options) | yes | |
| `subcategory` | select (scoped to category) | no | |
| `qty` | number | yes | |
| `unitCost` | number ($) | yes | mirrors `cost` on save |
| `retailPrice` | number ($) | yes | auto-suggest = `unitCost × settings.partsMarkupDefault` (default 1.5×; per-account override in Settings) |
| `condition` | select | no | default 'New' |
| `laborHoursDefault` | number | no | |
| `warrantyDays` | number | no | |
| `locationBin` | text | no | |
| `compatibleVehicles` | chip input | no | comma-separated → chips |
| `notes` | textarea | no | |

**Markup suggestion** — tech enters cost, retail auto-fills as `cost × settings.partsMarkupDefault` (default 1.5×, overridable per-account in Settings), tech accepts or adjusts. Stored value is the final field value; no derived recomputation.

### 7.4 Low-stock indicator

Phase 2.2 ships **visual badge only** — `⚠ LOW` next to rows with `qty ≤ lowStockThreshold`. No notifications, no dashboard card, no reorder workflow. Threshold is a per-account setting (default 2) editable in Settings. Schema supports future alert dispatch without further migration.

### 7.5 Deferred from this surface

- Bulk import / CSV upload
- Supplier-API integration (NAPA / O'Reilly / Worldpac)
- Reorder POs / vendor purchase tracking
- Stock-take / cycle-count workflow
- Multi-location / multi-van inventory
- Per-account custom category lists
- Parts profitability dashboard card (data captured via `partsMarginSnapshot`; consuming card is a follow-up)

---

## 8. Save / deduction semantics

### 8.1 Save (new job)

When the tech taps **Save Job**, the writer performs in **one atomic Firestore `writeBatch`**:

```
batch.set(jobs/{newId}, {
  ...jobFields,
  parts: lines,
  partsCost: Σ (line.qty × line.unitPrice),
  partsInventoryDeductions: [...],
  partsMarginSnapshot: { revenue, costBasis, margin }  // only if every line has unitCost > 0
})

for each line where source === 'inventory':
  batch.update(inventory/{line.inventoryItemId}, {
    qty: FieldValue.increment(-line.qty)
  })

batch.commit()
```

**Atomicity:** if any update fails the entire batch rejects. Same pattern tire uses today.

**Concurrency:** `writeBatch`, not `runTransaction`. Single-operator mechanic shops (the MVP target) have no concurrent writes. Multi-tech is Sub-Project B; we upgrade to transactions there if real races materialize. Last-write-wins is acceptable this phase.

`partsInventoryDeductions[]` records what was deducted with quantities; any future audit/refund flow has the data it needs.

### 8.2 Edit (existing job, parts changed)

Diffs new lines against persisted lines on the Job doc:

```
For each line in newLines where source === 'inventory':
  oldLine = oldLines.find(l => l.inventoryItemId === line.inventoryItemId)
  delta = line.qty - (oldLine?.qty ?? 0)
  // delta > 0 → deduct; delta < 0 → refund; delta === 0 → no-op

For each line in oldLines where source === 'inventory':
  if no matching newLine.inventoryItemId:
    delta = -oldLine.qty  // refund all
```

Single `writeBatch` with one `FieldValue.increment(delta)` per inventory item + updated Job doc. `partsInventoryDeductions` is overwritten with the new snapshot.

**Source change edge case:** if a line was `source: 'inventory'` and becomes `'bought_for_job'`, the diff treats it as "old removed + new added (no deduction)". Refund + no new deduction happens correctly because the new line has no `inventoryItemId`.

### 8.3 Delete / cancel

```
batch.delete(jobs/{id})  // or update lifecycleStage = 'canceled'
for each entry in job.partsInventoryDeductions:
  batch.update(inventory/{entry.id}, {
    qty: FieldValue.increment(+entry.qty)
  })
batch.commit()
```

**Cancel vs delete:** transitioning a job to `lifecycleStage: 'canceled'` (Sub-Project C UI) runs the same refund. Job doc stays for audit; `partsInventoryDeductions` is cleared post-refund so re-open doesn't double-refund.

### 8.4 Derived fields recomputed every save

| Field | Formula |
|---|---|
| `partsCost` | `Σ (line.qty × line.unitPrice)` — customer-charged total |
| `partsMarginSnapshot.revenue` | same as `partsCost` |
| `partsMarginSnapshot.costBasis` | `Σ (line.qty × line.unitCost)` |
| `partsMarginSnapshot.margin` | `revenue − costBasis` |
| `partsInventoryDeductions[]` | one entry per `source: 'inventory'` line using the existing `InventoryDeduction` shape: `{ id: line.inventoryItemId, size: '', qty: line.qty, cost: line.unitCost }` |

`partsMarginSnapshot` is **only** written when every line has `unitCost > 0`. A single zero-cost line invalidates the snapshot for the whole job — a misleading number is worse than no number.

**Dashboard consumption rule.** Phase 2.1 declared a `parts_margin` `DashboardMetricSpec` on `MECHANIC_CONFIG`. Under this spec it reads `Job.partsMarginSnapshot.margin` per job (summed across the metric's time window). Jobs without a snapshot (legacy mechanic jobs from Phase 2.1, or any job with a zero-cost line) are **excluded from the sum** rather than imputed at zero — the metric label gains an inline disclosure "(based on N of M jobs)" when exclusions occur. This is the exact contract §11.5's manual smoke check verifies.

### 8.5 Soft warning on over-deduction

If a line's `qty > inventoryItem.qty`, the save flow surfaces a lightweight confirmation modal **only at save-time** (never while typing):

> "Only X in stock — deduct anyway?" — [OK] [Cancel]

- **OK** → proceed with deduction (qty may go negative)
- **Cancel** → return to the row

Single-tap confirmation, no nested dialogs, no full-screen modal, no workflow interruption after confirm. Hard stock enforcement deferred to Sub-Project B.

### 8.6 Backward compat preserved

Tire's existing save path untouched. Mechanic deduction lives in a new helper `src/lib/mechanicJob.ts` called by `saveJob.ts` when `vertical.key === 'mechanic'`. Tire writes `inventoryDeductions[]`; mechanic writes `partsInventoryDeductions[]`. Both arrays coexist on a Job (one is empty per job), and edit/delete diff iterates the union.

### 8.7 Not enforced this phase

- No negative-stock prevention (soft warning only)
- No version checks; last-write-wins on concurrent edits
- No subcollection audit log (the lifecycle `transitions[]` foundation handles lifecycle audit; inventory-edit audit is a separate Phase 2.x discussion)

---

## 9. Invoice template (mechanic)

### 9.1 Contract

Existing `InvoiceTemplate.buildLineItems(job, settings, vertical): LineItem[]` (Phase 2.1) — mechanic's implementation consumes `job.parts[]` and falls back to legacy `partsCost` for old docs.

```ts
interface LineItem {
  label: string;
  detail?: string;
  amount: number;
  group?: 'labor' | 'parts' | 'fees' | 'travel';
}
```

### 9.2 Line items emitted (in order)

```
┌──────────────────────────────────────────────────────────────┐
│ LABOR                                                          │
│   Labor                  3.0 hrs × $95/hr           $285.00   │
│                                                                │
│ PARTS                                                          │
│   Brake pad set          1 × $45.00                  $45.00   │
│   Brake fluid (DOT 3)    2 × $12.00                  $24.00   │
│   Spark plugs            4 × $8.00      (90d warranty) $32.00 │
│                                                                │
│ FEES                                                           │
│   Diagnostic fee                                     $89.00   │
│                                                                │
│ TRAVEL                                                         │
│   Travel                 12 mi @ $0.65/mi             $7.80   │
│                                                                │
│ ─────────────────────────────────────────────────────────────  │
│   Subtotal                                          $482.80   │
│   Tax (8.25%)                                        $39.83   │
│   TOTAL                                             $522.63   │
└──────────────────────────────────────────────────────────────┘
```

All amounts are customer-facing prices; margin stays internal.

### 9.3 Rules per line type

**Labor:** emitted when `job.laborHours > 0`. Label `"Labor"`. Detail `"{laborHours} hrs × ${laborRate}/hr"`. Amount `laborHours × settings.laborRate`. Single line; multi-line labor deferred.

**Parts:**
- If `job.parts?.length > 0`: one line per `JobPartLine`. Label `line.name`. Detail `"{qty} × ${unitPrice}"`, with `" ({warrantyDays}d warranty)"` appended when `line.warrantyDays` is set. Amount `line.qty × line.unitPrice`. Sort order matches AddJob entry order.
- If `job.parts` undefined/empty AND `job.partsCost > 0` (legacy mechanic doc): single aggregate line `"Parts"`, amount `partsCost`.

**Diagnostic fee:** emitted when `job.diagnosticFee > 0`. Label `"Diagnostic fee"`. Amount `job.diagnosticFee`.

**Travel:** existing computation unchanged. Suppressed when chargeable miles ≤ 0.

**Subtotal / tax / total:** existing template renderer. Tax is flat `settings.invoiceTaxRate` applied to subtotal — no labor/parts split this phase. `LineItem.group` preserved so future `taxOnLaborPct` / `taxOnPartsPct` can derive without restructuring lines.

### 9.4 Warranty surface

Two complementary places, no separate warranty schedule table:

1. **Inline per-part annotation** — only when `JobPartLine.warrantyDays` is set
2. **Optional footer note** from `settings.warrantyPolicy` (free-text, defaults to empty) — e.g. *"All parts carry manufacturer warranty unless noted. Labor warranty: 30 days."*

Structured `warrantyDays` on `JobPartLine` is captured cleanly so a future warranty-claim flow has the info. No claim tracking, no expiration notifications this phase.

### 9.5 Not emitted by template this phase

- Customer-facing margin / cost disclosure
- Payment-history line (separate from invoice; lands when payment-status writers ship)
- Discount / coupon line (no schema field)
- Estimate-vs-final delta line (captured via lifecycle later)
- Multi-vehicle invoicing on one job
- PDF layout change — existing PDF generator renders the same `LineItem[]` shape

### 9.6 PDF rendering & sharing

Untouched. Existing PDF generator + share/email/SMS flow accepts whatever the template emits.

---

## 10. Backward compatibility & migration

### 10.1 Existing tire accounts

**Zero impact.** Tire read paths, write paths, save flow, inventory deduction, invoice rendering are byte-identical. All added fields are optional and never written by the tire code path. `deserializeJob` returns `parts: undefined` for any doc lacking the field. `Inventory.tsx` continues to render `TireInventoryView`.

### 10.2 Existing mechanic accounts from Phase 2.1

If any production mechanic accounts exist on Phase 2.1's thin stub, their jobs have `laborHours`, `partsCost` (flat), `diagnosticFee`, no `parts[]`, no `partsInventoryDeductions`, no `partsMarginSnapshot`.

**Read path:** `deserializeJob` returns `parts: undefined`. Mechanic invoice template's parts builder checks `if (job.parts?.length > 0)` and falls back to legacy `partsCost` aggregate line. Dashboard parts-revenue + AddJob edit read `partsCost` when `parts` is undefined.

**Write path:** the next save through the new mechanic AddJob flow populates `parts[]` AND mirrors `partsCost`. No backfill script — organic upgrade on next edit.

**Inventory backfill:** none. Mechanic accounts that lack inventory simply have an empty catalog.

### 10.3 The `partsCost` dual-write invariant

> Every save that writes `parts[]` MUST also write `partsCost = Σ (line.qty × line.unitPrice)`.
> No code reads `partsCost` and writes back to it — `partsCost` is a derived mirror for legacy readers.

Encoded:

```ts
// src/lib/mechanicJob.ts
export function deriveLegacyPartsCost(parts: ReadonlyArray<JobPartLine>): number {
  return r2(parts.reduce((s, l) => s + l.qty * l.unitPrice, 0));
}
```

Single source of truth. Mechanic save calls this once; Dashboard / Reports / Invoice readers can rely on `partsCost` being consistent with `parts[]` for any Phase 2.2+ write.

### 10.4 Type widening order

Schema changes land in dependency order so each commit type-checks against `main` independently:

1. `InventoryItem` widens with new optional mechanic fields. No consumer changes.
2. `JobPartLine` interface lands in `src/types/index.ts`. No consumer references yet.
3. `Job` widens with `parts?`, `partsInventoryDeductions?`, `partsMarginSnapshot?`. No consumer references yet.
4. Mechanic save helper lands. `saveJob` orchestrator branches to it when `vertical.key === 'mechanic'`.
5. `MechanicInventoryView` lands. `Inventory.tsx` dispatcher branches to it.
6. Mechanic invoice template's parts builder updates to consume `parts[]` with legacy fallback.
7. AddJob's mechanic-vertical block renders the new parts UI.

Each step is a separate commit; rollback at any step leaves the prior step's surface fully functional.

### 10.5 No data migration scripts

Nothing on Firestore needs rewriting. No batch update job, no flag day, no maintenance window. Additive widening + write-on-touch upgrade — same pattern Phase 2.1 used.

### 10.6 Firestore rules

**No rule changes required.** Additive fields; no new collection or access pattern. Multi-tech permission gates land in Sub-Project B.

### 10.7 Rollback path

Each commit in §10.4 is rollback-able independently:

1. `git revert <commit>`
2. `git push`
3. Prior step's surface is fully functional (additive widening means no data depends on the new code)
4. Re-deploy

`partsInventoryDeductions[]` records every deduction made; even if a buggy mechanic save shipped, a rollback + a one-off refund script driven by the recorded deductions can undo any over-deduction. Same safety net that protected Phase 2.1's tire deductions.

---

## 11. Testing strategy

### 11.1 Automated test files (pure helpers)

All ship in `tests/` (excluded from `tsc`), executable via `npx tsx tests/<file>.test.ts`.

| File | What it covers | Key invariants |
|---|---|---|
| `tests/mechanicJobDerivation.test.ts` | `deriveLegacyPartsCost`, `derivePartsMarginSnapshot` | `partsCost = Σ qty × unitPrice` round-trip; margin snapshot suppressed when any `unitCost === 0`; r2 rounding determinism |
| `tests/mechanicDeductionDiff.test.ts` | `diffPartsForDeduction(oldParts, newParts)` | Add-line deducts; remove-line refunds; qty-change adjusts delta; source change inventory→bought_for_job refunds + adds nothing; reverse direction adds deduction only; identical inputs → empty diff |
| `tests/mechanicDeductionRollback.test.ts` | `rollbackPartsDeductions(job)` for delete + cancel paths | Every `partsInventoryDeductions[]` entry produces positive `increment(qty)`; clearing the array post-refund is idempotent |
| `tests/softStockWarning.test.ts` | `shouldWarnOnDeduction(line, inventoryItem)` | True when `line.qty > inventoryItem.qty`; false at exact-equal; false for non-inventory sources; false when item not found |
| `tests/mechanicInvoiceLineItems.test.ts` | `buildMechanicLineItems(job, settings)` | Itemized parts when `parts[].length > 0`; legacy aggregate line when undefined and `partsCost > 0`; labor line omitted when `laborHours === 0`; diagnostic-fee gated on `> 0`; warranty annotation only when `warrantyDays` set |

Each file 30-50 assertions, modeled on `tests/jobLifecycle.test.ts`. All run in <1 second collectively.

### 11.2 Pure-function tests cover the riskiest correctness paths

Derivation rules (sums, diffs, rollbacks) and invoice rendering (line composition) are pure functions over plain data — no Firestore, React, or browser needed to exercise. Firestore `writeBatch` is thin glue around the diff helper's output; correct diff ⇒ correct batch. Integration is manual smoke (same precedent as Phase 2.1, which surfaced zero correctness issues — only the bundle-cycle that the lifecycle foundation work shipped a fix for).

### 11.3 Manual smoke checkpoints between commits

| After step | Smoke check (≤ 2 min) | Pass criteria |
|---|---|---|
| 1 – `InventoryItem` widening | `npm run build` | TS clean, no consumer touched |
| 2 – `JobPartLine` added | `npm run build` + `npx tsx tests/mechanicJobDerivation.test.ts` | Build clean, derivation passes |
| 3 – `Job` widening | `npm run build` | Build clean |
| 4 – Mechanic save helper | `tests/mechanicDeductionDiff.test.ts` + `tests/mechanicDeductionRollback.test.ts` | All pass |
| 5 – `MechanicInventoryView` | Dev: switch to mechanic vertical; CRUD a part; switch back to tire | Mechanic page renders; tire unaffected |
| 6 – Mechanic invoice update | `tests/mechanicInvoiceLineItems.test.ts`; generate one mechanic invoice in dev | Line items match expected; legacy fallback works |
| 7 – AddJob mechanic UI | End-to-end: add bound part via autocomplete, add unbound part, save, verify inventory `qty` decremented for bound only | Soft-warn fires when needed; deduction correct; tire AddJob untouched |

### 11.4 Pre-tag production smoke checklist (before phase-2.2-stable tag)

After all sub-project A commits land on `origin/main` and deploy completes, run on `app.mobileserviceos.app`:

**Tire account regression — must be identical to phase-2.1-stable:**
- [ ] Dashboard loads, weekly KPIs render
- [ ] AddJob tire: all fields render, inventory deduction works, save succeeds
- [ ] Inventory: tire list renders, edit-tire works
- [ ] Invoice: existing tire invoice renders unchanged
- [ ] Settings: all 10 sections render

**Mechanic account flow:**
- [ ] Switch to a mechanic vertical account
- [ ] Inventory page renders `MechanicInventoryView`; category groups collapse
- [ ] Add a part; edit it; soft-delete
- [ ] Search returns expected matches; low-stock badge at `qty ≤ 2`
- [ ] AddJob: parts autocomplete returns inventory items; tap-to-bind pre-fills retail; unbound type-in defaults to `bought_for_job`
- [ ] Save mechanic job; verify inventory `qty` decremented only for bound parts
- [ ] Edit the job: change a part's qty, save, verify delta
- [ ] Soft-warn fires when entering qty greater than stock
- [ ] Mechanic invoice renders with itemized parts + aggregate labor
- [ ] Diagnostic-fee toggle reflects on invoice
- [ ] Legacy mechanic job (no `parts[]`) invoices via aggregate fallback

**Cross-cutting:**
- [ ] No console errors on any of the above
- [ ] Service worker NOT active in dev (existing protection)
- [ ] Bundle-size delta ≤ +10kB gzipped on the index chunk

### 11.5 Pre-implementation visual review checkpoints (per user direction)

Before implementation starts:

- [ ] Mechanic invoice rendered example reviewed visually for parts/labor readability on phone-width viewport
- [ ] AddJob mechanic parts row reviewed visually on phone-width viewport
- [ ] Dashboard profit math matches per-job `partsMarginSnapshot` totals exactly (test via running both calculations on the same job set)

These are validation checkpoints during implementation, not gating items for spec sign-off — captured here so the plan's manual smoke steps reference them.

### 11.6 What's NOT tested automatically

- No Cypress / Playwright E2E (Phase 2.1 precedent)
- No mocked Firestore writeBatch tests — batch is thin shell
- No visual regression / snapshot on invoice PDF — manual review
- No load / perf testing — in-memory inventory acceptable per user direction

---

## 12. Performance posture

Per user direction:

- In-memory inventory loading is acceptable indefinitely until real account scale justifies otherwise.
- No pagination, no virtualization, no chunked loads this phase.
- Autocomplete is a pure filter over the loaded array — O(n) per keystroke is fine for n < ~5000 parts.
- Future perf optimizations are an entirely separate phase, gated on real-account telemetry.

---

## 13. Glossary

- **Sub-Project A** — Mechanic Operations. The scope of this spec.
- **JobPartLine** — Structured part entry on a Job. Replaces the prior single-number `partsCost` for new writes.
- **Source attribution** — Per-part marker (`inventory` / `bought_for_job` / `special_order`) deciding inventory consumption behavior.
- **Soft warning** — Save-time confirmation when `line.qty > inventoryItem.qty`. Override is single-tap.
- **Margin snapshot** — Per-job `{ revenue, costBasis, margin }` computed only when every line has `unitCost > 0`.
- **Dual-write invariant** — Every new mechanic save writes both `parts[]` and the derived `partsCost`. Legacy readers continue to work.
- **Vertical config option list** — `BusinessTypeConfig.inventoryFields[].options` (or `jobFields[].options`) — config-driven enum values shared across all accounts of that vertical.

---

## 14. Open items for the implementation plan

The `writing-plans` skill consumes this spec next. Specific things the plan must capture that the spec hasn't fully nailed down:

1. **`saveJob.ts` orchestrator branch.** Plan must specify exact branching: where in `saveJob.ts` the mechanic branch lives, what data shape it accepts, how it composes the `writeBatch`.
2. **`deriveMechanicJobMargin` helper.** Pure function signature + return shape + null/zero handling.
3. **`MechanicInventoryView` file location and sibling tests.** Match the existing component-organization convention.
4. **Autocomplete component reuse.** Determine if any existing component (e.g. tire-size autocomplete) can be parameterized for parts, or if a new shared component is warranted.
5. **Settings UI additions.** `laborRate`, `lowStockThreshold`, `warrantyPolicy` — each needs a Settings section entry.
6. **Markup default value.** The 1.5× cost-to-retail markup is a magic number; the plan must surface this as a `settings.partsMarkupDefault` field (with 1.5 as the default) so operators can tune it.
7. **Granular commit decomposition.** Plan must produce 7+ separate commits matching the §10.4 widening order.
