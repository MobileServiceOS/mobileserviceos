# Technician Permissions — Implementation Plan

> Spec: `docs/superpowers/specs/2026-05-22-technician-permissions-design.md`

**Goal:** Wire the dormant `canViewProfit` permission into every
profit display so technicians see revenue but never profit.

---

### Task 1: Test the permission contract first

**Files:** Modify `tests/technicianPermissions.test.ts`

- [ ] Assert `canViewProfit` false for technician, true for
  owner + admin; `canViewRevenue` true for technician.
- [ ] `npx tsx tests/technicianPermissions.test.ts` → pass
  (the flag values already exist in permissions.ts).

### Task 2: JobDetailModal

**Files:** Modify `src/components/JobDetailModal.tsx`

- [ ] `const { canViewProfit } = usePermissions();`
- [ ] When `canViewProfit`: render the cost breakdown as today.
  When not: render a single `<Row label="Revenue" .../>` only.
- [ ] `npx tsc --noEmit` clean.

### Task 3: History

**Files:** Modify `src/pages/History.tsx`

- [ ] Hide the per-card profit line when `!canViewProfit`
  (`usePermissions`).

### Task 4: Customers + CRM

**Files:** Modify `src/pages/Customers.tsx`

- [ ] Pass `canViewProfit` (already has `useMembership`; add
  `usePermissions` or read from membership).
- [ ] Hide: list top-customer "profit" line, CRM Profile "Profit"
  Stat. Revenue stays.

### Task 5: JobSuccessPanel

**Files:** Modify `src/components/JobSuccessPanel.tsx`

- [ ] Hide post-save profit when `!canViewProfit`.

### Task 6: AddJob pricing breakdown

**Files:** Modify `src/pages/AddJob.tsx`

- [ ] Hide the breakdown's profit + cost rows when `!canViewProfit`;
  keep the suggested-price tiles.

### Task 7: Dashboard — align to canViewProfit

**Files:** Modify `src/pages/Dashboard.tsx`

- [ ] Replace the inline `role === owner/admin` `showCompanyData`
  with `usePermissions().canViewProfit` so there is one gate.
  (Behaviorally identical — owner/admin true, tech false.)

### Task 8: Verify + ship

- [ ] `npm run build` clean; `npm test` green; `npm run test:ui` green.
- [ ] Commit + push.
