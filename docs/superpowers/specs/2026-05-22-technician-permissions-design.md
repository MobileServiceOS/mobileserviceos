# Technician Permissions — Design Spec

**Date:** 2026-05-22
**Status:** Approved
**Feature:** #10 from the product roadmap — technician permissions.

## Goal

Technicians log jobs and see job revenue (the price they charge),
but never see business profit, cost breakdowns, or margin. Harden
the existing role system to enforce that everywhere.

## Mechanism

The `canViewProfit` permission already exists (`permissions.ts` —
owner/admin `true`, technician `false`) but is **dormant**:
consumed nowhere. This feature wires it into every profit display.

`canViewRevenue` stays `true` for technicians — they set the price
on jobs they log, so revenue must stay visible. The revenue/profit
split is the whole point.

## Audit + gate

Every profit / cost / margin display gated on
`usePermissions().canViewProfit`:

| Screen | Change |
|---|---|
| `JobDetailModal.tsx` | the cost-breakdown block (Revenue / Tire+Parts+Material cost / Travel / Profit) renders fully for owner/admin; a technician sees a single **Revenue** row instead |
| `History.tsx` | the per-card profit line hidden when `!canViewProfit` |
| `Customers.tsx` | profit Stats (list rows' "profit", CRM profile's Profit stat, top-customer profit) hidden when `!canViewProfit`; revenue stays |
| `JobSuccessPanel.tsx` | post-save profit hidden when `!canViewProfit` |
| `AddJob.tsx` | pricing-breakdown profit + cost rows hidden when `!canViewProfit`; the suggested price stays (the tech needs it to set revenue) |
| `Dashboard.tsx` | already role-gated via `showCompanyData` (role === owner/admin); re-pointed at `canViewProfit` so there is ONE consistent gate |

## Already correct — verified, no change

- Expenses / Payouts / Insights — gated by `canViewFinancials`
  (technician `false`) via `MoreSheet`.
- Pricing settings — `canViewPricingSettings` /
  `canEditPricingSettings`.
- Job scoping — `useScopedJobs` (technicians see only their own
  jobs).

## Testing

Extend `tests/technicianPermissions.test.ts`:
- `canViewProfit` is `false` for technician, `true` for
  owner + admin.
- `canViewRevenue` stays `true` for technician (the split).

## Out of scope

- Photo upload (#8 — not selected).
- Data-export gating — the only export is the tire CSV in
  Inventory, already an owner-facing tire surface.

## Decisions locked during brainstorming

- Technicians see **revenue, never profit**.
