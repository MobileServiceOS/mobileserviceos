# Insights Page — Design Spec

**Date:** 2026-05-22
**Status:** Approved
**Feature:** #11 from the product roadmap — financial dashboard upgrade.

## Goal

Give owners a "review the business" analytics view: revenue
trends, top services, lead sources, profit by city, repeat-customer
rate, and unpaid-invoice aging — without bloating the daily-driver
Dashboard.

## Architecture

A dedicated owner/admin page `src/pages/Insights.tsx`, opened from
the **More** menu. New `TabId` value `'insights'`. Every metric is
derived live from the job list — no new collection, no storage,
no migration.

## Derivation — `src/lib/insights.ts` (new, pure, tested)

A single `computeInsights(jobs, settings, today)` → `Insights`:

```ts
interface Insights {
  revenueTrend: { weekStart: string; revenue: number; profit: number }[]; // last 8 weeks, oldest→newest
  topServices:  { service: string; revenue: number; profit: number; count: number }[]; // by profit desc
  topSources:   { source: string; revenue: number; count: number }[];     // by revenue desc
  topCities:    { city: string; profit: number; count: number }[];        // by profit desc
  repeat:       { total: number; repeat: number; pct: number };
  unpaidAging:  { bucket: '0-7d'|'8-30d'|'31-60d'|'60d+'; count: number; total: number }[];
}
```

- Profit everywhere via `jobGrossProfit` (vertical-correct —
  subtracts partsCost for mechanic).
- `revenueTrend` buckets by `getWeekStart`; always returns 8
  entries (zero-filled weeks included) so the chart is stable.
- Rankings are all-time; `revenueTrend` carries the time axis.
- `unpaidAging` — jobs where `resolvePaymentStatus(j) !== 'Paid'`,
  bucketed by days between `today` and `job.date`.
- `repeat` reuses `deriveCustomerProfiles` (CRM module).

## Display — `src/pages/Insights.tsx` (new)

Six cards, hand-rolled with existing CSS tokens — **no charting
library**:
- Revenue trend → CSS bar columns (8 weeks).
- Top services / sources / cities → labeled rows with proportional
  bars.
- Repeat % → a single big stat.
- Unpaid aging → compact table.

## Files

| File | Change |
|---|---|
| `src/lib/insights.ts` | **new** — `computeInsights` + types |
| `src/pages/Insights.tsx` | **new** — the page |
| `src/types/index.ts` | add `'insights'` to `TabId` |
| `src/App.tsx` | route the `insights` tab in `tabContent` |
| More-menu component | add an "Insights" entry, owner/admin gated |

## Testing

`tests/insights.test.ts` — week bucketing (incl. zero-fill),
ranking sort order, repeat %, aging-bucket boundaries,
multi-vertical profit (mechanic partsCost subtracted), empty input.

## Out of scope (explicit)

- **Average response time** — needs lead-created timestamps the
  app doesn't record.
- **Conversion rate** — needs persisted quote records; Quick Quote
  is ephemeral. Both require new data-capture first.

## Decisions locked during brainstorming

- Placement: **dedicated Insights page** (from the More menu),
  not appended to the Dashboard.
