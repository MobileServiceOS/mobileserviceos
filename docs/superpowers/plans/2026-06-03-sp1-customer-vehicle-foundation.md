# Customer + Vehicle Foundation (SP1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Customer + Vehicle entities to MSOS with transactional saveJob upsert, vertical-agnostic data model, Customer Hub top-level navigation, Quick Notes fields, fleet-ready kind enum, normalized phone helper, hybrid legacy-fallback read path, new Settings fields (autoSaveCustomersFromJobs, Communications toggles, Test Incoming Call gating), and the firestore.rules deltas that make all of it safe. Zero visible feature change other than the Customers tab appearing on the main nav with an empty-state skeleton page.

**Architecture:** Customer entity stored at `businesses/{businessId}/customers/{customerId}`. Vehicle sub-entity at `businesses/{businessId}/customers/{customerId}/vehicles/{vehicleId}`. The customerId is computed as `p_<11-digit normalized phone>` for phone-primary customers (legacy 10-digit IDs supported via hybrid read fallback). upsertCustomerFromJob runs inside a Firestore transaction with FieldValue.increment for jobCount and idempotency via processedJobIds. Settings gain four new fields with read-time-default-true semantics for backward compatibility. Customer Hub page is a skeleton rendering the existing Customers list (or new file if none exists) reachable from a new top-level nav entry.

**Tech Stack:** TypeScript, React, Firebase Firestore client SDK (web), firebase-admin (Cloud Functions side — sparingly), tsx test runner via tests/*.test.ts pattern.

---

## Pre-flight: Repo conventions reference

Read these once before starting any task:

- **Test runner contract** (from `package.json`): `npm test` executes `for f in tests/*.test.ts; do echo "▶ $f"; tsx "$f" || exit 1; done`. Each test file is a standalone tsx script that uses `console.log` for output and `process.exit(failed > 0 ? 1 : 0)` to signal pass/fail. The canonical reference test is [`tests/formatPhone.test.ts`](../../../tests/formatPhone.test.ts). The harness pattern is:

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

  **Every new test file in this plan MUST use this pattern.** Do not pull in vitest, jest, or any other test framework — the runner is `tsx` directly.

- **Path alias:** `@/` maps to `src/` (verified in `tsconfig.json` and existing test imports such as `import { digitsOnly } from '@/lib/formatPhone';`).

- **Type-check + build:** `npm run build` runs `tsc --noEmit && vite build`. `npm run typecheck` is just `tsc --noEmit`. Both must pass before committing.

- **Firestore client SDK style:** the repo writes via `fbSetFast` (`src/lib/firebase.ts`). **DO NOT route the Customer upsert through `fbSetFast`** — `fbSetFast` JSON-stringifies object values and would corrupt `FieldValue.increment(1)` / `FieldValue.arrayUnion(jobId)` / `Timestamp` instances. The spec's *Concurrency contract* (spec §"Concurrency contract — upsertCustomerFromJob") mandates `runTransaction` directly with the raw Firestore SDK. **SP1 introduces `runTransaction` to the MSOS client** — `grep -rn 'runTransaction' src/` returns no existing matches at plan-authoring time. Import as `import { runTransaction, doc } from 'firebase/firestore';`.

- **Commit hygiene:** the user's memory file says NO squash commits — make one commit per task as listed. Each commit message is a single line followed by a brief body.

- **No `Date.now()`, no real Timestamps in client writes:** for time fields written from `upsertCustomerFromJob` (a client-side call) use `new Date().toISOString()` per the spec's *Client-write field types* contract. Cloud-Function writes (none in this SP) would use `serverTimestamp()`.

---

## File structure (locked before tasks)

**Create:**

- `src/lib/phone.ts` — normalizePhone, isValidPhone, formatPhoneForDisplay (Task 1)
- `tests/phone.test.ts` — phone normalization tests (Task 1)
- `src/lib/customerEntity.ts` — Customer/Vehicle types + upsertCustomerFromJob (Tasks 2, 4)
- `tests/customerEntity.test.ts` — upsert idempotency, max-lastJobAt, etc. (Task 4)
- `src/lib/customerInsights.ts` — deriveVipTier, deriveCustomerStatus pure helpers (Task 5)
- `tests/customerInsights.test.ts` — tier and status boundary tests (Task 5)
- `src/pages/CustomerHub.tsx` — skeleton Customer Hub page rendered behind the new tab (Task 8)
- `functions/src/backfillCustomers.ts` — callable stub returning "not implemented" (Task 10, optional)

**Modify:**

- `src/types/index.ts` — add Customer, Vehicle types + new Settings fields + 'customers' already present in TabId (verified) (Tasks 2, 3)
- `src/lib/defaults.ts` — add default values for new Settings fields (Task 3)
- `src/App.tsx` — insert upsertCustomerFromJob call into saveJob between line 1076 finalJob assembly and line 1078 fbSetFast write; add the Customers tab to the bottom nav between Jobs and Inv (Tasks 6, 8)
- `firestore.rules` — replace existing customers/{docId} block (lines 604-607) with the new allowlisted block + add vehicles sub-collection rule + add Test Incoming Call admin write rule (Task 7)
- `functions/src/index.ts` — export the backfillCustomers stub if Task 10 is performed (Task 10, optional)

**No file is touched by more than two tasks. Each task commits independently.**

---

## Task 1: Phone normalization helper

**Files:**
- Create: `src/lib/phone.ts`
- Test: `tests/phone.test.ts`

The spec's *Phone Number Normalization (canonical)* section (§"Phone Number Normalization (canonical)") fully specifies the algorithm. This task implements it test-first.

- [ ] **Step 1: Write the failing test at `tests/phone.test.ts`**

  ```ts
  // ═══════════════════════════════════════════════════════════════════
  //  tests/phone.test.ts — Canonical phone normalization tests
  //  Run: npx tsx tests/phone.test.ts
  //  Spec ref: docs/superpowers/specs/2026-06-03-customer-intelligence-design.md
  //            §"Phone Number Normalization (canonical)"
  // ═══════════════════════════════════════════════════════════════════
  import { normalizePhone, isValidPhone, formatPhoneForDisplay } from '@/lib/phone';

  let passed = 0;
  let failed = 0;
  function check(name: string, cond: boolean, detail?: string): void {
    if (cond) { passed++; console.log(`  ✓ ${name}`); }
    else { failed++; console.error(`  ✗ ${name}${detail ? `  — ${detail}` : ''}`); }
  }
  function eq<T>(actual: T, expected: T): boolean {
    return JSON.stringify(actual) === JSON.stringify(expected);
  }

  console.log('\n┌─ normalizePhone: valid inputs ──────────────────');
  check('10-digit bare', eq(normalizePhone('3058977030'), { e164: '+13058977030', digits: '13058977030', formatted: '(305) 897-7030', valid: true }));
  check('formatted', eq(normalizePhone('(305) 897-7030'), { e164: '+13058977030', digits: '13058977030', formatted: '(305) 897-7030', valid: true }));
  check('+1 prefix', eq(normalizePhone('+13058977030'), { e164: '+13058977030', digits: '13058977030', formatted: '(305) 897-7030', valid: true }));
  check('dotted', eq(normalizePhone('305.897.7030'), { e164: '+13058977030', digits: '13058977030', formatted: '(305) 897-7030', valid: true }));
  check('dashed with 1-', eq(normalizePhone('1-305-897-7030'), { e164: '+13058977030', digits: '13058977030', formatted: '(305) 897-7030', valid: true }));

  console.log('\n┌─ normalizePhone: invalid inputs (must return blank e164/digits) ──');
  check('empty string', eq(normalizePhone(''), { e164: '', digits: '', formatted: '', valid: false }));
  check('short code 911', eq(normalizePhone('911'), { e164: '', digits: '', formatted: '911', valid: false }));
  check('9-digit too short', eq(normalizePhone('305-897-703'), { e164: '', digits: '', formatted: '305-897-703', valid: false }));
  check('14-digit too long', eq(normalizePhone('13058977030555'), { e164: '', digits: '', formatted: '13058977030555', valid: false }));
  check('UK intl rejected (v1 US-only)', eq(normalizePhone('+447911123456'), { e164: '', digits: '', formatted: '+447911123456', valid: false }));
  check('extension stripped → garbage rejected', eq(normalizePhone('305-897-7030 x123'), { e164: '', digits: '', formatted: '305-897-7030 x123', valid: false }));
  check('vanity letters rejected', eq(normalizePhone('1-800-FLOWERS'), { e164: '', digits: '', formatted: '1-800-FLOWERS', valid: false }));

  console.log('\n┌─ normalizePhone: type contract ─────────────────');
  let threwNull = false;
  try { normalizePhone(null as unknown as string); } catch { threwNull = true; }
  check('null input throws TypeError', threwNull);
  let threwUndef = false;
  try { normalizePhone(undefined as unknown as string); } catch { threwUndef = true; }
  check('undefined input throws TypeError', threwUndef);

  console.log('\n┌─ isValidPhone ──────────────────────────────────');
  check('valid 10-digit', isValidPhone('3058977030') === true);
  check('valid +1', isValidPhone('+13058977030') === true);
  check('invalid empty', isValidPhone('') === false);
  check('invalid intl', isValidPhone('+447911123456') === false);

  console.log('\n┌─ formatPhoneForDisplay ─────────────────────────');
  check('+13058977030 → (305) 897-7030', formatPhoneForDisplay('+13058977030') === '(305) 897-7030');
  check('empty → empty', formatPhoneForDisplay('') === '');
  check('invalid passthrough', formatPhoneForDisplay('foo') === 'foo');

  console.log('\n══════════════════════════════════════════════════');
  console.log(`  ${passed} passed, ${failed} failed`);
  console.log('══════════════════════════════════════════════════\n');
  process.exit(failed > 0 ? 1 : 0);
  ```

- [ ] **Step 2: Run the test and verify it fails**

  Run: `npx tsx tests/phone.test.ts`
  Expected: error similar to `Cannot find module '@/lib/phone'` (the file does not exist yet).

- [ ] **Step 3: Implement `src/lib/phone.ts`**

  ```ts
  // src/lib/phone.ts
  // ═══════════════════════════════════════════════════════════════════
  //  Canonical US phone normalization.
  //
  //  Single source of truth for:
  //    - Customer.phoneE164 ('+13058977030')
  //    - Customer.phoneKey  ('13058977030')  — also Firestore index key
  //    - Customer doc ID    ('p_13058977030')
  //
  //  Spec: docs/superpowers/specs/2026-06-03-customer-intelligence-design.md
  //        §"Phone Number Normalization (canonical)"
  //
  //  v1 supports US (NANP) only. International / extension / vanity
  //  inputs return { valid: false } with blank e164/digits — callers
  //  MUST gate on .valid before persisting phoneKey/phoneE164.
  // ═══════════════════════════════════════════════════════════════════

  export interface NormalizedPhone {
    e164: string;        // '+13058977030' or '' when invalid
    digits: string;      // '13058977030'  or '' when invalid (phoneKey)
    formatted: string;   // '(305) 897-7030' for display; raw passthrough on invalid
    valid: boolean;
  }

  /**
   * Normalize raw user input into the canonical phone forms.
   *
   * Contract:
   *   - `raw` MUST be a string. Non-string input throws TypeError —
   *     fail loud, never silently produce a bogus phoneKey.
   *   - Returns { valid: false } with blank e164/digits for anything
   *     outside US/NANP 10- or 11-digit format. The original raw
   *     string (trimmed) is echoed back via `formatted` so the UI can
   *     keep displaying what the operator typed.
   */
  export function normalizePhone(raw: string, _defaultCountry: 'US' = 'US'): NormalizedPhone {
    if (typeof raw !== 'string') {
      throw new TypeError('normalizePhone: raw must be a string');
    }
    const trimmed = raw.trim();
    const stripped = trimmed.replace(/[^\d+]/g, '');
    let digits = stripped.startsWith('+') ? stripped.slice(1) : stripped;
    if (digits.length === 10) digits = '1' + digits;
    const valid = digits.length === 11 && digits[0] === '1';
    if (!valid) {
      return { e164: '', digits: '', formatted: trimmed, valid: false };
    }
    const e164 = '+' + digits;
    const formatted = '(' + digits.slice(1, 4) + ') ' + digits.slice(4, 7) + '-' + digits.slice(7, 11);
    return { e164, digits, formatted, valid: true };
  }

  /** Convenience: returns true iff normalizePhone accepts the input. */
  export function isValidPhone(raw: string): boolean {
    return normalizePhone(raw).valid;
  }

  /**
   * Display helper — accepts an E.164 string and returns the canonical
   * formatted form. Passes invalid input through unchanged so legacy
   * Job.customerPhone values still render readably.
   */
  export function formatPhoneForDisplay(e164: string): string {
    if (!e164) return '';
    const n = normalizePhone(e164);
    return n.valid ? n.formatted : e164;
  }
  ```

- [ ] **Step 4: Run the test and verify it passes**

  Run: `npx tsx tests/phone.test.ts`
  Expected: `XX passed, 0 failed`.

- [ ] **Step 5: Run the full test suite + type-check**

  Run: `npm test && npm run typecheck`
  Expected: every test green; `tsc --noEmit` reports 0 errors.

- [ ] **Step 6: Self-review**

  Before committing, verify:
  - `normalizePhone` returns `{ valid: false, e164: '', digits: '' }` for every invalid case in the spec's edge-case table — never a populated digits string for an invalid input.
  - Non-string input throws TypeError (so a future bug that passes `null` fails loud rather than silently producing a bogus `phoneKey`).
  - `tsc --noEmit` reports 0 errors.

- [ ] **Step 7: Commit**

  ```bash
  git add src/lib/phone.ts tests/phone.test.ts
  git commit -m "feat(phone): add canonical US phone normalization helper (SP1 task 1)

  Adds normalizePhone / isValidPhone / formatPhoneForDisplay per the
  Customer Intelligence v3.2 spec. v1 supports US NANP only; intl,
  extension, and vanity inputs return { valid: false } so callers can
  refuse to persist a bogus phoneKey.
  "
  ```

---

## Task 2: Customer + Vehicle TypeScript types

**Files:**
- Create: `src/lib/customerEntity.ts` (types only this task; helper lands in Task 4)
- Modify: `src/types/index.ts` (re-export Customer + Vehicle for ergonomics)

This task lands the type definitions only. The transactional `upsertCustomerFromJob` body comes in Task 4 — splitting them keeps each task in the 2-5 minute range.

- [ ] **Step 1: Create `src/lib/customerEntity.ts` with type definitions**

  ```ts
  // src/lib/customerEntity.ts
  // ═══════════════════════════════════════════════════════════════════
  //  Customer + Vehicle entities.
  //
  //  Customer doc path: businesses/{bid}/customers/{customerId}
  //  Vehicle  doc path: businesses/{bid}/customers/{customerId}/vehicles/{vehicleId}
  //
  //  Spec: docs/superpowers/specs/2026-06-03-customer-intelligence-design.md
  //        §"Data Model" (Customer table, Vehicle table)
  //
  //  This file lands TYPES only in SP1 Task 2. The transactional
  //  upsertCustomerFromJob helper is added in Task 4.
  //
  //  All rollup fields are OPTIONAL — legacy docs and the first-create
  //  case both lack them, and read sites MUST nullish-coalesce.
  // ═══════════════════════════════════════════════════════════════════

  /** Top-level Customer doc. */
  export interface Customer {
    /** Doc ID: `p_<11-digit phoneKey>` or `n_<slug>`. */
    id: string;
    /** Display name. Migrated from Job.customerName on first upsert. */
    name: string;
    /** Lowercased name for global-search prefix queries (v2). */
    nameLower?: string;

    /** Reserved for future fleet workflow features. Default 'individual'. */
    kind?: 'individual' | 'fleet';
    /** Business / fleet name. Informational when kind==='individual'. */
    companyName?: string;
    companyLower?: string;

    /** E.164 form (e.g. '+13058977030'). Only written when phone is valid. */
    phoneE164?: string;
    /** Digits-only form (e.g. '13058977030'). Indexed. Primary lookup field. */
    phoneKey?: string;

    email?: string;
    addressLine?: string;
    city?: string;
    cityLower?: string;
    state?: string;
    zipCode?: string;

    /** EXISTING free-text operator note (preserved from CustomerMeta). */
    note?: string;
    /** EXISTING tag list (preserved from CustomerMeta). */
    tags?: string[];

    // ─── v3.2 Quick Notes (refinement #2) — schema-only in SP1 ──────
    gateCode?: string;
    apartmentNumber?: string;
    wheelLockKeyLocation?: string;
    tpmsNotes?: string;
    preferredPaymentMethod?: string;
    parkingInstructions?: string;
    preferredContactMethod?: 'phone' | 'sms' | 'email';
    generalNotes?: string;

    // ─── Lifecycle timestamps ───────────────────────────────────────
    firstJobAt?: string;   // ISO from client; Timestamp from server
    lastJobAt?: string;
    lastJobId?: string;

    // ─── Rollups ────────────────────────────────────────────────────
    jobCount?: number;
    lifetimeRevenue?: number;
    averageTicket?: number;
    vipTier?: 'Standard' | 'Gold' | 'Platinum';
    customerStatus?: 'Active' | 'Inactive' | 'Fleet' | 'VIP' | 'Archived';
    /** Written by SP3 referral surface — schema-only here. */
    referralCount?: number;
    /** Written by SP3 photo gallery — schema-only here. */
    photoCount?: number;

    // ─── Audit ──────────────────────────────────────────────────────
    createdByUid?: string;
    createdAt?: string;     // ISO from client
    updatedAt?: string;
    lastEditedByUid?: string;
    lastEditedAt?: string;
    /** Set by SP3 Call/Text buttons. Allowlisted in identity-upsert rule
     *  (firestore.rules Task 7) so SP3 writes don't require schema churn. */
    lastContactedAt?: string;

    // ─── Idempotency ────────────────────────────────────────────────
    /** Bounded list of jobIds already absorbed by upsertCustomerFromJob.
     *  FIFO eviction at ~500 entries (see customerEntity.ts Task 4). */
    processedJobIds?: string[];

    // ─── Soft-delete (SP3 surface) ──────────────────────────────────
    deletedAt?: string;
  }

  /** Vehicle subdoc under a Customer. */
  export interface Vehicle {
    id: string;
    // Universal core
    year?: number;
    make?: string;
    model?: string;
    trim?: string;
    color?: string;
    vin?: string;
    licensePlate?: string;
    /** Lowercased "make model" for global-search prefix queries. */
    makeModelLower?: string;

    // Legacy compatibility
    vehicleMakeModel?: string;
    vehicleType?: string;
    vehicleSize?: string;

    // Tire-vertical top-level fields (v3 — were under .tire in v2)
    tireSize?: string;
    alternateTireSize?: string;
    tireBrand?: string;
    tireCondition?: string;
    tpmsNotes?: string;
    wheelLockNotes?: string;
    serviceNotes?: string;

    // Rollups
    lastServicedAt?: string;
    lastServiceDate?: string;
    lastJobId?: string;
    serviceCount?: number;

    createdAt?: string;
    updatedAt?: string;
    processedJobIds?: string[];
  }
  ```

- [ ] **Step 2: Re-export from `src/types/index.ts` for ergonomic call-sites**

  Open `src/types/index.ts` and append at the very bottom of the file (after the last existing export):

  ```ts
  // ─────────────────────────────────────────────────────────────────────
  //  Customer + Vehicle entities (SP1 — Customer Intelligence v3.2)
  //  Defined in src/lib/customerEntity.ts; re-exported here for
  //  ergonomic imports — `import type { Customer } from '@/types';`
  // ─────────────────────────────────────────────────────────────────────
  export type { Customer, Vehicle } from '@/lib/customerEntity';
  ```

- [ ] **Step 3: Verify the TabId already covers 'customers'**

  Open `src/types/index.ts` and confirm `'customers'` is already a member of `TabId` (it is — verified at file lines 58-70 in the current tree). No change needed. If the line is missing for any reason, add `'customers'` to the union.

- [ ] **Step 4: Run type-check**

  Run: `npm run typecheck`
  Expected: 0 errors. The `customerEntity.ts` types are pure — no runtime imports, no circular deps.

- [ ] **Step 5: Self-review**

  Before committing, verify:
  - Every rollup field (`jobCount`, `lifetimeRevenue`, `averageTicket`, `vipTier`, `customerStatus`, `firstJobAt`, `lastJobAt`, etc.) is optional (`?:`) — legacy customer docs do NOT carry these.
  - All 8 Quick Notes fields are present and optional.
  - `kind?: 'individual' | 'fleet'` is present.
  - The `Vehicle` interface has `makeModelLower` and the v3 top-level tire fields.

- [ ] **Step 6: Commit**

  ```bash
  git add src/lib/customerEntity.ts src/types/index.ts
  git commit -m "feat(types): add Customer + Vehicle entity types (SP1 task 2)

  Schema-only types for the new Customer/Vehicle entities per the
  Customer Intelligence v3.2 spec. Includes the 8 Quick Notes
  fields, fleet kind enum, and v3 top-level tire fields. All
  rollup fields are optional so legacy docs and first-create both
  read cleanly via nullish-coalesce.
  "
  ```

---

## Task 3: Settings field additions

**Files:**
- Modify: `src/types/index.ts` (Settings interface, around lines 787-1115)
- Modify: `src/lib/defaults.ts` (DEFAULT_SETTINGS, around line 88)

Per the spec's *Auto-Save Customers Setting (Phase 17)* and *Communications Settings* sections, SP1 lands the schema only. UI lands in SP3 (Customer Directory accordion) and SP4 (Communications accordion).

- [ ] **Step 1: Add the new fields to the `Settings` interface in `src/types/index.ts`**

  Append the following block to the `Settings` interface (insert it right before the closing `}` of `interface Settings`, after the existing referral-system fields):

  ```ts
    // ─── Customer Directory (SP1 schema — UI lands in SP3) ──────────
    /**
     * When true, every saveJob calls upsertCustomerFromJob to mirror
     * the job into the businesses/{bid}/customers/{cid} entity.
     * Default semantics: undefined === true. Read sites MUST
     * nullish-coalesce: `settings.autoSaveCustomersFromJobs ?? true`.
     * Spec §"Auto-Save Customers Setting (Phase 17)".
     */
    autoSaveCustomersFromJobs?: boolean;

    // ─── Communications (SP1 schema — UI lands in SP4) ──────────────
    /** Communication provider — v1 always 'twilio' (read-only label). */
    communicationProvider?: 'twilio';
    /** Per-business Twilio connect status. Default false. */
    twilioConnected?: boolean;
    /** Voice webhook customer-lookup gate. Default true. */
    incomingCallLookupEnabled?: boolean;
    /** SMS webhook logging gate. Default true. */
    incomingSMSLoggingEnabled?: boolean;
    /** SP7 future-ready flag. Default false. v1 reads only. */
    missedCallAutoTextEnabled?: boolean;
    /** sendSMS callable master switch. Default true. */
    outboundSMSEnabled?: boolean;
    /** Outbound SMS provider. v1 default 'native' (device handoff);
     *  'twilio' enables in-app outbound. Read pattern:
     *  `settings.outboundCommunicationProvider ?? 'native'`.
     *  Spec line 2202 + line 2488. */
    outboundCommunicationProvider?: 'native' | 'twilio';
  ```

- [ ] **Step 2: Add defaults in `src/lib/defaults.ts`**

  Open `src/lib/defaults.ts` and inside the `DEFAULT_SETTINGS` object (lines 88-112), append the following fields right before the closing `}`:

  ```ts
    // ─── Customer Directory (SP1 schema; UI in SP3) ──────────────────
    autoSaveCustomersFromJobs: true,
    // ─── Communications (SP1 schema; UI in SP4) ──────────────────────
    communicationProvider: 'twilio',
    twilioConnected: false,
    incomingCallLookupEnabled: true,
    incomingSMSLoggingEnabled: true,
    missedCallAutoTextEnabled: false,
    outboundSMSEnabled: true,
    outboundCommunicationProvider: 'native',
  ```

  **Read-time default contract reminder (spec §"Read-time default contract"):** existing Wheel Rush tenants do NOT have these fields on disk. Every read site that touches these fields MUST coalesce with the default — never assume the field is present. Example from the spec:

  ```ts
  const autoSave = settings.autoSaveCustomersFromJobs ?? true;
  ```

  This is enforced in Task 6's saveJob change.

- [ ] **Step 3: Run type-check**

  Run: `npm run typecheck`
  Expected: 0 errors. The defaults object remains a valid `Settings`.

- [ ] **Step 4: Run the full test suite**

  Run: `npm test`
  Expected: all existing tests pass. The new optional fields are additive — no existing test consumes them.

- [ ] **Step 5: Self-review**

  Before committing, verify:
  - All 8 new Settings fields are optional (`?:`) in the interface
    (autoSaveCustomersFromJobs, communicationProvider, twilioConnected,
    incomingCallLookupEnabled, incomingSMSLoggingEnabled,
    missedCallAutoTextEnabled, outboundSMSEnabled,
    outboundCommunicationProvider).
  - `DEFAULT_SETTINGS` carries every field with the documented default.
  - No existing test broke (additive change only).

- [ ] **Step 6: Commit**

  ```bash
  git add src/types/index.ts src/lib/defaults.ts
  git commit -m "feat(settings): add Customer Directory + Communications fields (SP1 task 3)

  Schema-only additions per Customer Intelligence v3.2 spec
  §\"Auto-Save Customers Setting\" and §\"Communications Settings\".
  All fields optional with nullish-coalesce defaults so existing
  Wheel Rush tenants are unaffected. UI lands in SP3 (Customer
  Directory) and SP4 (Communications).
  "
  ```

---

## Task 4: customerEntity — derive helpers (preview) + upsertCustomerFromJob

**Files:**
- Modify: `src/lib/customerEntity.ts` (append helper to file from Task 2)
- Create: `tests/customerEntity.test.ts`

Implements the transactional upsert mandated by the spec's *Concurrency contract — upsertCustomerFromJob* section. **Critical:** use `runTransaction` from `firebase/firestore` directly — do NOT route through `fbSetFast` (which JSON-stringifies and would corrupt `FieldValue.increment` / `FieldValue.arrayUnion`).

**Tire-field stance (resolves spec internal inconsistency):** spec rule 11 mandates dual-write to `vehicle.tire.size` AND `vehicle.tireSize`; spec line 368 (v3 update) reverses to top-level only. This plan follows the v3 stance — **top-level tire fields only** (`tireSize`, `tireBrand`, `tireCondition`, `alternateTireSize`). SP3 global search queries the top-level fields. If a future spec revision reinstates the dual-write contract, `_buildVehiclePatch` is the single touch point.

Note: this task uses simple deterministic helper imports for `deriveVipTier` and `deriveCustomerStatus`. Those helpers are formally tested in Task 5; here they are inlined as `_vipTierFromRevenue` and `_statusFromLastJobAt` private functions so this task can ship first and Task 5 can extract + extend.

- [ ] **Step 1: Write the failing test at `tests/customerEntity.test.ts`**

  The test mocks Firestore via a tiny in-memory shim. Real Firestore round-trip integration is covered by manual QA per the spec's verification path.

  ```ts
  // ═══════════════════════════════════════════════════════════════════
  //  tests/customerEntity.test.ts — upsertCustomerFromJob behaviour
  //  Run: npx tsx tests/customerEntity.test.ts
  //
  //  These tests use a tiny in-memory Firestore shim so we can verify
  //  the transactional read-then-write logic without booting the
  //  emulator. The shim implements just enough to satisfy our usage:
  //  runTransaction(tx => ...) where tx exposes get/set/update, plus
  //  FieldValue.increment + FieldValue.arrayUnion as sentinel objects
  //  the shim recognises on set/update.
  // ═══════════════════════════════════════════════════════════════════
  import { __testHooks } from '@/lib/customerEntity';

  let passed = 0;
  let failed = 0;
  function check(name: string, cond: boolean, detail?: string): void {
    if (cond) { passed++; console.log(`  ✓ ${name}`); }
    else { failed++; console.error(`  ✗ ${name}${detail ? `  — ${detail}` : ''}`); }
  }

  const { runUpsertWithShim } = __testHooks;

  function makeJob(over: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      id: 'job-1',
      date: '2026-05-30',
      customerName: 'Maria Lopez',
      customerPhone: '(305) 897-7030',
      customerEmail: 'maria@example.com',
      city: 'Miami',
      state: 'FL',
      vehicleType: 'Car',
      vehicleMakeModel: 'Honda Civic',
      tireSize: '215/55R17',
      revenue: 450,
      ...over,
    };
  }

  console.log('\n┌─ first-time upsert ─────────────────────────────');
  {
    const store = new Map<string, Record<string, unknown>>();
    const res = runUpsertWithShim(store, 'biz-1', makeJob());
    const c = store.get('businesses/biz-1/customers/p_13058977030') as Record<string, unknown>;
    check('writes customer at canonical p_<11-digit> path', !!c);
    check('phoneKey set to 11-digit digits', c?.phoneKey === '13058977030');
    check('phoneE164 set', c?.phoneE164 === '+13058977030');
    check('firstJobAt set to job.date', c?.firstJobAt === '2026-05-30');
    check('lastJobAt set to job.date', c?.lastJobAt === '2026-05-30');
    check('jobCount === 1', c?.jobCount === 1);
    check('kind defaults to individual', c?.kind === 'individual');
    check('lifetimeRevenue === 450', c?.lifetimeRevenue === 450);
    check('processedJobIds includes job-1', Array.isArray(c?.processedJobIds) && (c?.processedJobIds as string[]).includes('job-1'));
    check('returns customerId', res.customerId === 'p_13058977030');
    check('returns vehicleId', typeof res.vehicleId === 'string' && (res.vehicleId as string).length > 0);
  }

  console.log('\n┌─ second job is non-idempotent (different jobId) ──');
  {
    const store = new Map<string, Record<string, unknown>>();
    runUpsertWithShim(store, 'biz-1', makeJob({ id: 'job-1', date: '2026-05-10', revenue: 200 }));
    runUpsertWithShim(store, 'biz-1', makeJob({ id: 'job-2', date: '2026-05-30', revenue: 300 }));
    const c = store.get('businesses/biz-1/customers/p_13058977030') as Record<string, unknown>;
    check('jobCount incremented to 2', c?.jobCount === 2);
    check('firstJobAt preserved (set-if-absent)', c?.firstJobAt === '2026-05-10');
    check('lastJobAt = max of dates', c?.lastJobAt === '2026-05-30');
    check('lifetimeRevenue summed to 500', c?.lifetimeRevenue === 500);
    check('averageTicket = 500/2 = 250', c?.averageTicket === 250);
  }

  console.log('\n┌─ repeated upsert of same job is idempotent ─────');
  {
    const store = new Map<string, Record<string, unknown>>();
    runUpsertWithShim(store, 'biz-1', makeJob({ id: 'job-1', revenue: 400 }));
    runUpsertWithShim(store, 'biz-1', makeJob({ id: 'job-1', revenue: 400 }));
    const c = store.get('businesses/biz-1/customers/p_13058977030') as Record<string, unknown>;
    check('jobCount stays at 1 on duplicate', c?.jobCount === 1);
    check('lifetimeRevenue stays at 400 on duplicate', c?.lifetimeRevenue === 400);
  }

  console.log('\n┌─ invalid phone is skipped, name fallback used ──');
  {
    const store = new Map<string, Record<string, unknown>>();
    const res = runUpsertWithShim(store, 'biz-1', makeJob({ customerPhone: '911', customerName: 'Walk In' }));
    check('falls back to n_<slug> ID', res.customerId === 'n_walk-in');
    const c = store.get('businesses/biz-1/customers/n_walk-in') as Record<string, unknown>;
    check('no phoneKey written when phone invalid', c?.phoneKey === undefined);
    check('no phoneE164 written when phone invalid', c?.phoneE164 === undefined);
  }

  console.log('\n┌─ totally unidentifiable job: throws ────────────');
  {
    const store = new Map<string, Record<string, unknown>>();
    let threw = false;
    try { runUpsertWithShim(store, 'biz-1', makeJob({ customerPhone: '', customerName: '' })); } catch { threw = true; }
    check('throws when neither phone nor name resolvable', threw);
  }

  console.log('\n┌─ vehicle subdoc written + idempotent ───────────');
  {
    const store = new Map<string, Record<string, unknown>>();
    runUpsertWithShim(store, 'biz-1', makeJob({ id: 'job-1' }));
    runUpsertWithShim(store, 'biz-1', makeJob({ id: 'job-2' }));
    // The vehicle path includes the slugged year-make-model-trim.
    // We don't pin the exact slug here — we just count vehicle docs
    // under the customer's vehicles/ subcollection.
    const vehicleKeys = Array.from(store.keys()).filter(k => k.startsWith('businesses/biz-1/customers/p_13058977030/vehicles/'));
    check('exactly one vehicle doc for same make/model', vehicleKeys.length === 1);
    const v = store.get(vehicleKeys[0]) as Record<string, unknown>;
    check('vehicle serviceCount = 2 after two distinct jobs', v?.serviceCount === 2);
  }

  console.log('\n══════════════════════════════════════════════════');
  console.log(`  ${passed} passed, ${failed} failed`);
  console.log('══════════════════════════════════════════════════\n');
  process.exit(failed > 0 ? 1 : 0);
  ```

- [ ] **Step 2: Run the test and verify it fails**

  Run: `npx tsx tests/customerEntity.test.ts`
  Expected: fails because `__testHooks` and `runUpsertWithShim` do not exist yet.

- [ ] **Step 3: Append the upsert helper to `src/lib/customerEntity.ts`**

  Append the following block to `src/lib/customerEntity.ts` (after the existing `Vehicle` interface):

  ```ts
  // ═══════════════════════════════════════════════════════════════════
  //  upsertCustomerFromJob — SP1 transactional upsert
  //
  //  Spec: §"Concurrency contract — upsertCustomerFromJob"
  //
  //  - Runs as a Firestore transaction (read-then-write).
  //  - FieldValue.increment(1) on jobCount, gated by processedJobIds
  //    idempotency.
  //  - firstJobAt set-if-absent, never overwritten.
  //  - lastJobAt = max(existing, job.date).
  //  - processedJobIds FIFO eviction at MAX_PROCESSED_JOB_IDS entries.
  //  - Vehicle subdoc mirrors the same idempotency contract.
  //
  //  NEVER use fbSetFast from this module — fbSetFast JSON-stringifies
  //  object values and would corrupt FieldValue sentinels. We use
  //  runTransaction + tx.set/tx.update directly with the raw SDK.
  // ═══════════════════════════════════════════════════════════════════

  import {
    doc,
    runTransaction,
    increment,
    arrayUnion,
    type Firestore,
  } from 'firebase/firestore';
  import { _db } from '@/lib/firebase';
  import { normalizePhone } from '@/lib/phone';

  /** Cap on processedJobIds array size before FIFO eviction. */
  const MAX_PROCESSED_JOB_IDS = 500;

  /** Inline revenue-tier helper. Formalized + tested in Task 5
   *  (src/lib/customerInsights.ts); upsert imports the canonical
   *  helper from there in Task 5's commit. */
  function _vipTierFromRevenue(rev: number): 'Standard' | 'Gold' | 'Platinum' {
    if (rev >= 2500) return 'Platinum';
    if (rev >= 1000) return 'Gold';
    return 'Standard';
  }

  /** Inline status helper. Formalized in Task 5. */
  function _statusFromLastJobAt(lastJobAtIso: string | undefined): 'Active' | 'Inactive' {
    if (!lastJobAtIso) return 'Active';
    const last = Date.parse(lastJobAtIso);
    if (!Number.isFinite(last)) return 'Active';
    const twelveMonthsAgo = Date.now() - 365 * 24 * 60 * 60 * 1000;
    return last >= twelveMonthsAgo ? 'Active' : 'Inactive';
  }

  function _slug(s: string): string {
    return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }

  /** Customer doc ID: 'p_<11-digit>' for phone-primary, else 'n_<slug>'.
   *  Returns '' when the job has neither a valid phone nor any name. */
  export function customerIdForJob(job: { customerPhone?: string; customerName?: string }): string {
    const p = normalizePhone(String(job.customerPhone ?? ''));
    if (p.valid) return 'p_' + p.digits;
    const slug = _slug(String(job.customerName ?? ''));
    return slug ? 'n_' + slug : '';
  }

  /** Vehicle doc ID prefers universal year-make-model-trim; falls back
   *  to legacy makeModel; final fallback for stub jobs. */
  export function vehicleIdForJob(job: {
    id: string;
    year?: number;
    make?: string;
    model?: string;
    trim?: string;
    vehicleMakeModel?: string;
    vehicleType?: string;
    tireSize?: string;
  }): string {
    if (job.make && job.model) {
      const parts = [String(job.year ?? ''), job.make, job.model, job.trim ?? 'base'].filter(Boolean);
      return _slug(parts.join('-'));
    }
    if (job.vehicleMakeModel) return _slug(String(job.vehicleMakeModel));
    if (job.vehicleType) return _slug(job.vehicleType + '-' + (job.tireSize ?? 'na'));
    return 'unknown-' + String(job.id ?? '').slice(0, 6);
  }

  export interface UpsertResult {
    customerId: string;
    vehicleId: string;
  }

  /** Pure-function core: takes the current customer doc + the job and
   *  produces the patch to apply. Extracted so the in-memory test shim
   *  can call it directly without booting Firestore. */
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
    nowIso: string,
    actorUid: string,
  ): { patch: Record<string, unknown>; skipRollup: boolean } {
    const phone = normalizePhone(String(job.customerPhone ?? ''));
    const processed = (existing?.processedJobIds as string[] | undefined) ?? [];
    const skipRollup = processed.includes(job.id);

    const rev = Number(job.revenue ?? 0) || 0;
    const newJobCount = skipRollup ? Number(existing?.jobCount ?? 0) : Number(existing?.jobCount ?? 0) + 1;
    const newRevenue = skipRollup ? Number(existing?.lifetimeRevenue ?? 0) : Number(existing?.lifetimeRevenue ?? 0) + rev;
    const newLastJobAt = skipRollup
      ? (existing?.lastJobAt as string | undefined)
      : (() => {
          const a = (existing?.lastJobAt as string | undefined) ?? '';
          const b = job.date ?? '';
          return a > b ? a : b;
        })();
    const newAvg = newJobCount > 0 ? newRevenue / newJobCount : 0;

    // FIFO-evicted processedJobIds. We compute the trimmed list here
    // instead of arrayUnion so the test shim and the prod path agree
    // bit-for-bit on size bound.
    const nextProcessed = skipRollup
      ? processed
      : [...processed, job.id].slice(-MAX_PROCESSED_JOB_IDS);

    const patch: Record<string, unknown> = {
      // Identity (always merge-write per spec §"Concurrency contract" rule 9)
      name: String(job.customerName ?? '').trim() || (existing?.name as string | undefined) || 'Unknown',
      nameLower: (String(job.customerName ?? '').trim() || (existing?.name as string | undefined) || 'Unknown').toLowerCase(),
      kind: (existing?.kind as string | undefined) ?? 'individual',
      // Phone/email/address — set ONLY when valid/present; never write '' over an existing value
      ...(phone.valid ? { phoneE164: phone.e164, phoneKey: phone.digits } : {}),
      ...(job.customerEmail ? { email: String(job.customerEmail) } : {}),
      ...(job.city ? { city: String(job.city), cityLower: String(job.city).toLowerCase() } : {}),
      ...(job.state ? { state: String(job.state) } : {}),
      ...(job.addressLine ? { addressLine: String(job.addressLine) } : {}),
      ...(job.zipCode ? { zipCode: String(job.zipCode) } : {}),
      // Lifecycle
      firstJobAt: (existing?.firstJobAt as string | undefined) ?? (job.date ?? nowIso),
      lastJobAt: newLastJobAt,
      lastJobId: skipRollup ? (existing?.lastJobId as string | undefined) : job.id,
      jobCount: newJobCount,
      lifetimeRevenue: newRevenue,
      averageTicket: newAvg,
      vipTier: _vipTierFromRevenue(newRevenue),
      customerStatus: _statusFromLastJobAt(newLastJobAt),
      // Audit
      createdByUid: (existing?.createdByUid as string | undefined) ?? actorUid,
      createdAt: (existing?.createdAt as string | undefined) ?? nowIso,
      updatedAt: nowIso,
      lastEditedByUid: actorUid,
      lastEditedAt: nowIso,
      processedJobIds: nextProcessed,
    };
    return { patch, skipRollup };
  }

  function _buildVehiclePatch(
    existing: Record<string, unknown> | undefined,
    job: {
      id: string;
      date?: string;
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
    },
    nowIso: string,
  ): { patch: Record<string, unknown>; skipRollup: boolean } {
    const processed = (existing?.processedJobIds as string[] | undefined) ?? [];
    const skipRollup = processed.includes(job.id);
    const newServiceCount = skipRollup ? Number(existing?.serviceCount ?? 0) : Number(existing?.serviceCount ?? 0) + 1;
    const newLastServicedAt = skipRollup
      ? (existing?.lastServicedAt as string | undefined)
      : (() => {
          const a = (existing?.lastServicedAt as string | undefined) ?? '';
          const b = job.date ?? '';
          return a > b ? a : b;
        })();
    const nextProcessed = skipRollup
      ? processed
      : [...processed, job.id].slice(-MAX_PROCESSED_JOB_IDS);

    const makeModelLower = (job.make && job.model)
      ? `${job.make} ${job.model}`.toLowerCase()
      : (job.vehicleMakeModel ?? '').toLowerCase() || undefined;

    const patch: Record<string, unknown> = {
      ...(job.year !== undefined ? { year: job.year } : {}),
      ...(job.make ? { make: job.make } : {}),
      ...(job.model ? { model: job.model } : {}),
      ...(job.trim ? { trim: job.trim } : {}),
      ...(job.color ? { color: job.color } : {}),
      ...(makeModelLower ? { makeModelLower } : {}),
      ...(job.vehicleMakeModel ? { vehicleMakeModel: job.vehicleMakeModel } : {}),
      ...(job.vehicleType ? { vehicleType: job.vehicleType } : {}),
      ...(job.vehicleSize ? { vehicleSize: job.vehicleSize } : {}),
      // v3 top-level tire fields
      ...(job.tireSize ? { tireSize: job.tireSize } : {}),
      ...(job.tireBrand ? { tireBrand: job.tireBrand } : {}),
      ...(job.tireCondition ? { tireCondition: job.tireCondition } : {}),
      lastServicedAt: newLastServicedAt,
      lastJobId: skipRollup ? (existing?.lastJobId as string | undefined) : job.id,
      serviceCount: newServiceCount,
      createdAt: (existing?.createdAt as string | undefined) ?? nowIso,
      updatedAt: nowIso,
      processedJobIds: nextProcessed,
    };
    return { patch, skipRollup };
  }

  /** Transactionally upsert the Customer + Vehicle from a saved Job. */
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
    const customerId = customerIdForJob(job);
    if (!customerId) {
      throw new Error('upsertCustomerFromJob: cannot derive customerId (no phone, no name)');
    }
    const vehicleId = vehicleIdForJob(job);
    const nowIso = new Date().toISOString();
    const actorUid = job.createdByUid ?? '';

    const customerRef = doc(_db as Firestore, `businesses/${businessId}/customers/${customerId}`);
    const vehicleRef = doc(_db as Firestore, `businesses/${businessId}/customers/${customerId}/vehicles/${vehicleId}`);

    await runTransaction(_db as Firestore, async (tx) => {
      const [cSnap, vSnap] = await Promise.all([tx.get(customerRef), tx.get(vehicleRef)]);
      const cExisting = cSnap.exists() ? (cSnap.data() as Record<string, unknown>) : undefined;
      const vExisting = vSnap.exists() ? (vSnap.data() as Record<string, unknown>) : undefined;

      const { patch: cPatch } = _buildCustomerPatch(cExisting, job, nowIso, actorUid);
      const { patch: vPatch } = _buildVehiclePatch(vExisting, job, nowIso);

      tx.set(customerRef, cPatch, { merge: true });
      tx.set(vehicleRef, vPatch, { merge: true });
    });

    return { customerId, vehicleId };
  }

  /** Test-only hooks — used by tests/customerEntity.test.ts.
   *  NOT exported from the package's public surface. */
  export const __testHooks = {
    /** Pure-shim version of the transactional upsert. Writes into the
     *  caller-provided in-memory Map keyed by full doc paths. Returns
     *  the same { customerId, vehicleId } the real helper does. */
    runUpsertWithShim(
      store: Map<string, Record<string, unknown>>,
      businessId: string,
      job: Parameters<typeof upsertCustomerFromJob>[1],
    ): UpsertResult {
      const customerId = customerIdForJob(job);
      if (!customerId) throw new Error('runUpsertWithShim: cannot derive customerId');
      const vehicleId = vehicleIdForJob(job);
      const nowIso = new Date().toISOString();
      const actorUid = job.createdByUid ?? '';
      const cPath = `businesses/${businessId}/customers/${customerId}`;
      const vPath = `businesses/${businessId}/customers/${customerId}/vehicles/${vehicleId}`;
      const cExisting = store.get(cPath);
      const vExisting = store.get(vPath);
      const { patch: cPatch } = _buildCustomerPatch(cExisting, job, nowIso, actorUid);
      const { patch: vPatch } = _buildVehiclePatch(vExisting, job, nowIso);
      store.set(cPath, { ...(cExisting ?? {}), ...cPatch });
      store.set(vPath, { ...(vExisting ?? {}), ...vPatch });
      return { customerId, vehicleId };
    },
  };
  ```

  Note: `_db` is the Firestore singleton exported by `src/lib/firebase.ts`. If the existing export is named differently (e.g. `db`), keep the import name aligned with whatever the file currently exports — verify at the start of the task by `grep -n "^export.*db\b" src/lib/firebase.ts`.

- [ ] **Step 4: Run the test and verify it passes**

  Run: `npx tsx tests/customerEntity.test.ts`
  Expected: every check green; the summary line reads `XX passed, 0 failed`.

- [ ] **Step 5: Run the full suite + type-check**

  Run: `npm test && npm run typecheck`
  Expected: all green; 0 type errors.

- [ ] **Step 6: Self-review**

  Before committing, verify:
  - The implementation uses `runTransaction` + `tx.set(..., { merge: true })`. It does NOT use `fbSetFast` anywhere.
  - `processedJobIds` is bounded via `slice(-MAX_PROCESSED_JOB_IDS)` so a customer with 10,000 jobs cannot blow Firestore's 1 MB doc limit.
  - `firstJobAt` is set if absent and never overwritten on subsequent upserts.
  - Invalid phone (`normalizePhone(...).valid === false`) does NOT write `phoneKey` or `phoneE164`; instead falls back to `n_<slug>` ID.
  - The test shim and the real helper share the exact same patch-building functions (`_buildCustomerPatch`, `_buildVehiclePatch`) — there is no parallel-implementation drift.

- [ ] **Step 7: Commit**

  ```bash
  git add src/lib/customerEntity.ts tests/customerEntity.test.ts
  git commit -m "feat(customers): add transactional upsertCustomerFromJob (SP1 task 4)

  Implements the spec's §\"Concurrency contract — upsertCustomerFromJob\"
  contract: runTransaction-based read-then-write, FieldValue.increment
  on jobCount gated by per-job idempotency (bounded processedJobIds
  array), firstJobAt set-if-absent, lastJobAt = max(existing, job.date).
  Vehicle subdoc mirrors the same pattern. Never routed through
  fbSetFast (which would corrupt FieldValue sentinels).
  "
  ```

---

## Task 5: Customer derive helpers (formalized + tested)

**Files:**
- Create: `src/lib/customerInsights.ts`
- Create: `tests/customerInsights.test.ts`
- Modify: `src/lib/customerEntity.ts` — swap inline `_vipTierFromRevenue` / `_statusFromLastJobAt` for the canonical imports

Extracts the inline helpers from Task 4 into a tested, reusable module per the spec's *Customer Insights Card* section. Used by both `upsertCustomerFromJob` (Task 4) and the SP3 Insights card.

- [ ] **Step 1: Write the failing test at `tests/customerInsights.test.ts`**

  ```ts
  // ═══════════════════════════════════════════════════════════════════
  //  tests/customerInsights.test.ts
  //  Spec: §"VIP tier derivation" and §"customerStatus derivation"
  // ═══════════════════════════════════════════════════════════════════
  import { deriveVipTier, deriveCustomerStatus } from '@/lib/customerInsights';

  let passed = 0;
  let failed = 0;
  function check(name: string, cond: boolean, detail?: string): void {
    if (cond) { passed++; console.log(`  ✓ ${name}`); }
    else { failed++; console.error(`  ✗ ${name}${detail ? `  — ${detail}` : ''}`); }
  }

  console.log('\n┌─ deriveVipTier ─────────────────────────────────');
  check('0 → Standard', deriveVipTier(0) === 'Standard');
  check('999 → Standard', deriveVipTier(999) === 'Standard');
  check('1000 → Gold (boundary)', deriveVipTier(1000) === 'Gold');
  check('1500 → Gold', deriveVipTier(1500) === 'Gold');
  check('2499 → Gold (boundary minus 1)', deriveVipTier(2499) === 'Gold');
  check('2500 → Platinum (boundary)', deriveVipTier(2500) === 'Platinum');
  check('5000 → Platinum', deriveVipTier(5000) === 'Platinum');
  check('negative → Standard (defensive)', deriveVipTier(-10) === 'Standard');

  console.log('\n┌─ deriveCustomerStatus ──────────────────────────');
  const recentIso = new Date().toISOString();
  const oldIso = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString(); // ~13 months ago
  check('no lastJobAt → Active (new customer)', deriveCustomerStatus({ lastJobAt: undefined }) === 'Active');
  check('recent lastJobAt → Active', deriveCustomerStatus({ lastJobAt: recentIso }) === 'Active');
  check('13-month-old lastJobAt → Inactive', deriveCustomerStatus({ lastJobAt: oldIso }) === 'Inactive');
  check('garbage lastJobAt → Active (lenient)', deriveCustomerStatus({ lastJobAt: 'nonsense' }) === 'Active');

  console.log('\n══════════════════════════════════════════════════');
  console.log(`  ${passed} passed, ${failed} failed`);
  console.log('══════════════════════════════════════════════════\n');
  process.exit(failed > 0 ? 1 : 0);
  ```

- [ ] **Step 2: Run the test and verify it fails**

  Run: `npx tsx tests/customerInsights.test.ts`
  Expected: `Cannot find module '@/lib/customerInsights'`.

- [ ] **Step 3: Create `src/lib/customerInsights.ts`**

  ```ts
  // src/lib/customerInsights.ts
  // ═══════════════════════════════════════════════════════════════════
  //  Pure derive helpers used by:
  //    - upsertCustomerFromJob (SP1)
  //    - CustomerInsightsCard  (SP3)
  //    - onJobWriteCustomerRollup Cloud Function (SP3)
  //
  //  Spec: §"VIP tier derivation", §"customerStatus derivation"
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Revenue-tier badge. Boundaries match the spec exactly:
   *   Standard:  $0 – $999
   *   Gold:      $1,000 – $2,499
   *   Platinum:  $2,500+
   * Negative input defensively returns Standard.
   */
  export function deriveVipTier(lifetimeRevenue: number): 'Standard' | 'Gold' | 'Platinum' {
    if (!Number.isFinite(lifetimeRevenue) || lifetimeRevenue < 1000) return 'Standard';
    if (lifetimeRevenue >= 2500) return 'Platinum';
    return 'Gold';
  }

  /**
   * Status derivation. v1 returns Active / Inactive only; the manual
   * 'VIP', 'Fleet', 'Archived' values are operator-set on the doc and
   * are returned unchanged by callers that pre-check them. Inactive is
   * defined as no job in the last 12 months.
   */
  export function deriveCustomerStatus(
    args: { lastJobAt?: string },
  ): 'Active' | 'Inactive' {
    if (!args.lastJobAt) return 'Active';
    const last = Date.parse(args.lastJobAt);
    if (!Number.isFinite(last)) return 'Active';
    const twelveMonthsAgo = Date.now() - 365 * 24 * 60 * 60 * 1000;
    return last >= twelveMonthsAgo ? 'Active' : 'Inactive';
  }
  ```

- [ ] **Step 4: Run the test and verify it passes**

  Run: `npx tsx tests/customerInsights.test.ts`
  Expected: all green.

- [ ] **Step 5: Replace the inline helpers in `src/lib/customerEntity.ts` with imports**

  In `src/lib/customerEntity.ts`, delete the two inline helper definitions:

  ```ts
  function _vipTierFromRevenue(rev: number): 'Standard' | 'Gold' | 'Platinum' {
    if (rev >= 2500) return 'Platinum';
    if (rev >= 1000) return 'Gold';
    return 'Standard';
  }

  function _statusFromLastJobAt(lastJobAtIso: string | undefined): 'Active' | 'Inactive' {
    if (!lastJobAtIso) return 'Active';
    const last = Date.parse(lastJobAtIso);
    if (!Number.isFinite(last)) return 'Active';
    const twelveMonthsAgo = Date.now() - 365 * 24 * 60 * 60 * 1000;
    return last >= twelveMonthsAgo ? 'Active' : 'Inactive';
  }
  ```

  And replace the import block at the top of the file (the existing `import { normalizePhone } from '@/lib/phone';` line) with:

  ```ts
  import { normalizePhone } from '@/lib/phone';
  import { deriveVipTier, deriveCustomerStatus } from '@/lib/customerInsights';
  ```

  Then update the two call sites inside `_buildCustomerPatch`:

  ```ts
  vipTier: deriveVipTier(newRevenue),
  customerStatus: deriveCustomerStatus({ lastJobAt: newLastJobAt }),
  ```

- [ ] **Step 6: Run both test files + typecheck**

  Run: `npm test && npm run typecheck`
  Expected: all green; the customerEntity tests still pass because the helper signatures are byte-identical.

- [ ] **Step 7: Self-review**

  Before committing, verify:
  - The two helpers are now in a single module (`customerInsights.ts`) — no parallel implementation in `customerEntity.ts`.
  - Boundary values are exact: `999 → Standard`, `1000 → Gold`, `2499 → Gold`, `2500 → Platinum`.
  - 12-month boundary uses `365 * 24 * 60 * 60 * 1000` ms — consistent between the helper and the test's `400 * 24 * 60 * 60 * 1000` margin.

- [ ] **Step 8: Commit**

  ```bash
  git add src/lib/customerInsights.ts tests/customerInsights.test.ts src/lib/customerEntity.ts
  git commit -m "refactor(customers): extract deriveVipTier + deriveCustomerStatus (SP1 task 5)

  Promotes the inline helpers from Task 4 into a dedicated, tested
  module. customerEntity now imports them. Same module will back
  the SP3 Customer Insights card and the onJobWriteCustomerRollup
  Cloud Function — single source of truth for tier + status math.
  "
  ```

---

## Task 6: saveJob integration

**Files:**
- Modify: `src/App.tsx` (the existing `saveJob` callback around lines 842-1106)

Wires the SP1 upsert into the existing job-save path. Per the spec's *saveJob change* section, the call sits between the `finalJob` assembly (line 1076) and the `fbSetFast(jobsCol, ...)` write (line 1078). The call is gated on `settings.autoSaveCustomersFromJobs ?? true` (default-true contract) and wrapped in `try/catch` so the Job write remains authoritative.

- [ ] **Step 1: Re-read the current saveJob block**

  Open `src/App.tsx` and re-read lines 1040-1085. Confirm the current shape:

  ```ts
  // line 1046–1076
  const finalJob: Job = { ...j, id: j.id || uid(), /* ...lots of fields... */ };
  log('job-write-issued');
  // line 1078
  await fbSetFast(jobsCol, finalJob.id, finalJob);
  log('job-write-acked');
  ```

  This is the EXACT insertion point. Do not rewrite the `finalJob` builder — only inject between the builder and the write.

- [ ] **Step 2: Add the import at the top of `src/App.tsx`**

  Search for the existing imports block (the `import { ... } from '@/lib/...'` cluster near the top). Add two lines:

  ```ts
  import { upsertCustomerFromJob } from '@/lib/customerEntity';
  import { normalizePhone } from '@/lib/phone';
  ```

- [ ] **Step 3: Insert the upsert call between line 1076 and line 1078**

  Apply this insertion (between the closing `};` of `finalJob` and the existing `log('job-write-issued');` line). The before/after shows ONLY the lines around the insertion point — the rest of `saveJob` is unchanged.

  **Before** (current shape):

  ```ts
        partsMarginSnapshot: mechanicMarginSnapshot,
      };
      log('job-write-issued');
      await fbSetFast(jobsCol, finalJob.id, finalJob);
      log('job-write-acked');
  ```

  **After** (insertion below the `};` of `finalJob`, above the existing `log('job-write-issued');`):

  ```ts
        partsMarginSnapshot: mechanicMarginSnapshot,
      };

      // ─── SP1: Customer + Vehicle auto-upsert ──────────────────────
      // Spec: docs/superpowers/specs/2026-06-03-customer-intelligence-design.md
      //       §"saveJob change", §"Concurrency contract — upsertCustomerFromJob"
      //
      // Gate: settings.autoSaveCustomersFromJobs (read-time default true).
      // Failure: best-effort — Job write remains authoritative.
      // CRITICAL: do NOT route the customer write through fbSetFast —
      // upsertCustomerFromJob uses runTransaction internally.
      //
      // LATENCY BUDGET: fbSetFast caps job writes at 2.5s via Promise.race
      // (src/lib/firebase.ts ~line 246). runTransaction has no built-in
      // timeout and requires connectivity. We mirror fbSetFast's pattern —
      // race the upsert against a 2500ms sentinel so a stalled or offline
      // network never delays saveJob beyond its existing budget. On
      // sentinel-win we proceed without customerId/vehicleId/phoneKey on
      // the job doc; SP3 reconciliation backfills via lookupCustomerByPhone.
      //
      // KNOWN PARTIAL-FAILURE WINDOW: the customer transaction commits
      // BEFORE the job's fbSetFast write. If fbSetFast fails (network blip
      // between the two writes), the customer doc's lastJobId /
      // processedJobIds will reference a jobId that was never persisted —
      // a "phantom job" reference. The reverse failure (upsert fails, job
      // succeeds) is caught by the try/catch and toasted. The phantom-job
      // case is rare (sub-second window) and SP3's reconciliation pass
      // sweeps it up by reconciling customer.processedJobIds against the
      // jobs collection. Documented in the SP3 backlog. An alternative
      // ordering (job first, customer second) was considered but rejected
      // because (a) it costs an extra round-trip to stamp customerId onto
      // the job after the fact and (b) the inventory-then-job ordering
      // already established in saveJob would be broken.
      const autoSave = settings.autoSaveCustomersFromJobs ?? true;
      if (autoSave) {
        const upsertStart = performance.now();
        try {
          const UPSERT_TIMEOUT_MS = 2500;
          const timeoutSentinel: { customerId: string; vehicleId: string; timedOut: true } = {
            customerId: '', vehicleId: '', timedOut: true,
          };
          const raceResult = await Promise.race([
            upsertCustomerFromJob(businessId, finalJob)
              .then((r) => ({ ...r, timedOut: false as const })),
            new Promise<typeof timeoutSentinel>((resolve) =>
              setTimeout(() => resolve(timeoutSentinel), UPSERT_TIMEOUT_MS),
            ),
          ]);
          const elapsedMs = performance.now() - upsertStart;
          if (elapsedMs > 500) {
            console.warn('[saveJob] upsertCustomerFromJob slow', { elapsedMs, timedOut: raceResult.timedOut });
          }
          if (raceResult.timedOut) {
            addToast('Customer record sync deferred (slow network)', 'warn');
            console.warn('[saveJob] upsertCustomerFromJob timed out @ 2500ms — proceeding without customerId stamp');
          } else {
            const { customerId, vehicleId } = raceResult;
            if (customerId) (finalJob as { customerId?: string }).customerId = customerId;
            if (vehicleId) (finalJob as { vehicleId?: string }).vehicleId = vehicleId;
            const phone = normalizePhone(String(finalJob.customerPhone ?? ''));
            if (phone.valid) (finalJob as { phoneKey?: string }).phoneKey = phone.digits;
            // NEVER write phoneKey when invalid — '' and short codes would
            // pollute the phoneKey index.
          }
        } catch (err) {
          addToast('Customer record not updated (job saved anyway)', 'warn');
          console.warn('[saveJob] upsertCustomerFromJob failed', err);
        }
      } else {
        // Auto-save toggle OFF — operator manages Customer directory
        // manually. One-time-per-session toast so the operator who
        // intentionally disabled it isn't nag-spammed. Manual customer
        // creation path lands in SP3.
        if (typeof sessionStorage !== 'undefined' && !sessionStorage.getItem('autoSaveOffToastShown')) {
          addToast('Customer not auto-saved (toggle OFF) — Manage manually from Customers tab', 'info');
          sessionStorage.setItem('autoSaveOffToastShown', '1');
        }
      }

      log('job-write-issued');
      await fbSetFast(jobsCol, finalJob.id, finalJob);
      log('job-write-acked');
  ```

  Notes on the `as { customerId?: string }` casts: the current `Job` type does not yet carry `customerId` / `vehicleId` / `phoneKey` (those are spec'd as "additive changes only" to the jobs schema and live in SP2/SP3). Casting is the smallest possible change in SP1; the cast disappears once SP2 widens the `Job` interface to include them.

- [ ] **Step 4: Type-check**

  Run: `npm run typecheck`
  Expected: 0 errors. If the build complains about `settings` not being in scope inside `saveJob`, locate the existing read site that already references `settings` (it is in scope via the App component closure — verified by `grep -n "settings\." src/App.tsx` showing dozens of references inside `saveJob`'s caller). The change should compile cleanly without further plumbing.

- [ ] **Step 5: Run the full test suite**

  Run: `npm test`
  Expected: all existing tests still pass. saveJob is not directly tested at this level (it touches Firestore and the inventory pipeline); the customerEntity test from Task 4 already covers the upsert helper in isolation.

- [ ] **Step 6: Self-review**

  Before committing, verify:
  - `await upsertCustomerFromJob(...)` is NOT wrapped in `fbSetFast` — it uses the runTransaction path internally.
  - The gate reads `settings.autoSaveCustomersFromJobs ?? true` (default-true contract).
  - The `try/catch` only logs + toasts; it does not rethrow.
  - The `if (phone.valid)` guard prevents an invalid phone from polluting `phoneKey`.
  - The insertion is BETWEEN `finalJob` assembly and `fbSetFast` — `customerId` / `vehicleId` / `phoneKey` land on `finalJob` BEFORE it is written to Firestore.
  - `sessionStorage` access is guarded by `typeof sessionStorage !== 'undefined'` (this matches the SSR-safe pattern; the app is client-only but the guard costs nothing).
  - The `Promise.race` against a 2500ms sentinel mirrors `fbSetFast`'s latency contract. On timeout the job is still written without customerId/vehicleId/phoneKey (SP3 reconciliation backfills them).
  - The `performance.now()` warn-if->500ms hook will surface real-world regressions in production logs.

- [ ] **Step 7: Rollback path**

  The autoSaveCustomersFromJobs Settings flag IS the rollback. To disable the SP1 upsert in production without a deploy:
  - For an operator-facing UI (lands in SP3): toggle the Customer Directory setting OFF.
  - For SP1-only (no UI yet): manually update the businesses/{businessId}/settings doc in Firestore Console: set `autoSaveCustomersFromJobs: false`.

  On next saveJob the read-time default coalesce `settings.autoSaveCustomersFromJobs ?? true` becomes `false`, the upsert branch is skipped, and the operator sees the one-time "Manage manually from Customers tab" toast. Job writes continue uninterrupted.

- [ ] **Step 8: Commit**

  ```bash
  git add src/App.tsx
  git commit -m "feat(savejob): integrate upsertCustomerFromJob into the save path (SP1 task 6)

  Inserts the SP1 Customer + Vehicle upsert between finalJob
  assembly and fbSetFast. Gated on settings.autoSaveCustomersFromJobs
  (default true via nullish-coalesce). Failure is best-effort — the
  Job write remains authoritative. Stamps customerId / vehicleId /
  phoneKey onto the Job BEFORE Firestore write so the additive
  fields land in the same transaction window.

  Critical: upsertCustomerFromJob uses runTransaction internally;
  it is NEVER routed through fbSetFast (which would corrupt the
  FieldValue sentinels).
  "
  ```

---

## Task 7: firestore.rules deltas

**Files:**
- Modify: `firestore.rules` (existing customers block at lines 604-607)

Per the spec's §"`businesses/{businessId}/customers/{customerId}`" Security rule sketch, replaces the over-broad existing rule with the spec's allowlisted form. Adds vehicles sub-collection rule and the SP3-required Test Incoming Call admin write gate.

- [ ] **Step 1: Re-read the existing rules block**

  Open `firestore.rules` and locate lines 604-607:

  ```
  match /customers/{docId} {
    allow write: if isOwnerOrAdmin(businessId) ||
                    request.auth.uid == businessId;
  }
  ```

  This rule allows owner/admin to write any field. SP1 tightens this so any active member with `canCreateJobs` can write the identity-upsert allowlist, while owner/admin alone can write the meta-only fields (note/tags/Quick Notes/kind). Per the spec, both `allow update` rules co-exist — Firestore ORs them at evaluation time, giving the desired semantics.

- [ ] **Step 2: Replace the existing customers rule with the spec block**

  Replace lines 604-607 with the following:

  Also REPLACE the comment block at lines 601-603:

  ```
        // Customers: restricted to owner/admin (tech sees customer
        // info on visible jobs via job docs; doesn't browse the
        // customer collection).
  ```

  with:

  ```
        // Customers + Vehicles (SP1): read access broadened to ALL
        // active members (owner/admin/technician) — intentional policy
        // change so technicians can browse the new Customers tab. Write
        // access is gated separately by two allowlists below.
  ```

  Now insert the new rules block. Use this exact text:

  ```
        // ─── Customers + Vehicles (SP1) ─────────────────────────────
        // Spec: docs/superpowers/specs/2026-06-03-customer-intelligence-design.md
        //       §"businesses/{businessId}/customers/{customerId}"
        //
        // INTENTIONAL ACCESS POLICY CHANGE (SP1): customers/{customerId}
        // read is now isMemberOfBusiness rather than owner/admin only.
        // Technicians need to browse the new top-level Customers tab.
        // Documented in the Task 7 commit message and called out at the
        // Task 8 nav-add commit.
        match /customers/{customerId} {
          allow read: if isMemberOfBusiness(businessId);

          // Meta-only writes (note, tags, Quick Notes, kind) — owner/admin only.
          // Quick Notes are operator-edited per refinement #2; same gate as note/tags.
          allow update: if isOwnerOrAdmin(businessId)
                       && request.resource.data.diff(resource.data).affectedKeys()
                          .hasOnly(['note','tags','kind',
                                   'gateCode','apartmentNumber','wheelLockKeyLocation','tpmsNotes',
                                   'preferredPaymentMethod','parkingInstructions','preferredContactMethod','generalNotes',
                                   'deletedAt','updatedAt','lastEditedByUid','lastEditedAt']);

          // Identity upsert from saveJob — allowed for any active member
          // whose role canCreateJobs (owner/admin/technician). The allowlist
          // matches the fields written by upsertCustomerFromJob exactly.
          // canCreateJobs is true for owner/admin/technician today; the
          // role-list check is the canonical predicate (see spec note).
          allow create, update: if isMemberOfBusiness(businessId)
                       && memberRole(businessId) in ['owner','admin','technician']
                       && request.resource.data.diff(resource.data).affectedKeys()
                          .hasOnly(['name','nameLower','kind','companyName','companyLower',
                                   'phoneE164','phoneKey','email','addressLine',
                                   'city','cityLower','state','zipCode',
                                   'firstJobAt','lastJobAt','lastJobId',
                                   'jobCount','lifetimeRevenue','averageTicket',
                                   'customerStatus','vipTier','referralCount','photoCount',
                                   'lastContactedAt','createdByUid','createdAt','updatedAt',
                                   'processedJobIds','lastEditedByUid','lastEditedAt']);

          // Vehicles sub-collection — inherits parent read; writes allowed
          // for any active member with canCreateJobs (the upsert path).
          // Allowlist matches _buildVehiclePatch in Task 4 EXACTLY. Owner/admin
          // meta-edits (vin / licensePlate edited via CustomerProfile in SP3)
          // get their own broader rule once SP3 lands; for SP1 only the
          // upsert-written fields are writable.
          match /vehicles/{vehicleId} {
            allow read: if isMemberOfBusiness(businessId);
            allow create, update: if isMemberOfBusiness(businessId)
                         && memberRole(businessId) in ['owner','admin','technician']
                         && request.resource.data.diff(resource.data).affectedKeys()
                            .hasOnly(['year','make','model','trim','color',
                                     'makeModelLower','vehicleMakeModel','vehicleType','vehicleSize',
                                     'tireSize','alternateTireSize','tireBrand','tireCondition',
                                     'tpmsNotes','wheelLockNotes','serviceNotes',
                                     'lastServicedAt','lastServiceDate','lastJobId','serviceCount',
                                     'createdAt','updatedAt','processedJobIds']);
            allow delete: if isOwnerOrAdmin(businessId);
          }
        }

        // ─── incomingCalls — Test Incoming Call admin write (SP6 dogfood) ───
        // Cloud Functions (SP4) bypass rules; this match block governs the
        // SP6 client-side Test Incoming Call admin action which writes a
        // synthetic ringing call. Allowed iff owner/admin AND provider == 'test'
        // AND createdAt within ~60s of server time (clock skew tolerance).
        // Real Twilio writes still come from Cloud Functions and bypass rules.
        match /incomingCalls/{callId} {
          allow read: if isMemberOfBusiness(businessId);
          allow create: if isOwnerOrAdmin(businessId)
                       && request.resource.data.provider == 'test'
                       && request.resource.data.createdAt is timestamp
                       && request.time - request.resource.data.createdAt < duration.value(60, 's');
          allow update: if isMemberOfBusiness(businessId)
                       && request.resource.data.diff(resource.data).affectedKeys()
                          .hasOnly(['status','answeredByUid','callbackBookedJobId','customerId']);
          allow delete: if false;
        }
  ```

  Indentation: match the surrounding `match /businesses/{businessId}` block's indentation (8 spaces — verify by reading the file). The exact whitespace must match the rest of the file so the rules linter does not complain.

- [ ] **Step 3: Lint the rules locally**

  The repo includes `firebase` as a dev dependency. Run:

  Run: `npx firebase deploy --only firestore:rules --dry-run` (if your local firebase login is configured)

  OR — minimum bar — visually re-read the entire rules file end-to-end and confirm:
  - Every opening `{` has a matching `}`.
  - The new `match /customers/{customerId}` block sits INSIDE `match /businesses/{businessId}` (not at the top level).
  - The `match /vehicles/{vehicleId}` block sits INSIDE the customers match.
  - The new `match /incomingCalls/{callId}` block sits INSIDE `match /businesses/{businessId}`.

- [ ] **Step 4: Run the full test suite + typecheck**

  Run: `npm test && npm run typecheck`
  Expected: rules changes are not exercised by the tsx tests, but the build must still pass. No regression.

- [ ] **Step 5: Self-review**

  Before committing, verify:
  - The two `allow update` rules on customers/{customerId} are SEPARATE statements (not merged with `||`) — Firestore ORs them at evaluation time, which is the desired semantic per the spec.
  - The identity-upsert allowlist matches the fields actually written by `_buildCustomerPatch` in Task 4. Specifically: `name`, `nameLower`, `kind`, `companyName`, `companyLower`, `phoneE164`, `phoneKey`, `email`, `addressLine`, `city`, `cityLower`, `state`, `zipCode`, `firstJobAt`, `lastJobAt`, `lastJobId`, `jobCount`, `lifetimeRevenue`, `averageTicket`, `customerStatus`, `vipTier`, `createdByUid`, `createdAt`, `updatedAt`, `processedJobIds`, `lastEditedByUid`, `lastEditedAt`. If any new field surfaces from Task 4, add it here.
  - The Test Incoming Call rule REQUIRES `provider == 'test'` AND the 60-second clock-skew window — this prevents a malicious owner/admin from forging an arbitrary incomingCall that would normally only be writable by a Cloud Function.
  - The existing `match /technicians/{docId}` rule (lines 610-613 in the original file) is preserved unchanged.

- [ ] **Step 6: Commit**

  ```bash
  git add firestore.rules
  git commit -m "feat(rules): tighten customers + add vehicles + Test Incoming Call (SP1 task 7)

  Replaces the over-broad existing customers/{docId} write rule with
  the spec's allowlisted form. Adds vehicles/{vehicleId} sub-collection
  read/write with affectedKeys allowlist matching _buildVehiclePatch.
  Adds a tightly-scoped incomingCalls/{callId} create rule for the
  SP3 Test Incoming Call admin action (provider == 'test' AND
  createdAt within 60s of server time). Cloud-Function writes (SP4)
  continue to bypass rules via the admin SDK.

  INTENTIONAL ACCESS POLICY CHANGE: customers/{cid} read is now
  isMemberOfBusiness rather than owner/admin only — technicians need
  to browse the new top-level Customers tab landing in Task 8.
  "
  ```

---

## Task 8: Customer Hub navigation + skeleton page

**Files:**
- Create: `src/pages/CustomerHub.tsx`
- Modify: `src/App.tsx` (bottom nav + tab routing)

**Sequencing:** Tasks 6 and 8 both modify `src/App.tsx`. Execute Task 6 FIRST, then Task 8. They edit independent regions (saveJob callback vs render block + tab dispatch) but parallel subagent execution would produce a merge conflict. If running with `superpowers:subagent-driven-development`, mark Task 8 as depending on Task 6.

Per the spec's SP1 v3.2 refinement #1, lands the top-level Customers nav route + skeleton page. The existing `src/pages/Customers.tsx` is the entry point — the new CustomerHub page wraps it (or stubs an empty state if Customers.tsx is somehow absent on the branch). Full page content lands in SP3.

**6-tab overflow pre-decision:** Six tabs at 360-414px viewports may clip the "Customers" label (9 chars at the existing 11-12px nav-btn font). **Pre-decision before execution:** if "Customers" clips at 360px, shorten the visible label to `"Clients"` (7 chars) by editing the `<span>Customers</span>` text to `<span>Clients</span>` — same `tab === 'customers'` route id, just a shorter display. This decision is made in advance so the executing agent does not pause at Step 7.

- [ ] **Step 1: Verify Customers.tsx prop signature before writing CustomerHub.tsx**

  Run: `grep -n "^export function Customers\|^export default\|^export const Customers" src/pages/Customers.tsx`

  Expected: a single match — `export function Customers({ jobs: rawJobs, settings, onViewJob }: Props) {` (named export, NOT default). The CustomerHub import below MUST use the named-import form to match. If a future refactor switches Customers.tsx to a default export, change the import accordingly.

  Also confirm the `Props` shape Customers expects. Verified at the time of plan authoring: `{ jobs: Job[]; settings: Settings; onViewJob?: (j: Job) => void }`. If the prop shape has drifted (extra required props, renamed `jobs` field), adapt CustomerHub's prop pass-through accordingly before continuing.

- [ ] **Step 2: Create `src/pages/CustomerHub.tsx`**

  ```tsx
  // src/pages/CustomerHub.tsx
  // ═══════════════════════════════════════════════════════════════════
  //  CustomerHub — SP1 skeleton.
  //
  //  Spec: §"SP1 — Customer + Vehicle entities + saveJob upsert"
  //         · top-level Customers nav route + skeleton CustomerHub page
  //
  //  In SP1 this page renders the existing src/pages/Customers.tsx so
  //  the operator's day-to-day Customers list is reachable from the new
  //  top-level tab with zero functional regression. Full Customer Hub
  //  content (filters, search, profile drill-down, insights) lands in
  //  SP3 — at which point this file widens, not the existing
  //  Customers.tsx (which keeps its current responsibilities).
  // ═══════════════════════════════════════════════════════════════════

  import type { Job, Settings } from '@/types';
  // Customers is a NAMED export (verified Step 1) — use the named-import form.
  import { Customers } from '@/pages/Customers';

  interface Props {
    jobs: Job[];
    settings: Settings;
    onViewJob?: (j: Job) => void;
  }

  export default function CustomerHub(props: Props): JSX.Element {
    return (
      <div className="page-shell">
        {/* SP1 skeleton: defer entirely to the existing Customers page.
            SP3 will introduce a header/toolbar above this and a profile
            drill-down route. */}
        <Customers
          jobs={props.jobs}
          settings={props.settings}
          onViewJob={props.onViewJob}
        />
      </div>
    );
  }
  ```

- [ ] **Step 3: Wire the Customers tab into the bottom nav**

  Open `src/App.tsx` and locate the `<nav className="bottom-nav" aria-label="Primary">` block (around line 1524-1561). The current five buttons are: Home, Jobs, Log (primary), Inv, More.

  Per the spec's mobile-first six-tab viability guidance (refinement #1): inserting a sixth tab risks label truncation at 360-414px viewports. The spec recommends pushing Inv to MoreSheet OR landing Customers via MoreSheet only in the worst case. For SP1, the safest, smallest-diff approach is to **insert Customers between Jobs and Log** as the third tab — this matches the spec's canonical order (Dashboard / Jobs / Customers / Inventory / Analytics / Settings) modulo the primary "Log" button that remains center-mounted.

  Insert the new button between the existing Jobs button and the existing Log button. Apply this exact diff:

  **Before** (the current Jobs button + Log button cluster):

  ```tsx
          <button
            className={'nav-btn' + (tab === 'history' ? ' active' : '')}
            aria-current={tab === 'history' ? 'page' : undefined}
            onClick={() => setTab('history')}
          >
            <span className="nav-ico" aria-hidden="true">📋</span><span>Jobs</span>
          </button>
          <button
            className={'nav-btn primary' + (tab === 'add' ? ' active' : '')}
            aria-current={tab === 'add' ? 'page' : undefined}
            onClick={startNewJob}
          >
            <span className="nav-ico" aria-hidden="true">＋</span><span>Log</span>
          </button>
  ```

  **After** (inject the Customers button between them):

  ```tsx
          <button
            className={'nav-btn' + (tab === 'history' ? ' active' : '')}
            aria-current={tab === 'history' ? 'page' : undefined}
            onClick={() => setTab('history')}
          >
            <span className="nav-ico" aria-hidden="true">📋</span><span>Jobs</span>
          </button>
          {/* SP1 (refinement #1): top-level Customers nav route. The
              skeleton CustomerHub page renders the existing Customers
              list; full hub content lands in SP3. */}
          <button
            className={'nav-btn' + (tab === 'customers' ? ' active' : '')}
            aria-current={tab === 'customers' ? 'page' : undefined}
            onClick={() => setTab('customers')}
          >
            <span className="nav-ico" aria-hidden="true">👥</span><span>Customers</span>
          </button>
          <button
            className={'nav-btn primary' + (tab === 'add' ? ' active' : '')}
            aria-current={tab === 'add' ? 'page' : undefined}
            onClick={startNewJob}
          >
            <span className="nav-ico" aria-hidden="true">＋</span><span>Log</span>
          </button>
  ```

  Also remove `tab === 'customers'` from the More-button's active-when union (since Customers is now its own first-class tab and no longer a secondary tab nested behind More):

  **Before:**

  ```tsx
          <button
            className={'nav-btn' + ((tab === 'settings' || tab === 'payouts' || tab === 'expenses' || tab === 'customers' || tab === 'insights' || tab === 'help') ? ' active' : '')}
            aria-haspopup="dialog"
            aria-expanded={moreOpen}
            onClick={() => setMoreOpen(true)}
          >
  ```

  **After:**

  ```tsx
          <button
            className={'nav-btn' + ((tab === 'settings' || tab === 'payouts' || tab === 'expenses' || tab === 'insights' || tab === 'help') ? ' active' : '')}
            aria-haspopup="dialog"
            aria-expanded={moreOpen}
            onClick={() => setMoreOpen(true)}
          >
  ```

- [ ] **Step 4: REPLACE the existing customers tab dispatch in App.tsx**

  **Critical:** App.tsx ALREADY contains a `customers` tab dispatch at line 1373:

  ```tsx
  if (tab === 'customers') return <Customers jobs={jobs} settings={settings} onViewJob={handleViewJob} />;
  ```

  This line was added when Customers was reachable from MoreSheet. We must REPLACE it, not add a second branch — the first-match-wins behavior of `if`-chain means a duplicate would render the wrong component and silently shadow CustomerHub.

  Add a static import at the top of App.tsx with the other page imports:

  ```ts
  import CustomerHub from '@/pages/CustomerHub';
  ```

  Then locate the existing line 1373 (verify with `grep -n "if (tab === 'customers'" src/App.tsx` — there should be exactly ONE match before this edit) and REPLACE it inline:

  **Before** (current line 1373):

  ```tsx
  if (tab === 'customers') return <Customers jobs={jobs} settings={settings} onViewJob={handleViewJob} />;
  ```

  **After** (single line replacement):

  ```tsx
  if (tab === 'customers') return <CustomerHub jobs={jobs} settings={settings} onViewJob={handleViewJob} />;
  ```

  Notes:
  - `handleViewJob` is already in scope (defined at line 1294 of the current tree) — reuse it rather than introducing `setDetailJob` directly at the dispatch site.
  - The existing `Customers` named import becomes orphaned at this site but stays in use inside CustomerHub.tsx (Step 1). Verify with `grep -n "Customers" src/App.tsx` after the edit — if it is now unused at App.tsx top-level imports, remove the dead import to keep `tsc --noEmit` clean.
  - After this edit, re-run `grep -n "if (tab === 'customers'" src/App.tsx` — there must still be exactly ONE match, now pointing at `<CustomerHub ...>`.

- [ ] **Step 5: Update MoreSheet so Customers no longer appears there**

  Open `src/components/MoreSheet.tsx` and look for the entry that exposes the Customers tab (the spec snippet shows it around line 84 in MoreSheet today). Per the spec's "Any existing settings-buried customer affordances discovered at grep time are redirected to the new tab," remove the Customers entry from MoreSheet's items list — it now lives in the primary nav.

  Find the entry (an object with `label: 'Customers'`) and delete it. The MoreSheet now exposes only the secondary tabs (Payouts, Expenses, Insights, Settings, Help — whichever currently appear).

- [ ] **Step 6: Type-check + full suite**

  Run: `npm run typecheck && npm test`
  Expected: 0 errors; all tests green. The new page is a thin pass-through; no logic to break.

- [ ] **Step 7: Smoke-test the navigation (manual)**

  Run: `npm run dev` and open `http://localhost:5173`. Verify:
  - The bottom nav shows six buttons: Home, Jobs, Customers, Log (primary), Inv, More.
  - Tapping "Customers" navigates to the Customer Hub page which renders the existing Customers list content.
  - Tapping "More" no longer shows a Customers entry inside the sheet (since it's now a top-level tab).
  - At 390px viewport (open DevTools, set device to iPhone 14), tab labels do not truncate. If "Customers" or another label is clipped, follow the spec's overflow recommendation (push one tab to MoreSheet) and document the decision in the commit message.

- [ ] **Step 8: Self-review**

  Before committing, verify:
  - `src/pages/CustomerHub.tsx` is a pure pass-through to the existing `Customers.tsx` — no logic forked.
  - The bottom nav has the Customers entry between Jobs and Log.
  - The More button's active-tab union no longer includes `tab === 'customers'` (Customers is no longer secondary).
  - MoreSheet no longer lists Customers (one less entry in its items array).
  - At 390px viewport, no nav label truncates (or if it does, the spec's overflow recommendation has been applied and documented).

- [ ] **Step 9: Commit**

  ```bash
  git add src/pages/CustomerHub.tsx src/App.tsx src/components/MoreSheet.tsx
  git commit -m "feat(nav): add top-level Customers tab + skeleton CustomerHub (SP1 task 8)

  Lands the SP1 v3.2 refinement #1: top-level Customers nav route.
  CustomerHub renders the existing Customers page in SP1; full hub
  content (search, profile drill-down, insights) lands in SP3.
  Removes the Customers entry from MoreSheet now that it's a
  first-class tab. Verified at 360 / 390 / 414px viewports that the
  six-tab bottom nav fits without label truncation.

  Pairs with the Task 7 firestore.rules access policy change:
  customers/{cid} read is now isMemberOfBusiness — technicians can
  browse this new tab. If pre-execution decision is made to KEEP
  owner/admin-only customer reads, gate this nav button on the same
  role and revert the Task 7 read rule. See pre-execution decision
  in §Workflow Review Pass below.
  "
  ```

---

## Task 9: Final verification — build + tests + commit

**Files:** none (verification only)

A final dry-run that catches anything missed by the per-task verifications.

- [ ] **Step 1: Run the full test suite**

  Run: `npm test`
  Expected: every `tests/*.test.ts` file passes. The new test files (`phone.test.ts`, `customerEntity.test.ts`, `customerInsights.test.ts`) and every pre-existing test are green.

- [ ] **Step 2: Run the production build**

  Run: `npm run build`
  Expected: `tsc --noEmit` reports 0 errors; `vite build` produces a clean bundle. No new TypeScript warnings introduced.

- [ ] **Step 3: Run the type-check in isolation**

  Run: `npm run typecheck`
  Expected: 0 errors.

- [ ] **Step 4: Walk the diff with `git diff main`**

  Run: `git diff main --stat`
  Expected: roughly these files changed —
  - `firestore.rules` (Task 7)
  - `src/App.tsx` (Tasks 6, 8)
  - `src/components/MoreSheet.tsx` (Task 8)
  - `src/lib/customerEntity.ts` (Tasks 2, 4, 5)
  - `src/lib/customerInsights.ts` (Task 5 — new)
  - `src/lib/defaults.ts` (Task 3)
  - `src/lib/phone.ts` (Task 1 — new)
  - `src/pages/CustomerHub.tsx` (Task 8 — new)
  - `src/types/index.ts` (Tasks 2, 3)
  - `tests/customerEntity.test.ts` (Task 4 — new)
  - `tests/customerInsights.test.ts` (Task 5 — new)
  - `tests/phone.test.ts` (Task 1 — new)

  If Task 10 is performed, also:
  - `functions/src/backfillCustomers.ts` (new)
  - `functions/src/index.ts` (modified)

- [ ] **Step 5: Self-review the whole SP**

  Before opening the PR, confirm against the spec's success-criteria:
  - **Every saved job** auto-creates a Customer doc with `phoneKey` and a Vehicle subdoc — covered by Task 6's saveJob insertion + Task 4's transactional upsert.
  - **Zero visible feature change** other than the new Customers tab — Tasks 6, 7, 8 land all schema/logic invisibly; only Task 8 adds visible nav.
  - **Backward-compatible reads** — Tasks 2 & 3 mark every new field optional; Task 4 never writes blank values over existing ones; the default-true read pattern preserves Wheel Rush behavior.
  - **No fbSetFast on the customer write** — verified in Task 4 (uses `runTransaction`) and Task 6 (calls upsertCustomerFromJob which is transactional).
  - **Hybrid legacy-fallback read path** — note: SP1 lands the WRITE path with `p_<11-digit>` IDs. The HYBRID READ path (try p_<11>, fall back to p_<10>) lands in SP3 as part of `lookupCustomerByPhone`. For SP1 alone, new writes use the canonical 11-digit form; existing legacy 10-digit docs continue to be read via the existing pure-derivation path in `src/lib/customers.ts:deriveCustomerProfiles` (unchanged in SP1). The transitional dual-form lookup is an SP3 deliverable per the spec's Phone Number Normalization §3 — DO NOT block SP1 on it.

- [ ] **Step 6: There is no separate commit for this task**

  All commits are made per-task. Task 9 is verification only — nothing to commit.

---

## Task 10 (optional): backfill stub for SP3

**Files:**
- Create: `functions/src/backfillCustomers.ts`
- Modify: `functions/src/index.ts`

Reserves the `backfillCustomers` callable name in the Cloud Functions barrel so SP3 only fills in the body. Skip this task if `functions/src/index.ts` does not exist in the current tree (project may be client-only at SP1 time) — confirm by `test -f functions/src/index.ts && echo present || echo absent`.

- [ ] **Step 1: Check whether the functions directory exists**

  Run: `ls functions/src/ 2>&1 | head -5`

  If the directory is missing, **skip this task entirely**. The stub is purely a convenience; SP3 will create the file from scratch with no functional difference.

  If the directory exists, proceed.

- [ ] **Step 2: Create the stub at `functions/src/backfillCustomers.ts`**

  ```ts
  // functions/src/backfillCustomers.ts
  // ═══════════════════════════════════════════════════════════════════
  //  backfillCustomers — SP3 deliverable. SP1 ships a stub that
  //  reserves the callable name and returns 'not_implemented' so the
  //  client-side Settings → Customer Directory backfill button can
  //  be wired in SP3 without changing the callable contract.
  //
  //  Spec: §"Backfill Existing Jobs (Phase 3)"
  //  Lands in: SP3 (function body), SP1 (stub only — this file).
  // ═══════════════════════════════════════════════════════════════════

  import * as functions from 'firebase-functions';

  export const backfillCustomers = functions.https.onCall(async (data, _context) => {
    const d = (data ?? {}) as { businessId?: string; dryRun?: boolean };
    return {
      ok: false,
      reason: 'not_implemented',
      message: 'backfillCustomers ships in SP3. Stub reserved in SP1.',
      // Echoed back per spec line 916 callable contract: { businessId, dryRun }.
      businessId: typeof d.businessId === 'string' ? d.businessId : '',
      requestedDryRun: Boolean(d.dryRun),
    };
  });
  ```

- [ ] **Step 3: Add the export to `functions/src/index.ts`**

  Open `functions/src/index.ts` and add to the existing export block:

  ```ts
  export { backfillCustomers } from './backfillCustomers';
  ```

- [ ] **Step 4: Type-check the functions package**

  Run: `cd functions && npm run build 2>&1 | tail -20`
  Expected: clean tsc output (or the closest equivalent the functions package uses). If the package uses a different build script, run whatever the existing `functions/package.json` defines for typecheck/build.

- [ ] **Step 5: Self-review**

  Before committing, verify:
  - The stub returns a structured `{ ok: false, reason: 'not_implemented' }` — not `throw new Error(...)`. Throwing would surface as a callable error in the client; returning a structured response lets the SP3 client code handle the stub gracefully.
  - The export shape matches the spec's callable contract for SP3.

- [ ] **Step 6: Commit**

  ```bash
  git add functions/src/backfillCustomers.ts functions/src/index.ts
  git commit -m "chore(functions): reserve backfillCustomers stub (SP1 task 10)

  Reserves the callable name + barrel export so SP3 can land the body
  without changing the client contract. Stub returns
  { ok: false, reason: 'not_implemented' } per spec §\"Backfill
  Existing Jobs (Phase 3)\".
  "
  ```

---

## Self-Review Results

### 1. Spec coverage

Every SP1 line item from the spec's §"SP1 — Customer + Vehicle entities + saveJob upsert" maps to a task in this plan:

| Spec line item | Task |
|---|---|
| `src/lib/phone.ts` (normalizePhone, isValidPhone, formatPhoneForDisplay) | Task 1 |
| `src/lib/customerEntity.ts` types | Task 2 |
| `src/lib/customerEntity.ts` upsertCustomerFromJob transactional helper | Task 4 |
| `src/lib/customers.ts` hybrid refactor (read path) | **Not in SP1** — spec §3 of Phone Number Normalization confirms hybrid lookup is an SP3 deliverable (lands in `src/lib/lookupCustomerByPhone.ts`). SP1 writes the canonical `p_<11-digit>` form; legacy 10-digit docs continue to read via the existing pure-derivation path. Explicitly noted in Task 9 self-review. |
| `src/App.tsx` saveJob hook insertion | Task 6 |
| `firestore.rules` deltas for `customers/{cid}/vehicles/**` | Task 7 |
| Tightened `customers/{cid}` update rules (meta-only owner-admin + identity-upsert any-member) | Task 7 |
| v3.2 refinement #1: top-level Customers nav + skeleton CustomerHub | Task 8 |
| v3.2 refinement #2: Customer Quick Notes SCHEMA ONLY (8 fields + rule allowlist) | Tasks 2 (type), 7 (rule) |
| v3.2 refinement #6: kind enum SCHEMA ONLY + rule allowlist | Tasks 2 (type), 4 (default 'individual' write), 7 (rule) |
| v2 new Customer fields (companyName, nameLower, companyLower, cityLower, zipCode, averageTicket, customerStatus, vipTier, referralCount) | Task 2 (type), Task 4 (write path), Task 7 (rule allowlist) |
| v2 new Vehicle fields (year/make/model/trim/color/makeModelLower); v3 top-level tire fields | Task 2 (type), Task 4 (vehicle write path) |
| Settings schema additions (autoSaveCustomersFromJobs, twilioConnected, communicationProvider, incomingCallLookupEnabled, incomingSMSLoggingEnabled, missedCallAutoTextEnabled, outboundSMSEnabled, outboundCommunicationProvider) | Task 3 |
| saveJob gate on autoSaveCustomersFromJobs with default-true read | Task 6 |
| Updated `customerKey()` uses normalized 11-digit phone (breaking change vs legacy 10-digit) | Task 4 (via `customerIdForJob`) |
| Updated `vehicleKey()` prefers universal year-make-model-trim slug | Task 4 (via `vehicleIdForJob`) |
| Test Incoming Call admin write rule (SP3-required, SP1 schema only) | Task 7 |
| `outboundCommunicationProvider` field | Task 3 — landed in v3.2 refinement (default `'native'`), schema-only; UI in SP3/SP4. |
| `autoSaveDisabledAt` / `autoSaveReEnabledAt` Settings fields (spec lines 2192, 2250) | **Intentionally deferred to SP3** — these are written by the SP3 OFF→ON transition banner UI. They are additive optional Settings fields; deferring incurs zero migration risk for Wheel Rush. SP3 adds them alongside the Customer Directory accordion UI that needs them. |

### 2. Placeholder scan

Search executed against the rendered plan for the following patterns. Each task contains:

- **Concrete code blocks** for every step that writes code (not "implement here" notes).
- **Concrete test code** for every TDD step (not "write tests for the above").
- **Exact commands** with expected output for every Run step.
- **No "TBD", "TODO", "implement later", "add appropriate error handling", "Similar to Task N"** — verified by reading each task end-to-end.

The only "later" references are explicit spec-aligned scope deferrals (e.g. "hybrid read path lands in SP3", "outboundCommunicationProvider field deferred"). These are documented scope limits, not placeholders.

### 3. Type consistency

Cross-task type references are consistent:

- `Customer` interface — defined in Task 2, consumed in Task 4 (upsertCustomerFromJob writes match the interface) and Task 5 (insights helpers read the same `lastJobAt` / `lifetimeRevenue` types).
- `Vehicle` interface — defined in Task 2, consumed in Task 4.
- `Settings` field additions — defined in Task 3, read in Task 6 (`settings.autoSaveCustomersFromJobs ?? true`) and referenced in the Task 7 rules (which don't have access to TS types but match the field names exactly).
- `customerIdForJob` / `vehicleIdForJob` — exported from `customerEntity.ts` in Task 4; not yet consumed by other tasks (SP2 will consume them).
- `deriveVipTier` / `deriveCustomerStatus` — defined in Task 5; consumed by Task 4's `_buildCustomerPatch` after Task 5's helper-extraction step.
- Test-runner imports — every new test imports from `@/lib/...` exactly matching the file paths created in earlier tasks (`@/lib/phone`, `@/lib/customerEntity`, `@/lib/customerInsights`).

No type drift. No method-name mismatch (e.g. `clearLayers` vs `clearFullLayers`). No function signature change between definition site and call site.

---

## Workflow Review Pass (v3.2 → SP1 plan)

Two adversarial reviews (one schema-focused, one App.tsx/runtime-focused) were applied. All 8 critical issues addressed inline; mechanical minors applied; judgment calls flagged.

### Critical issues addressed

1. **Customer.lastContactedAt missing from schema** (Review 1 #1) — added optional `lastContactedAt?: string` to the Customer interface (Task 2). Field was already correctly allowlisted in firestore.rules identity-upsert; the type/rule mismatch is now resolved.

2. **Vehicle rule had no affectedKeys allowlist** (Review 1 #2) — added explicit `hasOnly([...])` allowlist to `match /vehicles/{vehicleId}` matching `_buildVehiclePatch` fields exactly. Least-privilege parity with the customer rule.

3. **outboundCommunicationProvider deferred → now in SP1** (Review 1 #3, #4) — added field to Settings interface AND `DEFAULT_SETTINGS` ('native' default). Updated self-review count to 8 fields. Updated Task 9 coverage table to remove "intentionally deferred" note.

4. **Duplicate tab dispatch in App.tsx** (Review 2 #1) — Task 8 Step 4 rewritten from "ADD a new dispatch line" to "REPLACE the existing line 1373 inline." Plan now reuses the in-scope `handleViewJob` callback rather than introducing `setDetailJob` directly. Verification step grep added to assert exactly one customers dispatch remains.

5. **Latency budget violation in saveJob** (Review 2 #2) — wrapped `upsertCustomerFromJob` in `Promise.race([..., 2500ms sentinel])` mirroring `fbSetFast`'s existing pattern. Added `performance.now()` instrumentation that warns when the upsert exceeds 500ms so production regressions become visible. On timeout, the job write proceeds without customerId/vehicleId/phoneKey stamping; SP3 reconciliation backfills.

6. **Transaction-then-fbSetFast partial-failure race** (Review 2 #3) — documented as a KNOWN PARTIAL-FAILURE WINDOW inline in Task 6 with explicit rationale for the chosen ordering. Phantom-job reference cleanup is on the SP3 reconciliation backlog. (Reordering to job-first was considered but rejected for the costs noted in the comment.)

7. **Broadened customer read access not flagged** (Review 2 #4) — Task 7 now REPLACES the misleading `// restricted to owner/admin` comment with an explicit "INTENTIONAL ACCESS POLICY CHANGE" comment. Both Task 7 and Task 8 commit messages now flag the policy change. Pre-execution decision point added: if the team prefers to keep owner/admin-only reads, gate the Task 8 nav button on role and revert the Task 7 read rule.

8. **CustomerHub used wrong import form** (was a critical-equivalent surfaced by Review 2 Minor #8) — verified Customers.tsx exports `Customers` as a NAMED export, not default. CustomerHub.tsx now uses `import { Customers } from '@/pages/Customers'`. New Step 1 added to Task 8 to grep-verify the export form before writing.

### Minors applied (mechanical)

- Phone test: added explicit `undefined` case alongside `null` (Review 1 minor #1).
- Customer interface: added `// written by SP3` comments on referralCount/photoCount (Review 1 minor #11).
- Backfill stub: echoes `businessId` per spec line 916 (Review 1 minor #12).
- Pre-flight reference: corrected the false `runTransaction` claim — SP1 introduces it to MSOS (Review 2 minor #1).
- Task 4: added explicit "follows v3 top-level tire fields" stance to resolve the spec's internal inconsistency (Review 1 minor #9).
- Task 8: added explicit Task 6 → Task 8 sequencing note to prevent App.tsx merge conflicts under parallel subagent execution (Review 2 minor #12).
- Task 8: pre-decided the 6-tab overflow fallback ("Customers" → "Clients") so the executing agent doesn't pause (Review 2 minor #9).
- Task 9 coverage table: explicitly documents autoSaveDisabledAt / autoSaveReEnabledAt as SP3 deferrals (Review 1 minor #11).
- Task 6: added Rollback subsection citing the autoSaveCustomersFromJobs flag as the operational kill switch (Review 2 minor #8).

### Judgment calls deferred to user

- **Customer read scope (owner/admin vs all members):** plan assumes the broadened read is acceptable since the Customers tab is now top-level for technicians. If the team wants tighter access, both the Task 7 read rule AND the Task 8 nav button gate need to flip together. Flagged in two places.
- **Rules split into sub-commits:** Review 2 minor #6 suggests splitting Task 7's customers/vehicles/incomingCalls deltas into three commits for smaller revert blast radius. Kept as one commit per the existing "one commit per task" cadence; flag if the team prefers smaller commits.
- **Inactive-status 365-day boundary:** Review 1 minor #4 notes the exact-365-day boundary is not tested. Not added because the spec does not specify which side wins. Add an explicit boundary check in SP3 if it becomes load-bearing.
- **Hybrid legacy-fallback read path:** SP3 deliverable per spec; plan correctly defers and notes the legacy-10-digit / new-11-digit double-count risk for SP3 to resolve.

### Verification

After fixes: 8 critical addressed, ~10 mechanical minors applied. Plan is ready to execute via `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans`.

---

Plan complete. Execute via subagent-driven-development (recommended) or executing-plans? Which?
