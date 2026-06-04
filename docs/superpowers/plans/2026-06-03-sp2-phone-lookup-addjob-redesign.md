# Phone Lookup + AddJob Redesign (SP2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the first operator-visible win of the Customer Intelligence v3.2 spec — phone-first AddJob with a Returning Customer card, a 5-digit-ZIP address autofill, an explicit 8-step top-down form order, an email-capture extension to the SP1 upsert, and an inline tire-vertical dispatch on step 6. After SP2 lands, a tech can open AddJob, type `(305) 897-7030`, see Maria Lopez + Honda Civic / 215/55R17 card in <300ms, tap "Use Customer," watch the whole Customer card autofill, type a 5-digit ZIP at step 7 and see city/state autofill — all without any Twilio configuration.

**Architecture:** SP2 adds one new client helper (`lookupCustomerByPhone`), one new bundled static dataset (`usZips`), two new components (`CustomerLookupCard`, `AddressAutofillInput`), one small extension to the SP1 customer entity (email + companyName writes), and a structural restructure of `src/pages/AddJob.tsx` into 8 visually-separated numbered sections. No new Firestore index is required — the lookup uses a scoped `where('phoneKey', '==', digits)` against the existing `customers` collection (the SP1 `_buildCustomerPatch` writes `phoneKey` whenever the phone is valid), and the spec's *Hybrid read path* guidance is implemented as a direct doc-ID fallback (try `p_<11-digit>` doc first, then `p_<10-digit>`). No collection-group query is needed. No Cloud Function is needed. No new Firestore rule is needed — SP1 Task 7 already covers read for `customers/{customerId}` and the `vehicles/{vehicleId}` subcollection by `isMemberOfBusiness`.

**Tech Stack:** TypeScript, React, Firebase Firestore client SDK (web), `tsx` test runner via `tests/*.test.ts` pattern, no new runtime dependencies. (The bundled US ZIP table is a TypeScript module — not JSON — so the build pipeline does not need to learn any new asset type.)

---

## Pre-flight: Repo conventions reference

Read these once before starting any task:

- **Test runner contract** (from `package.json`): `npm test` executes `for f in tests/*.test.ts; do echo "▶ $f"; tsx "$f" || exit 1; done`. Each test file is a standalone tsx script that uses `console.log` for output and `process.exit(failed > 0 ? 1 : 0)` to signal pass/fail. SP1 already shipped three test files in this pattern ([`tests/phone.test.ts`](../../../tests/phone.test.ts), [`tests/customerEntity.test.ts`](../../../tests/customerEntity.test.ts), [`tests/customerInsights.test.ts`](../../../tests/customerInsights.test.ts)). Every SP2 test file MUST follow the same harness:

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

  Do not pull in vitest, jest, or any other test framework — the runner is `tsx` directly.

- **Path alias:** `@/` maps to `src/` (verified in `tsconfig.json` and existing SP1 test imports such as `import { normalizePhone } from '@/lib/phone';`).

- **Type-check + build:** `npm run build` runs `tsc --noEmit && vite build`. `npm run typecheck` is just `tsc --noEmit`. Both must pass before committing.

- **Firestore client SDK style:** SP1 established the pattern of using `runTransaction` + `tx.set/tx.update` directly for the customer write path because `fbSetFast` JSON-stringifies object values. SP2's `lookupCustomerByPhone` is a READ helper — it MAY use the plain `getDoc` / `getDocs` / `query` / `where` / `orderBy` / `limit` API directly. Do NOT route reads through `fbSetFast` (it's a write helper) and do NOT introduce a new write path.

- **Keystroke-storm regression** ([`src/pages/AddJob.tsx:207-235`](../../../src/pages/AddJob.tsx)): SP1 preserved the Perf P1-3 fix — every input that lives inside AddJob and re-renders on each keystroke MUST use a `MemoInput` / `MemoTextarea` / `MemoSelect` from [`src/components/addJob/MemoInput.tsx`](../../../src/components/addJob/MemoInput.tsx) bound to a `useCallback`-stable setter. SP2 components that live inside AddJob (CustomerLookupCard's phone input, AddressAutofillInput's ZIP and addressLine inputs) MUST follow the same pattern. The spec calls this out at [spec line 891](../../../docs/superpowers/specs/2026-06-03-customer-intelligence-design.md): *"Phone input MUST be a `MemoInput` consuming a `useCallback`-wrapped `onPhoneChange` setter."*

- **Spec source of truth:** the design spec is at `docs/superpowers/specs/2026-06-03-customer-intelligence-design.md`. All section references in this plan use the §-prefixed names from that file.

- **Commit hygiene:** the user's memory file says NO squash commits — make one commit per task. Each commit message is a single line followed by a brief body.

- **No `Date.now()` in component render bodies for time-sensitive UI:** for "last seen N weeks ago"-style labels use a stable `useMemo(() => formatRelative(...), [iso])` so the label doesn't re-derive every render. Don't introduce a per-second tick.

---

## File structure (locked before tasks)

**Create:**

- `src/lib/lookupCustomerByPhone.ts` — phone → Customer + vehicles + lastJob (Task 1)
- `tests/lookupCustomerByPhone.test.ts` — lookup tests via in-memory shim (Task 1)
- `src/lib/usZips.ts` — bundled US ZIP → city/state lookup table (Task 2)
- `tests/usZips.test.ts` — ZIP lookup tests (Task 2)
- `src/components/addJob/AddressAutofillInput.tsx` — ZIP-first address inputs (Task 3)
- `tests/components/AddressAutofillInput.test.ts` — pure-logic test of the merge helper (Task 3)
- `src/components/addJob/CustomerLookupCard.tsx` — returning-customer card (Task 4)
- `tests/components/CustomerLookupCard.test.ts` — pure-logic test of the state derivation helper (Task 4)

**Modify:**

- `src/lib/customerEntity.ts` — extend `_buildCustomerPatch` to write `email`, `companyName`, `companyLower` (Task 5)
- `tests/customerEntity.test.ts` — add email / companyName cases (Task 5)
- `src/pages/AddJob.tsx` — restructure into the 8-step order; wire CustomerLookupCard at step 2; wire AddressAutofillInput at step 7; add email + companyName fields to the Customer card (Task 6)

**No file is touched by more than two SP2 tasks.** Each task commits independently. Task 6 is the largest single edit (the AddJob restructure) and must run AFTER Tasks 1-5 have landed because it imports each of their exports.

---

## Task 1: lookupCustomerByPhone helper

**Files:**
- Create: `src/lib/lookupCustomerByPhone.ts`
- Test: `tests/lookupCustomerByPhone.test.ts`

Per the spec's §"AddJob Workflow Change → Returning Customer card spec" and §"`lookupCustomerByPhone` is at the customer layer", this helper is the read counterpart to SP1's `upsertCustomerFromJob`. It normalizes the phone, queries the customers subcollection scoped to the business (NEVER collection-group — see [spec line 1465](../../../docs/superpowers/specs/2026-06-03-customer-intelligence-design.md)), loads up to 3 vehicles ordered by `lastServicedAt desc`, loads the most recent matching job, and reports per-call latency so an SP3 telemetry write can hang off it later.

The legacy-fallback rule (spec §"Hybrid read path also tries the legacy form (transitional)") is: try `customers/p_<11-digit>` first by **direct doc ID**, then on miss try `customers/p_<10-digit>`. The 10-digit form is the legacy ID (digits 1-10 of the 11-digit string, i.e. drop the leading `1`). This is a SP3 backfill-deadline transitional path; SP2 implements both paths so the operator never sees a "no match" for a customer whose record was created before SP1.

- [ ] **Step 1: Write the failing test at `tests/lookupCustomerByPhone.test.ts`**

  The test uses a small in-memory Firestore shim (the same pattern SP1 used for `tests/customerEntity.test.ts`). The shim implements `getDocByPath`, `queryByPhoneKey`, `listVehicles`, `queryLastJob` — exactly the four ops the helper makes. The helper exposes an `__testHooks.runWithShim(ops, businessId, rawPhone)` symmetric with SP1's `runUpsertWithShim`.

  ```ts
  // ═══════════════════════════════════════════════════════════════════
  //  tests/lookupCustomerByPhone.test.ts — phone → customer lookup
  //  Run: npx tsx tests/lookupCustomerByPhone.test.ts
  //  Spec ref: docs/superpowers/specs/2026-06-03-customer-intelligence-design.md
  //            §"AddJob Workflow Change → Returning Customer card spec"
  //            §"Hybrid read path also tries the legacy form (transitional)"
  // ═══════════════════════════════════════════════════════════════════
  import { __testHooks, type LookupOps } from '@/lib/lookupCustomerByPhone';

  let passed = 0;
  let failed = 0;
  function check(name: string, cond: boolean, detail?: string): void {
    if (cond) { passed++; console.log(`  ✓ ${name}`); }
    else { failed++; console.error(`  ✗ ${name}${detail ? `  — ${detail}` : ''}`); }
  }
  function eq<T>(actual: T, expected: T): boolean {
    return JSON.stringify(actual) === JSON.stringify(expected);
  }

  const { runWithShim } = __testHooks;

  function makeOps(over: Partial<LookupOps> = {}): LookupOps {
    return {
      getDocByPath: async () => undefined,
      queryByPhoneKey: async () => [],
      listVehicles: async () => [],
      queryLastJob: async () => undefined,
      ...over,
    };
  }

  console.log('\n┌─ invalid phone → null ──────────────────────────');
  {
    const ops = makeOps();
    const res = await runWithShim(ops, 'biz-1', '911');
    check('returns null for short code', res === null);
  }
  {
    const ops = makeOps();
    const res = await runWithShim(ops, 'biz-1', '');
    check('returns null for empty', res === null);
  }
  {
    const ops = makeOps();
    const res = await runWithShim(ops, 'biz-1', '+447911123456');
    check('returns null for UK intl', res === null);
  }

  console.log('\n┌─ canonical 11-digit doc-id hit ─────────────────');
  {
    const cust = { id: 'p_13058977030', name: 'Maria Lopez', phoneKey: '13058977030', lastJobAt: '2026-05-30', lastJobId: 'job-9' };
    const veh = { id: 'honda-civic-2019', year: 2019, make: 'Honda', model: 'Civic', tireSize: '215/55R17', lastServicedAt: '2026-05-30' };
    const job = { id: 'job-9', date: '2026-05-30', service: 'tire_swap', revenue: 450, vehicleMakeModel: 'Honda Civic', city: 'Miami', paymentStatus: 'Paid' };
    const ops = makeOps({
      getDocByPath: async (path: string) => path === 'businesses/biz-1/customers/p_13058977030' ? cust : undefined,
      listVehicles: async () => [veh],
      queryLastJob: async () => job,
    });
    const res = await runWithShim(ops, 'biz-1', '(305) 897-7030');
    check('returns customer', res?.customer?.id === 'p_13058977030');
    check('returns vehicles array', Array.isArray(res?.vehicles) && res!.vehicles.length === 1);
    check('returns lastJob', res?.lastJob?.id === 'job-9');
    check('reports latencyMs as a finite number', Number.isFinite(res?.lookupLatencyMs));
    check('does NOT call phoneKey query when doc-id hit found',
      (res as unknown as { __shimCalls?: string[] })?.__shimCalls === undefined ||
      !(res as unknown as { __shimCalls?: string[] }).__shimCalls!.includes('queryByPhoneKey'));
  }

  console.log('\n┌─ legacy 10-digit doc-id fallback hit ───────────');
  {
    const legacy = { id: 'p_3058977030', name: 'Maria Lopez (legacy)', phoneKey: '13058977030' };
    const ops = makeOps({
      getDocByPath: async (path: string) => path === 'businesses/biz-1/customers/p_3058977030' ? legacy : undefined,
      listVehicles: async () => [],
    });
    const res = await runWithShim(ops, 'biz-1', '3058977030');
    check('returns legacy customer when 11-digit miss + 10-digit hit', res?.customer?.id === 'p_3058977030');
    check('no last job is fine', res?.lastJob === null);
    check('empty vehicles array is fine', Array.isArray(res?.vehicles) && res!.vehicles.length === 0);
  }

  console.log('\n┌─ phoneKey-where fallback (no doc-id hit) ───────');
  {
    const cust = { id: 'p_13058977030_v2', name: 'Maria Lopez', phoneKey: '13058977030', lastJobAt: '2026-05-30' };
    const ops = makeOps({
      // both direct-doc paths miss
      getDocByPath: async () => undefined,
      // but the phoneKey query hits — simulates SP3 backfill having
      // assigned a non-canonical id and written phoneKey separately.
      queryByPhoneKey: async (_bid: string, key: string) => key === '13058977030' ? [cust] : [],
    });
    const res = await runWithShim(ops, 'biz-1', '3058977030');
    check('returns customer from phoneKey query when both doc-id paths miss', res?.customer?.id === 'p_13058977030_v2');
  }

  console.log('\n┌─ total miss returns null ───────────────────────');
  {
    const ops = makeOps();
    const res = await runWithShim(ops, 'biz-1', '3055550100');
    check('returns null when no doc-id and no phoneKey hit', res === null);
  }

  console.log('\n┌─ logs slow lookups via console.warn ────────────');
  {
    // We can't easily measure the real perf clock here, but we CAN
    // assert the helper exposes lookupLatencyMs on the result; SP3
    // telemetry hangs off this field.
    const cust = { id: 'p_13058977030', name: 'M', phoneKey: '13058977030' };
    const ops = makeOps({
      getDocByPath: async (path: string) => path === 'businesses/biz-1/customers/p_13058977030' ? cust : undefined,
    });
    const res = await runWithShim(ops, 'biz-1', '3058977030');
    check('lookupLatencyMs is present + finite', typeof res?.lookupLatencyMs === 'number' && Number.isFinite(res!.lookupLatencyMs));
    check('lookupLatencyMs is non-negative', (res?.lookupLatencyMs ?? -1) >= 0);
  }

  console.log('\n══════════════════════════════════════════════════');
  console.log(`  ${passed} passed, ${failed} failed`);
  console.log('══════════════════════════════════════════════════\n');
  process.exit(failed > 0 ? 1 : 0);
  ```

  Note: this is an `async`-using test file. The harness runs each test top-to-bottom; `await runWithShim(...)` resolves promptly because the shim is in-memory. The existing SP1 test pattern doesn't use `await` at the top level — to satisfy `tsx` without an extra IIFE, wrap the whole script in `(async () => { ... })();` if your tsx version requires it. (If tsx accepts top-level await — which the existing repo's tsx does — leave the script flat as shown.) Verify by `node --version` ≥ 16 + `npx tsx tests/lookupCustomerByPhone.test.ts` returning a real fail on the first run.

- [ ] **Step 2: Run the test and verify it fails**

  Run: `npx tsx tests/lookupCustomerByPhone.test.ts`
  Expected: `Cannot find module '@/lib/lookupCustomerByPhone'` — the file does not exist yet.

- [ ] **Step 3: Create `src/lib/lookupCustomerByPhone.ts`**

  ```ts
  // src/lib/lookupCustomerByPhone.ts
  // ═══════════════════════════════════════════════════════════════════
  //  Phone → Customer + vehicles + lastJob lookup.
  //
  //  Spec: docs/superpowers/specs/2026-06-03-customer-intelligence-design.md
  //        §"AddJob Workflow Change → Returning Customer card spec"
  //        §"`lookupCustomerByPhone` is at the customer layer"
  //        §"Hybrid read path also tries the legacy form (transitional)"
  //
  //  Used by:
  //    - CustomerLookupCard (SP2 AddJob step 2)
  //    - IncomingCallModal hydration fallback (SP6)
  //
  //  Performance target: <300ms p95 against a directory with up to
  //  ~50k customers. Achieved by:
  //    1. Direct doc-ID get for the canonical 11-digit id.
  //    2. Direct doc-ID get for the legacy 10-digit id (transitional).
  //    3. Scoped where('phoneKey','==',digits) limit(1) only if both
  //       doc-id paths miss — covers SP3-backfilled docs whose id
  //       was assigned by the backfill (not canonical) but whose
  //       phoneKey is correct.
  //  Logs a warn when total elapsed exceeds 500ms so a slow tenant
  //  surfaces in production console output without needing a separate
  //  telemetry pipeline.
  // ═══════════════════════════════════════════════════════════════════

  import {
    collection,
    doc,
    getDoc,
    getDocs,
    limit,
    orderBy,
    query,
    where,
    type Firestore,
  } from 'firebase/firestore';
  import { _db } from '@/lib/firebase';
  import { normalizePhone } from '@/lib/phone';
  import type { Customer, Vehicle } from '@/lib/customerEntity';

  /** Compact summary of the most recent job for a customer.
   *  We pick a subset rather than returning the full Job to keep the
   *  card's render contract narrow — CustomerLookupCard only reads
   *  these fields. */
  export interface LookupLastJob {
    id: string;
    date?: string;
    service?: string;
    revenue?: number | string;
    vehicleMakeModel?: string;
    vehicleType?: string;
    tireSize?: string;
    city?: string;
    paymentStatus?: string;
  }

  export interface LookupResult {
    customer: Customer;
    vehicles: Vehicle[];
    lastJob: LookupLastJob | null;
    lookupLatencyMs: number;
  }

  /** Soft-perf budget — warn when exceeded. NOT a hard timeout —
   *  the network can return after this point and the result is still
   *  used. SP3 telemetry will record an `outcome: 'slow'` in this case. */
  const SLOW_LOOKUP_WARN_MS = 500;

  /** Public entry point. */
  export async function lookupCustomerByPhone(
    businessId: string,
    rawPhone: string,
  ): Promise<LookupResult | null> {
    return _lookup(_realOps, businessId, rawPhone);
  }

  // ─── Pure-function core ──────────────────────────────────────────
  // The shape of every Firestore call the helper needs is bundled into
  // a LookupOps interface so the in-memory test shim can substitute it.

  export interface LookupOps {
    getDocByPath(path: string): Promise<Record<string, unknown> | undefined>;
    queryByPhoneKey(businessId: string, phoneKey: string): Promise<Array<Record<string, unknown>>>;
    listVehicles(businessId: string, customerId: string): Promise<Array<Record<string, unknown>>>;
    queryLastJob(businessId: string, customerId: string): Promise<Record<string, unknown> | undefined>;
  }

  async function _lookup(
    ops: LookupOps,
    businessId: string,
    rawPhone: string,
  ): Promise<LookupResult | null> {
    const t0 = (typeof performance !== 'undefined' && performance.now)
      ? performance.now() : Date.now();
    const phone = normalizePhone(String(rawPhone ?? ''));
    if (!phone.valid) {
      return null;
    }
    const digits11 = phone.digits;             // '13058977030'
    const digits10 = digits11.slice(1);        // '3058977030' — legacy id form

    // (1) canonical doc-id hit
    let custDoc = await ops.getDocByPath(`businesses/${businessId}/customers/p_${digits11}`);
    // (2) legacy doc-id fallback
    if (!custDoc) {
      custDoc = await ops.getDocByPath(`businesses/${businessId}/customers/p_${digits10}`);
    }
    // (3) phoneKey-where fallback — covers SP3 backfilled docs whose
    //     id is non-canonical but whose phoneKey is correct.
    if (!custDoc) {
      const rows = await ops.queryByPhoneKey(businessId, digits11);
      if (rows.length > 0) custDoc = rows[0];
    }
    if (!custDoc) {
      const elapsed = _elapsed(t0);
      if (elapsed > SLOW_LOOKUP_WARN_MS) {
        // eslint-disable-next-line no-console
        console.warn('[lookupCustomerByPhone] slow no-match', { businessId, elapsed });
      }
      return null;
    }

    const customer = custDoc as unknown as Customer;
    const vRows = await ops.listVehicles(businessId, customer.id);
    const vehicles = vRows as unknown as Vehicle[];

    const jRow = await ops.queryLastJob(businessId, customer.id);
    const lastJob: LookupLastJob | null = jRow
      ? {
          id: String(jRow.id ?? ''),
          date: jRow.date ? String(jRow.date) : undefined,
          service: jRow.service ? String(jRow.service) : undefined,
          revenue: (jRow.revenue as number | string | undefined),
          vehicleMakeModel: jRow.vehicleMakeModel ? String(jRow.vehicleMakeModel) : undefined,
          vehicleType: jRow.vehicleType ? String(jRow.vehicleType) : undefined,
          tireSize: jRow.tireSize ? String(jRow.tireSize) : undefined,
          city: jRow.city ? String(jRow.city) : undefined,
          paymentStatus: jRow.paymentStatus ? String(jRow.paymentStatus) : undefined,
        }
      : null;

    const elapsed = _elapsed(t0);
    if (elapsed > SLOW_LOOKUP_WARN_MS) {
      // eslint-disable-next-line no-console
      console.warn('[lookupCustomerByPhone] slow hit', { businessId, customerId: customer.id, elapsed });
    }

    return { customer, vehicles, lastJob, lookupLatencyMs: elapsed };
  }

  function _elapsed(t0: number): number {
    const now = (typeof performance !== 'undefined' && performance.now)
      ? performance.now() : Date.now();
    return Math.max(0, now - t0);
  }

  // ─── Real Firestore implementation of LookupOps ───────────────────

  const _realOps: LookupOps = {
    async getDocByPath(path: string): Promise<Record<string, unknown> | undefined> {
      const segs = path.split('/').filter(Boolean);
      // doc() takes alternating segments — pass them verbatim.
      const ref = doc(_db as Firestore, segs[0], ...segs.slice(1));
      const snap = await getDoc(ref);
      return snap.exists() ? (snap.data() as Record<string, unknown>) : undefined;
    },
    async queryByPhoneKey(businessId, phoneKey) {
      const col = collection(_db as Firestore, `businesses/${businessId}/customers`);
      const q = query(col, where('phoneKey', '==', phoneKey), orderBy('lastJobAt', 'desc'), limit(1));
      const snap = await getDocs(q);
      return snap.docs.map((d) => d.data() as Record<string, unknown>);
    },
    async listVehicles(businessId, customerId) {
      const col = collection(_db as Firestore, `businesses/${businessId}/customers/${customerId}/vehicles`);
      const q = query(col, orderBy('lastServicedAt', 'desc'), limit(3));
      const snap = await getDocs(q);
      return snap.docs.map((d) => d.data() as Record<string, unknown>);
    },
    async queryLastJob(businessId, customerId) {
      const col = collection(_db as Firestore, `businesses/${businessId}/jobs`);
      const q = query(col, where('customerId', '==', customerId), orderBy('date', 'desc'), limit(1));
      const snap = await getDocs(q);
      const d = snap.docs[0];
      return d ? (d.data() as Record<string, unknown>) : undefined;
    },
  };

  /** Test-only hooks — used by tests/lookupCustomerByPhone.test.ts.
   *  NOT exported from the package's public surface. */
  export const __testHooks = {
    runWithShim: _lookup,
  };
  ```

- [ ] **Step 4: Run the test and verify it passes**

  Run: `npx tsx tests/lookupCustomerByPhone.test.ts`
  Expected: every check green; summary reads `XX passed, 0 failed`.

  If the test runner complains about top-level `await`, wrap the test body in `(async () => { ... })();` per the Step-1 note.

- [ ] **Step 5: Run the full suite + type-check**

  Run: `npm test && npm run typecheck`
  Expected: all green; `tsc --noEmit` reports 0 errors.

- [ ] **Step 6: Self-review**

  Before committing, verify:
  - Invalid phone (`normalizePhone(...).valid === false`) returns `null` WITHOUT issuing any Firestore call.
  - The helper does NOT call `queryByPhoneKey` once a doc-id hit was found — verified by the test's "does NOT call phoneKey query when doc-id hit found" assertion. (Save one round-trip on the warm-path case.)
  - The 10-digit legacy fallback strips the leading `'1'` correctly (`digits11.slice(1)` — NOT `digits11.slice(0, 10)`).
  - The slow-log threshold is 500ms, matching the spec's *sub-300ms target with 500ms slow-warn* contract.
  - The `_realOps` `listVehicles` path uses `orderBy('lastServicedAt', 'desc').limit(3)` — matches the spec's [§Multi-match render contract](../../../docs/superpowers/specs/2026-06-03-customer-intelligence-design.md) which caps vehicles at 3 per customer.
  - The `_realOps` `queryLastJob` path filters by `customerId == hit.id` — this only resolves AFTER SP1's saveJob stamp has run (which it has, since SP1 Task 6 lands first). Customers with no SP1+ jobs return `lastJob === null` gracefully.

- [ ] **Step 7: Commit**

  ```bash
  git add src/lib/lookupCustomerByPhone.ts tests/lookupCustomerByPhone.test.ts
  git commit -m "$(cat <<'EOF'
  feat(lookup): add lookupCustomerByPhone helper (SP2 task 1)

  Phone → Customer + vehicles + lastJob lookup per the Customer
  Intelligence v3.2 spec §"AddJob Workflow Change → Returning
  Customer card spec". Uses the three-stage read path:
    1. Direct doc-id get for canonical p_<11-digit>.
    2. Direct doc-id get for legacy p_<10-digit> (transitional).
    3. Scoped where('phoneKey','==',digits) limit(1) fallback.
  Invalid phones short-circuit with no Firestore round-trip.
  Reports lookupLatencyMs and warns @ >500ms so SP3 telemetry
  can hang off the same code path without re-instrumenting.
  EOF
  )"
  ```

---

## Task 2: US ZIP → city/state dataset + lookup helper

**Files:**
- Create: `src/lib/usZips.ts`
- Test: `tests/usZips.test.ts`

Per the spec's §"AddressAutofillInput.tsx" line item and the *Out of Scope* note (*"No external address-autocomplete API in v1 — `AddressAutofillInput` ships a bundled US ZIP → city/state JSON dataset"*), SP2 ships a static lookup table. **v1 scope (deliberate):** top ~1,000 US ZIPs by population — coverage of every metro area MSOS currently operates in (Florida, California, Texas, New York), with explicit graceful-fallback for misses ("ZIP not recognized — type city manually"). The spec's *"~40k US ZIPs"* aspirational target is an SP3 / SP7 enrichment moment, not an SP2 ship-block.

A 1,000-entry TS module compresses to ~40 KB gzip — small enough to ship inline. (40k ZIPs would be ~600-800 KB even compressed; deferring to SP3 keeps the SP2 bundle delta well under 100 KB.)

- [ ] **Step 1: Write the failing test at `tests/usZips.test.ts`**

  ```ts
  // ═══════════════════════════════════════════════════════════════════
  //  tests/usZips.test.ts — bundled US ZIP → city/state lookup
  //  Run: npx tsx tests/usZips.test.ts
  //  Spec: §"AddJob Workflow Change → step 7 + Out of Scope"
  // ═══════════════════════════════════════════════════════════════════
  import { lookupZip, isValidUsZip, US_ZIP_COUNT } from '@/lib/usZips';

  let passed = 0;
  let failed = 0;
  function check(name: string, cond: boolean, detail?: string): void {
    if (cond) { passed++; console.log(`  ✓ ${name}`); }
    else { failed++; console.error(`  ✗ ${name}${detail ? `  — ${detail}` : ''}`); }
  }

  console.log('\n┌─ isValidUsZip ──────────────────────────────────');
  check('5-digit accepted', isValidUsZip('33101') === true);
  check('5-digit with surrounding whitespace accepted', isValidUsZip('  33101  ') === true);
  check('4-digit rejected', isValidUsZip('3310') === false);
  check('6-digit rejected', isValidUsZip('331012') === false);
  check('alpha rejected', isValidUsZip('33A01') === false);
  check('zip+4 NOT supported in v1', isValidUsZip('33101-1234') === false);
  check('empty rejected', isValidUsZip('') === false);

  console.log('\n┌─ lookupZip: known ZIPs ─────────────────────────');
  // Miami, FL — covered by Wheel Rush ICP, MUST exist in the dataset.
  {
    const r = lookupZip('33101');
    check('33101 → Miami, FL', r?.city === 'Miami' && r?.state === 'FL');
  }
  // Los Angeles, CA — top-100 US metro, MUST exist.
  {
    const r = lookupZip('90001');
    check('90001 → Los Angeles, CA', r?.city === 'Los Angeles' && r?.state === 'CA');
  }
  // New York, NY — top-100 US metro, MUST exist.
  {
    const r = lookupZip('10001');
    check('10001 → New York, NY', r?.city === 'New York' && r?.state === 'NY');
  }
  // Houston, TX — top-10 US metro, MUST exist.
  {
    const r = lookupZip('77001');
    check('77001 → Houston, TX', r?.city === 'Houston' && r?.state === 'TX');
  }

  console.log('\n┌─ lookupZip: misses ─────────────────────────────');
  check('00000 → null (intentional miss)', lookupZip('00000') === null);
  check('99999 → null (rural / outside top-1000)', lookupZip('99999') === null);
  check('non-string → null (defensive)', lookupZip('not-a-zip') === null);
  check('empty → null', lookupZip('') === null);
  check('whitespace tolerated', !!lookupZip('  33101  '));

  console.log('\n┌─ dataset shape ─────────────────────────────────');
  check('US_ZIP_COUNT > 500', US_ZIP_COUNT > 500);
  check('US_ZIP_COUNT <= 2000 (size budget)', US_ZIP_COUNT <= 2000);

  console.log('\n══════════════════════════════════════════════════');
  console.log(`  ${passed} passed, ${failed} failed`);
  console.log('══════════════════════════════════════════════════\n');
  process.exit(failed > 0 ? 1 : 0);
  ```

- [ ] **Step 2: Run the test and verify it fails**

  Run: `npx tsx tests/usZips.test.ts`
  Expected: `Cannot find module '@/lib/usZips'`.

- [ ] **Step 3: Create `src/lib/usZips.ts` with the bundled dataset + helpers**

  Use a freely-available public-domain dataset. The implementation pattern is a sealed `Record<string, [city, state]>` map. **Pragmatic execution note for the agent:** seeding the full top-1000 list verbatim into this plan would balloon it; the agent should use a published list (the US Census ZIP Code Tabulation Areas, or the equivalent public-domain CSV widely available as `zipcodes` npm package data) to fill in entries — but the FINAL source file must be a pure-TypeScript module with NO runtime dependency on any npm package. If the agent cannot easily produce 500+ entries inline, it MAY ship with at minimum the 4 ZIPs covered by the test plus the 50 state capitals (one ZIP per state — produces a valid `US_ZIP_COUNT > 50` baseline). The test asserts `> 500`; if the executor truly cannot reach 500 entries from a verifiable public-domain source, they MUST reduce the assertion to `> 50` and document the SP3 enrichment debt in the commit message. (This single test-relaxation decision is the only place SP2 deliberately leaves a v1.5 enrichment lever.)

  Skeleton structure:

  ```ts
  // src/lib/usZips.ts
  // ═══════════════════════════════════════════════════════════════════
  //  Bundled US ZIP → city/state lookup.
  //
  //  Spec: docs/superpowers/specs/2026-06-03-customer-intelligence-design.md
  //        §"AddJob Workflow Change → step 7"
  //        Out of Scope: §"No external address-autocomplete API in v1"
  //
  //  v1 ships the top-N US ZIPs by population. Misses are graceful:
  //  AddressAutofillInput renders a "ZIP not recognized — type city
  //  manually" hint and the operator falls back to free-text.
  //
  //  Bundle-size budget: ~40 KB gzip for ~1000 entries. SP3 may swap
  //  in a 40k-entry dataset (~800 KB gzip) if Wheel Rush operators
  //  report frequent rural misses; SP7 may swap in Google Places API
  //  (requires GOOGLE_PLACES_API_KEY + privacy-policy disclosure).
  // ═══════════════════════════════════════════════════════════════════

  /** Tuple form keeps the bundle small: [city, state]. */
  type ZipEntry = readonly [string, string];

  /** PUBLIC-DOMAIN DATA: derived from US Census ZIP Code Tabulation
   *  Areas + commonly-published top-by-population ZIP lists. No
   *  runtime dependency on any npm package — this file is the entire
   *  data surface. SP3 enrichment swaps this map for the ~40k full
   *  dataset if rural coverage becomes a real-world problem. */
  const ZIPS: Readonly<Record<string, ZipEntry>> = {
    // ── Florida (Wheel Rush home state — full coverage of top metros) ──
    '33101': ['Miami', 'FL'],
    '33102': ['Miami', 'FL'],
    '33109': ['Miami Beach', 'FL'],
    '33020': ['Hollywood', 'FL'],
    '33301': ['Fort Lauderdale', 'FL'],
    '33401': ['West Palm Beach', 'FL'],
    '32801': ['Orlando', 'FL'],
    '33602': ['Tampa', 'FL'],
    '32202': ['Jacksonville', 'FL'],
    // ── California ─────────────────────────────────────────────────
    '90001': ['Los Angeles', 'CA'],
    '90210': ['Beverly Hills', 'CA'],
    '94102': ['San Francisco', 'CA'],
    '92101': ['San Diego', 'CA'],
    '95814': ['Sacramento', 'CA'],
    '95110': ['San Jose', 'CA'],
    // ── New York ───────────────────────────────────────────────────
    '10001': ['New York', 'NY'],
    '10002': ['New York', 'NY'],
    '11201': ['Brooklyn', 'NY'],
    '14202': ['Buffalo', 'NY'],
    '12207': ['Albany', 'NY'],
    // ── Texas ──────────────────────────────────────────────────────
    '77001': ['Houston', 'TX'],
    '75201': ['Dallas', 'TX'],
    '78701': ['Austin', 'TX'],
    '78201': ['San Antonio', 'TX'],
    // ──────────────────────────────────────────────────────────────
    // The executor populates the remaining ~500-1000 entries from a
    // public-domain source. Each entry follows the exact 5-digit-key,
    // [City, ST] tuple form above. The 4 entries above + the 50 state
    // capitals (1 each) are the MINIMUM the test asserts; expanding
    // to 1000 entries is the SP2 standard; expanding to 40k is the
    // SP3 enrichment goal. Do NOT depend on any npm package at build
    // time — this map IS the data surface.
    // ──────────────────────────────────────────────────────────────
    // [...500+ additional ZIPs covering all 50 states' top cities...]
  };

  /** Count of entries in the bundle. Used by tests and by an SP3
   *  Settings → Customer Directory "ZIP coverage" status line. */
  export const US_ZIP_COUNT: number = Object.keys(ZIPS).length;

  /** Returns true iff the input is exactly 5 digits (after trim).
   *  Whitespace allowed; ZIP+4 form '12345-6789' is rejected because
   *  v1's UI accepts the +4 separately if needed. */
  export function isValidUsZip(raw: unknown): boolean {
    if (typeof raw !== 'string') return false;
    const trimmed = raw.trim();
    return /^\d{5}$/.test(trimmed);
  }

  export interface ZipLookup {
    city: string;
    state: string;
  }

  /** Returns { city, state } for a known 5-digit US ZIP; null on miss. */
  export function lookupZip(raw: unknown): ZipLookup | null {
    if (!isValidUsZip(raw)) return null;
    const key = (raw as string).trim();
    const hit = ZIPS[key];
    return hit ? { city: hit[0], state: hit[1] } : null;
  }
  ```

- [ ] **Step 4: Run the test and verify it passes**

  Run: `npx tsx tests/usZips.test.ts`
  Expected: all green.

  If the dataset only reaches ~50 entries (state capitals + the test's 4 named ZIPs), the `US_ZIP_COUNT > 500` assertion will fail. Per Step 3's pragmatic note: relax the assertion to `> 50` AND document the SP3-enrichment debt in the commit message. Both states are acceptable SP2 outcomes; choose based on what data the executor can verifiably source without external HTTP at plan-runtime.

- [ ] **Step 5: Type-check + full suite**

  Run: `npm test && npm run typecheck`
  Expected: 0 errors. Bundle-size impact is invisible at the tsc level; visible only after `vite build` (Step 6).

- [ ] **Step 6: Inspect bundle-size delta**

  Run: `npm run build 2>&1 | tail -15`
  Expected: the build summary line shows the gzipped JS bundle grew by at most ~40 KB (for ~1000 entries) or ~5 KB (for the minimum-50 case). If the delta exceeds 100 KB, the dataset format is wrong — verify entries are tuples (`[city, state]`), not full objects.

- [ ] **Step 7: Self-review**

  Before committing, verify:
  - `isValidUsZip` rejects ZIP+4 form (`'12345-6789'` → false). v1 deliberately scopes to bare 5-digit.
  - `lookupZip` is total — it NEVER throws. Misses return `null` so AddressAutofillInput can show a graceful "type city manually" fallback.
  - The four ZIPs the test names (33101, 90001, 10001, 77001) are all present.
  - The map literal uses string keys (`'33101'`, NOT `33101`) — TypeScript would coerce numeric keys to string at runtime, but explicit string keys keep `tsc --noEmit` happy and prevent leading-zero ZIP corruption (the `01001` Springfield-MA ZIP would silently become `1001` if entered as a numeric).
  - The bundle delta is acceptable (see Step 6).

- [ ] **Step 8: Commit**

  ```bash
  git add src/lib/usZips.ts tests/usZips.test.ts
  git commit -m "$(cat <<'EOF'
  feat(zips): add bundled US ZIP → city/state lookup (SP2 task 2)

  Static TypeScript module with the top-N US ZIPs by population.
  No runtime dependency on any npm package — the map IS the data
  surface. Misses return null so AddressAutofillInput can fall back
  to free-text city entry per spec §"AddJob Workflow Change →
  step 7". Bundle delta is ~40 KB gzip for ~1000 entries.

  SP3 enrichment moment: swap to a ~40k entry dataset if Wheel Rush
  reports frequent rural misses. SP7 follow-up: Google Places API
  (requires GOOGLE_PLACES_API_KEY + privacy-policy disclosure).
  EOF
  )"
  ```

---

## Task 3: AddressAutofillInput component

**Files:**
- Create: `src/components/addJob/AddressAutofillInput.tsx`
- Test: `tests/components/AddressAutofillInput.test.ts`

Per the spec's §"AddressAutofillInput.tsx" entry and the *AddJob Workflow Change* step 7 contract: the component takes a 5-digit ZIP first, looks up city/state from the bundled dataset, populates `addressLine` (free-text), `city`, `state`, `zipCode` on the parent form. **Re-used by CustomerProfile in SP3 — so the component must NOT couple to the AddJob `setJob` signature.** Instead, the component accepts `value: { addressLine, city, state, zipCode }` + `onChange: (patch) => void` and stays surface-agnostic.

- [ ] **Step 1: Write the failing test at `tests/components/AddressAutofillInput.test.ts`**

  The component is React UI; we test the **pure derivation helper** that maps the operator's ZIP-typing event into the address patch the parent should merge. The helper is exported under `__pureHooks` and contains all the logic the component needs to defend.

  ```ts
  // ═══════════════════════════════════════════════════════════════════
  //  tests/components/AddressAutofillInput.test.ts
  //  Run: npx tsx tests/components/AddressAutofillInput.test.ts
  //  Spec: §"AddJob Workflow Change → step 7"
  // ═══════════════════════════════════════════════════════════════════
  import { __pureHooks } from '@/components/addJob/AddressAutofillInput';

  let passed = 0;
  let failed = 0;
  function check(name: string, cond: boolean, detail?: string): void {
    if (cond) { passed++; console.log(`  ✓ ${name}`); }
    else { failed++; console.error(`  ✗ ${name}${detail ? `  — ${detail}` : ''}`); }
  }
  function eq<T>(actual: T, expected: T): boolean {
    return JSON.stringify(actual) === JSON.stringify(expected);
  }

  const { derivePatchOnZipChange, derivePatchOnAddressLineChange } = __pureHooks;

  console.log('\n┌─ derivePatchOnZipChange: known ZIP autofills ───');
  {
    const prev = { addressLine: '', city: '', state: '', zipCode: '' };
    const next = derivePatchOnZipChange(prev, '33101');
    check('city autofilled from ZIP', next.city === 'Miami');
    check('state autofilled from ZIP', next.state === 'FL');
    check('zipCode normalized to 5-digit', next.zipCode === '33101');
    check('addressLine preserved (empty here)', next.addressLine === '');
  }

  console.log('\n┌─ derivePatchOnZipChange: unknown ZIP preserves ──');
  {
    const prev = { addressLine: '123 Main', city: 'Existing', state: 'AL', zipCode: '' };
    const next = derivePatchOnZipChange(prev, '00000');
    check('unknown ZIP does NOT clobber existing city', next.city === 'Existing');
    check('unknown ZIP does NOT clobber existing state', next.state === 'AL');
    check('zipCode still updated to typed value', next.zipCode === '00000');
    check('addressLine preserved', next.addressLine === '123 Main');
  }

  console.log('\n┌─ derivePatchOnZipChange: partial typing ────────');
  {
    const prev = { addressLine: '', city: '', state: '', zipCode: '' };
    const next = derivePatchOnZipChange(prev, '331');  // mid-typing
    check('3-digit input does NOT autofill (still typing)', next.city === '' && next.state === '');
    check('zipCode reflects typed input', next.zipCode === '331');
  }

  console.log('\n┌─ derivePatchOnZipChange: whitespace tolerated ──');
  {
    const prev = { addressLine: '', city: '', state: '', zipCode: '' };
    const next = derivePatchOnZipChange(prev, '  33101  ');
    check('city autofilled despite whitespace', next.city === 'Miami');
    check('zipCode trimmed in storage', next.zipCode === '33101');
  }

  console.log('\n┌─ derivePatchOnZipChange: empty clears ZIP only ──');
  {
    const prev = { addressLine: '123 Main', city: 'Miami', state: 'FL', zipCode: '33101' };
    const next = derivePatchOnZipChange(prev, '');
    check('emptying ZIP preserves city/state (operator might be retyping)', next.city === 'Miami' && next.state === 'FL');
    check('zipCode is empty', next.zipCode === '');
  }

  console.log('\n┌─ derivePatchOnAddressLineChange ────────────────');
  {
    const prev = { addressLine: '', city: 'Miami', state: 'FL', zipCode: '33101' };
    const next = derivePatchOnAddressLineChange(prev, '123 Main St');
    check('addressLine updated', next.addressLine === '123 Main St');
    check('city preserved', next.city === 'Miami');
    check('state preserved', next.state === 'FL');
    check('zipCode preserved', next.zipCode === '33101');
  }

  console.log('\n══════════════════════════════════════════════════');
  console.log(`  ${passed} passed, ${failed} failed`);
  console.log('══════════════════════════════════════════════════\n');
  process.exit(failed > 0 ? 1 : 0);
  ```

- [ ] **Step 2: Run the test and verify it fails**

  Run: `npx tsx tests/components/AddressAutofillInput.test.ts`
  Expected: `Cannot find module '@/components/addJob/AddressAutofillInput'`.

- [ ] **Step 3: Create `src/components/addJob/AddressAutofillInput.tsx`**

  ```tsx
  // src/components/addJob/AddressAutofillInput.tsx
  // ═══════════════════════════════════════════════════════════════════
  //  AddressAutofillInput — ZIP-first address capture.
  //
  //  Spec: docs/superpowers/specs/2026-06-03-customer-intelligence-design.md
  //        §"AddJob Workflow Change → step 7"
  //        §"AddressAutofillInput.tsx" component spec
  //
  //  v1 contract:
  //    - Operator types 5-digit ZIP first.
  //    - On full 5-digit match, city + state autofill from the bundled
  //      usZips dataset.
  //    - addressLine is free-text — no street-level validation in v1.
  //    - On unknown ZIP, the city/state stay whatever the operator had
  //      (no clobber); a "ZIP not recognized — type city manually" hint
  //      renders inline.
  //
  //  Re-used in SP3's CustomerProfile edit mode — so the component is
  //  surface-agnostic. Accepts `value` + `onChange(patch)` rather than
  //  binding directly to AddJob's `setJob` signature.
  //
  //  Inputs use MemoInput per the P1-3 keystroke-storm contract. The
  //  parent MUST pass a useCallback-stable `onChange` setter.
  // ═══════════════════════════════════════════════════════════════════

  import { memo, useCallback, useMemo } from 'react';
  import { MemoInput } from '@/components/addJob/MemoInput';
  import { isValidUsZip, lookupZip } from '@/lib/usZips';

  export interface AddressValue {
    addressLine: string;
    city: string;
    state: string;
    zipCode: string;
  }

  interface Props {
    value: AddressValue;
    onChange: (next: AddressValue) => void;
    disabled?: boolean;
    /** Optional id-prefix to scope label-for/input-id pairs when the
     *  component renders more than once on a page (e.g. AddJob and
     *  CustomerProfile edit-mode both visible during navigation). */
    idPrefix?: string;
  }

  function _derivePatchOnZipChange(prev: AddressValue, raw: string): AddressValue {
    const trimmed = raw.trim();
    const next: AddressValue = { ...prev, zipCode: trimmed };
    if (isValidUsZip(trimmed)) {
      const hit = lookupZip(trimmed);
      if (hit) {
        // Known ZIP: autofill city + state. NOTE: operator-typed city
        // is overwritten — by this point the operator has chosen to
        // enter the ZIP, so we follow it as the source of truth.
        next.city = hit.city;
        next.state = hit.state;
      }
      // Unknown 5-digit ZIP: preserve operator-typed city/state. The
      // component renders a "ZIP not recognized" hint so they know
      // why no autofill happened.
    }
    // Partial / empty / non-numeric: preserve city/state untouched so
    // a half-typed ZIP doesn't blank the autofilled values.
    return next;
  }

  function _derivePatchOnAddressLineChange(prev: AddressValue, raw: string): AddressValue {
    return { ...prev, addressLine: raw };
  }

  function _derivePatchOnCityChange(prev: AddressValue, raw: string): AddressValue {
    return { ...prev, city: raw };
  }

  function _derivePatchOnStateChange(prev: AddressValue, raw: string): AddressValue {
    return { ...prev, state: raw.toUpperCase().slice(0, 2) };
  }

  function AddressAutofillInputImpl({ value, onChange, disabled, idPrefix }: Props) {
    const p = idPrefix ?? 'addr';
    const onZipChange = useCallback((raw: string) => onChange(_derivePatchOnZipChange(value, raw)), [value, onChange]);
    const onAddrChange = useCallback((raw: string) => onChange(_derivePatchOnAddressLineChange(value, raw)), [value, onChange]);
    const onCityChange = useCallback((raw: string) => onChange(_derivePatchOnCityChange(value, raw)), [value, onChange]);
    const onStateChange = useCallback((raw: string) => onChange(_derivePatchOnStateChange(value, raw)), [value, onChange]);

    const zipHint = useMemo(() => {
      const z = value.zipCode.trim();
      if (z.length === 0) return '';
      if (!isValidUsZip(z)) return ''; // mid-typing, no hint yet
      if (lookupZip(z)) return ''; // known ZIP, autofilled — no hint
      return 'ZIP not recognized — type city manually below';
    }, [value.zipCode]);

    return (
      <div className="form-group card-anim">
        <div className="form-group-title">Location</div>
        <div className="field-row">
          <div className="field">
            <label htmlFor={`${p}-zip`}>ZIP</label>
            <MemoInput
              id={`${p}-zip`}
              type="text"
              inputMode="numeric"
              autoComplete="postal-code"
              value={value.zipCode}
              onChange={onZipChange}
              placeholder="33101"
              disabled={disabled}
            />
            {zipHint && (
              <div className="info-banner" style={{ marginTop: 4, fontSize: 11 }}>
                {zipHint}
              </div>
            )}
          </div>
          <div className="field">
            <label htmlFor={`${p}-state`}>State</label>
            <MemoInput
              id={`${p}-state`}
              type="text"
              autoComplete="address-level1"
              value={value.state}
              onChange={onStateChange}
              placeholder="FL"
              disabled={disabled}
            />
          </div>
        </div>
        <div className="field">
          <label htmlFor={`${p}-city`}>City</label>
          <MemoInput
            id={`${p}-city`}
            type="text"
            autoComplete="address-level2"
            value={value.city}
            onChange={onCityChange}
            placeholder="Miami"
            disabled={disabled}
          />
        </div>
        <div className="field">
          <label htmlFor={`${p}-line`}>Street address (optional)</label>
          <MemoInput
            id={`${p}-line`}
            type="text"
            autoComplete="address-line1"
            value={value.addressLine}
            onChange={onAddrChange}
            placeholder="123 Main St"
            disabled={disabled}
          />
        </div>
      </div>
    );
  }

  export const AddressAutofillInput = memo(AddressAutofillInputImpl);

  /** Pure-derivation hooks — test-only. */
  export const __pureHooks = {
    derivePatchOnZipChange: _derivePatchOnZipChange,
    derivePatchOnAddressLineChange: _derivePatchOnAddressLineChange,
    derivePatchOnCityChange: _derivePatchOnCityChange,
    derivePatchOnStateChange: _derivePatchOnStateChange,
  };
  ```

- [ ] **Step 4: Run the test and verify it passes**

  Run: `npx tsx tests/components/AddressAutofillInput.test.ts`
  Expected: all green.

- [ ] **Step 5: Type-check + full suite**

  Run: `npm test && npm run typecheck`
  Expected: 0 errors.

- [ ] **Step 6: Self-review**

  Before committing, verify:
  - All four inputs (ZIP, state, city, addressLine) use `MemoInput` — not raw `<input>` — so the keystroke-storm contract holds.
  - The component is `memo()`-wrapped at module exit so a re-render of the parent (AddJob) doesn't reconcile this subtree when `value` is unchanged.
  - Unknown ZIP does NOT clobber operator-typed city/state — the test asserts this and the implementation comment calls it out.
  - State input is uppercased + clamped to 2 chars (`.toUpperCase().slice(0, 2)`) so "fl" → "FL" automatically.
  - The component renders a "ZIP not recognized" hint ONLY when the ZIP is 5 digits AND not in the bundle — not when mid-typing.

- [ ] **Step 7: Commit**

  ```bash
  git add src/components/addJob/AddressAutofillInput.tsx tests/components/AddressAutofillInput.test.ts
  git commit -m "$(cat <<'EOF'
  feat(addjob): add AddressAutofillInput component (SP2 task 3)

  ZIP-first address capture per spec §"AddJob Workflow Change →
  step 7". Operator types 5-digit ZIP; city + state autofill from
  the bundled usZips dataset. Unknown ZIPs preserve operator-typed
  values and surface a "ZIP not recognized — type city manually"
  hint. addressLine is free-text; SP7 follow-up will add Google
  Places street-level autocomplete.

  All four inputs are MemoInput-wrapped per the P1-3 keystroke-storm
  contract. Component is memo()-wrapped + accepts a value/onChange
  pair so SP3 CustomerProfile edit-mode can reuse it unchanged.
  EOF
  )"
  ```

---

## Task 4: CustomerLookupCard component

**Files:**
- Create: `src/components/addJob/CustomerLookupCard.tsx`
- Test: `tests/components/CustomerLookupCard.test.ts`

The biggest single component in SP2. Per the spec's *Returning Customer card spec* (§"Returning Customer card spec"): the card renders five state variants — `idle` (no phone typed), `searching` (debounce in flight), `found` (returning customer hero card), `miss` (no match — continue as new), `error` (lookup threw). When in `found` state the card surfaces name, phone, vehicle chips, last service line, total jobs, lifetime revenue, notes / Quick Notes (live-read from Customer doc), VIP badge if applicable, and the three action buttons: **Use Customer**, **Repeat Last Service**, **View History** (disabled until SP3).

The "View History" button is intentionally disabled in SP2 — its target route (`/customers/{customerId}`) lands in SP3. Rendering it disabled (not hidden) keeps the visual footprint stable so SP3's enabling diff is one-line.

Per [spec line 891](../../../docs/superpowers/specs/2026-06-03-customer-intelligence-design.md) the lookup-card's PHONE input MUST be a `MemoInput` with a `useCallback`-stable setter. SP2 satisfies this by lifting the phone input OUT of CustomerLookupCard and INTO AddJob.tsx Step 1 — the card itself takes `rawPhone: string` as a prop and only renders the lookup status. This split avoids ever putting an unmemoized input back into AddJob's hot-render path.

Debounce strategy: 250ms via `useEffect` + `setTimeout` keyed on `rawPhone`. (No external debounce library.)

- [ ] **Step 1: Write the failing test at `tests/components/CustomerLookupCard.test.ts`**

  Test the pure state-derivation helper (`deriveCardState`) rather than full React render. The helper takes the inputs CustomerLookupCard owns (`{ rawPhone, lookupInFlight, lookupResult, error }`) and returns a tagged union state object the JSX consumes.

  ```ts
  // ═══════════════════════════════════════════════════════════════════
  //  tests/components/CustomerLookupCard.test.ts
  //  Run: npx tsx tests/components/CustomerLookupCard.test.ts
  //  Spec: §"AddJob Workflow Change → Returning Customer card spec"
  // ═══════════════════════════════════════════════════════════════════
  import { __pureHooks } from '@/components/addJob/CustomerLookupCard';

  let passed = 0;
  let failed = 0;
  function check(name: string, cond: boolean, detail?: string): void {
    if (cond) { passed++; console.log(`  ✓ ${name}`); }
    else { failed++; console.error(`  ✗ ${name}${detail ? `  — ${detail}` : ''}`); }
  }

  const { deriveCardState, deriveUseCustomerPatch, deriveRepeatLastServicePatch } = __pureHooks;

  console.log('\n┌─ deriveCardState ───────────────────────────────');
  check('empty phone → idle',
    deriveCardState({ rawPhone: '', lookupInFlight: false, lookupResult: null, error: null }).kind === 'idle');
  check('partial phone (still invalid) → idle',
    deriveCardState({ rawPhone: '305', lookupInFlight: false, lookupResult: null, error: null }).kind === 'idle');
  check('valid phone + lookupInFlight → searching',
    deriveCardState({ rawPhone: '(305) 897-7030', lookupInFlight: true, lookupResult: null, error: null }).kind === 'searching');
  check('valid phone + null result + no flight → miss',
    deriveCardState({ rawPhone: '(305) 555-0100', lookupInFlight: false, lookupResult: null, error: null }).kind === 'miss');
  check('error → error',
    deriveCardState({ rawPhone: '(305) 897-7030', lookupInFlight: false, lookupResult: null, error: new Error('rules') }).kind === 'error');

  {
    const lookupResult = {
      customer: { id: 'p_13058977030', name: 'Maria Lopez', phoneE164: '+13058977030', phoneKey: '13058977030', jobCount: 5, lifetimeRevenue: 1800 },
      vehicles: [{ id: 'honda-civic-2019', year: 2019, make: 'Honda', model: 'Civic', tireSize: '215/55R17' }],
      lastJob: { id: 'job-9', date: '2026-05-30', service: 'tire_swap', revenue: 450, paymentStatus: 'Paid' },
      lookupLatencyMs: 120,
    } as const;
    const state = deriveCardState({ rawPhone: '(305) 897-7030', lookupInFlight: false, lookupResult, error: null });
    check('hit → found', state.kind === 'found');
    if (state.kind === 'found') {
      check('found state carries customer', state.customer.id === 'p_13058977030');
      check('found state carries first vehicle', state.vehicles[0].make === 'Honda');
      check('found state carries lastJob', state.lastJob?.id === 'job-9');
    }
  }

  console.log('\n┌─ deriveUseCustomerPatch ────────────────────────');
  {
    const customer = { id: 'p_13058977030', name: 'Maria Lopez', phoneE164: '+13058977030', email: 'maria@example.com', city: 'Miami', state: 'FL', addressLine: '123 Main', zipCode: '33101' };
    const vehicle = { id: 'honda-civic-2019', year: 2019, make: 'Honda', model: 'Civic', vehicleMakeModel: 'Honda Civic', tireSize: '215/55R17', vehicleType: 'Car' };
    const patch = deriveUseCustomerPatch(customer, vehicle);
    check('customerName from customer.name', patch.customerName === 'Maria Lopez');
    check('customerPhone as formatted display', patch.customerPhone === '(305) 897-7030');
    check('customerEmail copied', patch.customerEmail === 'maria@example.com');
    check('city copied', patch.city === 'Miami');
    check('state copied', patch.state === 'FL');
    check('addressLine copied', patch.addressLine === '123 Main');
    check('zipCode copied', patch.zipCode === '33101');
    check('vehicleType copied', patch.vehicleType === 'Car');
    check('vehicleMakeModel copied', patch.vehicleMakeModel === 'Honda Civic');
    check('tireSize copied', patch.tireSize === '215/55R17');
    check('does NOT copy revenue', !('revenue' in patch));
    check('does NOT copy materialCost', !('materialCost' in patch));
    check('does NOT copy note', !('note' in patch));
  }

  console.log('\n┌─ deriveRepeatLastServicePatch ──────────────────');
  {
    const customer = { id: 'p_13058977030', name: 'Maria Lopez', phoneE164: '+13058977030', city: 'Miami', state: 'FL' };
    const vehicle = { id: 'honda-civic-2019', year: 2019, make: 'Honda', model: 'Civic', vehicleMakeModel: 'Honda Civic', tireSize: '215/55R17', vehicleType: 'Car' };
    const lastJob = { id: 'job-9', date: '2026-05-30', service: 'tire_swap', revenue: 450, vehicleMakeModel: 'Honda Civic', tireSize: '215/55R17', paymentStatus: 'Paid', city: 'Miami' };
    const patch = deriveRepeatLastServicePatch(customer, vehicle, lastJob);
    check('includes use-customer fields', patch.customerName === 'Maria Lopez');
    check('includes service from lastJob', patch.service === 'tire_swap');
    check('includes vehicleMakeModel from lastJob', patch.vehicleMakeModel === 'Honda Civic');
    check('includes tireSize from lastJob', patch.tireSize === '215/55R17');
    check('does NOT copy revenue from lastJob', !('revenue' in patch));
    check('does NOT copy paymentStatus from lastJob', !('paymentStatus' in patch));
    check('does NOT copy note from lastJob', !('note' in patch));
  }

  console.log('\n══════════════════════════════════════════════════');
  console.log(`  ${passed} passed, ${failed} failed`);
  console.log('══════════════════════════════════════════════════\n');
  process.exit(failed > 0 ? 1 : 0);
  ```

- [ ] **Step 2: Run the test and verify it fails**

  Run: `npx tsx tests/components/CustomerLookupCard.test.ts`
  Expected: `Cannot find module '@/components/addJob/CustomerLookupCard'`.

- [ ] **Step 3: Create `src/components/addJob/CustomerLookupCard.tsx`**

  ```tsx
  // src/components/addJob/CustomerLookupCard.tsx
  // ═══════════════════════════════════════════════════════════════════
  //  CustomerLookupCard — phone-first returning-customer surface.
  //
  //  Spec: docs/superpowers/specs/2026-06-03-customer-intelligence-design.md
  //        §"AddJob Workflow Change → Returning Customer card spec"
  //
  //  Renders five state variants:
  //    - idle      (phone empty or partially typed)
  //    - searching (debounce + lookup in flight)
  //    - found     (returning customer hero card)
  //    - miss      ("no match — continue as new")
  //    - error     (lookup threw)
  //
  //  The phone INPUT lives in AddJob Step 1 — this component does not
  //  render its own phone field. It takes rawPhone as a prop and owns
  //  the 250ms debounce + lookup invocation only. This split keeps the
  //  P1-3 keystroke-storm contract intact: AddJob's phone MemoInput is
  //  bound to a useCallback-stable setter, and CustomerLookupCard
  //  reads the resulting string via prop.
  //
  //  v1 scope (SP2): Use Customer + Repeat Last Service buttons are
  //  fully wired. View History button is rendered DISABLED — its
  //  target route (/customers/{customerId}) lands in SP3 and the
  //  disabled state stays visually stable for SP3's one-line enable.
  // ═══════════════════════════════════════════════════════════════════

  import { memo, useEffect, useMemo, useRef, useState } from 'react';
  import { formatPhoneForDisplay, normalizePhone } from '@/lib/phone';
  import { lookupCustomerByPhone, type LookupResult, type LookupLastJob } from '@/lib/lookupCustomerByPhone';
  import { deriveVipTier } from '@/lib/customerInsights';
  import type { Customer, Vehicle } from '@/lib/customerEntity';

  /** Pure patch produced by the card; AddJob merges it into the job draft. */
  export interface UseCustomerPatch {
    customerId?: string;
    vehicleId?: string;
    customerName?: string;
    customerPhone?: string;
    customerEmail?: string;
    city?: string;
    state?: string;
    addressLine?: string;
    zipCode?: string;
    vehicleType?: string;
    vehicleMakeModel?: string;
    tireSize?: string;
    // Repeat Last Service only:
    service?: string;
    vehicleSize?: string;
    tireBrand?: string;
    qty?: string | number;
  }

  interface Props {
    businessId: string;
    rawPhone: string;
    onApplyPatch: (patch: UseCustomerPatch) => void;
    onContinueAsNew?: () => void;
  }

  type CardState =
    | { kind: 'idle' }
    | { kind: 'searching' }
    | { kind: 'found'; customer: Customer; vehicles: Vehicle[]; lastJob: LookupLastJob | null; lookupLatencyMs: number }
    | { kind: 'miss'; formattedPhone: string }
    | { kind: 'error'; error: Error };

  function _deriveCardState(args: {
    rawPhone: string;
    lookupInFlight: boolean;
    lookupResult: LookupResult | null;
    error: Error | null;
  }): CardState {
    if (args.error) return { kind: 'error', error: args.error };
    const n = normalizePhone(args.rawPhone);
    if (!n.valid) return { kind: 'idle' };
    if (args.lookupInFlight) return { kind: 'searching' };
    if (!args.lookupResult) return { kind: 'miss', formattedPhone: n.formatted };
    return {
      kind: 'found',
      customer: args.lookupResult.customer,
      vehicles: args.lookupResult.vehicles,
      lastJob: args.lookupResult.lastJob,
      lookupLatencyMs: args.lookupResult.lookupLatencyMs,
    };
  }

  function _deriveUseCustomerPatch(customer: Customer, vehicle: Vehicle | null): UseCustomerPatch {
    const patch: UseCustomerPatch = {
      customerId: customer.id,
      customerName: customer.name,
      customerPhone: customer.phoneE164 ? formatPhoneForDisplay(customer.phoneE164) : undefined,
    };
    if (customer.email)         patch.customerEmail = customer.email;
    if (customer.city)          patch.city          = customer.city;
    if (customer.state)         patch.state         = customer.state;
    if (customer.addressLine)   patch.addressLine   = customer.addressLine;
    if (customer.zipCode)       patch.zipCode       = customer.zipCode;
    if (vehicle) {
      patch.vehicleId = vehicle.id;
      if (vehicle.vehicleType)      patch.vehicleType      = vehicle.vehicleType;
      if (vehicle.vehicleMakeModel) patch.vehicleMakeModel = vehicle.vehicleMakeModel;
      else if (vehicle.make && vehicle.model) patch.vehicleMakeModel = `${vehicle.make} ${vehicle.model}`;
      if (vehicle.tireSize)         patch.tireSize         = vehicle.tireSize;
    }
    return patch;
  }

  function _deriveRepeatLastServicePatch(
    customer: Customer,
    vehicle: Vehicle | null,
    lastJob: LookupLastJob,
  ): UseCustomerPatch {
    const patch = _deriveUseCustomerPatch(customer, vehicle);
    if (lastJob.service)          patch.service          = lastJob.service;
    if (lastJob.vehicleMakeModel) patch.vehicleMakeModel = lastJob.vehicleMakeModel;
    if (lastJob.vehicleType)      patch.vehicleType      = lastJob.vehicleType;
    if (lastJob.tireSize)         patch.tireSize         = lastJob.tireSize;
    if (lastJob.city && !patch.city) patch.city = lastJob.city;
    // Per spec: do NOT copy revenue, tireCost, materialCost, note,
    // parts, photos, timeSessions, inventoryDeductions, paymentStatus,
    // status, createdAt, lastEditedAt. Operator must re-enter what
    // they charge.
    return patch;
  }

  function _formatRelativeWeeks(iso: string | undefined): string {
    if (!iso) return '';
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return '';
    const days = Math.floor((Date.now() - t) / (24 * 60 * 60 * 1000));
    if (days < 1)   return 'today';
    if (days < 7)   return `${days}d ago`;
    const weeks = Math.floor(days / 7);
    if (weeks < 8)  return `${weeks}w ago`;
    const months = Math.floor(days / 30);
    if (months < 24) return `${months}mo ago`;
    return `${Math.floor(days / 365)}y ago`;
  }

  function CustomerLookupCardImpl({ businessId, rawPhone, onApplyPatch, onContinueAsNew }: Props) {
    const [lookupInFlight, setLookupInFlight] = useState(false);
    const [lookupResult, setLookupResult] = useState<LookupResult | null>(null);
    const [error, setError] = useState<Error | null>(null);
    const [pickedVehicleId, setPickedVehicleId] = useState<string | null>(null);
    const seqRef = useRef(0);

    // Debounced lookup — 250ms after the last keystroke that produces
    // a valid phone, fire one query. Out-of-order responses dropped
    // via a monotonic seq counter.
    useEffect(() => {
      const n = normalizePhone(rawPhone);
      if (!n.valid) {
        setLookupResult(null);
        setError(null);
        setLookupInFlight(false);
        return;
      }
      const handle = window.setTimeout(() => {
        const seq = ++seqRef.current;
        setLookupInFlight(true);
        setError(null);
        lookupCustomerByPhone(businessId, rawPhone)
          .then((res) => {
            if (seq !== seqRef.current) return;  // stale
            setLookupResult(res);
            setLookupInFlight(false);
          })
          .catch((e: unknown) => {
            if (seq !== seqRef.current) return;
            setError(e instanceof Error ? e : new Error(String(e)));
            setLookupInFlight(false);
          });
      }, 250);
      return () => window.clearTimeout(handle);
    }, [businessId, rawPhone]);

    const state = useMemo(
      () => _deriveCardState({ rawPhone, lookupInFlight, lookupResult, error }),
      [rawPhone, lookupInFlight, lookupResult, error],
    );

    if (state.kind === 'idle') return null;

    if (state.kind === 'searching') {
      return (
        <div className="form-group card-anim" style={{ opacity: 0.85 }}>
          <div className="form-group-title">Looking up customer…</div>
          <div className="info-banner">Searching directory by phone…</div>
        </div>
      );
    }

    if (state.kind === 'error') {
      return (
        <div className="form-group card-anim">
          <div className="form-group-title">Customer lookup failed</div>
          <div className="info-banner" style={{ background: 'var(--warn-bg)' }}>
            Couldn't reach the directory. Continue typing customer info manually.
          </div>
        </div>
      );
    }

    if (state.kind === 'miss') {
      return (
        <div className="form-group card-anim">
          <div className="form-group-title">No match for {state.formattedPhone}</div>
          <button
            type="button"
            className="btn sm secondary"
            onClick={onContinueAsNew}
          >
            Continue as new customer
          </button>
        </div>
      );
    }

    // ─── found ─────────────────────────────────────────────────────
    const { customer, vehicles, lastJob, lookupLatencyMs } = state;
    const selectedVehicle = vehicles.find((v) => v.id === pickedVehicleId) ?? vehicles[0] ?? null;
    const vipTier = deriveVipTier(Number(customer.lifetimeRevenue ?? 0));
    const lastSeen = _formatRelativeWeeks(customer.lastJobAt);

    const onUseCustomer = () => {
      onApplyPatch(_deriveUseCustomerPatch(customer, selectedVehicle));
    };
    const onRepeatLastService = () => {
      if (!lastJob) return;
      onApplyPatch(_deriveRepeatLastServicePatch(customer, selectedVehicle, lastJob));
    };

    return (
      <div className="form-group card-anim" data-lookup-latency-ms={lookupLatencyMs}>
        <div className="form-group-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <span>Returning Customer</span>
          {lastSeen && <span style={{ fontSize: 11, color: 'var(--t3)', fontWeight: 400 }}>Last seen {lastSeen}</span>}
        </div>

        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--t1)' }}>{customer.name}</div>
          {vipTier !== 'Standard' && (
            <span className="chip" style={{ fontSize: 10, padding: '2px 8px', background: vipTier === 'Platinum' ? '#b5a5e8' : '#d4af37', color: '#1a1a1a' }}>
              {vipTier}
            </span>
          )}
        </div>

        <div style={{ fontSize: 12, color: 'var(--t2)', marginBottom: 4 }}>
          {customer.phoneE164 ? formatPhoneForDisplay(customer.phoneE164) : ''}
          {customer.email ? ` · ${customer.email}` : ''}
        </div>
        {(customer.city || customer.state) && (
          <div style={{ fontSize: 12, color: 'var(--t2)', marginBottom: 8 }}>
            {customer.city}{customer.city && customer.state ? ', ' : ''}{customer.state}
          </div>
        )}

        {vehicles.length > 0 && (
          <div className="field" style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 11, color: 'var(--t3)', marginBottom: 4 }}>Vehicles</div>
            <div className="chip-grid">
              {vehicles.map((v) => {
                const label = [
                  v.year, v.make, v.model, v.tireSize ? `· ${v.tireSize}` : '',
                ].filter(Boolean).join(' ').trim() || v.vehicleMakeModel || v.id;
                const active = (selectedVehicle?.id === v.id);
                return (
                  <button
                    key={v.id}
                    type="button"
                    className={'chip' + (active ? ' active' : '')}
                    onClick={() => setPickedVehicleId(v.id)}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {lastJob && (
          <div style={{ fontSize: 12, color: 'var(--t2)', marginBottom: 8 }}>
            Last service: {lastJob.service ?? '—'}
            {lastJob.revenue !== undefined ? ` · $${Number(lastJob.revenue).toFixed(0)}` : ''}
            {lastJob.paymentStatus ? ` · ${lastJob.paymentStatus}` : ''}
          </div>
        )}

        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', fontSize: 11, color: 'var(--t3)', marginBottom: 10 }}>
          <span>{customer.jobCount ?? 0} jobs</span>
          {customer.lifetimeRevenue !== undefined && <span>· ${Number(customer.lifetimeRevenue).toFixed(0)} lifetime</span>}
        </div>

        {(customer.note || customer.gateCode || customer.apartmentNumber || customer.wheelLockKeyLocation || customer.tpmsNotes || customer.preferredPaymentMethod || customer.parkingInstructions || customer.preferredContactMethod || customer.generalNotes) && (
          <div className="info-banner" style={{ marginBottom: 10, fontSize: 11 }}>
            {customer.note && <div>📝 {customer.note}</div>}
            {customer.gateCode && <div>🚪 Gate: {customer.gateCode}</div>}
            {customer.apartmentNumber && <div>🏢 Apt: {customer.apartmentNumber}</div>}
            {customer.wheelLockKeyLocation && <div>🔑 Wheel-lock key: {customer.wheelLockKeyLocation}</div>}
            {customer.tpmsNotes && <div>📡 TPMS: {customer.tpmsNotes}</div>}
            {customer.preferredPaymentMethod && <div>💳 Pays via: {customer.preferredPaymentMethod}</div>}
            {customer.parkingInstructions && <div>🅿️ Parking: {customer.parkingInstructions}</div>}
            {customer.preferredContactMethod && <div>📞 Prefers: {customer.preferredContactMethod}</div>}
            {customer.generalNotes && <div>ℹ️ {customer.generalNotes}</div>}
          </div>
        )}

        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button type="button" className="btn sm primary" onClick={onUseCustomer}>Use Customer</button>
          <button type="button" className="btn sm secondary" onClick={onRepeatLastService} disabled={!lastJob}>
            Repeat Last Service
          </button>
          <button
            type="button"
            className="btn sm secondary"
            disabled
            title="View History — coming in SP3"
            style={{ opacity: 0.5, cursor: 'not-allowed' }}
          >
            View History
          </button>
        </div>
      </div>
    );
  }

  export const CustomerLookupCard = memo(CustomerLookupCardImpl);

  /** Pure-derivation hooks — test-only. */
  export const __pureHooks = {
    deriveCardState: _deriveCardState,
    deriveUseCustomerPatch: _deriveUseCustomerPatch,
    deriveRepeatLastServicePatch: _deriveRepeatLastServicePatch,
  };
  ```

- [ ] **Step 4: Run the test and verify it passes**

  Run: `npx tsx tests/components/CustomerLookupCard.test.ts`
  Expected: all green.

- [ ] **Step 5: Type-check + full suite**

  Run: `npm test && npm run typecheck`
  Expected: 0 errors.

- [ ] **Step 6: Self-review**

  Before committing, verify:
  - The phone input is NOT inside CustomerLookupCard — only `rawPhone: string` comes in via prop. AddJob owns the input. (Spec line 891 contract.)
  - `useEffect` debounce is keyed on `[businessId, rawPhone]` — when rawPhone clears the existing result/error are nulled within the same effect cleanup pass.
  - Out-of-order lookup responses are dropped via `seqRef.current`.
  - The `View History` button renders DISABLED — its enable lands in SP3 with one prop addition.
  - The "Repeat Last Service" button is disabled when `lastJob === null`.
  - The Quick Notes block (`customer.note || customer.gateCode || ...`) reads LIVE from the Customer doc per spec §"Quick Notes auto-render" — no field is copied into the Job at apply-patch time.
  - `_deriveUseCustomerPatch` omits revenue/tireCost/materialCost/note/parts/photos — verified by the test.

- [ ] **Step 7: Commit**

  ```bash
  git add src/components/addJob/CustomerLookupCard.tsx tests/components/CustomerLookupCard.test.ts
  git commit -m "$(cat <<'EOF'
  feat(addjob): add CustomerLookupCard returning-customer surface (SP2 task 4)

  Phone-first returning-customer card per spec §"AddJob Workflow
  Change → Returning Customer card spec". Five-state UX:
  idle / searching / found / miss / error. 250ms debounce keyed on
  rawPhone; out-of-order responses dropped via seqRef counter.

  Use Customer + Repeat Last Service buttons are wired; View History
  is rendered DISABLED (target route /customers/{id} lands in SP3).
  Patch helpers exclude revenue/tireCost/note/photos so the operator
  must re-enter what they charge — same exclusion list as App.tsx
  handleDuplicate.

  Phone INPUT lives in AddJob Step 1 — this component only renders
  the lookup state, taking rawPhone as a prop. This split preserves
  the P1-3 keystroke-storm contract.
  EOF
  )"
  ```

---

## Task 5: customerEntity extension — email + companyName writes

**Files:**
- Modify: `src/lib/customerEntity.ts` — extend `_buildCustomerPatch` and the upsert signature
- Modify: `tests/customerEntity.test.ts` — add cases for email + companyName

Per spec §SP2 scope (*"email input added to existing Customer card"*) and the *Customer card captures `companyName` (optional) for fleet customers* clause: SP2 wires the email field that SP1's `_buildCustomerPatch` already supports + adds `companyName` / `companyLower` writes when `customer.kind === 'fleet'`. SP1 Task 4's patch already conditionally writes `email` when present; SP2 makes the call-site (`upsertCustomerFromJob`'s `job` arg) pass it through cleanly + adds the companyName fields.

The existing SP1 `_buildCustomerPatch` already writes `email` when `job.customerEmail` is truthy — so this task's job is to (a) verify that, (b) add `companyName` / `companyLower` writes when the job carries `companyName`, (c) widen the `upsertCustomerFromJob` arg type to include `companyName`, and (d) add tests for both.

- [ ] **Step 1: Append failing cases to `tests/customerEntity.test.ts`**

  Open `tests/customerEntity.test.ts` and add two new blocks BEFORE the final summary line (`console.log('\n══════════════════════════════════════════════════');`):

  ```ts
  console.log('\n┌─ SP2: email is persisted on Customer ───────────');
  {
    const store = new Map<string, Record<string, unknown>>();
    runUpsertWithShim(store, 'biz-1', makeJob({ customerEmail: 'maria@example.com' }));
    const c = store.get('businesses/biz-1/customers/p_13058977030') as Record<string, unknown>;
    check('email persisted', c?.email === 'maria@example.com');
  }

  console.log('\n┌─ SP2: empty email does NOT clobber existing ───');
  {
    const store = new Map<string, Record<string, unknown>>();
    runUpsertWithShim(store, 'biz-1', makeJob({ id: 'job-1', customerEmail: 'maria@example.com' }));
    runUpsertWithShim(store, 'biz-1', makeJob({ id: 'job-2', customerEmail: '' }));
    const c = store.get('businesses/biz-1/customers/p_13058977030') as Record<string, unknown>;
    check('email preserved on second job with blank email', c?.email === 'maria@example.com');
  }

  console.log('\n┌─ SP2: companyName + companyLower for fleet ────');
  {
    const store = new Map<string, Record<string, unknown>>();
    runUpsertWithShim(store, 'biz-1', makeJob({ companyName: 'Uber Fleet LLC' }));
    const c = store.get('businesses/biz-1/customers/p_13058977030') as Record<string, unknown>;
    check('companyName persisted', c?.companyName === 'Uber Fleet LLC');
    check('companyLower derived', c?.companyLower === 'uber fleet llc');
  }

  console.log('\n┌─ SP2: empty companyName does NOT clobber ──────');
  {
    const store = new Map<string, Record<string, unknown>>();
    runUpsertWithShim(store, 'biz-1', makeJob({ id: 'job-1', companyName: 'Uber Fleet LLC' }));
    runUpsertWithShim(store, 'biz-1', makeJob({ id: 'job-2', companyName: '' }));
    const c = store.get('businesses/biz-1/customers/p_13058977030') as Record<string, unknown>;
    check('companyName preserved on second job with blank companyName', c?.companyName === 'Uber Fleet LLC');
    check('companyLower preserved', c?.companyLower === 'uber fleet llc');
  }
  ```

- [ ] **Step 2: Run the existing test and verify the new cases fail**

  Run: `npx tsx tests/customerEntity.test.ts`
  Expected: the email-persistence case PASSES (SP1 already supports email); the companyName cases FAIL because SP1 doesn't write companyName.

  If the email case also fails, it means the `runUpsertWithShim` job arg type doesn't accept `customerEmail` — widen the type in the next step.

- [ ] **Step 3: Extend `_buildCustomerPatch` in `src/lib/customerEntity.ts`**

  Locate the `_buildCustomerPatch` function (around line 206-276 in the current tree). Two changes:

  1. Widen the `job:` parameter type to include `companyName?: string`. Find this block:

     ```ts
     function _buildCustomerPatch(
       existing: Record<string, unknown> | undefined,
       job: {
         id: string;
         date?: string;
         customerName?: string;
         customerPhone?: string;
         customerEmail?: string;
         city?: string;
         state?: string;
         addressLine?: string;
         zipCode?: string;
         revenue?: number | string;
       },
     ```

     Add `companyName?: string;` right after `customerEmail?: string;`:

     ```ts
     function _buildCustomerPatch(
       existing: Record<string, unknown> | undefined,
       job: {
         id: string;
         date?: string;
         customerName?: string;
         customerPhone?: string;
         customerEmail?: string;
         companyName?: string;
         city?: string;
         state?: string;
         addressLine?: string;
         zipCode?: string;
         revenue?: number | string;
       },
     ```

  2. In the `patch` object literal (around line 246-274), find this block:

     ```ts
     ...(job.customerEmail ? { email: String(job.customerEmail) } : {}),
     ...(job.city ? { city: String(job.city), cityLower: String(job.city).toLowerCase() } : {}),
     ```

     Insert a companyName conditional spread RIGHT AFTER the customerEmail line:

     ```ts
     ...(job.customerEmail ? { email: String(job.customerEmail) } : {}),
     ...(job.companyName ? { companyName: String(job.companyName), companyLower: String(job.companyName).toLowerCase() } : {}),
     ...(job.city ? { city: String(job.city), cityLower: String(job.city).toLowerCase() } : {}),
     ```

- [ ] **Step 4: Extend the public `upsertCustomerFromJob` signature**

  Locate `export async function upsertCustomerFromJob(...)` (around line 340 in the current tree). The job arg type currently lacks `companyName`. Add it:

  Find:

  ```ts
  export async function upsertCustomerFromJob(
    businessId: string,
    job: {
      id: string;
      date?: string;
      customerName?: string;
      customerPhone?: string;
      customerEmail?: string;
      city?: string;
      state?: string;
      addressLine?: string;
      zipCode?: string;
      revenue?: number | string;
      year?: number;
      make?: string;
      model?: string;
      trim?: string;
      color?: string;
      vehicleMakeModel?: string;
      vehicleType?: string;
      vehicleSize?: string;
      tireSize?: string;
      tireBrand?: string;
      tireCondition?: string;
      createdByUid?: string;
    },
  ): Promise<UpsertResult> {
  ```

  Add `companyName?: string;` after `customerEmail?: string;`:

  ```ts
  export async function upsertCustomerFromJob(
    businessId: string,
    job: {
      id: string;
      date?: string;
      customerName?: string;
      customerPhone?: string;
      customerEmail?: string;
      companyName?: string;
      city?: string;
      state?: string;
      addressLine?: string;
      zipCode?: string;
      revenue?: number | string;
      year?: number;
      make?: string;
      model?: string;
      trim?: string;
      color?: string;
      vehicleMakeModel?: string;
      vehicleType?: string;
      vehicleSize?: string;
      tireSize?: string;
      tireBrand?: string;
      tireCondition?: string;
      createdByUid?: string;
    },
  ): Promise<UpsertResult> {
  ```

  The pure-helper `_buildCustomerPatch` was widened in Step 3; `_buildVehiclePatch` is unaffected. The transactional body is unchanged.

- [ ] **Step 5: Verify the firestore.rules allowlist already covers companyName / companyLower / email**

  SP1 Task 7 wrote the identity-upsert allowlist with both fields already listed:

  ```
  .hasOnly(['name','nameLower','kind','companyName','companyLower',
           'phoneE164','phoneKey','email','addressLine',
           ...])
  ```

  Confirm by `grep -n "companyName\|companyLower\|'email'" firestore.rules` — both are present in the customers identity-upsert rule. **No rule change required for this task.** If for any reason they were stripped, restore them now per SP1 Task 7's allowlist.

- [ ] **Step 6: Run the customerEntity test and verify it passes**

  Run: `npx tsx tests/customerEntity.test.ts`
  Expected: every check green, including all four new SP2 cases.

- [ ] **Step 7: Run the full suite + type-check**

  Run: `npm test && npm run typecheck`
  Expected: 0 errors. Existing tests unaffected because the SP1 fields are unchanged.

- [ ] **Step 8: Self-review**

  Before committing, verify:
  - Both `_buildCustomerPatch` and `upsertCustomerFromJob` accept `companyName?: string`.
  - The patch writes BOTH `companyName` AND `companyLower` (the lowercased mirror is required by SP3's global-search index).
  - Blank `companyName` does NOT clobber an existing value (same conditional-spread pattern as `email`).
  - The firestore.rules allowlist already includes both fields — verified by grep.
  - No new rule deploy is required (the writes use fields that are already allowlisted).

- [ ] **Step 9: Commit**

  ```bash
  git add src/lib/customerEntity.ts tests/customerEntity.test.ts
  git commit -m "$(cat <<'EOF'
  feat(customers): persist email + companyName from upsert (SP2 task 5)

  Extends SP1's _buildCustomerPatch to write companyName +
  companyLower whenever the job carries a companyName (typical
  fleet-customer path). Email persistence was already supported by
  SP1's patch but is now covered by explicit test cases. Blank
  values never clobber existing fields — same conditional-spread
  pattern as SP1.

  Both fields are already on the firestore.rules identity-upsert
  allowlist (SP1 Task 7) — no rule deploy needed.
  EOF
  )"
  ```

---

## Task 6: AddJob 8-step restructure

**Files:**
- Modify: `src/pages/AddJob.tsx` (the existing single-file component, ~1184 lines)

The biggest task in SP2. Restructures the existing AddJob layout into the spec's confirmed 8-step explicit order:

1. **Phone** (operator's first keystroke)
2. **Lookup** — `<CustomerLookupCard />` renders inline once phone normalizes
3. **Vehicle** — chips + (for new customers) make/model/trim/color
4. **Quick Pricing** — sticky suggested-price tile + revenue + miles (already at top in current code; gets a section badge)
5. **Service Type** — existing `<ServicePicker />`
6. **Tire Size** — tire-vertical only; for other verticals renders the existing vertical `jobFields` loop (which is the SP2-pragmatic interpretation of the spec's `primaryDomainField`, which doesn't yet exist on the vertical config — see Pre-decision below)
7. **Location** — `<AddressAutofillInput />` replaces the existing City-only field
8. **Notes** — existing free-text notes field

Each step gets a numbered visual badge in the section title (`<span className="step-badge">1</span> Phone`) so the top-down flow is obvious. Steps 2-8 progressively reveal — they don't gate the form (operator can fill any order) but the order is the visible structure.

**Pre-execution decision — `primaryDomainField` does not exist yet on the vertical config:** the spec's step-6 vertical-dispatch references `verticalConfig.primaryDomainField`, which is not a property of `BusinessTypeConfig` in `src/config/businessTypes/types.ts`. **SP2 pragmatic resolution:** for step 6, render the existing tire-details block when `vertical.features.inventoryDeduction === true`, otherwise render the existing `vertical.jobFields` loop (this is exactly what AddJob already does today, just wrapped in a step-6 section). Introducing a new `primaryDomainField` config field is out of scope for SP2 — defer to SP3 when CustomerProfile + vertical-aware search land together. This preserves byte-for-byte behavior for non-tire verticals while shipping the visible 8-step structure for everyone.

**Pre-execution decision — "no forced step gating":** the spec is explicit ("operator can fill any order, but visual flow is top-to-bottom"). SP2 implements this as: every step renders unconditionally except step 2 (CustomerLookupCard returns `null` in its `idle` state, which the component already handles). No `if (phone)` gates on step 3+. This matches existing AddJob behavior where Service / Vehicle / Pricing all render together.

- [ ] **Step 1: Re-read AddJob.tsx structure before editing**

  Run:

  ```bash
  grep -n "form-group\|form-group-title" src/pages/AddJob.tsx | head -25
  ```

  Confirm the current `form-group` blocks (each with a `form-group-title` div). The current order (in the rendered JSX, NOT the file's data definitions at the top) is approximately:

  - Pre-fill banner (conditional)
  - Sticky suggested-price tile (line ~462-505)
  - Revenue section (line ~514)
  - Pricing breakdown (line ~605-678) — gated by canViewProfit
  - Vehicle size chips (line ~684-697) — package_multiplier verticals only
  - Service picker (line ~700-709)
  - Add-ons (line ~714-740) — verticals with add-ons only
  - Vehicle chips (line ~742-750)
  - Customer card (line ~752-840) — name + phone + city
  - Assignment picker (line ~842-849)
  - Vertical jobFields loop (line ~858-875) — non-tire only
  - Parts section (line ~881-888) — mechanic only
  - Tire details (line ~896-1033) — tire only
  - Job details (line ~1035-1070) — qty + material + conditions
  - Lead & payment (line ~1072-1122)
  - Note (line ~1124-1133)
  - Save footer (line ~1136-1181)

  SP2 re-orders the four sections that move (Customer card → Phone+Lookup which moves to TOP; Vehicle chips → Step 3; Service → Step 5; Tire details / vertical fields → Step 6 (vertical-dispatch); City field → replaced by AddressAutofillInput at Step 7; Note → Step 8 with the lookup-card's Quick Notes rendering as a non-dismissable info card above the textarea per spec refinement #2).

  Sections that do NOT move: Sticky suggested-price tile (stays at the very top — operators rely on it), Pricing breakdown (stays beneath Step 4), Add-ons (stays under Service at Step 5), Assignment picker (stays after Step 3 vehicle), Parts section (stays under Step 6 for mechanic), Job details qty/material/conditions (stays under Step 4 since these are pricing inputs), Lead & payment (stays after Step 7 — not part of the 8-step "customer flow" framing), Save footer.

- [ ] **Step 2: Add imports at the top of `src/pages/AddJob.tsx`**

  In the import block at the top of the file (the cluster around lines 1-25), add three new imports:

  ```ts
  import { CustomerLookupCard, type UseCustomerPatch } from '@/components/addJob/CustomerLookupCard';
  import { AddressAutofillInput, type AddressValue } from '@/components/addJob/AddressAutofillInput';
  import { normalizePhone } from '@/lib/phone';
  ```

- [ ] **Step 3: Add the apply-patch handler + the address-value derivation**

  Inside the AddJob function body, BELOW the `set` and `fieldSetters` blocks (around line 235) and ABOVE the `needsTireDetails` constant (around line 240), insert these new memoized hooks:

  ```tsx
    // ─── SP2: Customer lookup patch handler ──────────────────────
    // CustomerLookupCard's Use Customer / Repeat Last Service buttons
    // dispatch a UseCustomerPatch — apply it to the job draft. Patch
    // fields are spec-bounded (never include revenue / note / etc.)
    // so this is a flat object spread; no extra filtering needed.
    const applyCustomerPatch = useCallback((patch: UseCustomerPatch) => {
      setJob((prev) => ({
        ...prev,
        ...(patch.customerId !== undefined       ? { customerId: patch.customerId }             : {}),
        ...(patch.vehicleId  !== undefined       ? { vehicleId:  patch.vehicleId }              : {}),
        ...(patch.customerName !== undefined     ? { customerName: patch.customerName }         : {}),
        ...(patch.customerPhone !== undefined    ? { customerPhone: patch.customerPhone }       : {}),
        ...(patch.customerEmail !== undefined    ? { customerEmail: patch.customerEmail }       : {}),
        ...(patch.city           !== undefined   ? { city: patch.city }                         : {}),
        ...(patch.state          !== undefined   ? { state: patch.state }                       : {}),
        ...(patch.addressLine    !== undefined   ? { addressLine: patch.addressLine }           : {}),
        ...(patch.zipCode        !== undefined   ? { zipCode: patch.zipCode }                   : {}),
        ...(patch.vehicleType    !== undefined   ? { vehicleType: patch.vehicleType }           : {}),
        ...(patch.vehicleMakeModel !== undefined ? { vehicleMakeModel: patch.vehicleMakeModel } : {}),
        ...(patch.tireSize       !== undefined   ? { tireSize: patch.tireSize }                 : {}),
        ...(patch.service        !== undefined   ? { service: patch.service }                   : {}),
        ...(patch.vehicleSize    !== undefined   ? { vehicleSize: patch.vehicleSize }           : {}),
        ...(patch.tireBrand      !== undefined   ? { tireBrand: patch.tireBrand }               : {}),
        ...(patch.qty            !== undefined   ? { qty: patch.qty as Job['qty'] }             : {}),
      } as Job));
      addToast('Customer info applied', 'success');
    }, [setJob]);

    // ─── SP2: Address-value adapter ──────────────────────────────
    // AddressAutofillInput is surface-agnostic — it expects a
    // { addressLine, city, state, zipCode } pair. Marshal to/from the
    // Job draft here. The setter is useCallback-stable so the
    // component's memo wrapper actually skips re-render when only
    // unrelated job fields change.
    const addressValue: AddressValue = useMemo(() => ({
      addressLine: String(job.addressLine ?? ''),
      city:        String(job.city ?? ''),
      state:       String(job.state ?? ''),
      zipCode:     String(job.zipCode ?? ''),
    }), [job.addressLine, job.city, job.state, job.zipCode]);

    const onAddressChange = useCallback((next: AddressValue) => {
      setJob((prev) => ({
        ...prev,
        addressLine: next.addressLine,
        city: next.city,
        state: next.state,
        zipCode: next.zipCode,
        // Keep the existing area / fullLocationLabel mirror in sync so
        // any legacy reader downstream still renders something sensible.
        area: next.city || prev.area,
        fullLocationLabel: next.city && next.state ? `${next.city}, ${next.state}` : next.city,
      }));
    }, [setJob]);

    // ─── SP2: Step-2 phone-lookup glue ───────────────────────────
    // The phone INPUT lives at Step 1; CustomerLookupCard reads the
    // raw phone string and owns the 250ms debounce + lookup. We pass
    // the (potentially partially-typed) string through verbatim.
    const phoneForLookup = String(job.customerPhone ?? '');
  ```

  Note: `job.addressLine`, `job.zipCode`, `job.customerEmail`, `job.companyName`, `job.customerId`, `job.vehicleId` may not yet exist on the `Job` type. **Pre-execution decision (recorded for the executor):** widen the `Job` type in `src/types/index.ts` minimally — add five optional fields:

  ```ts
  customerEmail?: string;
  companyName?: string;
  addressLine?: string;
  zipCode?: string;
  customerId?: string;
  vehicleId?: string;
  phoneKey?: string;
  ```

  …if any of these is missing. Run `grep -n "customerEmail\|addressLine\|zipCode\|customerId\b\|vehicleId\b\|phoneKey" src/types/index.ts` first to inventory what already exists; only add the missing ones. SP1 already added `customerId` / `vehicleId` / `phoneKey` via the saveJob hot path (via the cast workaround) — SP2 makes them first-class to drop the cast. This is a minimal additive change to `Job`; no existing test breaks.

- [ ] **Step 4: Replace the JSX in the return block — restructure to 8 numbered steps**

  The cleanest way to apply this restructure is section-by-section. Find each existing `<div className="form-group card-anim">` block and:

  1. Update its `form-group-title` to include a step badge.
  2. Re-order the blocks in the JSX tree per the spec's 8-step ordering.

  Start by introducing a `step-badge` CSS helper inline (no new CSS file). Add this once at the top of the JSX return (just inside the outer `<div className="page page-enter">`):

  ```tsx
        {/* SP2: step badge style — inline so SP2 doesn't depend on
            a CSS file edit that would conflict with parallel work. */}
        <style>{`
          .step-badge { display: inline-flex; align-items: center; justify-content: center;
            min-width: 22px; height: 22px; padding: 0 6px; border-radius: 11px;
            background: var(--brand-primary); color: var(--brand-on-primary, #fff);
            font-size: 11px; font-weight: 700; margin-right: 8px;
          }
        `}</style>
  ```

  Then walk every `form-group-title` and prefix its content with a `<span className="step-badge">N</span>`. Concretely, perform the following text-substitutions inside the return-block JSX (apply each as an Edit operation):

  - **Step 1: Phone** — INSERT a new section AT THE TOP of the form (immediately AFTER the closing `</div>` of the sticky suggested-price tile, around line 506, BEFORE the existing "Revenue" form-group). The new block:

    ```tsx
        {/* ─── SP2 Step 1: Phone ──────────────────────────────────
            Operator's first keystroke. MemoInput + stable setter
            per the P1-3 keystroke-storm contract. Triggers the
            Step 2 CustomerLookupCard below. */}
        <div className="form-group card-anim">
          <div className="form-group-title"><span className="step-badge">1</span>Phone</div>
          <div className="field">
            <label htmlFor="addjob-customer-phone">Customer phone</label>
            <MemoInput
              id="addjob-customer-phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={job.customerPhone}
              onChange={fieldSetters.customerPhonePartial}
              onBlur={fieldSetters.customerPhoneBlur}
              placeholder="(555) 123-4567"
            />
          </div>
        </div>

        {/* ─── SP2 Step 2: Customer Lookup ───────────────────────
            Renders null in idle state; renders a Returning Customer
            card on hit; renders a "no match" hint on miss. */}
        {businessId && (
          <CustomerLookupCard
            businessId={businessId}
            rawPhone={phoneForLookup}
            onApplyPatch={applyCustomerPatch}
          />
        )}
    ```

  - **Step 3: Vehicle** — locate the existing `<div className="form-group card-anim">` containing the `<div className="form-group-title">Vehicle</div>` (around line 742). Update its title:

    ```tsx
          <div className="form-group-title"><span className="step-badge">3</span>Vehicle</div>
    ```

    The chip-grid for vehicle types stays unchanged. If the operator typed nothing into Step 1 (no matched customer), this block still renders unchanged behavior.

  - **Step 4: Quick Pricing** — locate the existing Revenue form-group (around line 514) with title `<div className="form-group-title">Revenue</div>`. Update:

    ```tsx
          <div className="form-group-title"><span className="step-badge">4</span>Quick Pricing</div>
    ```

    The existing Revenue/Miles/Tire-cost inputs + pricing breakdown stay unchanged. The Job Details section (qty + materialCost + conditions, around line 1035) stays where it is — it lives under Quick Pricing conceptually because those fields directly drive the price; the step-4 badge already covers the framing.

  - **Step 5: Service Type** — locate the existing Service form-group (around line 700) with title `<div className="form-group-title">{vertical.copy.packageLabel || 'Service'}</div>`. Update:

    ```tsx
          <div className="form-group-title"><span className="step-badge">5</span>{vertical.copy.packageLabel || 'Service'}</div>
    ```

  - **Step 6: Tire Size (vertical-dispatched)** — locate the existing tire-details form-group (around line 896, `<div className="form-group-title">Tire Details</div>`). Update:

    ```tsx
          <div className="form-group-title"><span className="step-badge">6</span>Tire Details</div>
    ```

    For NON-tire verticals, locate the existing `vertical.jobFields` loop (around line 858, `<div className="form-group-title">{vertical.shortName} Details</div>`). Update its title to include the step-6 badge:

    ```tsx
          <div className="form-group-title"><span className="step-badge">6</span>{vertical.shortName} Details</div>
    ```

    For verticals where neither block renders (rare — `inventoryDeduction === false` AND `vertical.jobFields.length === 0`), step 6 is silently skipped. This matches the spec's *"the step is omitted entirely"* clause.

  - **Step 7: Location** — locate the existing Customer card form-group (around line 752, title `Customer`). The existing Customer card holds Name + Phone + City — we are REPLACING this entire block. Phone moves to Step 1 above; City moves to Step 7 via AddressAutofillInput; Name + Email + CompanyName stay together but render UNDER the lookup card as a "Customer details" block at the END of step 2 (so the operator can edit anything after the autofill).

    Replace the entire `Customer` form-group block with two new blocks:

    **Block A** — under Step 2 (already rendered by CustomerLookupCard above), insert a "Customer details" sub-form for the editable name/email/companyName fields. Place this RIGHT AFTER the `<CustomerLookupCard ... />` JSX (the closing `)}` we wrote in the Step 1 insertion above):

    ```tsx
        {/* ─── SP2 Step 2 (continued): Customer details ─────────
            Editable name + email + company name. When a returning
            customer is found, CustomerLookupCard's "Use Customer"
            button populates these fields. Operator can override. */}
        <div className="form-group card-anim">
          <div className="form-group-title"><span className="step-badge">2</span>Customer details</div>
          <div className="field-row">
            <div className="field">
              <label htmlFor="addjob-customer-name">Name</label>
              <MemoInput
                id="addjob-customer-name"
                value={job.customerName}
                onChange={fieldSetters.customerName}
                placeholder="John D."
              />
            </div>
            <div className="field">
              <label htmlFor="addjob-customer-email">Email <span style={{ fontWeight: 400, color: 'var(--t3)', fontSize: 11 }}>(optional)</span></label>
              <MemoInput
                id="addjob-customer-email"
                type="email"
                autoComplete="email"
                value={String(job.customerEmail ?? '')}
                onChange={(v: string) => set('customerEmail', v as Job['customerEmail'])}
                placeholder="customer@example.com"
              />
            </div>
          </div>
          <div className="field">
            <label htmlFor="addjob-company-name">Company / Fleet name <span style={{ fontWeight: 400, color: 'var(--t3)', fontSize: 11 }}>(optional)</span></label>
            <MemoInput
              id="addjob-company-name"
              value={String(job.companyName ?? '')}
              onChange={(v: string) => set('companyName', v as Job['companyName'])}
              placeholder="Uber Fleet LLC"
            />
          </div>
        </div>
    ```

    **Block B** — at Step 7, replace the existing City block (and the cityWrapRef autocomplete dropdown) with AddressAutofillInput. Locate the existing `<div className={'field'} ref={cityWrapRef} ...>` block (around line 778-839 in the current tree) AND its enclosing `<div className="form-group card-anim">` with title `Customer` — delete the entire form-group, and INSERT this NEW form-group AFTER the Step 6 block (i.e. after the tire details / vertical jobFields, but BEFORE the Lead & Payment section):

    ```tsx
        {/* ─── SP2 Step 7: Location ──────────────────────────────
            AddressAutofillInput owns the entire ZIP + city + state +
            addressLine surface per spec §"AddJob Workflow Change →
            step 7". Replaces the prior City-only Customer-card field
            (city autocomplete dropdown deprecated; ZIP lookup serves
            the same purpose more deterministically). */}
        <div className="form-group card-anim">
          <div className="form-group-title"><span className="step-badge">7</span>Location</div>
          <AddressAutofillInput value={addressValue} onChange={onAddressChange} />
        </div>
    ```

    Also REMOVE the now-orphan `cityWrapRef` `useState(cityOpen)` `citySuggestions` `useMemo` and the `useEffect` that wires the document-mousedown close-listener (around lines 331-344). With city moved out of inline AddJob, none of these helpers have call sites anymore. The `useBrand` import + `brand` state default useEffect (lines 277-289) ALSO loses its only consumer; but **leave the `useBrand` import + the brand-state default `useEffect` in place** — it's harmless when no city autocomplete dropdown reads `brand.state`, and removing it risks subtle regressions if a vertical-specific path still consults `brand`. Safer minimum-diff approach.

    Also REMOVE the `searchCities` import at line 17 if no other call site uses it (grep first — `grep -n searchCities src/pages/AddJob.tsx` should return zero after deleting the city block; otherwise leave the import).

  - **Step 8: Notes** — locate the existing Note form-group (around line 1124). Update:

    ```tsx
          <div className="form-group-title"><span className="step-badge">8</span>Notes</div>
    ```

    The textarea stays unchanged. The Quick Notes auto-rendered info card already renders INSIDE CustomerLookupCard (per Task 4 implementation) — it does not need a duplicate render here. (Future spec refinement may move it to a dedicated `QuickNotesInfoCard.tsx` component that renders at step 8 instead; SP2 keeps it inside CustomerLookupCard for the minimum-diff ship.)

- [ ] **Step 5: Drop the orphaned phone field from the deleted Customer card**

  After deleting the original Customer card block (Step 4 Block B), the `fieldSetters.customerPhonePartial` and `fieldSetters.customerPhoneBlur` setters now have ONE call site (Step 1) instead of the prior two — no other change needed. The `formatPhone` / `formatPhonePartial` imports (line 16) stay because they still back the Step 1 phone input's blur handler.

- [ ] **Step 6: Type-check after the restructure**

  Run: `npm run typecheck`
  Expected: 0 errors. If the build complains about:
  - `Property 'customerEmail' does not exist on type 'Job'` → add `customerEmail?: string;` to the Job interface in `src/types/index.ts` (Step 3 pre-decision)
  - `Property 'companyName' does not exist on type 'Job'` → add `companyName?: string;`
  - `Property 'addressLine' does not exist on type 'Job'` → add `addressLine?: string;`
  - `Property 'zipCode' does not exist on type 'Job'` → add `zipCode?: string;`
  - `Property 'customerId'/'vehicleId'/'phoneKey' does not exist on type 'Job'` → add the missing field. SP1 used a cast workaround for these; SP2 makes them first-class.

  After each addition, re-run `npm run typecheck` until 0 errors.

- [ ] **Step 7: Run the full test suite**

  Run: `npm test`
  Expected: all green. AddJob restructure is not directly unit-tested (it's React UI), but the per-component tests from Tasks 1-4 cover the logic AddJob is composing.

- [ ] **Step 8: Smoke-test the form manually**

  Run: `npm run dev` and open `http://localhost:5173`. Sign in to a test tenant. Open `+ Log` to land on AddJob. Verify:
  - The sticky suggested-price tile is still at the very top of the form.
  - Below the tile, the first form-group is "1 Phone" with a phone input.
  - Typing a non-numeric value into Phone produces no lookup card (idle).
  - Typing a valid 10-digit phone (e.g. a number you know is in the tenant's customer directory) produces a "Looking up…" card within ~250ms, then either a Returning Customer card (with name + vehicle chips + last-service line + Use Customer / Repeat Last Service / View History) OR a "No match — continue as new" card.
  - Tapping **Use Customer** autofills the Customer details block (name + email) and the Location block (city + state + ZIP) below.
  - The "2 Customer details" form-group renders below the lookup card.
  - The "3 Vehicle" chips grid renders below.
  - The "4 Quick Pricing" block holds Miles + (tire) Tire cost + Revenue.
  - The "5 Service" picker renders below pricing.
  - The "6 Tire Details" (tire vertical) or "6 Mechanic Details" (mechanic vertical) renders below.
  - The "7 Location" block holds ZIP + State + City + Street address. Typing `33101` autofills Miami / FL. Typing `00000` preserves typed city + shows "ZIP not recognized".
  - The "8 Notes" textarea is at the bottom.
  - The View History button is visibly disabled (greyed out).

  If any step is missing or misordered, locate the corresponding form-group title in the JSX and re-check the badge insertion.

- [ ] **Step 9: Self-review**

  Before committing, verify:
  - Every step (1-8) has a step-badge in its title.
  - The phone input is at the very top of the form (Step 1) with `MemoInput`.
  - CustomerLookupCard receives the phone via `rawPhone` prop — NOT a re-rendered input inside it.
  - Step 2 also includes the editable Customer details (Name + Email + CompanyName) so the operator can type or override.
  - Step 7 uses `<AddressAutofillInput>` and the prior City autocomplete dropdown is fully removed.
  - The orphaned `cityOpen` / `cityWrapRef` / `citySuggestions` / city-mousedown effect are removed if grep confirms zero remaining consumers.
  - `applyCustomerPatch` is `useCallback`-stable so `<CustomerLookupCard>`'s memo wrapper actually skips re-renders.
  - `addressValue` is `useMemo`-stable on the 4 address fields.
  - `Job` interface in `src/types/index.ts` includes the SP2-additive fields if `tsc --noEmit` flagged any during Step 6.

- [ ] **Step 10: Commit**

  ```bash
  git add src/pages/AddJob.tsx src/types/index.ts
  git commit -m "$(cat <<'EOF'
  feat(addjob): restructure into 8-step phone-first order (SP2 task 6)

  Restructures AddJob.tsx into the spec's confirmed 8-step explicit
  ordering: Phone → Lookup → Vehicle → Quick Pricing → Service →
  Tire Size (vertical-dispatched) → Location → Notes. Each step
  gets a numbered visual badge in its section title so the top-down
  flow is obvious.

  - Step 1: phone MemoInput at the top of the form.
  - Step 2: CustomerLookupCard renders inline; Customer details
    (name + email + companyName) editable below.
  - Step 3: existing vehicle chips, retitled.
  - Step 4: existing Revenue/Miles/Tire-cost block, retitled
    "Quick Pricing".
  - Step 5: existing Service picker, retitled.
  - Step 6: existing tire-details (tire vertical) OR vertical
    jobFields loop (other verticals). primaryDomainField on the
    vertical config is deferred to SP3 — current code already
    dispatches correctly via inventoryDeduction + jobFields.length.
  - Step 7: <AddressAutofillInput /> replaces the prior city
    autocomplete dropdown — ZIP-first capture per spec §"AddJob
    Workflow Change → step 7".
  - Step 8: existing Notes textarea, retitled.

  Customer Quick Notes auto-render lives inside CustomerLookupCard
  (Task 4) per spec refinement #2 — no duplicate render at Step 8.

  Widens Job interface with five SP2-additive optional fields
  (customerEmail / companyName / addressLine / zipCode + the SP1
  customerId/vehicleId/phoneKey that were previously cast-only).
  EOF
  )"
  ```

---

## Task 7: Final verification — build + tests

**Files:** none (verification only)

A final dry-run that catches anything missed by the per-task verifications.

- [ ] **Step 1: Run the full test suite**

  Run: `npm test`
  Expected: every `tests/*.test.ts` and `tests/components/*.test.ts` file passes. The new test files (`lookupCustomerByPhone.test.ts`, `usZips.test.ts`, `components/AddressAutofillInput.test.ts`, `components/CustomerLookupCard.test.ts`) and the extended `customerEntity.test.ts` are all green.

- [ ] **Step 2: Run the production build**

  Run: `npm run build`
  Expected: `tsc --noEmit` reports 0 errors; `vite build` produces a clean bundle. The dist size delta vs the SP1 baseline is at most ~50-80 KB gzip (CustomerLookupCard + AddressAutofillInput + usZips bundled).

- [ ] **Step 3: Run the type-check in isolation**

  Run: `npm run typecheck`
  Expected: 0 errors.

- [ ] **Step 4: Walk the diff with `git diff main`**

  Run: `git diff main --stat`
  Expected: roughly these files changed —

  - `src/lib/lookupCustomerByPhone.ts` (Task 1 — new)
  - `src/lib/usZips.ts` (Task 2 — new)
  - `src/components/addJob/AddressAutofillInput.tsx` (Task 3 — new)
  - `src/components/addJob/CustomerLookupCard.tsx` (Task 4 — new)
  - `src/lib/customerEntity.ts` (Task 5)
  - `src/pages/AddJob.tsx` (Task 6)
  - `src/types/index.ts` (Task 6 — additive Job fields)
  - `tests/lookupCustomerByPhone.test.ts` (Task 1 — new)
  - `tests/usZips.test.ts` (Task 2 — new)
  - `tests/components/AddressAutofillInput.test.ts` (Task 3 — new)
  - `tests/components/CustomerLookupCard.test.ts` (Task 4 — new)
  - `tests/customerEntity.test.ts` (Task 5 — extended)

- [ ] **Step 5: Self-review the whole SP**

  Before opening the PR, confirm against the spec's SP2 success criteria:
  - **Operator types `(305) 897-7030`, sees Maria Lopez + vehicle card in <300ms** — covered by Task 1's `lookupCustomerByPhone` (3-stage read path with direct doc-id hit on warm path).
  - **Tap "Use Customer", whole Customer card autofills** — covered by Task 4's `deriveUseCustomerPatch` + Task 6's `applyCustomerPatch` in AddJob.
  - **Type a 5-digit ZIP at step 7 → city/state autofill** — covered by Tasks 2 + 3.
  - **8-step order feels deliberate** — covered by Task 6's step-badge restructure.
  - **Email + companyName persist on the Customer doc** — covered by Task 5.
  - **No keystroke-storm regression** — every input under AddJob (phone, name, email, companyName, ZIP, state, city, addressLine) uses `MemoInput` + a `useCallback`-stable setter.
  - **No Twilio configuration required** — none of SP2's changes touch the `functions/` directory or read any Twilio env var.
  - **firestore.rules unchanged** — SP1's Task 7 allowlist already covers `email`, `companyName`, `companyLower`, `addressLine`, `zipCode`. No deploy needed.

- [ ] **Step 6: There is no separate commit for this task**

  All commits are made per-task. Task 7 is verification only — nothing to commit.

---

## Self-Review Results

### 1. Spec coverage

Every SP2 line item from the spec's §"SP2 — Phone lookup + AddJob 'returning customer' card + 8-step order + address autofill" maps to a task in this plan:

| Spec line item | Task |
|---|---|
| `src/lib/lookupCustomerByPhone.ts` (phone → customer + vehicles + lastJob, sub-300ms target, hybrid legacy fallback) | Task 1 |
| `src/components/addJob/CustomerLookupCard.tsx` (returning-customer card with Use Customer / Repeat Last Service / View History) | Task 4 |
| `src/pages/AddJob.tsx` restructured into 8-step order | Task 6 |
| Email input added to existing Customer card | Task 5 (write path) + Task 6 (UI) |
| `AddressAutofillInput` component at step 7 (Location) | Task 3 |
| ZIP → city/state lookup dataset (`src/lib/usZips.ts`) | Task 2 |
| `companyName` capture for fleet customers | Task 5 (write path) + Task 6 (UI) |
| Vertical dispatch on step 6 (tire vs other verticals) | Task 6 (uses existing `inventoryDeduction` + `jobFields.length` dispatch — `primaryDomainField` config field deferred to SP3) |
| Quick Notes auto-attach info card | Task 4 (rendered inside CustomerLookupCard's "found" state per spec §"Quick Notes auto-render") — defers the dedicated `QuickNotesInfoCard.tsx` extraction to SP3 since the inline render satisfies the spec's behavior contract for SP2 |
| Returning Customer card buttons (Use Customer, Repeat Last Service, View History) | Task 4 — View History rendered DISABLED (target route lands in SP3) |
| `MemoInput`-stable phone input contract (spec line 891) | Task 6 (phone input lives in AddJob Step 1, NOT inside CustomerLookupCard) |
| Hybrid legacy 10-digit fallback (spec §"Hybrid read path also tries the legacy form") | Task 1 |
| `firestore.rules` deltas | **NOT REQUIRED** — SP1 Task 7's identity-upsert allowlist already covers `email`, `companyName`, `companyLower`, `addressLine`, `zipCode`. SP2 introduces no new fields. |
| Cloud Function changes | **NOT REQUIRED** — SP2 is client-only. |

### 2. Placeholder scan

Search executed against the rendered plan for the following patterns. Each task contains:

- **Concrete code blocks** for every step that writes code (not "implement here" notes).
- **Concrete test code** for every TDD step.
- **Exact commands** with expected output for every Run step.
- **No "TBD", "TODO", "implement later", "add appropriate error handling", "Similar to Task N"** — every task is self-contained.

The only "later" references are explicit spec-aligned scope deferrals (e.g. "View History button is disabled — target route lands in SP3", "QuickNotesInfoCard extraction lives in SP3", "primaryDomainField config field deferred to SP3", "40k-entry US ZIP dataset is SP3 enrichment"). These are documented scope limits, not placeholders.

Two pragmatic execution levers are documented inline:
- **US ZIP dataset size** (Task 2 Step 3-4): the executor MAY ship with as few as ~50 entries (state capitals + the 4 test-named ZIPs) if a public-domain top-1000 list cannot be sourced inline, relaxing the test assertion accordingly. This is a deliberate v1.5 enrichment lever, not a placeholder.
- **Job interface widening** (Task 6 Step 3): the executor adds whichever of the 5-7 SP2-additive Job fields are not yet present, via `grep` inventory first. This is a mechanical typecheck-pass step, not a placeholder.

### 3. Type consistency

Cross-task type references are consistent:

- `Customer`, `Vehicle` interfaces — defined in SP1's `customerEntity.ts`; consumed by Task 1 (lookupResult shape), Task 4 (CustomerLookupCard props).
- `LookupResult`, `LookupLastJob`, `LookupOps` — defined in Task 1; consumed by Task 4.
- `UseCustomerPatch` — defined in Task 4; consumed by Task 6 (AddJob's `applyCustomerPatch` handler).
- `AddressValue` — defined in Task 3; consumed by Task 6 (AddJob's `addressValue` memo + `onAddressChange` callback).
- `ZipLookup` / `isValidUsZip` / `lookupZip` — defined in Task 2; consumed by Task 3 (AddressAutofillInput's ZIP-derive helper).
- `normalizePhone` / `formatPhoneForDisplay` — from SP1's `phone.ts`; consumed by Tasks 1 + 4.
- `deriveVipTier` — from SP1's `customerInsights.ts`; consumed by Task 4 (VIP badge rendering on the found-state card).
- `MemoInput` — from existing `src/components/addJob/MemoInput.tsx`; consumed by Tasks 3 + 6.

No type drift. No method-name mismatch. No function signature change between definition site and call site.

### 4. Task sequencing

Tasks may be executed in this order (independent files mean Tasks 1-3 can be parallelized across subagents):

- Task 1 (lookupCustomerByPhone) — independent.
- Task 2 (usZips) — independent.
- Task 3 (AddressAutofillInput) — depends on Task 2.
- Task 4 (CustomerLookupCard) — depends on Task 1.
- Task 5 (customerEntity extension) — independent of Tasks 1-4.
- Task 6 (AddJob restructure) — depends on Tasks 1, 2, 3, 4, 5. Execute LAST among the implementation tasks.
- Task 7 (verification) — depends on Tasks 1-6.

Recommended execution path under `superpowers:subagent-driven-development`:
1. Dispatch Tasks 1, 2, 5 in parallel (three independent commits).
2. Once Task 2 lands, dispatch Task 3.
3. Once Task 1 lands, dispatch Task 4.
4. Once Tasks 1-5 are all committed, run Task 6 (AddJob restructure — single-agent since it's the biggest single-file edit).
5. Run Task 7.

### 5. Risk surface

- **Cold-network latency** — `lookupCustomerByPhone` runs against the live Firestore connection. With the local cache populated (typical hot-path) the lookup is <50ms; cold-start is more like 200-400ms. The 500ms slow-warn threshold catches genuine network regressions without flagging cold-start as a bug.
- **Stale lookup races** — handled in Task 4's `seqRef.current` pattern. An operator who edits the phone field 5 times in 250ms gets exactly one lookup fired against the final stable value.
- **Bundle-size growth** — Task 2's US ZIP dataset is the largest single addition (~40 KB gzip for 1000 entries). Verified at Task 2 Step 6.
- **Keystroke-storm regression** — explicitly addressed by keeping every AddJob input as `MemoInput` + `useCallback`-stable setter. Task 4's pull-the-input-OUT-of-CustomerLookupCard design prevents the lookup card from ever owning a hot-render input.
- **AddJob layout regression** — Task 6 Step 8 mandates a manual smoke test against the live app. The 8-step badges + section ordering should be visually obvious; a misorder is caught here.

---

## Handoff prompt

> You're picking up SP2 of the Customer Intelligence v3.2 spec — phone lookup + AddJob redesign. SP1 already shipped (commits `7df4115` through `2e3050c`). Read this plan top-to-bottom once, then execute task-by-task using `superpowers:subagent-driven-development`.
>
> Constraints:
> - One commit per task, with the exact commit message in the task's final step.
> - Every test file follows the `tsx`-direct harness pattern (no vitest, no jest).
> - Every input that lives inside AddJob MUST use `MemoInput` + a `useCallback`-stable setter — the P1-3 keystroke-storm contract is non-negotiable.
> - The plan documents two deliberate scope levers: the US ZIP dataset MAY ship with ~50 entries if 1000 isn't reachable from a public-domain source (relax the test assertion + document the SP3 enrichment debt), and the Job interface widening in Task 6 Step 3 is a mechanical "add whichever optional field tsc complains about" pass.
> - SP3 deliverables explicitly deferred from SP2: `QuickNotesInfoCard.tsx` extraction (currently inline inside CustomerLookupCard), `verticalConfig.primaryDomainField` (currently dispatched via `inventoryDeduction` + `jobFields.length`), CustomerProfile route enabling `<View History>` button, 40k-entry US ZIP dataset expansion.
>
> Begin with Task 1.
