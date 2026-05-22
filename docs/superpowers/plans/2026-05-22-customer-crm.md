# Customer CRM — Implementation Plan

> Spec: `docs/superpowers/specs/2026-05-22-customer-crm-design.md`

**Goal:** Customers tab becomes List ⇄ Profile; profiles derive
from jobs + carry one editable persisted note.

---

### Task 1: `src/lib/customers.ts` — pure derivation + test

**Files:** Create `src/lib/customers.ts`, `tests/customerProfiles.test.ts`

- [ ] `customerKey(job)`: `'p_' + phone.replace(/\D/g,'')` if phone
  has digits; else `'n_' + name.trim().toLowerCase().replace(/[^a-z0-9]+/g,'-')`;
  else `''`.
- [ ] `CustomerProfile` interface: key, name, phone, email,
  jobCount, isRepeat, revenue, profit, firstDate, lastDate, jobs[],
  tireSizes[], vehicles[], paymentMethods[], reviewsSent,
  unpaidCount, unpaidTotal.
- [ ] `deriveCustomerProfiles(jobs, settings): CustomerProfile[]` —
  group by customerKey, skip empty keys, aggregate; profit via
  `jobGrossProfit`; unpaid via `resolvePaymentStatus(j) !== 'Paid'`;
  distinct non-empty tireSizes / vehicleMakeModel / paymentMethod;
  sort by revenue desc.
- [ ] Test: phone-format normalization collapses to one key; name
  fallback; empty → skipped; aggregation totals; isRepeat;
  dedup of sizes/vehicles/methods; unpaid count + total; sort;
  a mechanic job (partsCost) profits correctly.
- [ ] `npx tsx tests/customerProfiles.test.ts` → pass.

### Task 2: Customers.tsx — list using the new module

**Files:** Modify `src/pages/Customers.tsx`

- [ ] Replace the inline `customers` useMemo with
  `deriveCustomerProfiles(jobs, settings)`.
- [ ] List rows: add a repeat-customer badge when `isRepeat`.
- [ ] Each row becomes tappable → sets `selectedKey`.
- [ ] `npm run build` → clean (list still works).

### Task 3: Customers.tsx — Profile view

**Files:** Modify `src/pages/Customers.tsx`

- [ ] Add `selectedKey` state. When set, render the Profile view
  instead of the list; a back button clears it.
- [ ] Profile renders: name + contact (call/sms buttons), repeat
  badge, lifetime revenue/profit/jobCount, first/last seen,
  vehicles OR tire sizes (whichever non-empty), payment methods,
  reviews-sent count, unpaid count + total, and the job-history
  list (reuse the existing row styling).
- [ ] Note editor: `useState` for note text + a loaded flag.
  `useEffect` fetches `customers/{key}` via `getDoc` when
  `selectedKey` changes. Textarea + Save button, gated to
  owner/admin via `usePermissions`; non-owner sees read-only text.
  Save → `fbSet(scopedCol(businessId,'customers'), key, {note, updatedAt})`.
- [ ] `npm run build` → clean.

### Task 4: Verify + ship

- [ ] `npm run build` clean; `npm test` (42 logic suites) green;
  `npm run test:ui` (18 component) green.
- [ ] Commit + push.
