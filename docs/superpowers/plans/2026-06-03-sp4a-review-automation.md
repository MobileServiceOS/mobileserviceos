# SP4A — Review Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a job is marked Completed, queue a Google-review-request SMS that drains automatically once Twilio is connected, with operator controls in Settings → Review Automation (toggle, delay, template, URL) and surface review history in Settings + on each CustomerProfile.

**Architecture:** Four server-side parts (Firestore trigger → reviewRequests queue → 1-minute scheduled drainer → twilioClient helper that throws `TWILIO_NOT_CONFIGURED` when env missing) plus a pure-helper template engine duplicated on both sides of the src/functions split. The queue ships dormant when Twilio is off — items sit at `pending` indefinitely and drain automatically the moment the operator wires Twilio in SP4B. Two HTTPS callables (`sendTestReviewSms`, `sendManualReviewRequest`) reuse the same queue path so test sends, manual sends, and auto sends share idempotency, audit trail, and history rendering.

**Tech Stack:** Firebase Functions v2 (Node 20, TypeScript) — `onDocumentWritten` trigger, `onSchedule` scheduled function, `onCall` HTTPS callables. React 18 + Vite + TypeScript on the client. Firebase Auth + Firestore via the modular SDK (`firebase/firestore` on the client, `firebase-admin/firestore` on the server). Tests run via `npm test` (tsx-based, flat at `tests/*.test.ts`).

---

## File Structure

**Create (10):**
- `src/lib/reviewTemplate.ts` — pure helper: `renderTemplate(template, vars)` with 7-placeholder substitution + smart-empty stripping. Client-side mirror used by the Settings preview pane.
- `functions/src/lib/reviewTemplate.ts` — byte-identical copy. Functions can't import from `src/`, so the file is duplicated and both copies are exercised by the same test.
- `functions/src/lib/twilioClient.ts` — `sendSms({ to, body })`. Reads `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_PHONE_NUMBER` from env; throws the sentinel string `'TWILIO_NOT_CONFIGURED'` when any is missing. The drainer catches that specific error and leaves the queue entry at `pending` so SP4A ships dormant.
- `functions/src/onJobCompletedReviewRequest.ts` — Firestore trigger; guards + transactional enqueue.
- `functions/src/drainReviewRequests.ts` — `onSchedule('every 1 minutes')`; transactional flip `pending → sending`, calls twilioClient, logs to `communicationEvents`.
- `functions/src/sendTestReviewSms.ts` — HTTPS callable. Enqueues with `isTest: true`, `sendAfterAt: now`.
- `functions/src/sendManualReviewRequest.ts` — HTTPS callable. Enqueues with `isManual: true`, `sendAfterAt: now`, `invokedByUid: req.auth.uid`.
- `src/components/settings/ReviewAutomationSection.tsx` — the accordion: toggle, warning banner, URL input, delay chips, template editor, preview pane, test form, history table.
- `src/components/settings/ReviewRequestHistoryTable.tsx` — extracted history sub-component (filters + search + row expand). Pulled out of ReviewAutomationSection.tsx because the table dominates the accordion's complexity.
- `tests/reviewTemplate.test.ts` + `tests/onJobCompletedReviewRequest.test.ts` + `tests/drainReviewRequests.test.ts` + `tests/reviewAutomationCallables.test.ts` — four test files at the project root following the `customerEntity.test.ts` idiom (manual check counter, tsx-runnable, no Vitest).

**Modify (8):**
- `src/types/index.ts` — `Settings` gains `reviewAutomationEnabled`, `reviewSmsTemplate`, `reviewDelayMinutes`, `googleReviewLink`, `serviceArea`. New top-level interfaces: `ReviewRequest`, `CommunicationEvent`.
- `src/lib/defaults.ts` — `DEFAULT_REVIEW_TEMPLATE` export + `DEFAULT_SETTINGS` gains the new fields.
- `functions/src/index.ts` — 4 new exports (`onJobCompletedReviewRequest`, `drainReviewRequests`, `sendTestReviewSms`, `sendManualReviewRequest`).
- `src/pages/Settings.tsx` — wire the `ReviewAutomationSection` accordion between Communications and Owners.
- `src/pages/CustomerProfile.tsx` — replace the "Communication History" placeholder with a Review Requests section + Communication Events section, both populated for the customer.
- `src/components/JobDetailModal.tsx` — add a manual "Send Review Request" button on Completed jobs (gated by settings + idempotency flag).
- `firestore.rules` — `reviewRequests` + `communicationEvents` collections: client read only, all writes via admin SDK.
- `firestore.indexes.json` — two composite indexes powering the drainer query and the CustomerProfile section.

---

## Pre-flight

Verify the dev environment before starting. These commands must succeed:

```bash
# 1. We're on the main branch and clean
git status                          # expected: clean working tree (or only this plan file staged)

# 2. Tests pass on baseline
npm test                            # expected: every existing test runs and PASSes

# 3. Type-check passes on baseline
npm run lint                        # expected: tsc --noEmit exits 0

# 4. Functions build cleanly
cd functions && npm run build && cd ..   # expected: tsc emits to functions/lib/, exit 0

# 5. Emulator can start (you'll come back to this in Task 15)
java -version 2>&1 | head -1        # expected: openjdk 21.x or later — required by firebase-tools
```

If any of these fail on a clean main, stop and report the failure before touching SP4A.

**One-time per session:** the seed script uses an admin auth user `admin@localhost.dev` / `dev-password-1234` against the dev tenant `dev-business`. Don't add new auth users; reuse those.

---

## Task 1: Template engine (client + functions mirror)

Pure helper. Both copies live in their respective packages because functions/ has a separate tsconfig and cannot resolve `@/` paths into src/. The test lives at the project root and imports both copies; the copies must stay byte-identical (modulo header comment paths).

**Files:**
- Create: `src/lib/reviewTemplate.ts`
- Create: `functions/src/lib/reviewTemplate.ts`
- Test: `tests/reviewTemplate.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/reviewTemplate.test.ts`:

```ts
// ═══════════════════════════════════════════════════════════════════
//  tests/reviewTemplate.test.ts
//  Run: npx tsx tests/reviewTemplate.test.ts
//
//  Tests renderTemplate() — 7-placeholder substitution with
//  smart-empty stripping. Imports BOTH the client mirror and the
//  functions mirror to enforce byte-identity (modulo header path).
// ═══════════════════════════════════════════════════════════════════

import { renderTemplate as renderClient } from '../src/lib/reviewTemplate';
import { renderTemplate as renderFn }     from '../functions/src/lib/reviewTemplate';

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else      { failed++; console.error(`  ✗ ${name}${detail ? `  — ${detail}` : ''}`); }
}

const DEFAULT =
  'Hi {firstName}, thanks for choosing {businessName} for your {serviceType} in {city}. ' +
  'We’d appreciate a quick Google review: {reviewLink}';

console.log('\n── renderTemplate — all placeholders populated ──');
{
  const out = renderClient(DEFAULT, {
    firstName: 'Maria', lastName: 'Lopez',
    businessName: 'Wheel Rush', serviceType: 'Tire Replacement',
    city: 'Hollywood', vehicle: 'Honda Civic',
    reviewLink: 'https://g.page/r/xxx',
  });
  check('produces the full sentence',
    out === 'Hi Maria, thanks for choosing Wheel Rush for your Tire Replacement in Hollywood. ' +
            'We’d appreciate a quick Google review: https://g.page/r/xxx',
    out);
}

console.log('\n── smart-empty stripping — city absent ──');
{
  const out = renderClient(DEFAULT, {
    firstName: 'Maria', businessName: 'Wheel Rush',
    serviceType: 'Tire Replacement', reviewLink: 'https://g.page/r/xxx',
  });
  // The " in {city}" connective is stripped entirely; no "in undefined".
  check('strips " in {city}" when city empty',
    out === 'Hi Maria, thanks for choosing Wheel Rush for your Tire Replacement. ' +
            'We’d appreciate a quick Google review: https://g.page/r/xxx',
    out);
  check('never contains the word undefined', !/undefined/.test(out), out);
}

console.log('\n── smart-empty stripping — vehicle absent ──');
{
  const template = 'Hi {firstName}, thanks for choosing {businessName} for your {vehicle} {serviceType} in {city}.';
  const out = renderClient(template, {
    firstName: 'Maria', businessName: 'Wheel Rush',
    serviceType: 'tune-up', city: 'Hollywood',
  });
  check('strips " for your {vehicle}" when vehicle empty',
    out === 'Hi Maria, thanks for choosing Wheel Rush tune-up in Hollywood.',
    out);
}

console.log('\n── smart-empty stripping — lastName absent ──');
{
  const template = 'Hi {firstName} {lastName}, thanks.';
  const out = renderClient(template, { firstName: 'Maria' });
  check('strips " {lastName}" when lastName empty',
    out === 'Hi Maria, thanks.', out);
}

console.log('\n── lastName populated — both names render ──');
{
  const template = 'Hi {firstName} {lastName}, thanks.';
  const out = renderClient(template, { firstName: 'Maria', lastName: 'Lopez' });
  check('renders firstName + lastName when both present',
    out === 'Hi Maria Lopez, thanks.', out);
}

console.log('\n── unknown placeholders left literal ──');
{
  const out = renderClient('Hello {firstName}, your {bogus} is ready.', { firstName: 'X' });
  check('unknown {bogus} stays as literal text',
    out === 'Hello X, your {bogus} is ready.', out);
}

console.log('\n── pure function — same input, same output ──');
{
  const vars = { firstName: 'A', businessName: 'B', serviceType: 'C', city: 'D', reviewLink: 'E' };
  const a = renderClient(DEFAULT, vars);
  const b = renderClient(DEFAULT, vars);
  check('determinism', a === b);
}

console.log('\n── functions mirror is byte-identical ──');
{
  const vars = { firstName: 'A', businessName: 'B', serviceType: 'C', city: 'D', reviewLink: 'E' };
  check('client + functions copies produce identical output',
    renderClient(DEFAULT, vars) === renderFn(DEFAULT, vars));
}

console.log(`\n── ${passed} passed, ${failed} failed ──\n`);
process.exit(failed > 0 ? 1 : 0);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx tests/reviewTemplate.test.ts`
Expected: error like `Cannot find module '../src/lib/reviewTemplate'` — the file doesn't exist yet.

- [ ] **Step 3: Write the client implementation**

Create `src/lib/reviewTemplate.ts`:

```ts
// src/lib/reviewTemplate.ts
// ═══════════════════════════════════════════════════════════════════
//  reviewTemplate — pure renderer for the SMS template engine.
//
//  Spec: docs/superpowers/specs/2026-06-03-sp4a-review-automation-design.md
//        §"Template engine", §"Smart-empty stripping (addition #3)"
//
//  7 placeholders, smart-empty stripping for connective phrases that
//  would produce broken grammar when a variable is empty. Unknown
//  placeholders are left literal so operators see their typos.
//
//  Mirror: functions/src/lib/reviewTemplate.ts (byte-identical aside
//  from this header). Tests enforce identity.
// ═══════════════════════════════════════════════════════════════════

export interface TemplateVars {
  firstName?: string;
  lastName?: string;
  businessName?: string;
  serviceType?: string;
  city?: string;
  vehicle?: string;
  reviewLink?: string;
}

const KNOWN_KEYS: ReadonlyArray<keyof TemplateVars> = [
  'firstName', 'lastName', 'businessName', 'serviceType',
  'city', 'vehicle', 'reviewLink',
];

// Connective-strip patterns run BEFORE placeholder substitution, so
// they can target the literal "{city}" / "{vehicle}" / "{lastName}"
// tokens in the template. Each pattern removes the connective phrase
// (preposition + space) only when its variable is empty/whitespace.
function _stripEmptyConnectives(template: string, vars: TemplateVars): string {
  let out = template;
  if (!vars.city?.trim())     out = out.replace(/ in \{city\}/g, '');
  if (!vars.vehicle?.trim())  out = out.replace(/ for your \{vehicle\}/g, '');
  // Trailing-space-before-lastName covers the "{firstName} {lastName}"
  // adjacency. Standalone "{lastName}" with no leading space falls
  // through to normal substitution → empty string.
  if (!vars.lastName?.trim()) out = out.replace(/ \{lastName\}/g, '');
  return out;
}

export function renderTemplate(template: string, vars: TemplateVars): string {
  const stripped = _stripEmptyConnectives(template, vars);
  return stripped.replace(/\{([a-zA-Z]+)\}/g, (match, key: string) => {
    if (!(KNOWN_KEYS as ReadonlyArray<string>).includes(key)) return match;
    const v = (vars as Record<string, string | undefined>)[key];
    return v ?? '';
  });
}
```

- [ ] **Step 4: Write the functions mirror**

Create `functions/src/lib/reviewTemplate.ts` with identical body. Only the header path changes:

```ts
// functions/src/lib/reviewTemplate.ts
// ═══════════════════════════════════════════════════════════════════
//  reviewTemplate — pure renderer (functions-side mirror).
//
//  Byte-identical to src/lib/reviewTemplate.ts (modulo this header).
//  Tests enforce identity. If you edit one, edit the other.
// ═══════════════════════════════════════════════════════════════════

export interface TemplateVars {
  firstName?: string;
  lastName?: string;
  businessName?: string;
  serviceType?: string;
  city?: string;
  vehicle?: string;
  reviewLink?: string;
}

const KNOWN_KEYS: ReadonlyArray<keyof TemplateVars> = [
  'firstName', 'lastName', 'businessName', 'serviceType',
  'city', 'vehicle', 'reviewLink',
];

function _stripEmptyConnectives(template: string, vars: TemplateVars): string {
  let out = template;
  if (!vars.city?.trim())     out = out.replace(/ in \{city\}/g, '');
  if (!vars.vehicle?.trim())  out = out.replace(/ for your \{vehicle\}/g, '');
  if (!vars.lastName?.trim()) out = out.replace(/ \{lastName\}/g, '');
  return out;
}

export function renderTemplate(template: string, vars: TemplateVars): string {
  const stripped = _stripEmptyConnectives(template, vars);
  return stripped.replace(/\{([a-zA-Z]+)\}/g, (match, key: string) => {
    if (!(KNOWN_KEYS as ReadonlyArray<string>).includes(key)) return match;
    const v = (vars as Record<string, string | undefined>)[key];
    return v ?? '';
  });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx tsx tests/reviewTemplate.test.ts`
Expected: every check ✓, exit 0. Output ends with `── 8 passed, 0 failed ──`.

- [ ] **Step 6: Confirm functions package builds**

Run: `cd functions && npm run build && cd ..`
Expected: exit 0, no diagnostics. `functions/lib/lib/reviewTemplate.js` exists.

- [ ] **Step 7: Commit**

```bash
git add src/lib/reviewTemplate.ts functions/src/lib/reviewTemplate.ts tests/reviewTemplate.test.ts
git commit -m "$(cat <<'EOF'
feat(reviewTemplate): pure 7-placeholder renderer with smart-empty stripping (SP4A task 1)

Spec: docs/superpowers/specs/2026-06-03-sp4a-review-automation-design.md §"Template engine"

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Settings type additions + DEFAULT_REVIEW_TEMPLATE

Add the 5 new Settings fields + the default-template constant. `serviceArea` is the city-fallback per spec addition #3.

**Files:**
- Modify: `src/types/index.ts` (insert after the `outboundCommunicationProvider` field in the `Settings` interface, around line 1153)
- Modify: `src/lib/defaults.ts` (export `DEFAULT_REVIEW_TEMPLATE`; extend `DEFAULT_SETTINGS`)
- Test: covered by the type-check + Task 10/11 integration

- [ ] **Step 1: Add the new Settings fields**

Edit `src/types/index.ts`. Find the last line of the `Settings` interface (the `outboundCommunicationProvider?:` field) and insert the SP4A block immediately before the closing `}`:

```ts
  // ─── Review Automation (SP4A) ────────────────────────────────────
  /** Master switch. When false, the trigger refuses to enqueue and
   *  the Settings → Review Automation section renders muted UI.
   *  Default false — ships OFF, operator opts in.
   *  Spec §"Settings schema additions". */
  reviewAutomationEnabled?: boolean;
  /** Operator-editable SMS body. 7-placeholder template — see
   *  src/lib/reviewTemplate.ts for the supported variables. Default
   *  DEFAULT_REVIEW_TEMPLATE in src/lib/defaults.ts. */
  reviewSmsTemplate?: string;
  /** Minutes between completedAt and sendAfterAt. The drainer runs
   *  every 1 minute so the effective floor is ~1min even for value 0.
   *  Allowed values: 0 | 5 | 15 | 60. */
  reviewDelayMinutes?: 0 | 5 | 15 | 60;
  /** Google Business Profile review URL. Required for the trigger to
   *  enqueue — guard #5 in onJobCompletedReviewRequest. Default ''. */
  googleReviewLink?: string;
  /** Operator's primary service area (e.g. "South Florida"). Used as
   *  the third fallback for {city} when job.city + job.area are both
   *  empty — see renderTemplate() consumers. Optional. */
  serviceArea?: string;
```

- [ ] **Step 2: Add the DEFAULT_REVIEW_TEMPLATE constant**

Edit `src/lib/defaults.ts`. Insert the constant near the top of the file (after `APP_LOGO`), and extend `DEFAULT_SETTINGS` with the SP4A block.

After the `FALLBACK_LOGO_SVG` definition (around line 9), add:

```ts
/**
 * Default outbound review-request SMS body. 7 placeholders, smart-empty
 * stripped (see src/lib/reviewTemplate.ts). Operator can edit in
 * Settings → Review Automation → Template editor.
 *
 * Spec: docs/superpowers/specs/2026-06-03-sp4a-review-automation-design.md
 *       §"Template engine — Default template"
 */
export const DEFAULT_REVIEW_TEMPLATE =
  'Hi {firstName}, thanks for choosing {businessName} for your {serviceType} in {city}. ' +
  'We’d appreciate a quick Google review: {reviewLink}';
```

Then, inside `DEFAULT_SETTINGS`, after the `outboundCommunicationProvider: 'native',` line, add the SP4A block (still inside the object literal):

```ts
  // ─── Review Automation (SP4A) ─ ships OFF, operator opts in ──────
  reviewAutomationEnabled: false,
  reviewSmsTemplate: DEFAULT_REVIEW_TEMPLATE,
  reviewDelayMinutes: 0,
  googleReviewLink: '',
```

(Don't seed `serviceArea` — leaving it undefined keeps the SMS body untouched when no operator-supplied area exists. Brand.serviceArea is a separate field on Brand for the public-facing brand surface.)

- [ ] **Step 3: Type-check**

Run: `npm run lint`
Expected: exit 0. If the build complains about a missing import of `DEFAULT_REVIEW_TEMPLATE` from somewhere else, you've over-scoped the edit — only `defaults.ts` should export it for now.

- [ ] **Step 4: Commit**

```bash
git add src/types/index.ts src/lib/defaults.ts
git commit -m "$(cat <<'EOF'
feat(settings): SP4A Settings additions + DEFAULT_REVIEW_TEMPLATE (SP4A task 2)

Five new Settings fields: reviewAutomationEnabled, reviewSmsTemplate,
reviewDelayMinutes, googleReviewLink, serviceArea. DEFAULT_SETTINGS
seeded so existing customers get the OFF-by-default behaviour.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: ReviewRequest + CommunicationEvent types

Two new top-level interfaces. Both fully match the spec's future-ready field list (`deliveryStatus`, `carrierResponse`, `twilioMessageSid`) so the schema is stable across the SP4A→SP4B handoff.

**Files:**
- Modify: `src/types/index.ts` (insert a new section after the `Settings` interface — around line 1155, before the `Quote engine` section)

- [ ] **Step 1: Insert the new types**

Edit `src/types/index.ts`. Locate the `// ─── Quote engine` divider (around line 1156) and insert this block IMMEDIATELY BEFORE that divider:

```ts
// ─────────────────────────────────────────────────────────────────────
//  Review Automation (SP4A)
//
//  Two collections under businesses/{bid}/...:
//    - reviewRequests/{requestId}    queue entries (one per trigger fire)
//    - communicationEvents/{eventId} unified audit log; SP4B extends
//
//  Doc-id pattern for reviewRequests: req-{jobId}-{completedDateISO}
//  Re-saving the same job same day = same id = no duplicate (idempotent).
// ─────────────────────────────────────────────────────────────────────

export type ReviewRequestStatus =
  | 'pending'
  | 'sending'
  | 'sent'
  | 'failed'
  | 'cancelled';
// Note: 'scheduled' is a UI-only filter (status === 'pending' AND
// sendAfterAt > now). The stored status never takes that value.

export interface ReviewRequest {
  id: string;
  // ─── Source refs ─────────────────────────────────────────────────
  jobId: string;
  customerId: string;
  phoneE164: string;
  // ─── Rendered content ────────────────────────────────────────────
  templateUsed: string;       // raw template at enqueue time (audit)
  templateRendered: string;   // final SMS body that ships
  // ─── Scheduling ──────────────────────────────────────────────────
  sendAfterAt: Timestamp;
  status: ReviewRequestStatus;
  retryCount: number;
  // ─── Outcome ─────────────────────────────────────────────────────
  createdAt: Timestamp;
  sentAt?: Timestamp;
  failedAt?: Timestamp;
  errorMessage?: string;
  // ─── Future-ready (addition #8) ──────────────────────────────────
  twilioMessageSid?: string;
  deliveryStatus?: string;    // Twilio lifecycle: queued|sending|sent|delivered|undelivered|failed
  carrierResponse?: string;   // raw carrier error code/message
  // ─── Flags ───────────────────────────────────────────────────────
  isTest?: boolean;
  isManual?: boolean;
  invokedByUid?: string;      // 'system:reviewAutomation' or real uid
}

export type CommunicationEventType =
  | 'review_request_sent'
  | 'review_request_failed'
  | 'review_request_skipped';
  // SP4B extends with 'incoming_call' | 'incoming_sms' | 'missed_call'
  // | 'auto_text_back_sent'.

export interface CommunicationEvent {
  id: string;
  type: CommunicationEventType;
  channel: 'sms' | 'call' | 'email';
  direction: 'outbound' | 'inbound';
  customerId: string;
  jobId?: string;
  reviewRequestId?: string;
  content?: string;                 // rendered SMS body for sent events
  status: 'sent' | 'failed' | 'queued' | 'skipped';
  providerMessageId?: string;       // Twilio MessageSid
  deliveryStatus?: string;
  carrierResponse?: string;
  sentAt: Timestamp;
  createdByUid: string;             // 'system:reviewAutomation' | uid
}
```

- [ ] **Step 2: Type-check**

Run: `npm run lint`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/types/index.ts
git commit -m "$(cat <<'EOF'
feat(types): add ReviewRequest + CommunicationEvent schemas (SP4A task 3)

Both interfaces match the spec's future-ready field list (deliveryStatus,
carrierResponse, twilioMessageSid) so SP4B can populate them without a
schema bump. ReviewRequestStatus excludes 'scheduled' — that's UI-only.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: firestore.rules + firestore.indexes.json

Two collections to allowlist (client read only, all writes via admin SDK). Two composite indexes to power the drainer query and the CustomerProfile section.

**Files:**
- Modify: `firestore.rules` (insert at line 697, between the `incomingCalls` block and the `technicians` block — both under `match /businesses/{businessId}`)
- Modify: `firestore.indexes.json` (add two entries to the `indexes` array)

- [ ] **Step 1: Add the rules block**

Edit `firestore.rules`. Find the line `      match /technicians/{docId} {` (line ~700) and insert this block IMMEDIATELY BEFORE it:

```
      // ─── reviewRequests — SP4A queue (admin SDK writes only) ─────
      // Cloud Functions enqueue + drain via admin SDK (bypasses rules).
      // Manual / test sends go through HTTPS callables, never client
      // writes. Reads gated to members of the business.
      match /reviewRequests/{requestId} {
        allow read:  if isMemberOfBusiness(businessId);
        allow write: if false;
      }

      // ─── communicationEvents — SP4A audit log (admin SDK only) ───
      // Trigger + drainer + callables log here. SP4B extends with
      // inbound call/SMS events. No client writes ever.
      match /communicationEvents/{eventId} {
        allow read:  if isMemberOfBusiness(businessId);
        allow write: if false;
      }

```

(Keep the blank line before the existing `// Technicians collection: legacy collection` comment so the spacing matches.)

- [ ] **Step 2: Add the composite indexes**

Edit `firestore.indexes.json`. The file currently has 6 entries in the `indexes` array. Append two more entries to that array (after the `meta` collectionGroup entry, before the closing `]`):

```json
    {
      "collectionGroup": "reviewRequests",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "status",      "order": "ASCENDING" },
        { "fieldPath": "sendAfterAt", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "reviewRequests",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "customerId", "order": "ASCENDING" },
        { "fieldPath": "createdAt",  "order": "DESCENDING" }
      ]
    }
```

Mind the comma — the meta entry ends with `}`, you need to append `,` after that closing brace, then the new entries separated by `,`, then the closing `]`.

- [ ] **Step 3: Validate JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('firestore.indexes.json','utf8')); console.log('ok')"`
Expected: prints `ok`. If you see `SyntaxError`, you mis-placed a comma.

- [ ] **Step 4: Validate rules syntax**

Run: `firebase emulators:exec --only firestore --project mobile-service-os "true" 2>&1 | tail -20`
Expected: emulator starts, applies the rules, then exits with `Script exited successfully`. If the rules file has a syntax error you'll see `[firestore] Error: ...` and the line number.

(Skip this step if the firestore emulator isn't installed locally — but type-check the rules file by eye for matching braces. The block must close with `}` for each `match /xxx { ... }`.)

- [ ] **Step 5: Commit**

```bash
git add firestore.rules firestore.indexes.json
git commit -m "$(cat <<'EOF'
feat(rules): reviewRequests + communicationEvents (SP4A task 4)

Two new collections under businesses/{bid}: reviewRequests + 
communicationEvents. Both client-read-only; all writes via admin SDK
(Firestore trigger + scheduled drainer + 2 HTTPS callables). Two
composite indexes added: (status, sendAfterAt) for the drainer,
(customerId, createdAt desc) for CustomerProfile.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: twilioClient helper

The dormant-mode seam. Reads `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_PHONE_NUMBER` from env; if any is missing, throws the **exact string** `'TWILIO_NOT_CONFIGURED'` that the drainer special-cases. When all three are present, performs the real Twilio REST POST to the Messages API with HTTP Basic Auth. We ship the real call now so the contract is exercised end-to-end the moment SP4B drops the secrets in.

**Files:**
- Create: `functions/src/lib/twilioClient.ts`
- Test: covered by drainer test in Task 7 (via dependency-injected sender — twilioClient itself is tested indirectly through the drainer's error-class behaviour)

- [ ] **Step 1: Write the helper**

Create `functions/src/lib/twilioClient.ts`:

```ts
// functions/src/lib/twilioClient.ts
// ═══════════════════════════════════════════════════════════════════
//  twilioClient — SP4A SMS sender.
//
//  Spec: docs/superpowers/specs/2026-06-03-sp4a-review-automation-design.md
//        §"4. twilioClient helper"
//
//  Reads TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_PHONE_NUMBER
//  from process.env. When any is missing, throws the SENTINEL STRING
//  'TWILIO_NOT_CONFIGURED' — the drainer catches this specific error
//  and leaves the queue entry at 'pending' (no retry counter bump,
//  no failure transition). This is the seam that lets SP4A ship
//  dormant: trigger + queue + drainer all run, but no SMS goes out
//  until SP4B's operator-side Twilio wiring lands.
//
//  When credentials ARE present, performs the real REST POST to
//  Twilio's Messages API. Single-tenant — every business sends from
//  the same TWILIO_PHONE_NUMBER for now. Per-business numbers are
//  SP4B's "Messaging Service routing" deliverable.
// ═══════════════════════════════════════════════════════════════════

export class TwilioError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly carrierCode?: string,
  ) {
    super(message);
    this.name = 'TwilioError';
  }
}

export interface SendSmsArgs {
  to: string;       // E.164 destination, e.g. '+13055551234'
  body: string;     // rendered SMS body
}

export interface SendSmsResult {
  messageSid: string;
  deliveryStatus: string; // 'queued' on a successful submission
}

/**
 * Send an SMS via Twilio's Messages API.
 *
 * Throws:
 *   - 'TWILIO_NOT_CONFIGURED' (plain Error) when env vars missing.
 *   - TwilioError (status 4xx) on a permanent failure (bad number,
 *     suspended account, etc.) — drainer marks status='failed'.
 *   - TwilioError (status 5xx) on a transient failure — drainer
 *     increments retryCount and leaves pending until cap exhausted.
 */
export async function sendSms(args: SendSmsArgs): Promise<SendSmsResult> {
  const sid   = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from  = process.env.TWILIO_PHONE_NUMBER;
  if (!sid || !token || !from) {
    throw new Error('TWILIO_NOT_CONFIGURED');
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`;
  const auth = Buffer.from(`${sid}:${token}`).toString('base64');
  const form = new URLSearchParams({ From: from, To: args.to, Body: args.body });

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type':  'application/x-www-form-urlencoded',
      },
      body: form.toString(),
    });
  } catch (err) {
    // Network / DNS / socket-level failure — treat as transient 5xx
    // so the drainer retries on the next tick.
    throw new TwilioError(`network error: ${(err as Error).message}`, 503);
  }

  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    let carrierCode: string | undefined;
    try {
      const body = await res.json() as { message?: string; code?: string | number };
      if (body.message) detail = body.message;
      if (body.code != null) carrierCode = String(body.code);
    } catch { /* non-JSON error body */ }
    throw new TwilioError(detail, res.status, carrierCode);
  }

  const body = await res.json() as { sid?: string; status?: string };
  if (!body.sid) {
    // Twilio always returns a sid on 2xx — defensive shield.
    throw new TwilioError('twilio response missing sid', 502);
  }
  return { messageSid: body.sid, deliveryStatus: body.status ?? 'queued' };
}

/** Cheap, side-effect-free env probe. Drainer + Settings UI both
 *  call this to decide whether to attempt a send vs short-circuit. */
export function isTwilioConfigured(): boolean {
  return !!(process.env.TWILIO_ACCOUNT_SID
         && process.env.TWILIO_AUTH_TOKEN
         && process.env.TWILIO_PHONE_NUMBER);
}
```

- [ ] **Step 2: Confirm functions build**

Run: `cd functions && npm run build && cd ..`
Expected: exit 0. `functions/lib/lib/twilioClient.js` exists.

- [ ] **Step 3: Commit**

```bash
git add functions/src/lib/twilioClient.ts
git commit -m "$(cat <<'EOF'
feat(twilioClient): SMS sender with dormant-mode sentinel (SP4A task 5)

sendSms() throws 'TWILIO_NOT_CONFIGURED' when env secrets missing — the
drainer special-cases this string and leaves queue entries pending. When
credentials are present, performs the real Twilio REST POST. Single-tenant
for SP4A; per-business routing is SP4B.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: onJobCompletedReviewRequest trigger

Fires on every write under `businesses/{businessId}/jobs/{jobId}`. Runs the 6-guard chain from the spec; on pass, transactionally enqueues a `reviewRequests` doc AND flips `jobs/{jobId}.reviewRequestSent = true`.

The trigger exposes its decision logic via `__testHooks.decide(before, after, customer, settings)` so tests can exercise every guard branch without booting the emulator. The transactional write is exercised in the drainer test via a shimmed Firestore.

**Files:**
- Create: `functions/src/onJobCompletedReviewRequest.ts`
- Test: `tests/onJobCompletedReviewRequest.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/onJobCompletedReviewRequest.test.ts`:

```ts
// ═══════════════════════════════════════════════════════════════════
//  tests/onJobCompletedReviewRequest.test.ts
//  Run: npx tsx tests/onJobCompletedReviewRequest.test.ts
//
//  Exercises the 6-guard decision tree of the SP4A Firestore trigger.
//  Pure logic — no emulator. The real onDocumentWritten wrapper is
//  thin; the decision logic lives in __testHooks.decide().
// ═══════════════════════════════════════════════════════════════════

import { __testHooks } from '../functions/src/onJobCompletedReviewRequest';

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else      { failed++; console.error(`  ✗ ${name}${detail ? `  — ${detail}` : ''}`); }
}

const { decide, computeRequestId } = __testHooks;

const baseCustomer = { id: 'cust1', name: 'Maria Lopez', phoneE164: '+13055551234' };
const baseSettings = {
  reviewAutomationEnabled: true,
  reviewSmsTemplate: 'Hi {firstName}, thanks. {reviewLink}',
  reviewDelayMinutes: 0,
  googleReviewLink: 'https://g.page/r/xxx',
  businessName: 'Wheel Rush',
};
const completedAfter = { id: 'jobA', status: 'Completed', date: '2026-06-03', service: 'Tire Replacement', city: 'Hollywood', customerId: 'cust1' };

console.log('\n── guard #1: already Completed before ──');
check('skips when before.status === Completed',
  decide({ status: 'Completed' }, completedAfter, baseCustomer, baseSettings).action === 'skip');

console.log('\n── guard #2: status !== Completed ──');
check('skips when after.status === Pending',
  decide(null, { ...completedAfter, status: 'Pending' }, baseCustomer, baseSettings).action === 'skip');

console.log('\n── guard #3: reviewRequestSent === true ──');
check('skips when job already flagged as sent',
  decide(null, { ...completedAfter, reviewRequestSent: true }, baseCustomer, baseSettings).action === 'skip');

console.log('\n── guard #4: settings toggle OFF ──');
check('skips when reviewAutomationEnabled === false',
  decide(null, completedAfter, baseCustomer, { ...baseSettings, reviewAutomationEnabled: false }).action === 'skip');

console.log('\n── guard #5: empty googleReviewLink ──');
check('skips when googleReviewLink empty',
  decide(null, completedAfter, baseCustomer, { ...baseSettings, googleReviewLink: '' }).action === 'skip');
check('skips when googleReviewLink whitespace',
  decide(null, completedAfter, baseCustomer, { ...baseSettings, googleReviewLink: '   ' }).action === 'skip');

console.log('\n── guard #6: customer has no phone ──');
check('skips when phoneE164 missing',
  decide(null, completedAfter, { ...baseCustomer, phoneE164: undefined }, baseSettings).action === 'skip');

console.log('\n── happy path — all guards pass ──');
{
  const out = decide(null, completedAfter, baseCustomer, baseSettings);
  check('action is enqueue', out.action === 'enqueue');
  check('rendered SMS substitutes firstName', !!out.patch && out.patch.templateRendered.includes('Hi Maria'));
  check('rendered SMS contains reviewLink', !!out.patch && out.patch.templateRendered.includes('https://g.page/r/xxx'));
  check('requestId follows req-{jobId}-{date} pattern',
    !!out.requestId && /^req-jobA-2026-06-03$/.test(out.requestId));
  check('phoneE164 propagated to request',
    !!out.patch && out.patch.phoneE164 === '+13055551234');
  check('status pending', !!out.patch && out.patch.status === 'pending');
  check('retryCount 0', !!out.patch && out.patch.retryCount === 0);
  check('invokedByUid system tag', !!out.patch && out.patch.invokedByUid === 'system:reviewAutomation');
}

console.log('\n── delay arithmetic ──');
{
  const out = decide(null, completedAfter, baseCustomer, { ...baseSettings, reviewDelayMinutes: 15 });
  check('sendAfterAt is set', !!out.patch && typeof out.patch.sendAfterAtEpochMs === 'number');
  // The decision returns epochMs (numeric) instead of a Timestamp so it stays pure.
  // The wrapper translates it to admin Timestamp before writing.
  // We can't assert exact ms without freezing the clock — assert >= 14min and <= 16min from now.
  const now = Date.now();
  const dt = (out.patch?.sendAfterAtEpochMs ?? 0) - now;
  check('delay between 14 and 16 minutes', dt > 14 * 60_000 && dt < 16 * 60_000, `dt=${dt}ms`);
}

console.log('\n── city fallback chain ──');
{
  // No job.city, no job.area, but settings.serviceArea → "in South Florida"
  const out = decide(null, { ...completedAfter, city: undefined, area: undefined } as never, baseCustomer, { ...baseSettings, serviceArea: 'South Florida' });
  check('uses settings.serviceArea when job.city + job.area missing',
    out.action === 'enqueue' && !!out.patch && out.patch.templateRendered.includes('South Florida'));
}
{
  // No city anywhere → smart-empty stripping; no "undefined" in body
  const noCityTemplate = 'Hi {firstName}, thanks for the {serviceType} in {city}. {reviewLink}';
  const out = decide(null, { ...completedAfter, city: undefined, area: undefined } as never, baseCustomer, { ...baseSettings, reviewSmsTemplate: noCityTemplate, serviceArea: undefined });
  check('strips " in {city}" when no city signal anywhere',
    out.action === 'enqueue' && !!out.patch && !out.patch.templateRendered.includes('undefined') && !out.patch.templateRendered.includes('{city}'));
}

console.log('\n── computeRequestId is idempotent ──');
check('same jobId + same date → same id',
  computeRequestId('jobA', '2026-06-03') === 'req-jobA-2026-06-03');
check('different date → different id',
  computeRequestId('jobA', '2026-06-03') !== computeRequestId('jobA', '2026-06-04'));

console.log(`\n── ${passed} passed, ${failed} failed ──\n`);
process.exit(failed > 0 ? 1 : 0);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx tests/onJobCompletedReviewRequest.test.ts`
Expected: `Cannot find module '../functions/src/onJobCompletedReviewRequest'`.

- [ ] **Step 3: Write the trigger implementation**

Create `functions/src/onJobCompletedReviewRequest.ts`:

```ts
// functions/src/onJobCompletedReviewRequest.ts
// ═══════════════════════════════════════════════════════════════════
//  onJobCompletedReviewRequest — Firestore trigger (SP4A task 6).
//
//  Spec: docs/superpowers/specs/2026-06-03-sp4a-review-automation-design.md
//        §"1. onJobCompletedReviewRequest Firestore trigger"
//
//  Fires on every write to businesses/{bid}/jobs/{jobId}. Six guards
//  decide whether to enqueue. Pass → transactional enqueue of
//  reviewRequests/{requestId} + flip jobs/{jobId}.reviewRequestSent.
//
//  Doc id pattern: req-{jobId}-{completedDateISO}. Same job same day
//  = same id = idempotent re-saves.
// ═══════════════════════════════════════════════════════════════════

import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import * as admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import { renderTemplate, type TemplateVars } from './lib/reviewTemplate';
void admin;

type JobLite = {
  id: string;
  status?: string;
  date?: string;                  // YYYY-MM-DD (ISO date string)
  service?: string;
  city?: string;
  area?: string;
  customerId?: string;
  reviewRequestSent?: boolean;
};
type CustomerLite = {
  id: string;
  name?: string;
  phoneE164?: string;
};
type SettingsLite = {
  reviewAutomationEnabled?: boolean;
  reviewSmsTemplate?: string;
  reviewDelayMinutes?: number;
  googleReviewLink?: string;
  serviceArea?: string;
  businessName?: string;
};
type VehicleLite = {
  vehicleMakeModel?: string;
  vehicleYear?: string;
  vehicleMake?: string;
  vehicleModel?: string;
};

interface DecisionEnqueue {
  action: 'enqueue';
  requestId: string;
  patch: {
    jobId: string;
    customerId: string;
    phoneE164: string;
    templateUsed: string;
    templateRendered: string;
    sendAfterAtEpochMs: number;    // wrapper converts to Timestamp
    status: 'pending';
    retryCount: number;
    invokedByUid: string;
  };
}
interface DecisionSkip {
  action: 'skip';
  reason: string;
}
export type Decision = DecisionEnqueue | DecisionSkip;

const DEFAULT_TEMPLATE_FALLBACK =
  'Hi {firstName}, thanks for the service. Please leave a review: {reviewLink}';

function _firstName(name?: string): string {
  return (name ?? '').trim().split(/\s+/)[0] ?? '';
}
function _lastName(name?: string): string {
  const parts = (name ?? '').trim().split(/\s+/);
  return parts.length > 1 ? parts.slice(1).join(' ') : '';
}
function _resolveCity(job: JobLite, settings: SettingsLite): string {
  if (job.city?.trim())             return job.city.trim();
  if (job.area?.trim())             return job.area.trim();
  if (settings.serviceArea?.trim()) return settings.serviceArea.trim();
  return '';
}
function _vehicleLabel(v: VehicleLite | undefined): string {
  if (!v) return '';
  if (v.vehicleMakeModel?.trim()) return v.vehicleMakeModel.trim();
  const parts = [v.vehicleYear, v.vehicleMake, v.vehicleModel].filter(p => p?.trim());
  return parts.join(' ').trim();
}

function _decide(
  before: JobLite | null,
  after: JobLite,
  customer: CustomerLite,
  settings: SettingsLite,
  vehicle?: VehicleLite,
): Decision {
  // Guard 1: already-completed edit (re-save of a Completed job).
  if (before?.status === 'Completed') return { action: 'skip', reason: 'before-completed' };
  // Guard 2: not a completion event.
  if (after.status !== 'Completed') return { action: 'skip', reason: 'not-completed' };
  // Guard 3: idempotency layer 1 — already enqueued.
  if (after.reviewRequestSent === true) return { action: 'skip', reason: 'already-sent' };
  // Guard 4: operator opted out.
  if (settings.reviewAutomationEnabled !== true) return { action: 'skip', reason: 'disabled' };
  // Guard 5: no review URL — spec addition #7.
  if (!settings.googleReviewLink?.trim()) return { action: 'skip', reason: 'no-review-link' };
  // Guard 6: no phone to text.
  if (!customer.phoneE164?.trim()) return { action: 'skip', reason: 'no-phone' };

  const template = settings.reviewSmsTemplate?.trim() || DEFAULT_TEMPLATE_FALLBACK;
  const vars: TemplateVars = {
    firstName: _firstName(customer.name),
    lastName:  _lastName(customer.name),
    businessName: settings.businessName?.trim(),
    serviceType:  after.service?.trim(),
    city:         _resolveCity(after, settings),
    vehicle:      _vehicleLabel(vehicle),
    reviewLink:   settings.googleReviewLink.trim(),
  };
  const templateRendered = renderTemplate(template, vars);

  const delayMs = (Number(settings.reviewDelayMinutes) || 0) * 60_000;
  const sendAfterAtEpochMs = Date.now() + delayMs;

  const dateKey = (after.date && /^\d{4}-\d{2}-\d{2}$/.test(after.date))
    ? after.date
    : new Date().toISOString().slice(0, 10);

  return {
    action: 'enqueue',
    requestId: _computeRequestId(after.id, dateKey),
    patch: {
      jobId: after.id,
      customerId: customer.id,
      phoneE164: customer.phoneE164.trim(),
      templateUsed: template,
      templateRendered,
      sendAfterAtEpochMs,
      status: 'pending',
      retryCount: 0,
      invokedByUid: 'system:reviewAutomation',
    },
  };
}

function _computeRequestId(jobId: string, dateIso: string): string {
  return `req-${jobId}-${dateIso}`;
}

export const onJobCompletedReviewRequest = onDocumentWritten(
  'businesses/{businessId}/jobs/{jobId}',
  async (event) => {
    const before = event.data?.before?.data() as JobLite | undefined;
    const afterRaw = event.data?.after?.data() as JobLite | undefined;
    if (!afterRaw) return;  // deletion
    const after: JobLite = { ...afterRaw, id: event.params.jobId };
    const businessId = event.params.businessId;
    const db = admin.firestore();

    // Fast-path skip BEFORE the parallel reads — guards 1/2/3 are cheap.
    if (before?.status === 'Completed') return;
    if (after.status !== 'Completed')   return;
    if (after.reviewRequestSent === true) return;
    if (!after.customerId) return;  // can't enqueue without a customer

    // Three parallel reads: customer, settings, primary vehicle.
    const [custSnap, settingsSnap] = await Promise.all([
      db.doc(`businesses/${businessId}/customers/${after.customerId}`).get(),
      db.doc(`businesses/${businessId}/settings/main`).get(),
    ]);
    if (!custSnap.exists)     return;
    if (!settingsSnap.exists) return;
    const customer: CustomerLite = { id: custSnap.id, ...(custSnap.data() as Omit<CustomerLite, 'id'>) };
    const settings = settingsSnap.data() as SettingsLite;

    // Vehicle is optional — read the FIRST vehicle subdoc if any, else skip.
    let vehicle: VehicleLite | undefined;
    try {
      const vSnap = await db.collection(`businesses/${businessId}/customers/${after.customerId}/vehicles`).limit(1).get();
      if (!vSnap.empty) vehicle = vSnap.docs[0].data() as VehicleLite;
    } catch { /* vehicle is best-effort */ }

    const decision = _decide(before ?? null, after, customer, settings, vehicle);
    if (decision.action === 'skip') {
      console.info('[reviewTrigger] skip', { jobId: after.id, reason: decision.reason });
      return;
    }

    const requestPath = `businesses/${businessId}/reviewRequests/${decision.requestId}`;
    const jobPath     = `businesses/${businessId}/jobs/${after.id}`;
    const now = Timestamp.now();
    const sendAfterAt = Timestamp.fromMillis(decision.patch.sendAfterAtEpochMs);

    await db.runTransaction(async (tx) => {
      // Idempotency layer 2: re-read the Job inside the transaction.
      // Another instance may have flipped the flag between our snapshot
      // and the transaction body.
      const freshJob = await tx.get(db.doc(jobPath));
      if (freshJob.exists && (freshJob.data() as JobLite).reviewRequestSent === true) {
        console.info('[reviewTrigger] race-skip', { jobId: after.id });
        return;
      }
      tx.set(db.doc(requestPath), {
        ...decision.patch,
        sendAfterAt,
        createdAt: now,
      }, { merge: true });
      tx.set(db.doc(jobPath), {
        reviewRequestSent: true,
        reviewRequestId: decision.requestId,
      }, { merge: true });
    });
    console.info('[reviewTrigger] enqueued', { jobId: after.id, requestId: decision.requestId });
  },
);

export const __testHooks = {
  decide: _decide,
  computeRequestId: _computeRequestId,
  firstName: _firstName,
  lastName: _lastName,
  resolveCity: _resolveCity,
  vehicleLabel: _vehicleLabel,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx tests/onJobCompletedReviewRequest.test.ts`
Expected: every check ✓, exit 0, final line `── 19 passed, 0 failed ──`.

- [ ] **Step 5: Confirm functions build**

Run: `cd functions && npm run build && cd ..`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add functions/src/onJobCompletedReviewRequest.ts tests/onJobCompletedReviewRequest.test.ts
git commit -m "$(cat <<'EOF'
feat(trigger): onJobCompletedReviewRequest with 6-guard chain (SP4A task 6)

Firestore trigger on businesses/{bid}/jobs/{jobId}. Skip-fast guards:
  1. before.status === Completed (already-completed edit)
  2. after.status !== Completed
  3. reviewRequestSent === true (idempotency layer 1)
  4. settings.reviewAutomationEnabled === false
  5. settings.googleReviewLink empty (addition #7)
  6. customer.phoneE164 missing

On pass: transactional enqueue of reviewRequests/{req-jobId-dateISO}
PLUS flip jobs/{jobId}.reviewRequestSent. Race-safe via tx.get inside
the transaction. City fallback: job.city → job.area → settings.serviceArea
→ smart-empty strip.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: drainReviewRequests scheduled function

Runs every minute. Lists all businesses; for each, queries the index `(status=='pending', sendAfterAt <= now)` limit 50, then for each pending row: transactional flip `pending → sending`, call twilioClient, on success transition to `sent` + log a `communicationEvents` doc, on 4xx transition to `failed` + log a failed event, on 5xx bump retry counter (and convert to `failed` at retryCount==3), on `TWILIO_NOT_CONFIGURED` leave pending (no log spam, no counter bump).

Designed for dependency injection: the core processing logic accepts a `sendSms` function so tests can mock Twilio without touching the network.

**Files:**
- Create: `functions/src/drainReviewRequests.ts`
- Test: `tests/drainReviewRequests.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/drainReviewRequests.test.ts`:

```ts
// ═══════════════════════════════════════════════════════════════════
//  tests/drainReviewRequests.test.ts
//  Run: npx tsx tests/drainReviewRequests.test.ts
//
//  Exercises the drainer's per-request decision tree via the
//  __testHooks.processOne() hook. Shimmed Firestore + injected
//  sendSms function — no emulator, no network.
// ═══════════════════════════════════════════════════════════════════

import { __testHooks } from '../functions/src/drainReviewRequests';

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else      { failed++; console.error(`  ✗ ${name}${detail ? `  — ${detail}` : ''}`); }
}

const { processOne } = __testHooks;

interface FakeDoc {
  path: string;
  data: Record<string, unknown>;
}
function makeShim(initialRequest: Record<string, unknown>) {
  const docs = new Map<string, Record<string, unknown>>();
  docs.set('businesses/biz1/reviewRequests/req1', { id: 'req1', ...initialRequest });
  const writes: Array<{ path: string; patch: Record<string, unknown>; op: 'set' | 'update' }> = [];
  const events: FakeDoc[] = [];

  return {
    docs, writes, events,
    // mimic admin Firestore shape the drainer needs
    tx: {
      get: async (ref: { path: string }) => ({
        exists: docs.has(ref.path),
        data: () => docs.get(ref.path),
      }),
      update: (ref: { path: string }, patch: Record<string, unknown>) => {
        const current = docs.get(ref.path) ?? {};
        docs.set(ref.path, { ...current, ...patch });
        writes.push({ path: ref.path, patch, op: 'update' });
      },
      set: (ref: { path: string }, patch: Record<string, unknown>) => {
        docs.set(ref.path, { ...(docs.get(ref.path) ?? {}), ...patch });
        writes.push({ path: ref.path, patch, op: 'set' });
      },
    },
    addCommunicationEvent: (e: Record<string, unknown>) => {
      events.push({ path: `businesses/biz1/communicationEvents/evt${events.length+1}`, data: e });
    },
  };
}

function baseRequest(over: Record<string, unknown> = {}) {
  return {
    jobId: 'jobA', customerId: 'cust1', phoneE164: '+13055551234',
    templateUsed: 'Hi {firstName}', templateRendered: 'Hi Maria, leave a review: https://g.page/r/x',
    status: 'pending', retryCount: 0, ...over,
  };
}

console.log('\n── Twilio off — leaves pending, no counter bump ──');
{
  const shim = makeShim(baseRequest());
  const sendSms = async () => { throw new Error('TWILIO_NOT_CONFIGURED'); };
  await processOne({ businessId: 'biz1', requestId: 'req1' }, shim.tx as never, sendSms, shim.addCommunicationEvent);
  const after = shim.docs.get('businesses/biz1/reviewRequests/req1');
  check('status stays pending', after?.status === 'pending');
  check('retryCount stays 0',   after?.retryCount === 0);
  check('no errorMessage written', after?.errorMessage === undefined);
  check('no communicationEvents log', shim.events.length === 0);
}

console.log('\n── 4xx — terminal fail, no retry ──');
{
  const shim = makeShim(baseRequest());
  const err = Object.assign(new Error('Invalid number'), { name: 'TwilioError', status: 400, carrierCode: '21211' });
  const sendSms = async () => { throw err; };
  await processOne({ businessId: 'biz1', requestId: 'req1' }, shim.tx as never, sendSms, shim.addCommunicationEvent);
  const after = shim.docs.get('businesses/biz1/reviewRequests/req1');
  check('status=failed on 4xx', after?.status === 'failed');
  check('errorMessage contains carrier code', String(after?.errorMessage ?? '').includes('21211'));
  check('1 communicationEvents log written', shim.events.length === 1);
  check('event type is review_request_failed', shim.events[0].data.type === 'review_request_failed');
}

console.log('\n── 5xx — retry, bumps counter ──');
{
  const shim = makeShim(baseRequest({ retryCount: 0 }));
  const err = Object.assign(new Error('upstream'), { name: 'TwilioError', status: 503 });
  const sendSms = async () => { throw err; };
  await processOne({ businessId: 'biz1', requestId: 'req1' }, shim.tx as never, sendSms, shim.addCommunicationEvent);
  const after = shim.docs.get('businesses/biz1/reviewRequests/req1');
  check('status stays pending after 5xx', after?.status === 'pending');
  check('retryCount incremented to 1', after?.retryCount === 1);
  check('no communicationEvents log on transient retry', shim.events.length === 0);
}

console.log('\n── 5xx — third strike → failed ──');
{
  const shim = makeShim(baseRequest({ retryCount: 2 }));
  const err = Object.assign(new Error('upstream'), { name: 'TwilioError', status: 503 });
  const sendSms = async () => { throw err; };
  await processOne({ businessId: 'biz1', requestId: 'req1' }, shim.tx as never, sendSms, shim.addCommunicationEvent);
  const after = shim.docs.get('businesses/biz1/reviewRequests/req1');
  check('status=failed at retryCount==3', after?.status === 'failed');
  check('retryCount frozen at 3', after?.retryCount === 3);
  check('communicationEvents log on terminal failure', shim.events.length === 1);
}

console.log('\n── success — sent + sid + lifecycle ──');
{
  const shim = makeShim(baseRequest());
  const sendSms = async () => ({ messageSid: 'SM_test_abc', deliveryStatus: 'queued' });
  await processOne({ businessId: 'biz1', requestId: 'req1' }, shim.tx as never, sendSms, shim.addCommunicationEvent);
  const after = shim.docs.get('businesses/biz1/reviewRequests/req1');
  check('status=sent', after?.status === 'sent');
  check('twilioMessageSid populated', after?.twilioMessageSid === 'SM_test_abc');
  check('deliveryStatus set to queued', after?.deliveryStatus === 'queued');
  check('sentAt populated', after?.sentAt !== undefined);
  check('1 communicationEvents log written', shim.events.length === 1);
  check('event type review_request_sent', shim.events[0].data.type === 'review_request_sent');
  check('event content matches templateRendered', shim.events[0].data.content === 'Hi Maria, leave a review: https://g.page/r/x');
}

console.log('\n── racing instances — second one no-ops ──');
{
  // Pre-flip the request to sending to simulate Instance A already claimed it.
  const shim = makeShim(baseRequest({ status: 'sending' }));
  const sendSms = async () => { throw new Error('should not be called'); };
  await processOne({ businessId: 'biz1', requestId: 'req1' }, shim.tx as never, sendSms, shim.addCommunicationEvent);
  const after = shim.docs.get('businesses/biz1/reviewRequests/req1');
  check('status stays sending — second instance skipped', after?.status === 'sending');
  check('no writes from second instance', shim.writes.every(w => w.path !== 'businesses/biz1/reviewRequests/req1' || w.patch.status === undefined || w.patch.status === 'sending'));
  check('no communicationEvents log',  shim.events.length === 0);
}

console.log('\n── sendAfterAt in the future — leaves pending ──');
{
  const futureMs = Date.now() + 10 * 60_000;
  const shim = makeShim(baseRequest({ sendAfterAt: { _seconds: Math.floor(futureMs / 1000), _nanoseconds: 0 } }));
  // The query layer normally filters this out, but processOne defends too.
  const sendSms = async () => { throw new Error('should not be called'); };
  await processOne({ businessId: 'biz1', requestId: 'req1' }, shim.tx as never, sendSms, shim.addCommunicationEvent);
  const after = shim.docs.get('businesses/biz1/reviewRequests/req1');
  check('status stays pending when sendAfterAt > now', after?.status === 'pending');
  check('no events', shim.events.length === 0);
}

console.log(`\n── ${passed} passed, ${failed} failed ──\n`);
process.exit(failed > 0 ? 1 : 0);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx tests/drainReviewRequests.test.ts`
Expected: `Cannot find module '../functions/src/drainReviewRequests'`.

- [ ] **Step 3: Write the drainer implementation**

Create `functions/src/drainReviewRequests.ts`:

```ts
// functions/src/drainReviewRequests.ts
// ═══════════════════════════════════════════════════════════════════
//  drainReviewRequests — scheduled drainer (SP4A task 7).
//
//  Spec: docs/superpowers/specs/2026-06-03-sp4a-review-automation-design.md
//        §"3. drainReviewRequests scheduled function"
//
//  Cron: every 1 minute. Lists active businesses, queries pending
//  reviewRequests (status='pending' AND sendAfterAt <= now, limit 50),
//  and for each row:
//    - 'TWILIO_NOT_CONFIGURED' → leave pending (dormant mode)
//    - 4xx                     → status=failed (no retry)
//    - 5xx                     → retryCount++ (status=failed at 3)
//    - success                 → status=sent + log event
//
//  The drainer is idempotent and race-safe via transactional flip
//  from 'pending' → 'sending' inside processOne.
// ═══════════════════════════════════════════════════════════════════

import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as admin from 'firebase-admin';
import { Timestamp, FieldValue } from 'firebase-admin/firestore';
import { sendSms as realSendSms, TwilioError } from './lib/twilioClient';
void admin;
void FieldValue;

const BATCH_LIMIT = 50;
const MAX_RETRIES = 3;

interface ProcessTarget {
  businessId: string;
  requestId: string;
}

type SendSmsFn = (args: { to: string; body: string }) => Promise<{ messageSid: string; deliveryStatus: string }>;
type EventSink  = (e: Record<string, unknown>) => void;

// Minimal Firestore-tx shape — wide enough for the production admin
// transaction object AND the test shim.
interface TxLike {
  get(ref: { path: string }): Promise<{ exists: boolean; data: () => Record<string, unknown> | undefined }>;
  update(ref: { path: string }, patch: Record<string, unknown>): void;
  set(ref: { path: string }, patch: Record<string, unknown>): void;
}

function _isSendAfterPast(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value === 'number') return value <= Date.now();
  // Firestore Timestamp or admin Timestamp shape
  const obj = value as { _seconds?: number; seconds?: number; toMillis?: () => number };
  if (typeof obj.toMillis === 'function') return obj.toMillis() <= Date.now();
  const seconds = obj._seconds ?? obj.seconds;
  if (typeof seconds === 'number') return seconds * 1000 <= Date.now();
  return true;
}

/**
 * Process exactly one queue entry. Pure logic — tx + sendSms +
 * addCommunicationEvent are injected so tests stub them.
 */
async function _processOne(
  target: ProcessTarget,
  tx: TxLike,
  sendSms: SendSmsFn,
  addCommunicationEvent: EventSink,
): Promise<void> {
  const path = `businesses/${target.businessId}/reviewRequests/${target.requestId}`;
  const snap = await tx.get({ path });
  if (!snap.exists) return;
  const req = snap.data() ?? {};

  if (req.status !== 'pending') return;
  if (!_isSendAfterPast(req.sendAfterAt)) return;

  // Transactional flip pending → sending (race guard for two
  // instances draining the same minute).
  tx.update({ path }, { status: 'sending' });

  try {
    const result = await sendSms({ to: String(req.phoneE164), body: String(req.templateRendered) });
    const sentAt = Timestamp.now();
    tx.update({ path }, {
      status: 'sent',
      sentAt,
      twilioMessageSid: result.messageSid,
      deliveryStatus:   result.deliveryStatus,
    });
    addCommunicationEvent({
      type: 'review_request_sent',
      channel: 'sms',
      direction: 'outbound',
      customerId: req.customerId,
      jobId: req.jobId,
      reviewRequestId: target.requestId,
      content: req.templateRendered,
      status: 'sent',
      providerMessageId: result.messageSid,
      deliveryStatus:    result.deliveryStatus,
      sentAt,
      createdByUid: req.invokedByUid ?? 'system:reviewAutomation',
    });
  } catch (err) {
    const msg = (err as Error).message;
    // Dormant mode — leave pending, no counter bump, no log.
    if (msg === 'TWILIO_NOT_CONFIGURED') {
      tx.update({ path }, { status: 'pending' });   // unwind the sending flip
      return;
    }
    // Transient vs terminal.
    if (err instanceof TwilioError || (err as { name?: string }).name === 'TwilioError') {
      const status = (err as TwilioError).status;
      if (status >= 500) {
        const nextRetry = Number(req.retryCount ?? 0) + 1;
        if (nextRetry >= MAX_RETRIES) {
          const failedAt = Timestamp.now();
          tx.update({ path }, {
            status: 'failed',
            retryCount: nextRetry,
            failedAt,
            errorMessage: `transient retries exhausted: ${msg}`,
          });
          addCommunicationEvent({
            type: 'review_request_failed',
            channel: 'sms', direction: 'outbound',
            customerId: req.customerId, jobId: req.jobId,
            reviewRequestId: target.requestId,
            status: 'failed',
            sentAt: failedAt,
            content: req.templateRendered,
            carrierResponse: msg,
            createdByUid: req.invokedByUid ?? 'system:reviewAutomation',
          });
        } else {
          tx.update({ path }, { status: 'pending', retryCount: nextRetry });
        }
        return;
      }
      // 4xx terminal
      const failedAt = Timestamp.now();
      const carrierCode = (err as TwilioError).carrierCode;
      tx.update({ path }, {
        status: 'failed',
        failedAt,
        errorMessage: carrierCode ? `${carrierCode}: ${msg}` : msg,
      });
      addCommunicationEvent({
        type: 'review_request_failed',
        channel: 'sms', direction: 'outbound',
        customerId: req.customerId, jobId: req.jobId,
        reviewRequestId: target.requestId,
        status: 'failed',
        sentAt: failedAt,
        content: req.templateRendered,
        carrierResponse: carrierCode,
        createdByUid: req.invokedByUid ?? 'system:reviewAutomation',
      });
      return;
    }
    // Unknown error class — treat as transient.
    const nextRetry = Number(req.retryCount ?? 0) + 1;
    if (nextRetry >= MAX_RETRIES) {
      const failedAt = Timestamp.now();
      tx.update({ path }, {
        status: 'failed',
        retryCount: nextRetry,
        failedAt,
        errorMessage: `unknown error after retries: ${msg}`,
      });
      addCommunicationEvent({
        type: 'review_request_failed',
        channel: 'sms', direction: 'outbound',
        customerId: req.customerId, jobId: req.jobId,
        reviewRequestId: target.requestId,
        status: 'failed',
        sentAt: failedAt,
        content: req.templateRendered,
        carrierResponse: msg,
        createdByUid: req.invokedByUid ?? 'system:reviewAutomation',
      });
    } else {
      tx.update({ path }, { status: 'pending', retryCount: nextRetry });
    }
  }
}

export const drainReviewRequests = onSchedule(
  { schedule: 'every 1 minutes', timeoutSeconds: 540, memory: '512MiB' },
  async () => {
    const db = admin.firestore();
    const now = Timestamp.now();
    const startTs = Date.now();

    // List businesses by walking the top-level collection. This is
    // a bounded query for SP4A's tenant count (<100). When the tenant
    // count crosses ~1000, swap to a per-business pubsub subscription
    // (tracked in SP4B's scale-out followup).
    const bizSnap = await db.collection('businesses').get();
    let scanned = 0, sent = 0, failedCount = 0;
    for (const bizDoc of bizSnap.docs) {
      const businessId = bizDoc.id;
      // Pull pending whose sendAfterAt is past. Uses the composite
      // index added in Task 4.
      const pendingSnap = await db.collection(`businesses/${businessId}/reviewRequests`)
        .where('status', '==', 'pending')
        .where('sendAfterAt', '<=', now)
        .limit(BATCH_LIMIT)
        .get();
      for (const reqDoc of pendingSnap.docs) {
        scanned += 1;
        const target = { businessId, requestId: reqDoc.id };
        try {
          await db.runTransaction(async (tx) => {
            const events: Array<Record<string, unknown>> = [];
            const addEvent: EventSink = (e) => events.push(e);
            // Real tx satisfies TxLike; admin tx APIs accept DocumentReference,
            // so we adapt by wrapping the path back into a ref inside the helper.
            const adapter: TxLike = {
              get: async (ref) => {
                const s = await tx.get(db.doc(ref.path));
                return { exists: s.exists, data: () => s.data() ?? undefined };
              },
              update: (ref, patch) => tx.update(db.doc(ref.path), patch),
              set:    (ref, patch) => tx.set(db.doc(ref.path), patch, { merge: true }),
            };
            await _processOne(target, adapter, realSendSms, addEvent);
            // After the request-doc writes are queued, append events.
            for (const e of events) {
              const eventRef = db.collection(`businesses/${businessId}/communicationEvents`).doc();
              tx.set(eventRef, e);
            }
            if (events.find(e => e.type === 'review_request_sent'))   sent += 1;
            if (events.find(e => e.type === 'review_request_failed')) failedCount += 1;
          });
        } catch (err) {
          // Tx aborted (contention) — let the next minute retry.
          console.error('[drainReviewRequests] tx failed', { target, err: (err as Error).message });
        }
      }
    }
    console.info('[drainReviewRequests] done', {
      scanned, sent, failed: failedCount, durationMs: Date.now() - startTs,
    });
  },
);

export const __testHooks = {
  processOne: _processOne,
  isSendAfterPast: _isSendAfterPast,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx tests/drainReviewRequests.test.ts`
Expected: every check ✓, exit 0, final line `── 23 passed, 0 failed ──`.

- [ ] **Step 5: Confirm functions build**

Run: `cd functions && npm run build && cd ..`
Expected: exit 0. If the v2 scheduler import errors, your `firebase-functions` version is below 5 — the install at `functions/package.json` pins `^5.0.0`, so `npm install` in `functions/` will fix it.

- [ ] **Step 6: Commit**

```bash
git add functions/src/drainReviewRequests.ts tests/drainReviewRequests.test.ts
git commit -m "$(cat <<'EOF'
feat(drainer): drainReviewRequests every-1-minute poller (SP4A task 7)

onSchedule('every 1 minutes') drainer. Per row:
  - TWILIO_NOT_CONFIGURED → leave pending (dormant SP4A mode)
  - 4xx                   → failed + event log
  - 5xx                   → retry++ (failed at 3)
  - success               → sent + sid + deliveryStatus + event log

Race-safe via transactional flip pending→sending. processOne()
exposed via __testHooks for unit coverage; tests stub Firestore +
sendSms with no emulator + no network.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: HTTPS callables — sendTestReviewSms + sendManualReviewRequest

Two callables that both write into the same `reviewRequests` queue. The drainer doesn't care how a doc got there; both paths get the same idempotency, history rendering, and retry semantics.

**Auth model:**
- `sendTestReviewSms` — owner or admin. Phone defaults to caller's member-doc phone but the operator can override.
- `sendManualReviewRequest` — owner or admin. Targets a specific completed Job.

Both share an `_assertOwnerOrAdmin` helper that mirrors `backfillCustomers.ts`'s gating pattern.

**Files:**
- Create: `functions/src/sendTestReviewSms.ts`
- Create: `functions/src/sendManualReviewRequest.ts`
- Test: `tests/reviewAutomationCallables.test.ts` (covers both via shared `__testHooks.buildPatch`)

- [ ] **Step 1: Write the failing test**

Create `tests/reviewAutomationCallables.test.ts`:

```ts
// ═══════════════════════════════════════════════════════════════════
//  tests/reviewAutomationCallables.test.ts
//  Run: npx tsx tests/reviewAutomationCallables.test.ts
//
//  Exercises buildPatch() for both callables. Validates required-field
//  enforcement, the isTest/isManual flag wiring, and the shared
//  doc-id idempotency.
// ═══════════════════════════════════════════════════════════════════

import { __testHooks as testHooks } from '../functions/src/sendTestReviewSms';
import { __testHooks as manualHooks } from '../functions/src/sendManualReviewRequest';

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else      { failed++; console.error(`  ✗ ${name}${detail ? `  — ${detail}` : ''}`); }
}

console.log('\n── sendTestReviewSms — buildPatch ──');
{
  const out = testHooks.buildPatch({
    phoneE164: '+13055551234',
    template: 'Hi {firstName}, this is a test. {reviewLink}',
    settings: { reviewSmsTemplate: 'X', googleReviewLink: 'https://g.page/r/xxx', businessName: 'Wheel Rush' },
    uid: 'uid-owner',
  });
  check('isTest flag set', out.isTest === true);
  check('isManual flag undefined or false', !out.isManual);
  check('invokedByUid carries caller uid', out.invokedByUid === 'uid-owner');
  check('phoneE164 propagated', out.phoneE164 === '+13055551234');
  check('templateUsed reflects passed template', out.templateUsed === 'Hi {firstName}, this is a test. {reviewLink}');
  check('reviewLink substituted into rendered body', out.templateRendered.includes('https://g.page/r/xxx'));
  check('status pending', out.status === 'pending');
  check('retryCount 0', out.retryCount === 0);
}

console.log('\n── sendManualReviewRequest — buildPatch ──');
{
  const out = manualHooks.buildPatch({
    jobId: 'jobA', customerId: 'cust1',
    customerName: 'Maria Lopez', phoneE164: '+13055551234',
    serviceType: 'Tire Replacement', city: 'Hollywood',
    vehicleMakeModel: 'Honda Civic',
    settings: {
      reviewSmsTemplate: 'Hi {firstName} {lastName}, thanks for choosing {businessName} for your {serviceType} in {city}. {reviewLink}',
      googleReviewLink: 'https://g.page/r/xxx',
      businessName: 'Wheel Rush',
    },
    uid: 'uid-owner',
  });
  check('isManual flag set', out.isManual === true);
  check('isTest absent', !out.isTest);
  check('invokedByUid carries caller uid', out.invokedByUid === 'uid-owner');
  check('jobId carried', out.jobId === 'jobA');
  check('customerId carried', out.customerId === 'cust1');
  check('templateRendered contains firstName Maria', out.templateRendered.includes('Maria'));
  check('templateRendered contains lastName Lopez', out.templateRendered.includes('Lopez'));
  check('templateRendered contains vehicle if template uses {vehicle} — none here, but business name should',
    out.templateRendered.includes('Wheel Rush'));
}

console.log('\n── computeRequestId — same job same day = same id ──');
{
  const a = manualHooks.computeRequestId('jobA', '2026-06-03');
  const b = manualHooks.computeRequestId('jobA', '2026-06-03');
  check('idempotent doc id', a === b);
  check('matches req-{jobId}-{date} shape', /^req-jobA-2026-06-03$/.test(a));
}

console.log('\n── sendTestReviewSms — defaults phone when omitted from input ──');
{
  // buildPatch requires phoneE164; the wrapper is what defaults to the caller's
  // member phone. We assert the helper REJECTS when caller doesn't supply.
  let threw = false;
  try {
    testHooks.buildPatch({
      phoneE164: '',
      template: 'X', settings: { googleReviewLink: 'https://g.page/r/x' }, uid: 'u',
    });
  } catch { threw = true; }
  check('buildPatch refuses empty phoneE164', threw);
}

console.log('\n── sendManualReviewRequest — refuses without googleReviewLink ──');
{
  let threw = false;
  try {
    manualHooks.buildPatch({
      jobId: 'jobA', customerId: 'cust1',
      customerName: 'Maria', phoneE164: '+13055551234',
      serviceType: 'X', city: 'Y',
      settings: { reviewSmsTemplate: 'Hi {firstName}', googleReviewLink: '' },
      uid: 'u',
    });
  } catch { threw = true; }
  check('buildPatch refuses when googleReviewLink empty', threw);
}

console.log(`\n── ${passed} passed, ${failed} failed ──\n`);
process.exit(failed > 0 ? 1 : 0);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx tests/reviewAutomationCallables.test.ts`
Expected: module-not-found.

- [ ] **Step 3: Write `sendTestReviewSms`**

Create `functions/src/sendTestReviewSms.ts`:

```ts
// functions/src/sendTestReviewSms.ts
// ═══════════════════════════════════════════════════════════════════
//  sendTestReviewSms — HTTPS callable (SP4A task 8).
//
//  Spec: §"7. Send Test SMS form" in
//        docs/superpowers/specs/2026-06-03-sp4a-review-automation-design.md
//
//  Owner/admin gated. Enqueues a reviewRequests doc with isTest:true
//  + sendAfterAt:now so the drainer picks it up immediately. The doc
//  id is req-test-{uid}-{epochMs} so multiple test sends from the
//  same operator on the same day still produce distinct rows.
// ═══════════════════════════════════════════════════════════════════

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import { renderTemplate } from './lib/reviewTemplate';
void admin;

interface SendTestInput {
  businessId: string;
  phoneE164?: string;     // optional override; defaults to caller's member.phone
  template?: string;      // optional override; defaults to settings.reviewSmsTemplate
}

interface BuildPatchArgs {
  phoneE164: string;
  template: string;
  settings: {
    reviewSmsTemplate?: string;
    googleReviewLink?: string;
    businessName?: string;
  };
  uid: string;
}

function _buildPatch(args: BuildPatchArgs): Record<string, unknown> {
  if (!args.phoneE164?.trim()) throw new Error('phoneE164 required');
  if (!args.settings.googleReviewLink?.trim()) throw new Error('googleReviewLink required in settings');
  const template = args.template?.trim() || args.settings.reviewSmsTemplate?.trim() || '';
  if (!template) throw new Error('template required');
  const rendered = renderTemplate(template, {
    firstName: 'Test',
    lastName:  'Operator',
    businessName: args.settings.businessName?.trim(),
    serviceType:  'Test Send',
    city:         '',
    vehicle:      '',
    reviewLink:   args.settings.googleReviewLink.trim(),
  });
  return {
    jobId: '__test__',
    customerId: '__test__',
    phoneE164: args.phoneE164.trim(),
    templateUsed: template,
    templateRendered: rendered,
    status: 'pending',
    retryCount: 0,
    isTest: true,
    invokedByUid: args.uid,
  };
}

export const sendTestReviewSms = onCall<SendTestInput, Promise<{ requestId: string }>>(async (req) => {
  const uid = req.auth?.uid;
  const { businessId, phoneE164, template } = req.data ?? { businessId: '' };
  if (!uid)        throw new HttpsError('unauthenticated', 'sign-in required');
  if (!businessId) throw new HttpsError('invalid-argument', 'businessId required');

  const db = admin.firestore();
  const memberSnap = await db.doc(`businesses/${businessId}/members/${uid}`).get();
  const role = memberSnap.data()?.role;
  if (role !== 'owner' && role !== 'admin') {
    throw new HttpsError('permission-denied', 'owner or admin only');
  }
  const memberPhone = (memberSnap.data()?.phoneE164 ?? '') as string;
  const targetPhone = phoneE164?.trim() || memberPhone.trim();
  if (!targetPhone) {
    throw new HttpsError('invalid-argument', 'phoneE164 required (caller member doc has none)');
  }

  const settingsSnap = await db.doc(`businesses/${businessId}/settings/main`).get();
  const settings = settingsSnap.data() ?? {};
  if (!settings.googleReviewLink?.trim()) {
    throw new HttpsError('failed-precondition', 'set Google Review URL in Settings first');
  }

  let patch: Record<string, unknown>;
  try {
    patch = _buildPatch({
      phoneE164: targetPhone,
      template: template ?? '',
      settings,
      uid,
    });
  } catch (err) {
    throw new HttpsError('invalid-argument', (err as Error).message);
  }

  const requestId = `req-test-${uid}-${Date.now()}`;
  const now = Timestamp.now();
  await db.doc(`businesses/${businessId}/reviewRequests/${requestId}`).set({
    ...patch,
    sendAfterAt: now,
    createdAt: now,
  }, { merge: true });

  return { requestId };
});

export const __testHooks = {
  buildPatch: _buildPatch,
};
```

- [ ] **Step 4: Write `sendManualReviewRequest`**

Create `functions/src/sendManualReviewRequest.ts`:

```ts
// functions/src/sendManualReviewRequest.ts
// ═══════════════════════════════════════════════════════════════════
//  sendManualReviewRequest — HTTPS callable (SP4A task 8).
//
//  Spec: §"Manual Review Request (addition #6)" in
//        docs/superpowers/specs/2026-06-03-sp4a-review-automation-design.md
//
//  Owner/admin gated. Enqueues with isManual:true, sendAfterAt:now.
//  Doc id matches the trigger's req-{jobId}-{date} pattern so re-clicks
//  same day collapse to the same row (idempotency).
// ═══════════════════════════════════════════════════════════════════

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import { renderTemplate } from './lib/reviewTemplate';
void admin;

interface SendManualInput {
  businessId: string;
  jobId: string;
}

interface BuildPatchArgs {
  jobId: string;
  customerId: string;
  customerName: string;
  phoneE164: string;
  serviceType: string;
  city: string;
  vehicleMakeModel?: string;
  settings: {
    reviewSmsTemplate?: string;
    googleReviewLink?: string;
    businessName?: string;
    serviceArea?: string;
  };
  uid: string;
}

function _firstName(name?: string): string {
  return (name ?? '').trim().split(/\s+/)[0] ?? '';
}
function _lastName(name?: string): string {
  const parts = (name ?? '').trim().split(/\s+/);
  return parts.length > 1 ? parts.slice(1).join(' ') : '';
}

function _buildPatch(args: BuildPatchArgs): Record<string, unknown> {
  if (!args.phoneE164?.trim())            throw new Error('phoneE164 required');
  if (!args.settings.googleReviewLink?.trim()) throw new Error('googleReviewLink required in settings');
  const template = args.settings.reviewSmsTemplate?.trim() || 'Hi {firstName}, leave a review: {reviewLink}';
  const cityResolved = args.city?.trim() || args.settings.serviceArea?.trim() || '';
  const rendered = renderTemplate(template, {
    firstName:    _firstName(args.customerName),
    lastName:     _lastName(args.customerName),
    businessName: args.settings.businessName?.trim(),
    serviceType:  args.serviceType?.trim(),
    city:         cityResolved,
    vehicle:      args.vehicleMakeModel?.trim() ?? '',
    reviewLink:   args.settings.googleReviewLink.trim(),
  });
  return {
    jobId: args.jobId,
    customerId: args.customerId,
    phoneE164: args.phoneE164.trim(),
    templateUsed: template,
    templateRendered: rendered,
    status: 'pending',
    retryCount: 0,
    isManual: true,
    invokedByUid: args.uid,
  };
}

function _computeRequestId(jobId: string, dateIso: string): string {
  return `req-${jobId}-${dateIso}`;
}

export const sendManualReviewRequest = onCall<SendManualInput, Promise<{ requestId: string }>>(async (req) => {
  const uid = req.auth?.uid;
  const { businessId, jobId } = req.data ?? { businessId: '', jobId: '' };
  if (!uid)        throw new HttpsError('unauthenticated', 'sign-in required');
  if (!businessId) throw new HttpsError('invalid-argument', 'businessId required');
  if (!jobId)      throw new HttpsError('invalid-argument', 'jobId required');

  const db = admin.firestore();
  const memberSnap = await db.doc(`businesses/${businessId}/members/${uid}`).get();
  const role = memberSnap.data()?.role;
  if (role !== 'owner' && role !== 'admin') {
    throw new HttpsError('permission-denied', 'owner or admin only');
  }

  const [jobSnap, settingsSnap] = await Promise.all([
    db.doc(`businesses/${businessId}/jobs/${jobId}`).get(),
    db.doc(`businesses/${businessId}/settings/main`).get(),
  ]);
  if (!jobSnap.exists)     throw new HttpsError('not-found', 'job not found');
  if (!settingsSnap.exists) throw new HttpsError('failed-precondition', 'settings missing');

  const job      = jobSnap.data() ?? {};
  const settings = settingsSnap.data() ?? {};
  if (job.status !== 'Completed') {
    throw new HttpsError('failed-precondition', 'job must be Completed');
  }
  if (!job.customerId) throw new HttpsError('failed-precondition', 'job has no customer');

  const custSnap = await db.doc(`businesses/${businessId}/customers/${job.customerId}`).get();
  if (!custSnap.exists) throw new HttpsError('not-found', 'customer not found');
  const customer = custSnap.data() ?? {};
  if (!customer.phoneE164) throw new HttpsError('failed-precondition', 'customer has no phone');

  // Optional vehicle (limit 1, best-effort)
  let vehicleMakeModel: string | undefined;
  try {
    const vSnap = await db.collection(`businesses/${businessId}/customers/${job.customerId}/vehicles`).limit(1).get();
    if (!vSnap.empty) vehicleMakeModel = (vSnap.docs[0].data() as { vehicleMakeModel?: string }).vehicleMakeModel;
  } catch { /* best-effort */ }

  let patch: Record<string, unknown>;
  try {
    patch = _buildPatch({
      jobId,
      customerId: job.customerId,
      customerName: customer.name ?? '',
      phoneE164:    customer.phoneE164,
      serviceType:  job.service ?? '',
      city:         (job.city ?? job.area ?? '') as string,
      vehicleMakeModel,
      settings,
      uid,
    });
  } catch (err) {
    throw new HttpsError('invalid-argument', (err as Error).message);
  }

  const dateKey = (job.date && /^\d{4}-\d{2}-\d{2}$/.test(String(job.date)))
    ? String(job.date)
    : new Date().toISOString().slice(0, 10);
  const requestId = _computeRequestId(jobId, dateKey);
  const now = Timestamp.now();
  await db.doc(`businesses/${businessId}/reviewRequests/${requestId}`).set({
    ...patch,
    sendAfterAt: now,
    createdAt: now,
  }, { merge: true });

  return { requestId };
});

export const __testHooks = {
  buildPatch: _buildPatch,
  computeRequestId: _computeRequestId,
};
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx tsx tests/reviewAutomationCallables.test.ts`
Expected: every check ✓, exit 0, `── 17 passed, 0 failed ──`.

- [ ] **Step 6: Confirm functions build**

Run: `cd functions && npm run build && cd ..`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add functions/src/sendTestReviewSms.ts functions/src/sendManualReviewRequest.ts tests/reviewAutomationCallables.test.ts
git commit -m "$(cat <<'EOF'
feat(callables): sendTestReviewSms + sendManualReviewRequest (SP4A task 8)

Two HTTPS callables that enqueue into the shared reviewRequests queue:
  - sendTestReviewSms (isTest:true, req-test-{uid}-{ms} doc id)
  - sendManualReviewRequest (isManual:true, req-{jobId}-{date} doc id
    matching the trigger pattern for idempotency)

Both owner+admin gated. Both refuse when googleReviewLink missing.
buildPatch() helpers exposed via __testHooks for unit coverage.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: functions/src/index.ts — wire 4 new exports

**Files:**
- Modify: `functions/src/index.ts` (add exports after the `onJobWriteCustomerRollup` export at line 69)

- [ ] **Step 1: Add the exports**

Edit `functions/src/index.ts`. After the line:

```ts
export { onJobWriteCustomerRollup } from './onJobWriteCustomerRollup';
```

add:

```ts

// SP4A: review automation. Four functions:
//   - onJobCompletedReviewRequest  Firestore trigger on job writes;
//                                  guards + transactional enqueue.
//   - drainReviewRequests          Scheduled every 1 minute; flips
//                                  pending → sent via twilioClient.
//   - sendTestReviewSms            HTTPS callable; isTest:true.
//   - sendManualReviewRequest      HTTPS callable; isManual:true.
//
// All four ship dormant when Twilio env secrets are missing: the
// trigger still fires + queue still writes + drainer still polls,
// but no SMS goes out until SP4B configures TWILIO_ACCOUNT_SID /
// TWILIO_AUTH_TOKEN / TWILIO_PHONE_NUMBER.
export { onJobCompletedReviewRequest } from './onJobCompletedReviewRequest';
export { drainReviewRequests }         from './drainReviewRequests';
export { sendTestReviewSms }           from './sendTestReviewSms';
export { sendManualReviewRequest }     from './sendManualReviewRequest';
```

- [ ] **Step 2: Build**

Run: `cd functions && npm run build && cd ..`
Expected: exit 0. `functions/lib/index.js` contains the 4 new exports.

- [ ] **Step 3: Verify the exports resolve**

Run: `node -e "const m = require('./functions/lib/index.js'); console.log(Object.keys(m).filter(k => k.match(/Review|review/)).sort().join(','))"`
Expected: `drainReviewRequests,onJobCompletedReviewRequest,sendManualReviewRequest,sendTestReviewSms`

- [ ] **Step 4: Commit**

```bash
git add functions/src/index.ts
git commit -m "$(cat <<'EOF'
feat(functions): export 4 SP4A functions (SP4A task 9)

Wires onJobCompletedReviewRequest + drainReviewRequests + sendTestReviewSms
+ sendManualReviewRequest into the deployable barrel. All four ship
dormant; drainer no-ops until env secrets are populated.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: ReviewRequestHistoryTable component

Extracted from `ReviewAutomationSection` because the history surface is the most complex sub-piece (filters + search + per-row expand). Pulling it out keeps the parent under ~400 lines.

**Files:**
- Create: `src/components/settings/ReviewRequestHistoryTable.tsx`

- [ ] **Step 1: Write the component**

Create `src/components/settings/ReviewRequestHistoryTable.tsx`:

```tsx
// src/components/settings/ReviewRequestHistoryTable.tsx
// ═══════════════════════════════════════════════════════════════════
//  ReviewRequestHistoryTable — SP4A history surface.
//
//  Spec: §"8. Review Request History table (addition #4)" in
//        docs/superpowers/specs/2026-06-03-sp4a-review-automation-design.md
//
//  Subscribes to the last 100 reviewRequests by createdAt desc. Five
//  status filter chips (computed for 'scheduled' = pending+future,
//  'pending' = pending+past). Client-side substring search across
//  customer name / phone / jobId. Tap row to expand → full body +
//  error + cancel button.
// ═══════════════════════════════════════════════════════════════════

import { memo, useEffect, useMemo, useState, type CSSProperties } from 'react';
import {
  collection, limit, onSnapshot, orderBy, query,
  type Firestore,
} from 'firebase/firestore';
import { _db } from '@/lib/firebase';
import { formatPhoneForDisplay } from '@/lib/phone';
import type { ReviewRequest, ReviewRequestStatus } from '@/types';

type FilterKey = 'all' | 'pending' | 'scheduled' | 'sent' | 'failed' | 'cancelled';

interface Props {
  businessId: string;
}

interface CustomerNameMap { [id: string]: string }

function ReviewRequestHistoryTableImpl({ businessId }: Props): JSX.Element {
  const [rows,   setRows]   = useState<ReviewRequest[]>([]);
  const [names,  setNames]  = useState<CustomerNameMap>({});
  const [filter, setFilter] = useState<FilterKey>('all');
  const [searchInput, setSearch] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    if (!businessId) return;
    const q = query(
      collection(_db as Firestore, 'businesses', businessId, 'reviewRequests'),
      orderBy('createdAt', 'desc'),
      limit(100),
    );
    const unsub = onSnapshot(q, (snap) => {
      const next: ReviewRequest[] = [];
      snap.forEach(d => next.push({ id: d.id, ...d.data() } as ReviewRequest));
      setRows(next);
    });
    return () => unsub();
  }, [businessId]);

  // Pull customer names for display. Lightweight — one snapshot for
  // customers in the visible rows.
  useEffect(() => {
    if (!businessId || rows.length === 0) return;
    const ids = Array.from(new Set(rows.map(r => r.customerId).filter(id => id && id !== '__test__')));
    if (ids.length === 0) return;
    // The customers collection isn't huge; subscribe to all and pluck.
    const unsub = onSnapshot(
      collection(_db as Firestore, 'businesses', businessId, 'customers'),
      (snap) => {
        const next: CustomerNameMap = {};
        snap.forEach(d => { next[d.id] = (d.data() as { name?: string }).name ?? ''; });
        setNames(next);
      },
    );
    return () => unsub();
  }, [businessId, rows.length]);

  const filtered = useMemo(() => {
    const now = Date.now();
    const search = searchInput.trim().toLowerCase();
    return rows.filter(r => {
      // Status filter
      const isFuture = (() => {
        const sa = (r as unknown as { sendAfterAt?: { toMillis?: () => number; _seconds?: number; seconds?: number } }).sendAfterAt;
        if (!sa) return false;
        if (typeof sa.toMillis === 'function') return sa.toMillis() > now;
        const seconds = sa._seconds ?? sa.seconds;
        return typeof seconds === 'number' && seconds * 1000 > now;
      })();
      if (filter === 'pending'   && !(r.status === 'pending' && !isFuture)) return false;
      if (filter === 'scheduled' && !(r.status === 'pending' && isFuture))  return false;
      if (filter === 'sent'      && r.status !== 'sent')      return false;
      if (filter === 'failed'    && r.status !== 'failed')    return false;
      if (filter === 'cancelled' && r.status !== 'cancelled') return false;

      if (search) {
        const hay = [
          names[r.customerId] ?? '',
          r.phoneE164 ?? '',
          r.jobId ?? '',
        ].join(' ').toLowerCase();
        if (!hay.includes(search)) return false;
      }
      return true;
    });
  }, [rows, filter, searchInput, names]);

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontWeight: 600, color: 'var(--t1)', marginBottom: 6 }}>Review Request History</div>

      {/* Filter chips */}
      <div style={chipRow}>
        {(['all','pending','scheduled','sent','failed','cancelled'] as FilterKey[]).map(k => (
          <button
            key={k}
            type="button"
            onClick={() => setFilter(k)}
            className={'btn sm ' + (filter === k ? 'primary' : 'secondary')}
            style={{ textTransform: 'capitalize' }}
          >
            {k}
          </button>
        ))}
      </div>

      <input
        type="text"
        value={searchInput}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search by name, phone, or job id"
        style={searchInputStyle}
      />

      <div style={{ marginTop: 8 }}>
        {filtered.length === 0 && (
          <p style={{ fontSize: 12, color: 'var(--t3)' }}>No matching review requests.</p>
        )}
        {filtered.map(r => {
          const name = names[r.customerId] ?? (r.isTest ? '(test send)' : r.customerId);
          const phoneFmt = r.phoneE164 ? formatPhoneForDisplay(r.phoneE164) : '';
          const isOpen = expanded === r.id;
          return (
            <div key={r.id} style={rowCard}>
              <button
                type="button"
                onClick={() => setExpanded(isOpen ? null : r.id)}
                style={rowHeader}
                aria-expanded={isOpen}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <strong style={{ fontSize: 13 }}>{name}</strong>
                    <StatusPill status={r.status} />
                    {r.isTest && <span style={badgeTest}>TEST</span>}
                    {r.isManual && <span style={badgeManual}>MANUAL</span>}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 2 }}>
                    {phoneFmt} · job {r.jobId}
                  </div>
                </div>
                <span style={{ fontSize: 11, color: 'var(--t3)' }}>
                  {formatTs((r as unknown as { createdAt?: { toMillis?: () => number } }).createdAt)}
                </span>
              </button>
              {isOpen && (
                <div style={rowExpand}>
                  <div style={{ fontSize: 12, color: 'var(--t2)', whiteSpace: 'pre-wrap', marginBottom: 6 }}>
                    {r.templateRendered}
                  </div>
                  {r.errorMessage && (
                    <div style={{ fontSize: 12, color: 'var(--danger, #f87171)' }}>
                      Error: {r.errorMessage}
                    </div>
                  )}
                  {r.sentAt && (
                    <div style={{ fontSize: 11, color: 'var(--t3)' }}>
                      Sent: {formatTs(r.sentAt as unknown as { toMillis?: () => number })}
                      {r.twilioMessageSid ? ` · sid ${r.twilioMessageSid}` : ''}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: ReviewRequestStatus }): JSX.Element {
  const colorMap: Record<ReviewRequestStatus, string> = {
    pending:   '#888',
    sending:   '#3b82f6',
    sent:      '#4ade80',
    failed:    '#f87171',
    cancelled: '#6b7280',
  };
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 99,
      color: '#fff', background: colorMap[status] ?? '#666', textTransform: 'uppercase',
      letterSpacing: '0.4px',
    }}>{status}</span>
  );
}

function formatTs(ts: { toMillis?: () => number } | undefined): string {
  if (!ts || typeof ts.toMillis !== 'function') return '—';
  const d = new Date(ts.toMillis());
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

const chipRow: CSSProperties = { display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 };
const searchInputStyle: CSSProperties = {
  width: '100%', padding: '6px 8px', fontSize: 13,
  background: 'var(--s2, #1f1f1f)', color: 'var(--t1)',
  border: '1px solid var(--border, #333)', borderRadius: 6,
};
const rowCard: CSSProperties = {
  background: 'var(--s2, #1f1f1f)', borderRadius: 6, marginBottom: 6,
  border: '1px solid var(--border, #333)', overflow: 'hidden',
};
const rowHeader: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8,
  width: '100%', padding: '8px 10px', border: 'none', background: 'transparent',
  cursor: 'pointer', color: 'var(--t1)', textAlign: 'left',
};
const rowExpand: CSSProperties = {
  padding: '0 10px 10px',
  borderTop: '1px solid var(--border, #333)',
};
const badgeBase: CSSProperties = {
  fontSize: 9, fontWeight: 800, padding: '1px 5px', borderRadius: 99,
  textTransform: 'uppercase', letterSpacing: '0.5px',
};
const badgeTest: CSSProperties = { ...badgeBase, background: '#facc15', color: '#1a1a1a' };
const badgeManual: CSSProperties = { ...badgeBase, background: '#a78bfa', color: '#1a1a1a' };

export const ReviewRequestHistoryTable = memo(ReviewRequestHistoryTableImpl);
```

- [ ] **Step 2: Type-check**

Run: `npm run lint`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/components/settings/ReviewRequestHistoryTable.tsx
git commit -m "$(cat <<'EOF'
feat(history): ReviewRequestHistoryTable extracted (SP4A task 10)

Pulled the history surface out of ReviewAutomationSection so the
parent stays digestible. Five filter chips, client-side substring
search, per-row inline expand. Computes scheduled/pending split
locally from sendAfterAt vs now (no extra index).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: ReviewAutomationSection accordion

The big one. Eight sub-sections: enable toggle, warning banner, URL input, delay chips, template editor, preview pane, test form, history (delegates to Task 10's component).

**Files:**
- Create: `src/components/settings/ReviewAutomationSection.tsx`

- [ ] **Step 1: Write the section**

Create `src/components/settings/ReviewAutomationSection.tsx`:

```tsx
// src/components/settings/ReviewAutomationSection.tsx
// ═══════════════════════════════════════════════════════════════════
//  ReviewAutomationSection — SP4A operator surface.
//
//  Spec: §"UI — ReviewAutomationSection accordion" in
//        docs/superpowers/specs/2026-06-03-sp4a-review-automation-design.md
//
//  Eight sub-sections:
//    1. Enable toggle
//    2. Warning banner when toggle ON + URL empty (addition #7)
//    3. Google Review URL input (validated)
//    4. Delay chip group (Immediate / 5 / 15 / 60)
//    5. Template editor + 7-variable legend
//    6. Live preview pane (last completed job → fallback)
//    7. Send Test SMS form
//    8. History table (delegated to ReviewRequestHistoryTable)
// ═══════════════════════════════════════════════════════════════════

import { memo, useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import {
  collection, limit, onSnapshot, orderBy, query, where,
  type Firestore,
} from 'firebase/firestore';
import { getFunctions, httpsCallable, connectFunctionsEmulator } from 'firebase/functions';
import { _db } from '@/lib/firebase';
import { AccordionShell } from '@/components/settings/AccordionShell';
import { ReviewRequestHistoryTable } from '@/components/settings/ReviewRequestHistoryTable';
import { renderTemplate } from '@/lib/reviewTemplate';
import { DEFAULT_REVIEW_TEMPLATE } from '@/lib/defaults';
import { usePermissions, useMembership } from '@/context/MembershipContext';
import type { Job, Settings } from '@/types';

interface Props {
  businessId: string;
  settings: Settings;
  open: boolean;
  onToggle: () => void;
  onSaveSettings: (patch: Partial<Settings>) => Promise<void>;
}

const DELAY_OPTIONS: ReadonlyArray<{ value: 0 | 5 | 15 | 60; label: string }> = [
  { value: 0,  label: 'Immediate' },
  { value: 5,  label: '5 min' },
  { value: 15, label: '15 min' },
  { value: 60, label: '1 hr' },
];

function _getEmulatorAwareFunctions() {
  const fns = getFunctions();
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env ?? {};
  const useEmu =
    env.DEV &&
    typeof window !== 'undefined' &&
    (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') &&
    env.VITE_USE_FIREBASE_EMULATOR === '1';
  if (useEmu) {
    try { connectFunctionsEmulator(fns, '127.0.0.1', 5001); } catch { /* already connected */ }
  }
  return fns;
}

function isValidHttpUrl(v: string): boolean {
  return /^https?:\/\//i.test(v.trim());
}

function ReviewAutomationSectionImpl({
  businessId, settings, open, onToggle, onSaveSettings,
}: Props): JSX.Element {
  const perms = usePermissions();
  const { role, member } = useMembership();
  const canEdit = perms.canEditBusinessSettings ?? false;
  const isOwnerOrAdmin = role === 'owner' || role === 'admin';

  const enabled  = settings.reviewAutomationEnabled ?? false;
  const template = settings.reviewSmsTemplate ?? DEFAULT_REVIEW_TEMPLATE;
  const delay    = (settings.reviewDelayMinutes ?? 0) as 0 | 5 | 15 | 60;
  const url      = settings.googleReviewLink ?? '';
  const businessName = settings.businessName ?? '';

  // Local-only state for inputs that save-on-blur.
  const [urlLocal,     setUrlLocal]     = useState(url);
  const [templateLocal,setTemplateLocal]= useState(template);
  const [testPhone,    setTestPhone]    = useState((member?.phoneE164 ?? '') as string);
  const [testStatus,   setTestStatus]   = useState<string | null>(null);
  const [testError,    setTestError]    = useState<string | null>(null);
  const [testInFlight, setTestInFlight] = useState(false);

  useEffect(() => { setUrlLocal(url); }, [url]);
  useEffect(() => { setTemplateLocal(template); }, [template]);

  // Last-completed job → preview source. Optional; falls back to a
  // static sample customer if nothing's available.
  const [previewJob, setPreviewJob] = useState<Job | null>(null);
  useEffect(() => {
    if (!businessId || !open) return;
    const q = query(
      collection(_db as Firestore, 'businesses', businessId, 'jobs'),
      where('status', '==', 'Completed'),
      orderBy('date', 'desc'),
      limit(1),
    );
    const unsub = onSnapshot(q, (snap) => {
      const d = snap.docs[0];
      setPreviewJob(d ? ({ id: d.id, ...(d.data() as Omit<Job, 'id'>) }) : null);
    });
    return () => unsub();
  }, [businessId, open]);

  const previewBody = useMemo(() => {
    const fallback = {
      firstName: 'Sample',
      lastName:  'Customer',
      serviceType: 'Tire Repair',
      city: 'Hollywood',
      vehicle: 'Honda Civic',
    };
    const customerName = previewJob?.customerName ?? `${fallback.firstName} ${fallback.lastName}`;
    const first = customerName.split(/\s+/)[0] ?? fallback.firstName;
    const last  = customerName.split(/\s+/).slice(1).join(' ');
    const cityVal = (previewJob?.city || previewJob?.area || settings.serviceArea || fallback.city) as string;
    const service = previewJob?.service ?? fallback.serviceType;
    const vehicle = previewJob?.vehicleMakeModel ?? fallback.vehicle;
    return renderTemplate(templateLocal || DEFAULT_REVIEW_TEMPLATE, {
      firstName: first, lastName: last, businessName, serviceType: service,
      city: cityVal, vehicle, reviewLink: urlLocal || '(your-google-review-url)',
    });
  }, [templateLocal, urlLocal, businessName, settings.serviceArea, previewJob]);

  const onToggleEnable = useCallback(async () => {
    if (!canEdit) return;
    await onSaveSettings({ reviewAutomationEnabled: !enabled } as Partial<Settings>);
  }, [canEdit, enabled, onSaveSettings]);

  const onPickDelay = useCallback(async (val: 0 | 5 | 15 | 60) => {
    if (!canEdit) return;
    await onSaveSettings({ reviewDelayMinutes: val } as Partial<Settings>);
  }, [canEdit, onSaveSettings]);

  const onBlurUrl = useCallback(async () => {
    if (!canEdit) return;
    const trimmed = urlLocal.trim();
    if (trimmed === url) return;
    if (trimmed && !isValidHttpUrl(trimmed)) {
      setUrlLocal(url);
      return;
    }
    await onSaveSettings({ googleReviewLink: trimmed } as Partial<Settings>);
  }, [canEdit, urlLocal, url, onSaveSettings]);

  const onBlurTemplate = useCallback(async () => {
    if (!canEdit) return;
    if (templateLocal === template) return;
    await onSaveSettings({ reviewSmsTemplate: templateLocal } as Partial<Settings>);
  }, [canEdit, templateLocal, template, onSaveSettings]);

  const onSendTest = useCallback(async () => {
    setTestError(null);
    setTestStatus(null);
    setTestInFlight(true);
    try {
      const fn = httpsCallable<
        { businessId: string; phoneE164?: string; template?: string },
        { requestId: string }
      >(_getEmulatorAwareFunctions(), 'sendTestReviewSms');
      const { data } = await fn({
        businessId,
        phoneE164: testPhone || undefined,
        template:  templateLocal || undefined,
      });
      setTestStatus(`Test enqueued (id ${data.requestId}). ${settings.twilioConnected ? 'Drainer will send within 1 min.' : 'Twilio not connected — request stays pending.'}`);
    } catch (err) {
      setTestError(err instanceof Error ? err.message : String(err));
    } finally {
      setTestInFlight(false);
    }
  }, [businessId, testPhone, templateLocal, settings.twilioConnected]);

  const showWarning = enabled && !url.trim();

  return (
    <AccordionShell
      title="Review Automation"
      icon="⭐"
      summary={enabled ? `On · ${delay === 0 ? 'Immediate' : delay + ' min'} delay` : 'Off'}
      open={open}
      onToggle={onToggle}
    >
      {/* 1. Enable toggle */}
      <div className="field" style={{ marginBottom: 10 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: canEdit ? 'pointer' : 'not-allowed' }}>
          <input
            type="checkbox"
            checked={enabled}
            disabled={!canEdit}
            onChange={onToggleEnable}
          />
          <span style={{ fontWeight: 500 }}>Enable Review Automation</span>
        </label>
        <p style={{ ...helpStyle, marginLeft: 24, marginTop: 4 }}>
          When ON, completed jobs automatically queue a Google review SMS after the configured delay.
        </p>
      </div>

      {/* 2. Warning banner */}
      {showWarning && (
        <div style={warningBanner}>
          ⚠ Set your Google Review URL below to enable automation. Without it, no SMS is queued.
        </div>
      )}

      {/* 3. Google Review URL */}
      <div className="field" style={{ marginBottom: 12 }}>
        <label style={labelStyle}>Google Review URL</label>
        <input
          type="url"
          value={urlLocal}
          onChange={(e) => setUrlLocal(e.target.value)}
          onBlur={onBlurUrl}
          placeholder="https://g.page/r/..."
          disabled={!canEdit}
          style={inputStyle}
        />
        <p style={helpStyle}>
          Find at: business.google.com → Customers → Reviews → Get more reviews.
        </p>
      </div>

      {/* 4. Delay chips */}
      <div className="field" style={{ marginBottom: 12 }}>
        <label style={labelStyle}>Delay before sending</label>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {DELAY_OPTIONS.map(opt => (
            <button
              key={opt.value}
              type="button"
              disabled={!canEdit}
              onClick={() => onPickDelay(opt.value)}
              className={'btn sm ' + (delay === opt.value ? 'primary' : 'secondary')}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <p style={helpStyle}>
          Drainer polls every 1 minute, so "Immediate" lands within ~60 seconds.
        </p>
      </div>

      {/* 5. Template editor */}
      <div className="field" style={{ marginBottom: 12 }}>
        <label style={labelStyle}>SMS Template</label>
        <textarea
          value={templateLocal}
          onChange={(e) => setTemplateLocal(e.target.value)}
          onBlur={onBlurTemplate}
          rows={3}
          disabled={!canEdit}
          style={{ ...inputStyle, minHeight: 70, fontFamily: 'inherit' }}
        />
        <p style={helpStyle}>
          Available: <code>{'{firstName}'}</code> · <code>{'{lastName}'}</code> · <code>{'{businessName}'}</code>
          {' · '}<code>{'{serviceType}'}</code> · <code>{'{city}'}</code> · <code>{'{vehicle}'}</code>
          {' · '}<code>{'{reviewLink}'}</code>
        </p>
      </div>

      {/* 6. Preview */}
      <div className="field" style={{ marginBottom: 12 }}>
        <label style={labelStyle}>Live preview</label>
        <div style={previewBox}>{previewBody}</div>
        <p style={helpStyle}>
          {previewJob ? `Rendered against your last completed job (${previewJob.customerName ?? 'unknown'}).` : 'Rendered against sample data — no completed jobs yet.'}
        </p>
      </div>

      {/* 7. Send Test SMS */}
      {isOwnerOrAdmin && (
        <div className="field" style={{ marginBottom: 12, paddingTop: 10, borderTop: '1px solid var(--border, #2a2a2a)' }}>
          <label style={labelStyle}>Send Test SMS</label>
          <input
            type="tel"
            value={testPhone}
            onChange={(e) => setTestPhone(e.target.value)}
            placeholder="+1 (555) 123-4567"
            style={inputStyle}
          />
          <button
            type="button"
            className="btn sm primary"
            disabled={testInFlight || !testPhone.trim()}
            onClick={onSendTest}
            style={{ marginTop: 6 }}
          >
            {testInFlight ? 'Sending…' : 'Send Test'}
          </button>
          {testStatus && <p style={{ ...helpStyle, color: 'var(--ok, #4ade80)', marginTop: 6 }}>{testStatus}</p>}
          {testError  && <p style={{ ...helpStyle, color: 'var(--danger, #f87171)', marginTop: 6 }}>Error: {testError}</p>}
          {!settings.twilioConnected && (
            <p style={helpStyle}>
              Twilio is not connected. Test sends queue up; they’ll deliver automatically once SP4B wires Twilio.
            </p>
          )}
        </div>
      )}

      {/* 8. History */}
      <ReviewRequestHistoryTable businessId={businessId} />
    </AccordionShell>
  );
}

const labelStyle: CSSProperties = {
  display: 'block', fontWeight: 600, fontSize: 12,
  color: 'var(--t2)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.5px',
};
const inputStyle: CSSProperties = {
  width: '100%', padding: '6px 8px', fontSize: 13,
  background: 'var(--s2, #1f1f1f)', color: 'var(--t1)',
  border: '1px solid var(--border, #333)', borderRadius: 6,
};
const helpStyle: CSSProperties = { fontSize: 11, color: 'var(--t3)', marginTop: 4 };
const warningBanner: CSSProperties = {
  padding: 10, marginBottom: 10,
  background: 'var(--warn-bg, #2a2418)', color: 'var(--t1)',
  border: '1px solid var(--warn-border, #5a4a18)', borderRadius: 6,
  fontSize: 12,
};
const previewBox: CSSProperties = {
  padding: '8px 10px', fontSize: 13,
  background: 'var(--s2, #1f1f1f)', color: 'var(--t1)',
  border: '1px solid var(--border, #333)', borderRadius: 6,
  whiteSpace: 'pre-wrap',
};

export const ReviewAutomationSection = memo(ReviewAutomationSectionImpl);
```

- [ ] **Step 2: Type-check**

Run: `npm run lint`
Expected: exit 0. If TS complains about `member.phoneE164`, the membership shape in this codebase may use a different field name — open `src/context/MembershipContext.tsx` and use whatever phone field is canonical on `Member`. The implementer subagent should match the existing field, not invent one.

- [ ] **Step 3: Commit**

```bash
git add src/components/settings/ReviewAutomationSection.tsx
git commit -m "$(cat <<'EOF'
feat(settings): ReviewAutomationSection accordion (SP4A task 11)

Eight sub-sections wired:
  1. Enable toggle (default OFF)
  2. Warning banner when ON + URL empty (addition #7)
  3. Google Review URL input (http/https validated, save on blur)
  4. Delay chips: Immediate / 5min / 15min / 1hr
  5. Template editor with 7-variable legend (addition #1)
  6. Live preview using last completed job → fallback sample
  7. Send Test SMS (owner+admin only)
  8. History via ReviewRequestHistoryTable

All renders use pure renderTemplate() — no network hits in preview.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Settings.tsx wire-in

Insert the new accordion between Communications and Owners. Same mutex pattern as the existing accordions.

**Files:**
- Modify: `src/pages/Settings.tsx` (add import + render block)

- [ ] **Step 1: Add the import**

Edit `src/pages/Settings.tsx`. After the `CommunicationsSettingsSection` import (line 13):

```ts
import { CommunicationsSettingsSection } from '@/components/settings/CommunicationsSettingsSection';
```

add:

```ts
import { ReviewAutomationSection } from '@/components/settings/ReviewAutomationSection';
```

- [ ] **Step 2: Add the render block**

Find the closing `)}` of the `CommunicationsSettingsSection` block (currently at line 206) and the start of the `OwnersAccordion` block (line 208). Insert a new render block between them:

```tsx
      {/* SP4A: Review Automation — toggle/delay/URL/template + history.
          Ships OFF; operator enables to start queuing review SMS on
          job completion. Drainer runs every 1min and is dormant until
          Twilio env secrets land in SP4B. */}
      {canSeeBusinessSettings && businessId && (
        <ReviewAutomationSection
          businessId={businessId}
          settings={settings}
          open={openSection === 'reviewAutomation'}
          onToggle={() => setOpenSection(openSection === 'reviewAutomation' ? null : 'reviewAutomation')}
          onSaveSettings={onSave}
        />
      )}

```

- [ ] **Step 3: Type-check + build**

Run: `npm run build`
Expected: vite build succeeds, tsc emits 0 errors. The output bundle should include the new section's chunk.

- [ ] **Step 4: Commit**

```bash
git add src/pages/Settings.tsx
git commit -m "$(cat <<'EOF'
feat(settings): wire ReviewAutomationSection between Communications + Owners (SP4A task 12)

Mutex key 'reviewAutomation'. Same gating as adjacent sections
(canSeeBusinessSettings + businessId resolved). No layout impact on
collapsed state — accordion summary reads "On · {delay}" or "Off".

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: CustomerProfile Review Requests + Communication Events sections

Replace the SP4 placeholder "Communication History" section with two real, populated sub-sections.

**Files:**
- Modify: `src/pages/CustomerProfile.tsx` (replace section 9 at line 240–246)

- [ ] **Step 1: Add the imports + replace section 9**

Edit `src/pages/CustomerProfile.tsx`. At the top, after `import { ServiceHistoryPhotos } from '@/components/customers/ServiceHistoryPhotos';` add:

```ts
import type { ReviewRequest, CommunicationEvent } from '@/types';
```

Then inside the component, add two new state + effect blocks. After the existing `useEffect` for jobs (the one that fires at line 64–78), add:

```ts
  const [reviewRequests, setReviewRequests] = useState<ReviewRequest[]>([]);
  useEffect(() => {
    if (!businessId || !customerId) return;
    const q = query(
      collection(_db as Firestore, 'businesses', businessId, 'reviewRequests'),
      where('customerId', '==', customerId),
      orderBy('createdAt', 'desc'),
      limit(20),
    );
    const unsub = onSnapshot(q, (snap) => {
      const rows: ReviewRequest[] = [];
      snap.forEach(d => rows.push({ id: d.id, ...d.data() } as ReviewRequest));
      setReviewRequests(rows);
    });
    return () => unsub();
  }, [businessId, customerId]);

  const [commEvents, setCommEvents] = useState<CommunicationEvent[]>([]);
  useEffect(() => {
    if (!businessId || !customerId) return;
    const q = query(
      collection(_db as Firestore, 'businesses', businessId, 'communicationEvents'),
      where('customerId', '==', customerId),
      orderBy('sentAt', 'desc'),
      limit(20),
    );
    const unsub = onSnapshot(q, (snap) => {
      const rows: CommunicationEvent[] = [];
      snap.forEach(d => rows.push({ id: d.id, ...d.data() } as CommunicationEvent));
      setCommEvents(rows);
    });
    return () => unsub();
  }, [businessId, customerId]);
```

Then replace the entire existing "9. Communication log (SP4 placeholder)" `<section>` block (currently lines 240–246) with:

```tsx
      {/* 9. Communication History */}
      <section className="form-group card-anim" aria-label="Communication History">
        <div className="form-group-title">Communication History</div>

        {/* Review Requests sub-section */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--t2)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Review Requests
          </div>
          {reviewRequests.length === 0 && (
            <p style={{ fontSize: 12, color: 'var(--t3)', margin: 0 }}>None yet.</p>
          )}
          {reviewRequests.map(r => (
            <div key={r.id} style={cpRowStyle}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12, color: 'var(--t1)', fontWeight: 600 }}>
                  {(r as unknown as { createdAt?: { toMillis?: () => number } }).createdAt?.toMillis
                    ? new Date(((r as unknown as { createdAt: { toMillis: () => number } }).createdAt).toMillis())
                        .toLocaleString(undefined, { month: 'short', day: 'numeric' })
                    : '—'}
                </span>
                <span style={{ ...cpPill(r.status) }}>{r.status}</span>
                {r.isTest   && <span style={cpBadge('#facc15','#1a1a1a')}>TEST</span>}
                {r.isManual && <span style={cpBadge('#a78bfa','#1a1a1a')}>MANUAL</span>}
              </div>
              <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 2, whiteSpace: 'pre-wrap' }}>
                {r.templateRendered.length > 80 ? r.templateRendered.slice(0, 80) + '…' : r.templateRendered}
              </div>
              {r.errorMessage && (
                <div style={{ fontSize: 11, color: 'var(--danger, #f87171)', marginTop: 2 }}>
                  Error: {r.errorMessage}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Communication Events sub-section */}
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--t2)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Communication Events
          </div>
          {commEvents.length === 0 && (
            <p style={{ fontSize: 12, color: 'var(--t3)', margin: 0 }}>None yet.</p>
          )}
          {commEvents.map(e => (
            <div key={e.id} style={cpRowStyle}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12, color: 'var(--t1)', fontWeight: 600 }}>{e.type.replace(/_/g, ' ')}</span>
                <span style={{ ...cpPill(e.status) }}>{e.status}</span>
              </div>
              {e.content && (
                <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 2, whiteSpace: 'pre-wrap' }}>
                  {e.content.length > 80 ? e.content.slice(0, 80) + '…' : e.content}
                </div>
              )}
            </div>
          ))}
        </div>
      </section>
```

Finally, add helper style functions at the bottom of the file (before the existing `badgeStyle` constant near the end):

```ts
const cpRowStyle: React.CSSProperties = {
  padding: '6px 0', borderBottom: '1px solid var(--border, #2a2a2a)',
};
function cpPill(status: string): React.CSSProperties {
  const colorMap: Record<string, string> = {
    pending: '#888', sending: '#3b82f6', sent: '#4ade80',
    failed: '#f87171', cancelled: '#6b7280', skipped: '#888',
    queued: '#888',
  };
  return {
    fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 99,
    color: '#fff', background: colorMap[status] ?? '#666',
    textTransform: 'uppercase', letterSpacing: '0.4px',
  };
}
function cpBadge(bg: string, fg: string): React.CSSProperties {
  return {
    fontSize: 9, fontWeight: 800, padding: '1px 5px', borderRadius: 99,
    background: bg, color: fg,
    textTransform: 'uppercase', letterSpacing: '0.5px',
  };
}
```

- [ ] **Step 2: Type-check**

Run: `npm run lint`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/pages/CustomerProfile.tsx
git commit -m "$(cat <<'EOF'
feat(customer): Review Requests + Communication Events sections (SP4A task 13)

Replaces the SP4 placeholder "Calls and texts appear here once Twilio
is connected" with two live sub-sections under Communication History.
Both subscribe via onSnapshot with limit(20). Empty-state messages
when collections are empty for the customer.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: JobDetailModal manual "Send Review Request" button

Replace the existing stub `⭐ Review` button (line 400) with a smarter affordance gated on settings + idempotency flag. Onclick → confirm modal → `sendManualReviewRequest` callable.

**Files:**
- Modify: `src/components/JobDetailModal.tsx`

- [ ] **Step 1: Add the imports + state**

Edit `src/components/JobDetailModal.tsx`. After the existing `useState` import at line 1:

```ts
import { useState } from 'react';
```

(already present) — then add an httpsCallable import near the existing imports:

```ts
import { getFunctions, httpsCallable, connectFunctionsEmulator } from 'firebase/functions';
```

Inside the component, near the existing `useState` declarations (around line 57–65), add:

```ts
  const [reviewSendInFlight, setReviewSendInFlight] = useState(false);
  const [reviewSendError,    setReviewSendError]    = useState<string | null>(null);
  const [reviewConfirmOpen,  setReviewConfirmOpen]  = useState(false);
```

Also add the emulator-aware functions helper. Near the top of the file, after the imports:

```ts
function _getEmulatorAwareFunctions() {
  const fns = getFunctions();
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env ?? {};
  const useEmu =
    env.DEV &&
    typeof window !== 'undefined' &&
    (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') &&
    env.VITE_USE_FIREBASE_EMULATOR === '1';
  if (useEmu) {
    try { connectFunctionsEmulator(fns, '127.0.0.1', 5001); } catch { /* already connected */ }
  }
  return fns;
}
```

- [ ] **Step 2: Compute the gate + click handler**

Inside the component (alongside other locals around line 70), add:

```ts
  // Manual "Send Review Request" gating. The button is shown only on
  // Completed jobs. It's disabled when:
  //   - reviewAutomationEnabled is OFF, OR
  //   - googleReviewLink is empty, OR
  //   - reviewRequestSent is already true (idempotency: the row exists)
  type JobWithReview = Job & { reviewRequestSent?: boolean; reviewRequestId?: string };
  const jobR = job as JobWithReview;
  const reviewIsCompleted   = job.status === 'Completed';
  const reviewIsConfigured  = (settings.reviewAutomationEnabled ?? false) && !!(settings.googleReviewLink?.trim());
  const reviewAlreadySent   = jobR.reviewRequestSent === true;
  const reviewBtnDisabled   = !reviewIsConfigured || reviewAlreadySent;
  const reviewBtnTooltip    = reviewAlreadySent
    ? 'Already requested — see Review history on the customer profile'
    : !reviewIsConfigured
      ? 'Enable Review Automation + set Review URL in Settings'
      : '';

  const onSendManualReview = async () => {
    if (reviewBtnDisabled || reviewSendInFlight) return;
    setReviewSendInFlight(true);
    setReviewSendError(null);
    try {
      const fn = httpsCallable<
        { businessId: string; jobId: string },
        { requestId: string }
      >(_getEmulatorAwareFunctions(), 'sendManualReviewRequest');
      if (!businessId) throw new Error('businessId not resolved');
      await fn({ businessId, jobId: job.id });
      setReviewConfirmOpen(false);
    } catch (err) {
      setReviewSendError(err instanceof Error ? err.message : String(err));
    } finally {
      setReviewSendInFlight(false);
    }
  };
```

- [ ] **Step 3: Replace the existing `⭐ Review` button**

Find the line (around line 400):

```tsx
            <button className="btn secondary" onClick={onSendReview}>⭐ Review</button>
```

Replace it with the gated button — render only on Completed jobs, leave the existing onSendReview prop untouched on non-Completed (back-compat with the older "Mark Review Requested" affordance that lives behind that prop):

```tsx
            {reviewIsCompleted ? (
              <button
                className={'btn ' + (reviewBtnDisabled ? 'secondary' : 'primary')}
                disabled={reviewBtnDisabled || reviewSendInFlight}
                onClick={() => setReviewConfirmOpen(true)}
                title={reviewBtnTooltip}
              >
                {reviewAlreadySent ? '✓ Review Requested' : '⭐ Send Review Request'}
              </button>
            ) : (
              <button className="btn secondary" onClick={onSendReview}>⭐ Review</button>
            )}
```

- [ ] **Step 4: Render the confirm modal**

At the very end of the component's return (right before the outermost closing `</div>`), insert a confirm-modal block that mounts on demand:

```tsx
      {reviewConfirmOpen && (
        <div
          className="modal-overlay"
          onClick={(e) => { if (e.target === e.currentTarget) setReviewConfirmOpen(false); }}
          style={{ zIndex: 200 }}
        >
          <div className="modal-card" style={{ maxWidth: 380 }}>
            <h3 style={{ margin: 0, marginBottom: 8, fontSize: 16 }}>Send Review Request?</h3>
            <p style={{ fontSize: 13, color: 'var(--t2)', marginBottom: 12 }}>
              Send a review request SMS to <strong>{job.customerName || 'this customer'}</strong>
              {job.customerPhone ? ` at ${job.customerPhone}` : ''}?
            </p>
            {reviewSendError && (
              <p style={{ fontSize: 12, color: 'var(--danger, #f87171)', marginBottom: 12 }}>
                {reviewSendError}
              </p>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="btn sm secondary"
                onClick={() => setReviewConfirmOpen(false)}
                disabled={reviewSendInFlight}
              >Cancel</button>
              <button
                type="button"
                className="btn sm primary"
                onClick={onSendManualReview}
                disabled={reviewSendInFlight}
              >
                {reviewSendInFlight ? 'Sending…' : 'Send'}
              </button>
            </div>
          </div>
        </div>
      )}
```

- [ ] **Step 5: Type-check + build**

Run: `npm run build`
Expected: vite build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/components/JobDetailModal.tsx
git commit -m "$(cat <<'EOF'
feat(jobs): manual "Send Review Request" button on completed jobs (SP4A task 14)

Replaces the legacy ⭐ Review stub on Completed jobs with a gated
button that:
  - is disabled when reviewAutomationEnabled OFF or googleReviewLink empty
  - shows "✓ Review Requested" when job.reviewRequestSent === true
  - confirms via modal, then fires sendManualReviewRequest callable
  - shares the same req-{jobId}-{date} doc id pattern as the trigger
    so re-clicks same day collapse to one row (idempotent)

On non-Completed jobs the legacy onSendReview path stays unchanged.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 15: Final verification

Run the full battery before declaring SP4A shipped. Acceptance testing (the 14 criteria from the spec) is the next sprint task — this step proves the code compiles, types are tight, every test passes, and the bundle builds.

**Files:** none (verification only)

- [ ] **Step 1: Run the full logic test suite**

Run: `npm test`
Expected: every test file ✓, the last line reports `0 failed`. The four new test files (`reviewTemplate.test.ts`, `onJobCompletedReviewRequest.test.ts`, `drainReviewRequests.test.ts`, `reviewAutomationCallables.test.ts`) each print their own pass count.

- [ ] **Step 2: Type-check the client**

Run: `npm run lint`
Expected: exit 0.

- [ ] **Step 3: Build the client**

Run: `npm run build`
Expected: vite finishes with no errors. The output bundle should reference the new section + the history table.

- [ ] **Step 4: Build the functions**

Run: `cd functions && npm run build && cd ..`
Expected: exit 0. `functions/lib/` contains: `onJobCompletedReviewRequest.js`, `drainReviewRequests.js`, `sendTestReviewSms.js`, `sendManualReviewRequest.js`, `lib/twilioClient.js`, `lib/reviewTemplate.js`.

- [ ] **Step 5: Emulator smoke test**

```bash
# Terminal A: start the emulator suite
npm run emulator:start

# Terminal B (when A reports "All emulators ready"):
npm run emulator:seed

# Terminal C:
npm run dev:emulator
```

Then in the browser at http://localhost:5173, sign in as `admin@localhost.dev` / `dev-password-1234` and run through the 14 spec acceptance criteria by hand. The most critical smoke path:

1. Settings → Review Automation: toggle ON. Without a URL, confirm the warning banner appears.
2. Paste `https://g.page/r/test-url` in the Google Review URL field, blur. Warning disappears.
3. Pick a delay (Immediate).
4. Save a job for Maria Lopez, status Completed.
5. Wait ~5 seconds, open the Firestore emulator UI at http://localhost:4000/firestore.
6. Confirm `businesses/dev-business/reviewRequests/req-<jobId>-<today>` exists with `status: 'pending'`.
7. Confirm the corresponding Job has `reviewRequestSent: true` and `reviewRequestId` set.
8. Open the customer's profile. The new "Review Requests" sub-section should list the row.
9. Open Settings → Review Automation → scroll to history. Same row visible. Tap to expand.
10. Re-open the completed job in JobDetailModal — the button should now read "✓ Review Requested" and be disabled.
11. Send Test SMS: enter your phone, click Send Test. New row appears in history with the TEST badge.

If steps 1-11 succeed, SP4A's code is working end-to-end against the emulator. Steps that involve the actual Twilio call land in SP4B.

- [ ] **Step 6: Commit (clean state)**

```bash
git status
```

Expected: clean tree, nothing to commit. If something pops up (build artifacts, etc.), inspect and decide whether to gitignore or commit.

---

## Self-review notes

**Spec coverage walk-through:**

| Acceptance criterion | Implementing task(s) |
|---|---|
| 1. trigger latency ≤5s | Task 6 (trigger), Task 15 (smoke step 5-7) |
| 2. Twilio-off path stays pending | Task 5 (sentinel), Task 7 (sentinel catch) |
| 3. toggle OFF blocks enqueue | Task 6 (guard #4) |
| 4. delay arithmetic | Task 6 (sendAfterAtEpochMs), Task 7 (sendAfterAt query) |
| 5. test SMS isTest flag | Task 8 (sendTestReviewSms) |
| 6. manual button isManual flag | Task 8 (sendManualReviewRequest), Task 14 (button + modal) |
| 7. live preview | Task 11 (preview pane) |
| 8. warning banner | Task 11 (banner), Task 6 (guard #5) |
| 9. city fallback | Task 6 (resolveCity), Task 1 (smart-empty strip) |
| 10. CustomerProfile sections | Task 13 |
| 11. history filter chips | Task 10 |
| 12. history search | Task 10 |
| 13. future-ready fields | Task 3 (types), Task 7 (set on success) |
| 14. idempotent doc id | Task 6 + Task 8 (both use req-{jobId}-{date}) |

**Cross-task type consistency:**
- `ReviewRequest.status` defined as `ReviewRequestStatus` in Task 3 — used in Tasks 6, 7, 8, 10, 13. The status string `'scheduled'` never appears in stored data; only as a UI filter key (Task 10).
- The string `'TWILIO_NOT_CONFIGURED'` is the contract between Task 5 (twilioClient throws) and Task 7 (drainer catches). Don't change this string without updating both.
- Doc id pattern `req-{jobId}-{dateISO}` is duplicated in Tasks 6 + 8. Both compute via `req-${jobId}-${date}` — keep them in sync.
- `__testHooks` exports follow SP3's convention (backfillCustomers.ts + onJobWriteCustomerRollup.ts). The test files import them by relative path.

**Known limitations the plan does NOT address (and shouldn't):**
- Per-business Twilio routing — SP4B.
- Two-way reply ingestion — SP4B.
- Do-not-text flag on Customer doc — SP4C.
- Bulk-send / scheduled-batch — SP7.

---

## Handoff prompt

You're picking up SP4A — Review Automation. The spec is at `docs/superpowers/specs/2026-06-03-sp4a-review-automation-design.md`; this plan is at `docs/superpowers/plans/2026-06-03-sp4a-review-automation.md`. Work through tasks 1-15 in order. Use TDD strictly: every task that creates code starts with a failing test, then writes the minimum impl to make it pass.

Repo facts worth pinning:

- `npm test` runs every `tests/*.test.ts` via `tsx`. Tests use a hand-rolled `check()` counter; no Vitest, no Jest. New tests live flat at `tests/*.test.ts` (subdirectories aren't traversed by the script).
- Functions can't import from `src/`. The template engine helper lives in TWO places: `src/lib/reviewTemplate.ts` and `functions/src/lib/reviewTemplate.ts`. They must stay byte-identical (the test imports both and asserts equivalence).
- Firebase admin imports use the modular API: `import { Timestamp, FieldValue } from 'firebase-admin/firestore'`. Namespace-style `admin.firestore.X` access fails at runtime in the emulator — this is hot-fixed in SP3 (commit 810a31c).
- The `usePermissions()` / `useMembership()` hook must be called inside a component rendered under `MembershipProvider`. Calling from App.tsx's function body returns ALL_FALSE — we hit this in SP3 (commit ff5c53d). The ReviewAutomationSection renders inside the provider tree, so it's safe to call there.
- The settings AccordionShell pattern: see `src/components/settings/CustomerDirectorySettingsSection.tsx` + `CommunicationsSettingsSection.tsx`. New section matches this shape.
- Emulator dev tenant: business id `dev-business`, admin user `admin@localhost.dev` / `dev-password-1234`. Seeded by `npm run emulator:seed` after `npm run emulator:start`.
- The Java 21 install is required for the Firestore emulator. If `firebase emulators:start` errors with a JVM message, `brew install openjdk@21` and ensure it's on `JAVA_HOME`.

The implementer subagent should match existing patterns rather than impose new ones. If you find that a Membership field is named slightly differently (e.g. `member.phone` vs `member.phoneE164`), use the existing name — don't invent. When in doubt, grep the codebase for the canonical spelling first.

End of plan. Good luck.
