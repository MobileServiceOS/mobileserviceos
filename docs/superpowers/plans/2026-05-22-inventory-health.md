# Inventory Health Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Categorize each tire-vertical InventoryItem into one of four health buckets (Critical / Low / Healthy / Dead) and surface them as a single-select chip row above the existing filter rows. Dead = qty > 1 and no matching-size job within 90 days.

**Architecture:** A pure `src/lib/inventoryHealth.ts` module categorizes items against the `jobs` list and `today`. `Inventory.tsx` accepts a `jobs` prop, memos the per-item bucket + tally, and renders the chip row. The filter pipeline gets one additional step (health-bucket filter) that runs before the existing condition / smart-chip / search steps.

**Tech Stack:** TypeScript, React 18; hand-rolled `tsx` test runner.

> Spec: `docs/superpowers/specs/2026-05-22-inventory-health-design.md`

---

## File Structure

- **Create `src/lib/inventoryHealth.ts`** — `InventoryHealthBucket` type, `HEALTH_BUCKETS` array, `categorizeInventoryHealth()`, `inventoryHealthCounts()`. Pure, no I/O.
- **Create `tests/inventoryHealth.test.ts`** — hand-rolled `check()` runner.
- **Modify `src/pages/Inventory.tsx`** — `Inventory` Props adds `jobs`; `TireInventoryView` gets `jobs` prop, the count + bucket memos, the chip row, and the filter step.
- **Modify `src/App.tsx`** — pass `jobs={jobs}` to the `<Inventory />` element (one-line change).

Notes for the engineer:
- `Job` has `tireSize: string` and `date: string` (YYYY-MM-DD).
- `normalizeTireSize` lives in `@/lib/utils`; use it for size comparison.
- `TODAY()` lives in `@/lib/defaults`; pass it as `today` from `Inventory.tsx`.

---

## Task 1: `src/lib/inventoryHealth.ts` + tests

**Files:**
- Create: `src/lib/inventoryHealth.ts`
- Test: `tests/inventoryHealth.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/inventoryHealth.test.ts`:

```ts
// tests/inventoryHealth.test.ts
// Run: npx tsx tests/inventoryHealth.test.ts

import {
  categorizeInventoryHealth, inventoryHealthCounts, HEALTH_BUCKETS,
} from '@/lib/inventoryHealth';
import type { InventoryItem, Job } from '@/types';

let passed = 0;
let failed = 0;
const check = (label: string, cond: boolean): void => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}`); }
};

const TODAY = '2026-05-22';

const item = (over: Partial<InventoryItem>): InventoryItem => ({
  id: 'x', size: '225/65R17', qty: 0, cost: 0, ...over,
});
const job = (over: Partial<Job>): Job => ({
  id: 'j', date: TODAY, tireSize: '225/65R17',
} as Job & typeof over);

console.log('\n┌─ HEALTH_BUCKETS ───────────────────────────────────');
check('HEALTH_BUCKETS lists the four bucket keys in documented order',
  JSON.stringify(HEALTH_BUCKETS) ===
  JSON.stringify(['critical', 'low', 'healthy', 'dead']));

console.log('\n┌─ categorizeInventoryHealth ────────────────────────');
check('qty 0 → critical',
  categorizeInventoryHealth(item({ qty: 0 }), [], TODAY) === 'critical');
check('qty 1 → low',
  categorizeInventoryHealth(item({ qty: 1 }), [], TODAY) === 'low');
check('qty 2 + same-size job today → healthy',
  categorizeInventoryHealth(item({ qty: 2 }), [job({ date: TODAY })], TODAY) === 'healthy');
check('qty 2 + same-size job exactly 90 days old → healthy (boundary)',
  categorizeInventoryHealth(item({ qty: 2 }), [job({ date: '2026-02-21' })], TODAY) === 'healthy');
check('qty 2 + same-size job 91 days old → dead',
  categorizeInventoryHealth(item({ qty: 2 }), [job({ date: '2026-02-20' })], TODAY) === 'dead');
check('qty 2 + only mismatched-size jobs → dead',
  categorizeInventoryHealth(
    item({ qty: 2, size: '245/40R18' }),
    [job({ date: TODAY, tireSize: '225/65R17' })],
    TODAY,
  ) === 'dead');
check('qty 2 + no jobs at all → dead',
  categorizeInventoryHealth(item({ qty: 2 }), [], TODAY) === 'dead');
check('qty 2 + no size → healthy (no dead check without a size to match)',
  categorizeInventoryHealth(item({ qty: 2, size: '' }), [], TODAY) === 'healthy');
check('size normalization: "225 65 R 17" matches "225/65R17"',
  categorizeInventoryHealth(
    item({ qty: 2, size: '225/65R17' }),
    [job({ date: TODAY, tireSize: '225 65 R 17' })],
    TODAY,
  ) === 'healthy');
check('custom deadDays: 30 → 60-day-old job is dead',
  categorizeInventoryHealth(
    item({ qty: 2 }),
    [job({ date: '2026-03-23' })],
    TODAY,
    { deadDays: 30 },
  ) === 'dead');
check('custom deadDays: 365 → 200-day-old job is healthy',
  categorizeInventoryHealth(
    item({ qty: 2 }),
    [job({ date: '2025-11-03' })],
    TODAY,
    { deadDays: 365 },
  ) === 'healthy');

console.log('\n┌─ inventoryHealthCounts ────────────────────────────');
{
  const items: InventoryItem[] = [
    item({ id: 'a', qty: 0 }),                     // critical
    item({ id: 'b', qty: 0 }),                     // critical
    item({ id: 'c', qty: 1 }),                     // low
    item({ id: 'd', qty: 5, size: '225/65R17' }),  // healthy (recent job)
    item({ id: 'e', qty: 5, size: '245/40R18' }),  // dead (no matching)
  ];
  const jobs: Job[] = [job({ date: TODAY, tireSize: '225/65R17' })];
  const counts = inventoryHealthCounts(items, jobs, TODAY);
  check('counts.critical = 2', counts.critical === 2);
  check('counts.low = 1', counts.low === 1);
  check('counts.healthy = 1', counts.healthy === 1);
  check('counts.dead = 1', counts.dead === 1);
}

console.log(`\n  ${passed} passed, ${failed} failed`);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx tsx tests/inventoryHealth.test.ts`
Expected: FAIL — module `@/lib/inventoryHealth` does not exist yet.

- [ ] **Step 3: Write `src/lib/inventoryHealth.ts`**

```ts
// src/lib/inventoryHealth.ts
// ═══════════════════════════════════════════════════════════════════
//  Inventory health categorization for the tire-vertical Inventory
//  page (roadmap inventory upgrade — Phase 2).
//
//  Each item lands in one of four buckets:
//    critical — qty 0 (out of stock)
//    low      — 0 < qty ≤ 1
//    dead     — qty > 1 AND no matching-size job in last `deadDays`
//    healthy  — qty > 1 AND a matching-size job in the window
//
//  Pure helper. No I/O, no React.
//  Spec: docs/superpowers/specs/2026-05-22-inventory-health-design.md
// ═══════════════════════════════════════════════════════════════════

import type { InventoryItem, Job } from '@/types';
import { normalizeTireSize } from '@/lib/utils';

export type InventoryHealthBucket = 'critical' | 'low' | 'healthy' | 'dead';

export const HEALTH_BUCKETS: InventoryHealthBucket[] = [
  'critical', 'low', 'healthy', 'dead',
];

export interface InventoryHealthOpts {
  /** Days a tire size must go without a matching job to be "dead".
   *  Default 90. */
  deadDays?: number;
}

const DEFAULT_DEAD_DAYS = 90;

function daysBetween(a: string, b: string): number {
  const ta = new Date(a + 'T12:00:00').getTime();
  const tb = new Date(b + 'T12:00:00').getTime();
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return Infinity;
  return Math.max(0, Math.floor((ta - tb) / 86_400_000));
}

// Build the set of normalized sizes that have a job within the
// recency window. O(jobs) once per call; categorize() then runs in
// O(1) per item.
function recentlySoldSizes(
  jobs: ReadonlyArray<Job>,
  today: string,
  deadDays: number,
): Set<string> {
  const set = new Set<string>();
  for (const j of jobs) {
    const size = normalizeTireSize(j.tireSize || '');
    if (!size || !j.date) continue;
    if (daysBetween(today, j.date) <= deadDays) set.add(size);
  }
  return set;
}

export function categorizeInventoryHealth(
  item: InventoryItem,
  jobs: ReadonlyArray<Job>,
  today: string,
  opts?: InventoryHealthOpts,
): InventoryHealthBucket {
  const qty = Number(item.qty || 0);
  if (qty === 0) return 'critical';
  if (qty <= 1) return 'low';
  // qty > 1 from here on — distinguish healthy vs dead.
  const size = normalizeTireSize(item.size || '');
  if (!size) return 'healthy'; // no size to match against → cannot mark dead.
  const window = opts?.deadDays ?? DEFAULT_DEAD_DAYS;
  const sold = recentlySoldSizes(jobs, today, window);
  return sold.has(size) ? 'healthy' : 'dead';
}

export function inventoryHealthCounts(
  items: ReadonlyArray<InventoryItem>,
  jobs: ReadonlyArray<Job>,
  today: string,
  opts?: InventoryHealthOpts,
): Record<InventoryHealthBucket, number> {
  // Precompute the sold set once so the loop is O(items) total.
  const window = opts?.deadDays ?? DEFAULT_DEAD_DAYS;
  const sold = recentlySoldSizes(jobs, today, window);
  const counts: Record<InventoryHealthBucket, number> = {
    critical: 0, low: 0, healthy: 0, dead: 0,
  };
  for (const item of items) {
    const qty = Number(item.qty || 0);
    let bucket: InventoryHealthBucket;
    if (qty === 0) bucket = 'critical';
    else if (qty <= 1) bucket = 'low';
    else {
      const size = normalizeTireSize(item.size || '');
      bucket = !size || sold.has(size) ? 'healthy' : 'dead';
    }
    counts[bucket] += 1;
  }
  return counts;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx tsx tests/inventoryHealth.test.ts`
Expected: PASS — `16 passed, 0 failed`.

- [ ] **Step 5: Typecheck and commit**

Run: `npx tsc --noEmit` — expect clean. Then:

```bash
git add src/lib/inventoryHealth.ts tests/inventoryHealth.test.ts
git commit -m "feat(inventory): inventoryHealth — bucket helper (critical / low / healthy / dead)"
```

---

## Task 2: Inventory UI — health chip row + filter integration; App.tsx jobs prop

**Files:**
- Modify: `src/App.tsx` (one-line prop addition)
- Modify: `src/pages/Inventory.tsx` (`Inventory` Props + `TireInventoryView`)

- [ ] **Step 1: Pass `jobs` into `<Inventory />` in `src/App.tsx`**

Find the line:
```tsx
    if (tab === 'inventory') return <Inventory inventory={inventory} onSave={persistInventory} settings={settings} />;
```

Replace with:
```tsx
    if (tab === 'inventory') return <Inventory inventory={inventory} onSave={persistInventory} settings={settings} jobs={jobs} />;
```

`jobs` is already in scope at line 280: `const [jobs, setJobs] = useState<Job[]>([]);`.

- [ ] **Step 2: Extend the `Inventory` Props interface**

In `src/pages/Inventory.tsx`, find:
```tsx
interface Props {
  inventory: InventoryItem[];
  onSave: (next: InventoryItem[]) => void;
  settings: Settings;
}
```

Replace with:
```tsx
interface Props {
  inventory: InventoryItem[];
  onSave: (next: InventoryItem[]) => void;
  settings: Settings;
  jobs: Job[];
}
```

Add the `Job` import to the existing `from '@/types'` line — extend it to include `Job`:
```tsx
import type { InventoryItem, Job, Settings } from '@/types';
```

- [ ] **Step 3: Thread `jobs` through the dispatcher and into `TireInventoryView`**

The `Inventory` function signature (around line 100) becomes:
```tsx
export function Inventory({ inventory, onSave, settings, jobs }: Props) {
```

The tire-branch render call:
```tsx
return <TireInventoryView inventory={inventory} onSave={onSave} jobs={jobs} />;
```

Extend `InternalViewProps` to accept `jobs`:
```tsx
interface InternalViewProps {
  inventory: InventoryItem[];
  onSave: (next: InventoryItem[]) => void;
  jobs: Job[];
}
```

And the `TireInventoryView` function signature:
```tsx
function TireInventoryView({ inventory, onSave, jobs }: InternalViewProps) {
```

(Mechanic + detailing branches do not consume `jobs` — leave them alone.)

- [ ] **Step 4: Add the helper imports + the health state**

In `src/pages/Inventory.tsx`, add to the existing `@/lib`-group of imports:
```tsx
import { TODAY } from '@/lib/defaults';
import {
  HEALTH_BUCKETS, categorizeInventoryHealth, inventoryHealthCounts,
  type InventoryHealthBucket,
} from '@/lib/inventoryHealth';
```

In `TireInventoryView`, immediately after the `condFilter` state, add:

```tsx
  // Phase 2 — health bucket filter. Single-select: either 'all' or
  // one of the four health buckets. Counts are computed once per
  // render via the memo below.
  const [healthFilter, setHealthFilter] = useState<'all' | InventoryHealthBucket>('all');
  const today = TODAY();
  const healthCounts = useMemo(
    () => inventoryHealthCounts(list, jobs, today),
    [list, jobs, today],
  );
  const healthByItem = useMemo(() => {
    const m = new Map<string, InventoryHealthBucket>();
    for (const i of list) m.set(i.id, categorizeInventoryHealth(i, jobs, today));
    return m;
  }, [list, jobs, today]);
```

- [ ] **Step 5: Wire the health filter into the existing `filtered` pipeline**

Find the `filtered = useMemo(...)` block. Add the health filter as the **first** step (before the existing condition / smart-chip / search steps) and add `healthFilter` + `healthByItem` to the dep list.

The new structure inside the memo:
```tsx
  const filtered = useMemo(() => {
    let base = list;
    if (healthFilter !== 'all') {
      base = base.filter((i) => healthByItem.get(i.id) === healthFilter);
    }
    // … existing condFilter step …
    // … existing activeChips step …
    // … existing search ranking …
  }, [list, condFilter, activeChips, search, healthFilter, healthByItem]);
```

(Preserve every existing step verbatim — only prepend the health step and extend the dep list.)

- [ ] **Step 6: Render the health chip row**

Find the existing condition-chip row (the `<div>` containing the `['all', 'New', 'Used']` chips). Immediately **before** that `<div>`, render the health row:

```tsx
      {/* Phase 2 — inventory health buckets. Single-select; counts
          render in parens and dim when 0. */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
        <button
          type="button"
          className={'chip sm' + (healthFilter === 'all' ? ' active' : '')}
          onClick={() => setHealthFilter('all')}
        >
          All
        </button>
        {HEALTH_BUCKETS.map((b) => {
          const n = healthCounts[b];
          const label = b.charAt(0).toUpperCase() + b.slice(1);
          return (
            <button
              key={b}
              type="button"
              className={'chip sm' + (healthFilter === b ? ' active' : '')}
              onClick={() => setHealthFilter(b)}
              style={n === 0 ? { opacity: .55 } : undefined}
            >
              {label} ({n})
            </button>
          );
        })}
      </div>
```

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean, no errors.

- [ ] **Step 8: Commit**

```bash
git add src/App.tsx src/pages/Inventory.tsx
git commit -m "feat(inventory): health chip row + jobs-aware bucket filter"
```

---

## Task 3: Verify + ship

- [ ] **Step 1: Logic tests**

Run: `npm test`
Expected: every suite `0 failed`, including `inventoryHealth` (`16 passed`).

- [ ] **Step 2: Component tests**

Run: `npm run test:ui`
Expected: `Test Files  5 passed`, `Tests  35 passed`.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: `✓ built` with no errors.

- [ ] **Step 4: Manual UI verification**

On the deployed app → Inventory (tire vertical):

- New "All · Critical (N) · Low (N) · Healthy (N) · Dead (N)" row appears above the existing condition row. Counts reflect the current data.
- Tapping a bucket chip narrows the list to that bucket; tapping `All` clears.
- Items with `qty 0` appear under Critical; `qty 1` under Low.
- An item with `qty > 1` whose size has had a recent completed job is Healthy; one with no recent matching job is Dead.
- Phase 1 smart filters and condition chips still compose correctly with the health filter (intersection).
- Mechanic / detailing inventory views unchanged.

- [ ] **Step 5: Push**

```bash
git push
```

---

## Notes

- **Out of scope** — swipe actions (Phase 3), reserved inventory (Phase 3), supplier (Phase 3), AI insights (Phase 4), virtualized list (deferred until real perf signal).
- Each task leaves the build green.
