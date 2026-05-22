# Inventory Polish v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tighten the tire-vertical Inventory page card hierarchy, surface brand with a "No brand" fallback, add inline qty ± controls on the compact card, and expand the filter chip row with seven multi-select smart filters (Run Flat / Truck / Commercial / Tesla / Trailer / Low Profile / SUV).

**Architecture:** A pure `src/lib/inventoryFilters.ts` module owns the smart-chip matching logic (substring on brand / model / notes / size, with one aspect-ratio heuristic for Low Profile). The tire-vertical `TireInventoryView` in `src/pages/Inventory.tsx` consumes it; the qty cluster, sub-line merge, and chip row are JSX-only changes. No new data fields. No Firestore changes.

**Tech Stack:** TypeScript, React 18, Vite; hand-rolled `tsx` test runner.

> Spec: `docs/superpowers/specs/2026-05-22-inventory-polish-design.md`

---

## File Structure

- **Create `src/lib/inventoryFilters.ts`** — pure helper: `SmartChip` type, `SMART_CHIPS` list, `matchesSmartChip(item, chip)`. No I/O, no React.
- **Create `tests/inventoryFilters.test.ts`** — logic tests, hand-rolled `check()` runner.
- **Modify `src/pages/Inventory.tsx`** — `TireInventoryView` only. Card header (size bump · merged sub-line · qty cluster · drop "Used" pill), smart-chip state + row, filter pipeline integration.
- **Modify `src/styles/app.css`** — `.inv-qty-cluster`, `.inv-qty-btn`, `.inv-card-sub` styles. ~30 lines.

Notes for the engineer:
- Tests run via `npx tsx tests/<name>.test.ts`. `@/` resolves to `src/`. `npm test` runs all logic suites.
- `InventoryItem` type is in `@/types`. Relevant fields: `id`, `size: string`, `qty: number`, `brand?: string`, `model?: string`, `notes?: string`, `condition?: string`, `_isNew?: boolean`.
- The dirty-tracking pattern in `TireInventoryView` is: `update(next)` (sets list + dirty); existing `change(id, key, value)` is the per-item field setter. Use `change(i.id, 'qty', nextQty)` for the inline ± buttons.

---

## Task 1: `src/lib/inventoryFilters.ts` — pure module + tests

**Files:**
- Create: `src/lib/inventoryFilters.ts`
- Test: `tests/inventoryFilters.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/inventoryFilters.test.ts`:

```ts
// tests/inventoryFilters.test.ts
// Run: npx tsx tests/inventoryFilters.test.ts

import { matchesSmartChip, SMART_CHIPS } from '@/lib/inventoryFilters';
import type { InventoryItem } from '@/types';

let passed = 0;
let failed = 0;
const check = (label: string, cond: boolean): void => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}`); }
};

const item = (over: Partial<InventoryItem>): InventoryItem => ({
  id: 'x', size: '', qty: 0, cost: 0,
  ...over,
});

console.log('\n┌─ SMART_CHIPS list ─────────────────────────────────');
check('SMART_CHIPS has 7 chips in documented order',
  JSON.stringify(SMART_CHIPS) === JSON.stringify(
    ['Run Flat', 'Truck', 'Commercial', 'Tesla', 'Trailer', 'Low Profile', 'SUV']));

console.log('\n┌─ matchesSmartChip — substring chips ───────────────');
check("'Run Flat' matches 'run flat' in notes (case-insensitive)",
  matchesSmartChip(item({ notes: 'Run Flat tire, premium' }), 'Run Flat'));
check("'Run Flat' matches in model",
  matchesSmartChip(item({ model: 'RUN FLAT Series' }), 'Run Flat'));
check("'Run Flat' matches in brand",
  matchesSmartChip(item({ brand: 'Bridgestone Run Flat' }), 'Run Flat'));
check("'Run Flat' rejects when absent",
  !matchesSmartChip(item({ notes: 'standard tire' }), 'Run Flat'));

check("'Truck' matches 'truck' in notes",
  matchesSmartChip(item({ notes: 'Heavy truck use' }), 'Truck'));
check("'Truck' rejects when absent",
  !matchesSmartChip(item({ notes: 'sedan' }), 'Truck'));

check("'Commercial' matches in notes",
  matchesSmartChip(item({ notes: 'Commercial fleet' }), 'Commercial'));
check("'Tesla' matches in notes",
  matchesSmartChip(item({ notes: 'Tesla Model 3' }), 'Tesla'));
check("'Trailer' matches in notes",
  matchesSmartChip(item({ notes: 'trailer use' }), 'Trailer'));
check("'SUV' matches in notes",
  matchesSmartChip(item({ notes: 'For SUV vehicles' }), 'SUV'));

console.log('\n┌─ matchesSmartChip — Low Profile heuristic ─────────');
check("'Low Profile' matches aspect ratio 40 (e.g. 245/40R18)",
  matchesSmartChip(item({ size: '245/40R18' }), 'Low Profile'));
check("'Low Profile' matches aspect ratio 30",
  matchesSmartChip(item({ size: '255/30R20' }), 'Low Profile'));
check("'Low Profile' matches 49 (boundary, < 50)",
  matchesSmartChip(item({ size: '225/49R17' }), 'Low Profile'));
check("'Low Profile' rejects aspect ratio 50 (boundary)",
  !matchesSmartChip(item({ size: '225/50R17' }), 'Low Profile'));
check("'Low Profile' rejects aspect ratio 65",
  !matchesSmartChip(item({ size: '225/65R17' }), 'Low Profile'));
check("'Low Profile' substring fallback works when size is malformed",
  matchesSmartChip(item({ size: 'GARBAGE', notes: 'Low profile look' }), 'Low Profile'));
check("'Low Profile' rejects when size malformed AND no substring",
  !matchesSmartChip(item({ size: 'GARBAGE', notes: 'normal' }), 'Low Profile'));

console.log('\n┌─ matchesSmartChip — case insensitivity ────────────');
check("'Tesla' matches 'TESLA' (uppercase)",
  matchesSmartChip(item({ notes: 'TESLA Model Y' }), 'Tesla'));
check("'Truck' matches 'tRuCk' (mixed case)",
  matchesSmartChip(item({ brand: 'tRuCk Tires Co' }), 'Truck'));

console.log(`\n  ${passed} passed, ${failed} failed`);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx tsx tests/inventoryFilters.test.ts`
Expected: FAIL — module `@/lib/inventoryFilters` does not exist yet.

- [ ] **Step 3: Write `src/lib/inventoryFilters.ts`**

```ts
// src/lib/inventoryFilters.ts
// ═══════════════════════════════════════════════════════════════════
//  Smart-filter chip matching for the tire-vertical Inventory page.
//
//  The chips work over EXISTING InventoryItem data — there are no
//  new fields. Most chips are case-insensitive substring matches
//  against the item's brand / model / notes / size. "Low Profile"
//  adds a parsed aspect-ratio heuristic so an operator who hasn't
//  written "low profile" in notes still gets a useful filter.
//
//  Phase 1 of the inventory upgrade. Spec:
//  docs/superpowers/specs/2026-05-22-inventory-polish-design.md
// ═══════════════════════════════════════════════════════════════════

import type { InventoryItem } from '@/types';

export type SmartChip =
  | 'Run Flat' | 'Truck' | 'Commercial' | 'Tesla'
  | 'Trailer' | 'Low Profile' | 'SUV';

export const SMART_CHIPS: SmartChip[] = [
  'Run Flat', 'Truck', 'Commercial', 'Tesla',
  'Trailer', 'Low Profile', 'SUV',
];

// Keyword each chip substring-matches against the item's text fields
// (brand / model / notes). Lower-case; the haystack is lower-cased
// before comparison.
const KEYWORD: Record<SmartChip, string> = {
  'Run Flat': 'run flat',
  'Truck': 'truck',
  'Commercial': 'commercial',
  'Tesla': 'tesla',
  'Trailer': 'trailer',
  'Low Profile': 'low profile',
  'SUV': 'suv',
};

function haystack(item: InventoryItem): string {
  return [
    item.brand || '', item.model || '', item.notes || '',
  ].join(' ').toLowerCase();
}

// Parse the aspect ratio out of a `WWW/AARR…`-shape tire size string
// (e.g. "245/40R18" → 40). Returns null on a malformed size.
function aspectRatio(size: string | undefined): number | null {
  if (!size) return null;
  const m = size.match(/\d+\s*\/\s*(\d+)/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) ? n : null;
}

export function matchesSmartChip(item: InventoryItem, chip: SmartChip): boolean {
  const kw = KEYWORD[chip];
  if (haystack(item).includes(kw)) return true;
  // Low Profile gets the parsed-size heuristic as well.
  if (chip === 'Low Profile') {
    const ar = aspectRatio(item.size);
    if (ar !== null && ar < 50) return true;
  }
  return false;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx tsx tests/inventoryFilters.test.ts`
Expected: PASS — `20 passed, 0 failed`.

- [ ] **Step 5: Typecheck and commit**

Run: `npx tsc --noEmit` — expect clean. Then:

```bash
git add src/lib/inventoryFilters.ts tests/inventoryFilters.test.ts
git commit -m "feat(inventory): inventoryFilters — smart-chip matching helper"
```

---

## Task 2: Inventory UI — card hierarchy, qty cluster, smart chips, styles

**Files:**
- Modify: `src/pages/Inventory.tsx` (`TireInventoryView` only)
- Modify: `src/styles/app.css`

This task is one logical UI pass. The CSS is short enough to land alongside the JSX in a single commit.

- [ ] **Step 1: Add the CSS block to `src/styles/app.css`**

Find the comment `/* ── Forms ──` (the section right after the AI summary CSS). Immediately **before** that comment, insert:

```css

/* ── Inventory — compact card v1 polish ─────────────────────── */
.inv-card-sub {
  font-size: 12px;
  color: var(--t3);
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.inv-qty-cluster {
  display: flex;
  flex-direction: column;
  gap: 4px;
  align-items: stretch;
  margin-right: 6px;
}
.inv-qty-btn {
  min-width: 44px;
  min-height: 22px;
  padding: 0 8px;
  background: var(--s2);
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--t1);
  font-size: 16px;
  font-weight: 700;
  line-height: 1;
  cursor: pointer;
  user-select: none;
  touch-action: manipulation;
}
.inv-qty-btn:active { background: var(--s3); }
.inv-qty-btn:disabled { opacity: .4; cursor: default; }
```

- [ ] **Step 2: Update imports in `src/pages/Inventory.tsx`**

Add this import alongside the other `@/lib` imports near the top of the file:

```ts
import { SMART_CHIPS, matchesSmartChip, type SmartChip } from '@/lib/inventoryFilters';
```

- [ ] **Step 3: Add smart-chip state and filter integration**

In `TireInventoryView`, find the existing `const [condFilter, setCondFilter] = useState<CondFilter>('all');` line. Immediately after it, add:

```tsx
  // Phase 1 smart filters — multi-select chip set. Each active chip
  // intersects with the others (item must match every active chip).
  const [activeChips, setActiveChips] = useState<ReadonlySet<SmartChip>>(new Set());
  const toggleChip = (c: SmartChip): void => {
    setActiveChips((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c); else next.add(c);
      return next;
    });
  };
```

Then find the `filtered = useMemo(...)` block. Inside that memo, between the existing condition filter and the search ranking, insert the smart-chip intersect step. The relevant lines currently read (paraphrase — locate the actual block):

```tsx
  const filtered = useMemo(() => {
    let base = list;
    if (condFilter !== 'all') {
      base = base.filter((i) => (i.condition || 'New') === condFilter);
    }
    // … existing search-ranking logic …
  }, [list, condFilter, search]);
```

Update to add the smart-chip step right after the condition filter and **before** the search ranking, and add `activeChips` to the dep list:

```tsx
    if (activeChips.size) {
      const chips = Array.from(activeChips);
      base = base.filter((i) =>
        chips.every((c) => matchesSmartChip(i, c)),
      );
    }
```

…and update the dep array: `[list, condFilter, search, activeChips]`.

- [ ] **Step 4: Render the second chip row (smart filters)**

Find the existing condition-chip row (the `<div>` containing the `['all','New','Used']` chips). Immediately **after** that closing `</div>`, render the smart-filter row:

```tsx
      {/* Smart filter chips — multi-select. Intersect with the
          condition filter and the search query. */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
        {SMART_CHIPS.map((c) => (
          <button
            key={c}
            type="button"
            className={'chip sm' + (activeChips.has(c) ? ' active' : '')}
            onClick={() => toggleChip(c)}
          >
            {c}
          </button>
        ))}
      </div>
```

- [ ] **Step 5: Refactor the compact card header — size bump, merged sub-line, qty cluster**

Find the compact card header `<button>` (the one with `onClick={() => toggleExpanded(i.id)}`). Replace its **inner** content (everything from the opening `<div style={{ flex: 1, minWidth: 0 }}>` through the closing `</div>` of the qty block on the right) with this new structure. The wrapper button + the chevron `▸` stay; only the middle region changes.

Replace this block (and keep the surrounding `<button>` and chevron `<div>` untouched):

```tsx
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <div style={{ fontSize: 19, fontWeight: 800, color: 'var(--t1)', lineHeight: 1.1, letterSpacing: '-.2px' }}>
                      {i.size || <span style={{ color: 'var(--t3)', fontStyle: 'italic', fontSize: 15 }}>(new tire)</span>}
                    </div>
                    {i.condition && i.condition !== 'New' && (
                      <span className="pill" style={{ fontSize: 9, padding: '2px 6px' }}>
                        {i.condition}
                      </span>
                    )}
                    {outOfStock && (
                      <span className="pill red" style={{ fontSize: 9, padding: '2px 6px' }}>
                        Out
                      </span>
                    )}
                    {low && (
                      <span className="pill amber" style={{ fontSize: 9, padding: '2px 6px' }}>
                        Low
                      </span>
                    )}
                  </div>
                  {(i.brand || '').trim() && (
                    <div style={{ fontSize: 12, color: 'var(--t3)', marginTop: 3 }}>
                      {i.brand}
                    </div>
                  )}
                </div>
                <div style={{ textAlign: 'right', minWidth: 60 }}>
                  <div style={{
                    fontSize: 28, fontWeight: 800,
                    color: outOfStock ? 'var(--red)' : low ? 'var(--amber)' : 'var(--t1)',
                    lineHeight: 1,
                  }}>
                    {qty}
                  </div>
                  <div style={{ fontSize: 9, color: 'var(--t3)', marginTop: 3, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    in stock
                  </div>
                </div>
```

…with:

```tsx
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    {/* Tire size — primary scan key, bumped from 19 → 22 px. */}
                    <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--t1)', lineHeight: 1.1, letterSpacing: '-.2px' }}>
                      {i.size || <span style={{ color: 'var(--t3)', fontStyle: 'italic', fontSize: 15 }}>(new tire)</span>}
                    </div>
                    {/* Low / Out status badges still render alongside size.
                        The "Used" condition is now in the sub-line below
                        instead of as a duplicate pill here. */}
                    {outOfStock && (
                      <span className="pill red" style={{ fontSize: 9, padding: '2px 6px' }}>
                        Out
                      </span>
                    )}
                    {low && (
                      <span className="pill amber" style={{ fontSize: 9, padding: '2px 6px' }}>
                        Low
                      </span>
                    )}
                  </div>
                  {/* Merged sub-line: brand · condition. Always renders so
                      the absence of brand is visible at scan time. */}
                  <div className="inv-card-sub">
                    {(() => {
                      const brand = (i.brand || '').trim() || 'No brand';
                      const cond = i.condition === 'Used' ? 'Used' : '';
                      return cond ? `${brand} · ${cond}` : brand;
                    })()}
                  </div>
                </div>
                {/* Inline qty ± cluster — adjusts qty without expanding
                    the card. stopPropagation prevents the surrounding
                    button's onClick (toggleExpanded) from firing. */}
                <div className="inv-qty-cluster" onClick={(e) => e.stopPropagation()}>
                  <button
                    type="button"
                    className="inv-qty-btn"
                    aria-label="Increase quantity"
                    onClick={(e) => { e.stopPropagation(); change(i.id, 'qty', qty + 1); }}
                  >
                    +
                  </button>
                  <button
                    type="button"
                    className="inv-qty-btn"
                    aria-label="Decrease quantity"
                    disabled={qty <= 0}
                    onClick={(e) => { e.stopPropagation(); if (qty > 0) change(i.id, 'qty', qty - 1); }}
                  >
                    −
                  </button>
                </div>
                <div style={{ textAlign: 'right', minWidth: 56 }}>
                  <div style={{
                    fontSize: 28, fontWeight: 800,
                    color: outOfStock ? 'var(--red)' : low ? 'var(--amber)' : 'var(--t1)',
                    lineHeight: 1,
                  }}>
                    {qty}
                  </div>
                  <div style={{ fontSize: 9, color: 'var(--t3)', marginTop: 3, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    in stock
                  </div>
                </div>
```

Note: the qty cluster sits between the sub-line block and the existing qty number; the chevron stays at the far right untouched. The wrapping `<button>` also gets slightly tighter padding via inline style — change its `padding: '12px 14px'` to `padding: '10px 12px'`.

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean, no errors.

- [ ] **Step 7: Commit**

```bash
git add src/pages/Inventory.tsx src/styles/app.css
git commit -m "feat(inventory): card-hierarchy polish, qty ± cluster, smart-filter chips"
```

---

## Task 3: Verify + ship

- [ ] **Step 1: Logic tests**

Run: `npm test`
Expected: every suite `0 failed`, including `inventoryFilters` (`20 passed`).

- [ ] **Step 2: Component tests**

Run: `npm run test:ui`
Expected: `Test Files  5 passed`, `Tests  35 passed` (no component tests added by this feature).

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: `✓ built` with no errors.

- [ ] **Step 4: Manual UI verification**

On the deployed app (`https://app.mobileserviceos.app`) → Inventory:

- Tire-vertical: cards show tire size noticeably larger (22 px) on top, with `Brand · Used` sub-line below (or just `Brand`, or `No brand`).
- Inline `+` / `−` buttons next to the qty number adjust without expanding the card. `−` disables at 0. Each tap marks the list dirty and surfaces **Save Inventory**.
- The "Used" duplicate pill next to the size is gone. `Low` / `Out` badges remain.
- A new second row of multi-select chips appears below the condition row: Run Flat / Truck / Commercial / Tesla / Trailer / Low Profile / SUV. Tapping multiple intersects; tapping again deselects.
- "Low Profile" matches a 245/40R18 even with no notes; "Tesla" matches when notes contains "Tesla".
- Mechanic / detailing inventory pages unchanged.

- [ ] **Step 5: Push**

```bash
git push
```

---

## Notes

- **Out of scope** — categorized health (Phase 2), swipe gestures (Phase 3), reserved inventory (Phase 3), supplier fields (Phase 3), AI insights (Phase 4). Do not add these in this phase.
- Each task leaves the build green.
