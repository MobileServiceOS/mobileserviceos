# Inventory Operations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add reserved-inventory (data + UI) and a `purchaseSource` field to the tire-vertical InventoryItem, plus a matching-inventory badge under Add Job's tire-size input. NO swipe gestures (see spec for rationale). NO auto-release.

**Architecture:** Additive `InventoryItem` fields (`reservations?: ReservedSlot[]`, `purchaseSource?: string`). Pure helpers (`reservedQty`, `availableQty`, `addReservation`, `removeReservation`) live in `src/lib/inventoryReservations.ts`. The deserializer learns about the new array. The tire-vertical Inventory page surfaces a `🔒 N reserved · M available` line on the compact card when reservations exist, and a Reservations sub-section + Source input in the expanded form. Add Job grows a small read-only matching-inventory badge under the tire-size input.

**Tech Stack:** TypeScript, React 18; hand-rolled `tsx` test runner.

> Spec: `docs/superpowers/specs/2026-05-22-inventory-operations-design.md`

---

## File Structure

- **Modify `src/types/index.ts`** — add `ReservedSlot` interface, add `reservations?: ReservedSlot[]` + `purchaseSource?: string` to `InventoryItem`.
- **Modify `src/lib/deserializers.ts`** — add `deserializeReservations` helper (mirror of `deserializeInventoryDeductions`), wire it + `purchaseSource` into `deserializeInventoryItem`.
- **Create `src/lib/inventoryReservations.ts`** — pure helpers.
- **Create `tests/inventoryReservations.test.ts`** — logic tests.
- **Modify `src/pages/Inventory.tsx`** — `TireInventoryView`: card-header `🔒` line, expanded-card Reservations sub-section + Source input.
- **Modify `src/pages/AddJob.tsx`** — matching-inventory badge under the tire-size input.
- **Modify `src/styles/app.css`** — `.inv-reserve-line`, `.inv-reservations`, `.inv-reservation-row`, `.inv-match-badge`.

Notes for the engineer:
- `uid()` helper is in `@/lib/utils`.
- `normalizeTireSize` (for the AddJob badge) is in `@/lib/utils`.
- The `fbSet` helper in `@/lib/firebase` JSON-stringifies object/array values on write; the deserializer is the read side. No write-side code needed for the new `reservations` array.
- Inventory page already passes `inventory` and (after Phase 2) `jobs` to `TireInventoryView`. AddJob already receives `inventory`.

---

## Task 1: Types, deserializer, pure helpers + tests

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/lib/deserializers.ts`
- Create: `src/lib/inventoryReservations.ts`
- Test: `tests/inventoryReservations.test.ts`

- [ ] **Step 1: Add `ReservedSlot` + extend `InventoryItem`**

In `src/types/index.ts`, immediately **before** the `export interface InventoryItem {` line, add:

```ts
export interface ReservedSlot {
  /** Stable id for this reservation row (uid() at creation). */
  id: string;
  /** Quantity reserved against this slot (≥ 1). */
  qty: number;
  /** Optional free-text label ("5 PM Smith job", "Insurance hold"). */
  label?: string;
  /** ISO timestamp when the reservation was created. */
  createdAt: string;
}
```

Inside `InventoryItem`, immediately **after** the existing `model?: string;` line (before `_isNew?: boolean;`), add:

```ts
  /** Phase 3 — operator-marked reservations against this item's
   *  qty. availableQty = max(0, qty − sum(reservations[].qty)).
   *  v1: no jobId link, no auto-release, free-text label only. */
  reservations?: ReservedSlot[];
  /** Phase 3 — supplier / purchase source as free text. Future
   *  iterations may add per-source analytics. */
  purchaseSource?: string;
```

- [ ] **Step 2: Wire the deserializer**

In `src/lib/deserializers.ts`, immediately **after** the `deserializeInventoryDeductions` function (before the `VALID_STATUSES` const), add:

```ts
function deserializeReservations(v: unknown): ReservedSlot[] | undefined {
  let arr: unknown;
  if (Array.isArray(v)) arr = v;
  else if (typeof v === 'string') arr = tryParseJSON<unknown>(v);
  else return undefined;
  if (!Array.isArray(arr)) return undefined;
  const out: ReservedSlot[] = [];
  for (const raw of arr) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Partial<ReservedSlot>;
    const id = typeof r.id === 'string' ? r.id : null;
    const qty = typeof r.qty === 'number' && Number.isFinite(r.qty) ? r.qty : NaN;
    const createdAt = typeof r.createdAt === 'string' ? r.createdAt : null;
    if (!id || !Number.isFinite(qty) || qty <= 0 || !createdAt) continue;
    const slot: ReservedSlot = { id, qty, createdAt };
    if (typeof r.label === 'string' && r.label) slot.label = r.label;
    out.push(slot);
  }
  return out.length ? out : undefined;
}
```

At the top of the file, extend the existing `import type { ... } from '@/types';` line to include `ReservedSlot`. (If there's no existing import of types in this file, find the existing `import type` block and add `ReservedSlot` alongside `InventoryItem`.)

Inside `deserializeInventoryItem` — immediately **before** the closing `}` of the returned object literal — add:

```ts
    // Phase 3 — reservations (JSON-stringified by fbSet on write) and
    // free-text purchase source.
    reservations: deserializeReservations(raw.reservations),
    purchaseSource: raw.purchaseSource == null ? undefined : asString(raw.purchaseSource),
```

- [ ] **Step 3: Write the failing test**

Create `tests/inventoryReservations.test.ts`:

```ts
// tests/inventoryReservations.test.ts
// Run: npx tsx tests/inventoryReservations.test.ts

import {
  reservedQty, availableQty, addReservation, removeReservation,
} from '@/lib/inventoryReservations';
import type { InventoryItem, ReservedSlot } from '@/types';

let passed = 0;
let failed = 0;
const check = (label: string, cond: boolean): void => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}`); }
};

const item = (over: Partial<InventoryItem>): InventoryItem => ({
  id: 'x', size: '225/65R17', qty: 10, cost: 0, ...over,
});
const slot = (over: Partial<ReservedSlot>): ReservedSlot => ({
  id: 's', qty: 1, createdAt: '2026-05-22T12:00:00.000Z', ...over,
});

console.log('\n┌─ reservedQty ──────────────────────────────────────');
check('no reservations → 0', reservedQty(item({})) === 0);
check('empty array → 0', reservedQty(item({ reservations: [] })) === 0);
check('one slot of 2 → 2',
  reservedQty(item({ reservations: [slot({ qty: 2 })] })) === 2);
check('multiple slots sum',
  reservedQty(item({ reservations: [slot({ id: 'a', qty: 2 }), slot({ id: 'b', qty: 3 })] })) === 5);
check('non-finite slot qty treated as 0',
  reservedQty(item({ reservations: [slot({ qty: NaN as unknown as number })] })) === 0);

console.log('\n┌─ availableQty ─────────────────────────────────────');
check('no reservations → qty', availableQty(item({ qty: 10 })) === 10);
check('qty 10, reserved 3 → 7',
  availableQty(item({ qty: 10, reservations: [slot({ qty: 3 })] })) === 7);
check('over-reserved clamps to 0',
  availableQty(item({ qty: 2, reservations: [slot({ qty: 5 })] })) === 0);

console.log('\n┌─ addReservation ───────────────────────────────────');
{
  const before = item({ qty: 10 });
  const after = addReservation(before, 3, 'Smith 5pm', '2026-05-22T15:00:00.000Z');
  check('returns a new item (input not mutated)', before.reservations === undefined && after !== before);
  check('appends one slot', (after.reservations || []).length === 1);
  check('slot has qty', after.reservations![0].qty === 3);
  check('slot has label', after.reservations![0].label === 'Smith 5pm');
  check('slot has the provided createdAt',
    after.reservations![0].createdAt === '2026-05-22T15:00:00.000Z');
  check('slot has a non-empty id', typeof after.reservations![0].id === 'string' && after.reservations![0].id.length > 0);
}
{
  const before = item({ qty: 10 });
  const after = addReservation(before, 0, 'noop');
  check('addReservation(qty=0) returns the input reference unchanged', after === before);
  check('addReservation(qty=0) leaves reservations undefined', after.reservations === undefined);
}
{
  const before = item({ qty: 2, reservations: [slot({ qty: 2 })] });
  const after = addReservation(before, 1, 'over');
  check('addReservation(qty > availableQty) is rejected (length unchanged)',
    (after.reservations || []).length === 1);
}

console.log('\n┌─ removeReservation ────────────────────────────────');
{
  const before = item({
    qty: 10,
    reservations: [slot({ id: 'a', qty: 2 }), slot({ id: 'b', qty: 3 })],
  });
  const after = removeReservation(before, 'a');
  check('removes the matching slot', (after.reservations || []).length === 1);
  check('preserves the other slot', after.reservations![0].id === 'b');
  check('returns a new item', before !== after);
}
{
  const before = item({ qty: 10, reservations: [slot({ id: 'a', qty: 2 })] });
  const after = removeReservation(before, 'unknown-id');
  check('unknown id → unchanged length', (after.reservations || []).length === 1);
}

console.log(`\n  ${passed} passed, ${failed} failed`);
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npx tsx tests/inventoryReservations.test.ts`
Expected: FAIL — module `@/lib/inventoryReservations` does not exist yet.

- [ ] **Step 5: Write `src/lib/inventoryReservations.ts`**

```ts
// src/lib/inventoryReservations.ts
// ═══════════════════════════════════════════════════════════════════
//  Reserved-inventory pure helpers (roadmap inventory upgrade —
//  Phase 3).
//
//  An InventoryItem can carry a `reservations: ReservedSlot[]` array
//  earmarking some of its qty for upcoming work. availableQty is
//  derived: qty − sum(slot.qty), clamped to 0. v1 stores a free-text
//  label per slot; auto-release / jobId linkage are out of scope.
//
//  All helpers are pure — they never mutate their input.
//
//  Spec: docs/superpowers/specs/2026-05-22-inventory-operations-design.md
// ═══════════════════════════════════════════════════════════════════

import type { InventoryItem, ReservedSlot } from '@/types';
import { uid } from '@/lib/utils';

export function reservedQty(item: InventoryItem): number {
  if (!Array.isArray(item.reservations)) return 0;
  let sum = 0;
  for (const slot of item.reservations) {
    const q = Number(slot?.qty);
    if (Number.isFinite(q) && q > 0) sum += q;
  }
  return sum;
}

export function availableQty(item: InventoryItem): number {
  return Math.max(0, Number(item.qty || 0) - reservedQty(item));
}

export function addReservation(
  item: InventoryItem,
  qty: number,
  label?: string,
  now?: string,
): InventoryItem {
  if (!Number.isFinite(qty) || qty <= 0) return item;
  if (qty > availableQty(item)) return item;
  const slot: ReservedSlot = {
    id: uid(),
    qty,
    createdAt: now || new Date().toISOString(),
  };
  if (label && label.trim()) slot.label = label.trim();
  const reservations = [...(item.reservations || []), slot];
  return { ...item, reservations };
}

export function removeReservation(
  item: InventoryItem,
  reservationId: string,
): InventoryItem {
  if (!Array.isArray(item.reservations)) return { ...item };
  const reservations = item.reservations.filter((r) => r.id !== reservationId);
  if (reservations.length === item.reservations.length) return { ...item };
  // Drop the field entirely when empty so consumers can treat
  // "no reservations" as undefined.
  return reservations.length ? { ...item, reservations } : { ...item, reservations: undefined };
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx tsx tests/inventoryReservations.test.ts`
Expected: PASS — `21 passed, 0 failed`.

- [ ] **Step 7: Typecheck and commit**

Run: `npx tsc --noEmit` — expect clean. Then:

```bash
git add src/types/index.ts src/lib/deserializers.ts src/lib/inventoryReservations.ts tests/inventoryReservations.test.ts
git commit -m "feat(inventory): ReservedSlot type + deserializer + pure reservation helpers"
```

---

## Task 2: Inventory page — `🔒` header line, Reservations sub-section, Source input

**Files:**
- Modify: `src/pages/Inventory.tsx` (`TireInventoryView` only)
- Modify: `src/styles/app.css`

- [ ] **Step 1: CSS — add the inventory-reservation styles**

In `src/styles/app.css`, find the Phase 1 `.inv-qty-btn:disabled { … }` rule (the last `.inv-` rule in the file from Phase 1). Immediately **after** its closing `}`, add:

```css

/* ── Inventory — reservations (Phase 3) ─────────────────────── */
.inv-reserve-line {
  font-size: 11px;
  color: var(--amber);
  margin-top: 4px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.inv-reservations {
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px dashed var(--border);
}
.inv-reservations-title {
  font-size: 10px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 1px;
  color: var(--t3);
  margin-bottom: 8px;
}
.inv-reservation-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 0;
  font-size: 13px;
  color: var(--t1);
}
.inv-reservation-row .label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.inv-reservation-row .qty {
  font-weight: 700;
  color: var(--brand-primary);
  min-width: 32px;
  text-align: right;
}
.inv-reservation-row .release {
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--t2);
  font-size: 11px;
  padding: 4px 10px;
  min-height: 32px;
  cursor: pointer;
}
.inv-reservation-row .release:hover { color: var(--red); border-color: var(--red); }
.inv-reservation-add {
  display: flex; gap: 6px; align-items: center;
  margin-top: 8px;
}
.inv-reservation-add input { flex: 1; min-width: 0; }
.inv-reservation-add .qty-input { flex: 0 0 64px; }
.inv-reservation-add button {
  background: var(--brand-primary);
  border: none; border-radius: 8px;
  color: #1a1a1a; font-weight: 700; font-size: 13px;
  padding: 6px 12px; min-height: 32px; cursor: pointer;
}
.inv-reservation-add button:disabled { opacity: .4; cursor: default; }
```

- [ ] **Step 2: Import the helpers in `Inventory.tsx`**

Add to the existing `@/lib`-group of imports:

```tsx
import {
  availableQty, reservedQty, addReservation, removeReservation,
} from '@/lib/inventoryReservations';
```

- [ ] **Step 3: Render the `🔒 N reserved · M available` line on the compact card**

Inside `TireInventoryView`'s card map (around the `filtered.map((i) => { ... })` block), find the left-side text block that contains the size + sub-line. Immediately **after** the `<div className="inv-card-sub">…</div>` (added by Phase 1), and STILL inside the left-side `<div style={{ flex: 1, minWidth: 0 }}>`, add:

```tsx
                  {reservedQty(i) > 0 && (
                    <div className="inv-reserve-line">
                      🔒 {reservedQty(i)} reserved · {availableQty(i)} available
                    </div>
                  )}
```

- [ ] **Step 4: Render the Reservations sub-section in the expanded form**

In the same `filtered.map` rendering, find the expanded edit form block (the `{open && (` block). Immediately **before** its closing `</div>` (the one that wraps the form-group / value / Remove footer — i.e. immediately before the `<div style={{ display: 'flex', justifyContent: 'space-between'… `Value: …`)} block), insert:

```tsx
                  <div className="inv-reservations">
                    <div className="inv-reservations-title">Reservations</div>
                    {(i.reservations || []).map((r) => (
                      <div key={r.id} className="inv-reservation-row">
                        <span className="label">{r.label || '—'}</span>
                        <span className="qty">×{r.qty}</span>
                        <button
                          type="button"
                          className="release"
                          onClick={() => {
                            const nextItem = removeReservation(i, r.id);
                            update(list.map((x) => (x.id === i.id ? nextItem : x)));
                          }}
                        >
                          Release
                        </button>
                      </div>
                    ))}
                    <ReservationAdder
                      item={i}
                      onAdd={(qty, label) => {
                        const nextItem = addReservation(i, qty, label);
                        update(list.map((x) => (x.id === i.id ? nextItem : x)));
                      }}
                    />
                  </div>
                  <div className="field" style={{ marginTop: 10 }}>
                    <label>Source <span style={{ color: 'var(--t3)', fontWeight: 400, fontSize: 11 }}>(optional)</span></label>
                    <input
                      value={i.purchaseSource || ''}
                      onChange={(e) => change(i.id, 'purchaseSource', e.target.value)}
                      placeholder="Tire Hut · Marketplace · Wholesale…"
                    />
                  </div>
```

- [ ] **Step 5: Add the `ReservationAdder` sub-component**

At the **top** of `src/pages/Inventory.tsx`, after the existing helper / dispatcher exports and before `TireInventoryView`, add a small sub-component:

```tsx
// Inline form to add a new reservation against an InventoryItem.
// Disabled when qty input is invalid or exceeds availableQty(item).
function ReservationAdder({
  item,
  onAdd,
}: {
  item: InventoryItem;
  onAdd: (qty: number, label: string) => void;
}) {
  const [qty, setQty] = useState<number | ''>(1);
  const [label, setLabel] = useState('');
  const avail = availableQty(item);
  const n = typeof qty === 'number' ? qty : 0;
  const disabled = n <= 0 || n > avail;
  return (
    <div className="inv-reservation-add">
      <input
        className="qty-input"
        type="number"
        inputMode="numeric"
        min={1}
        max={avail}
        value={qty}
        onChange={(e) => {
          const v = e.target.value;
          setQty(v === '' ? '' : Math.max(0, parseInt(v, 10) || 0));
        }}
      />
      <input
        type="text"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder="Label (e.g. 5 PM Smith job)"
      />
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          if (disabled) return;
          onAdd(n, label);
          setQty(1);
          setLabel('');
        }}
      >
        Reserve
      </button>
    </div>
  );
}
```

(The `availableQty` import is already in the file from Step 2.)

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean, no errors.

- [ ] **Step 7: Commit**

```bash
git add src/pages/Inventory.tsx src/styles/app.css
git commit -m "feat(inventory): reservations UI + Source input on the tire inventory card"
```

---

## Task 3: Add Job — matching-inventory badge

**Files:**
- Modify: `src/pages/AddJob.tsx`
- Modify: `src/styles/app.css`

- [ ] **Step 1: CSS**

In `src/styles/app.css`, immediately **after** the `.inv-reservation-add button:disabled { opacity: .4; cursor: default; }` rule from Task 2 above, add:

```css

/* ── Inventory match badge (Add Job — Phase 3) ──────────────── */
.inv-match-badge {
  margin-top: 6px;
  padding: 6px 10px;
  border-radius: 8px;
  background: var(--brand-primary-dim);
  border: 1px solid var(--brand-primary);
  color: var(--brand-primary);
  font-size: 12px;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.inv-match-badge.warn {
  background: rgba(245, 158, 11, .14);
  border-color: var(--amber);
  color: var(--amber);
}
```

- [ ] **Step 2: Render the badge under the tire-size input**

In `src/pages/AddJob.tsx`, add this import near the other `@/lib` imports if not already present:

```tsx
import { availableQty, reservedQty } from '@/lib/inventoryReservations';
```

(`normalizeTireSize` is already imported in AddJob; if not, add it to the existing `@/lib/utils` import.)

Find the existing Tire-Details `<input>` whose value is `job.tireSize` (its label is "Size"). Immediately **after** the `<input value={job.tireSize} onChange={(e) => set('tireSize', e.target.value)} … />`, render the badge:

```tsx
              {(() => {
                const typed = (job.tireSize || '').trim();
                if (!typed) return null;
                const target = normalizeTireSize(typed);
                if (!target) return null;
                const match = inventory.find(
                  (it) => normalizeTireSize(it.size || '') === target,
                );
                if (!match) return null;
                const total = Number(match.qty || 0);
                const avail = availableQty(match);
                const reserved = reservedQty(match);
                const needed = Number(job.qty || 0);
                const low = needed > 0 && needed > avail;
                if (reserved > 0 && low) {
                  return (
                    <div className="inv-match-badge warn">
                      ⚠ Low availability: {total} in stock, {reserved} reserved
                    </div>
                  );
                }
                if (reserved > 0) {
                  return (
                    <div className="inv-match-badge">
                      ✓ In stock: {total} × {match.size} · available {avail}
                    </div>
                  );
                }
                return (
                  <div className="inv-match-badge">
                    ✓ In stock: {total} × {match.size}
                  </div>
                );
              })()}
```

(Make sure this is placed inside the same wrapping `<div className="field">` as the size input, just below the `<input>`.)

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean, no errors.

- [ ] **Step 4: Commit**

```bash
git add src/pages/AddJob.tsx src/styles/app.css
git commit -m "feat(inventory): matching-inventory badge under Add Job tire size"
```

---

## Task 4: Verify + ship

- [ ] **Step 1: Logic tests**

Run: `npm test`
Expected: every suite `0 failed`, including `inventoryReservations` (`21 passed`).

- [ ] **Step 2: Component tests**

Run: `npm run test:ui`
Expected: `Test Files  5 passed`, `Tests  35 passed`.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: `✓ built` with no errors.

- [ ] **Step 4: Manual UI verification**

On the deployed app → Inventory (tire vertical):

- Expand a tire card. A new **Reservations** sub-section appears
  between the form fields and the Value / Remove footer. Add a
  reservation (e.g. qty 2, label "Smith 5 PM"). The list updates
  and the compact card now shows `🔒 2 reserved · 8 available`
  in amber.
- Tap **Release** on a slot. The slot vanishes and the compact
  card's `🔒` line disappears once reservations hit 0.
- Try adding a reservation larger than available qty — the
  **Reserve** button stays disabled.
- The new **Source** input persists across saves.

On Add Job (tire vertical):

- Type a size that matches an in-stock inventory item — a green
  `✓ In stock: N × SIZE` badge appears under the size input.
- Reserve some of that item in Inventory, then return — the badge
  updates to show `· available X`.
- Set Add Job's qty higher than available — the badge flips to
  the amber `⚠ Low availability` variant.

- [ ] **Step 5: Push**

```bash
git push
```

---

## Notes

- **Out of scope** — Phase 4 AI insights; swipe gestures; auto-release on job cancel; supplier autocomplete; per-supplier analytics.
- Each task leaves the build green.
