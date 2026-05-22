# Customer CRM — Design Spec

**Date:** 2026-05-22
**Status:** Approved
**Feature:** #5 from the product roadmap — customer profiles / CRM.

## Goal

Turn the flat read-only Customers list into a CRM: tap a customer
to drill into a full profile — job history, lifetime totals,
repeat-customer badge, vehicles/tire sizes seen, payment methods
used, review status — plus one editable operator note.

## Architecture

The Customers tab gains two states: **List ⇄ Profile**, switched by
local state in `Customers.tsx` (a `selectedKey` string | null), with
a back button. Self-contained — no App.tsx changes, no new
top-level listener.

## Data model

**Derived (live from jobs)** — extracted into a new pure, tested
module `src/lib/customers.ts`:

- `customerKey(job)` → a Firestore-safe, normalized key:
  `'p_' + digitsOnly(phone)` when a phone exists, else
  `'n_' + slug(nameLowercased)`, else `''` (skip). Digit-normalizing
  the phone also fixes a latent bug — the old key used the raw
  phone string, so the same customer with differently-formatted
  phones split into two records.
- `deriveCustomerProfiles(jobs, settings)` → `CustomerProfile[]`
  sorted by lifetime revenue desc. Per customer:
  name, phone, email, jobCount, **isRepeat** (`jobCount > 1`),
  lifetime revenue + profit (profit via the vertical-correct
  `jobGrossProfit`), firstDate, lastDate, **tireSizes** (distinct,
  non-empty), **vehicles** (distinct `vehicleMakeModel`),
  **paymentMethods** (distinct), **reviewsSent** (count of jobs
  with `reviewRequested`), **unpaidCount** + **unpaidTotal**.

tireSizes vs vehicles render self-gating (show whichever is
non-empty) — no tire-shaped assumption.

**Persisted (the one editable bit)** — a business-scoped
`customers/{customerKey}` doc: `{ note: string, updatedAt: string }`.
The Profile view fetches its note on open (`getDoc`), saves on
demand (`fbSet`). Nothing else is persisted.

- Reads: allowed — the `match /{document=**}` wildcard grants
  member read on all business-scoped docs.
- Writes: the `customers/{docId}` rule restricts writes to
  owner/admin. So the note editor is **UI-gated to owner/admin**
  (role from `usePermissions`); technicians see the note read-only.
  No firestore.rules change.

## Files

| File | Change |
|---|---|
| `src/lib/customers.ts` | **new** — `customerKey`, `deriveCustomerProfiles`, `CustomerProfile` type |
| `src/types/index.ts` | re-export / reference `CustomerProfile` if needed (type may live in customers.ts) |
| `src/pages/Customers.tsx` | reworked — list (repeat badges, derive via the new module) + in-page Profile view (history, totals, vehicles/sizes, payment methods, review status, editable note) |

## Testing

- `tests/customerProfiles.test.ts` (tsx runner) — `customerKey`
  normalization (phone formats collapse, name fallback, empty);
  `deriveCustomerProfiles` aggregation, repeat detection,
  tire-size + vehicle dedup, payment-method collection, lifetime
  totals, unpaid count, sort order, multi-vertical.

## Out of scope (deliberate)

- No tags / segments — one Notes field only.
- No editing of customer name/phone — those derive from jobs.
- No customer-merge UI.
- No App.tsx `customers` collection listener — the Profile view
  fetches its tiny note doc on demand.

## Decisions locked during brainstorming

- Data model: **derived + one editable Notes field** (persisted
  `customers/{key}` doc), not fully read-only.
- Detail view: **in-page drill-down** (List ⇄ Profile), not a modal.
