# Inventory Operations — Design

> **Phase 3** of the inventory upgrade. Adds the **reserved-inventory
> data model** + UI, a **supplier / purchase-source** field, and an
> **inventory-to-job matching badge** in Add Job.
>
> **Swipe gestures are deferred** — explained below. Phase 1 already
> exposes +/- inline on the card, and Phase 3 surfaces Reserve /
> Release as tap buttons in the expanded card. The same actions
> through swipe gestures would not materially speed the workflow
> and add real iOS/Android pointer-event reliability risk (the
> voice-logging scrap is a recent example). Phase 4 follows
> (AI insights). If swipe still has value after this phase ships,
> it gets its own brainstorm with a concrete reliability plan.

## Goal

Three additions to the tire-vertical inventory operations:

1. **Reserved inventory** — an operator can earmark some of an item's
   stock for an upcoming job (e.g. "2 reserved for 5 PM Smith job"),
   so a second tech doesn't accidentally promise the same tires.
2. **Supplier / purchase source** — record where each item came from
   (e.g. "Tire Hut", "Marketplace", "Wholesale warehouse"). Lays the
   groundwork for future supplier analytics without doing them yet.
3. **Matching-inventory badge in Add Job** — when the tech types a
   tire size, surface the matching in-stock count right by the
   input, so they know the inventory exists before they Save.

## Hard constraints

- No swipe gestures.
- No new Firestore collections — `reservations` and `purchaseSource`
  live on the existing `InventoryItem` document as additive fields.
- No auto-release on job cancel (manual release only, v1).
- No supplier analytics, no per-supplier dashboards (Phase 4+
  territory if ever).
- Mechanic + detailing inventory views unchanged.
- Available qty is computed live, never persisted separately:
  `availableQty = qty − sum(reservations[].qty)`.
- Existing Phase 1 (smart chips, qty ±, card hierarchy) and Phase 2
  (health buckets) flows preserved.

## Data model — additive

`InventoryItem` (in `src/types/index.ts`) gains two optional fields:

```ts
export interface ReservedSlot {
  /** Stable id for the reservation row — uid() at creation. */
  id: string;
  /** Quantity reserved against this slot (≥ 1). */
  qty: number;
  /** Optional free-text label ("5 PM Smith job", "Insurance hold"). */
  label?: string;
  /** ISO timestamp when this reservation was created. */
  createdAt: string;
}

// Added to InventoryItem:
//   reservations?: ReservedSlot[];
//   purchaseSource?: string;
```

`reservations` is intentionally NOT keyed to a `jobId` in v1 — the
operator types a free-text label. A future iteration can add a
typed `jobId` reference + auto-release on cancellation; this v1
slot already has the shape (an `id`-keyed row, `qty`, `label`,
`createdAt`) so the migration is additive when that day comes.

`purchaseSource` is a free-text string. No autocomplete in v1.

The deserializer in `src/lib/deserializers.ts` (or wherever
InventoryItem is parsed from Firestore JSON-string-encoded values)
needs to handle the new `reservations` array — same JSON pattern
as the existing fields it deserializes. `purchaseSource` is a
plain optional string and needs no special handling.

## Pure helpers — `src/lib/inventoryReservations.ts`

```ts
export function reservedQty(item: InventoryItem): number;
export function availableQty(item: InventoryItem): number;
export function addReservation(
  item: InventoryItem,
  qty: number,
  label?: string,
  now?: string,
): InventoryItem;
export function removeReservation(
  item: InventoryItem,
  reservationId: string,
): InventoryItem;
```

Rules:
- `reservedQty` sums `reservations[]?.qty`. Treats missing /
  non-finite as 0.
- `availableQty = max(0, item.qty − reservedQty)`. Cannot go
  negative even if a manual qty change makes the reservation
  exceed stock (visual flag instead — see UI section).
- `addReservation` returns a NEW item with the new slot pushed
  on. Pure — never mutates input. The slot's `id` comes from
  `uid()` (existing helper); `now` defaults to `new Date().toISOString()`.
- `removeReservation` returns a NEW item with the matching slot
  filtered out.
- Quantity validation: `addReservation` ignores requests where
  `qty <= 0` or `qty > availableQty(item)` (returns the item
  unchanged). The UI should already prevent this; the helper is
  the defense in depth.

## UI — Inventory page (tire vertical)

**Compact card header (existing):** add a single text element below
the existing sub-line **only when `reservedQty > 0`**:

```
🔒 2 reserved · 3 available
```

When `reservations` is empty, this line is not rendered (zero
visual cost). The line is amber (`var(--amber)`) at small font
(11 px) so it reads as a callout without competing with the size /
brand / qty.

**Expanded card (existing edit form):** add a new collapsible
"Reservations" sub-section between the existing Notes field and
the Value / Remove footer:

- For each reservation: a row showing `label` (or "—"), `qty`, and
  a small **Release** button that removes the slot via
  `removeReservation`.
- Below the list: an inline mini-form to add a new reservation —
  a `qty` `NumberField`, a `label` text input, and an **Add**
  button. The Add button is disabled while `qty <= 0`
  OR `qty > availableQty(item)`. Tapping Add calls
  `addReservation`, marks dirty, clears the inputs.

**Supplier input:** a new field in the expanded form next to (or
below) the existing Brand input — labeled **Source** with a
placeholder "Tire Hut · Marketplace · Wholesale…". Free-text,
optional, persisted as `purchaseSource`.

**Smart filter chips (Phase 1):** unchanged.
**Health buckets (Phase 2):** unchanged. Note: a healthy item with
zero available qty (all reserved) still reads as `healthy` from
the Phase 2 logic; the `🔒 reserved` line on the card warns
visually. Phase 4 can revisit the categorization if needed.

## UI — Add Job (tire vertical)

Below the existing tire-size input in Add Job, when the active
vertical has `features.inventoryDeduction === true` AND the size
input has a non-empty normalized match in inventory, render a
single-line badge:

```
✓ In stock: 2 × 225/65R17  ·  available 1
```

When `reservedQty > 0` AND `availableQty < requested qty`, the
badge colors amber and reads:

```
⚠ Low availability: 2 in stock, 1 reserved
```

When no inventory item matches the typed size, no badge renders
(consistent with existing Add Job — the auto-deduction logic
already handles the "no inventory" case silently). The badge is
**purely informational** — the existing
`planInventoryDeduction` flow at Save time is untouched.

## Files

- Modify `src/types/index.ts` — add `ReservedSlot` interface, add
  `reservations?` and `purchaseSource?` to `InventoryItem`.
- Modify `src/lib/deserializers.ts` — handle the JSON-stringified
  `reservations` field on read.
- Create `src/lib/inventoryReservations.ts` — `reservedQty`,
  `availableQty`, `addReservation`, `removeReservation`.
- Create `tests/inventoryReservations.test.ts` — logic tests.
- Modify `src/pages/Inventory.tsx` — `TireInventoryView`: card
  header `🔒` line, expanded-card Reservations sub-section,
  Source input.
- Modify `src/pages/AddJob.tsx` — matching-inventory badge below
  the tire-size input.
- Modify `src/styles/app.css` — `.inv-reserve-line`,
  `.inv-reservations`, `.inv-reservation-row`, `.inv-match-badge`.

## Edge cases

- **Sum of reservations > qty** (operator manually drops qty after
  reservations exist): card shows the reservation rows but
  `availableQty` clamps to 0. The amber `🔒` line tells the
  story; no exception is thrown.
- **Empty `label`**: row reads "—" in place of the label.
- **Reservation with non-finite qty** in stored JSON: treated as
  0 by `reservedQty`, ignored.
- **Mechanic / detailing items** with the new fields: the helper
  works on them but the mechanic / detailing views don't render
  the reservations UI (those views are untouched).

## Testing

`tests/inventoryReservations.test.ts` (hand-rolled `tsx` runner):

- `reservedQty` sums slot qty correctly; empty / missing → 0.
- `reservedQty` treats non-finite slot qty as 0.
- `availableQty` = qty − reserved, clamped to 0.
- `addReservation` returns a new item with the slot appended;
  original input is not mutated.
- `addReservation(qty=0)` returns the item unchanged.
- `addReservation(qty > availableQty)` returns the item unchanged.
- `addReservation` populates `id`, `qty`, optional `label`, and
  `createdAt` (matches `now` parameter when provided).
- `removeReservation` returns a new item with the matching slot
  removed; unknown id → returned unchanged.
- `removeReservation` preserves other slots.

Inventory UI + Add Job badge are verified manually.

## Out of scope (later)

- **Phase 4** — AI inventory insights.
- **Auto-release on job cancel** — Phase 3.5 or later. Requires
  job-lifecycle integration.
- **Per-supplier analytics** — possibly Phase 4.
- **Swipe gestures** — see opening rationale.
- **Reservation by jobId** — v1 stores free-text labels; a typed
  `jobId` link plus auto-release lives in a follow-up.
