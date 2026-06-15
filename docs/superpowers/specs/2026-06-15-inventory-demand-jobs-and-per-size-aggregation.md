# Inventory demand = jobs · on-hand = per-size aggregate

**Date:** 2026-06-15
**Touches:** `src/lib/bestSellingTires.ts`, `src/lib/inventoryIntel.ts`,
`src/pages/Inventory.tsx`, `src/components/insights/BestSellersCard.tsx`,
`src/components/inventory/InventoryIntelPanel.tsx`

## Problem

Two related bugs, one root cause — demand was measured in **tire units**
and inventory was keyed **per line item**:

1. **Unit ranking misranks demand.** A single job that sells a set of 4
   inflated the count 4× versus a single-tire job, even though both are
   **one demand event**. This over-weighted set-buys in both the Best
   Seller list and the Reorder Now engine.
2. **Per-entry on-hand.** Inventory can hold several line items for one
   size (true duplicates, or a New + Used split). On-hand/reorder read a
   single entry, so a size could show "0 on hand" while stock existed in a
   sibling line.

## Decisions

### 1. Demand is measured in JOBS, not tire units
- **One job = one demand event**, regardless of how many tires it moved.
- Best Seller defaults to a **"Jobs"** sort; `Sold` (units), `Size`, `$`
  remain. Tie-break on jobs: **out-of-stock first → revenue → units**.
- Reorder Now / fast-movers rank by jobs; dead-stock = a size in stock
  with **zero** demand events.
- Tire-unit counts stay **visible** everywhere ("N sold") — only the
  sort/priority changed.
- Canonical helper: `computeSizeDemand(jobs, { windowDays })` → per-size
  `{ jobs, units, revenue }`, computed **per window** (Week / 30 / 90 /
  All), Completed jobs only.

### 2. On-hand is aggregated PER SIZE, at read time
- **Aggregate at read time (group-by size); do NOT merge or delete user
  records.** Safer than a destructive merge and reversible.
- The Reorder Now engine, the out/low stock flags, the "Low Stock" KPI,
  and the reorder list's "on hand" all read the **summed per-size total**.
- Per-card big number stays the **line-item** qty (so New vs Used line
  items remain truthful), but a card's **out/low status** reflects the
  per-size total — a line is only flagged "out" when the whole size is
  depleted. (Operators can still collapse true same-condition duplicates
  with the existing "Merge duplicates" button.)

### Size-key normalization
Grouping uses `sizeKey()` (in `inventoryIntel.ts`), which collapses
formatting variants — `205/55R16`, `205/55/16`, `205-55-16`, `205 55 16`,
`205/55ZR16` all map to one key — by uppercasing, stripping
non-alphanumerics, and dropping the section letter between aspect and rim.
This is deliberately more aggressive than `utils.normalizeTireSize` (which
keeps the `R` and so failed to unify slash-vs-R variants — the duplicate
bug). The Best Seller card keys by `extractTireSize` (canonical display
form), which also unifies these variants.

### 3. One-time consolidation migration (durable cleanup)
Read-time aggregation fixes on-hand for *display*; this aligns the
*stored* data. `consolidateInventoryBySize()`
(`src/lib/inventoryConsolidate.ts`) collapses duplicate entries to **one
row per size**, grouped by `sizeKey` (so New + Used and formatting variants
fold together). It is:
- **Non-destructive** — quantities and reservations are SUMMED into one
  surviving record; the survivor keeps its descriptors (brand / model /
  cost / condition / notes), falling back to a folded entry only where its
  own field is blank. No qty is ever dropped.
- **Atomic** — inventory persists as a single array document, so the
  combined totals are written in one `onSave` before the extra rows cease
  to exist; there is no partial state that could lose qty.
- **Idempotent** — re-running on consolidated data is a no-op
  (`mergedCount === 0`), so the Inventory **Consolidate** button is safe to
  tap repeatedly.

Note this supersedes the earlier New-vs-Used-stay-separate behavior: the
operator-triggered consolidation now merges a size's conditions into one
row (the survivor's condition is kept). On-hand was already counted
per-size at read time, so this only changes the stored shape, not the
numbers.

## Tests
`tests/inventoryIntel.test.ts` and `tests/bestSellingTires.test.ts` cover:
job-count vs unit ranking divergence (set-of-4 vs single), per-size on-hand
aggregation across duplicate entries, size-key normalization, per-window
job counts, dead-stock exclusion, and the out-of-stock tie-break.

`tests/inventoryConsolidate.spec.ts` and `tests/inventoryAcceptance.spec.ts`
(vitest, fixtures in `tests/fixtures/inventoryExport.ts`) validate the
migration (aggregation, idempotency, normalization, blank-row passthrough,
reservation/field preservation) and the spec's named export values:
235/40R18 → 2, 225/55R18 → 4, 205/55R16 → 2; exactly 18 duplicate sizes;
Reorder Now top = 235/45R18 (8 jobs) → 205/55R16 (7) → 205/65R16 (6) with
the out-of-stock 205/65R16 surfacing; set-buys ranked by jobs not units.
