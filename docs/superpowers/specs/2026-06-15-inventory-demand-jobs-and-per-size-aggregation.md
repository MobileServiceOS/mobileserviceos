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

## Tests
`tests/inventoryIntel.test.ts` and `tests/bestSellingTires.test.ts` cover:
job-count vs unit ranking divergence (set-of-4 vs single), per-size on-hand
aggregation across duplicate entries, size-key normalization, per-window
job counts, dead-stock exclusion, and the out-of-stock tie-break.
