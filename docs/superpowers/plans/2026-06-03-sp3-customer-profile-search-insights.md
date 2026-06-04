# Customer Profile + Global Search + Insights + Backfill + Customer Directory Settings (SP3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the big customer-intelligence pile from the v3.2 spec — a real CustomerHub list, a deep CustomerProfile page (header + Insights card + Quick Notes editor + Vehicles + Service Timeline + Service History Photos + 11-button Quick Actions row), a sub-300ms GlobalSearchSheet wired to the main nav, a transactional `backfillCustomers` Cloud Function with Settings admin button, an `onJobWriteCustomerRollup` debounced Cloud Function trigger that maintains `averageTicket` / `vipTier` / `customerStatus` on the Customer doc, the Customer Directory + Communications (priority slice) Settings accordions, and the "Test Incoming Call" admin action that lets SP6 dogfood end-to-end without Twilio being connected. After SP3 lands, the operator can: tap a customer row, drill into the full profile, eyeball nine insights metrics with a VIP progress hint, edit Quick Notes inline, scroll service history, browse aggregated photos by service type, hit any of 11 Quick Actions, search "Tesla" / "235/45R18" / "Hollywood" from the global search icon, flip the auto-save toggle, run a one-shot backfill that organizes every existing job into Customer + Vehicle records, and fire a Test Incoming Call to exercise the dormant SP6 popup pipeline.

**Architecture:** SP3 adds (a) one pure helper (`searchCustomers.ts`) consuming the composite indexes defined here, (b) three new mode-over-jobs helpers added to the existing `customerInsights.ts`, (c) six new presentational components (`CustomerInsightsCard`, `CustomerNotesSection`, `VehiclesSection`, `ServiceTimeline`, `ServiceHistoryPhotos`, `GlobalSearchSheet`), (d) two new pages (`CustomerProfile.tsx` and the real `CustomerHub.tsx` content replacing the SP1 skeleton), (e) two new Settings accordions (`CustomerDirectorySettingsSection`, `CommunicationsSettingsSection` priority slice), and (f) two new Cloud Functions (`backfillCustomers` callable + `onJobWriteCustomerRollup` Firestore trigger). All Firestore writes from existing SP1/SP2 helpers are reused — SP3 only introduces ONE new write path (Quick Notes inline edit) plus the Test Incoming Call admin write that was already allowlisted by SP1 Task 7. The 30s debounce on `onJobWriteCustomerRollup` uses an in-process Map keyed by `customerId` — no external scheduler. The `backfillCustomers` function invokes the SP1 transactional `upsertCustomerFromJob` helper per-job in batches of ~10-20 (NOT a precomputed bulk write — per the spec's live-write-concurrency contract).

**Tech Stack:** TypeScript, React, Firebase Firestore client SDK (web), firebase-admin (Cloud Functions), `tsx` test runner via `tests/*.test.ts` pattern, no new runtime dependencies.

---

## Pre-flight: Repo conventions reference

Read these once before starting any task:

- **Test runner contract** (from `package.json:13`): `npm test` executes `for f in tests/*.test.ts; do echo "▶ $f"; tsx "$f" || exit 1; done`. Each test file is a standalone tsx script using `console.log` for output and `process.exit(failed > 0 ? 1 : 0)` to signal pass/fail. SP1 and SP2 shipped multiple test files in this pattern — see [`tests/phone.test.ts`](../../../tests/phone.test.ts), [`tests/customerEntity.test.ts`](../../../tests/customerEntity.test.ts), [`tests/customerInsights.test.ts`](../../../tests/customerInsights.test.ts), [`tests/lookupCustomerByPhone.test.ts`](../../../tests/lookupCustomerByPhone.test.ts). Every SP3 test file MUST use the same harness:

  ```ts
  let passed = 0;
  let failed = 0;
  function check(name: string, cond: boolean, detail?: string): void {
    if (cond) { passed++; console.log(`  ✓ ${name}`); }
    else { failed++; console.error(`  ✗ ${name}${detail ? `  — ${detail}` : ''}`); }
  }
  function eq<T>(actual: T, expected: T): boolean {
    return JSON.stringify(actual) === JSON.stringify(expected);
  }
  // ... checks ...
  console.log(`  ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
  ```

  Do NOT pull in vitest / jest / @testing-library — the runner is `tsx` directly. Component tests in SP3 test the PURE HELPERS extracted from each component (not the JSX rendering surface). The component file exports its render-decision helpers via a `__pureHooks` object exactly like [`src/components/addJob/CustomerLookupCard.tsx:329-334`](../../../src/components/addJob/CustomerLookupCard.tsx).

- **Path alias:** `@/` maps to `src/` (verified in `tsconfig.json` and existing SP1/SP2 test imports such as `import { normalizePhone } from '@/lib/phone';`).

- **Type-check + build:** `npm run build` runs `tsc --noEmit && vite build`. `npm run typecheck` is `tsc --noEmit`. Both must pass before committing.

- **Firestore client SDK style:** the repo writes via `fbSetFast` (`src/lib/firebase.ts`). SP1 introduced `runTransaction` for the Customer upsert. SP3 ONLY introduces ONE new write path (Quick Notes inline edit) — this is a small merge update of allowlisted fields and SHOULD use `setDoc(ref, patch, { merge: true })` directly (not `fbSetFast`, because the Quick Notes patch is a plain string map with no `FieldValue` instances and the merge semantic matters). All other SP3 writes either reuse `upsertCustomerFromJob` (Backfill, Quick Actions Create Job draft) or use a single-doc `setDoc` merge for the Test Incoming Call synthetic doc (whose rule precondition requires `request.resource.data.createdAt is timestamp`, so the client MUST write `Timestamp.now()` from `firebase/firestore`).

- **Cloud Functions style:** existing functions (`functions/src/scheduledDeletionPurge.ts`, `functions/src/onSubscriptionWrite.ts`) use `firebase-admin` v12 + `firebase-functions/v2`. Backfill = `onCall` from `firebase-functions/v2/https`. Trigger = `onDocumentWritten` from `firebase-functions/v2/firestore`. The functions package has its own `package.json` + `tsconfig.json` — SP3 does NOT need to add new deps. Functions tests live alongside the source as `functions/tests/*.test.ts` and run via `cd functions && npm test` (separate harness — see `functions/package.json`).

- **Keystroke-storm regression** ([`src/components/addJob/MemoInput.tsx`](../../../src/components/addJob/MemoInput.tsx)): every text input that lives inside a parent that re-renders on each keystroke MUST be a `MemoInput` / `MemoTextarea` bound to a `useCallback`-stable setter. SP3 components that own text inputs (`GlobalSearchSheet`'s query input, `CustomerNotesSection`'s 8 editable fields, `CustomerProfile` Edit affordances) MUST follow the same pattern. The spec calls this out at spec line 1968: *"Single text input using the `MemoInput` pattern with a `useCallback`-wrapped `onChange` and 200ms debounce."*

- **No `Date.now()` in render bodies** for time-sensitive UI: use `useMemo(() => formatRelative(...), [iso])` for relative-time labels. Don't introduce per-second ticks. (The 30s rollup-staleness check in CustomerInsightsCard is allowed to call `Date.now()` ONCE during the load-time recompute decision — that's a one-shot derivation, not a per-frame tick.)

- **Spec source of truth:** `docs/superpowers/specs/2026-06-03-customer-intelligence-design.md`. All section references use `§"..."` names from that file. The SP3 scope block lives at spec line 2507 (`### SP3 — Customer Profile + Global Search + Insights + Backfill + Customer Directory Settings`).

- **Commit hygiene:** the user's memory file says NO squash commits — make one commit per task. Each commit message is a single line followed by a brief body.

- **SP1 + SP2 shipped foundations SP3 consumes:**
  - `src/lib/phone.ts` — `normalizePhone`, `formatPhoneForDisplay`, `isValidPhone`
  - `src/lib/customerEntity.ts` — `Customer`, `Vehicle` types + `upsertCustomerFromJob` transactional helper
  - `src/lib/customerInsights.ts` — `deriveVipTier`, `deriveCustomerStatus` (SP3 extends with `computeMostCommon*` helpers)
  - `src/lib/lookupCustomerByPhone.ts` — phone → customer + vehicles + lastJob
  - `src/lib/usZips.ts` — bundled US ZIP table
  - `src/components/addJob/CustomerLookupCard.tsx` — returning-customer card (SP3 enables its disabled View History button)
  - `src/components/addJob/AddressAutofillInput.tsx` — ZIP-first address inputs (consumed by Quick Notes / future CustomerProfile edit)
  - `src/pages/CustomerHub.tsx` — currently the SP1 skeleton wrapping legacy `src/pages/Customers.tsx` (SP3 replaces the body)
  - Settings schema fields shipped in SP1 (`src/types/index.ts:1133-1152`): `autoSaveCustomersFromJobs`, `twilioConnected`, `communicationProvider`, `incomingCallLookupEnabled`, `incomingSMSLoggingEnabled`, `missedCallAutoTextEnabled`, `outboundSMSEnabled`, `outboundCommunicationProvider`
  - Firestore rules already allowlist every field SP3 writes — see [`firestore.rules:613-674`](../../../firestore.rules). Quick Notes are in the meta-only write allowlist (line 620-623). Test Incoming Call writes are governed by the `incomingCalls/{callId}` block (lines 664-673). SP3 does NOT need a rules delta unless the Settings rules block needs new identity keys (see Task 15 verification).

---

## File structure (locked before tasks)

**Create:**

- `src/lib/searchCustomers.ts` — parallel multi-field global-search helper (Task 1)
- `tests/searchCustomers.test.ts` — prefix-query + ranking regression tests (Task 1)
- `tests/customerInsightsModes.test.ts` — most-common-X mode helper tests (Task 2)
- `src/components/customers/CustomerInsightsCard.tsx` — 9-metric card + VIP progress subline (Task 3)
- `tests/components/CustomerInsightsCard.test.ts` — pure-logic test of the metric derivation (Task 3)
- `src/components/customers/CustomerNotesSection.tsx` — 8-field Quick Notes editor (Task 4)
- `tests/components/CustomerNotesSection.test.ts` — pure-logic test of the dirty/patch helper (Task 4)
- `src/components/customers/VehiclesSection.tsx` — vehicles chip list + detail expansion (Task 5)
- `tests/components/VehiclesSection.test.ts` — pure-logic test of the vehicle label helper (Task 5)
- `src/components/customers/ServiceTimeline.tsx` — bounded chronological JobList (Task 6)
- `tests/components/ServiceTimeline.test.ts` — pure-logic test of the row-renderer helper (Task 6)
- `src/components/customers/ServiceHistoryPhotos.tsx` — aggregated photo grid grouped by service (Task 7)
- `tests/components/ServiceHistoryPhotos.test.ts` — pure-logic test of the flatten + group helper (Task 7)
- `src/pages/CustomerProfile.tsx` — the big CustomerProfile page composing Tasks 3-7 (Task 8)
- `src/components/GlobalSearchSheet.tsx` — bottom-sheet search modal (Task 10)
- `tests/components/GlobalSearchSheet.test.ts` — pure-logic test of the query-state helper (Task 10)
- `src/components/settings/CustomerDirectorySettingsSection.tsx` — auto-save toggle + Backfill admin button (Task 11)
- `src/components/settings/CommunicationsSettingsSection.tsx` — Communications accordion priority slice + Test Incoming Call admin button (Task 12)
- `functions/src/backfillCustomers.ts` — full implementation replacing the SP1 stub (Task 13)
- `functions/tests/backfillCustomers.test.ts` — algorithm-level test of the backfill walker (Task 13)
- `functions/src/onJobWriteCustomerRollup.ts` — Firestore trigger with 30s coalescing window (Task 14)
- `functions/tests/onJobWriteCustomerRollup.test.ts` — debounce + privacy-allowlist test (Task 14)

**Modify:**

- `src/lib/customerInsights.ts` — add `computeMostCommonVehicle`, `computeMostCommonTireSize`, `computeMostCommonServiceType`, `deriveVipProgress` (Task 2)
- `src/pages/CustomerHub.tsx` — replace SP1 skeleton with real implementation (header, search bar, virtualized list, sort options) (Task 9)
- `src/App.tsx` — (a) add `selectedCustomerId` state + `tab === 'customerProfile'` dispatch, (b) mount the GlobalSearchSheet + main-nav search icon (Task 15)
- `src/components/addJob/CustomerLookupCard.tsx` — enable the disabled View History button + wire to onClick deep-link (Task 15)
- `src/pages/Settings.tsx` — register the two new accordion sections (Task 12)
- `firestore.indexes.json` — add 4 Customers indexes + 1 jobs index + 3 vehicles collection-group indexes (Task 15)
- `functions/src/index.ts` — replace the SP1 stub export of `backfillCustomers` with the real one + add `onJobWriteCustomerRollup` export (Tasks 13, 14)

**No file is touched by more than two SP3 tasks.** Each task commits independently. Task 8 (CustomerProfile composition) depends on Tasks 3-7; Task 9 (CustomerHub upgrade) depends on Task 8 (to deep-link rows); Task 10 (GlobalSearchSheet) depends on Task 1; Task 15 wires everything together and must run LAST.

---

## Task 1: searchCustomers helper + ranking regression tests

**Files:**
- Create: `src/lib/searchCustomers.ts`
- Test: `tests/searchCustomers.test.ts`

Per spec §"Global Customer Search (Phase 5)" (line 1960), this helper is the engine behind GlobalSearchSheet. It fans out 9 parallel Firestore queries via `Promise.all`, merges by `customerId`, dedupes, ranks by field-priority, and caches results for 60s. The spec's *Critical prefix-query contract* (line 2015) mandates the `` high-sentinel on every prefix branch — a regression here returns zero rows.

The helper exposes a pure `__testHooks.runWithShim(ops, businessId, query)` entry point so the test file can substitute the 9 Firestore branches with an in-memory map. This mirrors the SP2 `LookupOps` shim pattern.

- [ ] **Step 1: Write the failing test at `tests/searchCustomers.test.ts`**

  ```ts
  // ═══════════════════════════════════════════════════════════════════
  //  tests/searchCustomers.test.ts — Global search ranking + prefix regression
  //  Run: npx tsx tests/searchCustomers.test.ts
  //  Spec ref: docs/superpowers/specs/2026-06-03-customer-intelligence-design.md
  //            §"Global Customer Search (Phase 5)"
  //            §"Critical prefix-query contract"
  //            §"Ranking acceptance tests"
  // ═══════════════════════════════════════════════════════════════════
  import { __testHooks, type SearchOps } from '@/lib/searchCustomers';

  let passed = 0;
  let failed = 0;
  function check(name: string, cond: boolean, detail?: string): void {
    if (cond) { passed++; console.log(`  ✓ ${name}`); }
    else { failed++; console.error(`  ✗ ${name}${detail ? `  — ${detail}` : ''}`); }
  }
  function eq<T>(actual: T, expected: T): boolean {
    return JSON.stringify(actual) === JSON.stringify(expected);
  }

  const { runWithShim, _highSentinel } = __testHooks;

  const tesla    = { id: 'p_13050001111', name: 'Tesla Owner',    nameLower: 'tesla owner' };
  const tetris   = { id: 'p_13050002222', name: 'Tetris Player',  nameLower: 'tetris player' };
  const terra    = { id: 'p_13050003333', name: 'Terra Holdings', nameLower: 'terra holdings' };
  const acme     = { id: 'p_13050004444', name: 'Acme Inc',       nameLower: 'acme inc',
                     companyName: 'Tesla LLC', companyLower: 'tesla llc' };
  const maria    = { id: 'p_13058977030', name: 'Maria Lopez',    nameLower: 'maria lopez',
                     phoneE164: '+13058977030', phoneKey: '13058977030' };
  const cityHit  = { id: 'p_13059999999', name: 'Hollywood Hank', nameLower: 'hollywood hank',
                     city: 'Hollywood',       cityLower: 'hollywood' };

  function makeOps(over: Partial<SearchOps> = {}): SearchOps {
    return {
      queryByNamePrefix:     async () => [],
      queryByCompanyPrefix:  async () => [],
      queryByPhoneExact:     async () => [],
      queryByPhoneSuffix4:   async () => [],
      queryByCityPrefix:     async () => [],
      queryByZipExact:       async () => [],
      queryByMakeModelPrefix:async () => [],
      queryByLicensePlate:   async () => [],
      queryByTireSize:       async () => [],
      queryByTireSizeLegacy: async () => [],
      ...over,
    };
  }

  console.log('\n┌─ short-circuit: 1-char query returns [] ────────');
  {
    const ops = makeOps();
    const res = await runWithShim(ops, 'biz-1', 'a');
    check('1-char query empty', eq(res, []));
  }
  {
    const ops = makeOps();
    const res = await runWithShim(ops, 'biz-1', '');
    check('empty query empty', eq(res, []));
  }

  console.log('\n┌─ prefix-query regression: te → Tesla, Tetris, Terra ──');
  {
    const ops = makeOps({
      queryByNamePrefix: async (_bid, lo, hi) => {
        // Verify the helper actually passes the high-sentinel:
        check('high-sentinel is uf8ff', hi.charCodeAt(hi.length - 1) === 0xf8ff);
        check('low bound is the lowercased query', lo === 'te');
        return [tesla, tetris, terra];
      },
    });
    const res = await runWithShim(ops, 'biz-1', 'te');
    check('returns 3 name-prefix hits', res.length === 3);
    check('first hit is Tesla', res[0].customer.id === tesla.id);
    check('matchedField is name', res[0].matchedField === 'name');
  }

  console.log('\n┌─ ranking: exact phone beats every prefix ────────');
  {
    const ops = makeOps({
      queryByPhoneExact: async () => [maria],
      queryByNamePrefix: async () => [tesla], // distractor
    });
    const res = await runWithShim(ops, 'biz-1', '3058977030');
    check('exact phone ranks above name prefix', res[0].customer.id === maria.id);
    check('matchedField is phone', res[0].matchedField === 'phone');
  }

  console.log('\n┌─ ranking: city-prefix ranks below name-prefix ───');
  {
    const ops = makeOps({
      queryByNamePrefix: async () => [tesla],
      queryByCityPrefix: async () => [cityHit],
    });
    const res = await runWithShim(ops, 'biz-1', 'h');
    // 1-char short-circuit fires for 'h'; rerun with 2-char:
    const res2 = await runWithShim(ops, 'biz-1', 'ho');
    check('2-char query passes through fan-out', res2.length >= 1);
  }

  console.log('\n┌─ dedupe: same customer matched by 2 fields ───────');
  {
    const ops = makeOps({
      queryByNamePrefix:    async () => [acme],
      queryByCompanyPrefix: async () => [acme], // company also matches 'tesla'
    });
    const res = await runWithShim(ops, 'biz-1', 'tesla');
    check('dedupes by customer id', res.filter(r => r.customer.id === acme.id).length === 1);
    // Higher-priority branch wins:
    check('name match wins over company match in dedupe', res[0].matchedField === 'name');
  }

  console.log('\n┌─ vehicle match: returns matchedVehicles array ──');
  {
    const honda = { customerId: acme.id, id: 'v-1', make: 'Honda', model: 'Civic',
                    makeModelLower: 'honda civic', tireSize: '215/55R17' };
    const ops = makeOps({
      queryByMakeModelPrefix: async () => [honda],
    });
    const res = await runWithShim(ops, 'biz-1', 'honda');
    check('vehicle prefix hit', res.length === 1);
    check('matchedVehicles populated', res[0].matchedVehicles.length === 1);
    check('matchedField is vehicle', res[0].matchedField === 'vehicle');
  }

  console.log('\n┌─ scopedCustomerIds RBAC filter ──────────────────');
  {
    const ops = makeOps({
      queryByNamePrefix: async () => [tesla, tetris],
    });
    const scoped = new Set<string>([tesla.id]);
    const res = await runWithShim(ops, 'biz-1', 'te', { scopedCustomerIds: scoped });
    check('post-fetch filter applied', res.length === 1 && res[0].customer.id === tesla.id);
  }

  console.log('\n══════════════════════════════════════════════════');
  console.log(`  ${passed} passed, ${failed} failed`);
  console.log('══════════════════════════════════════════════════\n');
  process.exit(failed > 0 ? 1 : 0);
  ```

- [ ] **Step 2: Run the test and verify it fails**

  Run: `npx tsx tests/searchCustomers.test.ts`
  Expected: `Cannot find module '@/lib/searchCustomers'`.

- [ ] **Step 3: Implement `src/lib/searchCustomers.ts`**

  ```ts
  // src/lib/searchCustomers.ts
  // ═══════════════════════════════════════════════════════════════════
  //  Global multi-field customer search.
  //
  //  Spec: docs/superpowers/specs/2026-06-03-customer-intelligence-design.md
  //        §"Global Customer Search (Phase 5)"
  //
  //  Algorithm (T1 server-side path):
  //    1. Short-circuit if q.length < 2 AND qDigits.length < 2.
  //    2. Build high-sentinel: `qHigh = q + ''`. Digit branch uses ':'.
  //    3. Fan out 9 parallel Firestore queries via Promise.all.
  //    4. Merge by customerId; dedupe; rank by field-priority.
  //    5. Optional RBAC post-filter against scopedCustomerIds.
  //    6. 60s in-memory cache keyed on normalized query.
  //
  //  Performance contract: p95 < 300ms on ~2k customers, ~3k vehicles.
  //  Indexes: see firestore.indexes.json deltas in SP3 Task 15.
  // ═══════════════════════════════════════════════════════════════════

  import {
    collection, collectionGroup, getDocs, limit, orderBy, query, where,
  } from 'firebase/firestore';
  import { _db } from '@/lib/firebase';
  import type { Customer, Vehicle } from '@/lib/customerEntity';

  export interface SearchResult {
    customer: Customer;
    matchedVehicles: Vehicle[];
    matchedField:
      | 'phone' | 'phoneSuffix4' | 'plate' | 'zip'
      | 'name' | 'company' | 'city' | 'vehicle' | 'tire';
  }

  export interface SearchOptions {
    scopedCustomerIds?: Set<string>;
    limitPerField?: number;
  }

  /** Field-priority order: lower index = higher priority. */
  const FIELD_PRIORITY: SearchResult['matchedField'][] = [
    'phone', 'phoneSuffix4', 'plate', 'zip',
    'name', 'company', 'city', 'vehicle', 'tire',
  ];

  /** 60s in-memory cache. Keyed on `${businessId}:${q}`. */
  const CACHE = new Map<string, { at: number; results: SearchResult[] }>();
  const CACHE_TTL_MS = 60_000;

  const HIGH_SENTINEL = '';
  const DIGIT_SENTINEL = ':';

  export interface SearchOps {
    queryByNamePrefix(bid: string, lo: string, hi: string): Promise<Array<Record<string, unknown>>>;
    queryByCompanyPrefix(bid: string, lo: string, hi: string): Promise<Array<Record<string, unknown>>>;
    queryByPhoneExact(bid: string, phoneKey: string): Promise<Array<Record<string, unknown>>>;
    queryByPhoneSuffix4(bid: string, suffix: string): Promise<Array<Record<string, unknown>>>;
    queryByCityPrefix(bid: string, lo: string, hi: string): Promise<Array<Record<string, unknown>>>;
    queryByZipExact(bid: string, zip: string): Promise<Array<Record<string, unknown>>>;
    queryByMakeModelPrefix(bid: string, lo: string, hi: string): Promise<Array<Record<string, unknown> & { customerId: string }>>;
    queryByLicensePlate(bid: string, plate: string): Promise<Array<Record<string, unknown> & { customerId: string }>>;
    queryByTireSize(bid: string, size: string): Promise<Array<Record<string, unknown> & { customerId: string }>>;
    queryByTireSizeLegacy(bid: string, size: string): Promise<Array<Record<string, unknown> & { customerId: string }>>;
  }

  export async function searchCustomers(
    businessId: string,
    rawQuery: string,
    opts: SearchOptions = {},
  ): Promise<SearchResult[]> {
    return _search(_realOps, businessId, rawQuery, opts);
  }

  async function _search(
    ops: SearchOps,
    businessId: string,
    rawQuery: string,
    opts: SearchOptions,
  ): Promise<SearchResult[]> {
    const q = rawQuery.trim().toLowerCase();
    const qDigits = rawQuery.replace(/\D/g, '');
    if (q.length < 2 && qDigits.length < 2) return [];

    const cacheKey = `${businessId}:${q}|${qDigits}`;
    const cached = CACHE.get(cacheKey);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.results;

    const qHigh = q + HIGH_SENTINEL;
    const qDigitsHigh = qDigits + DIGIT_SENTINEL;

    const [
      nameHits, companyHits, phoneHits, suffix4Hits,
      cityHits, zipHits, vehHits, plateHits, tireHits, tireLegacyHits,
    ] = await Promise.all([
      q.length >= 2 ? ops.queryByNamePrefix(businessId, q, qHigh)        : Promise.resolve([]),
      q.length >= 2 ? ops.queryByCompanyPrefix(businessId, q, qHigh)     : Promise.resolve([]),
      qDigits.length >= 7 ? ops.queryByPhoneExact(businessId, qDigits.length === 10 ? '1' + qDigits : qDigits) : Promise.resolve([]),
      qDigits.length === 4 ? ops.queryByPhoneSuffix4(businessId, qDigits) : Promise.resolve([]),
      q.length >= 2 ? ops.queryByCityPrefix(businessId, q, qHigh)        : Promise.resolve([]),
      qDigits.length === 5 ? ops.queryByZipExact(businessId, qDigits)    : Promise.resolve([]),
      q.length >= 2 ? ops.queryByMakeModelPrefix(businessId, q, qHigh)   : Promise.resolve([]),
      rawQuery.length >= 2 ? ops.queryByLicensePlate(businessId, rawQuery.toUpperCase()) : Promise.resolve([]),
      rawQuery.length >= 2 ? ops.queryByTireSize(businessId, rawQuery)   : Promise.resolve([]),
      rawQuery.length >= 2 ? ops.queryByTireSizeLegacy(businessId, rawQuery) : Promise.resolve([]),
    ]);

    // Merge by customerId. Higher-priority branch wins on conflict.
    const byId = new Map<string, SearchResult>();
    const tag = (rows: Array<Record<string, unknown>>, field: SearchResult['matchedField']) => {
      for (const row of rows) {
        const c = row as unknown as Customer;
        const existing = byId.get(c.id);
        if (!existing || FIELD_PRIORITY.indexOf(field) < FIELD_PRIORITY.indexOf(existing.matchedField)) {
          byId.set(c.id, { customer: c, matchedVehicles: [], matchedField: field });
        }
      }
    };
    tag(phoneHits,   'phone');
    tag(suffix4Hits, 'phoneSuffix4');
    tag(plateHits as unknown as Array<Record<string, unknown>>, 'plate');
    tag(zipHits,     'zip');
    tag(nameHits,    'name');
    tag(companyHits, 'company');
    tag(cityHits,    'city');

    // Vehicle hits: attach to the parent customer if present, else
    // synthesize a placeholder result row keyed on customerId.
    const attachVeh = (rows: Array<Record<string, unknown> & { customerId: string }>, field: SearchResult['matchedField']) => {
      for (const v of rows) {
        const existing = byId.get(v.customerId);
        if (existing) {
          existing.matchedVehicles.push(v as unknown as Vehicle);
        } else {
          byId.set(v.customerId, {
            customer: { id: v.customerId, name: '' } as Customer,
            matchedVehicles: [v as unknown as Vehicle],
            matchedField: field,
          });
        }
      }
    };
    attachVeh(vehHits,        'vehicle');
    attachVeh(plateHits,      'plate');
    attachVeh(tireHits,       'tire');
    attachVeh(tireLegacyHits, 'tire');

    // Rank by field-priority then by name asc.
    let results = Array.from(byId.values()).sort((a, b) => {
      const pa = FIELD_PRIORITY.indexOf(a.matchedField);
      const pb = FIELD_PRIORITY.indexOf(b.matchedField);
      if (pa !== pb) return pa - pb;
      return (a.customer.name || '').localeCompare(b.customer.name || '');
    });

    // RBAC post-filter.
    if (opts.scopedCustomerIds) {
      const scope = opts.scopedCustomerIds;
      results = results.filter(r => scope.has(r.customer.id));
    }

    CACHE.set(cacheKey, { at: Date.now(), results });
    return results;
  }

  /** Invalidate cache. Call from onSnapshot listeners on writes. */
  export function invalidateSearchCache(): void { CACHE.clear(); }

  // ─── Real Firestore ops (wired in component) ──────────────────────
  const _realOps: SearchOps = {
    queryByNamePrefix: async (bid, lo, hi) => {
      const snap = await getDocs(query(
        collection(_db, 'businesses', bid, 'customers'),
        where('nameLower', '>=', lo), where('nameLower', '<', hi),
        orderBy('nameLower'), limit(20),
      ));
      return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    },
    queryByCompanyPrefix: async (bid, lo, hi) => {
      const snap = await getDocs(query(
        collection(_db, 'businesses', bid, 'customers'),
        where('companyLower', '>=', lo), where('companyLower', '<', hi),
        orderBy('companyLower'), limit(20),
      ));
      return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    },
    queryByPhoneExact: async (bid, phoneKey) => {
      const snap = await getDocs(query(
        collection(_db, 'businesses', bid, 'customers'),
        where('phoneKey', '==', phoneKey), limit(20),
      ));
      return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    },
    queryByPhoneSuffix4: async (bid, suffix) => {
      const lo = suffix;
      const hi = suffix + DIGIT_SENTINEL;
      const snap = await getDocs(query(
        collection(_db, 'businesses', bid, 'customers'),
        where('phoneKey', '>=', lo), where('phoneKey', '<', hi),
        orderBy('phoneKey'), limit(20),
      ));
      return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    },
    queryByCityPrefix: async (bid, lo, hi) => {
      const snap = await getDocs(query(
        collection(_db, 'businesses', bid, 'customers'),
        where('cityLower', '>=', lo), where('cityLower', '<', hi),
        orderBy('cityLower'), limit(20),
      ));
      return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    },
    queryByZipExact: async (bid, zip) => {
      const snap = await getDocs(query(
        collection(_db, 'businesses', bid, 'customers'),
        where('zipCode', '==', zip), limit(20),
      ));
      return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    },
    queryByMakeModelPrefix: async (_bid, lo, hi) => {
      const snap = await getDocs(query(
        collectionGroup(_db, 'vehicles'),
        where('makeModelLower', '>=', lo), where('makeModelLower', '<', hi),
        orderBy('makeModelLower'), limit(20),
      ));
      return snap.docs.map(d => ({ id: d.id, customerId: d.ref.parent.parent!.id, ...d.data() }));
    },
    queryByLicensePlate: async (_bid, plate) => {
      const snap = await getDocs(query(
        collectionGroup(_db, 'vehicles'),
        where('licensePlate', '==', plate), limit(20),
      ));
      return snap.docs.map(d => ({ id: d.id, customerId: d.ref.parent.parent!.id, ...d.data() }));
    },
    queryByTireSize: async (_bid, size) => {
      const snap = await getDocs(query(
        collectionGroup(_db, 'vehicles'),
        where('tire.size', '==', size), limit(20),
      ));
      return snap.docs.map(d => ({ id: d.id, customerId: d.ref.parent.parent!.id, ...d.data() }));
    },
    queryByTireSizeLegacy: async (_bid, size) => {
      const snap = await getDocs(query(
        collectionGroup(_db, 'vehicles'),
        where('tireSize', '==', size), limit(20),
      ));
      return snap.docs.map(d => ({ id: d.id, customerId: d.ref.parent.parent!.id, ...d.data() }));
    },
  };

  export const __testHooks = {
    runWithShim: (ops: SearchOps, bid: string, raw: string, opts: SearchOptions = {}) =>
      _search(ops, bid, raw, opts),
    _highSentinel: HIGH_SENTINEL,
  };
  ```

- [ ] **Step 4: Run the test and verify it passes**

  Run: `npx tsx tests/searchCustomers.test.ts`
  Expected: all checks green, `process.exit(0)`.

- [ ] **Step 5: Type-check**

  Run: `npm run typecheck`
  Expected: clean.

- [ ] **Step 6: Commit**

  ```bash
  git add src/lib/searchCustomers.ts tests/searchCustomers.test.ts
  git commit -m "$(cat <<'EOF'
  feat(search): add searchCustomers parallel fan-out helper (SP3 task 1)

  Adds the 9-branch Promise.all search engine behind GlobalSearchSheet.
  Implements the spec's high-sentinel prefix-query contract, field-
  priority ranking, dedupe by customerId, optional scopedCustomerIds
  RBAC filter, and 60s in-memory cache. Test shim covers the prefix
  regression (te → Tesla/Tetris/Terra) and the three ranking
  acceptance cases from spec §"Ranking acceptance tests".

  Spec: docs/superpowers/specs/2026-06-03-customer-intelligence-design.md
        §"Global Customer Search (Phase 5)"
  EOF
  )"
  ```

---

## Task 2: most-common-X mode helpers added to customerInsights.ts

**Files:**
- Modify: `src/lib/customerInsights.ts`
- Test: `tests/customerInsightsModes.test.ts`

Per spec §"The 9 metrics" (line 2083), CustomerInsightsCard needs three `mode()`-style helpers (Most Common Vehicle, Most Common Tire Size, Most Common Service Type) plus a tier-progress helper (Standard → "$X to Gold", Gold → "$X to Platinum"). All run over the bounded 100-job window (spec §"Insights jobs-load bound", line 2140). These are pure helpers — no Firestore, no React. They extend the SP1 `customerInsights.ts` file.

- [ ] **Step 1: Write the failing test at `tests/customerInsightsModes.test.ts`**

  ```ts
  // ═══════════════════════════════════════════════════════════════════
  //  tests/customerInsightsModes.test.ts — mode helpers + VIP progress
  //  Run: npx tsx tests/customerInsightsModes.test.ts
  //  Spec ref: §"The 9 metrics", §"Progress-to-next-tier UX"
  // ═══════════════════════════════════════════════════════════════════
  import {
    computeMostCommonVehicle,
    computeMostCommonTireSize,
    computeMostCommonServiceType,
    deriveVipProgress,
  } from '@/lib/customerInsights';

  let passed = 0; let failed = 0;
  function check(name: string, cond: boolean, detail?: string): void {
    if (cond) { passed++; console.log(`  ✓ ${name}`); }
    else { failed++; console.error(`  ✗ ${name}${detail ? `  — ${detail}` : ''}`); }
  }

  type JobLite = { vehicleMakeModel?: string; tireSize?: string; service?: string };

  console.log('\n┌─ computeMostCommonVehicle ──────────────────────');
  check('returns null on empty', computeMostCommonVehicle([]) === null);
  check('returns single', computeMostCommonVehicle([{ vehicleMakeModel: 'Honda Civic' }] as JobLite[]) === 'Honda Civic');
  check('picks mode',
    computeMostCommonVehicle([
      { vehicleMakeModel: 'Honda Civic' },
      { vehicleMakeModel: 'Honda Civic' },
      { vehicleMakeModel: 'Tesla Model 3' },
    ] as JobLite[]) === 'Honda Civic');
  check('skips blanks', computeMostCommonVehicle([
    { vehicleMakeModel: '' }, { vehicleMakeModel: undefined }, { vehicleMakeModel: 'Tesla Model 3' },
  ] as JobLite[]) === 'Tesla Model 3');

  console.log('\n┌─ computeMostCommonTireSize ─────────────────────');
  check('returns null on empty', computeMostCommonTireSize([]) === null);
  check('picks mode', computeMostCommonTireSize([
    { tireSize: '215/55R17' }, { tireSize: '215/55R17' }, { tireSize: '235/45R18' },
  ] as JobLite[]) === '215/55R17');

  console.log('\n┌─ computeMostCommonServiceType ──────────────────');
  check('returns null on empty', computeMostCommonServiceType([]) === null);
  check('picks mode', computeMostCommonServiceType([
    { service: 'tire_swap' }, { service: 'tire_swap' }, { service: 'rotation' },
  ] as JobLite[]) === 'tire_swap');

  console.log('\n┌─ deriveVipProgress ─────────────────────────────');
  check('$0 → Gold in $1000',  JSON.stringify(deriveVipProgress(0))    === JSON.stringify({ nextTier: 'Gold',     remaining: 1000 }));
  check('$999 → Gold in $1',    JSON.stringify(deriveVipProgress(999))  === JSON.stringify({ nextTier: 'Gold',     remaining: 1 }));
  check('$1000 → Platinum in $1500', JSON.stringify(deriveVipProgress(1000)) === JSON.stringify({ nextTier: 'Platinum', remaining: 1500 }));
  check('$2499 → Platinum in $1',    JSON.stringify(deriveVipProgress(2499)) === JSON.stringify({ nextTier: 'Platinum', remaining: 1 }));
  check('$2500 → top tier reached',  JSON.stringify(deriveVipProgress(2500)) === JSON.stringify({ nextTier: null,       remaining: 0 }));

  console.log('\n══════════════════════════════════════════════════');
  console.log(`  ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
  ```

- [ ] **Step 2: Run the test and verify it fails**

  Run: `npx tsx tests/customerInsightsModes.test.ts`
  Expected: `Module '"@/lib/customerInsights"' has no exported member 'computeMostCommonVehicle'`.

- [ ] **Step 3: Extend `src/lib/customerInsights.ts`**

  Append after the existing `deriveCustomerStatus`:

  ```ts
  // ─── Mode-over-bounded-jobs helpers (SP3) ────────────────────────
  // Used by CustomerInsightsCard for the 6 "computed live" metrics.
  // Input is the bounded (limit 100) recent-jobs array per spec
  // §"Insights jobs-load bound" — callers MUST NOT pass unbounded jobs.

  type JobLite = {
    vehicleMakeModel?: string;
    tireSize?: string;
    service?: string;
  };

  function _mode<T extends string>(values: Array<T | undefined | null>): T | null {
    const counts = new Map<T, number>();
    for (const v of values) {
      if (!v) continue;
      counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    let best: T | null = null;
    let bestN = 0;
    for (const [v, n] of counts) {
      if (n > bestN) { best = v; bestN = n; }
    }
    return best;
  }

  export function computeMostCommonVehicle(jobs: JobLite[]): string | null {
    return _mode(jobs.map(j => j.vehicleMakeModel));
  }
  export function computeMostCommonTireSize(jobs: JobLite[]): string | null {
    return _mode(jobs.map(j => j.tireSize));
  }
  export function computeMostCommonServiceType(jobs: JobLite[]): string | null {
    return _mode(jobs.map(j => j.service));
  }

  // ─── VIP tier progress (SP3) ─────────────────────────────────────
  // Returns the next-tier hint rendered under the VIP badge.
  // Spec §"Progress-to-next-tier UX (v2 — review-pass)".

  export interface VipProgress {
    nextTier: 'Gold' | 'Platinum' | null;
    remaining: number;
  }

  export function deriveVipProgress(lifetimeRevenue: number): VipProgress {
    const rev = Number.isFinite(lifetimeRevenue) ? Math.max(0, lifetimeRevenue) : 0;
    if (rev < 1000)  return { nextTier: 'Gold',     remaining: 1000 - rev };
    if (rev < 2500)  return { nextTier: 'Platinum', remaining: 2500 - rev };
    return { nextTier: null, remaining: 0 };
  }
  ```

- [ ] **Step 4: Run the test and verify it passes**

  Run: `npx tsx tests/customerInsightsModes.test.ts`
  Expected: all green.

- [ ] **Step 5: Type-check**

  Run: `npm run typecheck`
  Expected: clean.

- [ ] **Step 6: Commit**

  ```bash
  git add src/lib/customerInsights.ts tests/customerInsightsModes.test.ts
  git commit -m "$(cat <<'EOF'
  feat(insights): add mode helpers + VIP progress (SP3 task 2)

  Extends customerInsights.ts with computeMostCommonVehicle /
  TireSize / ServiceType (the 3 mode-over-bounded-jobs metrics from
  spec §"The 9 metrics") plus deriveVipProgress for the subline
  under the VIP badge. All pure functions — no Firestore, no React.

  Spec: §"Customer Insights Card (Phase 9)",
        §"Progress-to-next-tier UX"
  EOF
  )"
  ```

---

## Task 3: CustomerInsightsCard component

**Files:**
- Create: `src/components/customers/CustomerInsightsCard.tsx`
- Test: `tests/components/CustomerInsightsCard.test.ts`

Per spec §"Customer Insights Card (Phase 9)" (line 2072), this card renders the 9 metrics + VIP badge with progress-to-next-tier subline. It accepts a Customer doc + a bounded jobs array (limit 100 — caller's responsibility, NOT this component's). Financial metrics gated by `canViewFinancials`. The stale-rollup contract (spec line 2164) mandates client-side recompute when `(lastJobAt - updatedAt) > 30s`.

The pure render-decision helper (`__pureHooks.deriveMetrics`) is the testable surface. The JSX is dumb-rendering only.

- [ ] **Step 1: Write the failing test at `tests/components/CustomerInsightsCard.test.ts`**

  ```ts
  // ═══════════════════════════════════════════════════════════════════
  //  tests/components/CustomerInsightsCard.test.ts
  //  Run: npx tsx tests/components/CustomerInsightsCard.test.ts
  //  Spec ref: §"Customer Insights Card (Phase 9)",
  //            §"Stale-rollup display contract"
  // ═══════════════════════════════════════════════════════════════════
  import { __pureHooks } from '@/components/customers/CustomerInsightsCard';

  let passed = 0; let failed = 0;
  function check(name: string, cond: boolean, detail?: string): void {
    if (cond) { passed++; console.log(`  ✓ ${name}`); }
    else { failed++; console.error(`  ✗ ${name}${detail ? `  — ${detail}` : ''}`); }
  }

  const { deriveMetrics, shouldRecomputeClientSide } = __pureHooks;

  console.log('\n┌─ deriveMetrics: empty jobs ──────────────────────');
  {
    const m = deriveMetrics({ jobs: [], canViewFinancials: true,
      customer: { id: 'p_1', name: 'X' } });
    check('lifetimeRevenue 0', m.lifetimeRevenue === 0);
    check('totalJobs 0', m.totalJobs === 0);
    check('averageTicket null', m.averageTicket === null);
    check('mostCommonVehicle null', m.mostCommonVehicle === null);
  }

  console.log('\n┌─ deriveMetrics: typical customer ────────────────');
  {
    const jobs = [
      { id: 'j1', revenue: 480, vehicleMakeModel: 'Honda Civic', tireSize: '215/55R17', service: 'tire_swap', date: '2026-05-30' },
      { id: 'j2', revenue: 200, vehicleMakeModel: 'Honda Civic', tireSize: '215/55R17', service: 'rotation',  date: '2026-04-10' },
      { id: 'j3', revenue: 1200, vehicleMakeModel: 'Tesla Model 3', tireSize: '235/45R18', service: 'tire_swap', date: '2026-03-01' },
    ];
    const m = deriveMetrics({ jobs, canViewFinancials: true,
      customer: { id: 'p_1', name: 'M' } });
    check('lifetimeRevenue summed', m.lifetimeRevenue === 1880);
    check('totalJobs 3', m.totalJobs === 3);
    check('averageTicket', m.averageTicket !== null && Math.abs(m.averageTicket - 626.67) < 0.5);
    check('mostCommonVehicle = Honda Civic', m.mostCommonVehicle === 'Honda Civic');
    check('mostCommonTireSize = 215/55R17', m.mostCommonTireSize === '215/55R17');
    check('mostCommonServiceType = tire_swap', m.mostCommonServiceType === 'tire_swap');
    check('vipTier = Gold (≥$1000)', m.vipTier === 'Gold');
    check('vipProgress = Platinum in $620', m.vipProgress.nextTier === 'Platinum' && m.vipProgress.remaining === 620);
  }

  console.log('\n┌─ deriveMetrics: financials gated ────────────────');
  {
    const jobs = [{ id: 'j1', revenue: 1000 }];
    const m = deriveMetrics({ jobs, canViewFinancials: false,
      customer: { id: 'p_1', name: 'X' } });
    check('lifetimeRevenue hidden = 0', m.lifetimeRevenue === 0);
    check('averageTicket hidden = null', m.averageTicket === null);
    check('totalJobs still 1', m.totalJobs === 1);
  }

  console.log('\n┌─ shouldRecomputeClientSide ──────────────────────');
  // Stale rollup: lastJobAt > updatedAt + 30s → recompute on client.
  check('stale rollup', shouldRecomputeClientSide({
    lastJobAt: '2026-06-03T12:00:31Z',
    updatedAt: '2026-06-03T12:00:00Z',
  }) === true);
  check('fresh rollup', shouldRecomputeClientSide({
    lastJobAt: '2026-06-03T12:00:10Z',
    updatedAt: '2026-06-03T12:00:00Z',
  }) === false);
  check('missing updatedAt forces recompute',
    shouldRecomputeClientSide({ lastJobAt: '2026-06-03T12:00:00Z' }) === true);
  check('missing lastJobAt is fresh',
    shouldRecomputeClientSide({ updatedAt: '2026-06-03T12:00:00Z' }) === false);

  console.log('\n══════════════════════════════════════════════════');
  console.log(`  ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
  ```

- [ ] **Step 2: Run the test and verify it fails**

  Run: `npx tsx tests/components/CustomerInsightsCard.test.ts`
  Expected: `Cannot find module '@/components/customers/CustomerInsightsCard'`.

- [ ] **Step 3: Implement `src/components/customers/CustomerInsightsCard.tsx`**

  ```tsx
  // src/components/customers/CustomerInsightsCard.tsx
  // ═══════════════════════════════════════════════════════════════════
  //  CustomerInsightsCard — 9 metrics + VIP badge + progress subline.
  //
  //  Spec: docs/superpowers/specs/2026-06-03-customer-intelligence-design.md
  //        §"Customer Insights Card (Phase 9)"
  //
  //  Reads:
  //    - Customer doc (for persisted rollups + name + tier)
  //    - Bounded 100-job array loaded by CustomerProfile parent
  //
  //  Financial metrics (lifetimeRevenue, averageTicket) gated by
  //  permissions.canViewFinancials. Non-financial metrics rendered to
  //  all roles. VIP badge rendered to all roles (operational signal).
  //
  //  Stale-rollup contract: if lastJobAt is newer than updatedAt by
  //  >30s, recompute client-side (per spec §"Stale-rollup display").
  // ═══════════════════════════════════════════════════════════════════

  import { memo, useMemo } from 'react';
  import {
    deriveVipTier, deriveVipProgress,
    computeMostCommonVehicle, computeMostCommonTireSize, computeMostCommonServiceType,
  } from '@/lib/customerInsights';
  import type { Customer } from '@/lib/customerEntity';

  interface JobLite {
    id: string;
    revenue?: number | string;
    vehicleMakeModel?: string;
    tireSize?: string;
    service?: string;
    date?: string;
  }

  interface Props {
    customer: Customer;
    jobs: JobLite[];               // bounded 100-job window — caller's responsibility
    canViewFinancials: boolean;
    serviceLabelFor?: (id: string) => string; // verticalConfig service label lookup
  }

  interface Metrics {
    lifetimeRevenue: number;
    totalJobs: number;
    averageTicket: number | null;
    lastServiceDate: string | null;
    mostCommonVehicle: string | null;
    mostCommonTireSize: string | null;
    mostCommonServiceType: string | null;
    referralCount: number;
    vipTier: 'Standard' | 'Gold' | 'Platinum';
    vipProgress: { nextTier: 'Gold' | 'Platinum' | null; remaining: number };
  }

  function _deriveMetrics(args: {
    customer: Customer;
    jobs: JobLite[];
    canViewFinancials: boolean;
  }): Metrics {
    const { customer, jobs, canViewFinancials } = args;
    const totalJobs = jobs.length;

    let lifetimeRevenue = 0;
    if (canViewFinancials) {
      for (const j of jobs) {
        const n = typeof j.revenue === 'number' ? j.revenue : parseFloat(String(j.revenue ?? '0'));
        if (Number.isFinite(n)) lifetimeRevenue += n;
      }
    }

    const averageTicket = canViewFinancials && totalJobs > 0
      ? Math.round((lifetimeRevenue / totalJobs) * 100) / 100
      : null;

    const lastServiceDate = customer.lastJobAt
      ?? (jobs[0]?.date ?? null);

    return {
      lifetimeRevenue,
      totalJobs,
      averageTicket,
      lastServiceDate,
      mostCommonVehicle:     computeMostCommonVehicle(jobs),
      mostCommonTireSize:    computeMostCommonTireSize(jobs),
      mostCommonServiceType: computeMostCommonServiceType(jobs),
      referralCount:         customer.referralCount ?? 0,
      vipTier:               deriveVipTier(lifetimeRevenue),
      vipProgress:           deriveVipProgress(lifetimeRevenue),
    };
  }

  function _shouldRecomputeClientSide(args: { lastJobAt?: string; updatedAt?: string }): boolean {
    if (!args.lastJobAt) return false;
    if (!args.updatedAt) return true;
    const lj = Date.parse(args.lastJobAt);
    const up = Date.parse(args.updatedAt);
    if (!Number.isFinite(lj) || !Number.isFinite(up)) return true;
    return (lj - up) > 30_000;
  }

  function fmtMoney(n: number): string {
    return '$' + n.toFixed(2).replace(/\.00$/, '');
  }
  function fmtDate(iso?: string | null): string {
    if (!iso) return '—';
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) return iso;
    return d.toLocaleDateString();
  }

  function CustomerInsightsCardImpl({ customer, jobs, canViewFinancials, serviceLabelFor }: Props) {
    const metrics = useMemo(
      () => _deriveMetrics({ customer, jobs, canViewFinancials }),
      [customer, jobs, canViewFinancials],
    );

    const serviceLabel = metrics.mostCommonServiceType
      ? (serviceLabelFor?.(metrics.mostCommonServiceType) ?? metrics.mostCommonServiceType)
      : '—';

    const vipSubline = metrics.vipProgress.nextTier
      ? `${metrics.vipProgress.nextTier} tier in ${fmtMoney(metrics.vipProgress.remaining)}`
      : 'Top tier reached';

    return (
      <section className="insights-card" aria-label="Customer Insights">
        <div className="insights-vip">
          <span className={`vip-badge vip-${metrics.vipTier.toLowerCase()}`}>{metrics.vipTier}</span>
          <span className="vip-subline">{vipSubline}</span>
        </div>
        <dl className="insights-grid">
          {canViewFinancials && (
            <>
              <div><dt>Lifetime Revenue</dt><dd>{fmtMoney(metrics.lifetimeRevenue)}</dd></div>
              <div><dt>Average Ticket</dt><dd>{metrics.averageTicket !== null ? fmtMoney(metrics.averageTicket) : '—'}</dd></div>
            </>
          )}
          <div><dt>Total Jobs</dt><dd>{metrics.totalJobs}</dd></div>
          <div><dt>Last Service</dt><dd>{fmtDate(metrics.lastServiceDate)}</dd></div>
          <div><dt>Most Common Vehicle</dt><dd>{metrics.mostCommonVehicle ?? '—'}</dd></div>
          <div><dt>Most Common Tire Size</dt><dd>{metrics.mostCommonTireSize ?? '—'}</dd></div>
          <div><dt>Most Common Service</dt><dd>{serviceLabel}</dd></div>
          <div><dt>Referrals</dt><dd>{metrics.referralCount}</dd></div>
        </dl>
      </section>
    );
  }

  export const CustomerInsightsCard = memo(CustomerInsightsCardImpl);

  export const __pureHooks = {
    deriveMetrics: _deriveMetrics,
    shouldRecomputeClientSide: _shouldRecomputeClientSide,
  };
  ```

- [ ] **Step 4: Run the test and verify it passes**

  Run: `npx tsx tests/components/CustomerInsightsCard.test.ts`
  Expected: all green.

- [ ] **Step 5: Type-check**

  Run: `npm run typecheck`
  Expected: clean.

- [ ] **Step 6: Self-review**

  - Confirm financial metrics are conditionally returned (`lifetimeRevenue` returns 0 when gated) so the JSX render branch can hide both money fields safely.
  - Confirm `deriveMetrics` does NOT touch `customer.lifetimeRevenue` (the spec's critical privacy contract — that field must never be persisted, per line 2162).
  - Confirm `useMemo` deps include `[customer, jobs, canViewFinancials]` so a role change reflows the card.

- [ ] **Step 7: Commit**

  ```bash
  git add src/components/customers/CustomerInsightsCard.tsx tests/components/CustomerInsightsCard.test.ts
  git commit -m "$(cat <<'EOF'
  feat(customers): CustomerInsightsCard component (SP3 task 3)

  Renders the 9 metrics + VIP badge + progress-to-next-tier subline.
  Financial metrics gated by canViewFinancials. Stale-rollup
  client-side recompute helper exposed via __pureHooks for SP3 task 8
  (CustomerProfile) to wire the rollup-staleness branch.

  Spec: §"Customer Insights Card (Phase 9)",
        §"Stale-rollup display contract",
        §"Progress-to-next-tier UX"
  EOF
  )"
  ```

---

## Task 4: CustomerNotesSection component (8-field Quick Notes editor)

**Files:**
- Create: `src/components/customers/CustomerNotesSection.tsx`
- Test: `tests/components/CustomerNotesSection.test.ts`

Per spec §"Quick Notes" (line 1934 + refinement #2 at line 2512), this is the inline-edit UI for the 8 structured Quick Notes fields shipped on the Customer schema in SP1. Edit affordance gated by `canEditBusinessSettings`. Each field shows a per-field icon + label; inline edit produces a merge-patch write against `customers/{customerId}` via `setDoc(ref, patch, { merge: true })` — the SP1 rules block at `firestore.rules:618-623` allowlists exactly these 8 fields under the meta-only writer branch, so the rule passes.

The pure helper (`__pureHooks.buildPatch`) takes (originalCustomer, draftEdits) and returns the minimal merge patch — including `updatedAt` and `lastEditedByUid`. Used by the inline save action.

- [ ] **Step 1: Write the failing test at `tests/components/CustomerNotesSection.test.ts`**

  ```ts
  // ═══════════════════════════════════════════════════════════════════
  //  tests/components/CustomerNotesSection.test.ts
  //  Run: npx tsx tests/components/CustomerNotesSection.test.ts
  //  Spec ref: §"Quick Notes" (Customer Profile sections),
  //            §"SP1 vs SP3 split for the Quick Notes capability"
  // ═══════════════════════════════════════════════════════════════════
  import { __pureHooks, QUICK_NOTE_FIELDS } from '@/components/customers/CustomerNotesSection';

  let passed = 0; let failed = 0;
  function check(name: string, cond: boolean, detail?: string): void {
    if (cond) { passed++; console.log(`  ✓ ${name}`); }
    else { failed++; console.error(`  ✗ ${name}${detail ? `  — ${detail}` : ''}`); }
  }
  function eq<T>(a: T, b: T): boolean { return JSON.stringify(a) === JSON.stringify(b); }

  const { buildPatch, isDirty, fieldList } = __pureHooks;

  console.log('\n┌─ field list shape ───────────────────────────────');
  check('8 fields exposed', QUICK_NOTE_FIELDS.length === 8);
  check('field keys match spec', eq(QUICK_NOTE_FIELDS.map(f => f.key).sort(), [
    'apartmentNumber','gateCode','generalNotes','parkingInstructions',
    'preferredContactMethod','preferredPaymentMethod','tpmsNotes','wheelLockKeyLocation',
  ]));

  console.log('\n┌─ buildPatch: no changes → empty ─────────────────');
  {
    const original = { id: 'p_1', name: 'X', gateCode: '1234' };
    const draft    = { gateCode: '1234' };
    const patch = buildPatch({ original, draft, editorUid: 'uid-1' });
    check('no changes → no patch fields', eq(Object.keys(patch).filter(k => !['updatedAt','lastEditedAt','lastEditedByUid'].includes(k)), []));
  }

  console.log('\n┌─ buildPatch: change one field ───────────────────');
  {
    const original = { id: 'p_1', name: 'X', gateCode: '1234' };
    const draft    = { gateCode: '5678' };
    const patch = buildPatch({ original, draft, editorUid: 'uid-1' });
    check('patches gateCode',           patch.gateCode === '5678');
    check('writes lastEditedByUid',     patch.lastEditedByUid === 'uid-1');
    check('writes updatedAt ISO',       typeof patch.updatedAt === 'string' && patch.updatedAt.includes('T'));
    check('writes lastEditedAt ISO',    typeof patch.lastEditedAt === 'string' && patch.lastEditedAt.includes('T'));
  }

  console.log('\n┌─ buildPatch: blank field is preserved (not deleted) ──');
  {
    const original = { id: 'p_1', name: 'X', gateCode: '1234' };
    const draft    = { gateCode: '' };
    const patch = buildPatch({ original, draft, editorUid: 'uid-1' });
    check('blank → empty string write', patch.gateCode === '');
  }

  console.log('\n┌─ isDirty ────────────────────────────────────────');
  check('no change → clean', isDirty({ original: { gateCode: 'X' } as any, draft: { gateCode: 'X' } }) === false);
  check('change → dirty', isDirty({ original: { gateCode: 'X' } as any, draft: { gateCode: 'Y' } }) === true);
  check('original blank, draft set → dirty', isDirty({ original: {} as any, draft: { gateCode: 'Y' } }) === true);

  console.log('\n┌─ fieldList: read-only when canEdit false ────────');
  {
    const list = fieldList({
      canEdit: false,
      values: { gateCode: '1234' },
    });
    check('renders all 8 fields',  list.length === 8);
    check('readonly when canEdit=false', list.every(f => f.editable === false));
  }
  {
    const list = fieldList({
      canEdit: true,
      values: { gateCode: '1234' },
    });
    check('editable when canEdit=true', list.every(f => f.editable === true));
  }

  console.log('\n══════════════════════════════════════════════════');
  console.log(`  ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
  ```

- [ ] **Step 2: Run the test and verify it fails**

  Run: `npx tsx tests/components/CustomerNotesSection.test.ts`
  Expected: `Cannot find module '@/components/customers/CustomerNotesSection'`.

- [ ] **Step 3: Implement `src/components/customers/CustomerNotesSection.tsx`**

  ```tsx
  // src/components/customers/CustomerNotesSection.tsx
  // ═══════════════════════════════════════════════════════════════════
  //  Quick Notes — 8 structured fields, inline editable (owner/admin).
  //
  //  Spec: docs/superpowers/specs/2026-06-03-customer-intelligence-design.md
  //        §"Quick Notes" (Customer Profile Sections)
  //        §"SP1 vs SP3 split for the Quick Notes capability"
  //
  //  Edit gate: canEditBusinessSettings. Technicians see read-only.
  //  Write path: setDoc(customerRef, patch, { merge: true }) — the
  //  SP1 firestore.rules meta-only allowlist covers these 8 fields.
  // ═══════════════════════════════════════════════════════════════════

  import { memo, useCallback, useMemo, useState } from 'react';
  import { doc, setDoc } from 'firebase/firestore';
  import { _db } from '@/lib/firebase';
  import type { Customer } from '@/lib/customerEntity';

  export interface QuickNoteFieldDef {
    key:
      | 'gateCode' | 'apartmentNumber' | 'wheelLockKeyLocation' | 'tpmsNotes'
      | 'preferredPaymentMethod' | 'parkingInstructions' | 'preferredContactMethod' | 'generalNotes';
    label: string;
    icon: string;
    placeholder: string;
    multiline?: boolean;
  }

  export const QUICK_NOTE_FIELDS: QuickNoteFieldDef[] = [
    { key: 'gateCode',                label: 'Gate Code',          icon: '🔢', placeholder: '4-6 digits' },
    { key: 'apartmentNumber',         label: 'Apt / Unit',         icon: '🏢', placeholder: 'Apt #' },
    { key: 'wheelLockKeyLocation',    label: 'Wheel Lock Key',     icon: '🔑', placeholder: 'e.g. glove box' },
    { key: 'tpmsNotes',               label: 'TPMS Notes',         icon: '📡', placeholder: 'sensor type / notes', multiline: true },
    { key: 'preferredPaymentMethod',  label: 'Preferred Payment',  icon: '💳', placeholder: 'cash / card / Zelle' },
    { key: 'parkingInstructions',     label: 'Parking',            icon: '🅿️', placeholder: 'where to park' },
    { key: 'preferredContactMethod',  label: 'Contact Preference', icon: '📞', placeholder: 'phone / sms / email' },
    { key: 'generalNotes',            label: 'General Notes',      icon: 'ℹ️', placeholder: 'anything else', multiline: true },
  ];

  type QuickNoteDraft = Partial<Record<QuickNoteFieldDef['key'], string>>;

  function _buildPatch(args: {
    original: Customer;
    draft: QuickNoteDraft;
    editorUid: string;
  }): Record<string, unknown> {
    const now = new Date().toISOString();
    const patch: Record<string, unknown> = {
      updatedAt: now,
      lastEditedAt: now,
      lastEditedByUid: args.editorUid,
    };
    for (const f of QUICK_NOTE_FIELDS) {
      const orig = (args.original as Record<string, unknown>)[f.key] ?? '';
      const next = args.draft[f.key];
      if (next === undefined) continue;
      if (String(orig) !== String(next)) {
        patch[f.key] = next;
      }
    }
    return patch;
  }

  function _isDirty(args: { original: Customer; draft: QuickNoteDraft }): boolean {
    for (const f of QUICK_NOTE_FIELDS) {
      const orig = String((args.original as Record<string, unknown>)[f.key] ?? '');
      const next = args.draft[f.key];
      if (next === undefined) continue;
      if (orig !== String(next)) return true;
    }
    return false;
  }

  function _fieldList(args: { canEdit: boolean; values: Partial<Customer> }) {
    return QUICK_NOTE_FIELDS.map(f => ({
      ...f,
      value: String((args.values as Record<string, unknown>)[f.key] ?? ''),
      editable: args.canEdit,
    }));
  }

  interface Props {
    businessId: string;
    customer: Customer;
    canEdit: boolean;
    editorUid: string;
  }

  function CustomerNotesSectionImpl({ businessId, customer, canEdit, editorUid }: Props) {
    const [draft, setDraft] = useState<QuickNoteDraft>({});
    const [saving, setSaving] = useState(false);
    const dirty = useMemo(() => _isDirty({ original: customer, draft }), [customer, draft]);
    const fields = useMemo(() => _fieldList({ canEdit, values: { ...customer, ...draft } }), [customer, draft, canEdit]);

    const onSave = useCallback(async () => {
      if (!dirty || saving) return;
      setSaving(true);
      try {
        const patch = _buildPatch({ original: customer, draft, editorUid });
        const ref = doc(_db, 'businesses', businessId, 'customers', customer.id);
        await setDoc(ref, patch, { merge: true });
        setDraft({});
      } finally {
        setSaving(false);
      }
    }, [businessId, customer, draft, dirty, editorUid, saving]);

    const onCancel = useCallback(() => setDraft({}), []);

    const setField = useCallback((key: QuickNoteFieldDef['key'], v: string) => {
      setDraft(d => ({ ...d, [key]: v }));
    }, []);

    const allEmpty = fields.every(f => !f.value);
    if (allEmpty && !canEdit) return null;
    if (allEmpty && canEdit) {
      return (
        <section className="quick-notes-empty" aria-label="Quick Notes">
          <button type="button" className="btn sm secondary" onClick={() => setDraft({ gateCode: '' })}>
            + Add Quick Notes
          </button>
        </section>
      );
    }

    return (
      <section className="quick-notes" aria-label="Quick Notes">
        <header className="quick-notes-header">Quick Notes</header>
        <ul className="quick-notes-list">
          {fields.map(f => (
            <li key={f.key} className="quick-notes-row">
              <span className="quick-notes-icon" aria-hidden>{f.icon}</span>
              <label className="quick-notes-label">{f.label}</label>
              {f.editable ? (
                f.multiline ? (
                  <textarea
                    className="quick-notes-input"
                    value={f.value}
                    placeholder={f.placeholder}
                    onChange={(e) => setField(f.key, e.target.value)}
                    rows={2}
                  />
                ) : (
                  <input
                    type="text"
                    className="quick-notes-input"
                    value={f.value}
                    placeholder={f.placeholder}
                    onChange={(e) => setField(f.key, e.target.value)}
                  />
                )
              ) : (
                <span className="quick-notes-value">{f.value || '—'}</span>
              )}
            </li>
          ))}
        </ul>
        {canEdit && dirty && (
          <div className="quick-notes-actions">
            <button type="button" className="btn sm primary" disabled={saving} onClick={onSave}>
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button type="button" className="btn sm secondary" disabled={saving} onClick={onCancel}>
              Cancel
            </button>
          </div>
        )}
      </section>
    );
  }

  export const CustomerNotesSection = memo(CustomerNotesSectionImpl);

  export const __pureHooks = {
    buildPatch: _buildPatch,
    isDirty: _isDirty,
    fieldList: _fieldList,
  };
  ```

- [ ] **Step 4: Run the test and verify it passes**

  Run: `npx tsx tests/components/CustomerNotesSection.test.ts`
  Expected: all green.

- [ ] **Step 5: Type-check**

  Run: `npm run typecheck`
  Expected: clean.

- [ ] **Step 6: Verify firestore.rules already allow the write path**

  Run: `grep -n "gateCode\|apartmentNumber\|wheelLockKeyLocation\|tpmsNotes\|preferredPaymentMethod\|parkingInstructions\|preferredContactMethod\|generalNotes" firestore.rules`
  Expected: matches inside the `customers/{customerId}` meta-only update allowlist (around lines 618-623). All 8 keys are already allowlisted by SP1 Task 7 — no rules delta needed.

- [ ] **Step 7: Commit**

  ```bash
  git add src/components/customers/CustomerNotesSection.tsx tests/components/CustomerNotesSection.test.ts
  git commit -m "$(cat <<'EOF'
  feat(customers): CustomerNotesSection inline editor (SP3 task 4)

  8-field Quick Notes inline editor with per-field icons. Edit
  gated by canEditBusinessSettings (technicians see read-only).
  Writes via setDoc merge against the SP1 meta-only allowlist —
  no rules delta required.

  Spec: §"Quick Notes" (Customer Profile Sections),
        §"SP1 vs SP3 split for the Quick Notes capability"
  EOF
  )"
  ```

---

## Task 5: VehiclesSection component

**Files:**
- Create: `src/components/customers/VehiclesSection.tsx`
- Test: `tests/components/VehiclesSection.test.ts`

Per spec §"Vehicles" (line 1933), this is the chip list of all vehicles in the customer's `vehicles/` subcollection. Per-vehicle row: year/make/model/trim/color, tireSize, alternateTireSize, lastServicedAt. Tap to expand details. Owner/admin can edit; technicians read-only.

The pure helper (`__pureHooks.formatVehicleLabel`) handles the universal "year make model trim" string with fallback to legacy `vehicleMakeModel`.

- [ ] **Step 1: Write the failing test at `tests/components/VehiclesSection.test.ts`**

  ```ts
  // ═══════════════════════════════════════════════════════════════════
  //  tests/components/VehiclesSection.test.ts
  //  Run: npx tsx tests/components/VehiclesSection.test.ts
  //  Spec ref: §"Vehicles" (Customer Profile Sections)
  // ═══════════════════════════════════════════════════════════════════
  import { __pureHooks } from '@/components/customers/VehiclesSection';

  let passed = 0; let failed = 0;
  function check(name: string, cond: boolean, detail?: string): void {
    if (cond) { passed++; console.log(`  ✓ ${name}`); }
    else { failed++; console.error(`  ✗ ${name}${detail ? `  — ${detail}` : ''}`); }
  }

  const { formatVehicleLabel, resolveTireSize, sortByRecency } = __pureHooks;

  console.log('\n┌─ formatVehicleLabel ─────────────────────────────');
  check('universal year/make/model/trim',
    formatVehicleLabel({ id: 'v1', year: 2019, make: 'Honda', model: 'Civic', trim: 'EX' } as any)
      === '2019 Honda Civic EX');
  check('without trim',
    formatVehicleLabel({ id: 'v1', year: 2019, make: 'Honda', model: 'Civic' } as any)
      === '2019 Honda Civic');
  check('fallback to legacy vehicleMakeModel',
    formatVehicleLabel({ id: 'v1', vehicleMakeModel: 'Honda Civic 2019' } as any)
      === 'Honda Civic 2019');
  check('unknown vehicle',
    formatVehicleLabel({ id: 'v1' } as any) === 'Vehicle');

  console.log('\n┌─ resolveTireSize: subobject preferred ──────────');
  check('tire.size wins',
    resolveTireSize({ id: 'v1', tire: { size: '215/55R17' }, tireSize: '235/45R18' } as any)
      === '215/55R17');
  check('fallback to top-level tireSize',
    resolveTireSize({ id: 'v1', tireSize: '215/55R17' } as any) === '215/55R17');
  check('no tire info',
    resolveTireSize({ id: 'v1' } as any) === null);

  console.log('\n┌─ sortByRecency ──────────────────────────────────');
  {
    const a = { id: 'a', lastServicedAt: '2026-05-01' } as any;
    const b = { id: 'b', lastServicedAt: '2026-06-01' } as any;
    const c = { id: 'c' } as any; // never serviced
    const sorted = sortByRecency([a, b, c]);
    check('newest first', sorted[0].id === 'b');
    check('never-serviced last', sorted[sorted.length - 1].id === 'c');
  }

  console.log('\n══════════════════════════════════════════════════');
  console.log(`  ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
  ```

- [ ] **Step 2: Run the test and verify it fails**

  Run: `npx tsx tests/components/VehiclesSection.test.ts`
  Expected: `Cannot find module '@/components/customers/VehiclesSection'`.

- [ ] **Step 3: Implement `src/components/customers/VehiclesSection.tsx`**

  ```tsx
  // src/components/customers/VehiclesSection.tsx
  // ═══════════════════════════════════════════════════════════════════
  //  VehiclesSection — customer profile vehicle chip list.
  //
  //  Spec: §"Vehicles" (Customer Profile Sections, line 1933)
  //
  //  Reads vehicles via the parent's pre-loaded array (parent owns
  //  the onSnapshot listener — this component is pure render). Tap
  //  to expand a vehicle's details. Owner/admin Edit affordance opens
  //  the existing JobDetailModal vehicle sub-editor (deferred to SP4
  //  for the dedicated VehicleEdit modal — for SP3 the Edit button
  //  navigates to AddJob with the vehicle pre-selected).
  // ═══════════════════════════════════════════════════════════════════

  import { memo, useMemo, useState } from 'react';
  import type { Vehicle } from '@/lib/customerEntity';

  function _formatVehicleLabel(v: Vehicle): string {
    const parts: string[] = [];
    if (v.year)  parts.push(String(v.year));
    if (v.make)  parts.push(v.make);
    if (v.model) parts.push(v.model);
    if (v.trim)  parts.push(v.trim);
    if (parts.length > 0) return parts.join(' ');
    if (v.vehicleMakeModel) return v.vehicleMakeModel;
    return 'Vehicle';
  }

  function _resolveTireSize(v: Vehicle): string | null {
    const sub = (v as unknown as { tire?: { size?: string } }).tire?.size;
    if (sub) return sub;
    if (v.tireSize) return v.tireSize;
    return null;
  }

  function _sortByRecency(vehicles: Vehicle[]): Vehicle[] {
    return [...vehicles].sort((a, b) => {
      const ax = a.lastServicedAt ? Date.parse(a.lastServicedAt) : 0;
      const bx = b.lastServicedAt ? Date.parse(b.lastServicedAt) : 0;
      return bx - ax;
    });
  }

  interface Props {
    vehicles: Vehicle[];
    canEdit: boolean;
    onEditVehicle?: (v: Vehicle) => void;
  }

  function VehiclesSectionImpl({ vehicles, canEdit, onEditVehicle }: Props) {
    const sorted = useMemo(() => _sortByRecency(vehicles), [vehicles]);
    const [expandedId, setExpandedId] = useState<string | null>(null);

    if (sorted.length === 0) {
      return (
        <section className="vehicles-section" aria-label="Vehicles">
          <header className="section-header">Vehicles</header>
          <p className="empty-state">No vehicles on file yet.</p>
        </section>
      );
    }

    return (
      <section className="vehicles-section" aria-label="Vehicles">
        <header className="section-header">Vehicles ({sorted.length})</header>
        <ul className="vehicles-chip-list">
          {sorted.map(v => {
            const label = _formatVehicleLabel(v);
            const tire  = _resolveTireSize(v);
            const altTire = (v as unknown as { tire?: { alternateSize?: string } }).tire?.alternateSize
                          ?? v.alternateTireSize;
            const expanded = expandedId === v.id;
            return (
              <li key={v.id} className={'vehicle-chip' + (expanded ? ' expanded' : '')}>
                <button
                  type="button"
                  className="vehicle-chip-tap"
                  onClick={() => setExpandedId(expanded ? null : v.id)}
                  aria-expanded={expanded}
                >
                  <span className="vehicle-label">{label}</span>
                  {v.color   && <span className="vehicle-color">{v.color}</span>}
                  {tire      && <span className="vehicle-tire">{tire}</span>}
                </button>
                {expanded && (
                  <div className="vehicle-details">
                    {v.licensePlate && <div>Plate: {v.licensePlate}</div>}
                    {v.vin          && <div>VIN: {v.vin}</div>}
                    {altTire        && <div>Alt tire: {altTire}</div>}
                    {v.lastServicedAt && <div>Last serviced: {new Date(v.lastServicedAt).toLocaleDateString()}</div>}
                    {canEdit && onEditVehicle && (
                      <button
                        type="button"
                        className="btn sm secondary"
                        onClick={() => onEditVehicle(v)}
                      >
                        Edit
                      </button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    );
  }

  export const VehiclesSection = memo(VehiclesSectionImpl);

  export const __pureHooks = {
    formatVehicleLabel: _formatVehicleLabel,
    resolveTireSize: _resolveTireSize,
    sortByRecency: _sortByRecency,
  };
  ```

- [ ] **Step 4: Run the test and verify it passes**

  Run: `npx tsx tests/components/VehiclesSection.test.ts`
  Expected: all green.

- [ ] **Step 5: Type-check**

  Run: `npm run typecheck`
  Expected: clean.

- [ ] **Step 6: Commit**

  ```bash
  git add src/components/customers/VehiclesSection.tsx tests/components/VehiclesSection.test.ts
  git commit -m "$(cat <<'EOF'
  feat(customers): VehiclesSection chip list (SP3 task 5)

  Pure render component. Sorts by lastServicedAt desc, expands on
  tap to show plate/VIN/alt tire/last serviced. Tire size resolution
  prefers vehicle.tire.size sub-object then falls back to legacy
  top-level tireSize per the SP3 backfill dual-write window.

  Spec: §"Vehicles" (Customer Profile Sections)
  EOF
  )"
  ```

---

## Task 6: ServiceTimeline component

**Files:**
- Create: `src/components/customers/ServiceTimeline.tsx`
- Test: `tests/components/ServiceTimeline.test.ts`

Per spec §"Service History (timeline)" (line 1935), this is the chronological JobList scoped to the customer. Newest first. Each row shows date / service / vehicle / tireSize / city / price / technician. Tap opens existing `JobDetailModal`. Price gated by `canViewFinancials`. Bounded to the last 100 jobs (caller's responsibility — query is `where('customerId','==',cid), orderBy('date','desc'), limit(100)`).

- [ ] **Step 1: Write the failing test at `tests/components/ServiceTimeline.test.ts`**

  ```ts
  // ═══════════════════════════════════════════════════════════════════
  //  tests/components/ServiceTimeline.test.ts
  //  Run: npx tsx tests/components/ServiceTimeline.test.ts
  //  Spec ref: §"Service History (timeline)" (Customer Profile Sections)
  // ═══════════════════════════════════════════════════════════════════
  import { __pureHooks } from '@/components/customers/ServiceTimeline';

  let passed = 0; let failed = 0;
  function check(name: string, cond: boolean, detail?: string): void {
    if (cond) { passed++; console.log(`  ✓ ${name}`); }
    else { failed++; console.error(`  ✗ ${name}${detail ? `  — ${detail}` : ''}`); }
  }

  const { buildRow, sortNewestFirst } = __pureHooks;

  console.log('\n┌─ buildRow: financials gated ─────────────────────');
  {
    const r = buildRow({
      job: { id: 'j1', date: '2026-05-30', service: 'tire_swap',
             vehicleMakeModel: 'Honda Civic', tireSize: '215/55R17',
             city: 'Miami', revenue: 480, technicianName: 'Alex' } as any,
      canViewFinancials: true,
      serviceLabelFor: (id) => id === 'tire_swap' ? 'Tire Swap' : id,
    });
    check('service label resolved', r.serviceLabel === 'Tire Swap');
    check('price shown when financials allowed', r.priceLabel === '$480');
    check('vehicle label propagated', r.vehicleLabel === 'Honda Civic');
    check('city propagated',         r.cityLabel === 'Miami');
    check('technician propagated',   r.technicianLabel === 'Alex');
  }
  {
    const r = buildRow({
      job: { id: 'j1', revenue: 480 } as any,
      canViewFinancials: false,
      serviceLabelFor: (id) => id,
    });
    check('price hidden when financials denied', r.priceLabel === null);
  }

  console.log('\n┌─ sortNewestFirst ────────────────────────────────');
  {
    const sorted = sortNewestFirst([
      { id: 'a', date: '2026-05-01' } as any,
      { id: 'b', date: '2026-06-01' } as any,
      { id: 'c', date: '' } as any,
    ]);
    check('newest first', sorted[0].id === 'b');
    check('blank dates last', sorted[sorted.length - 1].id === 'c');
  }

  console.log('\n══════════════════════════════════════════════════');
  console.log(`  ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
  ```

- [ ] **Step 2: Run the test and verify it fails**

  Run: `npx tsx tests/components/ServiceTimeline.test.ts`
  Expected: missing-module error.

- [ ] **Step 3: Implement `src/components/customers/ServiceTimeline.tsx`**

  ```tsx
  // src/components/customers/ServiceTimeline.tsx
  // ═══════════════════════════════════════════════════════════════════
  //  ServiceTimeline — bounded chronological JobList for a customer.
  //
  //  Spec: §"Service History (timeline)"
  //
  //  Parent supplies the bounded 100-job array (queried with
  //  where('customerId','==',cid), orderBy('date','desc'), limit(100)).
  //  Caller wires tap → JobDetailModal via onSelectJob prop.
  // ═══════════════════════════════════════════════════════════════════

  import { memo, useMemo } from 'react';
  import type { Job } from '@/types';

  interface TimelineRow {
    jobId: string;
    dateLabel: string;
    serviceLabel: string;
    vehicleLabel: string | null;
    tireSizeLabel: string | null;
    cityLabel: string | null;
    priceLabel: string | null;
    technicianLabel: string | null;
  }

  function _buildRow(args: {
    job: Job;
    canViewFinancials: boolean;
    serviceLabelFor: (id: string) => string;
  }): TimelineRow {
    const j = args.job;
    const rev = typeof j.revenue === 'number' ? j.revenue : parseFloat(String(j.revenue ?? '0'));
    const dateLabel = j.date ? new Date(j.date).toLocaleDateString() : '—';
    return {
      jobId: j.id,
      dateLabel,
      serviceLabel: j.service ? args.serviceLabelFor(j.service) : '—',
      vehicleLabel: j.vehicleMakeModel ?? j.vehicleType ?? null,
      tireSizeLabel: j.tireSize ?? null,
      cityLabel: j.city ?? null,
      priceLabel: args.canViewFinancials && Number.isFinite(rev) && rev > 0
        ? '$' + rev.toFixed(0)
        : null,
      technicianLabel: (j as unknown as { technicianName?: string }).technicianName ?? null,
    };
  }

  function _sortNewestFirst(jobs: Job[]): Job[] {
    return [...jobs].sort((a, b) => {
      const ax = a.date ? Date.parse(a.date) : 0;
      const bx = b.date ? Date.parse(b.date) : 0;
      return bx - ax;
    });
  }

  interface Props {
    jobs: Job[];
    canViewFinancials: boolean;
    serviceLabelFor: (id: string) => string;
    onSelectJob?: (job: Job) => void;
  }

  function ServiceTimelineImpl({ jobs, canViewFinancials, serviceLabelFor, onSelectJob }: Props) {
    const sorted = useMemo(() => _sortNewestFirst(jobs), [jobs]);
    const rows = useMemo(
      () => sorted.map(j => _buildRow({ job: j, canViewFinancials, serviceLabelFor })),
      [sorted, canViewFinancials, serviceLabelFor],
    );

    if (sorted.length === 0) {
      return (
        <section className="service-timeline" aria-label="Service History">
          <header className="section-header">Service History</header>
          <p className="empty-state">No service history yet.</p>
        </section>
      );
    }

    return (
      <section className="service-timeline" aria-label="Service History">
        <header className="section-header">Service History ({sorted.length})</header>
        <ul className="service-timeline-list">
          {sorted.map((j, i) => {
            const r = rows[i];
            return (
              <li key={j.id} className="service-timeline-row">
                <button
                  type="button"
                  className="timeline-tap"
                  onClick={() => onSelectJob?.(j)}
                  aria-label={`Open job from ${r.dateLabel}`}
                >
                  <span className="t-date">{r.dateLabel}</span>
                  <span className="t-service">{r.serviceLabel}</span>
                  {r.vehicleLabel && <span className="t-vehicle">{r.vehicleLabel}</span>}
                  {r.tireSizeLabel && <span className="t-tire">{r.tireSizeLabel}</span>}
                  {r.cityLabel && <span className="t-city">{r.cityLabel}</span>}
                  {r.priceLabel && <span className="t-price">{r.priceLabel}</span>}
                  {r.technicianLabel && <span className="t-tech">{r.technicianLabel}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      </section>
    );
  }

  export const ServiceTimeline = memo(ServiceTimelineImpl);

  export const __pureHooks = {
    buildRow: _buildRow,
    sortNewestFirst: _sortNewestFirst,
  };
  ```

- [ ] **Step 4: Run the test and verify it passes**

  Run: `npx tsx tests/components/ServiceTimeline.test.ts`
  Expected: all green.

- [ ] **Step 5: Type-check**

  Run: `npm run typecheck`
  Expected: clean.

- [ ] **Step 6: Commit**

  ```bash
  git add src/components/customers/ServiceTimeline.tsx tests/components/ServiceTimeline.test.ts
  git commit -m "$(cat <<'EOF'
  feat(customers): ServiceTimeline chronological list (SP3 task 6)

  Bounded JobList scoped to a customer. Pure render — parent
  supplies the 100-job array. Price gated by canViewFinancials.
  Service label resolved via verticalConfig.services[id].label
  (vertical-agnostic per spec §"Per-vertical service-catalog
  label lookup").

  Spec: §"Service History (timeline)"
  EOF
  )"
  ```

---

## Task 7: ServiceHistoryPhotos component

**Files:**
- Create: `src/components/customers/ServiceHistoryPhotos.tsx`
- Test: `tests/components/ServiceHistoryPhotos.test.ts`

Per spec §"Service History Photos" (line 1940), this is a pure rendering aggregation over the bounded jobs array. Flattens `jobs.flatMap(j => (j.photos || []).map(p => ({ jobId, service, date, photoUrl: p })))` and groups by service type. No storage changes. Tap a photo → opens originating JobDetailModal scrolled to the photos sub-section.

- [ ] **Step 1: Write the failing test at `tests/components/ServiceHistoryPhotos.test.ts`**

  ```ts
  // ═══════════════════════════════════════════════════════════════════
  //  tests/components/ServiceHistoryPhotos.test.ts
  //  Run: npx tsx tests/components/ServiceHistoryPhotos.test.ts
  //  Spec ref: §"Service History Photos (v3.2 user-confirmed — refinement #7)"
  // ═══════════════════════════════════════════════════════════════════
  import { __pureHooks } from '@/components/customers/ServiceHistoryPhotos';

  let passed = 0; let failed = 0;
  function check(name: string, cond: boolean, detail?: string): void {
    if (cond) { passed++; console.log(`  ✓ ${name}`); }
    else { failed++; console.error(`  ✗ ${name}${detail ? `  — ${detail}` : ''}`); }
  }
  function eq<T>(a: T, b: T): boolean { return JSON.stringify(a) === JSON.stringify(b); }

  const { flattenPhotos, groupByService } = __pureHooks;

  console.log('\n┌─ flattenPhotos ──────────────────────────────────');
  {
    const jobs = [
      { id: 'j1', service: 'tire_swap', date: '2026-05-30', photos: ['url-a', 'url-b'] },
      { id: 'j2', service: 'rotation',  date: '2026-04-10', photos: ['url-c'] },
      { id: 'j3', service: 'tire_swap', date: '2026-03-01', photos: [] },
      { id: 'j4', service: 'tire_swap', date: '2026-02-01' /* no photos field */ },
    ] as any;
    const flat = flattenPhotos(jobs);
    check('total 3 photos', flat.length === 3);
    check('first photo from j1', flat[0].jobId === 'j1' && flat[0].photoUrl === 'url-a');
  }

  console.log('\n┌─ photos may be objects with .url ───────────────');
  {
    const jobs = [
      { id: 'j1', service: 'tire_swap', date: '2026-05-30',
        photos: [{ url: 'url-a' }, { url: 'url-b' }] },
    ] as any;
    const flat = flattenPhotos(jobs);
    check('object form → url extracted', flat.length === 2 && flat[0].photoUrl === 'url-a');
  }

  console.log('\n┌─ groupByService ─────────────────────────────────');
  {
    const photos = [
      { jobId: 'j1', service: 'tire_swap', date: '2026-05-30', photoUrl: 'a' },
      { jobId: 'j2', service: 'rotation',  date: '2026-04-10', photoUrl: 'c' },
      { jobId: 'j3', service: 'tire_swap', date: '2026-03-01', photoUrl: 'd' },
    ];
    const groups = groupByService(photos, (id) => id === 'tire_swap' ? 'Tire Swap' : 'Rotation');
    check('2 groups', groups.length === 2);
    const swap = groups.find(g => g.serviceId === 'tire_swap')!;
    check('tire_swap label', swap.label === 'Tire Swap');
    check('tire_swap has 2 photos', swap.photos.length === 2);
    check('newest in group first',
      swap.photos[0].date === '2026-05-30' && swap.photos[1].date === '2026-03-01');
  }

  console.log('\n══════════════════════════════════════════════════');
  console.log(`  ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
  ```

- [ ] **Step 2: Run the test and verify it fails**

  Run: `npx tsx tests/components/ServiceHistoryPhotos.test.ts`
  Expected: missing-module error.

- [ ] **Step 3: Implement `src/components/customers/ServiceHistoryPhotos.tsx`**

  ```tsx
  // src/components/customers/ServiceHistoryPhotos.tsx
  // ═══════════════════════════════════════════════════════════════════
  //  ServiceHistoryPhotos — aggregated photo grid grouped by service.
  //
  //  Spec: §"Service History Photos (v3.2 user-confirmed — refinement #7)"
  //
  //  Pure rendering — no new storage, no second Firestore query. Reads
  //  the same bounded 100-job array that CustomerProfile already loads
  //  for the timeline. Photos in Job.photos may be plain strings or
  //  { url, ... } objects; the helper handles both.
  // ═══════════════════════════════════════════════════════════════════

  import { memo, useMemo } from 'react';
  import type { Job } from '@/types';

  interface FlatPhoto {
    jobId: string;
    service: string;
    date: string;
    photoUrl: string;
  }

  interface PhotoGroup {
    serviceId: string;
    label: string;
    photos: FlatPhoto[];
  }

  function _extractUrl(p: unknown): string | null {
    if (typeof p === 'string') return p;
    if (p && typeof p === 'object' && 'url' in p && typeof (p as { url: unknown }).url === 'string') {
      return (p as { url: string }).url;
    }
    return null;
  }

  function _flattenPhotos(jobs: Job[]): FlatPhoto[] {
    const out: FlatPhoto[] = [];
    for (const j of jobs) {
      const photos = (j as unknown as { photos?: unknown[] }).photos;
      if (!Array.isArray(photos)) continue;
      for (const p of photos) {
        const url = _extractUrl(p);
        if (!url) continue;
        out.push({
          jobId: j.id,
          service: j.service ?? 'unknown',
          date: j.date ?? '',
          photoUrl: url,
        });
      }
    }
    return out;
  }

  function _groupByService(
    photos: FlatPhoto[],
    serviceLabelFor: (id: string) => string,
  ): PhotoGroup[] {
    const map = new Map<string, FlatPhoto[]>();
    for (const p of photos) {
      const list = map.get(p.service) ?? [];
      list.push(p);
      map.set(p.service, list);
    }
    const groups: PhotoGroup[] = [];
    for (const [serviceId, photos] of map) {
      photos.sort((a, b) => {
        const ax = a.date ? Date.parse(a.date) : 0;
        const bx = b.date ? Date.parse(b.date) : 0;
        return bx - ax;
      });
      groups.push({
        serviceId,
        label: serviceLabelFor(serviceId),
        photos,
      });
    }
    groups.sort((a, b) => a.label.localeCompare(b.label));
    return groups;
  }

  interface Props {
    jobs: Job[];
    serviceLabelFor: (id: string) => string;
    onSelectPhoto?: (photo: FlatPhoto) => void;
  }

  function ServiceHistoryPhotosImpl({ jobs, serviceLabelFor, onSelectPhoto }: Props) {
    const groups = useMemo(() => {
      const flat = _flattenPhotos(jobs);
      return _groupByService(flat, serviceLabelFor);
    }, [jobs, serviceLabelFor]);

    if (groups.length === 0) {
      return (
        <section className="service-photos" aria-label="Service Photos">
          <header className="section-header">Service Photos</header>
          <p className="empty-state">No service photos yet.</p>
        </section>
      );
    }

    return (
      <section className="service-photos" aria-label="Service Photos">
        <header className="section-header">Service Photos</header>
        {groups.map(g => (
          <details key={g.serviceId} className="photo-group" open>
            <summary>{g.label} ({g.photos.length})</summary>
            <div className="photo-strip">
              {g.photos.map((p, i) => (
                <button
                  key={`${p.jobId}:${i}`}
                  type="button"
                  className="photo-thumb"
                  onClick={() => onSelectPhoto?.(p)}
                  aria-label={`Open job ${p.jobId}`}
                >
                  <img src={p.photoUrl} alt="" loading="lazy" />
                </button>
              ))}
            </div>
          </details>
        ))}
      </section>
    );
  }

  export const ServiceHistoryPhotos = memo(ServiceHistoryPhotosImpl);

  export const __pureHooks = {
    flattenPhotos: _flattenPhotos,
    groupByService: _groupByService,
  };
  ```

- [ ] **Step 4: Run the test and verify it passes**

  Run: `npx tsx tests/components/ServiceHistoryPhotos.test.ts`
  Expected: all green.

- [ ] **Step 5: Type-check**

  Run: `npm run typecheck`
  Expected: clean.

- [ ] **Step 6: Commit**

  ```bash
  git add src/components/customers/ServiceHistoryPhotos.tsx tests/components/ServiceHistoryPhotos.test.ts
  git commit -m "$(cat <<'EOF'
  feat(customers): ServiceHistoryPhotos aggregation (SP3 task 7)

  Pure rendering aggregation over the bounded 100-job array.
  Handles both string-form and { url } object-form Job.photos.
  Groups by service type, sorts newest-first within group, no
  new Firestore reads, no new storage.

  Spec: §"Service History Photos (refinement #7)"
  EOF
  )"
  ```

---

## Task 8: CustomerProfile page (the big composition)

**Files:**
- Create: `src/pages/CustomerProfile.tsx`

Per spec §"Customer Profile Sections (v3.2 user-confirmed)" (line 1924), this page composes Tasks 3-7 plus the Quick Actions row and header. Section order (locked by spec):

1. Header (name + kind badge + VIP badge + customerStatus badge + phone + repeat-customer badge + tags)
2. Quick Actions row (11 buttons — Create Job, Repeat Last Job, Repeat Last Service, Call, Text, Send Quote, Send Invoice, Send Review, View Photos, View Invoices, View History)
3. CustomerInsightsCard
4. VehiclesSection
5. CustomerNotesSection (Quick Notes)
6. ServiceTimeline
7. ServiceHistoryPhotos
8. Notes (free-text `note` field — kept inline for SP3, no extraction)
9. Communication log placeholder (SP4 fills)

Loads via three onSnapshot listeners:
- `customers/{cid}` — Customer doc (single)
- `customers/{cid}/vehicles` — Vehicles subcollection
- `jobs where customerId == cid orderBy date desc limit 100` — bounded jobs window

RBAC: financial fields gated by `canViewFinancials`. Quick Notes editable gated by `canEditBusinessSettings`.

- [ ] **Step 1: Implement `src/pages/CustomerProfile.tsx`**

  ```tsx
  // src/pages/CustomerProfile.tsx
  // ═══════════════════════════════════════════════════════════════════
  //  CustomerProfile — the deep customer page.
  //
  //  Spec: docs/superpowers/specs/2026-06-03-customer-intelligence-design.md
  //        §"Customer Profile Sections (v3.2 user-confirmed)"
  //        §"Customer Profile Actions" (Quick Actions row — 11 buttons)
  //
  //  Section order is LOCKED by spec line 1928-1939:
  //    1. Header
  //    2. Quick Actions row
  //    3. CustomerInsightsCard
  //    4. VehiclesSection
  //    5. CustomerNotesSection (Quick Notes)
  //    6. ServiceTimeline
  //    7. ServiceHistoryPhotos
  //    8. Notes (free-text `note`)
  //    9. Communication log (SP4 — empty placeholder in SP3)
  //
  //  RBAC: canViewFinancials gates revenue/profit fields.
  //        canEditBusinessSettings gates Quick Notes inline edit.
  // ═══════════════════════════════════════════════════════════════════

  import { useEffect, useMemo, useState } from 'react';
  import {
    collection, doc, limit, onSnapshot, orderBy, query, where,
  } from 'firebase/firestore';
  import { _db } from '@/lib/firebase';
  import { formatPhoneForDisplay } from '@/lib/phone';
  import type { Customer, Vehicle } from '@/lib/customerEntity';
  import type { Job, Permissions, Settings } from '@/types';
  import { CustomerInsightsCard } from '@/components/customers/CustomerInsightsCard';
  import { CustomerNotesSection } from '@/components/customers/CustomerNotesSection';
  import { VehiclesSection } from '@/components/customers/VehiclesSection';
  import { ServiceTimeline } from '@/components/customers/ServiceTimeline';
  import { ServiceHistoryPhotos } from '@/components/customers/ServiceHistoryPhotos';

  interface Props {
    businessId: string;
    customerId: string;
    permissions: Permissions;
    settings: Settings;
    currentUserUid: string;
    onBack: () => void;
    onViewJob?: (job: Job) => void;
    onCreateJob?: (draft: Partial<Job>) => void;
    onRepeatLastJob?: (job: Job) => void;
    onRepeatLastService?: (customerId: string) => void;
    serviceLabelFor: (id: string) => string;
  }

  export default function CustomerProfile(props: Props): JSX.Element {
    const { businessId, customerId } = props;
    const [customer, setCustomer] = useState<Customer | null>(null);
    const [vehicles, setVehicles] = useState<Vehicle[]>([]);
    const [jobs, setJobs] = useState<Job[]>([]);
    const [loading, setLoading] = useState(true);

    // Customer doc listener
    useEffect(() => {
      const ref = doc(_db, 'businesses', businessId, 'customers', customerId);
      const unsub = onSnapshot(ref, (snap) => {
        setCustomer(snap.exists() ? ({ id: snap.id, ...snap.data() } as Customer) : null);
        setLoading(false);
      });
      return unsub;
    }, [businessId, customerId]);

    // Vehicles subcollection listener
    useEffect(() => {
      const q = collection(_db, 'businesses', businessId, 'customers', customerId, 'vehicles');
      const unsub = onSnapshot(q, (snap) => {
        setVehicles(snap.docs.map(d => ({ id: d.id, ...d.data() } as Vehicle)));
      });
      return unsub;
    }, [businessId, customerId]);

    // Bounded jobs listener (100 newest)
    useEffect(() => {
      const q = query(
        collection(_db, 'businesses', businessId, 'jobs'),
        where('customerId', '==', customerId),
        orderBy('date', 'desc'),
        limit(100),
      );
      const unsub = onSnapshot(q, (snap) => {
        setJobs(snap.docs.map(d => ({ id: d.id, ...d.data() } as Job)));
      });
      return unsub;
    }, [businessId, customerId]);

    const phoneLabel = useMemo(
      () => customer?.phoneE164 ? formatPhoneForDisplay(customer.phoneE164) : '',
      [customer?.phoneE164],
    );

    const lastJob = jobs[0] ?? null;

    if (loading) return <div className="page-shell"><p>Loading…</p></div>;
    if (!customer) {
      return (
        <div className="page-shell">
          <button type="button" className="btn sm secondary" onClick={props.onBack}>← Back</button>
          <p>Customer not found.</p>
        </div>
      );
    }

    const onCall = () => {
      if (!customer.phoneE164) return;
      window.location.href = `tel:${customer.phoneE164}`;
    };
    const onText = () => {
      if (!customer.phoneE164) return;
      // SP3 native-only — SP4 swaps to sendSMS when twilioConnected.
      window.location.href = `sms:${customer.phoneE164}`;
    };
    const onCreateJob = () => {
      props.onCreateJob?.({
        customerId: customer.id,
        customerName: customer.name,
        customerPhone: customer.phoneE164,
        customerEmail: customer.email,
        city: customer.city,
        state: customer.state,
      } as Partial<Job>);
    };
    const onRepeatLastJob = () => { if (lastJob) props.onRepeatLastJob?.(lastJob); };
    const onRepeatLastService = () => { props.onRepeatLastService?.(customer.id); };

    return (
      <div className="page-shell customer-profile">
        {/* 1. Header */}
        <header className="profile-header">
          <button type="button" className="btn sm secondary" onClick={props.onBack}>← Back</button>
          <h1>{customer.name}</h1>
          <div className="profile-badges">
            {customer.kind === 'fleet' && <span className="badge fleet">Fleet</span>}
            {customer.vipTier && customer.vipTier !== 'Standard' &&
              <span className={`vip-badge vip-${customer.vipTier.toLowerCase()}`}>{customer.vipTier}</span>}
            {customer.customerStatus && <span className="badge status">{customer.customerStatus}</span>}
            {(customer.jobCount ?? 0) > 1 && <span className="badge repeat">Repeat</span>}
          </div>
          {phoneLabel && <div className="profile-phone">{phoneLabel}</div>}
          {customer.tags && customer.tags.length > 0 && (
            <div className="profile-tags">{customer.tags.map(t => (
              <span key={t} className="tag-chip">{t}</span>
            ))}</div>
          )}
        </header>

        {/* 2. Quick Actions (11 buttons per spec line 1906) */}
        <nav className="quick-actions" aria-label="Quick Actions">
          <button type="button" onClick={onCreateJob}>Create Job</button>
          <button type="button" onClick={onRepeatLastJob} disabled={!lastJob}>Repeat Last Job</button>
          <button type="button" onClick={onRepeatLastService} disabled={!lastJob}>Repeat Last Service</button>
          <button type="button" onClick={onCall} disabled={!customer.phoneE164}>Call</button>
          <button type="button" onClick={onText} disabled={!customer.phoneE164}>Text</button>
          <button type="button" disabled title="Send Quote — wired in SP3 follow-up">Send Quote</button>
          <button type="button" disabled title="Send Invoice — wired in SP3 follow-up">Send Invoice</button>
          <button type="button" disabled title="Send Review — wired in SP3 follow-up">Send Review</button>
          <button type="button" disabled title="View Photos — scrolls to Service Photos section">View Photos</button>
          <button type="button" disabled title="View Invoices — wired in SP3 follow-up">View Invoices</button>
          <button type="button" disabled title="View History — scrolls to Service Timeline">View History</button>
        </nav>

        {/* 3. CustomerInsightsCard */}
        <CustomerInsightsCard
          customer={customer}
          jobs={jobs}
          canViewFinancials={props.permissions.canViewFinancials}
          serviceLabelFor={props.serviceLabelFor}
        />

        {/* 4. Vehicles */}
        <VehiclesSection
          vehicles={vehicles}
          canEdit={props.permissions.canEditBusinessSettings}
        />

        {/* 5. Quick Notes */}
        <CustomerNotesSection
          businessId={businessId}
          customer={customer}
          canEdit={props.permissions.canEditBusinessSettings}
          editorUid={props.currentUserUid}
        />

        {/* 6. Service Timeline */}
        <ServiceTimeline
          jobs={jobs}
          canViewFinancials={props.permissions.canViewFinancials}
          serviceLabelFor={props.serviceLabelFor}
          onSelectJob={props.onViewJob}
        />

        {/* 7. Service History Photos */}
        <ServiceHistoryPhotos
          jobs={jobs}
          serviceLabelFor={props.serviceLabelFor}
          onSelectPhoto={(p) => {
            const j = jobs.find(x => x.id === p.jobId);
            if (j) props.onViewJob?.(j);
          }}
        />

        {/* 8. Notes (free-text) */}
        {customer.note && (
          <section className="profile-notes" aria-label="Notes">
            <header className="section-header">Notes</header>
            <p>{customer.note}</p>
          </section>
        )}

        {/* 9. Communication log placeholder (SP4 populates) */}
        <section className="comm-log" aria-label="Communication History">
          <header className="section-header">Communication History</header>
          <p className="empty-state">Calls and texts appear here once Twilio is connected.</p>
        </section>
      </div>
    );
  }
  ```

- [ ] **Step 2: Type-check**

  Run: `npm run typecheck`
  Expected: clean (assuming the Job type has `customerId`/`customerName`/`customerPhone`/`customerEmail` fields — if any are missing, add them as optional in `src/types/index.ts` Job interface in this same task, before the typecheck).

- [ ] **Step 3: Self-review**

  - Section order matches spec line 1928-1939 exactly.
  - Quick Actions row has all 11 buttons per the user's spec-aligned scope (8 disabled-in-SP3 placeholders for Send Quote/Invoice/Review and View Photos/Invoices/History — these wire in a follow-up; the 5 functional buttons Create Job, Repeat Last Job, Repeat Last Service, Call, Text are live).
  - The Send Quote / Send Invoice / Send Review buttons remain DISABLED here per spec — wiring them touches three existing modules (QuoteWorkflow, invoice send flow, ReviewAutomation) which would balloon the SP3 PR. They're enabled in a follow-up "Quick Actions wiring" pass; the SP3 ship-value section still delivers Create Job + Repeat Last + Call + Text + browse insights.
  - Jobs query is properly bounded to `limit(100)` per spec §"Insights jobs-load bound".

- [ ] **Step 4: Commit**

  ```bash
  git add src/pages/CustomerProfile.tsx
  git commit -m "$(cat <<'EOF'
  feat(customers): CustomerProfile deep page (SP3 task 8)

  The big composition: Header / Quick Actions / InsightsCard /
  Vehicles / QuickNotes / Timeline / Photos / Notes / Comm log
  placeholder. Three onSnapshot listeners (customer doc, vehicles
  subcollection, bounded 100-job query). RBAC: financial fields
  gated by canViewFinancials; Quick Notes edit gated by
  canEditBusinessSettings.

  5 Quick Action buttons live (Create Job, Repeat Last Job/Service,
  Call, Text). 6 buttons rendered disabled in SP3 — wired in the
  follow-up Quick Actions pass.

  Spec: §"Customer Profile Sections (v3.2 user-confirmed)",
        §"Customer Profile Actions"
  EOF
  )"
  ```

---

## Task 9: CustomerHub upgrade (replace SP1 skeleton)

**Files:**
- Modify: `src/pages/CustomerHub.tsx`

Per spec §"Customer Directory" preamble (line 37): "today the file is `src/pages/Customers.tsx` and the v3.2 plan is to evolve it in-place rather than fork a new component, preserving the existing route." SP1 kept the SP1 skeleton wrapping the legacy Customers page; SP3 replaces the skeleton body with a real implementation:

- Header bar with global-search-icon hint (full GlobalSearchSheet in Task 10) + sort selector (recent / lifetime revenue / name) + status filter
- Customer list reading from `businesses/{bid}/customers` onSnapshot (NOT derived from jobs anymore)
- Virtualized rendering for >500 customers (windowed render — minimum viable: only render first 200 + "Show more" — keeps the SP3 PR scope bounded, matches spec §"Scale tiers" T0 client-side budget)
- VIP badge + customerStatus chip per row
- Row click pushes `customerId` via the `onOpenProfile(customerId)` callback

The legacy `src/pages/Customers.tsx` keeps its current responsibilities (it's still used by other call-sites historically) — CustomerHub.tsx becomes the new top-level page and supersedes it for the Customers tab. The spec calls this in-place evolution at line 37.

- [ ] **Step 1: Read the current CustomerHub.tsx skeleton**

  Run: `cat src/pages/CustomerHub.tsx`
  Expected: the 40-line SP1 skeleton wrapping `<Customers/>`. Confirm before rewriting.

- [ ] **Step 2: Replace `src/pages/CustomerHub.tsx`**

  ```tsx
  // src/pages/CustomerHub.tsx
  // ═══════════════════════════════════════════════════════════════════
  //  CustomerHub — SP3 real implementation.
  //
  //  Spec: docs/superpowers/specs/2026-06-03-customer-intelligence-design.md
  //        §"Customer Directory" (preamble — in-place evolution)
  //
  //  Header (search hint + sort + filter)
  //  Customer list from businesses/{bid}/customers onSnapshot
  //  VIP + status badges per row
  //  Row tap → onOpenProfile(customerId)
  // ═══════════════════════════════════════════════════════════════════

  import { useEffect, useMemo, useState } from 'react';
  import { collection, onSnapshot } from 'firebase/firestore';
  import { _db } from '@/lib/firebase';
  import { formatPhoneForDisplay } from '@/lib/phone';
  import type { Customer } from '@/lib/customerEntity';
  import type { Job, Settings } from '@/types';

  type SortKey = 'recent' | 'revenue' | 'name';

  interface Props {
    businessId: string;
    jobs: Job[];
    settings: Settings;
    canViewFinancials: boolean;
    onOpenProfile: (customerId: string) => void;
    onOpenSearch?: () => void;
  }

  const PAGE_SIZE = 200;

  export default function CustomerHub(props: Props): JSX.Element {
    const [customers, setCustomers] = useState<Customer[]>([]);
    const [loading, setLoading] = useState(true);
    const [sortKey, setSortKey] = useState<SortKey>('recent');
    const [statusFilter, setStatusFilter] = useState<'' | 'Active' | 'Inactive' | 'Fleet' | 'Archived'>('');
    const [vipFilter, setVipFilter] = useState<'' | 'Standard' | 'Gold' | 'Platinum'>('');
    const [pageCount, setPageCount] = useState(1);

    useEffect(() => {
      const q = collection(_db, 'businesses', props.businessId, 'customers');
      const unsub = onSnapshot(q, (snap) => {
        const list = snap.docs.map(d => ({ id: d.id, ...d.data() } as Customer))
                              .filter(c => !c.deletedAt);
        setCustomers(list);
        setLoading(false);
      });
      return unsub;
    }, [props.businessId]);

    const filtered = useMemo(() => {
      let list = customers;
      if (statusFilter) list = list.filter(c => c.customerStatus === statusFilter);
      if (vipFilter)    list = list.filter(c => (c.vipTier ?? 'Standard') === vipFilter);
      const sorted = [...list].sort((a, b) => {
        switch (sortKey) {
          case 'recent': {
            const ax = a.lastJobAt ? Date.parse(a.lastJobAt) : 0;
            const bx = b.lastJobAt ? Date.parse(b.lastJobAt) : 0;
            return bx - ax;
          }
          case 'revenue': {
            // Read averageTicket (rollup) — lifetimeRevenue is not persisted.
            const ax = a.averageTicket ?? 0;
            const bx = b.averageTicket ?? 0;
            return bx - ax;
          }
          case 'name':
          default:
            return (a.name || '').localeCompare(b.name || '');
        }
      });
      return sorted;
    }, [customers, sortKey, statusFilter, vipFilter]);

    const visible = filtered.slice(0, pageCount * PAGE_SIZE);

    if (loading) {
      return <div className="page-shell"><p>Loading customers…</p></div>;
    }

    return (
      <div className="page-shell customer-hub">
        <header className="hub-header">
          <h1>Customers</h1>
          <div className="hub-toolbar">
            {props.onOpenSearch && (
              <button type="button" className="btn sm secondary" onClick={props.onOpenSearch}>
                🔍 Search
              </button>
            )}
            <label className="hub-sort">
              Sort:
              <select value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)}>
                <option value="recent">Recent</option>
                <option value="revenue">Average Ticket</option>
                <option value="name">Name</option>
              </select>
            </label>
            <label className="hub-filter">
              Status:
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}>
                <option value="">All</option>
                <option value="Active">Active</option>
                <option value="Inactive">Inactive</option>
                <option value="Fleet">Fleet</option>
                <option value="Archived">Archived</option>
              </select>
            </label>
            <label className="hub-filter">
              VIP:
              <select value={vipFilter} onChange={(e) => setVipFilter(e.target.value as typeof vipFilter)}>
                <option value="">All</option>
                <option value="Standard">Standard</option>
                <option value="Gold">Gold</option>
                <option value="Platinum">Platinum</option>
              </select>
            </label>
          </div>
        </header>

        <p className="hub-count">{filtered.length} customer{filtered.length === 1 ? '' : 's'}</p>

        {visible.length === 0 ? (
          <p className="empty-state">No customers match these filters.</p>
        ) : (
          <ul className="customer-list">
            {visible.map(c => (
              <li key={c.id}>
                <button
                  type="button"
                  className="customer-row"
                  onClick={() => props.onOpenProfile(c.id)}
                >
                  <span className="customer-name">{c.name || '(unnamed)'}</span>
                  {c.phoneE164 && <span className="customer-phone">{formatPhoneForDisplay(c.phoneE164)}</span>}
                  {c.city && <span className="customer-city">{c.city}</span>}
                  {c.vipTier && c.vipTier !== 'Standard' && (
                    <span className={`vip-badge vip-${c.vipTier.toLowerCase()}`}>{c.vipTier}</span>
                  )}
                  {c.customerStatus && c.customerStatus !== 'Active' && (
                    <span className="badge status">{c.customerStatus}</span>
                  )}
                  {props.canViewFinancials && c.averageTicket !== undefined && (
                    <span className="customer-avg">${Math.round(c.averageTicket)}</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}

        {filtered.length > visible.length && (
          <button type="button" className="btn secondary" onClick={() => setPageCount(p => p + 1)}>
            Show more ({filtered.length - visible.length} remaining)
          </button>
        )}
      </div>
    );
  }
  ```

- [ ] **Step 3: Type-check**

  Run: `npm run typecheck`
  Expected: clean.

- [ ] **Step 4: Run all existing tests to confirm no regression**

  Run: `npm test`
  Expected: every test file green (SP1, SP2, plus the SP3 tests committed in Tasks 1-7).

- [ ] **Step 5: Self-review**

  - The previous SP1 skeleton wrapped `<Customers/>` — that legacy page now has NO consumer. The follow-up audit (Task 15 Step 5) decides whether to delete `src/pages/Customers.tsx` outright or keep it as a back-reference. The SP3 plan leaves it in place; deletion is a low-risk cleanup deferred to SP4.
  - The `onOpenProfile` callback prop replaces the SP1 `onViewJob` prop — Task 15 wires this in App.tsx.

- [ ] **Step 6: Commit**

  ```bash
  git add src/pages/CustomerHub.tsx
  git commit -m "$(cat <<'EOF'
  feat(customers): CustomerHub real implementation (SP3 task 9)

  Replaces the SP1 skeleton wrapper. Reads from
  businesses/{bid}/customers onSnapshot — no longer derives the
  customer list from jobs. Header toolbar with search-shortcut /
  sort (recent / averageTicket / name) / status + VIP filters.
  Paginated 200-row windows for cold-tenant scale tier T0/T1. Row
  tap dispatches onOpenProfile(customerId) — App.tsx wires the
  CustomerProfile route in SP3 task 15.

  Spec: §"Customer Directory" (preamble)
  EOF
  )"
  ```

---

## Task 10: GlobalSearchSheet bottom-sheet

**Files:**
- Create: `src/components/GlobalSearchSheet.tsx`
- Test: `tests/components/GlobalSearchSheet.test.ts`

Per spec §"Global Customer Search (Phase 5)" entry surface (line 1965), this is the bottom-sheet search modal triggered by the main-nav search icon. Uses `MemoInput` style with `inputmode='search'`, `autocapitalize='off'`, `autocorrect='off'`, `spellcheck='false'` (line 2017). 200ms debounce. Calls Task 1's `searchCustomers` helper. Result row tap deep-links to CustomerProfile.

- [ ] **Step 1: Write the failing test at `tests/components/GlobalSearchSheet.test.ts`**

  ```ts
  // ═══════════════════════════════════════════════════════════════════
  //  tests/components/GlobalSearchSheet.test.ts
  //  Run: npx tsx tests/components/GlobalSearchSheet.test.ts
  //  Spec ref: §"Global Customer Search (Phase 5)"
  // ═══════════════════════════════════════════════════════════════════
  import { __pureHooks } from '@/components/GlobalSearchSheet';

  let passed = 0; let failed = 0;
  function check(name: string, cond: boolean, detail?: string): void {
    if (cond) { passed++; console.log(`  ✓ ${name}`); }
    else { failed++; console.error(`  ✗ ${name}${detail ? `  — ${detail}` : ''}`); }
  }

  const { deriveDisplayState, buildResultLabel } = __pureHooks;

  console.log('\n┌─ deriveDisplayState ─────────────────────────────');
  check('empty query → prompt',  deriveDisplayState({ query: '', loading: false, results: [] }).kind === 'prompt');
  check('1-char query → prompt', deriveDisplayState({ query: 'a', loading: false, results: [] }).kind === 'prompt');
  check('searching',             deriveDisplayState({ query: 'te', loading: true, results: [] }).kind === 'loading');
  check('no match',              deriveDisplayState({ query: 'te', loading: false, results: [] }).kind === 'empty');
  check('results',
    deriveDisplayState({
      query: 'te',
      loading: false,
      results: [{ customer: { id: 'p_1', name: 'Tesla' }, matchedVehicles: [], matchedField: 'name' }] as any,
    }).kind === 'results');

  console.log('\n┌─ buildResultLabel ───────────────────────────────');
  {
    const label = buildResultLabel({
      customer: { id: 'p_1', name: 'Maria Lopez', phoneE164: '+13058977030', city: 'Miami', state: 'FL', vipTier: 'Gold' } as any,
      matchedVehicles: [{ id: 'v1', make: 'Honda', model: 'Civic', vehicleMakeModel: 'Honda Civic', licensePlate: 'ABC123' } as any],
    });
    check('includes name',  label.includes('Maria Lopez'));
    check('includes phone', label.includes('305') && label.includes('897'));
    check('includes city',  label.includes('Miami'));
    check('includes vehicle', label.includes('Honda Civic'));
  }

  console.log('\n══════════════════════════════════════════════════');
  console.log(`  ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
  ```

- [ ] **Step 2: Run the test and verify it fails**

  Run: `npx tsx tests/components/GlobalSearchSheet.test.ts`
  Expected: missing-module error.

- [ ] **Step 3: Implement `src/components/GlobalSearchSheet.tsx`**

  ```tsx
  // src/components/GlobalSearchSheet.tsx
  // ═══════════════════════════════════════════════════════════════════
  //  GlobalSearchSheet — bottom-sheet modal for cross-customer search.
  //
  //  Spec: §"Global Customer Search (Phase 5)" — Entry surface (line 1965)
  //
  //  Triggered by main-nav search icon (wired in Task 15).
  //  Uses MemoInput pattern with mobile-keyboard hints.
  //  200ms debounce; cancels stale lookups via monotonic seq counter.
  //  Result row tap → onOpenProfile(customerId) → close.
  // ═══════════════════════════════════════════════════════════════════

  import { memo, useCallback, useEffect, useRef, useState } from 'react';
  import { searchCustomers, type SearchResult } from '@/lib/searchCustomers';
  import { formatPhoneForDisplay } from '@/lib/phone';
  import type { Customer, Vehicle } from '@/lib/customerEntity';

  interface DisplayState {
    kind: 'prompt' | 'loading' | 'empty' | 'results';
  }

  function _deriveDisplayState(args: {
    query: string;
    loading: boolean;
    results: SearchResult[];
  }): DisplayState {
    const q = args.query.trim();
    if (q.length < 2) return { kind: 'prompt' };
    if (args.loading) return { kind: 'loading' };
    if (args.results.length === 0) return { kind: 'empty' };
    return { kind: 'results' };
  }

  function _buildResultLabel(args: {
    customer: Customer;
    matchedVehicles: Vehicle[];
  }): string {
    const parts: string[] = [args.customer.name || '(unnamed)'];
    if (args.customer.phoneE164) parts.push(formatPhoneForDisplay(args.customer.phoneE164));
    if (args.customer.city) parts.push(args.customer.city);
    if (args.customer.state) parts.push(args.customer.state);
    for (const v of args.matchedVehicles) {
      const label = v.vehicleMakeModel ?? [v.make, v.model].filter(Boolean).join(' ');
      if (label) parts.push(label);
      if (v.licensePlate) parts.push(v.licensePlate);
    }
    return parts.join(' · ');
  }

  interface Props {
    businessId: string;
    open: boolean;
    onClose: () => void;
    onOpenProfile: (customerId: string) => void;
    scopedCustomerIds?: Set<string>;
  }

  function GlobalSearchSheetImpl({ businessId, open, onClose, onOpenProfile, scopedCustomerIds }: Props) {
    const [query, setQuery] = useState('');
    const [loading, setLoading] = useState(false);
    const [results, setResults] = useState<SearchResult[]>([]);
    const seqRef = useRef(0);

    // Reset on open/close
    useEffect(() => { if (!open) { setQuery(''); setResults([]); setLoading(false); } }, [open]);

    // 200ms debounce
    useEffect(() => {
      if (!open) return;
      if (query.trim().length < 2 && query.replace(/\D/g, '').length < 2) {
        setResults([]); setLoading(false); return;
      }
      const handle = window.setTimeout(() => {
        const seq = ++seqRef.current;
        setLoading(true);
        searchCustomers(businessId, query, { scopedCustomerIds })
          .then((rs) => {
            if (seq !== seqRef.current) return;
            setResults(rs);
            setLoading(false);
          })
          .catch(() => {
            if (seq !== seqRef.current) return;
            setResults([]); setLoading(false);
          });
      }, 200);
      return () => window.clearTimeout(handle);
    }, [open, query, businessId, scopedCustomerIds]);

    const onQueryChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
      setQuery(e.target.value);
    }, []);

    const display = _deriveDisplayState({ query, loading, results });

    if (!open) return null;

    return (
      <div className="modal-overlay search-sheet" role="search" onClick={onClose}>
        <div className="modal-content search-sheet-content" onClick={(e) => e.stopPropagation()}>
          <header className="search-header">
            <input
              type="text"
              autoFocus
              value={query}
              placeholder="Search by name, phone, vehicle, plate, tire size, city, or zip"
              inputMode="search"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              onChange={onQueryChange}
            />
            <button type="button" className="btn sm secondary" onClick={onClose}>Close</button>
          </header>
          {display.kind === 'prompt' && (
            <p className="search-prompt">Search by name, phone, company, vehicle, plate, tire size, city, or zip.</p>
          )}
          {display.kind === 'loading' && <p className="search-loading">Searching…</p>}
          {display.kind === 'empty' && (
            <p className="search-empty">No customers match '{query}' — try a phone number or vehicle plate.</p>
          )}
          {display.kind === 'results' && (
            <ul className="search-results">
              {results.map(r => (
                <li key={r.customer.id}>
                  <button
                    type="button"
                    className="search-result-row"
                    onClick={() => { onOpenProfile(r.customer.id); onClose(); }}
                  >
                    {_buildResultLabel({ customer: r.customer, matchedVehicles: r.matchedVehicles })}
                    {r.customer.vipTier && r.customer.vipTier !== 'Standard' && (
                      <span className={`vip-badge vip-${r.customer.vipTier.toLowerCase()}`}>{r.customer.vipTier}</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    );
  }

  export const GlobalSearchSheet = memo(GlobalSearchSheetImpl);

  export const __pureHooks = {
    deriveDisplayState: _deriveDisplayState,
    buildResultLabel: _buildResultLabel,
  };
  ```

- [ ] **Step 4: Run the test and verify it passes**

  Run: `npx tsx tests/components/GlobalSearchSheet.test.ts`
  Expected: all green.

- [ ] **Step 5: Type-check**

  Run: `npm run typecheck`
  Expected: clean.

- [ ] **Step 6: Commit**

  ```bash
  git add src/components/GlobalSearchSheet.tsx tests/components/GlobalSearchSheet.test.ts
  git commit -m "$(cat <<'EOF'
  feat(search): GlobalSearchSheet bottom-sheet modal (SP3 task 10)

  Bottom-sheet search UI wired to searchCustomers (Task 1).
  200ms debounce + monotonic seq cancellation. Mobile keyboard
  hints (inputmode=search, autocapitalize=off, autocorrect=off,
  spellcheck=false) so operators can type tire sizes like
  235/45R18 and license plates without iOS auto-correct
  sabotaging the query. Tap result → onOpenProfile(customerId)
  + close.

  Spec: §"Global Customer Search (Phase 5)" — Entry surface
  EOF
  )"
  ```

---

## Task 11: CustomerDirectorySettingsSection + Backfill admin button

**Files:**
- Create: `src/components/settings/CustomerDirectorySettingsSection.tsx`

Per spec §"Auto-Save Customers Setting (Phase 17)" §"Placement" (line 2207) and §"Backfill Existing Jobs (Phase 3)" §"Trigger UX" (line 2397), this Settings accordion holds:

- "Auto-save customers from completed jobs" toggle bound to `settings.autoSaveCustomersFromJobs`
- "Backfill Customers from Job History" admin button (owner-only) that calls the `backfillCustomers` callable from Task 13
- OFF→ON transition banner (when `autoSaveCustomersFromJobs === true` AND `autoSaveDisabledAt` exists AND no recent backfill audit doc — per spec §"OFF→ON transition behavior" line 2246)

The Backfill button shows a confirmation modal with the dry-run estimate before the live run. Progress + audit-doc summary toast on completion.

- [ ] **Step 1: Implement `src/components/settings/CustomerDirectorySettingsSection.tsx`**

  ```tsx
  // src/components/settings/CustomerDirectorySettingsSection.tsx
  // ═══════════════════════════════════════════════════════════════════
  //  CustomerDirectorySettingsSection — Settings accordion.
  //
  //  Spec: §"Auto-Save Customers Setting (Phase 17)" §"Placement"
  //        §"Backfill Existing Jobs (Phase 3)" §"Trigger UX"
  //
  //  Owner/admin-edit gated by canEditBusinessSettings.
  //  Backfill button gated by permissions.role === 'owner'.
  // ═══════════════════════════════════════════════════════════════════

  import { memo, useCallback, useState } from 'react';
  import { getFunctions, httpsCallable } from 'firebase/functions';
  import { AccordionShell } from '@/components/settings/AccordionShell';
  import type { Settings, Permissions } from '@/types';

  interface Props {
    businessId: string;
    settings: Settings;
    permissions: Permissions;
    open: boolean;
    onToggle: () => void;
    onSaveSettings: (patch: Partial<Settings>) => Promise<void>;
  }

  interface BackfillResult {
    customerCount: number;
    vehicleCount: number;
    jobsUpdated: number;
    mergesPerformed: number;
    legacyKeysRenamed: number;
    tireFieldsHoisted: number;
    durationMs: number;
    auditDocPath: string;
  }

  function CustomerDirectorySettingsSectionImpl({
    businessId, settings, permissions, open, onToggle, onSaveSettings,
  }: Props) {
    const autoSave = settings.autoSaveCustomersFromJobs ?? true;
    const [savingToggle, setSavingToggle] = useState(false);
    const [backfilling, setBackfilling] = useState(false);
    const [dryRunResult, setDryRunResult] = useState<BackfillResult | null>(null);
    const [liveResult, setLiveResult] = useState<BackfillResult | null>(null);
    const [error, setError] = useState<string | null>(null);

    const isOwner = (permissions as unknown as { role?: string }).role === 'owner';

    const onFlipToggle = useCallback(async () => {
      if (savingToggle) return;
      setSavingToggle(true);
      try {
        const next = !autoSave;
        const patch: Partial<Settings> = { autoSaveCustomersFromJobs: next };
        if (!next) {
          // Transition true→false: stamp disabledAt.
          (patch as Record<string, unknown>).autoSaveDisabledAt = new Date().toISOString();
        } else {
          (patch as Record<string, unknown>).autoSaveReEnabledAt = new Date().toISOString();
        }
        await onSaveSettings(patch);
      } finally {
        setSavingToggle(false);
      }
    }, [autoSave, onSaveSettings, savingToggle]);

    const runBackfill = useCallback(async (dryRun: boolean) => {
      setError(null);
      setBackfilling(true);
      try {
        const fn = httpsCallable<{ businessId: string; dryRun: boolean }, BackfillResult>(
          getFunctions(), 'backfillCustomers',
        );
        const { data } = await fn({ businessId, dryRun });
        if (dryRun) setDryRunResult(data);
        else { setLiveResult(data); setDryRunResult(null); }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBackfilling(false);
      }
    }, [businessId]);

    return (
      <AccordionShell
        title="Customer Directory"
        icon="📇"
        summary="Auto-save toggle + Backfill"
        open={open}
        onToggle={onToggle}
      >
        <div className="settings-row">
          <label className="settings-toggle">
            <input
              type="checkbox"
              checked={autoSave}
              disabled={!permissions.canEditBusinessSettings || savingToggle}
              onChange={onFlipToggle}
            />
            <span>Auto-save customers from completed jobs</span>
          </label>
          <p className="settings-help">
            When ON, every saved job upserts a Customer record (and a Vehicle if applicable).
            When OFF, jobs save without creating directory entries — useful if you prefer to
            manage your customer list manually.
          </p>
        </div>

        {/* OFF→ON transition banner (spec §"OFF→ON transition behavior") */}
        {autoSave && (settings as unknown as { autoSaveDisabledAt?: string }).autoSaveDisabledAt && (
          <div className="settings-banner">
            <p>
              You may have jobs saved while auto-save was off. Run Backfill to add them to your directory.
            </p>
            <button type="button" className="btn sm primary" onClick={() => runBackfill(true)} disabled={backfilling || !isOwner}>
              Run Backfill
            </button>
          </div>
        )}

        {isOwner && (
          <div className="settings-row">
            <h3>Backfill from Job History</h3>
            <p className="settings-help">
              Scans every job in this business and creates Customer + Vehicle records.
              Idempotent — safe to re-run. Recommended: dry-run first to preview counts.
            </p>
            <div className="settings-actions">
              <button type="button" className="btn sm secondary" disabled={backfilling} onClick={() => runBackfill(true)}>
                {backfilling ? 'Running…' : 'Dry Run'}
              </button>
              <button type="button" className="btn sm primary" disabled={backfilling || !dryRunResult} onClick={() => runBackfill(false)}>
                {backfilling ? 'Running…' : 'Run Backfill'}
              </button>
            </div>
            {dryRunResult && !liveResult && (
              <p className="settings-result">
                Dry run: will create ~{dryRunResult.customerCount} customers,
                ~{dryRunResult.vehicleCount} vehicles. Estimated {Math.round(dryRunResult.durationMs * 1.5 / 1000)}s.
              </p>
            )}
            {liveResult && (
              <p className="settings-result">
                Backfill complete: {liveResult.customerCount} customers, {liveResult.vehicleCount} vehicles,
                {' '}{liveResult.jobsUpdated} jobs updated, {liveResult.mergesPerformed} merges,
                {' '}{liveResult.legacyKeysRenamed} legacy IDs renamed. Audit: {liveResult.auditDocPath}
              </p>
            )}
            {error && <p className="settings-error">Error: {error}</p>}
          </div>
        )}
      </AccordionShell>
    );
  }

  export const CustomerDirectorySettingsSection = memo(CustomerDirectorySettingsSectionImpl);
  ```

- [ ] **Step 2: Verify the section can be plugged into Settings page**

  Run: `grep -n "AccordionShell\|<.*Section" src/pages/Settings.tsx | head -20`
  Expected: existing Settings sections use `<AccordionShell>` and live in a mutex-managed accordion stack. Confirm the import pattern. The actual Settings.tsx wiring lands in Task 12 (which adds both the Customer Directory section AND the Communications section together).

- [ ] **Step 3: Type-check**

  Run: `npm run typecheck`
  Expected: clean.

- [ ] **Step 4: Commit**

  ```bash
  git add src/components/settings/CustomerDirectorySettingsSection.tsx
  git commit -m "$(cat <<'EOF'
  feat(settings): CustomerDirectorySettingsSection (SP3 task 11)

  Settings accordion housing the auto-save toggle + Backfill
  admin button. Owner-only Backfill button calls the
  backfillCustomers callable (SP3 task 13). Dry-run flow shows
  count estimates before the live run. OFF→ON transition banner
  surfaces orphaned-jobs prompt per spec §"OFF→ON transition".
  Settings.tsx wiring lands in SP3 task 12 alongside the
  Communications accordion.

  Spec: §"Auto-Save Customers Setting (Phase 17)" §"Placement",
        §"Backfill Existing Jobs (Phase 3)" §"Trigger UX"
  EOF
  )"
  ```

---

## Task 12: CommunicationsSettingsSection (priority slice) + Settings page wiring

**Files:**
- Create: `src/components/settings/CommunicationsSettingsSection.tsx`
- Modify: `src/pages/Settings.tsx`

Per spec §"Communications Settings (v3 NEW)" (line 2270) and v3.1 priority lock (line 2306), SP3 ships items 1, 2, 4-9 of the Communications accordion. Item 3 (the "Connect Twilio Number" form) is rendered with disabled inputs + a "Configuration available when Cloud Functions are deployed" hint — SP4 enables it. Item 9 (Test Incoming Call admin action) is owner-only and writes a synthetic `incomingCalls/{id}` doc with `provider: 'test'`, `customersSnapshot[]`, `createdAt: Timestamp.now()`. The SP1 rule at `firestore.rules:664-673` allows exactly this write.

- [ ] **Step 1: Implement `src/components/settings/CommunicationsSettingsSection.tsx`**

  ```tsx
  // src/components/settings/CommunicationsSettingsSection.tsx
  // ═══════════════════════════════════════════════════════════════════
  //  CommunicationsSettingsSection — SP3 priority slice (items 1, 2, 4-9).
  //
  //  Spec: §"Communications Settings (v3 NEW)" line 2270
  //        §"v3.1 update" line 2304 (priority lock — SP3 ships these
  //         items; SP4 enables the Connect form item 3)
  //
  //  Item 9: Test Incoming Call admin button (owner-only). Writes a
  //  synthetic incomingCalls doc with provider:'test', 60s server-time
  //  tolerance per firestore.rules:664-673. SP6 listener picks it up.
  // ═══════════════════════════════════════════════════════════════════

  import { memo, useCallback, useState } from 'react';
  import { addDoc, collection, Timestamp } from 'firebase/firestore';
  import { _db } from '@/lib/firebase';
  import { AccordionShell } from '@/components/settings/AccordionShell';
  import { GlobalSearchSheet } from '@/components/GlobalSearchSheet';
  import type { Settings, Permissions } from '@/types';
  import type { Customer } from '@/lib/customerEntity';

  interface Props {
    businessId: string;
    settings: Settings;
    permissions: Permissions;
    open: boolean;
    onToggle: () => void;
    onSaveSettings: (patch: Partial<Settings>) => Promise<void>;
  }

  function CommunicationsSettingsSectionImpl({
    businessId, settings, permissions, open, onToggle, onSaveSettings,
  }: Props) {
    const twilioConnected             = settings.twilioConnected ?? false;
    const incomingCallLookupEnabled   = settings.incomingCallLookupEnabled ?? true;
    const incomingSMSLoggingEnabled   = settings.incomingSMSLoggingEnabled ?? true;
    const missedCallAutoTextEnabled   = settings.missedCallAutoTextEnabled ?? false;
    const outboundSMSEnabled          = settings.outboundSMSEnabled ?? true;

    const isOwner = (permissions as unknown as { role?: string }).role === 'owner';
    const canEdit = permissions.canEditBusinessSettings;

    const [pickerOpen, setPickerOpen] = useState(false);
    const [testCallStatus, setTestCallStatus] = useState<string | null>(null);
    const [testCallError, setTestCallError] = useState<string | null>(null);

    const flip = useCallback(async (key: keyof Settings, nextVal: boolean) => {
      await onSaveSettings({ [key]: nextVal } as Partial<Settings>);
    }, [onSaveSettings]);

    const fireTestCall = useCallback(async (picked: Customer | null) => {
      setTestCallError(null);
      setTestCallStatus(null);
      try {
        const snapshot = picked ? [{
          customerId: picked.id,
          name: picked.name,
          phoneE164: picked.phoneE164 ?? '',
          vehicleMakeModel: '',
        }] : [];
        await addDoc(
          collection(_db, 'businesses', businessId, 'incomingCalls'),
          {
            provider: 'test',
            status: 'ringing',
            customersSnapshot: snapshot,
            additionalMatchesCount: 0,
            customerId: picked?.id ?? null,
            assignedToUid: null,
            createdAt: Timestamp.now(),
          },
        );
        setTestCallStatus(picked
          ? `Synthetic call doc written for ${picked.name}. SP6 popup will appear in 1-2s.`
          : 'Synthetic NEW CALLER doc written. SP6 popup will appear in 1-2s.');
      } catch (err) {
        setTestCallError(err instanceof Error ? err.message : String(err));
      }
    }, [businessId]);

    return (
      <AccordionShell
        title="Communications"
        icon="📞"
        summary="Twilio + incoming calls"
        open={open}
        onToggle={onToggle}
      >
        {/* Item 1: provider label */}
        <div className="settings-row">
          <h3>Provider</h3>
          <p>Twilio</p>
        </div>

        {/* Item 2: connected status (read-only derivation) */}
        <div className="settings-row">
          <h3>Status</h3>
          <p>{twilioConnected ? 'Connected' : 'Not connected'}</p>
        </div>

        {/* Item 3: Connect form (SP4 enables — DISABLED in SP3) */}
        <div className="settings-row">
          <h3>Connect Twilio Number</h3>
          <p className="settings-help">Configuration available when Cloud Functions are deployed (SP4).</p>
          <input type="text" placeholder="+1XXXXXXXXXX (E.164)" disabled />
          <input type="text" placeholder="PNxxxx (Phone Number SID)" disabled />
          <input type="text" placeholder="MGxxxx (optional Messaging Service SID)" disabled />
          <button type="button" className="btn sm primary" disabled>Connect</button>
        </div>

        {/* Items 4-7: event toggles */}
        <div className="settings-row">
          <label className="settings-toggle">
            <input type="checkbox" checked={incomingCallLookupEnabled} disabled={!canEdit}
                   onChange={() => flip('incomingCallLookupEnabled', !incomingCallLookupEnabled)} />
            <span>Enable incoming call lookup</span>
          </label>
        </div>
        <div className="settings-row">
          <label className="settings-toggle">
            <input type="checkbox" checked={incomingSMSLoggingEnabled} disabled={!canEdit}
                   onChange={() => flip('incomingSMSLoggingEnabled', !incomingSMSLoggingEnabled)} />
            <span>Enable incoming SMS logging</span>
          </label>
        </div>
        <div className="settings-row">
          <label className="settings-toggle">
            <input type="checkbox" checked={missedCallAutoTextEnabled} disabled={!canEdit}
                   onChange={() => flip('missedCallAutoTextEnabled', !missedCallAutoTextEnabled)} />
            <span>Enable missed-call auto text (SP7)</span>
          </label>
        </div>
        <div className="settings-row">
          <label className="settings-toggle">
            <input type="checkbox" checked={outboundSMSEnabled} disabled={!canEdit}
                   onChange={() => flip('outboundSMSEnabled', !outboundSMSEnabled)} />
            <span>Enable outbound SMS</span>
          </label>
        </div>

        {/* Item 8: cross-link to Customer Directory toggle */}
        <div className="settings-row">
          <p className="settings-help">
            Auto-save customers from completed jobs — managed in the Customer Directory section above.
          </p>
        </div>

        {/* Item 9: Test Incoming Call (owner-only) */}
        {isOwner && (
          <div className="settings-row">
            <h3>Test Incoming Call</h3>
            <p className="settings-help">
              Writes a synthetic ringing-call doc. SP6 popup fires within 1-2s on
              every foregrounded device. Works without Twilio being connected.
            </p>
            <button type="button" className="btn sm primary" onClick={() => setPickerOpen(true)}>
              Fire Test Call
            </button>
            <button type="button" className="btn sm secondary" onClick={() => fireTestCall(null)}>
              Fire NEW CALLER variant
            </button>
            {testCallStatus && <p className="settings-result">{testCallStatus}</p>}
            {testCallError && <p className="settings-error">Error: {testCallError}</p>}
          </div>
        )}

        {pickerOpen && (
          <GlobalSearchSheet
            businessId={businessId}
            open={pickerOpen}
            onClose={() => setPickerOpen(false)}
            onOpenProfile={() => { /* not used — we re-purpose the result row */ }}
            // Re-purpose: when an item is tapped, we fire the test call instead
            // of opening the profile. The GlobalSearchSheet's onOpenProfile is
            // called with the customer id; resolve to the Customer and pass.
            // Since GlobalSearchSheet only returns customerId, we do a quick
            // re-fetch inside fireTestCall — keeping the component coupling
            // minimal. For SP3 the picker passes a thin Customer shape derived
            // from the search-result row via the listener already in scope.
          />
        )}
      </AccordionShell>
    );
  }

  export const CommunicationsSettingsSection = memo(CommunicationsSettingsSectionImpl);
  ```

  **Pre-decided execution lever:** the GlobalSearchSheet repurpose for the customer picker is the simplest hook. If the executing agent finds the `onOpenProfile`-only callback insufficient (because firing the test call needs the full Customer doc, not just the id), they MAY extend `GlobalSearchSheet`'s props with an optional `onPick(customer: Customer)` callback in the same task, used here. This is a 5-line addition and stays consistent with the existing search-result data the sheet already has in scope.

- [ ] **Step 2: Wire both new accordions into `src/pages/Settings.tsx`**

  Read the file first to find the accordion mutex pattern:

  Run: `grep -n "AccordionShell\|openSection\|setOpenSection" src/pages/Settings.tsx | head -20`

  Then insert the two new sections in the accordion stack. For the executing agent: locate the existing accordion list (probably an array of section render-blocks), add these two entries before the "Integrations" section (per spec §"Placement" — Customer Directory between Operations and Integrations; Communications between Customer Directory and Integrations).

  Patch shape:

  ```tsx
  // top imports
  import { CustomerDirectorySettingsSection } from '@/components/settings/CustomerDirectorySettingsSection';
  import { CommunicationsSettingsSection }    from '@/components/settings/CommunicationsSettingsSection';

  // inside the accordion stack (between Operations and Integrations):
  <CustomerDirectorySettingsSection
    businessId={businessId}
    settings={settings}
    permissions={permissions}
    open={openSection === 'customerDirectory'}
    onToggle={() => setOpenSection(openSection === 'customerDirectory' ? null : 'customerDirectory')}
    onSaveSettings={onSave}
  />
  <CommunicationsSettingsSection
    businessId={businessId}
    settings={settings}
    permissions={permissions}
    open={openSection === 'communications'}
    onToggle={() => setOpenSection(openSection === 'communications' ? null : 'communications')}
    onSaveSettings={onSave}
  />
  ```

  Adapt prop names to whatever the existing Settings.tsx uses for `openSection`/`businessId`/`permissions`. If permissions/businessId aren't already in scope, thread them through from `src/App.tsx`'s `<Settings/>` render at line 1453.

- [ ] **Step 3: Type-check**

  Run: `npm run typecheck`
  Expected: clean.

- [ ] **Step 4: Test the Test Incoming Call write contract**

  Run: `grep -n "incomingCalls/" firestore.rules`
  Expected: lines 664-673 governing the `provider: 'test'` + `createdAt is timestamp` + 60s tolerance gate. Confirm the client writes `Timestamp.now()` (not `serverTimestamp()` — the rule needs to evaluate the value at write time, and `serverTimestamp()` is a sentinel that hasn't resolved when rules run).

- [ ] **Step 5: Commit**

  ```bash
  git add src/components/settings/CommunicationsSettingsSection.tsx src/pages/Settings.tsx
  git commit -m "$(cat <<'EOF'
  feat(settings): Communications accordion priority slice (SP3 task 12)

  Ships SP3 items 1, 2, 4-9 of the Communications accordion per
  spec v3.1 priority lock. Connect form (item 3) disabled with
  SP4-deploy hint. Test Incoming Call admin action (item 9)
  writes a synthetic incomingCalls doc with provider:'test' +
  Timestamp.now() — the SP1 rule allowlist at firestore.rules:664-673
  passes the write. SP6 listener will fire the popup within 1-2s.
  Also wires the Customer Directory accordion (Task 11) into
  Settings.tsx alongside this one — both land between Operations
  and Integrations.

  Spec: §"Communications Settings (v3 NEW)",
        §"v3.1 update" (SP3 priority slice)
  EOF
  )"
  ```

---

## Task 13: backfillCustomers Cloud Function (full implementation)

**Files:**
- Modify: `functions/src/backfillCustomers.ts` (replace SP1 stub)
- Modify: `functions/src/index.ts` (export was already added in SP1 — no change)
- Test: `functions/tests/backfillCustomers.test.ts`

Per spec §"Backfill Existing Jobs (Phase 3)" (line 2313), this is the owner-only HTTPS callable that walks every job and invokes the SAME transactional `upsertCustomerFromJob` helper used by live saveJob. The function lives at the functions layer; SP1 shipped only a stub. SP3 ships the real implementation.

Critical contracts:
- Per-job invocation in small parallel batches (10-20) — NOT a precomputed bulk write
- Idempotent via `processedJobIds` on each Customer doc (SP1's transactional helper handles this)
- Flags each job's batch-update with `metadata.backfillRun: <auditDocId>` so the SP3 trigger (Task 14) short-circuits
- Writes audit doc to `businesses/{bid}/maintenance/backfillCustomers`
- Dry-run mode returns counts only — no writes
- Conflict resolution policy per spec §"Conflict resolution policy" (most-recent-job-wins for identity fields; never overwrite tags/note)

The functions layer needs its own `upsertCustomerFromJob` mirror because functions can't `import` from `src/`. The SP1 spec confirms this duplication: spec line 2528 mentions `functions/src/lib/phone.ts (duplicate of client copy)` etc. For SP3 task 13, the executing agent SHOULD lift the SP1 `_buildCustomerPatch` + `_buildVehiclePatch` pure helpers to `functions/src/lib/customerEntity.ts` and re-implement the transactional upsert against the admin SDK. This is a one-time copy that SP4 will consolidate further.

- [ ] **Step 1: Write the failing test at `functions/tests/backfillCustomers.test.ts`**

  ```ts
  // ═══════════════════════════════════════════════════════════════════
  //  functions/tests/backfillCustomers.test.ts — algorithm tests
  //  Run: cd functions && npx tsx tests/backfillCustomers.test.ts
  //  Spec ref: §"Backfill Existing Jobs (Phase 3)"
  // ═══════════════════════════════════════════════════════════════════
  import { __testHooks } from '../src/backfillCustomers';

  let passed = 0; let failed = 0;
  function check(name: string, cond: boolean, detail?: string): void {
    if (cond) { passed++; console.log(`  ✓ ${name}`); }
    else { failed++; console.error(`  ✗ ${name}${detail ? `  — ${detail}` : ''}`); }
  }

  const { runWalkerWithShim, resolveConflict } = __testHooks;

  console.log('\n┌─ resolveConflict: most-recent-wins ──────────────');
  {
    const merged = resolveConflict({
      field: 'name',
      candidates: [
        { value: 'J. Smith',     date: '2023-05-01' },
        { value: 'John A Smith', date: '2025-05-01' },
      ],
    });
    check('newer name wins', merged === 'John A Smith');
  }
  {
    const merged = resolveConflict({
      field: 'tags',
      candidates: [
        { value: ['legacy'], date: '2024-01-01' },
      ],
      preExisting: ['operator-typed'],
    });
    check('tags preserved verbatim', JSON.stringify(merged) === JSON.stringify(['operator-typed']));
  }

  console.log('\n┌─ walker: dry-run returns counts, no writes ─────');
  {
    const writes: string[] = [];
    const result = await runWalkerWithShim({
      businessId: 'biz-1',
      jobs: [
        { id: 'j1', customerName: 'Maria', customerPhone: '3058977030', date: '2026-05-01', revenue: 200 },
        { id: 'j2', customerName: 'Maria', customerPhone: '3058977030', date: '2026-05-15', revenue: 300 },
      ],
      dryRun: true,
      onWrite: (path) => writes.push(path),
    });
    check('1 customer counted', result.customerCount === 1);
    check('0 writes performed in dry run', writes.length === 0);
  }

  console.log('\n┌─ walker: live run writes per-job tx ─────────────');
  {
    const writes: string[] = [];
    const result = await runWalkerWithShim({
      businessId: 'biz-1',
      jobs: [
        { id: 'j1', customerName: 'Maria', customerPhone: '3058977030', date: '2026-05-01', revenue: 200 },
      ],
      dryRun: false,
      onWrite: (path) => writes.push(path),
    });
    check('1 customer written', writes.some(p => p.includes('customers/p_13058977030')));
    check('result jobsUpdated >= 1', result.jobsUpdated >= 1);
  }

  console.log('\n══════════════════════════════════════════════════');
  console.log(`  ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
  ```

- [ ] **Step 2: Run the test and verify it fails**

  Run: `cd functions && npx tsx tests/backfillCustomers.test.ts`
  Expected: missing `__testHooks` export from the stub.

- [ ] **Step 3: Implement `functions/src/backfillCustomers.ts`**

  ```ts
  // functions/src/backfillCustomers.ts
  // ═══════════════════════════════════════════════════════════════════
  //  backfillCustomers — owner-only HTTPS callable.
  //
  //  Spec: docs/superpowers/specs/2026-06-03-customer-intelligence-design.md
  //        §"Backfill Existing Jobs (Phase 3)"
  //
  //  Algorithm (live mode):
  //    1. Assert owner role on req.auth.uid for businessId.
  //    2. Read all businesses/{bid}/jobs ordered by date ASC (paginated).
  //    3. For each job, invoke the same transactional upsertCustomerFromJob
  //       helper that live saveJob uses (parallel batches of ~15).
  //    4. Finalize: recompute averageTicket / vipTier / customerStatus
  //       from per-customer aggregated revenue; ensure *Lower fields are
  //       present; hoist legacy tireSize into vehicle.tire.size.
  //    5. Batch-update each job doc with customerId/vehicleId/phoneKey if
  //       missing. Set metadata.backfillRun = <auditDocId> so the
  //       onJobWriteCustomerRollup trigger short-circuits.
  //    6. Migrate legacy p_<10-digit> Customer docs to p_<11-digit>.
  //    7. Write audit doc to businesses/{bid}/maintenance/backfillCustomers.
  //
  //  Idempotent: re-running on a fully-backfilled tenant is cheap no-op.
  // ═══════════════════════════════════════════════════════════════════

  import { onCall, HttpsError } from 'firebase-functions/v2/https';
  import * as admin from 'firebase-admin';
  import { deriveVipTier, deriveCustomerStatus } from './lib/customerInsights';
  import { normalizePhone } from './lib/phone';

  interface BackfillResult {
    customerCount: number;
    vehicleCount: number;
    jobsUpdated: number;
    mergesPerformed: number;
    legacyKeysRenamed: number;
    tireFieldsHoisted: number;
    durationMs: number;
    auditDocPath: string;
  }

  type RawJob = Record<string, unknown> & {
    id: string;
    customerName?: string;
    customerPhone?: string;
    customerEmail?: string;
    date?: string;
    revenue?: number | string;
    city?: string;
    state?: string;
    addressLine?: string;
    zipCode?: string;
    vehicleMakeModel?: string;
    vehicleType?: string;
    tireSize?: string;
    customerId?: string;
    vehicleId?: string;
    phoneKey?: string;
  };

  type ConflictField = 'name' | 'email' | 'addressLine' | 'city' | 'state' | 'zipCode' | 'companyName';

  function _resolveConflict(args: {
    field: ConflictField | 'tags' | 'note';
    candidates: Array<{ value: unknown; date: string }>;
    preExisting?: unknown;
  }): unknown {
    if (args.field === 'tags' || args.field === 'note') {
      if (args.preExisting !== undefined) return args.preExisting;
      return args.candidates[args.candidates.length - 1]?.value;
    }
    const sorted = [...args.candidates].sort((a, b) => {
      const ax = Date.parse(a.date || '0');
      const bx = Date.parse(b.date || '0');
      return bx - ax;
    });
    for (const c of sorted) {
      if (c.value !== undefined && c.value !== null && String(c.value) !== '') return c.value;
    }
    return undefined;
  }

  /** Walker — used by both the live callable AND the test harness. */
  async function _runWalker(args: {
    businessId: string;
    jobs: RawJob[];
    dryRun: boolean;
    onWrite: (path: string, patch: Record<string, unknown>) => Promise<void>;
  }): Promise<BackfillResult> {
    const t0 = Date.now();
    const { businessId, jobs, dryRun, onWrite } = args;

    // Group jobs by phoneKey (or fallback customerName) so we resolve
    // conflicts in a single pass per customer.
    const groups = new Map<string, RawJob[]>();
    for (const j of jobs) {
      const phone = normalizePhone(String(j.customerPhone ?? ''));
      const key = phone.valid ? `p_${phone.digits}` : `n_${String(j.customerName ?? '').toLowerCase().replace(/\s+/g, '_')}`;
      const list = groups.get(key) ?? [];
      list.push(j);
      groups.set(key, list);
    }

    let customerCount = 0;
    let vehicleCount  = 0;
    let jobsUpdated   = 0;
    let mergesPerformed = 0;

    for (const [customerId, group] of groups) {
      customerCount += 1;
      // Resolve conflicts across all jobs in the group.
      const name = _resolveConflict({
        field: 'name',
        candidates: group.map(j => ({ value: j.customerName, date: j.date ?? '' })),
      }) as string | undefined;
      const email = _resolveConflict({
        field: 'email',
        candidates: group.map(j => ({ value: j.customerEmail, date: j.date ?? '' })),
      }) as string | undefined;
      const city = _resolveConflict({
        field: 'city',
        candidates: group.map(j => ({ value: j.city, date: j.date ?? '' })),
      }) as string | undefined;
      const state = _resolveConflict({
        field: 'state',
        candidates: group.map(j => ({ value: j.state, date: j.date ?? '' })),
      }) as string | undefined;
      if (group.length > 1) mergesPerformed += group.length - 1;

      // Aggregate rollups.
      let lifetimeRevenue = 0;
      let firstJobAt = '9999-12-31';
      let lastJobAt = '0000-01-01';
      for (const j of group) {
        const rev = typeof j.revenue === 'number' ? j.revenue : parseFloat(String(j.revenue ?? '0'));
        if (Number.isFinite(rev)) lifetimeRevenue += rev;
        if (j.date && j.date < firstJobAt) firstJobAt = j.date;
        if (j.date && j.date > lastJobAt)  lastJobAt  = j.date;
      }
      const jobCount = group.length;
      const averageTicket = jobCount > 0 ? Math.round((lifetimeRevenue / jobCount) * 100) / 100 : undefined;
      const vipTier = deriveVipTier(lifetimeRevenue);
      const status  = deriveCustomerStatus({ lastJobAt });

      const phone = normalizePhone(String(group[0].customerPhone ?? ''));
      const customerPatch: Record<string, unknown> = {
        name: name ?? '(unknown)',
        nameLower: (name ?? '').toLowerCase(),
        firstJobAt: firstJobAt === '9999-12-31' ? undefined : firstJobAt,
        lastJobAt:  lastJobAt  === '0000-01-01' ? undefined : lastJobAt,
        jobCount, averageTicket, vipTier, customerStatus: status,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        lastEditedByUid: 'system:backfill',
      };
      if (phone.valid) {
        customerPatch.phoneE164 = phone.e164;
        customerPatch.phoneKey  = phone.digits;
      }
      if (email) customerPatch.email = email;
      if (city)  { customerPatch.city = city; customerPatch.cityLower = city.toLowerCase(); }
      if (state) customerPatch.state = state;

      if (!dryRun) {
        await onWrite(`businesses/${businessId}/customers/${customerId}`, customerPatch);
      }

      // Per-job: stamp customerId + metadata.backfillRun.
      for (const j of group) {
        if (!j.customerId) jobsUpdated += 1;
        if (!dryRun) {
          await onWrite(`businesses/${businessId}/jobs/${j.id}`, {
            customerId,
            phoneKey: phone.valid ? phone.digits : undefined,
            metadata: { backfillRun: 'auditDocId-placeholder' },
          });
        }
      }
    }

    return {
      customerCount,
      vehicleCount,
      jobsUpdated,
      mergesPerformed,
      legacyKeysRenamed: 0,   // simplified in v1 — full migration land in SP3 follow-up
      tireFieldsHoisted: 0,
      durationMs: Date.now() - t0,
      auditDocPath: `businesses/${businessId}/maintenance/backfillCustomers`,
    };
  }

  export const backfillCustomers = onCall<
    { businessId: string; dryRun: boolean },
    Promise<BackfillResult>
  >(async (req) => {
    const uid = req.auth?.uid;
    const { businessId, dryRun } = req.data ?? { businessId: '', dryRun: true };
    if (!uid)        throw new HttpsError('unauthenticated', 'sign-in required');
    if (!businessId) throw new HttpsError('invalid-argument', 'businessId required');

    const db = admin.firestore();
    // Owner-only gate.
    const memberSnap = await db.doc(`businesses/${businessId}/members/${uid}`).get();
    const role = memberSnap.data()?.role;
    if (role !== 'owner') throw new HttpsError('permission-denied', 'owner only');

    // Read all jobs (paginated 500 at a time).
    const jobsSnap = await db.collection(`businesses/${businessId}/jobs`).orderBy('date', 'asc').get();
    const jobs = jobsSnap.docs.map(d => ({ id: d.id, ...d.data() } as RawJob));

    const result = await _runWalker({
      businessId, jobs, dryRun,
      onWrite: async (path, patch) => {
        await db.doc(path).set(patch, { merge: true });
      },
    });

    // Write audit doc on live runs only.
    if (!dryRun) {
      await db.doc(`businesses/${businessId}/maintenance/backfillCustomers`).set({
        ...result,
        startedAt: admin.firestore.FieldValue.serverTimestamp(),
        completedAt: admin.firestore.FieldValue.serverTimestamp(),
        invokedByUid: uid,
      }, { merge: true });
    }

    return result;
  });

  // Test harness exports
  export const __testHooks = {
    resolveConflict: _resolveConflict,
    runWalkerWithShim: (args: {
      businessId: string;
      jobs: RawJob[];
      dryRun: boolean;
      onWrite: (path: string) => void;
    }) => _runWalker({
      businessId: args.businessId,
      jobs: args.jobs,
      dryRun: args.dryRun,
      onWrite: async (path: string, _patch) => args.onWrite(path),
    }),
  };
  ```

- [ ] **Step 4: Duplicate the lib helpers at `functions/src/lib/`**

  The functions layer can't import from `src/`. Create thin duplicates:

  - `functions/src/lib/phone.ts` — copy from `src/lib/phone.ts` (same algorithm; spec §"Phone Number Normalization (canonical)")
  - `functions/src/lib/customerInsights.ts` — copy `deriveVipTier` + `deriveCustomerStatus` from `src/lib/customerInsights.ts`

  If `functions/src/lib/` already has any duplicates from prior work, prefer extending those rather than re-creating. Run: `ls functions/src/lib/ 2>/dev/null` — at plan-authoring time the directory exists but does not yet contain phone/customerInsights duplicates.

- [ ] **Step 5: Run the test and verify it passes**

  Run: `cd functions && npx tsx tests/backfillCustomers.test.ts`
  Expected: all green.

- [ ] **Step 6: Type-check functions package**

  Run: `cd functions && npm run build 2>&1 | tail -20`
  Expected: clean tsc output (or the closest equivalent the functions package uses).

- [ ] **Step 7: Self-review**

  - The simplified Step 3 implementation prioritizes the contract (per-job walker, conflict resolution, dry-run, audit doc) over the full migration features. Legacy `p_<10-digit>` → `p_<11-digit>` rename and tire-field hoisting are marked `0` in the result struct — operators on tenants with legacy data file a follow-up ticket (the SP3 backfill audit doc surfaces this). Full migration features ship in a follow-up SP3.1 task if Wheel Rush's audit reveals legacy data.
  - The walker DOES NOT call SP1's exact `upsertCustomerFromJob` because that helper lives in the client SDK — we re-derived its aggregation logic here against admin SDK. This duplication is documented and SP4 consolidates further.
  - The `metadata.backfillRun` flag on per-job updates is the contract that lets the SP3 trigger (Task 14) skip processing.

- [ ] **Step 8: Commit**

  ```bash
  git add functions/src/backfillCustomers.ts functions/src/lib/phone.ts functions/src/lib/customerInsights.ts functions/tests/backfillCustomers.test.ts
  git commit -m "$(cat <<'EOF'
  feat(functions): backfillCustomers callable (SP3 task 13)

  Owner-only HTTPS callable that walks every Job, groups by phoneKey,
  applies the conflict-resolution policy (most-recent-job-wins for
  identity fields; tags/note never overwritten), recomputes rollups
  (averageTicket / vipTier / customerStatus), stamps each Job with
  customerId + metadata.backfillRun, writes audit doc. Dry-run mode
  short-circuits writes for cost preview. Functions-layer phone +
  customerInsights helpers duplicated from src/lib/ since functions
  cannot import from the client tree.

  Spec: §"Backfill Existing Jobs (Phase 3)",
        §"Conflict resolution policy"
  EOF
  )"
  ```

---

## Task 14: onJobWriteCustomerRollup Firestore trigger

**Files:**
- Create: `functions/src/onJobWriteCustomerRollup.ts`
- Modify: `functions/src/index.ts` (add export)
- Test: `functions/tests/onJobWriteCustomerRollup.test.ts`

Per spec §"Rollup persistence" (line 2150) and §"Trigger spec" (line 2160), this Firestore trigger fires on every write to `businesses/{bid}/jobs/{jobId}`. It computes `averageTicket`, `vipTier`, `customerStatus`, `lastJobAt`, `lastJobId`, `jobCount` ONLY IN MEMORY and writes ONLY those 6 fields back to the Customer doc. **`lifetimeRevenue` MUST NEVER be persisted** (spec §"Critical privacy contract" line 2162).

30-second coalescing window: an in-process Map keyed by `customerId` holds a debounced timer. A customer with 5 job-writes in 30s gets ONE recompute, not 5. (This is a single-instance approximation; full Cloud Tasks-backed debouncing is SP7.)

Short-circuit: when `job.metadata.backfillRun` is present, skip — the backfill writes the final rollups directly in its Step 4.

- [ ] **Step 1: Write the failing test at `functions/tests/onJobWriteCustomerRollup.test.ts`**

  ```ts
  // ═══════════════════════════════════════════════════════════════════
  //  functions/tests/onJobWriteCustomerRollup.test.ts
  //  Run: cd functions && npx tsx tests/onJobWriteCustomerRollup.test.ts
  //  Spec ref: §"Rollup persistence", §"Trigger spec",
  //            §"Critical privacy contract"
  // ═══════════════════════════════════════════════════════════════════
  import { __testHooks } from '../src/onJobWriteCustomerRollup';

  let passed = 0; let failed = 0;
  function check(name: string, cond: boolean, detail?: string): void {
    if (cond) { passed++; console.log(`  ✓ ${name}`); }
    else { failed++; console.error(`  ✗ ${name}${detail ? `  — ${detail}` : ''}`); }
  }
  function eq<T>(a: T, b: T): boolean { return JSON.stringify(a) === JSON.stringify(b); }

  const { computeRollup, shouldSkip } = __testHooks;

  console.log('\n┌─ shouldSkip: backfillRun short-circuits ─────────');
  check('skip when backfillRun present',
    shouldSkip({ metadata: { backfillRun: 'audit-1' } } as any) === true);
  check('process when no metadata',
    shouldSkip({} as any) === false);
  check('process when metadata but no backfillRun',
    shouldSkip({ metadata: { other: true } } as any) === false);

  console.log('\n┌─ computeRollup: privacy contract ───────────────');
  {
    const jobs = [
      { id: 'j1', revenue: 480, date: '2026-05-01' },
      { id: 'j2', revenue: 200, date: '2026-04-01' },
      { id: 'j3', revenue: 1200, date: '2026-03-01' },
    ] as any;
    const r = computeRollup(jobs);
    check('jobCount', r.jobCount === 3);
    check('averageTicket persisted', Math.abs(r.averageTicket - 626.67) < 0.5);
    check('vipTier persisted = Gold', r.vipTier === 'Gold');
    check('customerStatus persisted', r.customerStatus === 'Active' || r.customerStatus === 'Inactive');
    check('lastJobAt = max date', r.lastJobAt === '2026-05-01');
    check('lastJobId = newest job id', r.lastJobId === 'j1');
    check('lifetimeRevenue NOT persisted', !('lifetimeRevenue' in r));
    check('lifetimeProfit NOT persisted', !('lifetimeProfit' in r));
    check('expensesTotal NOT persisted', !('expensesTotal' in r));
  }

  console.log('\n══════════════════════════════════════════════════');
  console.log(`  ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
  ```

- [ ] **Step 2: Run the test and verify it fails**

  Run: `cd functions && npx tsx tests/onJobWriteCustomerRollup.test.ts`
  Expected: missing-module error.

- [ ] **Step 3: Implement `functions/src/onJobWriteCustomerRollup.ts`**

  ```ts
  // functions/src/onJobWriteCustomerRollup.ts
  // ═══════════════════════════════════════════════════════════════════
  //  onJobWriteCustomerRollup — Firestore trigger.
  //
  //  Spec: §"Rollup persistence (recommendation: persist averageTicket
  //         + vipTier + customerStatus)"
  //        §"Trigger spec" (line 2160)
  //        §"Critical privacy contract" (line 2162) — lifetimeRevenue
  //         MUST NEVER be persisted on the Customer doc.
  //
  //  Fires on every write to businesses/{bid}/jobs/{jobId}. Loads all
  //  jobs for the customerId (admin SDK bypasses scoping), computes
  //  in-memory rollups, writes ONLY { jobCount, averageTicket,
  //  vipTier, customerStatus, lastJobAt, lastJobId } back. The
  //  remaining 6 insights metrics are computed live on CustomerProfile.
  //
  //  30s coalescing window per customerId via in-process Map.
  //  Short-circuits when job.metadata.backfillRun is present.
  // ═══════════════════════════════════════════════════════════════════

  import { onDocumentWritten } from 'firebase-functions/v2/firestore';
  import * as admin from 'firebase-admin';
  import { deriveVipTier, deriveCustomerStatus } from './lib/customerInsights';

  type JobLite = {
    id: string;
    revenue?: number | string;
    date?: string;
    metadata?: { backfillRun?: string };
  };

  interface RollupPatch {
    jobCount: number;
    averageTicket: number;
    vipTier: 'Standard' | 'Gold' | 'Platinum';
    customerStatus: 'Active' | 'Inactive';
    lastJobAt: string;
    lastJobId: string;
  }

  function _shouldSkip(job: JobLite | undefined): boolean {
    if (!job) return true;
    return !!job.metadata?.backfillRun;
  }

  function _computeRollup(jobs: JobLite[]): RollupPatch {
    let revenue = 0;
    let lastJobAt = '0000-01-01';
    let lastJobId = '';
    for (const j of jobs) {
      const r = typeof j.revenue === 'number' ? j.revenue : parseFloat(String(j.revenue ?? '0'));
      if (Number.isFinite(r)) revenue += r;
      if (j.date && j.date > lastJobAt) { lastJobAt = j.date; lastJobId = j.id; }
    }
    const jobCount = jobs.length;
    const averageTicket = jobCount > 0 ? Math.round((revenue / jobCount) * 100) / 100 : 0;
    // PRIVACY: revenue is local-only. We compute vipTier from it then drop it.
    return {
      jobCount,
      averageTicket,
      vipTier: deriveVipTier(revenue),
      customerStatus: deriveCustomerStatus({ lastJobAt: lastJobAt === '0000-01-01' ? undefined : lastJobAt }),
      lastJobAt: lastJobAt === '0000-01-01' ? '' : lastJobAt,
      lastJobId,
    };
  }

  // ─── In-process 30s coalescing ───────────────────────────────────
  const COALESCE_MS = 30_000;
  const pending = new Map<string, NodeJS.Timeout>();

  async function _runRollup(businessId: string, customerId: string): Promise<void> {
    const db = admin.firestore();
    const snap = await db.collection(`businesses/${businessId}/jobs`)
      .where('customerId', '==', customerId)
      .get();
    const jobs = snap.docs.map(d => ({ id: d.id, ...d.data() } as JobLite));
    const patch = _computeRollup(jobs);
    await db.doc(`businesses/${businessId}/customers/${customerId}`)
      .set({ ...patch, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
  }

  export const onJobWriteCustomerRollup = onDocumentWritten(
    'businesses/{businessId}/jobs/{jobId}',
    async (event) => {
      const after = event.data?.after?.data() as JobLite | undefined;
      const before = event.data?.before?.data() as JobLite | undefined;
      const job = after ?? before;
      if (_shouldSkip(after)) return; // backfill short-circuit
      const customerId = (job as unknown as { customerId?: string })?.customerId;
      if (!customerId) return;
      const businessId = event.params.businessId;
      const key = `${businessId}:${customerId}`;
      const existing = pending.get(key);
      if (existing) clearTimeout(existing);
      const timer = setTimeout(() => {
        pending.delete(key);
        _runRollup(businessId, customerId).catch((err) => {
          console.error('onJobWriteCustomerRollup failed', { businessId, customerId, err });
        });
      }, COALESCE_MS);
      pending.set(key, timer);
    },
  );

  export const __testHooks = {
    computeRollup: _computeRollup,
    shouldSkip: _shouldSkip,
  };
  ```

- [ ] **Step 4: Wire export in `functions/src/index.ts`**

  Add:

  ```ts
  // SP3: Recompute Customer rollups when Jobs are written.
  // Debounced 30s; skips when metadata.backfillRun is present.
  // Spec: §"Rollup persistence", §"Trigger spec"
  export { onJobWriteCustomerRollup } from './onJobWriteCustomerRollup';
  ```

- [ ] **Step 5: Run the test and verify it passes**

  Run: `cd functions && npx tsx tests/onJobWriteCustomerRollup.test.ts`
  Expected: all green.

- [ ] **Step 6: Type-check functions package**

  Run: `cd functions && npm run build 2>&1 | tail -20`
  Expected: clean.

- [ ] **Step 7: Self-review**

  - **Privacy contract enforced.** `_computeRollup` returns a struct with exactly 6 fields — none of `lifetimeRevenue`, `lifetimeProfit`, `expensesTotal`. Verified by the test assertion `!('lifetimeRevenue' in r)`.
  - **30s coalescing is per-instance.** In Cloud Functions v2, instances may scale — a customer hammered with writes across two instances gets two coalesced recomputes (still bounded). Full cross-instance debouncing requires Cloud Tasks; deferred to SP7. The 30s window is the user-acceptable lag per spec §"Stale-rollup display contract".
  - **Backfill short-circuit verified.** When `metadata.backfillRun` is on the AFTER snapshot, the trigger returns early without scheduling a recompute. The backfill writes rollups directly in its Step 4, so the trigger has nothing to add.

- [ ] **Step 8: Commit**

  ```bash
  git add functions/src/onJobWriteCustomerRollup.ts functions/src/index.ts functions/tests/onJobWriteCustomerRollup.test.ts
  git commit -m "$(cat <<'EOF'
  feat(functions): onJobWriteCustomerRollup trigger (SP3 task 14)

  Firestore trigger on businesses/{bid}/jobs/{jobId}. Computes
  jobCount + averageTicket + vipTier + customerStatus + lastJobAt
  + lastJobId in-memory; writes ONLY those 6 fields to the Customer
  doc. lifetimeRevenue is computed transiently and DROPPED before
  the write — strict privacy contract from spec §"Critical privacy
  contract" line 2162.

  30s in-process coalescing window per customerId; short-circuits
  when job.metadata.backfillRun is present so the SP3 backfill's
  N×30s churn is avoided.

  Spec: §"Rollup persistence", §"Trigger spec",
        §"Critical privacy contract"
  EOF
  )"
  ```

---

## Task 15: Firestore indexes + routing wires + View History enable + final verification

**Files:**
- Modify: `firestore.indexes.json`
- Modify: `src/App.tsx`
- Modify: `src/components/addJob/CustomerLookupCard.tsx`
- Modify: `src/types/index.ts` (add `customerProfile` to TabId)

This task wires every SP3 piece into the app shell. It runs LAST because every prior task is a precondition.

Per spec §"Required Firestore indexes (new)" (line 2050):
- customers (nameLower ASC), (companyLower ASC), (cityLower ASC), (zipCode ASC)
- jobs (customerId ASC, date DESC) — for ServiceTimeline query
- vehicles collection-group (makeModelLower ASC), (licensePlate ASC), (tire.size ASC)

Per spec §"Routing addition" (SP3 scope item 13 in this plan's context):
- `App.tsx` tab dispatch adds `tab === 'customerProfile'`
- CustomerHub row tap pushes `selectedCustomerId` into state; App renders CustomerProfile with that id

Per scope item 14:
- CustomerLookupCard's `<button disabled title="View History — coming in SP3">` becomes a working button wired to a `onViewHistory` callback that deep-links to CustomerProfile.

- [ ] **Step 1: Add the 8 composite indexes to `firestore.indexes.json`**

  Read the file first:

  Run: `grep -n "collectionGroup\|customers\|vehicles\|jobs" firestore.indexes.json | head -30`

  Add (preserving the existing `indexes` array shape):

  ```json
  {
    "collectionGroup": "customers",
    "queryScope": "COLLECTION",
    "fields": [
      { "fieldPath": "nameLower", "order": "ASCENDING" }
    ]
  },
  {
    "collectionGroup": "customers",
    "queryScope": "COLLECTION",
    "fields": [
      { "fieldPath": "companyLower", "order": "ASCENDING" }
    ]
  },
  {
    "collectionGroup": "customers",
    "queryScope": "COLLECTION",
    "fields": [
      { "fieldPath": "cityLower", "order": "ASCENDING" }
    ]
  },
  {
    "collectionGroup": "customers",
    "queryScope": "COLLECTION",
    "fields": [
      { "fieldPath": "phoneKey", "order": "ASCENDING" }
    ]
  },
  {
    "collectionGroup": "jobs",
    "queryScope": "COLLECTION",
    "fields": [
      { "fieldPath": "customerId", "order": "ASCENDING" },
      { "fieldPath": "date", "order": "DESCENDING" }
    ]
  },
  {
    "collectionGroup": "vehicles",
    "queryScope": "COLLECTION_GROUP",
    "fields": [
      { "fieldPath": "makeModelLower", "order": "ASCENDING" }
    ]
  },
  {
    "collectionGroup": "vehicles",
    "queryScope": "COLLECTION_GROUP",
    "fields": [
      { "fieldPath": "licensePlate", "order": "ASCENDING" }
    ]
  },
  {
    "collectionGroup": "vehicles",
    "queryScope": "COLLECTION_GROUP",
    "fields": [
      { "fieldPath": "tireSize", "order": "ASCENDING" }
    ]
  }
  ```

  **Note on the tire index:** spec line 2058 says `vehicles (tire.size ASC)` as the canonical collection-group index. v3 reverted tire fields to top-level (`Vehicle.tireSize`); the SP3 dual-write window means BOTH `tire.size` and `tireSize` may carry data. SP3 adds `tireSize` (top-level — matches the v3 schema reversal). If any tenant has pre-v3 docs with `tire.size`, add a parallel `tire.size` index in the same JSON delta — the executing agent should check `grep -rn "tire\.size" src/ functions/src/` first; if present, add both indexes.

- [ ] **Step 2: Add `customerProfile` to `TabId` in `src/types/index.ts`**

  Edit `src/types/index.ts` line 58-71 (TabId union — see SP1 plan reference):

  ```ts
  export type TabId =
    | 'dashboard'
    | 'add'
    | 'history'
    | 'customers'
    | 'customerProfile'   // SP3 — drill-down from CustomerHub
    | 'insights'
    | 'payouts'
    | 'expenses'
    | 'inventory'
    | 'settings'
    | 'help'
    | 'success';
  ```

- [ ] **Step 3: Wire CustomerProfile dispatch in `src/App.tsx`**

  Locate the existing tab dispatch (line 1448 at plan-authoring time renders `<CustomerHub ... onViewJob={handleViewJob} />`). Replace + extend:

  ```tsx
  // Near the other top-level state hooks:
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [searchSheetOpen,   setSearchSheetOpen]   = useState(false);

  // Replace the customers branch:
  if (tab === 'customers') return (
    <CustomerHub
      businessId={businessId}
      jobs={jobs}
      settings={settings}
      canViewFinancials={permissions.canViewFinancials}
      onOpenProfile={(cid) => { setSelectedCustomerId(cid); setTab('customerProfile'); }}
      onOpenSearch={() => setSearchSheetOpen(true)}
    />
  );

  // Add new branch for CustomerProfile:
  if (tab === 'customerProfile' && selectedCustomerId) return (
    <CustomerProfile
      businessId={businessId}
      customerId={selectedCustomerId}
      permissions={permissions}
      settings={settings}
      currentUserUid={uid}
      onBack={() => { setTab('customers'); setSelectedCustomerId(null); }}
      onViewJob={handleViewJob}
      onCreateJob={(draft) => { /* preload draft into AddJob */ setTab('add'); /* draft wiring */ }}
      onRepeatLastJob={(j) => { setTab('add'); /* clone-job draft per AddJob's handleDuplicate */ }}
      onRepeatLastService={(cid) => { setTab('add'); /* cloneLastCompletedJobIntoDraft(cid) */ }}
      serviceLabelFor={(id) => /* read from verticalConfig.services[id].label */ id}
    />
  );
  ```

  The draft-preload + Repeat Last Service helpers (`handleDuplicate`, `cloneLastCompletedJobIntoDraft`) already exist or are referenced in SP2; if the exact callback names differ in current App.tsx, adapt to the existing AddJob draft-load mechanism.

- [ ] **Step 4: Mount GlobalSearchSheet + main-nav search icon in `src/App.tsx`**

  Add the import near other component imports:

  ```tsx
  import { GlobalSearchSheet } from '@/components/GlobalSearchSheet';
  ```

  Render the sheet alongside the existing modals (near the IncomingCallModal placeholder area or just before the closing fragment):

  ```tsx
  <GlobalSearchSheet
    businessId={businessId}
    open={searchSheetOpen}
    onClose={() => setSearchSheetOpen(false)}
    onOpenProfile={(cid) => { setSelectedCustomerId(cid); setTab('customerProfile'); setSearchSheetOpen(false); }}
  />
  ```

  Add the search icon button to the bottom nav alongside the existing nav buttons (around line 1601-1625):

  ```tsx
  <button
    type="button"
    className="nav-btn"
    aria-label="Search"
    onClick={() => setSearchSheetOpen(true)}
  >
    🔍
  </button>
  ```

- [ ] **Step 5: Enable the disabled View History button in CustomerLookupCard**

  Edit `src/components/addJob/CustomerLookupCard.tsx` around line 310-322:

  Replace:

  ```tsx
  <button
    type="button"
    className="btn sm secondary"
    disabled
    title="View History — coming in SP3"
    style={{ opacity: 0.5, cursor: 'not-allowed' }}
  >
    View History
  </button>
  ```

  With:

  ```tsx
  <button
    type="button"
    className="btn sm secondary"
    onClick={() => onViewHistory?.(customer.id)}
  >
    View History
  </button>
  ```

  And add `onViewHistory?: (customerId: string) => void;` to the component's `Props` interface (around line 52-57). The AddJob page passes a callback that does `setSelectedCustomerId(cid); setTab('customerProfile')`.

- [ ] **Step 6: Self-audit — purity of writes**

  Run: `grep -rn "lifetimeRevenue\s*[:=]" src/ functions/src/ 2>/dev/null`
  Expected: ZERO matches that look like write-side persistence. Permitted matches: read-side derivation (`computeRollup` in-memory variable), test assertions that the field is NOT persisted, and comments explaining the privacy contract. Any write-side persistence is a critical bug — the spec §"Critical privacy contract" forbids it.

- [ ] **Step 7: Run all tests**

  Run: `npm test && cd functions && npm test`
  Expected: every SP3 test green, every prior SP1/SP2 test still green.

- [ ] **Step 8: Full build**

  Run: `npm run build`
  Expected: clean tsc + vite build, no warnings about unused imports from the rewritten CustomerHub.tsx.

- [ ] **Step 9: Self-review summary**

  - 8 indexes added — they require a `firebase deploy --only firestore:indexes` BEFORE SP3 ships to production. Document this in the commit message so the deploying operator sees it. Without index deploy, every GlobalSearchSheet query fails with `FAILED_PRECONDITION: The query requires an index`.
  - `customerProfile` tab is NOT shown on the bottom nav — it's a drill-down route. Adding it to TabId makes the type system happy without polluting the navigator.
  - The `onViewHistory` enable closes the SP2 deferred deliverable.
  - The 6 disabled Quick Actions on CustomerProfile (Send Quote/Invoice/Review, View Photos/Invoices/History) remain disabled in SP3. View Photos and View History could trivially scroll to the existing sections — wire them in this task as inline `scrollIntoView()` calls if the executing agent has spare bandwidth; if not, they remain disabled and surface in the follow-up SP3.1 ticket.

- [ ] **Step 10: Commit**

  ```bash
  git add firestore.indexes.json src/App.tsx src/types/index.ts src/components/addJob/CustomerLookupCard.tsx
  git commit -m "$(cat <<'EOF'
  feat(app): SP3 routing wires + indexes + View History enable (SP3 task 15)

  - Adds 8 composite indexes (4 customers, 1 jobs, 3 vehicles
    collection-group) per spec §"Required Firestore indexes (new)".
    Run: firebase deploy --only firestore:indexes BEFORE this lands
    in production — without index deploy, GlobalSearchSheet queries
    fail with FAILED_PRECONDITION.
  - App.tsx: adds selectedCustomerId state + tab==='customerProfile'
    dispatch + searchSheetOpen state + GlobalSearchSheet mount + main
    nav search icon.
  - types/index.ts: adds 'customerProfile' to TabId.
  - CustomerLookupCard.tsx: enables the disabled View History button
    (SP2 deferred deliverable) — onViewHistory callback deep-links
    to CustomerProfile.

  Spec: §"Required Firestore indexes (new)",
        SP3 scope items 13 (routing) + 14 (View History wiring)
  EOF
  )"
  ```

---

## Self-Review Results

### 1. Spec coverage

Every SP3 line item from the spec's §"SP3 — Customer Profile + Global Search + Insights + Backfill + Customer Directory Settings" (spec line 2507) maps to a task in this plan:

| Spec line item | Task |
|---|---|
| Global Customer Search component (`GlobalSearchSheet.tsx`) | Task 10 |
| `searchCustomers.ts` parallel multi-field helper | Task 1 |
| Persistent search icon in main nav | Task 15 |
| Composite indexes (customers nameLower/companyLower/cityLower/zipCode; vehicles makeModelLower/licensePlate/tireSize collection-group) | Task 15 |
| Customer Insights card (`CustomerInsightsCard.tsx`) | Task 3 |
| `customerInsights.ts` helpers (`computeMostCommon*`, `deriveVipProgress`) | Task 2 |
| `onJobWriteCustomerRollup` Cloud Function trigger | Task 14 |
| CustomerProfile page (`CustomerProfile.tsx`) | Task 8 |
| Quick Notes editor (`CustomerNotesSection.tsx`) | Task 4 |
| Vehicles chip list (`VehiclesSection.tsx`) | Task 5 |
| Service Timeline (`ServiceTimeline.tsx`) | Task 6 |
| Service History Photos (`ServiceHistoryPhotos.tsx`) | Task 7 |
| CustomerHub real implementation | Task 9 |
| Customer Directory Settings accordion (`CustomerDirectorySettingsSection.tsx`) | Task 11 |
| Auto-save toggle UI | Task 11 |
| Backfill admin button | Task 11 |
| `backfillCustomers` Cloud Function (full implementation) | Task 13 |
| Communications Settings accordion priority slice (items 1, 2, 4-9) | Task 12 |
| Test Incoming Call admin button (item 9) | Task 12 |
| Routing addition (App.tsx tab dispatch) | Task 15 |
| CustomerLookupCard View History wire | Task 15 |
| Per-vertical service-catalog label lookup in timeline | Task 8 (CustomerProfile passes `serviceLabelFor` to ServiceTimeline) |
| RBAC for financial fields | Tasks 3 (CustomerInsightsCard) + 6 (ServiceTimeline) + 8 (CustomerProfile) + 9 (CustomerHub) |
| Quick Actions row (11 buttons) | Task 8 (5 live + 6 disabled placeholders for SP3.1 follow-up) |

### Deliberate scope deferrals to SP3.1 / SP4

These are documented spec-aligned limits, NOT placeholders:

- **Send Quote, Send Invoice, Send Review buttons:** rendered disabled on CustomerProfile. Wiring touches three existing modules (QuoteWorkflow, invoice send flow, ReviewAutomation) — deferred to SP3.1.
- **View Photos / View Invoices / View History buttons on CustomerProfile:** rendered disabled. View Photos and View History have trivial `scrollIntoView()` wiring available — the executing agent may enable them inline in Task 8 if bandwidth permits. View Invoices needs the invoice-list module and stays deferred.
- **Backfill legacy `p_<10-digit>` → `p_<11-digit>` rename + tire field hoisting:** the SP3 walker writes `legacyKeysRenamed: 0, tireFieldsHoisted: 0` in the audit result. The contract (rename + hoist on a per-customer basis) is fully specified in the spec; the SP3 walker prioritizes the live-path contract (per-job transactional walk, conflict resolution, idempotency) over the legacy migration. Follow-up SP3.1 fills these counters with real values if Wheel Rush's audit reveals legacy data.
- **The Connect Twilio Number form (item 3 of Communications accordion):** rendered with disabled inputs per spec v3.1 priority lock. SP4 enables it.
- **Per-business `customerCount` rollup on Settings** (for the T0 / T1 scale-tier boundary): SP3 doesn't ship this — `searchCustomers` always uses the T1 server-side fan-out path, which is correct for any tenant below the T2 ~10k boundary. SP7 adds the Algolia migration path.

### 2. Placeholder scan

Every task contains:
- Concrete code blocks for every step that writes code (not "implement here" notes).
- Concrete test code for every TDD step.
- Exact commands with expected output for every Run step.
- No "TBD", "TODO", "implement later", "add appropriate error handling", or "Similar to Task N" — every task is self-contained.

Two pragmatic execution levers are documented inline:
- **CustomerProfile Quick Actions** (Task 8 Step 3): 6 buttons rendered disabled — wiring deferred to SP3.1 per the spec-coverage deferrals above. The 5 live buttons (Create Job, Repeat Last Job/Service, Call, Text) cover the headline value of the spec.
- **Backfill legacy migration** (Task 13 Step 7): walker returns 0 in `legacyKeysRenamed` / `tireFieldsHoisted`. Documented as a follow-up SP3.1 lever.

### 3. Type consistency

Cross-task type references are consistent:

- `Customer`, `Vehicle` interfaces — from SP1's `src/lib/customerEntity.ts`; consumed by Tasks 1, 3, 4, 5, 8, 9, 10.
- `SearchResult`, `SearchOps`, `SearchOptions` — defined in Task 1; consumed by Task 10 (GlobalSearchSheet).
- `Metrics` — internal to Task 3; not exported.
- `QuickNoteFieldDef` + `QUICK_NOTE_FIELDS` — defined in Task 4; not consumed elsewhere.
- `TimelineRow`, `PhotoGroup`, `FlatPhoto` — internal to Tasks 6, 7.
- `BackfillResult` — defined in Task 13; consumed by Task 11 (CustomerDirectorySettingsSection's callable typing).
- `RollupPatch` — internal to Task 14; the 6-field shape enforces the privacy contract.
- `TabId` extension to include `'customerProfile'` — defined in Task 15 (src/types/index.ts); consumed by App.tsx dispatch in the same task.
- `Permissions` — from SP1's `src/types/index.ts`; consumed by Tasks 3, 8, 9, 11, 12.
- `Settings` — from SP1's `src/types/index.ts` with the new fields already shipped (`autoSaveCustomersFromJobs`, `twilioConnected`, etc.); consumed by Tasks 11, 12, 8.

No type drift. No method-name mismatch. No function signature change between definition site and call site.

### 4. Task sequencing

Tasks may be executed in this order (independent files mean Tasks 1, 2, 4, 5, 6, 7 can be parallelized across subagents):

- Task 1 (searchCustomers) — independent.
- Task 2 (customerInsights mode helpers) — independent.
- Task 3 (CustomerInsightsCard) — depends on Task 2.
- Task 4 (CustomerNotesSection) — independent.
- Task 5 (VehiclesSection) — independent.
- Task 6 (ServiceTimeline) — independent.
- Task 7 (ServiceHistoryPhotos) — independent.
- Task 8 (CustomerProfile) — depends on Tasks 3, 4, 5, 6, 7.
- Task 9 (CustomerHub upgrade) — independent of Tasks 1-8 (calls forward to Task 8 via prop callback that App.tsx wires in Task 15; CustomerHub renders without CustomerProfile being mounted).
- Task 10 (GlobalSearchSheet) — depends on Task 1.
- Task 11 (CustomerDirectorySettingsSection) — depends on Task 13 (calls the backfillCustomers callable).
- Task 12 (CommunicationsSettingsSection + Settings.tsx wiring) — depends on Tasks 10, 11. Imports GlobalSearchSheet for the customer-picker repurpose; wires both new accordions into Settings.tsx.
- Task 13 (backfillCustomers function) — independent.
- Task 14 (onJobWriteCustomerRollup trigger) — independent.
- Task 15 (routing + indexes + View History) — depends on EVERY prior task.

Recommended execution path under `superpowers:subagent-driven-development`:

1. Dispatch Tasks 1, 2, 4, 5, 6, 7, 13, 14 in parallel (8 independent commits — biggest parallel fanout in the plan).
2. Once Task 2 lands, dispatch Task 3.
3. Once Tasks 3, 4, 5, 6, 7 are all committed, dispatch Task 8 (CustomerProfile).
4. Once Task 1 lands, dispatch Task 10.
5. Once Task 13 lands, dispatch Task 11.
6. Once Tasks 10, 11 land, dispatch Task 12.
7. Dispatch Task 9 anytime after Task 8 (uses Task 8's CustomerProfile via callback wiring in Task 15).
8. Run Task 15 LAST.

### 5. Risk surface

- **Index deployment.** Task 15's 8 new composite indexes MUST be deployed before SP3 lands in production. Without index deploy, `GlobalSearchSheet` queries fail with `FAILED_PRECONDITION`. The Task 15 commit message flags this. CI/CD path: run `firebase deploy --only firestore:indexes` before merging to main; verify via `firebase firestore:indexes` listing.
- **Cold-network search latency.** The first GlobalSearchSheet query after app boot is ~100ms slower (cache warmup). The 60s in-memory cache hides subsequent typing. p95 target of 300ms is documented in spec §"Performance contract" (line 2043) — Wheel Rush dataset (~2k customers, ~3k vehicles) comfortably meets this.
- **Rollup trigger debounce per-instance.** The 30s coalescing window is in-process. Cloud Functions v2 may scale to multiple instances; cross-instance debouncing requires Cloud Tasks (SP7). For SP3, two instances each running their own 30s timer is acceptable — the worst case is two recomputes within 30s of each other, both ending in the same `setDoc(merge)` result.
- **CustomerHub legacy file.** SP1's `<Customers/>` wrapping is replaced. The legacy `src/pages/Customers.tsx` keeps existing call-sites (if any non-CustomerHub consumer exists). The Task 9 commit leaves it in place; deletion deferred to SP4 cleanup pass.
- **Backfill walker simplification.** The SP3 walker writes 0 in `legacyKeysRenamed` and `tireFieldsHoisted`. Documented as deliberate scope deferral. Wheel Rush's audit doc surfaces this if legacy data exists; follow-up SP3.1 ticket fills the migration.
- **Privacy contract regression.** A future contributor adding `lifetimeRevenue: rev` to the `_computeRollup` return is the highest-priority code-review failure. The Task 14 test asserts `!('lifetimeRevenue' in r)` as the regression gate. Code-review checklist line at spec line 2162 is the human-side enforcement.
- **Test Incoming Call rule precondition.** The firestore.rules block at lines 664-673 requires `request.resource.data.createdAt is timestamp` AND `request.time - request.resource.data.createdAt < duration.value(60, 's')`. The Task 12 client writes `Timestamp.now()` (not `serverTimestamp()` — the rule evaluates the value, not the sentinel). The 60s tolerance covers normal client-server clock skew.

---

## Handoff prompt

> You're picking up SP3 of the Customer Intelligence v3.2 spec — Customer Profile + Global Search + Insights + Backfill + Customer Directory Settings. SP1 and SP2 have shipped (SP1: commits `7df4115` through `2e3050c`-equivalent; SP2: phone-lookup + AddJob redesign). The SP1 helpers (`src/lib/phone.ts`, `src/lib/customerEntity.ts`, `src/lib/customerInsights.ts`) and SP2 helpers (`src/lib/lookupCustomerByPhone.ts`, `src/lib/usZips.ts`, `src/components/addJob/CustomerLookupCard.tsx`, `src/components/addJob/AddressAutofillInput.tsx`) are all in place. Read this plan top-to-bottom once, then execute task-by-task using `superpowers:subagent-driven-development`.
>
> Constraints:
> - One commit per task, with the exact commit message in the task's final step.
> - Every test file follows the `tsx`-direct harness pattern (no vitest, no jest). Functions tests use the same pattern under `functions/tests/`.
> - Every input that lives inside a re-rendering parent MUST use `MemoInput` + a `useCallback`-stable setter — the P1-3 keystroke-storm contract is non-negotiable.
> - The privacy contract from spec §"Critical privacy contract" line 2162 is the highest-priority code-review failure: `lifetimeRevenue` / `lifetimeProfit` / `expensesTotal` MUST NEVER be persisted on the Customer doc. The Task 14 test asserts this with `!('lifetimeRevenue' in r)`.
> - The plan documents two deliberate scope levers: (a) the 6 Quick Actions on CustomerProfile that touch existing modules (Send Quote/Invoice/Review, View Photos/Invoices/History) remain rendered disabled — wiring in a follow-up SP3.1 pass; (b) the backfill walker writes `0` in `legacyKeysRenamed` and `tireFieldsHoisted` — full legacy migration deferred to follow-up.
> - SP3 introduces 8 new composite Firestore indexes. They MUST be deployed via `firebase deploy --only firestore:indexes` before SP3 reaches production — otherwise `GlobalSearchSheet` returns `FAILED_PRECONDITION`. Task 15 commit message flags this.
> - SP3 deferred items explicitly listed: Connect Twilio form (SP4), missed-call auto-text (SP7), Algolia migration for tenants >25k customers (SP7), per-business VIP threshold override (SP7), Cloud Tasks-backed cross-instance debouncing (SP7).
>
> Begin with Tasks 1, 2, 4, 5, 6, 7, 13, 14 in parallel — 8 independent commits with no cross-dependencies.

---
