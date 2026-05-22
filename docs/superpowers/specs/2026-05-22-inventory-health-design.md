# Inventory Health — Design

> **Phase 2** of the inventory upgrade (per the chained roadmap).
> Categorize each tire-vertical InventoryItem into one of four
> health buckets and surface them as a filterable chip row above
> the existing list. NO new InventoryItem fields. NO Firestore
> changes. NO AI calls. Subsequent phases add swipe / reserved /
> supplier (Phase 3) and AI insights (Phase 4).

## Goal

Replace the single "Low Stock" indicator with four operationally
distinct buckets — **Critical** (out of stock), **Low** (≤1 in
stock), **Healthy** (in stock and moving), **Dead** (in stock but
not used in 90 days). Each bucket renders as a chip with a live
count; tapping a chip filters the list to that bucket.

## Hard constraints

- Touches **only** `src/lib/inventoryHealth.ts` (new), its test,
  `src/pages/Inventory.tsx` (tire view), and `src/App.tsx` (one
  prop addition).
- No `InventoryItem` field changes.
- No new persistence — buckets are derived live from `jobs` +
  `inventory` + today.
- Mechanic + detailing inventory views unchanged.
- The existing search, condition chip row, smart-filter chip row
  (Phase 1), Hot Sizes, expand-to-edit, qty ± cluster, Save
  Inventory button, and KPI row are all preserved.

## Categorization rules

For each item, in this priority order:

| Bucket | Rule |
|---|---|
| **Critical** | `qty === 0` |
| **Low** | `qty > 0 && qty <= 1` |
| **Dead** | `qty > 1` AND no matching-size job within the last `deadDays` days |
| **Healthy** | `qty > 1` AND at least one matching-size job within `deadDays` |

`deadDays` defaults to **90**. "Matching-size job" means any `Job`
(any status) where `normalizeTireSize(Job.tireSize) ===
normalizeTireSize(item.size)` AND `Job.date >= today − deadDays`.
An item with no `size` skips the dead/healthy check and falls
into Healthy by default if `qty > 1` (the dead check needs a size
to match against).

`normalizeTireSize` is the existing helper in `@/lib/utils`.

## `src/lib/inventoryHealth.ts`

```ts
export type InventoryHealthBucket = 'critical' | 'low' | 'healthy' | 'dead';

export const HEALTH_BUCKETS: InventoryHealthBucket[] = [
  'critical', 'low', 'healthy', 'dead',
];

export interface InventoryHealthOpts {
  deadDays?: number;             // default 90
}

export function categorizeInventoryHealth(
  item: InventoryItem,
  jobs: ReadonlyArray<Job>,
  today: string,
  opts?: InventoryHealthOpts,
): InventoryHealthBucket;

export function inventoryHealthCounts(
  items: ReadonlyArray<InventoryItem>,
  jobs: ReadonlyArray<Job>,
  today: string,
  opts?: InventoryHealthOpts,
): Record<InventoryHealthBucket, number>;
```

Pure, no I/O, no React. The function builds a `Set<string>` of
normalized recently-sold sizes once per call, then categorizes
each item in O(1). `inventoryHealthCounts` runs `categorize…` over
the list and tallies.

## Inventory page integration

- `Inventory` accepts a new `jobs: Job[]` prop; passes it down to
  `TireInventoryView`.
- `App.tsx` threads `jobs={jobs}` into `<Inventory />` (one line).
- `TireInventoryView` computes counts via a memo
  `(list, jobs, today) → { critical, low, healthy, dead }` and
  per-item buckets via a memo
  `(list, jobs, today) → Map<id, bucket>` so the renderer can
  ask "what bucket is this item?" without recomputing.
- A new chip row labeled **Health** renders **above** the existing
  condition chip row (Phase 1's smart chips stay where they are —
  below condition):
  ```
  Health:  All · Critical (3) · Low (5) · Healthy (12) · Dead (2)
  ```
  Single-select. Counts in parens render dimmer when 0; 0-count
  chips stay tappable but are visually de-emphasized.
- When a health chip other than `All` is active, the filter
  pipeline narrows the list to only items in that bucket (applied
  **before** the existing condition + smart-chip + search steps).
- The existing 3-KPI row (SKUs / Total Qty / Low Stock) stays
  exactly as today — the new chip row is the operational surface;
  the KPI row stays a fast at-a-glance summary.

## Files

- Create `src/lib/inventoryHealth.ts` — pure helper.
- Create `tests/inventoryHealth.test.ts` — logic tests.
- Modify `src/pages/Inventory.tsx` — `Inventory` `Props` adds
  `jobs`; `TireInventoryView` adds `jobs` prop, the count + bucket
  memos, the chip row, and the filter step.
- Modify `src/App.tsx` — pass `jobs={jobs}` to `<Inventory />`.

No CSS changes — the chip row reuses the existing `.chip` /
`.chip.sm` / `.active` token vocabulary.

## Testing

`tests/inventoryHealth.test.ts` (hand-rolled `tsx` runner):

- `qty 0` → 'critical' regardless of jobs / size
- `qty 1` → 'low'
- `qty 2` + matching-size job within 90 days → 'healthy'
- `qty 2` + matching-size job exactly at the boundary (90 days
  old) → 'healthy'
- `qty 2` + matching-size job 91 days old → 'dead'
- `qty 2` + matching-size job but tire size mismatched → 'dead'
- `qty 2` + no matching jobs at all → 'dead'
- `qty 2` + no size → 'healthy' (dead check skipped without a
  size)
- size normalization works ("225/65R17" vs "225 65 R 17")
- custom `deadDays: 30` flips a 60-day-old job from healthy → dead
- `inventoryHealthCounts` tallies correctly across a mixed list

## Edge cases

- **No jobs at all** — every item with `qty > 1` and a size is
  'dead'.
- **No `today` string** — caller passes `TODAY()` from
  `@/lib/defaults` (same pattern as Insights).
- **Job with empty `tireSize`** — does not match anything; the
  job is invisible to the dead check, which is correct.
- **Mechanic / detailing item** — handled by other code paths;
  this helper still answers when called but mechanic inventory
  doesn't render this row (mechanic uses its own view).

## Out of scope (later phases)

- **Phase 3** — swipe actions, reserved inventory data model,
  supplier / purchase-source tracking, inventory-to-job matching
  improvements.
- **Phase 4** — AI inventory insights.
- **Performance** (#11) — virtualized list. Deferred until the
  real "thousands of SKUs" perf problem materializes; YAGNI.
