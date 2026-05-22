# Inventory Polish v1 — Design

> **Phase 1** of the inventory upgrade (per the chained roadmap).
> Visual + UX polish on the tire-vertical Inventory page only.
> NO data-model changes. NO Firestore schema changes. NO AI calls.
> NO swipe gestures. NO photos. NO reserved-inventory or supplier
> fields. Those land in Phase 2 / 3 / 4.

## Goal

Make the tire-vertical Inventory page scan faster on a phone,
surface what matters at a glance (size · brand · qty), and let a
tech adjust quantity without expanding the card. Pure visual /
JSX / small filter logic.

## Hard constraints

- Touches **only** `src/pages/Inventory.tsx` (`TireInventoryView`),
  `src/styles/app.css`, and a new pure-helper module.
- No new fields on `InventoryItem`.
- Mechanic + detailing inventory views unchanged.
- Existing flows preserved: expand-to-edit, hot sizes, CSV upload,
  delete-all, condition filter, Save Inventory button.
- Mobile-first; every interactive control has a ≥44 px tap target.

## Changes

### 1. Card hierarchy refinement

The compact card header already has tire size on the left and qty
on the right — refine, don't restructure:

- **Tire size** — bump from 19 px → 22 px, keep weight 800, keep
  letter-spacing −.2 px. Primary scan key.
- **Sub-line** — merge brand + condition into a single line with a
  `·` separator (the existing layout shows brand alone, with
  condition only as a pill-badge). New rule:
  - brand present, condition = "Used" → `Michelin · Used`
  - brand present, condition = "New" → `Michelin` (omit "New" — it's
    the dominant case and a badge would be noise)
  - brand empty, condition = "Used" → `No brand · Used`
  - brand empty, condition = "New" → `No brand`
- **Drop the "Used" pill-badge** that currently renders next to the
  size — it duplicates information now shown in the sub-line. The
  `Low` and `Out` badges stay.
- **Tighter vertical spacing** — header padding `12px 14px` →
  `10px 12px`; sub-line `marginTop` 3 → 2.

### 2. Inline qty ± controls

In the compact card header (no expand needed), to the **left** of
the existing big qty number, add a vertical pair:

```
[+]
[−]
```

Each button is ≥44 px wide × 22 px tall (stacked ≈ 44 px combined
height, matching the qty number height) with the existing card
border style. Tapping `+` increments `i.qty`; tapping `−`
decrements (disabled at 0). Tapping either marks the list dirty —
the existing sticky **Save Inventory** button surfaces and the
operator confirms before persistence. **The card does not expand
on a +/− tap.** `e.stopPropagation()` keeps the qty buttons from
toggling the card's expanded state.

### 3. Filter chips expansion

The existing single condition chip row becomes two stacked rows
(both render above the inventory list, below search):

**Row 1 — Condition** (single-select, existing): `All` · `New` · `Used`

**Row 2 — Smart filters** (multi-select, new): `Run Flat` · `Truck` ·
`Commercial` · `Tesla` · `Trailer` · `Low Profile` · `SUV`

Smart filters work over the existing data — no new fields. Matching
is pure-substring on the item's `brand` / `model` / `notes` /
`size` fields (case-insensitive), with **one heuristic exception**
for `Low Profile`:

| Chip | Match rule |
|---|---|
| Run Flat | substring `run flat` in any of brand / model / notes |
| Truck | substring `truck` in any of brand / model / notes |
| Commercial | substring `commercial` in any of brand / model / notes |
| Tesla | substring `tesla` in any of brand / model / notes |
| Trailer | substring `trailer` in any of brand / model / notes |
| **Low Profile** | parsed aspect ratio `< 50` from a `WWW/AARR…`-shape size (e.g. `245/40R18` → 40 → matches), OR substring `low profile` |
| SUV | substring `suv` in any of brand / model / notes |

When multiple smart chips are active, an item must match **every**
active chip (intersection). When zero smart chips are active, the
smart row is a no-op. The condition chip row applies independently
(also intersected). The existing `search` query applies last, on
top of the filtered set — preserving the current tier ranking.

The matching logic lives in `src/lib/inventoryFilters.ts` as a
pure helper:

```ts
export type SmartChip =
  | 'Run Flat' | 'Truck' | 'Commercial' | 'Tesla'
  | 'Trailer' | 'Low Profile' | 'SUV';

export const SMART_CHIPS: SmartChip[] = [
  'Run Flat', 'Truck', 'Commercial', 'Tesla',
  'Trailer', 'Low Profile', 'SUV',
];

export function matchesSmartChip(item: InventoryItem, chip: SmartChip): boolean;
```

Pure, no I/O, no React — tested in `tests/inventoryFilters.test.ts`.

### 4. Brand visibility

The current card hides the sub-line entirely when brand is empty.
The new rule renders the sub-line always, with "No brand" as the
fallback brand text (see §1). This makes the absence of brand info
visible at scan time so the tech can fill it in.

### 5. UI polish

- Tighter card header padding (§1).
- Inline qty ± buttons styled as small bordered chips reusing the
  existing `.chip` token vocabulary (border + radius + colour
  tokens already defined in `:root`). New class `.inv-qty-btn`.
- Wrapping container for the qty cluster: `.inv-qty-cluster`.
- Smart-filter chip row uses the existing `.chip.sm` class plus an
  `.active` variant — no new chip style.

## Edge cases

- **New unsaved item** (`_isNew: true`) — auto-expands today, still
  auto-expands. The qty ± buttons render but the card is already
  open; tapping them does not toggle expansion.
- **qty already at 0** — `−` button is `disabled` (CSS opacity .4,
  no pointer events).
- **Filter chips + search** — chips filter first, search runs on
  the filtered subset (existing search ranking preserved).
- **Malformed size string** — heuristic-only chips (`Low Profile`)
  fail to match; substring chips still match if their keyword is
  in brand / model / notes.
- **Mechanic / detailing inventory** — untouched.

## Testing

`tests/inventoryFilters.test.ts` (hand-rolled `tsx` runner):

- substring chips match on brand / model / notes (case-insensitive)
- substring chips reject when the keyword is absent
- `Low Profile` matches by aspect ratio (e.g. `245/40R18` → match)
- `Low Profile` matches by substring fallback (e.g. notes "low profile")
- `Low Profile` rejects when aspect ratio ≥ 50 AND no substring
- malformed size + no substring → rejects
- `SMART_CHIPS` list contains all 7 chips in the documented order

UI-level behaviour (card hierarchy, qty ± buttons, two-row chip
row) is verified manually in Task 3.

## Files

- Create `src/lib/inventoryFilters.ts` — `SmartChip` type, `SMART_CHIPS`
  list, `matchesSmartChip()`.
- Create `tests/inventoryFilters.test.ts` — logic tests.
- Modify `src/pages/Inventory.tsx` — `TireInventoryView` card-header
  JSX (size bump, sub-line merge, qty cluster) + smart-filter
  chip row + filter pipeline integration.
- Modify `src/styles/app.css` — `.inv-qty-cluster`, `.inv-qty-btn`,
  `.inv-card-sub`, small spacing tweaks. ~30 lines.

## Out of scope (later phases)

- **Phase 2** — categorized health (critical / low / healthy /
  dead), virtualized list if needed.
- **Phase 3** — swipe actions, reserved inventory data model,
  supplier / purchase-source tracking, inventory-to-job matching
  improvements.
- **Phase 4** — AI inventory insights.
