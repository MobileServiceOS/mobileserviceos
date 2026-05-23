# Premium Operational Polish — Phase 1

> **Phase 1 of 5.** Visual / hierarchical polish on the three
> most-trafficked surfaces — Dashboard, Quick Quote, Job History.
> No new data, no new pages, no new persistence. CSS + JSX only.
> Subsequent phases: smart forms, technician mode, performance,
> fleet portal.

## Goal

Bring the three most-trafficked screens up to a "premium field
operations" feel:

- **Dashboard** surfaces what a tech needs FIRST — active jobs,
  pending payments, today's revenue, low-stock alerts — and
  pushes analytics down the page.
- **Quick Quote** stays scannable: Suggested / Premium / Custom +
  Start Job CTA always visible; advanced internals collapsed
  behind a "Details" toggle so the hero of the surface isn't
  visually buried.
- **History** reads dense and professional with clearer service
  differentiation, tighter price hierarchy, and compact payment
  badges.

## Hard constraints

- No new fields on Job / InventoryItem / Settings.
- No new routes, pages, or Firestore collections.
- No new AI features.
- Existing mobile density preserved or improved.
- All existing functionality intact (Quick Quote engine, Custom
  tile, AI Inventory Insights, AI Insights, Save Inventory, etc.).
- Existing role gating (canViewProfit, canViewFinancials,
  canManageOwners) untouched.

## 1. Dashboard — operational reorder

Today's order on `src/pages/Dashboard.tsx`:

1. Hero KPI ring + sub-KPIs (revenue / profit / costs)
2. Today block (quick "what did today produce")
3. Quick Actions row
4. Vertical Stats section (mechanic / detailing; empty for tire)
5. Pending Payments (owner / admin)
6. Quick Quote
7. Lead Sources (owner / admin)
8. Recent jobs

Reordered to operational priority:

1. Hero KPI ring (unchanged — still the headline)
2. **Today operational panel** (the existing Today block, refined
   — see below)
3. **Pending Payments**  (promoted above Quick Actions — actionable
   urgency, not a metric)
4. Quick Actions row
5. Vertical Stats section
6. Quick Quote
7. Lead Sources
8. Recent jobs

**Today operational panel refinements** (the block at line 471):

- Keep the same data (today's revenue, today's job count, etc.).
- Add a fourth compact stat: **low-stock count** (already computed
  upstream — `lowStock` const on line 330). Tappable: routes to
  Inventory.
- Add a fifth compact stat: **active jobs count** (`Pending`-status
  visible jobs). Tappable: routes to History with the Pending
  filter applied.
- Tighten the block's vertical padding — currently each stat row
  has generous space; compress so the entire panel fits in ~80–90
  px on mobile.
- For technicians (no profit visibility), the panel shows: today's
  jobs · assigned jobs · low stock · pending payments visible-to-them.
  Existing role gating is preserved.

## 2. Quick Quote — details collapse

The Quick Quote currently renders, top-to-bottom on Dashboard:

- Section label "Quick Quote"
- Service / Vehicle selects
- Miles / (tire-vertical: Tire $) / Qty inputs
- Condition chips (Emergency / Late / Hwy / Wknd)
- Suggested / Premium / Custom tiles
- `qq-meta` line: "Direct cost · target profit"
- Start Job CTA

Refinement:

- Service / Vehicle / Miles / Qty / Tire $ / Condition chips
  **stay always visible** — these drive the quote and must remain
  fast to change.
- Suggested / Premium / Custom tiles + Start Job CTA stay always
  visible — primary action surface.
- The `qq-meta` line ("Direct cost · target profit") moves behind a
  **`Details ▾`** toggle button, **collapsed by default**. Tapping
  it expands to reveal the meta line. State is local to the
  Dashboard render — closes on page leave; no persistence needed.
  Purpose: reduce the surface's vertical bloat while keeping the
  data one tap away.

The toggle is rendered as a small dim text button (`.qq-details-toggle`)
between the tiles and the Start Job CTA. Closed state: "Details ▾".
Open state: "Hide details ▴". The meta line lives in the same
position it does today, simply gated by the toggle's state.

## 3. History card refinements

The current `HistoryJobCard` (`src/pages/History.tsx` line 152):

- Service icon · customer name + tire size pill · service · city · date · tech
- Revenue · profit · payment pill · payment-method label
- Mark Paid footer when unpaid

Refinements (all density / hierarchy — no data changes):

- **Card padding** tighter: from the existing inline padding
  values down by ~25 % vertically. Mobile target: ~58–62 px row
  height (excluding the unpaid footer) instead of ~74 px.
- **Service icon**: keep the existing `serviceIcon(job.service)`
  helper but render in a slightly stronger weight / size so
  different services scan apart faster (e.g. 22 px vs the current
  inline size). One CSS rule, no JS.
- **Date format**: switch from `fmtDate(j.date)` (`May 22, 2026`)
  to `fmtDateShort(j.date)` (`May 22`) in the meta line.
  `fmtDateShort` is a small new helper in `src/lib/utils.ts`. The
  full date stays available in tooltips / on tap to the detail
  modal.
- **Revenue** stays the same size (16 px green).
- **Profit** dims slightly (11 px, kept on its own line).
- **Payment pill**: keep current `paymentPillClass(ps)` colors,
  reduce padding from `4px 9px` to `3px 7px` — a small visual
  quiet.
- **Tire size pill**: drop from 9 px to a slightly larger 10 px
  (more scannable) but lighten the background opacity (less
  visual weight).

These are all CSS / inline-style refinements — the `HistoryJobCard`
shape and props don't change.

## Files

- Modify `src/pages/Dashboard.tsx` — section reorder + Today panel
  refinements.
- Modify `src/pages/History.tsx` — card density polish.
- Modify `src/lib/utils.ts` — add `fmtDateShort`.
- Modify `src/styles/app.css` — `.operational-panel`,
  `.qq-details-toggle`, `.job-card`-related polish.

## Testing

No new pure logic to test (most changes are JSX / CSS).
`fmtDateShort` is small enough to add a couple of cases to the
existing utils test if one exists; otherwise inlined verification
via the running build.

UI is verified manually per the user's directive ("audit screens
and improve every weak area automatically").

## Out of scope

- **Phase 2** — Add Job smart-forms (service-driven field reveal).
- **Phase 3** — Technician Mode (persona + dedicated nav).
- **Phase 4** — Performance pass (memoization, lazy routes,
  virtualized lists if measured needed).
- **Phase 5** — Fleet / Commercial Portal (new subsystem).
- Inventory polish — already strong from the recently-shipped
  four-phase inventory upgrade.
- AI Insights / AI Inventory Insights polish — content is
  already concise; layout untouched in Phase 1.
- Skeleton loaders — folded into Phase 4 (performance) where
  they belong alongside the actual perceived-performance work.
