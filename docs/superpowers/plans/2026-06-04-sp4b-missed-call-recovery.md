# SP4B — Missed Call Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a customer dials the operator's Twilio number and nobody answers, automatically create a Lead in the CRM, send an acknowledgment SMS via the shared SP4A outbound rails, and surface the Lead in a dedicated Leads queue tab with Wheel Rush customer enrichment + 5-badge priority taxonomy.

**Architecture:** One public HTTPS webhook (`twilioVoiceStatus`) + one new collection (`leads`) + one new outbound queue (`outboundSms`, sibling to SP4A's `reviewRequests`) + one new top-level UI surface cluster (Leads tab + LeadDetailSheet + Settings accordion + CustomerProfile sub-sections). Reuses SP4A's `twilioClient.sendSms`, `renderTemplate`, and the `TWILIO_NOT_CONFIGURED` dormant-mode sentinel — no SP4A code changes. Priority Score is a pure derivation from joined Customer data (no Lead schema impact); Missed Call Metrics is a 3-cell counter card derived from the same `leads` subscription CustomerProfile already needs.

**Tech Stack:** Firebase Functions v2 (Node 20, TypeScript) — `onRequest` HTTPS webhook (form-encoded body), `onSchedule` scheduled function, `onCall` HTTPS callables. `twilio` npm package for signature validation. React 18 + Vite + TypeScript on the client. Firebase Auth + Firestore via the modular SDK. Tests run via `npm test` (tsx-based, flat at `tests/*.test.ts`).

---

## File Structure

**Create (16):**

- `src/lib/leadPriority.ts` — pure helper: `computeLeadPriority(customer, lead) → { score, badges[] }`. 5-badge taxonomy (VIP / Fleet / High Value / Repeat Customer / New Lead) derived from existing Customer fields. Test leads short-circuit to score -1.
- `functions/src/lib/twilioSignatureValidator.ts` — wraps `twilio.validateRequest`. Throws `'TWILIO_SIGNATURE_INVALID'` on forgery. Skips with `console.warn` when `TWILIO_AUTH_TOKEN` unset (dev mode).
- `functions/src/twilioVoiceStatus.ts` — `onRequest` HTTPS webhook. Signature-validated. Filters direction + status. Routes to business via collection-group settings query. Transactional Lead write + outboundSms enqueue + communicationEvents log.
- `functions/src/drainOutboundSms.ts` — `onSchedule('every 1 minutes')`. Mirrors SP4A's drainReviewRequests for the outboundSms collection. On success: flips `lead.autoTextSent = true` + `outboundSmsId`.
- `functions/src/sendTestMissedCall.ts` — HTTPS callable. Owner+admin. Synthesizes a Lead with id `lead-test-{uid}-{ms}` + outboundSms with `isTest: true`.
- `functions/src/sendManualOutboundSms.ts` — HTTPS callable. Owner+admin. Enqueues an ad-hoc SMS from the LeadDetailSheet composer with `kind: 'manual_lead_reply'`, `isManual: true`. Doc id `sms-manual-{leadId}-{ms}`.
- `src/components/settings/MissedCallRecoverySection.tsx` — Settings accordion. 8 sub-sections (toggle, warning banner, Twilio# input, Twilio# SID input, template editor, preview, test button, recent leads).
- `src/pages/Leads.tsx` — new top-level Leads tab. Status filter chips with live counts, substring search, priority-sorted card list.
- `src/components/leads/LeadCard.tsx` — list card. Renders customer name + phone + status pill + age + source icon + priority badges + last-comm preview + "New Customer" mini-badge.
- `src/components/leads/CustomerEnrichmentPanel.tsx` — Wheel Rush customer-context block extracted for reuse. Vehicle + tire size + last service + lifetime revenue (computed live, gated by canViewFinancials) + Quick Notes.
- `src/components/leads/LeadDetailSheet.tsx` — full-screen Lead detail modal. Composes the enrichment panel + status section + SMS thread + composer + notes editor + audit footer.
- `src/components/leads/MissedCallMetricsCard.tsx` — 3-cell counter card for CustomerProfile.
- `tests/leadPriority.test.ts` — pure-helper test, covers every combination cell + test-lead override.
- `tests/twilioVoiceStatus.test.ts` — exercises every guard branch via `__testHooks.decide`.
- `tests/drainOutboundSms.test.ts` — mirrors SP4A's drainer tests for outboundSms.
- `tests/missedCallCallables.test.ts` — covers sendTestMissedCall + sendManualOutboundSms.

**Modify (10):**

- `src/types/index.ts` — Lead / OutboundSms / LeadStatus / LeadSource / CallStatus / OutboundSmsKind types; extend CommunicationEventType union; add `leadId?` to CommunicationEvent; add `'leads'` to TabId; add SP4B Settings fields.
- `src/lib/defaults.ts` — `DEFAULT_MISSED_CALL_TEMPLATE` + DEFAULT_SETTINGS entries.
- `functions/src/index.ts` — export 4 new functions.
- `functions/package.json` — add `twilio` dependency (latest 5.x).
- `firestore.rules` — leads + outboundSms collection blocks.
- `firestore.indexes.json` — 4 new indexes.
- `src/pages/Settings.tsx` — wire MissedCallRecoverySection accordion between Review Automation and Owners.
- `src/App.tsx` — register `'leads'` tab route + add Leads to bottom-nav.
- `src/pages/CustomerProfile.tsx` — add MissedCallMetricsCard + Recent Leads sub-sections.
- `src/components/JobDetailModal.tsx` — when a Job was created from a Lead (passed via leadId prop on the Job), bump lead.status='Booked' + lead.jobId on save.

---

## Pre-flight

Verify the dev environment before starting. These commands must succeed:

```bash
# 1. We're on the main branch and clean (only the SP4A trailing spec/plan dirty files are OK)
git status

# 2. Tests pass on baseline
npm test

# 3. Type-check passes on baseline
npm run lint

# 4. Functions build cleanly
cd functions && npm run build && cd ..

# 5. Confirm SP4A artifacts present (we reuse them)
ls functions/lib/lib/twilioClient.js functions/lib/lib/reviewTemplate.js
test -f src/lib/reviewTemplate.ts && echo "reviewTemplate OK"
```

If any of these fail on a clean main, stop and report the failure before touching SP4B.

**Java 21 for the emulator smoke (Task 17).** If `java -version` shows the macOS stub: `brew install openjdk@21` and add it to your PATH. SP4A's smoke flagged this — same prerequisite carries forward here.

**Existing pre-existing dirty files:** `.gitignore` and `scripts/seed-emulator.ts` have uncommitted modifications from earlier work. Do NOT touch them in any SP4B commit. Stage only the files each task explicitly creates or modifies.

**Dev tenant:** businessId `dev-business`, admin user `admin@localhost.dev` / `dev-password-1234`. Seed via `npm run emulator:seed` after `npm run emulator:start`.

---

## Task 1: Lead + OutboundSms types + TabId + Settings additions

Type-system foundation for SP4B. All schema lives in one file (`src/types/index.ts`) per project convention. No tests — types are exercised by Tasks 3, 6, 7, 8 downstream.

**Files:**
- Modify: `src/types/index.ts`

- [ ] **Step 1: Locate insertion points**

Run: `grep -n "TabId\|interface Settings\|ReviewRequest\|CommunicationEvent" src/types/index.ts | head -20`

Confirm the existing landmarks before editing:
- `TabId` union starts around line 58
- `Settings` interface around line 802
- The SP4A `ReviewRequest` + `CommunicationEvent` types and the `CommunicationEventType` union are around lines 1180-1248 (added by SP4A Task 3)
- The closing `}` of the `Settings` interface is around line 1183 (after SP4A's 5 review fields)

If those locations have drifted slightly, use the grep output to anchor your inserts.

- [ ] **Step 2: Add `'leads'` to the TabId union**

Find the TabId definition near line 58:

```ts
export type TabId =
  | 'dashboard'
  | 'add'
  | 'history'
  | 'customers'
  | 'customerProfile'
  | 'insights'
  | 'payouts'
  | 'expenses'
  | 'inventory'
  | 'settings'
  | 'help'
  | 'success';
```

Insert `'leads'` immediately after `'customers'`:

```ts
export type TabId =
  | 'dashboard'
  | 'add'
  | 'history'
  | 'customers'
  | 'leads'
  | 'customerProfile'
  | 'insights'
  | 'payouts'
  | 'expenses'
  | 'inventory'
  | 'settings'
  | 'help'
  | 'success';
```

- [ ] **Step 3: Add SP4B Settings fields**

Find the SP4A Review Automation block in the Settings interface (search for `reviewAutomationEnabled`). The block ends with `serviceArea?: string;` followed by the closing `}` of the Settings interface. Insert the SP4B block IMMEDIATELY BEFORE the closing `}`:

```ts
  // ─── Missed Call Recovery (SP4B) ─────────────────────────────────
  /** Operator-provided Twilio number that receives inbound calls.
   *  E.164 format. Routing key for the twilioVoiceStatus webhook.
   *  Default ''. Operator hand-configures the Twilio Console status
   *  callback URL to point at the webhook. */
  twilioPhoneNumber?: string;
  /** Operator-provided Twilio Phone Number SID (PNxxx). Optional
   *  debug field — surfaced in Settings for operator reference only.
   *  Not consumed by any code path. */
  twilioPhoneNumberSid?: string;
  /** Operator-editable SMS body sent on missed-call auto-text.
   *  7-placeholder template — see src/lib/reviewTemplate.ts. Default
   *  DEFAULT_MISSED_CALL_TEMPLATE in src/lib/defaults.ts. */
  missedCallTemplate?: string;
```

(Don't touch `missedCallAutoTextEnabled` — that field already exists from SP1.)

- [ ] **Step 4: Extend `CommunicationEventType` union**

Find the existing SP4A union (search for `type CommunicationEventType`). Replace the entire union with:

```ts
export type CommunicationEventType =
  | 'review_request_sent'             // SP4A
  | 'review_request_failed'           // SP4A
  | 'review_request_skipped'          // SP4A (reserved)
  | 'missed_call_received'            // SP4B — webhook acknowledges receipt
  | 'missed_call_auto_text_sent'      // SP4B — drainer success on missed_call_response
  | 'missed_call_auto_text_failed'    // SP4B — drainer failure on missed_call_response
  | 'outbound_sms_sent'               // SP4B — drainer success on manual_lead_reply
  | 'outbound_sms_failed';            // SP4B — drainer failure on manual_lead_reply
  // SP4C will add 'inbound_sms_received'.
```

- [ ] **Step 5: Extend `CommunicationEvent` with `leadId?` field**

Find the existing `CommunicationEvent` interface (also from SP4A). Add `leadId?: string;` immediately after the existing `reviewRequestId?` field (or just before the `content?` field):

```ts
export interface CommunicationEvent {
  id: string;
  type: CommunicationEventType;
  channel: 'sms' | 'call' | 'email';
  direction: 'outbound' | 'inbound';
  customerId: string;
  jobId?: string;
  reviewRequestId?: string;
  leadId?: string;                 // SP4B addition — back-ref to Lead
  content?: string;
  status: 'sent' | 'failed' | 'queued' | 'skipped';
  providerMessageId?: string;
  deliveryStatus?: string;
  carrierResponse?: string;
  sentAt: Timestamp;
  createdByUid: string;
}
```

- [ ] **Step 6: Insert the SP4B types block**

Find the SP4A type block that ends with the `CommunicationEvent` interface. Immediately AFTER the closing `}` of `CommunicationEvent`, insert the SP4B types:

```ts
// ─────────────────────────────────────────────────────────────────────
//  Missed Call Recovery (SP4B)
//
//  Two collections under businesses/{bid}/...:
//    - leads/{leadId}              — Lead queue; workflow state machine
//    - outboundSms/{smsId}         — outbound SMS queue (sibling of SP4A
//                                    reviewRequests; separate drainer)
//
//  Doc id pattern for leads: lead-{phoneDigits}-{dateISO}
//  Same caller + same day = same id = silent dedup
// ─────────────────────────────────────────────────────────────────────

export type LeadStatus =
  | 'New'
  | 'Contacted'
  | 'Quoted'
  | 'Booked'
  | 'Closed'
  | 'Lost';

export type LeadSource = 'missed_call' | 'inbound_sms' | 'manual';

export type CallStatus = 'no-answer' | 'busy' | 'failed' | 'voicemail';

export interface Lead {
  id: string;
  customerId: string;
  phoneE164: string;
  source: LeadSource;
  status: LeadStatus;
  wasNewCustomer: boolean;

  // ── First-touch metadata ─────────────────────────────────────────
  callSid?: string;
  callStatus?: CallStatus;
  receivedAt: Timestamp;

  // ── Auto-text outcome ────────────────────────────────────────────
  autoTextSent: boolean;
  autoTextSentAt?: Timestamp;
  outboundSmsId?: string;

  // ── Operator workflow ────────────────────────────────────────────
  notes?: string;
  assignedToUid?: string;
  jobId?: string;
  closedAt?: Timestamp;
  closedReason?: string;

  // ── Audit ────────────────────────────────────────────────────────
  createdAt: Timestamp;
  updatedAt: Timestamp;
  lastEditedByUid: string;
}

export type OutboundSmsKind = 'missed_call_response' | 'manual_lead_reply';

export type OutboundSmsStatus =
  | 'pending'
  | 'sending'
  | 'sent'
  | 'failed'
  | 'cancelled';

export interface OutboundSms {
  id: string;
  kind: OutboundSmsKind;
  // Source refs — leadId always present for SP4B
  leadId: string;
  customerId: string;
  phoneE164: string;
  // Rendered content
  templateUsed: string;
  templateRendered: string;
  // Scheduling
  sendAfterAt: Timestamp;
  status: OutboundSmsStatus;
  retryCount: number;
  // Outcome
  createdAt: Timestamp;
  sentAt?: Timestamp;
  failedAt?: Timestamp;
  errorMessage?: string;
  // Twilio outcome / future-ready
  twilioMessageSid?: string;
  deliveryStatus?: string;
  carrierResponse?: string;
  // Flags
  isTest?: boolean;
  isManual?: boolean;
  invokedByUid: string;
}
```

- [ ] **Step 7: Type-check**

Run: `npm run lint`
Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add src/types/index.ts
git commit -m "$(cat <<'EOF'
feat(types): SP4B Lead + OutboundSms + Settings additions (SP4B task 1)

Adds LeadStatus / LeadSource / CallStatus / OutboundSmsKind union types
and Lead + OutboundSms interfaces. Extends CommunicationEventType with
4 new SP4B event types (missed_call_received, missed_call_auto_text_sent,
missed_call_auto_text_failed, outbound_sms_sent, outbound_sms_failed)
and adds optional leadId back-reference on CommunicationEvent.

Adds 'leads' to TabId union (new top-level nav tab) and 3 SP4B Settings
fields (twilioPhoneNumber, twilioPhoneNumberSid, missedCallTemplate).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: DEFAULT_MISSED_CALL_TEMPLATE + DEFAULT_SETTINGS additions

Mirror SP4A Task 2's pattern. Multi-line template with literal newlines (operator-edited templates may use `\n` too, but the constant keeps them as raw `\n` escapes in source).

**Files:**
- Modify: `src/lib/defaults.ts`

- [ ] **Step 1: Add `DEFAULT_MISSED_CALL_TEMPLATE` constant**

Open `src/lib/defaults.ts`. Find the existing `DEFAULT_REVIEW_TEMPLATE` export (added in SP4A Task 2; lives near the top after `FALLBACK_LOGO_SVG`). Insert the SP4B constant IMMEDIATELY AFTER it:

```ts
/**
 * Default outbound SMS body sent on missed-call auto-text.
 * Uses ONLY {businessName} — no {firstName} — because the caller
 * may be an unknown customer at first touch; "Hi , thanks..." would
 * read awkwardly. Operators who only serve repeat customers can edit
 * to include {firstName} in Settings → Missed Call Recovery.
 *
 * Spec: docs/superpowers/specs/2026-06-04-sp4b-missed-call-recovery-design.md
 *       §"Template engine — DEFAULT_MISSED_CALL_TEMPLATE"
 */
export const DEFAULT_MISSED_CALL_TEMPLATE =
  'Hi, thanks for contacting {businessName}.\n\n' +
  'Please reply with:\n\n' +
  '1. Your location\n' +
  '2. Vehicle\n' +
  '3. Tire size (if known)\n' +
  '4. Service needed\n\n' +
  "We'll get back to you shortly.";
```

(The `"We'll"` block uses double-quotes so the ASCII apostrophe in `We'll` doesn't need escaping. All other lines use single-quotes per the existing file style.)

- [ ] **Step 2: Extend `DEFAULT_SETTINGS`**

Find the existing SP4A Review Automation block in `DEFAULT_SETTINGS` (search for `reviewAutomationEnabled`). It looks like:

```ts
  // ─── Review Automation (SP4A) ─ ships OFF, operator opts in ──────
  reviewAutomationEnabled: false,
  reviewSmsTemplate: DEFAULT_REVIEW_TEMPLATE,
  reviewDelayMinutes: 0,
  googleReviewLink: '',
```

Add a sibling SP4B block IMMEDIATELY AFTER (before the closing `};` of `DEFAULT_SETTINGS`):

```ts
  // ─── Missed Call Recovery (SP4B) ─ ships OFF, operator opts in ───
  twilioPhoneNumber: '',
  missedCallTemplate: DEFAULT_MISSED_CALL_TEMPLATE,
  // missedCallAutoTextEnabled already defaulted false in SP1
  // twilioPhoneNumberSid left undefined (optional debug field)
```

- [ ] **Step 3: Type-check**

Run: `npm run lint`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/lib/defaults.ts
git commit -m "$(cat <<'EOF'
feat(defaults): DEFAULT_MISSED_CALL_TEMPLATE + SP4B defaults (SP4B task 2)

4-question reply prompt for unknown callers. Uses only {businessName}
placeholder — no firstName — so the template reads naturally when the
caller hasn't been matched to an existing Customer yet.

DEFAULT_SETTINGS gains twilioPhoneNumber='' + missedCallTemplate.
missedCallAutoTextEnabled stays defaulted false from SP1.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: leadPriority pure helper + tests

The 5-badge taxonomy + score sum + test-lead short-circuit. Pure derivation from joined Customer + Lead data. Consumers (LeadCard, LeadDetailSheet, Leads tab sort, CustomerProfile Recent Leads) all call this helper.

**Files:**
- Create: `src/lib/leadPriority.ts`
- Test: `tests/leadPriority.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/leadPriority.test.ts`:

```ts
// ═══════════════════════════════════════════════════════════════════
//  tests/leadPriority.test.ts
//  Run: npx tsx tests/leadPriority.test.ts
//
//  Pure helper test for computeLeadPriority(). Covers every cell in
//  the badge mapping table (VIP, Fleet, High Value, Repeat Customer,
//  New Lead) plus the test-lead override (id starts with 'lead-test-'
//  → score -1) plus null-customer fallback.
// ═══════════════════════════════════════════════════════════════════

import { computeLeadPriority } from '../src/lib/leadPriority';

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else      { failed++; console.error(`  ✗ ${name}${detail ? `  — ${detail}` : ''}`); }
}

function lead(over: Record<string, unknown> = {}) {
  return { id: 'lead-3055551234-2026-06-04', wasNewCustomer: false, ...over };
}

console.log('\n── VIP alone (Platinum, individual, jobCount≥1) ──');
{
  const out = computeLeadPriority(
    { vipTier: 'Platinum', kind: 'individual', jobCount: 5 },
    lead(),
  );
  check('score is 100', out.score === 100, `got ${out.score}`);
  check('exactly 1 badge', out.badges.length === 1);
  check('badge is VIP', out.badges[0].key === 'vip' && out.badges[0].label === 'VIP');
}

console.log('\n── VIP + Fleet (Platinum fleet) ──');
{
  const out = computeLeadPriority(
    { vipTier: 'Platinum', kind: 'fleet', jobCount: 12 },
    lead(),
  );
  check('score is 180', out.score === 180, `got ${out.score}`);
  check('2 badges', out.badges.length === 2);
  check('contains VIP', out.badges.some(b => b.key === 'vip'));
  check('contains Fleet', out.badges.some(b => b.key === 'fleet'));
}

console.log('\n── High Value alone (Gold, individual) ──');
{
  const out = computeLeadPriority(
    { vipTier: 'Gold', kind: 'individual', jobCount: 3 },
    lead(),
  );
  check('score is 60', out.score === 60, `got ${out.score}`);
  check('badge is High Value', out.badges[0].key === 'high_value');
}

console.log('\n── High Value + Fleet (Gold fleet) ──');
{
  const out = computeLeadPriority(
    { vipTier: 'Gold', kind: 'fleet', jobCount: 6 },
    lead(),
  );
  check('score is 140', out.score === 140, `got ${out.score}`);
  check('contains High Value', out.badges.some(b => b.key === 'high_value'));
  check('contains Fleet', out.badges.some(b => b.key === 'fleet'));
}

console.log('\n── Repeat Customer alone (Standard with history) ──');
{
  const out = computeLeadPriority(
    { vipTier: 'Standard', kind: 'individual', jobCount: 3 },
    lead(),
  );
  check('score is 40', out.score === 40, `got ${out.score}`);
  check('badge is Repeat Customer', out.badges[0].key === 'repeat_customer');
}

console.log('\n── Repeat Customer + Fleet (Standard fleet with history) ──');
{
  const out = computeLeadPriority(
    { vipTier: 'Standard', kind: 'fleet', jobCount: 4 },
    lead(),
  );
  check('score is 120', out.score === 120, `got ${out.score}`);
  check('contains Repeat Customer', out.badges.some(b => b.key === 'repeat_customer'));
  check('contains Fleet', out.badges.some(b => b.key === 'fleet'));
}

console.log('\n── New Lead alone (wasNewCustomer=true) ──');
{
  const out = computeLeadPriority(
    { vipTier: 'Standard', kind: 'individual', jobCount: 0 },
    lead({ wasNewCustomer: true }),
  );
  check('score is 20', out.score === 20, `got ${out.score}`);
  check('badge is New Lead', out.badges[0].key === 'new_lead');
}

console.log('\n── New Lead alone (jobCount===0, wasNewCustomer=false) ──');
{
  // Edge case: Customer existed (via backfill) but had 0 jobs.
  // Should also flag as New Lead.
  const out = computeLeadPriority(
    { vipTier: 'Standard', kind: 'individual', jobCount: 0 },
    lead({ wasNewCustomer: false }),
  );
  check('score is 20', out.score === 20);
  check('badge is New Lead', out.badges[0].key === 'new_lead');
}

console.log('\n── Fleet + New Lead (unknown fleet caller, first call) ──');
{
  const out = computeLeadPriority(
    { vipTier: 'Standard', kind: 'fleet', jobCount: 0 },
    lead({ wasNewCustomer: true }),
  );
  check('score is 100 (80 + 20)', out.score === 100, `got ${out.score}`);
  check('contains Fleet', out.badges.some(b => b.key === 'fleet'));
  check('contains New Lead', out.badges.some(b => b.key === 'new_lead'));
}

console.log('\n── Test lead override (id starts with lead-test-) ──');
{
  const out = computeLeadPriority(
    { vipTier: 'Platinum', kind: 'fleet', jobCount: 99 },     // even a Platinum fleet
    { id: 'lead-test-uid-1717480000000', wasNewCustomer: false },
  );
  check('score is -1 (test override)', out.score === -1, `got ${out.score}`);
  check('no badges on test leads', out.badges.length === 0);
}

console.log('\n── Null customer fallback (defensive) ──');
{
  const out = computeLeadPriority(null, lead({ wasNewCustomer: true }));
  check('score is 20 (new lead fallback)', out.score === 20, `got ${out.score}`);
  check('badge is New Lead', out.badges[0]?.key === 'new_lead');
}

console.log('\n── Undefined customer fallback ──');
{
  const out = computeLeadPriority(undefined, lead({ wasNewCustomer: false }));
  // Customer absent + wasNewCustomer false → still treated as New Lead
  check('score is 20', out.score === 20);
  check('badge is New Lead', out.badges[0]?.key === 'new_lead');
}

console.log('\n── Score-DESC sort produces the expected ordering ──');
{
  // Build the 9 reference rows from the spec and confirm they sort
  // into the documented priority order.
  type Row = { label: string; score: number };
  const rows: Row[] = [
    { label: 'VIP + Fleet',         score: computeLeadPriority({ vipTier: 'Platinum', kind: 'fleet',      jobCount: 9 }, lead()).score },
    { label: 'High Value + Fleet',   score: computeLeadPriority({ vipTier: 'Gold',     kind: 'fleet',      jobCount: 4 }, lead()).score },
    { label: 'Repeat + Fleet',       score: computeLeadPriority({ vipTier: 'Standard', kind: 'fleet',      jobCount: 4 }, lead()).score },
    { label: 'VIP alone',            score: computeLeadPriority({ vipTier: 'Platinum', kind: 'individual', jobCount: 5 }, lead()).score },
    { label: 'Fleet + New',          score: computeLeadPriority({ vipTier: 'Standard', kind: 'fleet',      jobCount: 0 }, lead({ wasNewCustomer: true })).score },
    { label: 'High Value alone',     score: computeLeadPriority({ vipTier: 'Gold',     kind: 'individual', jobCount: 3 }, lead()).score },
    { label: 'Repeat alone',         score: computeLeadPriority({ vipTier: 'Standard', kind: 'individual', jobCount: 3 }, lead()).score },
    { label: 'New Lead alone',       score: computeLeadPriority({ vipTier: 'Standard', kind: 'individual', jobCount: 0 }, lead({ wasNewCustomer: true })).score },
  ];
  const sorted = [...rows].sort((a, b) => b.score - a.score).map(r => r.label);
  const expected = [
    'VIP + Fleet',
    'High Value + Fleet',
    'Repeat + Fleet',
    'VIP alone',
    'Fleet + New',           // ties with VIP alone at 100; order between ties is implementation-defined
    'High Value alone',
    'Repeat alone',
    'New Lead alone',
  ];
  // Normalize: VIP alone (100) and Fleet + New (100) may swap positions
  // since both are 100 — drop their relative ordering from the assertion.
  const sortedFiltered  = sorted .filter(l => l !== 'VIP alone' && l !== 'Fleet + New');
  const expectedFiltered = expected.filter(l => l !== 'VIP alone' && l !== 'Fleet + New');
  check('sorted order matches the documented natural ordering',
    JSON.stringify(sortedFiltered) === JSON.stringify(expectedFiltered),
    `got ${JSON.stringify(sorted)}`);
}

console.log(`\n── ${passed} passed, ${failed} failed ──\n`);
process.exit(failed > 0 ? 1 : 0);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx tests/leadPriority.test.ts`
Expected: `Cannot find module '../src/lib/leadPriority'` — module doesn't exist yet.

- [ ] **Step 3: Write the helper**

Create `src/lib/leadPriority.ts`:

```ts
// src/lib/leadPriority.ts
// ═══════════════════════════════════════════════════════════════════
//  leadPriority — pure 5-badge taxonomy derivation.
//
//  Spec: docs/superpowers/specs/2026-06-04-sp4b-missed-call-recovery-design.md
//        §"Priority Score (new for SP4B)"
//
//  Reads existing SP3 Customer fields (vipTier, kind, jobCount) +
//  Lead.wasNewCustomer. Returns the sum of applicable badge scores
//  plus the list of badges for display. Test leads (id starts with
//  'lead-test-') short-circuit to score -1, no badges — so test
//  traffic doesn't pollute the live priority queue.
//
//  No persisted state. No Lead schema changes. Same Customer data
//  the Leads tab already subscribes to drives the priority signal.
// ═══════════════════════════════════════════════════════════════════

import type { Customer } from '@/lib/customerEntity';
import type { Lead } from '@/types';

export interface LeadPriorityBadge {
  key: 'vip' | 'fleet' | 'high_value' | 'repeat_customer' | 'new_lead';
  label: 'VIP' | 'Fleet' | 'High Value' | 'Repeat Customer' | 'New Lead';
  score: number;
}

export interface LeadPriority {
  score: number;
  badges: LeadPriorityBadge[];
}

const BADGE_VIP:    LeadPriorityBadge = { key: 'vip',             label: 'VIP',             score: 100 };
const BADGE_FLEET:  LeadPriorityBadge = { key: 'fleet',           label: 'Fleet',           score: 80  };
const BADGE_HIGH:   LeadPriorityBadge = { key: 'high_value',      label: 'High Value',      score: 60  };
const BADGE_REPEAT: LeadPriorityBadge = { key: 'repeat_customer', label: 'Repeat Customer', score: 40  };
const BADGE_NEW:    LeadPriorityBadge = { key: 'new_lead',        label: 'New Lead',        score: 20  };

type CustomerSlice = Pick<Customer, 'vipTier' | 'kind' | 'jobCount'>;
type LeadSlice     = Pick<Lead, 'id' | 'wasNewCustomer'>;

export function computeLeadPriority(
  customer: CustomerSlice | null | undefined,
  lead: LeadSlice,
): LeadPriority {
  // Test-lead override — id pattern `lead-test-{uid}-{ms}` from the
  // sendTestMissedCall callable. Sort to the bottom of the queue.
  if (typeof lead.id === 'string' && lead.id.startsWith('lead-test-')) {
    return { score: -1, badges: [] };
  }

  const badges: LeadPriorityBadge[] = [];

  // VIP / High Value / Repeat Customer derive from vipTier — the
  // tiers are mutually exclusive so at most one of these three lands.
  if (customer?.vipTier === 'Platinum') {
    badges.push(BADGE_VIP);
  } else if (customer?.vipTier === 'Gold') {
    badges.push(BADGE_HIGH);
  } else if (
    customer?.vipTier === 'Standard'
    && typeof customer.jobCount === 'number'
    && customer.jobCount >= 2
  ) {
    badges.push(BADGE_REPEAT);
  }

  // Fleet stacks with any of the above.
  if (customer?.kind === 'fleet') {
    badges.push(BADGE_FLEET);
  }

  // New Lead applies when EITHER the lead flagged itself as a new
  // customer OR the customer has zero jobs on record (covers
  // backfill-without-jobs edge case + absent-customer fallback).
  const noJobs = !customer || typeof customer.jobCount !== 'number' || customer.jobCount === 0;
  if (lead.wasNewCustomer === true || noJobs) {
    badges.push(BADGE_NEW);
  }

  const score = badges.reduce((sum, b) => sum + b.score, 0);
  return { score, badges };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx tests/leadPriority.test.ts`
Expected: every check ✓, exit 0, final line `── 27 passed, 0 failed ──` (or similar — the exact count depends on the check() calls; what matters is `0 failed`).

- [ ] **Step 5: Type-check**

Run: `npm run lint`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/lib/leadPriority.ts tests/leadPriority.test.ts
git commit -m "$(cat <<'EOF'
feat(leadPriority): pure 5-badge taxonomy helper (SP4B task 3)

Spec: docs/superpowers/specs/2026-06-04-sp4b-missed-call-recovery-design.md
      §"Priority Score (new for SP4B)"

Derives priority from existing SP3 Customer fields (vipTier, kind,
jobCount) + Lead.wasNewCustomer. No Lead schema impact; no persisted
state. Badge scores: VIP=100, Fleet=80, High Value=60, Repeat=40,
New Lead=20. Score is the sum of applicable badges; e.g. a Platinum
fleet customer = VIP + Fleet = 180.

Test-lead override: id starts with 'lead-test-' → score -1, no badges.
Sorts test traffic to the bottom of the queue without polluting the
live priority ordering.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: firestore.rules + firestore.indexes.json

Two new collection rule blocks and four new composite indexes. The webhook + callables write via admin SDK and bypass rules; clients read leads + outboundSms but only mutate workflow-state fields on Lead.

**Files:**
- Modify: `firestore.rules`
- Modify: `firestore.indexes.json`

- [ ] **Step 1: Locate insertion points**

Run: `grep -n "match /reviewRequests\|match /communicationEvents\|match /technicians" firestore.rules`

Expected output: three lines matching the SP3+SP4A blocks, the last of which is `match /technicians/{docId}`. The SP4A rules block ends just before `match /technicians`. The SP4B block goes between them.

- [ ] **Step 2: Insert the SP4B rules block**

Find the SP4A `match /communicationEvents/{eventId}` block. It closes with a `}` and is followed by an empty line and then the `match /technicians/{docId}` block. Insert the SP4B block between them:

```
      // ─── leads — SP4B Lead queue (admin SDK writes only) ─────────
      // Webhook creates Leads via admin SDK (bypasses rules).
      // Clients may UPDATE workflow fields only — status/notes/etc.
      // Create + delete from client paths are blocked.
      match /leads/{leadId} {
        allow read:   if isMemberOfBusiness(businessId);
        allow create: if false;
        allow update: if isMemberOfBusiness(businessId)
                     && request.resource.data.diff(resource.data).affectedKeys()
                        .hasOnly(['status','notes','assignedToUid','jobId',
                                  'closedAt','closedReason','updatedAt',
                                  'lastEditedByUid']);
        allow delete: if false;
      }

      // ─── outboundSms — SP4B outbound queue (admin SDK only) ──────
      // Sibling to SP4A reviewRequests. Same access pattern.
      match /outboundSms/{smsId} {
        allow read:  if isMemberOfBusiness(businessId);
        allow write: if false;
      }

```

Keep the blank line before `match /technicians/{docId}` to preserve spacing.

- [ ] **Step 3: Append the 4 new indexes**

Edit `firestore.indexes.json`. The SP4A indexes added 2 entries at the end of the `indexes` array (reviewRequests status+sendAfterAt and customerId+createdAt). Append 4 more entries AFTER those, before the closing `]`:

```json
    ,
    {
      "collectionGroup": "leads",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "status",     "order": "ASCENDING" },
        { "fieldPath": "receivedAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "leads",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "customerId", "order": "ASCENDING" },
        { "fieldPath": "receivedAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "outboundSms",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "status",      "order": "ASCENDING" },
        { "fieldPath": "sendAfterAt", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "settings",
      "queryScope": "COLLECTION_GROUP",
      "fields": [
        { "fieldPath": "twilioPhoneNumber", "order": "ASCENDING" }
      ]
    }
```

Take care with the leading comma — the SP4A's last entry ends with `}` then the array closes with `]`. You're inserting `, { ... }, { ... }, { ... }, { ... }` between that closing `}` and the array's closing `]`.

- [ ] **Step 4: Validate JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('firestore.indexes.json','utf8')); console.log('ok')"`
Expected: prints `ok`. SyntaxError → check the comma placement at step 3.

- [ ] **Step 5: Verify rules syntax (best-effort)**

If Java is correctly installed (`java -version` shows 21+):
Run: `firebase emulators:exec --only firestore --project mobile-service-os "true" 2>&1 | tail -20`
Expected: `Script exited successfully`.

If Java is unavailable, skip this step and validate by inspection: the new block must balance `{ ... }` for each `match /xxx { ... }`, and sit inside the parent `match /businesses/{businessId}` scope.

- [ ] **Step 6: Commit**

```bash
git add firestore.rules firestore.indexes.json
git commit -m "$(cat <<'EOF'
feat(rules): leads + outboundSms collections (SP4B task 4)

Two new collections under businesses/{bid}:
  - leads/{leadId} — clients READ + may UPDATE only workflow fields
    (status, notes, assignedToUid, jobId, closedAt, closedReason,
    updatedAt, lastEditedByUid). Create + delete client paths blocked;
    twilioVoiceStatus webhook writes via admin SDK.
  - outboundSms/{smsId} — clients READ only; all writes via admin SDK
    (sibling pattern to SP4A reviewRequests).

Four new composite indexes:
  - leads: (status, receivedAt DESC) for Leads tab filter
  - leads: (customerId, receivedAt DESC) for CustomerProfile section
  - outboundSms: (status, sendAfterAt) for drainOutboundSms query
  - settings (COLLECTION_GROUP): (twilioPhoneNumber) for webhook routing

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: twilioSignatureValidator helper + twilio npm package

Wraps Twilio's signature-validation primitive. Throws on forgery; skips with `console.warn` when `TWILIO_AUTH_TOKEN` is unset (lets SP4B run end-to-end in dev without a real Twilio account).

**Files:**
- Modify: `functions/package.json` (add `twilio` dependency)
- Create: `functions/src/lib/twilioSignatureValidator.ts`

- [ ] **Step 1: Install the twilio npm package**

Run from the repo root:

```bash
cd functions && npm install twilio@5 --save && cd ..
```

Expected: `+ twilio@5.x.x` added under `dependencies` in `functions/package.json`. `functions/package-lock.json` updates.

(twilio's main feature for SP4B is `twilio.validateRequest(authToken, signature, url, params)` from `twilio/lib/webhooks/webhooks`. Even though we ship the helper layer for SMS in SP4A's `twilioClient.ts` using raw `fetch`, the signature-validation primitive uses HMAC-SHA1 with a specific param-sorting recipe — using the official lib avoids reimplementing that exactly.)

- [ ] **Step 2: Write the helper**

Create `functions/src/lib/twilioSignatureValidator.ts`:

```ts
// functions/src/lib/twilioSignatureValidator.ts
// ═══════════════════════════════════════════════════════════════════
//  twilioSignatureValidator — webhook security shield for SP4B.
//
//  Spec: docs/superpowers/specs/2026-06-04-sp4b-missed-call-recovery-design.md
//        §"Webhook security"
//
//  Wraps twilio.validateRequest with consistent error handling.
//  Throws Error('TWILIO_SIGNATURE_INVALID') on forgery so the webhook
//  handler can catch + 403.
//
//  When TWILIO_AUTH_TOKEN is unset:
//    - validation is SKIPPED with a console.warn
//    - the webhook proceeds (so SP4B is testable in dev without a
//      real Twilio account)
//    - operator must set the env var before production exposure
//
//  Uses the canonical Twilio recipe: HMAC-SHA1 of (URL + sorted form
//  params) keyed by the auth token. The twilio package handles this
//  internally via validateRequest().
// ═══════════════════════════════════════════════════════════════════

import { validateRequest } from 'twilio';

export interface ValidationInput {
  signatureHeader: string | undefined;      // x-twilio-signature
  url: string;                              // full URL incl. protocol + path + query
  params: Record<string, string>;           // parsed form body
}

/**
 * Throws Error('TWILIO_SIGNATURE_INVALID') on a forged signature.
 * Silently returns when TWILIO_AUTH_TOKEN is unset (with a warning).
 */
export function assertValidTwilioSignature(input: ValidationInput): void {
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!token) {
    // eslint-disable-next-line no-console
    console.warn('[twilioSignatureValidator] TWILIO_AUTH_TOKEN unset — signature validation DISABLED. Do not deploy to production in this state.');
    return;
  }
  const sig = input.signatureHeader ?? '';
  const ok = validateRequest(token, sig, input.url, input.params);
  if (!ok) {
    throw new Error('TWILIO_SIGNATURE_INVALID');
  }
}
```

- [ ] **Step 3: Confirm functions build**

Run: `cd functions && npm run build && cd ..`
Expected: exit 0. `functions/lib/lib/twilioSignatureValidator.js` exists.

If the build errors on `import { validateRequest } from 'twilio'`, the npm install at step 1 didn't take. Re-run it and check `functions/node_modules/twilio` exists.

- [ ] **Step 4: Commit**

```bash
git add functions/package.json functions/package-lock.json functions/src/lib/twilioSignatureValidator.ts
git commit -m "$(cat <<'EOF'
feat(twilioSignatureValidator): webhook signature shield (SP4B task 5)

Wraps twilio.validateRequest. Throws Error('TWILIO_SIGNATURE_INVALID')
on forgery → twilioVoiceStatus handler catches + 403.

When TWILIO_AUTH_TOKEN is unset: validation is SKIPPED with a
console.warn, so SP4B is deployable + testable in dev without a real
Twilio account. Operator MUST set the env var before production
exposure.

Adds twilio@5 dependency to functions/package.json.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: twilioVoiceStatus webhook + tests

The inbound funnel entry point. `onRequest` HTTPS function that:
1. Validates the Twilio signature
2. Filters by Direction + CallStatus
3. Routes to a business by `To` (collection-group settings query)
4. Normalizes the caller's phone
5. Dedups by `lead-{phoneDigits}-{dateISO}` doc id
6. Looks up Customer (or creates a new one with `wasNewCustomer: true`)
7. Transactionally writes the Lead + enqueues outboundSms + logs communicationEvent

Returns 200 OK to Twilio for all paths except signature failure (403) — internal errors log + 200 so Twilio doesn't retry-storm.

The decision logic is exposed via `__testHooks.decide` as a pure function so tests can exercise every guard branch without booting the emulator.

**Files:**
- Create: `functions/src/twilioVoiceStatus.ts`
- Test: `tests/twilioVoiceStatus.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/twilioVoiceStatus.test.ts`:

```ts
// ═══════════════════════════════════════════════════════════════════
//  tests/twilioVoiceStatus.test.ts
//  Run: npx tsx tests/twilioVoiceStatus.test.ts
//
//  Exercises the twilioVoiceStatus webhook decision tree via the
//  __testHooks.decide() pure function. Shimmed Firestore is NOT used
//  here — _decide is pure, returns { action, patch } for the wrapper
//  to apply.
//
//  Production wrapper handles signature validation, the Firestore
//  transaction, and the 200 OK / 403 response. The wrapper is
//  exercised in the emulator smoke (Task 17).
// ═══════════════════════════════════════════════════════════════════

import { __testHooks } from '../functions/src/twilioVoiceStatus';

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else      { failed++; console.error(`  ✗ ${name}${detail ? `  — ${detail}` : ''}`); }
}

const { decide, computeLeadId } = __testHooks;

function form(over: Record<string, string> = {}) {
  return {
    From: '+13055551234',
    To:   '+15555550000',
    CallSid: 'CA_abc123',
    CallStatus: 'no-answer',
    CallDuration: '0',
    Direction: 'inbound',
    ...over,
  };
}

const baseSettings = {
  reviewAutomationEnabled: false,
  missedCallAutoTextEnabled: true,
  missedCallTemplate: 'Hi, thanks for contacting {businessName}. Reply with details.',
  businessName: 'Wheel Rush',
  twilioPhoneNumber: '+15555550000',
};

console.log('\n── guard: Direction outbound ──');
{
  const out = decide(form({ Direction: 'outbound-api' }), baseSettings, null, null);
  check('skips when outbound', out.action === 'skip' && out.reason === 'not-inbound');
}

console.log('\n── guard: CallStatus completed ──');
{
  const out = decide(form({ CallStatus: 'completed' }), baseSettings, null, null);
  check('skips when completed', out.action === 'skip' && out.reason === 'not-missed');
}

console.log('\n── guard: CallStatus in-progress ──');
{
  const out = decide(form({ CallStatus: 'in-progress' }), baseSettings, null, null);
  check('skips when in-progress', out.action === 'skip');
}

console.log('\n── guard: From invalid ──');
{
  const out = decide(form({ From: 'gibberish' }), baseSettings, null, null);
  check('skips when phone invalid', out.action === 'skip' && out.reason === 'invalid-phone');
}

console.log('\n── guard: 24h dedup ──');
{
  // existingLead24h is non-null → Lead already created from this number today
  const out = decide(form(), baseSettings, null, { id: 'lead-3055551234-2026-06-04' });
  check('skips when lead exists in 24h window', out.action === 'skip' && out.reason === 'dedup');
}

console.log('\n── busy CallStatus → still proceeds (it is a missed call) ──');
{
  const out = decide(form({ CallStatus: 'busy' }), baseSettings, null, null);
  check('action enqueue on busy', out.action === 'enqueue');
}

console.log('\n── failed CallStatus → still proceeds ──');
{
  const out = decide(form({ CallStatus: 'failed' }), baseSettings, null, null);
  check('action enqueue on failed', out.action === 'enqueue');
}

console.log('\n── happy path with NEW customer ──');
{
  const out = decide(form(), baseSettings, null, null);
  check('action is enqueue', out.action === 'enqueue');
  if (out.action === 'enqueue') {
    check('wasNewCustomer is true', out.wasNewCustomer === true);
    check('leadId matches lead-{digits}-{date}',
      /^lead-3055551234-\d{4}-\d{2}-\d{2}$/.test(out.leadId),
      out.leadId);
    check('source missed_call', out.lead.source === 'missed_call');
    check('status New', out.lead.status === 'New');
    check('autoTextSent false', out.lead.autoTextSent === false);
    check('callStatus mapped to no-answer', out.lead.callStatus === 'no-answer');
    check('outbound enqueued (toggle ON)', !!out.outboundSms);
    if (out.outboundSms) {
      check('SMS rendered contains business name',
        out.outboundSms.templateRendered.includes('Wheel Rush'));
      check('outbound kind is missed_call_response',
        out.outboundSms.kind === 'missed_call_response');
      check('outbound id is sms-{leadId}',
        out.outboundSms.id === `sms-${out.leadId}`);
    }
  }
}

console.log('\n── happy path with EXISTING customer ──');
{
  const existingCustomer = {
    id: 'p_13055551234',
    name: 'Maria Lopez',
    phoneE164: '+13055551234',
    kind: 'individual' as const,
    vipTier: 'Gold' as const,
    jobCount: 5,
  };
  const out = decide(form(), baseSettings, existingCustomer, null);
  check('action enqueue', out.action === 'enqueue');
  if (out.action === 'enqueue') {
    check('wasNewCustomer false', out.wasNewCustomer === false);
    check('customerId points to existing doc', out.lead.customerId === 'p_13055551234');
  }
}

console.log('\n── toggle OFF: writes Lead but no outboundSms ──');
{
  const out = decide(form(), { ...baseSettings, missedCallAutoTextEnabled: false }, null, null);
  check('action enqueue (Lead still created)', out.action === 'enqueue');
  if (out.action === 'enqueue') {
    check('outbound NOT enqueued', !out.outboundSms);
  }
}

console.log('\n── voicemail CallStatus maps to voicemail ──');
{
  // Twilio's voice-status callback uses `CallStatus=completed` for voicemail-
  // dropped calls; we conservatively also accept the explicit `voicemail`
  // string in case a future TwiML config produces it. Treated as missed.
  const out = decide(form({ CallStatus: 'voicemail' }), baseSettings, null, null);
  check('voicemail proceeds (treated as missed call)', out.action === 'enqueue');
  if (out.action === 'enqueue') {
    check('callStatus voicemail', out.lead.callStatus === 'voicemail');
  }
}

console.log('\n── computeLeadId stability ──');
{
  const a = computeLeadId('+13055551234', '2026-06-04');
  const b = computeLeadId('+13055551234', '2026-06-04');
  check('same input → same id', a === b);
  check('matches lead-{digits}-{date}', a === 'lead-3055551234-2026-06-04');
  const c = computeLeadId('+13055551234', '2026-06-05');
  check('different date → different id', a !== c);
}

console.log(`\n── ${passed} passed, ${failed} failed ──\n`);
process.exit(failed > 0 ? 1 : 0);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx tests/twilioVoiceStatus.test.ts`
Expected: `Cannot find module '../functions/src/twilioVoiceStatus'`.

- [ ] **Step 3: Write the webhook handler**

Create `functions/src/twilioVoiceStatus.ts`:

```ts
// functions/src/twilioVoiceStatus.ts
// ═══════════════════════════════════════════════════════════════════
//  twilioVoiceStatus — SP4B inbound webhook (HTTPS function).
//
//  Spec: docs/superpowers/specs/2026-06-04-sp4b-missed-call-recovery-design.md
//        §"1. twilioVoiceStatus HTTPS webhook"
//
//  Twilio Console → Phone Numbers → [Number] → Voice & Fax → Status
//  Callback URL points here. Twilio POSTs form-encoded body on every
//  call completion. We filter to inbound missed calls and create a
//  Lead + optionally enqueue an outboundSms auto-text.
//
//  Pure decision logic lives in _decide() (exposed via __testHooks).
//  The wrapper handles signature validation, Firestore transactions,
//  and HTTP response codes.
//
//  Returns 200 OK for all internal failures (with loud console.error)
//  so Twilio doesn't initiate a retry storm. 403 is reserved for
//  forged signature failures only.
// ═══════════════════════════════════════════════════════════════════

import { onRequest } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import { renderTemplate } from './lib/reviewTemplate';
import { assertValidTwilioSignature } from './lib/twilioSignatureValidator';
void admin;

const DEFAULT_TEMPLATE_FALLBACK = 'Hi, thanks for contacting {businessName}.';

type SettingsLite = {
  missedCallAutoTextEnabled?: boolean;
  missedCallTemplate?: string;
  businessName?: string;
  twilioPhoneNumber?: string;
};
type CustomerLite = {
  id: string;
  name?: string;
  phoneE164?: string;
  kind?: 'individual' | 'fleet';
  vipTier?: 'Standard' | 'Gold' | 'Platinum';
  jobCount?: number;
};

interface LeadDraft {
  customerId: string;
  phoneE164: string;
  source: 'missed_call';
  status: 'New';
  wasNewCustomer: boolean;
  callSid?: string;
  callStatus?: 'no-answer' | 'busy' | 'failed' | 'voicemail';
  autoTextSent: false;
  lastEditedByUid: 'system:missedCallRecovery';
}
interface OutboundSmsDraft {
  id: string;
  kind: 'missed_call_response';
  leadId: string;
  customerId: string;
  phoneE164: string;
  templateUsed: string;
  templateRendered: string;
  status: 'pending';
  retryCount: 0;
  isTest: false;
  invokedByUid: 'system:missedCallRecovery';
}

interface DecisionEnqueue {
  action: 'enqueue';
  leadId: string;
  wasNewCustomer: boolean;
  lead: LeadDraft;
  outboundSms?: OutboundSmsDraft;
}
interface DecisionSkip {
  action: 'skip';
  reason: string;
}
export type Decision = DecisionEnqueue | DecisionSkip;

function _digitsOnly(e164: string): string {
  return (e164 ?? '').replace(/[^\d]/g, '');
}

function _isValidE164(s: string): boolean {
  return /^\+[1-9]\d{6,14}$/.test(s);
}

function _computeLeadId(fromE164: string, dateIso: string): string {
  return `lead-${_digitsOnly(fromE164)}-${dateIso}`;
}

function _isoDate(): string {
  // YYYY-MM-DD in UTC. Date partition for dedup. Operators in DST
  // edge cases get the UTC boundary — acceptable for v1.
  return new Date().toISOString().slice(0, 10);
}

function _mapCallStatus(raw: string): 'no-answer' | 'busy' | 'failed' | 'voicemail' | null {
  switch (raw) {
    case 'no-answer': return 'no-answer';
    case 'busy':      return 'busy';
    case 'failed':    return 'failed';
    case 'voicemail': return 'voicemail';
    default:          return null;
  }
}

function _decide(
  form: Record<string, string>,
  settings: SettingsLite,
  existingCustomer: CustomerLite | null,
  existingLead24h: { id: string } | null,
): Decision {
  // Guard 1: inbound only
  if (form.Direction !== 'inbound') {
    return { action: 'skip', reason: 'not-inbound' };
  }
  // Guard 2: missed-call statuses only
  const status = _mapCallStatus(form.CallStatus);
  if (!status) {
    return { action: 'skip', reason: 'not-missed' };
  }
  // Guard 3: valid phone
  if (!_isValidE164(form.From)) {
    return { action: 'skip', reason: 'invalid-phone' };
  }
  // Guard 4: 24h dedup
  if (existingLead24h) {
    return { action: 'skip', reason: 'dedup' };
  }

  const dateIso = _isoDate();
  const leadId = _computeLeadId(form.From, dateIso);

  const customerId = existingCustomer?.id ?? `p_${_digitsOnly(form.From)}`;
  const wasNewCustomer = !existingCustomer;

  const lead: LeadDraft = {
    customerId,
    phoneE164: form.From,
    source: 'missed_call',
    status: 'New',
    wasNewCustomer,
    callSid: form.CallSid,
    callStatus: status,
    autoTextSent: false,
    lastEditedByUid: 'system:missedCallRecovery',
  };

  let outboundSms: OutboundSmsDraft | undefined;
  if (settings.missedCallAutoTextEnabled === true) {
    const template = settings.missedCallTemplate?.trim() || DEFAULT_TEMPLATE_FALLBACK;
    const templateRendered = renderTemplate(template, {
      firstName:    existingCustomer?.name ? (existingCustomer.name.trim().split(/\s+/)[0] ?? '') : '',
      lastName:     existingCustomer?.name ? existingCustomer.name.trim().split(/\s+/).slice(1).join(' ') : '',
      businessName: settings.businessName?.trim() ?? '',
      serviceType:  '',
      city:         '',
      vehicle:      '',
      reviewLink:   '',
    });
    outboundSms = {
      id: `sms-${leadId}`,
      kind: 'missed_call_response',
      leadId,
      customerId,
      phoneE164: form.From,
      templateUsed: template,
      templateRendered,
      status: 'pending',
      retryCount: 0,
      isTest: false,
      invokedByUid: 'system:missedCallRecovery',
    };
  }

  return { action: 'enqueue', leadId, wasNewCustomer, lead, outboundSms };
}

// ─── Wrapper ───────────────────────────────────────────────────────

export const twilioVoiceStatus = onRequest(
  { cors: false },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).send('method not allowed');
      return;
    }
    // Twilio sends application/x-www-form-urlencoded. Firebase Functions
    // v2 onRequest parses this into req.body as an object of strings.
    const form = (req.body ?? {}) as Record<string, string>;

    // 1. Signature validation
    try {
      const url = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
      assertValidTwilioSignature({
        signatureHeader: req.header('x-twilio-signature') ?? undefined,
        url,
        params: form,
      });
    } catch (err) {
      if ((err as Error).message === 'TWILIO_SIGNATURE_INVALID') {
        console.error('[twilioVoiceStatus] signature invalid', {
          from: form.From, to: form.To, callSid: form.CallSid,
        });
        res.status(403).send('invalid signature');
        return;
      }
      console.error('[twilioVoiceStatus] signature check error', err);
      res.status(200).send('ok');
      return;
    }

    try {
      const db = admin.firestore();

      // 2. Route to business via collection-group settings query
      const bizSnap = await db.collectionGroup('settings')
        .where('twilioPhoneNumber', '==', form.To ?? '')
        .limit(1)
        .get();
      if (bizSnap.empty) {
        console.warn('[twilioVoiceStatus] no business found for To', { to: form.To });
        res.status(200).send('ok');
        return;
      }
      const settingsDoc = bizSnap.docs[0];
      const businessId  = settingsDoc.ref.parent.parent?.id;
      if (!businessId) {
        console.warn('[twilioVoiceStatus] settings path missing parent business', {
          path: settingsDoc.ref.path,
        });
        res.status(200).send('ok');
        return;
      }
      const settings = settingsDoc.data() as SettingsLite;

      // 3. Look up existing customer by phone
      let existingCustomer: CustomerLite | null = null;
      if (form.From && _isValidE164(form.From)) {
        const phoneKey = _digitsOnly(form.From);
        const customerRef = db.doc(`businesses/${businessId}/customers/p_${phoneKey}`);
        const custSnap = await customerRef.get();
        if (custSnap.exists) {
          existingCustomer = { id: custSnap.id, ...(custSnap.data() as Omit<CustomerLite, 'id'>) };
        }
      }

      // 4. Dedup check — Lead from same phone in last 24h
      const dayAgo = Timestamp.fromMillis(Date.now() - 24 * 60 * 60 * 1000);
      const dedupSnap = await db.collection(`businesses/${businessId}/leads`)
        .where('phoneE164', '==', form.From ?? '')
        .where('receivedAt', '>', dayAgo)
        .limit(1)
        .get();
      const existingLead24h = dedupSnap.empty
        ? null
        : { id: dedupSnap.docs[0].id };

      // 5. Pure decision
      const decision = _decide(form, settings, existingCustomer, existingLead24h);
      if (decision.action === 'skip') {
        console.info('[twilioVoiceStatus] skip', { reason: decision.reason, from: form.From });
        res.status(200).send('ok');
        return;
      }

      // 6. Apply decision in a transaction
      const leadRef = db.doc(`businesses/${businessId}/leads/${decision.leadId}`);
      const customerRef = db.doc(`businesses/${businessId}/customers/${decision.lead.customerId}`);
      const outboundSmsRef = decision.outboundSms
        ? db.doc(`businesses/${businessId}/outboundSms/${decision.outboundSms.id}`)
        : null;
      const now = Timestamp.now();

      await db.runTransaction(async (tx) => {
        // Re-check dedup inside the tx (race protection)
        const freshLead = await tx.get(leadRef);
        if (freshLead.exists) {
          console.info('[twilioVoiceStatus] race-skip — Lead already exists', { leadId: decision.leadId });
          return;
        }

        // If customer was new, write the Customer doc inside the tx
        if (decision.wasNewCustomer) {
          tx.set(customerRef, {
            id: decision.lead.customerId,
            name: '',
            nameLower: '',
            phoneE164: form.From,
            phoneKey: _digitsOnly(form.From),
            kind: 'individual',
            jobCount: 0,
            customerStatus: 'Active',
            vipTier: 'Standard',
            createdAt: now,
            updatedAt: now,
            lastEditedAt: now,
            lastEditedByUid: 'system:missedCallRecovery',
          }, { merge: true });
        }

        tx.set(leadRef, {
          id: decision.leadId,
          ...decision.lead,
          receivedAt: now,
          createdAt: now,
          updatedAt: now,
        });

        if (outboundSmsRef && decision.outboundSms) {
          tx.set(outboundSmsRef, {
            ...decision.outboundSms,
            sendAfterAt: now,
            createdAt: now,
          });
        }

        // CommunicationEvent: missed_call_received (always)
        const evtRef = db.collection(`businesses/${businessId}/communicationEvents`).doc();
        tx.set(evtRef, {
          id: evtRef.id,
          type: 'missed_call_received',
          channel: 'call',
          direction: 'inbound',
          customerId: decision.lead.customerId,
          leadId: decision.leadId,
          status: 'queued',
          sentAt: now,
          createdByUid: 'system:missedCallRecovery',
        });
      });

      console.info('[twilioVoiceStatus] lead enqueued', {
        businessId, leadId: decision.leadId, from: form.From,
        wasNewCustomer: decision.wasNewCustomer,
        autoTextEnqueued: !!decision.outboundSms,
      });
      res.status(200).send('ok');
    } catch (err) {
      console.error('[twilioVoiceStatus] internal error', err);
      // ALWAYS 200 on internal error so Twilio doesn't retry-storm
      res.status(200).send('ok');
    }
  },
);

export const __testHooks = {
  decide: _decide,
  computeLeadId: _computeLeadId,
  isValidE164: _isValidE164,
  mapCallStatus: _mapCallStatus,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx tests/twilioVoiceStatus.test.ts`
Expected: every check ✓, exit 0, final line `── X passed, 0 failed ──` where X matches the actual check count.

- [ ] **Step 5: Confirm functions build**

Run: `cd functions && npm run build && cd ..`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add functions/src/twilioVoiceStatus.ts tests/twilioVoiceStatus.test.ts
git commit -m "$(cat <<'EOF'
feat(webhook): twilioVoiceStatus inbound funnel (SP4B task 6)

onRequest HTTPS webhook. Twilio Console points its Voice Status
Callback URL here. Filters inbound + missed (no-answer / busy /
failed / voicemail), routes to business via collection-group settings
query, looks up Customer (or creates new), dedups via lead-{phone}-{date}
doc id, then transactionally writes:
  - Lead doc with status='New', source='missed_call', wasNewCustomer flag
  - outboundSms doc (only if missedCallAutoTextEnabled===true)
  - communicationEvents entry of type 'missed_call_received'
  - New Customer doc if the caller wasn't matched

Pure decision logic in _decide() exposed via __testHooks for unit
coverage — no emulator needed for test runs. Returns 200 OK to Twilio
for all internal errors so Twilio doesn't retry-storm. 403 reserved
for signature-validation failure.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: drainOutboundSms scheduled function + tests

Mirrors SP4A's `drainReviewRequests` for the new `outboundSms` collection. Same per-row state transitions (TWILIO_NOT_CONFIGURED, 4xx, 5xx-retry, 5xx-third-strike, success, race-skip, future-sendAfterAt). Only difference: on success, also flips the parent `lead.autoTextSent = true` + `outboundSmsId` + `autoTextSentAt`.

**Files:**
- Create: `functions/src/drainOutboundSms.ts`
- Test: `tests/drainOutboundSms.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/drainOutboundSms.test.ts`:

```ts
// ═══════════════════════════════════════════════════════════════════
//  tests/drainOutboundSms.test.ts
//  Run: npx tsx tests/drainOutboundSms.test.ts
//
//  Mirrors SP4A's drainReviewRequests test suite for the outboundSms
//  queue. Same 7 outcome paths. Plus: confirms the parent Lead
//  `autoTextSent` flag flips on success for kind=missed_call_response.
// ═══════════════════════════════════════════════════════════════════

import { __testHooks } from '../functions/src/drainOutboundSms';

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else      { failed++; console.error(`  ✗ ${name}${detail ? `  — ${detail}` : ''}`); }
}

const { processOne } = __testHooks;

function makeShim(initialSms: Record<string, unknown>, initialLead?: Record<string, unknown>) {
  const docs = new Map<string, Record<string, unknown>>();
  docs.set('businesses/biz1/outboundSms/sms1', { id: 'sms1', ...initialSms });
  if (initialLead) {
    docs.set(`businesses/biz1/leads/${initialLead.id}`, initialLead);
  }
  const writes: Array<{ path: string; patch: Record<string, unknown>; op: 'set' | 'update' }> = [];
  const events: Array<Record<string, unknown>> = [];

  return {
    docs, writes, events,
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
    addCommunicationEvent: (e: Record<string, unknown>) => { events.push(e); },
  };
}

function baseSms(over: Record<string, unknown> = {}) {
  return {
    kind: 'missed_call_response',
    leadId: 'lead-3055551234-2026-06-04',
    customerId: 'p_13055551234',
    phoneE164: '+13055551234',
    templateUsed: 'Hi, thanks for contacting {businessName}.',
    templateRendered: 'Hi, thanks for contacting Wheel Rush.',
    status: 'pending',
    retryCount: 0,
    invokedByUid: 'system:missedCallRecovery',
    ...over,
  };
}

function baseLead() {
  return { id: 'lead-3055551234-2026-06-04', autoTextSent: false };
}

console.log('\n── Twilio off → leaves pending ──');
{
  const shim = makeShim(baseSms(), baseLead());
  const sendSms = async () => { throw new Error('TWILIO_NOT_CONFIGURED'); };
  await processOne({ businessId: 'biz1', smsId: 'sms1' }, shim.tx as never, sendSms, shim.addCommunicationEvent);
  const after = shim.docs.get('businesses/biz1/outboundSms/sms1');
  check('status stays pending', after?.status === 'pending');
  check('retryCount stays 0', after?.retryCount === 0);
  check('no events', shim.events.length === 0);
  const lead = shim.docs.get(`businesses/biz1/leads/lead-3055551234-2026-06-04`);
  check('lead.autoTextSent stays false', lead?.autoTextSent === false);
}

console.log('\n── 4xx terminal → failed + event ──');
{
  const shim = makeShim(baseSms(), baseLead());
  const err = Object.assign(new Error('Invalid number'), { name: 'TwilioError', status: 400, carrierCode: '21211' });
  const sendSms = async () => { throw err; };
  await processOne({ businessId: 'biz1', smsId: 'sms1' }, shim.tx as never, sendSms, shim.addCommunicationEvent);
  const after = shim.docs.get('businesses/biz1/outboundSms/sms1');
  check('status=failed on 4xx', after?.status === 'failed');
  check('event missed_call_auto_text_failed logged', shim.events[0]?.type === 'missed_call_auto_text_failed');
}

console.log('\n── 5xx retry → bumps counter, no event ──');
{
  const shim = makeShim(baseSms({ retryCount: 0 }), baseLead());
  const err = Object.assign(new Error('upstream'), { name: 'TwilioError', status: 503 });
  const sendSms = async () => { throw err; };
  await processOne({ businessId: 'biz1', smsId: 'sms1' }, shim.tx as never, sendSms, shim.addCommunicationEvent);
  const after = shim.docs.get('businesses/biz1/outboundSms/sms1');
  check('stays pending', after?.status === 'pending');
  check('retryCount=1', after?.retryCount === 1);
  check('no event yet', shim.events.length === 0);
}

console.log('\n── 5xx third strike → failed + event ──');
{
  const shim = makeShim(baseSms({ retryCount: 2 }), baseLead());
  const err = Object.assign(new Error('upstream'), { name: 'TwilioError', status: 503 });
  const sendSms = async () => { throw err; };
  await processOne({ businessId: 'biz1', smsId: 'sms1' }, shim.tx as never, sendSms, shim.addCommunicationEvent);
  const after = shim.docs.get('businesses/biz1/outboundSms/sms1');
  check('status=failed', after?.status === 'failed');
  check('retryCount=3', after?.retryCount === 3);
  check('event logged', shim.events.length === 1);
}

console.log('\n── success: missed_call_response → flips lead.autoTextSent ──');
{
  const shim = makeShim(baseSms(), baseLead());
  const sendSms = async () => ({ messageSid: 'SM_abc', deliveryStatus: 'queued' });
  await processOne({ businessId: 'biz1', smsId: 'sms1' }, shim.tx as never, sendSms, shim.addCommunicationEvent);
  const after = shim.docs.get('businesses/biz1/outboundSms/sms1');
  check('status=sent', after?.status === 'sent');
  check('twilioMessageSid populated', after?.twilioMessageSid === 'SM_abc');
  check('deliveryStatus queued', after?.deliveryStatus === 'queued');
  check('event missed_call_auto_text_sent', shim.events[0]?.type === 'missed_call_auto_text_sent');
  const lead = shim.docs.get('businesses/biz1/leads/lead-3055551234-2026-06-04');
  check('lead.autoTextSent flipped true', lead?.autoTextSent === true);
  check('lead.outboundSmsId set', lead?.outboundSmsId === 'sms1');
}

console.log('\n── success: manual_lead_reply → does NOT flip lead.autoTextSent ──');
{
  const shim = makeShim(baseSms({ kind: 'manual_lead_reply', isManual: true, invokedByUid: 'uid-operator' }), baseLead());
  const sendSms = async () => ({ messageSid: 'SM_xyz', deliveryStatus: 'queued' });
  await processOne({ businessId: 'biz1', smsId: 'sms1' }, shim.tx as never, sendSms, shim.addCommunicationEvent);
  const after = shim.docs.get('businesses/biz1/outboundSms/sms1');
  check('status=sent', after?.status === 'sent');
  check('event outbound_sms_sent', shim.events[0]?.type === 'outbound_sms_sent');
  const lead = shim.docs.get('businesses/biz1/leads/lead-3055551234-2026-06-04');
  check('lead.autoTextSent stays false (manual reply does not flip)', lead?.autoTextSent === false);
}

console.log('\n── racing: doc already in sending → skip ──');
{
  const shim = makeShim(baseSms({ status: 'sending' }), baseLead());
  const sendSms = async () => { throw new Error('should not be called'); };
  await processOne({ businessId: 'biz1', smsId: 'sms1' }, shim.tx as never, sendSms, shim.addCommunicationEvent);
  const after = shim.docs.get('businesses/biz1/outboundSms/sms1');
  check('stays sending', after?.status === 'sending');
  check('no events', shim.events.length === 0);
}

console.log('\n── sendAfterAt future → skip ──');
{
  const futureMs = Date.now() + 10 * 60_000;
  const shim = makeShim(
    baseSms({ sendAfterAt: { _seconds: Math.floor(futureMs / 1000), _nanoseconds: 0 } }),
    baseLead(),
  );
  const sendSms = async () => { throw new Error('should not be called'); };
  await processOne({ businessId: 'biz1', smsId: 'sms1' }, shim.tx as never, sendSms, shim.addCommunicationEvent);
  const after = shim.docs.get('businesses/biz1/outboundSms/sms1');
  check('stays pending when sendAfterAt > now', after?.status === 'pending');
  check('no events', shim.events.length === 0);
}

console.log(`\n── ${passed} passed, ${failed} failed ──\n`);
process.exit(failed > 0 ? 1 : 0);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx tests/drainOutboundSms.test.ts`
Expected: `Cannot find module '../functions/src/drainOutboundSms'`.

- [ ] **Step 3: Write the drainer**

Create `functions/src/drainOutboundSms.ts`:

```ts
// functions/src/drainOutboundSms.ts
// ═══════════════════════════════════════════════════════════════════
//  drainOutboundSms — SP4B scheduled drainer.
//
//  Spec: docs/superpowers/specs/2026-06-04-sp4b-missed-call-recovery-design.md
//        §"4. drainOutboundSms scheduled function"
//
//  Sibling of SP4A's drainReviewRequests but reads from the new
//  outboundSms collection. Same per-row decision tree:
//
//    - TWILIO_NOT_CONFIGURED → leave pending (dormant)
//    - 4xx                   → status=failed + event
//    - 5xx                   → retryCount++; status=failed at 3 + event
//    - success               → status=sent + sid + lifecycle + event;
//                              for kind=missed_call_response also flips
//                              parent lead.autoTextSent = true
//    - status != pending     → race-skip
//    - sendAfterAt > now     → defensive skip
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
  smsId: string;
}

type SendSmsFn = (args: { to: string; body: string }) => Promise<{ messageSid: string; deliveryStatus: string }>;
type EventSink  = (e: Record<string, unknown>) => void;

interface TxLike {
  get(ref: { path: string }): Promise<{ exists: boolean; data: () => Record<string, unknown> | undefined }>;
  update(ref: { path: string }, patch: Record<string, unknown>): void;
  set(ref: { path: string }, patch: Record<string, unknown>): void;
}

function _isSendAfterPast(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value === 'number') return value <= Date.now();
  const obj = value as { _seconds?: number; seconds?: number; toMillis?: () => number };
  if (typeof obj.toMillis === 'function') return obj.toMillis() <= Date.now();
  const seconds = obj._seconds ?? obj.seconds;
  if (typeof seconds === 'number') return seconds * 1000 <= Date.now();
  return true;
}

// SP4B-specific event-type discriminator: missed_call_response writes
// the missed_call_* event names, manual_lead_reply writes outbound_sms_*.
function _eventTypeForOutcome(kind: string, outcome: 'sent' | 'failed'): string {
  if (kind === 'missed_call_response') {
    return outcome === 'sent' ? 'missed_call_auto_text_sent' : 'missed_call_auto_text_failed';
  }
  return outcome === 'sent' ? 'outbound_sms_sent' : 'outbound_sms_failed';
}

async function _processOne(
  target: ProcessTarget,
  tx: TxLike,
  sendSms: SendSmsFn,
  addCommunicationEvent: EventSink,
): Promise<void> {
  const path = `businesses/${target.businessId}/outboundSms/${target.smsId}`;
  const snap = await tx.get({ path });
  if (!snap.exists) return;
  const req = snap.data() ?? {};

  if (req.status !== 'pending') return;
  if (!_isSendAfterPast(req.sendAfterAt)) return;

  // Transactional flip pending → sending
  tx.update({ path }, { status: 'sending' });

  const kind = String(req.kind ?? 'missed_call_response');
  const leadId = String(req.leadId ?? '');

  try {
    const result = await sendSms({ to: String(req.phoneE164), body: String(req.templateRendered) });
    const sentAt = Timestamp.now();
    tx.update({ path }, {
      status: 'sent',
      sentAt,
      twilioMessageSid: result.messageSid,
      deliveryStatus:   result.deliveryStatus,
    });
    // For missed_call_response: also flip the parent Lead so the UI
    // can render the auto-text-sent state without a join query.
    if (kind === 'missed_call_response' && leadId) {
      tx.update({ path: `businesses/${target.businessId}/leads/${leadId}` }, {
        autoTextSent: true,
        autoTextSentAt: sentAt,
        outboundSmsId: target.smsId,
      });
    }
    addCommunicationEvent({
      type: _eventTypeForOutcome(kind, 'sent'),
      channel: 'sms',
      direction: 'outbound',
      customerId: req.customerId,
      leadId,
      content: req.templateRendered,
      status: 'sent',
      providerMessageId: result.messageSid,
      deliveryStatus:    result.deliveryStatus,
      sentAt,
      createdByUid: req.invokedByUid ?? 'system:missedCallRecovery',
    });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg === 'TWILIO_NOT_CONFIGURED') {
      tx.update({ path }, { status: 'pending' });
      return;
    }
    if (err instanceof TwilioError || (err as { name?: string }).name === 'TwilioError') {
      const status = (err as TwilioError).status;
      if (status >= 500) {
        const nextRetry = Number(req.retryCount ?? 0) + 1;
        if (nextRetry >= MAX_RETRIES) {
          const failedAt = Timestamp.now();
          tx.update({ path }, {
            status: 'failed', retryCount: nextRetry, failedAt,
            errorMessage: `transient retries exhausted: ${msg}`,
          });
          addCommunicationEvent({
            type: _eventTypeForOutcome(kind, 'failed'),
            channel: 'sms', direction: 'outbound',
            customerId: req.customerId, leadId,
            content: req.templateRendered,
            carrierResponse: msg,
            status: 'failed',
            sentAt: failedAt,
            createdByUid: req.invokedByUid ?? 'system:missedCallRecovery',
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
        status: 'failed', failedAt,
        errorMessage: carrierCode ? `${carrierCode}: ${msg}` : msg,
      });
      addCommunicationEvent({
        type: _eventTypeForOutcome(kind, 'failed'),
        channel: 'sms', direction: 'outbound',
        customerId: req.customerId, leadId,
        content: req.templateRendered,
        carrierResponse: carrierCode,
        status: 'failed',
        sentAt: failedAt,
        createdByUid: req.invokedByUid ?? 'system:missedCallRecovery',
      });
      return;
    }
    // Unknown error class → transient
    const nextRetry = Number(req.retryCount ?? 0) + 1;
    if (nextRetry >= MAX_RETRIES) {
      const failedAt = Timestamp.now();
      tx.update({ path }, {
        status: 'failed', retryCount: nextRetry, failedAt,
        errorMessage: `unknown error after retries: ${msg}`,
      });
      addCommunicationEvent({
        type: _eventTypeForOutcome(kind, 'failed'),
        channel: 'sms', direction: 'outbound',
        customerId: req.customerId, leadId,
        content: req.templateRendered,
        carrierResponse: msg,
        status: 'failed',
        sentAt: failedAt,
        createdByUid: req.invokedByUid ?? 'system:missedCallRecovery',
      });
    } else {
      tx.update({ path }, { status: 'pending', retryCount: nextRetry });
    }
  }
}

export const drainOutboundSms = onSchedule(
  { schedule: 'every 1 minutes', timeoutSeconds: 540, memory: '512MiB' },
  async () => {
    const db = admin.firestore();
    const now = Timestamp.now();
    const startTs = Date.now();
    const bizSnap = await db.collection('businesses').get();
    let scanned = 0, sent = 0, failedCount = 0;
    for (const bizDoc of bizSnap.docs) {
      const businessId = bizDoc.id;
      const pendingSnap = await db.collection(`businesses/${businessId}/outboundSms`)
        .where('status', '==', 'pending')
        .where('sendAfterAt', '<=', now)
        .limit(BATCH_LIMIT)
        .get();
      for (const reqDoc of pendingSnap.docs) {
        scanned += 1;
        const target = { businessId, smsId: reqDoc.id };
        try {
          await db.runTransaction(async (tx) => {
            const events: Array<Record<string, unknown>> = [];
            const addEvent: EventSink = (e) => events.push(e);
            const adapter: TxLike = {
              get: async (ref) => {
                const s = await tx.get(db.doc(ref.path));
                return { exists: s.exists, data: () => s.data() ?? undefined };
              },
              update: (ref, patch) => tx.update(db.doc(ref.path), patch),
              set:    (ref, patch) => tx.set(db.doc(ref.path), patch, { merge: true }),
            };
            await _processOne(target, adapter, realSendSms, addEvent);
            for (const e of events) {
              const eventRef = db.collection(`businesses/${businessId}/communicationEvents`).doc();
              tx.set(eventRef, { id: eventRef.id, ...e });
            }
            if (events.find(e => String(e.type).endsWith('_sent')))   sent += 1;
            if (events.find(e => String(e.type).endsWith('_failed'))) failedCount += 1;
          });
        } catch (err) {
          console.error('[drainOutboundSms] tx failed', { target, err: (err as Error).message });
        }
      }
    }
    console.info('[drainOutboundSms] done', {
      scanned, sent, failed: failedCount, durationMs: Date.now() - startTs,
    });
  },
);

export const __testHooks = {
  processOne: _processOne,
  isSendAfterPast: _isSendAfterPast,
  eventTypeForOutcome: _eventTypeForOutcome,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx tests/drainOutboundSms.test.ts`
Expected: every check ✓, exit 0, `── X passed, 0 failed ──`.

- [ ] **Step 5: Functions build**

Run: `cd functions && npm run build && cd ..`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add functions/src/drainOutboundSms.ts tests/drainOutboundSms.test.ts
git commit -m "$(cat <<'EOF'
feat(drainer): drainOutboundSms scheduled poller (SP4B task 7)

Sibling of SP4A drainReviewRequests for the new outboundSms queue.
onSchedule('every 1 minutes'). Same 7 outcome paths.

Key SP4B difference: on success for kind=missed_call_response, also
flips parent lead.autoTextSent + autoTextSentAt + outboundSmsId so
the UI renders the sent state without a join.

Event types discriminate by kind:
  - missed_call_response → missed_call_auto_text_{sent,failed}
  - manual_lead_reply    → outbound_sms_{sent,failed}

Reuses SP4A's twilioClient.sendSms + TWILIO_NOT_CONFIGURED sentinel.
Race-safe via transactional pending→sending flip.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: sendTestMissedCall + sendManualOutboundSms callables + tests

Two HTTPS callables. Both write into the shared `outboundSms` queue + a Lead (test only). Both owner+admin gated.

- `sendTestMissedCall`: synthesizes a fake Lead with id `lead-test-{uid}-{ms}` + outboundSms with `isTest: true`. Lets the operator exercise the end-to-end flow without dialing.
- `sendManualOutboundSms`: enqueues an ad-hoc operator-typed SMS from the LeadDetailSheet composer. `kind: 'manual_lead_reply'`, `isManual: true`, doc id `sms-manual-{leadId}-{ms}`.

**Files:**
- Create: `functions/src/sendTestMissedCall.ts`
- Create: `functions/src/sendManualOutboundSms.ts`
- Test: `tests/missedCallCallables.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/missedCallCallables.test.ts`:

```ts
// ═══════════════════════════════════════════════════════════════════
//  tests/missedCallCallables.test.ts
//  Run: npx tsx tests/missedCallCallables.test.ts
//
//  Exercises buildPatch helpers for both SP4B callables. Pure logic,
//  no Firestore. The full callables' auth + Firestore path is tested
//  in the emulator smoke (Task 17).
// ═══════════════════════════════════════════════════════════════════

import { __testHooks as testHooks } from '../functions/src/sendTestMissedCall';
import { __testHooks as manualHooks } from '../functions/src/sendManualOutboundSms';

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else      { failed++; console.error(`  ✗ ${name}${detail ? `  — ${detail}` : ''}`); }
}

console.log('\n── sendTestMissedCall.buildLeadAndSms — happy ──');
{
  const out = testHooks.buildLeadAndSms({
    uid: 'uid-owner',
    settings: {
      missedCallTemplate: 'Hi, thanks for contacting {businessName}.',
      businessName: 'Wheel Rush',
    },
    phoneE164: '+13055551234',
  });
  check('lead id starts with lead-test-', /^lead-test-uid-owner-\d+$/.test(out.leadId));
  check('lead has source missed_call', out.lead.source === 'missed_call');
  check('lead status New', out.lead.status === 'New');
  check('lead wasNewCustomer false (test path matches caller)', out.lead.wasNewCustomer === false);
  check('lead callStatus no-answer', out.lead.callStatus === 'no-answer');
  check('lead phoneE164 matches input', out.lead.phoneE164 === '+13055551234');
  check('outboundSms id is sms-{leadId}', out.outboundSms.id === `sms-${out.leadId}`);
  check('outboundSms isTest=true', out.outboundSms.isTest === true);
  check('outboundSms templateRendered contains businessName',
    out.outboundSms.templateRendered.includes('Wheel Rush'));
  check('outboundSms status pending', out.outboundSms.status === 'pending');
}

console.log('\n── sendTestMissedCall — refuses without twilioPhoneNumber set ──');
{
  let threw = false;
  try {
    testHooks.buildLeadAndSms({
      uid: 'uid-owner',
      settings: { missedCallTemplate: 'Hi {businessName}.', businessName: 'X' },
      phoneE164: '',
    });
  } catch { threw = true; }
  check('buildLeadAndSms refuses empty phoneE164', threw);
}

console.log('\n── sendManualOutboundSms.buildPatch — happy ──');
{
  const out = manualHooks.buildPatch({
    leadId: 'lead-3055551234-2026-06-04',
    customerId: 'p_13055551234',
    phoneE164: '+13055551234',
    body: 'Hi Maria — got your message, calling back in 5min.',
    uid: 'uid-operator',
  });
  check('kind is manual_lead_reply', out.kind === 'manual_lead_reply');
  check('isManual=true', out.isManual === true);
  check('isTest is undefined/false', !out.isTest);
  check('templateUsed echoes body', out.templateUsed === 'Hi Maria — got your message, calling back in 5min.');
  check('templateRendered equals templateUsed (no substitutions for manual)',
    out.templateRendered === 'Hi Maria — got your message, calling back in 5min.');
  check('leadId carried', out.leadId === 'lead-3055551234-2026-06-04');
  check('customerId carried', out.customerId === 'p_13055551234');
  check('phoneE164 carried', out.phoneE164 === '+13055551234');
  check('status pending', out.status === 'pending');
  check('invokedByUid carries caller uid', out.invokedByUid === 'uid-operator');
}

console.log('\n── sendManualOutboundSms — refuses empty body ──');
{
  let threw = false;
  try {
    manualHooks.buildPatch({
      leadId: 'lead-3055551234-2026-06-04',
      customerId: 'p_13055551234',
      phoneE164: '+13055551234',
      body: '   ',
      uid: 'uid-operator',
    });
  } catch { threw = true; }
  check('buildPatch refuses whitespace-only body', threw);
}

console.log('\n── sendManualOutboundSms — refuses empty phoneE164 ──');
{
  let threw = false;
  try {
    manualHooks.buildPatch({
      leadId: 'lead-3055551234-2026-06-04',
      customerId: 'p_13055551234',
      phoneE164: '',
      body: 'Hi.',
      uid: 'uid-operator',
    });
  } catch { threw = true; }
  check('buildPatch refuses empty phoneE164', threw);
}

console.log('\n── computeManualSmsId pattern ──');
{
  const id = manualHooks.computeSmsId('lead-3055551234-2026-06-04', 1717480000000);
  check('matches sms-manual-{leadId}-{ms}',
    id === 'sms-manual-lead-3055551234-2026-06-04-1717480000000');
}

console.log(`\n── ${passed} passed, ${failed} failed ──\n`);
process.exit(failed > 0 ? 1 : 0);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx tests/missedCallCallables.test.ts`
Expected: module-not-found on `../functions/src/sendTestMissedCall`.

- [ ] **Step 3: Write `sendTestMissedCall`**

Create `functions/src/sendTestMissedCall.ts`:

```ts
// functions/src/sendTestMissedCall.ts
// ═══════════════════════════════════════════════════════════════════
//  sendTestMissedCall — SP4B HTTPS callable.
//
//  Spec: docs/superpowers/specs/2026-06-04-sp4b-missed-call-recovery-design.md
//        §"7. Send Test Missed Call"
//
//  Synthesizes a fake Lead + outboundSms so the operator can exercise
//  the end-to-end flow without dialing their Twilio number. Lead id
//  is `lead-test-{uid}-{ms}` so:
//    - it doesn't collide with real missed-call leads
//    - leadPriority sorts it to the bottom of the queue
//    - the LeadCard renders a TEST badge
//
//  Owner+admin gated.
// ═══════════════════════════════════════════════════════════════════

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import { renderTemplate } from './lib/reviewTemplate';
void admin;

interface Input {
  businessId: string;
  phoneE164: string;             // operator's own number for the test
}

interface SettingsLite {
  missedCallTemplate?: string;
  businessName?: string;
  twilioPhoneNumber?: string;
}

interface BuildArgs {
  uid: string;
  settings: SettingsLite;
  phoneE164: string;
}

interface BuildResult {
  leadId: string;
  lead: {
    id: string;
    customerId: string;
    phoneE164: string;
    source: 'missed_call';
    status: 'New';
    wasNewCustomer: boolean;
    callSid: string;
    callStatus: 'no-answer';
    autoTextSent: false;
    lastEditedByUid: 'system:missedCallRecovery:test';
  };
  outboundSms: {
    id: string;
    kind: 'missed_call_response';
    leadId: string;
    customerId: string;
    phoneE164: string;
    templateUsed: string;
    templateRendered: string;
    status: 'pending';
    retryCount: 0;
    isTest: true;
    invokedByUid: string;
  };
}

function _buildLeadAndSms(args: BuildArgs): BuildResult {
  if (!args.phoneE164?.trim()) throw new Error('phoneE164 required');
  const template = args.settings.missedCallTemplate?.trim()
    || 'Hi, thanks for contacting {businessName}.';
  const templateRendered = renderTemplate(template, {
    firstName: '',
    lastName: '',
    businessName: args.settings.businessName?.trim() ?? '',
    serviceType: '', city: '', vehicle: '', reviewLink: '',
  });

  const ms = Date.now();
  const leadId = `lead-test-${args.uid}-${ms}`;
  // The test path uses a synthetic customer id that won't collide
  // with real customer lookups. The customer enrichment panel will
  // show "Test Lead" when it can't resolve this id.
  const customerId = `cust-test-${args.uid}`;

  return {
    leadId,
    lead: {
      id: leadId,
      customerId,
      phoneE164: args.phoneE164.trim(),
      source: 'missed_call',
      status: 'New',
      wasNewCustomer: false,
      callSid: `CA_test_${ms}`,
      callStatus: 'no-answer',
      autoTextSent: false,
      lastEditedByUid: 'system:missedCallRecovery:test',
    },
    outboundSms: {
      id: `sms-${leadId}`,
      kind: 'missed_call_response',
      leadId,
      customerId,
      phoneE164: args.phoneE164.trim(),
      templateUsed: template,
      templateRendered,
      status: 'pending',
      retryCount: 0,
      isTest: true,
      invokedByUid: args.uid,
    },
  };
}

export const sendTestMissedCall = onCall<Input, Promise<{ leadId: string }>>(
  async (req) => {
    const uid = req.auth?.uid;
    const { businessId, phoneE164 } = req.data ?? { businessId: '', phoneE164: '' };
    if (!uid)        throw new HttpsError('unauthenticated', 'sign-in required');
    if (!businessId) throw new HttpsError('invalid-argument', 'businessId required');
    if (!phoneE164?.trim()) {
      throw new HttpsError('invalid-argument', 'phoneE164 required');
    }

    const db = admin.firestore();
    const memberSnap = await db.doc(`businesses/${businessId}/members/${uid}`).get();
    const role = memberSnap.data()?.role;
    if (role !== 'owner' && role !== 'admin') {
      throw new HttpsError('permission-denied', 'owner or admin only');
    }

    const settingsSnap = await db.doc(`businesses/${businessId}/settings/main`).get();
    if (!settingsSnap.exists) {
      throw new HttpsError('failed-precondition', 'settings missing');
    }
    const settings = settingsSnap.data() as SettingsLite;
    if (!settings.twilioPhoneNumber?.trim()) {
      throw new HttpsError('failed-precondition', 'set Twilio number in Settings first');
    }

    let build: BuildResult;
    try {
      build = _buildLeadAndSms({ uid, settings, phoneE164: phoneE164.trim() });
    } catch (err) {
      throw new HttpsError('invalid-argument', (err as Error).message);
    }

    const now = Timestamp.now();
    const leadRef = db.doc(`businesses/${businessId}/leads/${build.leadId}`);
    const smsRef  = db.doc(`businesses/${businessId}/outboundSms/${build.outboundSms.id}`);

    await db.runTransaction(async (tx) => {
      tx.set(leadRef, {
        ...build.lead,
        receivedAt: now,
        createdAt: now,
        updatedAt: now,
      });
      tx.set(smsRef, {
        ...build.outboundSms,
        sendAfterAt: now,
        createdAt: now,
      });
    });

    return { leadId: build.leadId };
  },
);

export const __testHooks = {
  buildLeadAndSms: _buildLeadAndSms,
};
```

- [ ] **Step 4: Write `sendManualOutboundSms`**

Create `functions/src/sendManualOutboundSms.ts`:

```ts
// functions/src/sendManualOutboundSms.ts
// ═══════════════════════════════════════════════════════════════════
//  sendManualOutboundSms — SP4B HTTPS callable.
//
//  Spec: docs/superpowers/specs/2026-06-04-sp4b-missed-call-recovery-design.md
//        §"Composer at the bottom" (LeadDetailSheet section)
//
//  Operator types an ad-hoc SMS from the LeadDetailSheet composer
//  and fires it through the drainer. Doc id `sms-manual-{leadId}-{ms}`
//  so multiple sends to the same Lead stay distinct.
//
//  Owner+admin gated. Validates the parent Lead exists.
// ═══════════════════════════════════════════════════════════════════

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
void admin;

interface Input {
  businessId: string;
  leadId: string;
  body: string;
}

interface BuildArgs {
  leadId: string;
  customerId: string;
  phoneE164: string;
  body: string;
  uid: string;
}

function _buildPatch(args: BuildArgs): Record<string, unknown> {
  if (!args.phoneE164?.trim()) throw new Error('phoneE164 required');
  if (!args.body?.trim())      throw new Error('body required');
  return {
    kind: 'manual_lead_reply',
    leadId: args.leadId,
    customerId: args.customerId,
    phoneE164: args.phoneE164.trim(),
    templateUsed: args.body.trim(),
    templateRendered: args.body.trim(),
    status: 'pending',
    retryCount: 0,
    isManual: true,
    invokedByUid: args.uid,
  };
}

function _computeSmsId(leadId: string, epochMs: number): string {
  return `sms-manual-${leadId}-${epochMs}`;
}

export const sendManualOutboundSms = onCall<Input, Promise<{ smsId: string }>>(
  async (req) => {
    const uid = req.auth?.uid;
    const { businessId, leadId, body } = req.data ?? { businessId: '', leadId: '', body: '' };
    if (!uid)        throw new HttpsError('unauthenticated', 'sign-in required');
    if (!businessId) throw new HttpsError('invalid-argument', 'businessId required');
    if (!leadId)     throw new HttpsError('invalid-argument', 'leadId required');
    if (!body?.trim()) throw new HttpsError('invalid-argument', 'body required');

    const db = admin.firestore();
    const memberSnap = await db.doc(`businesses/${businessId}/members/${uid}`).get();
    const role = memberSnap.data()?.role;
    if (role !== 'owner' && role !== 'admin') {
      throw new HttpsError('permission-denied', 'owner or admin only');
    }

    const leadSnap = await db.doc(`businesses/${businessId}/leads/${leadId}`).get();
    if (!leadSnap.exists) {
      throw new HttpsError('not-found', 'lead not found');
    }
    const lead = leadSnap.data() ?? {};
    if (!lead.phoneE164 || !lead.customerId) {
      throw new HttpsError('failed-precondition', 'lead missing phoneE164 or customerId');
    }

    const settingsSnap = await db.doc(`businesses/${businessId}/settings/main`).get();
    const settings = settingsSnap.data() ?? {};
    if (!settings.twilioPhoneNumber?.trim()) {
      throw new HttpsError('failed-precondition', 'set Twilio number in Settings first');
    }

    let patch: Record<string, unknown>;
    try {
      patch = _buildPatch({
        leadId,
        customerId: String(lead.customerId),
        phoneE164: String(lead.phoneE164),
        body,
        uid,
      });
    } catch (err) {
      throw new HttpsError('invalid-argument', (err as Error).message);
    }

    const ms = Date.now();
    const smsId = _computeSmsId(leadId, ms);
    const now = Timestamp.now();
    await db.doc(`businesses/${businessId}/outboundSms/${smsId}`).set({
      id: smsId,
      ...patch,
      sendAfterAt: now,
      createdAt: now,
    });

    return { smsId };
  },
);

export const __testHooks = {
  buildPatch: _buildPatch,
  computeSmsId: _computeSmsId,
};
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx tsx tests/missedCallCallables.test.ts`
Expected: every check ✓, exit 0.

- [ ] **Step 6: Functions build**

Run: `cd functions && npm run build && cd ..`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add functions/src/sendTestMissedCall.ts functions/src/sendManualOutboundSms.ts tests/missedCallCallables.test.ts
git commit -m "$(cat <<'EOF'
feat(callables): sendTestMissedCall + sendManualOutboundSms (SP4B task 8)

Two SP4B HTTPS callables:

- sendTestMissedCall: synthesizes a Lead with id `lead-test-{uid}-{ms}`
  + outboundSms with isTest=true. Lets operator exercise end-to-end
  flow without dialing. leadPriority short-circuits these to score -1
  so test traffic sorts to the bottom of the queue.

- sendManualOutboundSms: operator-typed ad-hoc SMS from LeadDetailSheet
  composer. kind=manual_lead_reply, isManual=true. Doc id
  `sms-manual-{leadId}-{ms}` so multiple sends stay distinct.

Both owner+admin gated. Both require settings.twilioPhoneNumber.
Manual callable validates the parent Lead exists.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: functions/src/index.ts exports

Wire the 4 new functions into the deployable barrel.

**Files:**
- Modify: `functions/src/index.ts`

- [ ] **Step 1: Add the exports**

Open `functions/src/index.ts`. Find the SP4A export block (search for `sendManualReviewRequest`). It ends with a 4-function block. Add an SP4B block immediately after it (before the file's last comment / before EOF):

```ts

// SP4B: missed-call recovery. Four functions:
//   - twilioVoiceStatus       Public HTTPS webhook; Twilio Console
//                             points its Voice Status Callback URL here.
//   - drainOutboundSms        Scheduled every 1 minute; sibling of
//                             drainReviewRequests for the outboundSms
//                             queue.
//   - sendTestMissedCall      HTTPS callable; admin "Fire Test
//                             Missed Call" button writes a synthetic
//                             Lead + outboundSms (isTest=true).
//   - sendManualOutboundSms   HTTPS callable; LeadDetailSheet composer
//                             ad-hoc operator SMS sends.
export { twilioVoiceStatus }     from './twilioVoiceStatus';
export { drainOutboundSms }      from './drainOutboundSms';
export { sendTestMissedCall }    from './sendTestMissedCall';
export { sendManualOutboundSms } from './sendManualOutboundSms';
```

- [ ] **Step 2: Build**

Run: `cd functions && npm run build && cd ..`
Expected: exit 0.

- [ ] **Step 3: Verify the exports resolve**

Run: `node -e "const m = require('./functions/lib/index.js'); console.log(Object.keys(m).filter(k => /VoiceStatus|MissedCall|drainOutboundSms|sendManualOutboundSms/.test(k)).sort().join(','))"`
Expected: `drainOutboundSms,sendManualOutboundSms,sendTestMissedCall,twilioVoiceStatus`.

- [ ] **Step 4: Commit**

```bash
git add functions/src/index.ts
git commit -m "$(cat <<'EOF'
feat(functions): export 4 SP4B functions (SP4B task 9)

Wires twilioVoiceStatus + drainOutboundSms + sendTestMissedCall +
sendManualOutboundSms into the deployable barrel.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: MissedCallRecoverySection Settings accordion

Sibling of `ReviewAutomationSection`. 8 sub-sections (toggle, warning banner, Twilio# input, Twilio# SID input, template editor, preview, send-test button, recent leads). The implementer should compare with `src/components/settings/ReviewAutomationSection.tsx` (SP4A) for the canonical accordion shape — this task mirrors that pattern with SP4B-specific bindings.

**Files:**
- Create: `src/components/settings/MissedCallRecoverySection.tsx`

- [ ] **Step 1: Write the section**

Create `src/components/settings/MissedCallRecoverySection.tsx`:

```tsx
// src/components/settings/MissedCallRecoverySection.tsx
// ═══════════════════════════════════════════════════════════════════
//  MissedCallRecoverySection — SP4B operator surface.
//
//  Spec: docs/superpowers/specs/2026-06-04-sp4b-missed-call-recovery-design.md
//        §"Settings → Missed Call Recovery accordion"
//
//  Eight sub-sections, mirrors SP4A ReviewAutomationSection.tsx shape:
//    1. Enable toggle (missedCallAutoTextEnabled)
//    2. Warning banner when toggle ON + twilioPhoneNumber empty
//    3. Twilio Phone Number input (E.164 validated on blur)
//    4. Twilio Phone Number SID input (optional debug field)
//    5. Template editor + 7-variable legend
//    6. Live preview pane (renders with unknown-caller fallback)
//    7. Send Test Missed Call (owner+admin only)
//    8. Recent leads list (last 5; tap → LeadDetailSheet)
// ═══════════════════════════════════════════════════════════════════

import { memo, useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import {
  collection, limit, onSnapshot, orderBy, query, where,
  type Firestore,
} from 'firebase/firestore';
import { getFunctions, httpsCallable, connectFunctionsEmulator } from 'firebase/functions';
import { _db } from '@/lib/firebase';
import { AccordionShell } from '@/components/settings/AccordionShell';
import { renderTemplate } from '@/lib/reviewTemplate';
import { DEFAULT_MISSED_CALL_TEMPLATE } from '@/lib/defaults';
import { usePermissions, useMembership } from '@/context/MembershipContext';
import type { Lead, Settings } from '@/types';

interface Props {
  businessId: string;
  settings: Settings;
  open: boolean;
  onToggle: () => void;
  onSaveSettings: (patch: Partial<Settings>) => Promise<void>;
  onOpenLead?: (leadId: string) => void;     // optional callback into LeadDetailSheet host
}

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

function isValidE164(v: string): boolean {
  return /^\+[1-9]\d{6,14}$/.test(v.trim());
}

function MissedCallRecoverySectionImpl({
  businessId, settings, open, onToggle, onSaveSettings, onOpenLead,
}: Props): JSX.Element {
  const perms = usePermissions();
  const { role } = useMembership();
  const canEdit = perms.canEditBusinessSettings ?? false;
  const isOwnerOrAdmin = role === 'owner' || role === 'admin';

  const enabled  = settings.missedCallAutoTextEnabled ?? false;
  const template = settings.missedCallTemplate ?? DEFAULT_MISSED_CALL_TEMPLATE;
  const phone    = settings.twilioPhoneNumber ?? '';
  const phoneSid = settings.twilioPhoneNumberSid ?? '';
  const businessName = settings.businessName ?? '';

  // Local-only state for save-on-blur inputs
  const [phoneLocal,    setPhoneLocal]    = useState(phone);
  const [phoneSidLocal, setPhoneSidLocal] = useState(phoneSid);
  const [templateLocal, setTemplateLocal] = useState(template);
  const [testPhone,     setTestPhone]     = useState('');
  const [testStatus,    setTestStatus]    = useState<string | null>(null);
  const [testError,     setTestError]     = useState<string | null>(null);
  const [testInFlight,  setTestInFlight]  = useState(false);

  useEffect(() => { setPhoneLocal(phone); }, [phone]);
  useEffect(() => { setPhoneSidLocal(phoneSid); }, [phoneSid]);
  useEffect(() => { setTemplateLocal(template); }, [template]);

  // Recent leads — last 5 by receivedAt desc
  const [recentLeads, setRecentLeads] = useState<Lead[]>([]);
  useEffect(() => {
    if (!businessId || !open) return;
    const q = query(
      collection(_db as Firestore, 'businesses', businessId, 'leads'),
      orderBy('receivedAt', 'desc'),
      limit(5),
    );
    const unsub = onSnapshot(q, (snap) => {
      const next: Lead[] = [];
      snap.forEach(d => next.push({ id: d.id, ...d.data() } as Lead));
      setRecentLeads(next);
    });
    return () => unsub();
  }, [businessId, open]);

  // Live preview body — renders with unknown-caller fallback (firstName empty)
  const previewBody = useMemo(() => renderTemplate(templateLocal || DEFAULT_MISSED_CALL_TEMPLATE, {
    firstName: '', lastName: '',
    businessName, serviceType: '', city: '', vehicle: '', reviewLink: '',
  }), [templateLocal, businessName]);

  // Handlers
  const onToggleEnable = useCallback(async () => {
    if (!canEdit) return;
    await onSaveSettings({ missedCallAutoTextEnabled: !enabled } as Partial<Settings>);
  }, [canEdit, enabled, onSaveSettings]);

  const onBlurPhone = useCallback(async () => {
    if (!canEdit) return;
    const trimmed = phoneLocal.trim();
    if (trimmed === phone) return;
    if (trimmed && !isValidE164(trimmed)) {
      setPhoneLocal(phone);
      return;
    }
    await onSaveSettings({ twilioPhoneNumber: trimmed } as Partial<Settings>);
  }, [canEdit, phoneLocal, phone, onSaveSettings]);

  const onBlurPhoneSid = useCallback(async () => {
    if (!canEdit) return;
    const trimmed = phoneSidLocal.trim();
    if (trimmed === phoneSid) return;
    await onSaveSettings({ twilioPhoneNumberSid: trimmed } as Partial<Settings>);
  }, [canEdit, phoneSidLocal, phoneSid, onSaveSettings]);

  const onBlurTemplate = useCallback(async () => {
    if (!canEdit) return;
    if (templateLocal === template) return;
    await onSaveSettings({ missedCallTemplate: templateLocal } as Partial<Settings>);
  }, [canEdit, templateLocal, template, onSaveSettings]);

  const onFireTest = useCallback(async () => {
    setTestError(null);
    setTestStatus(null);
    setTestInFlight(true);
    try {
      const fn = httpsCallable<
        { businessId: string; phoneE164: string },
        { leadId: string }
      >(_getEmulatorAwareFunctions(), 'sendTestMissedCall');
      const { data } = await fn({ businessId, phoneE164: testPhone });
      setTestStatus(`Test lead created (${data.leadId}). ${settings.twilioConnected ? 'Drainer will send within 1 min.' : 'Twilio not connected — auto-text stays pending.'}`);
    } catch (err) {
      setTestError(err instanceof Error ? err.message : String(err));
    } finally {
      setTestInFlight(false);
    }
  }, [businessId, testPhone, settings.twilioConnected]);

  const showWarning = enabled && !phone.trim();

  return (
    <AccordionShell
      title="Missed Call Recovery"
      icon="📞"
      summary={enabled ? (phone ? `On · ${phone}` : 'On · no number set') : 'Off'}
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
          <span style={{ fontWeight: 500 }}>Enable Missed Call Recovery</span>
        </label>
        <p style={{ ...helpStyle, marginLeft: 24 }}>
          When ON, missed calls auto-create a Lead and send an acknowledgment SMS to the caller.
        </p>
      </div>

      {/* 2. Warning banner */}
      {showWarning && (
        <div style={warningBanner}>
          ⚠ Set your Twilio number below to enable missed-call recovery. Without it, no calls can be routed.
        </div>
      )}

      {/* 3. Twilio Phone Number */}
      <div className="field" style={{ marginBottom: 12 }}>
        <label style={labelStyle}>Twilio Phone Number</label>
        <input
          type="tel"
          value={phoneLocal}
          onChange={(e) => setPhoneLocal(e.target.value)}
          onBlur={onBlurPhone}
          placeholder="+13055551234"
          disabled={!canEdit}
          style={inputStyle}
        />
        <p style={helpStyle}>
          Enter the Twilio number your customers call. In Twilio Console → Phone Numbers → [Number] → Voice & Fax, set the <strong>Status Callback URL</strong> to your deployed twilioVoiceStatus URL.
        </p>
      </div>

      {/* 4. Twilio Phone Number SID */}
      <div className="field" style={{ marginBottom: 12 }}>
        <label style={labelStyle}>Twilio Phone Number SID (optional)</label>
        <input
          type="text"
          value={phoneSidLocal}
          onChange={(e) => setPhoneSidLocal(e.target.value)}
          onBlur={onBlurPhoneSid}
          placeholder="PNxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
          disabled={!canEdit}
          style={inputStyle}
        />
        <p style={helpStyle}>For your reference only. Not used by the webhook.</p>
      </div>

      {/* 5. Template editor */}
      <div className="field" style={{ marginBottom: 12 }}>
        <label style={labelStyle}>Auto-text Template</label>
        <textarea
          value={templateLocal}
          onChange={(e) => setTemplateLocal(e.target.value)}
          onBlur={onBlurTemplate}
          rows={6}
          disabled={!canEdit}
          style={{ ...inputStyle, minHeight: 120, fontFamily: 'inherit' }}
        />
        <p style={helpStyle}>
          Available: <code>{'{firstName}'}</code> · <code>{'{lastName}'}</code> · <code>{'{businessName}'}</code>
          {' · '}<code>{'{serviceType}'}</code> · <code>{'{city}'}</code> · <code>{'{vehicle}'}</code>
          {' · '}<code>{'{reviewLink}'}</code>
        </p>
      </div>

      {/* 6. Preview */}
      <div className="field" style={{ marginBottom: 12 }}>
        <label style={labelStyle}>Live preview (unknown caller)</label>
        <div style={previewBox}>{previewBody}</div>
      </div>

      {/* 7. Send Test Missed Call */}
      {isOwnerOrAdmin && (
        <div className="field" style={{ marginBottom: 12, paddingTop: 10, borderTop: '1px solid var(--border, #2a2a2a)' }}>
          <label style={labelStyle}>Send Test Missed Call</label>
          <input
            type="tel"
            value={testPhone}
            onChange={(e) => setTestPhone(e.target.value)}
            placeholder="+13055551234"
            style={inputStyle}
          />
          <button
            type="button"
            className="btn sm primary"
            disabled={testInFlight || !testPhone.trim()}
            onClick={onFireTest}
            style={{ marginTop: 6 }}
          >
            {testInFlight ? 'Firing…' : 'Fire Test Missed Call'}
          </button>
          {testStatus && <p style={{ ...helpStyle, color: 'var(--ok, #4ade80)', marginTop: 6 }}>{testStatus}</p>}
          {testError  && <p style={{ ...helpStyle, color: 'var(--danger, #f87171)', marginTop: 6 }}>Error: {testError}</p>}
        </div>
      )}

      {/* 8. Recent Leads */}
      <div className="field" style={{ marginTop: 12 }}>
        <label style={labelStyle}>Recent Leads</label>
        {recentLeads.length === 0 && (
          <p style={helpStyle}>No leads yet.</p>
        )}
        {recentLeads.map(l => {
          const isTest = l.id.startsWith('lead-test-');
          return (
            <button
              key={l.id}
              type="button"
              onClick={() => onOpenLead?.(l.id)}
              style={leadRow}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <strong style={{ fontSize: 13 }}>{l.phoneE164}</strong>
                <span style={statusPill(l.status)}>{l.status}</span>
                {isTest && <span style={testBadge}>TEST</span>}
                {l.wasNewCustomer && <span style={newCustomerBadge}>NEW</span>}
              </div>
              <span style={{ fontSize: 11, color: 'var(--t3)' }}>
                {formatTs((l as unknown as { receivedAt?: { toMillis?: () => number } }).receivedAt)}
              </span>
            </button>
          );
        })}
      </div>
    </AccordionShell>
  );
}

function statusPill(status: string): CSSProperties {
  const colorMap: Record<string, string> = {
    New: '#3b82f6', Contacted: '#f59e0b', Quoted: '#a78bfa',
    Booked: '#4ade80', Closed: '#6b7280', Lost: '#f87171',
  };
  return {
    fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 99,
    color: '#fff', background: colorMap[status] ?? '#666',
    textTransform: 'uppercase', letterSpacing: '0.4px',
  };
}
function formatTs(ts: { toMillis?: () => number } | undefined): string {
  if (!ts || typeof ts.toMillis !== 'function') return '—';
  return new Date(ts.toMillis()).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
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
const leadRow: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8,
  width: '100%', padding: '6px 8px', marginBottom: 4,
  background: 'var(--s2, #1f1f1f)', color: 'var(--t1)',
  border: '1px solid var(--border, #333)', borderRadius: 6,
  cursor: 'pointer', textAlign: 'left',
};
const testBadge: CSSProperties = {
  fontSize: 9, fontWeight: 800, padding: '1px 5px', borderRadius: 99,
  background: '#facc15', color: '#1a1a1a',
  textTransform: 'uppercase', letterSpacing: '0.5px',
};
const newCustomerBadge: CSSProperties = {
  fontSize: 9, fontWeight: 800, padding: '1px 5px', borderRadius: 99,
  background: '#fb923c', color: '#1a1a1a',
  textTransform: 'uppercase', letterSpacing: '0.5px',
};

export const MissedCallRecoverySection = memo(MissedCallRecoverySectionImpl);
```

- [ ] **Step 2: Type-check**

Run: `npm run lint`
Expected: exit 0.

If TS complains about `settings.twilioConnected` (SP3 field) — that's fine, it exists. If TS complains about the Lead type's `receivedAt` shape, the type union includes a Firestore Timestamp and our access through a generic cast is correct.

- [ ] **Step 3: Commit**

```bash
git add src/components/settings/MissedCallRecoverySection.tsx
git commit -m "$(cat <<'EOF'
feat(settings): MissedCallRecoverySection accordion (SP4B task 10)

Eight sub-sections wired:
  1. Enable toggle (missedCallAutoTextEnabled)
  2. Warning banner when toggle ON + twilioPhoneNumber empty
  3. Twilio Phone Number E.164 input (validated on blur)
  4. Twilio Phone Number SID (optional debug)
  5. Auto-text template editor with 7-variable legend
  6. Live preview (unknown-caller fallback render)
  7. Send Test Missed Call admin button (owner+admin)
  8. Recent Leads list (last 5; tap → LeadDetailSheet via onOpenLead)

Matches SP4A ReviewAutomationSection shape — same _getEmulatorAwareFunctions
pattern, same save-on-blur idiom, same testPhone-defaults-to-empty
workaround for the Member-shape-lacks-phoneE164 quirk discovered in
SP4A Task 11.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Settings.tsx wire-in

Insert the new accordion between Review Automation and Owners. Threading the `onOpenLead` callback is deferred — LeadDetailSheet host wiring lands in Task 14.

**Files:**
- Modify: `src/pages/Settings.tsx`

- [ ] **Step 1: Add the import**

Open `src/pages/Settings.tsx`. After the `ReviewAutomationSection` import (added in SP4A Task 12), add:

```ts
import { MissedCallRecoverySection } from '@/components/settings/MissedCallRecoverySection';
```

- [ ] **Step 2: Add the render block**

Find the existing `ReviewAutomationSection` render block. Immediately after its closing `)}`, insert:

```tsx
      {/* SP4B: Missed Call Recovery — Twilio Voice Status webhook +
          auto-text + Lead queue. Ships OFF (operator opts in). Drainer
          runs every 1min and is dormant when Twilio env secrets unset. */}
      {canSeeBusinessSettings && businessId && (
        <MissedCallRecoverySection
          businessId={businessId}
          settings={settings}
          open={openSection === 'missedCallRecovery'}
          onToggle={() => setOpenSection(openSection === 'missedCallRecovery' ? null : 'missedCallRecovery')}
          onSaveSettings={onSave}
        />
      )}
```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: tsc + vite finish; bundle includes the new section.

- [ ] **Step 4: Commit**

```bash
git add src/pages/Settings.tsx
git commit -m "$(cat <<'EOF'
feat(settings): wire MissedCallRecoverySection accordion (SP4B task 11)

Mutex key 'missedCallRecovery'. Renders between Review Automation
and Owners & Permissions. Same gating as adjacent sections
(canSeeBusinessSettings + businessId resolved). onOpenLead callback
threading lands in Task 14 once LeadDetailSheet host is wired.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: LeadCard component

Reusable card used by the Leads tab list AND by the CustomerProfile Recent Leads section. Renders customer name + phone + status pill + age + source icon + priority badges + last-comm preview + "New Customer" mini-badge.

**Files:**
- Create: `src/components/leads/LeadCard.tsx`

- [ ] **Step 1: Create the leads directory**

Run: `mkdir -p src/components/leads`
Expected: directory created (or already exists).

- [ ] **Step 2: Write the component**

Create `src/components/leads/LeadCard.tsx`:

```tsx
// src/components/leads/LeadCard.tsx
// ═══════════════════════════════════════════════════════════════════
//  LeadCard — list row for the Leads tab + CustomerProfile Recent
//  Leads section.
//
//  Spec: §"LeadCard" + §"Priority Score → Display"
//
//  Pure-presentational. Consumer subscribes to leads + customers and
//  passes the joined Customer doc as a prop. Computes priority badges
//  via leadPriority. Renders all applicable badges (max 3 visible,
//  rest collapse to +N).
// ═══════════════════════════════════════════════════════════════════

import { memo, type CSSProperties } from 'react';
import { formatPhoneForDisplay } from '@/lib/phone';
import { computeLeadPriority } from '@/lib/leadPriority';
import type { Customer } from '@/lib/customerEntity';
import type { Lead, LeadStatus } from '@/types';

interface Props {
  lead: Lead;
  customer: Customer | null;          // null when wasNewCustomer + race-on-create
  lastCommPreview?: string;           // last comm event content snippet
  onClick: () => void;
}

const STATUS_COLORS: Record<LeadStatus, string> = {
  New:       '#3b82f6',
  Contacted: '#f59e0b',
  Quoted:    '#a78bfa',
  Booked:    '#4ade80',
  Closed:    '#6b7280',
  Lost:      '#f87171',
};

const BADGE_COLORS: Record<string, { bg: string; fg: string }> = {
  vip:             { bg: '#b5a5e8', fg: '#1a1a1a' },   // Platinum purple
  fleet:           { bg: '#3b82f6', fg: '#fff'    },   // Fleet blue
  high_value:      { bg: '#d4af37', fg: '#1a1a1a' },   // Gold
  repeat_customer: { bg: '#22c55e', fg: '#fff'    },   // Repeat green
  new_lead:        { bg: '#fb923c', fg: '#1a1a1a' },   // New orange
};

const SOURCE_ICON: Record<string, string> = {
  missed_call: '📞',
  inbound_sms: '💬',
  manual:      '👤',
};

function _timeago(ts: { toMillis?: () => number } | undefined): string {
  if (!ts || typeof ts.toMillis !== 'function') return '—';
  const dt = Date.now() - ts.toMillis();
  if (dt < 60_000)            return 'just now';
  if (dt < 60 * 60_000)       return `${Math.floor(dt / 60_000)} min ago`;
  if (dt < 24 * 60 * 60_000)  return `${Math.floor(dt / (60 * 60_000))} hr ago`;
  return `${Math.floor(dt / (24 * 60 * 60_000))} d ago`;
}

function LeadCardImpl({ lead, customer, lastCommPreview, onClick }: Props): JSX.Element {
  const priority = computeLeadPriority(
    customer ? { vipTier: customer.vipTier, kind: customer.kind, jobCount: customer.jobCount } : null,
    lead,
  );
  const isTest = lead.id.startsWith('lead-test-');
  const displayName = customer?.name?.trim()
    || (lead.wasNewCustomer ? 'Unknown caller' : (lead.phoneE164 || 'Unknown'));
  const phoneFmt = lead.phoneE164 ? formatPhoneForDisplay(lead.phoneE164) : '';
  const visibleBadges = priority.badges.slice(0, 3);
  const overflowCount = Math.max(0, priority.badges.length - 3);
  const receivedAt = (lead as unknown as { receivedAt?: { toMillis?: () => number } }).receivedAt;

  return (
    <button type="button" onClick={onClick} style={cardRoot}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          {/* Row 1: name + status */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <strong style={{ fontSize: 14, color: 'var(--t1)' }}>{displayName}</strong>
            <span style={statusPill(lead.status)}>{lead.status}</span>
            {isTest && <span style={testBadge}>TEST</span>}
            {lead.wasNewCustomer && <span style={newCustomerBadge}>NEW</span>}
          </div>

          {/* Row 2: priority badges */}
          {visibleBadges.length > 0 && (
            <div style={{ display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
              {visibleBadges.map(b => (
                <span key={b.key} style={priorityBadge(b.key)}>{b.label}</span>
              ))}
              {overflowCount > 0 && (
                <span style={overflowBadge}>+{overflowCount}</span>
              )}
            </div>
          )}

          {/* Row 3: phone + age + source */}
          <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 4 }}>
            {SOURCE_ICON[lead.source] ?? ''} {phoneFmt} · {_timeago(receivedAt)}
          </div>

          {/* Row 4: last comm preview (if any) */}
          {lastCommPreview && (
            <div style={{ fontSize: 12, color: 'var(--t2)', marginTop: 4, fontStyle: 'italic',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              "{lastCommPreview}"
            </div>
          )}
        </div>
      </div>
    </button>
  );
}

function statusPill(status: LeadStatus): CSSProperties {
  return {
    fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 99,
    color: '#fff', background: STATUS_COLORS[status] ?? '#666',
    textTransform: 'uppercase', letterSpacing: '0.4px',
  };
}
function priorityBadge(key: string): CSSProperties {
  const c = BADGE_COLORS[key] ?? { bg: '#666', fg: '#fff' };
  return {
    fontSize: 9, fontWeight: 800, padding: '1px 5px', borderRadius: 99,
    background: c.bg, color: c.fg,
    textTransform: 'uppercase', letterSpacing: '0.5px',
  };
}

const cardRoot: CSSProperties = {
  display: 'block', width: '100%',
  padding: '10px 12px', marginBottom: 8,
  background: 'var(--s2, #1f1f1f)', color: 'var(--t1)',
  border: '1px solid var(--border, #333)', borderRadius: 8,
  cursor: 'pointer', textAlign: 'left',
};
const testBadge: CSSProperties = {
  fontSize: 9, fontWeight: 800, padding: '1px 5px', borderRadius: 99,
  background: '#facc15', color: '#1a1a1a',
  textTransform: 'uppercase', letterSpacing: '0.5px',
};
const newCustomerBadge: CSSProperties = {
  fontSize: 9, fontWeight: 800, padding: '1px 5px', borderRadius: 99,
  background: '#fb923c', color: '#1a1a1a',
  textTransform: 'uppercase', letterSpacing: '0.5px',
};
const overflowBadge: CSSProperties = {
  fontSize: 9, fontWeight: 800, padding: '1px 5px', borderRadius: 99,
  background: '#444', color: 'var(--t1)',
  letterSpacing: '0.5px',
};

export const LeadCard = memo(LeadCardImpl);
```

- [ ] **Step 3: Type-check**

Run: `npm run lint`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/components/leads/LeadCard.tsx
git commit -m "$(cat <<'EOF'
feat(leads): LeadCard with priority badges (SP4B task 12)

Reusable list row used by Leads tab AND CustomerProfile Recent Leads.
Renders customer name + status pill + priority badges (max 3 visible,
overflow collapses to +N) + source icon + phone + timeago + last-comm
preview + TEST/NEW mini-badges.

Pure-presentational. Consumer passes the joined Customer doc as a
prop. computeLeadPriority derives the badge set from existing SP3
Customer fields (vipTier, kind, jobCount) + lead.wasNewCustomer.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: CustomerEnrichmentPanel + LeadDetailSheet

The Wheel Rush enrichment block + the full Lead detail modal. Composes the enrichment panel + status section + SMS thread + composer + notes editor + audit footer.

**Files:**
- Create: `src/components/leads/CustomerEnrichmentPanel.tsx`
- Create: `src/components/leads/LeadDetailSheet.tsx`

- [ ] **Step 1: Write the enrichment panel**

Create `src/components/leads/CustomerEnrichmentPanel.tsx`:

```tsx
// src/components/leads/CustomerEnrichmentPanel.tsx
// ═══════════════════════════════════════════════════════════════════
//  CustomerEnrichmentPanel — Wheel Rush customer-context block.
//
//  Spec: docs/superpowers/specs/2026-06-04-sp4b-missed-call-recovery-design.md
//        §"LeadDetailSheet (Wheel Rush enrichment)" → §"Customer
//        Enrichment Panel"
//
//  Pulls live from Customer + Vehicle subcollection + Jobs subcollection.
//  Lifetime revenue computed at render time (NEVER persisted per SP3
//  privacy contract). Gated by canViewFinancials.
//
//  Shape: rendered inside LeadDetailSheet at the top. Read-only (no
//  edit actions — those live on the Customer profile).
// ═══════════════════════════════════════════════════════════════════

import { memo, useEffect, useMemo, useState, type CSSProperties } from 'react';
import {
  collection, doc, limit, onSnapshot, orderBy, query, where,
  type Firestore,
} from 'firebase/firestore';
import { _db } from '@/lib/firebase';
import { formatPhoneForDisplay } from '@/lib/phone';
import type { Customer, Vehicle } from '@/lib/customerEntity';
import type { Job } from '@/types';

interface Props {
  businessId: string;
  customerId: string;
  wasNewCustomer: boolean;
  canViewFinancials: boolean;
  onOpenCustomer?: (cid: string) => void;
}

function CustomerEnrichmentPanelImpl({
  businessId, customerId, wasNewCustomer, canViewFinancials, onOpenCustomer,
}: Props): JSX.Element {
  const [customer, setCustomer]   = useState<Customer | null>(null);
  const [vehicles, setVehicles]   = useState<Vehicle[]>([]);
  const [jobs, setJobs]           = useState<Job[]>([]);

  // Customer doc
  useEffect(() => {
    if (!businessId || !customerId) return;
    const ref = doc(_db as Firestore, 'businesses', businessId, 'customers', customerId);
    const unsub = onSnapshot(ref, (snap) => {
      setCustomer(snap.exists() ? ({ id: snap.id, ...snap.data() } as Customer) : null);
    });
    return () => unsub();
  }, [businessId, customerId]);

  // Vehicles for this customer (most recent first)
  useEffect(() => {
    if (!businessId || !customerId) return;
    const q = query(
      collection(_db as Firestore, 'businesses', businessId, 'customers', customerId, 'vehicles'),
      orderBy('lastServicedAt', 'desc'),
      limit(5),
    );
    const unsub = onSnapshot(q, (snap) => {
      const next: Vehicle[] = [];
      snap.forEach(d => next.push({ id: d.id, ...d.data() } as Vehicle));
      setVehicles(next);
    });
    return () => unsub();
  }, [businessId, customerId]);

  // Jobs for this customer (most recent first) — drives lifetime revenue + last service
  useEffect(() => {
    if (!businessId || !customerId) return;
    const q = query(
      collection(_db as Firestore, 'businesses', businessId, 'jobs'),
      where('customerId', '==', customerId),
      orderBy('date', 'desc'),
      limit(100),
    );
    const unsub = onSnapshot(q, (snap) => {
      const next: Job[] = [];
      snap.forEach(d => next.push({ id: d.id, ...d.data() } as unknown as Job));
      setJobs(next);
    });
    return () => unsub();
  }, [businessId, customerId]);

  // Live lifetime revenue compute — NEVER persisted (SP3 privacy contract)
  const lifetimeRevenue = useMemo(() => {
    let sum = 0;
    for (const j of jobs) {
      const r = typeof j.revenue === 'number' ? j.revenue : parseFloat(String(j.revenue ?? '0'));
      if (Number.isFinite(r)) sum += r;
    }
    return sum;
  }, [jobs]);

  const lastJob = jobs[0] ?? null;
  const topVehicle = vehicles[0] ?? null;

  // For unknown callers / new customers the customer record exists but
  // is sparse. Render a "Test Lead" affordance when id starts with cust-test-.
  if (!customer || customer.id.startsWith('cust-test-')) {
    return (
      <div style={panelRoot}>
        <div style={titleStyle}>Customer</div>
        <p style={emptyStyle}>
          {customer?.id.startsWith('cust-test-')
            ? 'Test lead — no real customer record.'
            : 'Loading customer…'}
        </p>
      </div>
    );
  }

  const displayName = customer.name?.trim() || (wasNewCustomer ? 'Unknown caller' : '(unnamed)');
  const phoneFmt = customer.phoneE164 ? formatPhoneForDisplay(customer.phoneE164) : '';

  return (
    <div style={panelRoot}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        <button
          type="button"
          style={nameLink}
          onClick={() => onOpenCustomer?.(customer.id)}
        >
          {displayName}
        </button>
        {wasNewCustomer && <span style={newCustomerBadge}>NEW CUSTOMER</span>}
        {customer.kind === 'fleet' && <span style={fleetBadge}>FLEET</span>}
        {customer.vipTier && customer.vipTier !== 'Standard' && (
          <span style={vipBadge(customer.vipTier)}>{customer.vipTier}</span>
        )}
      </div>

      {/* Contact */}
      {phoneFmt && <div style={rowStyle}>📞 <a href={`tel:${customer.phoneE164}`} style={linkStyle}>{phoneFmt}</a></div>}
      {customer.email && <div style={rowStyle}>✉️ {customer.email}</div>}
      {(customer.city || customer.state) && (
        <div style={rowStyle}>📍 {customer.addressLine ? `${customer.addressLine}, ` : ''}{customer.city}{customer.city && customer.state ? ', ' : ''}{customer.state} {customer.zipCode ?? ''}</div>
      )}

      {/* Vehicle */}
      {topVehicle && (
        <div style={{ marginTop: 10 }}>
          <div style={subTitleStyle}>Vehicle</div>
          <div style={rowStyle}>{topVehicle.vehicleMakeModel || '(make/model unknown)'}</div>
          {topVehicle.tireSize && <div style={rowStyle}>Tire size: {topVehicle.tireSize}</div>}
          {topVehicle.lastServiceDate && (
            <div style={rowStyle}>Last serviced: {topVehicle.lastServiceDate}</div>
          )}
        </div>
      )}

      {/* Last service */}
      {lastJob && canViewFinancials && (
        <div style={{ marginTop: 10 }}>
          <div style={subTitleStyle}>Last Service</div>
          <div style={rowStyle}>
            {lastJob.date} · {lastJob.service}
            {lastJob.revenue !== undefined && lastJob.revenue !== '' && (
              <> · ${typeof lastJob.revenue === 'number' ? lastJob.revenue.toFixed(0) : lastJob.revenue}</>
            )}
          </div>
        </div>
      )}

      {/* Lifetime revenue (computed live, gated) */}
      {canViewFinancials && jobs.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div style={subTitleStyle}>Lifetime Revenue</div>
          <div style={{ ...rowStyle, fontSize: 18, fontWeight: 700, color: 'var(--brand-primary)' }}>
            ${lifetimeRevenue.toFixed(0)}
            <span style={{ fontSize: 11, color: 'var(--t3)', fontWeight: 400, marginLeft: 6 }}>
              · {jobs.length} job{jobs.length === 1 ? '' : 's'}
            </span>
          </div>
        </div>
      )}

      {/* Quick Notes — 8 SP3 fields (read-only chips) */}
      <QuickNotes customer={customer} />

      {/* Footer link */}
      {onOpenCustomer && (
        <button type="button" style={footerLink} onClick={() => onOpenCustomer(customer.id)}>
          Open customer profile →
        </button>
      )}
    </div>
  );
}

// Quick Notes — renders only the populated fields as chips.
function QuickNotes({ customer }: { customer: Customer }): JSX.Element | null {
  const entries: Array<{ label: string; value: string | undefined }> = [
    { label: 'Gate code',          value: (customer as unknown as { gateCode?: string }).gateCode },
    { label: 'Leash the dog',      value: (customer as unknown as { leashTheDog?: string }).leashTheDog },
    { label: 'Parking',            value: (customer as unknown as { parkingNotes?: string }).parkingNotes },
    { label: 'Fragile cargo',      value: (customer as unknown as { fragileCargo?: string }).fragileCargo },
    { label: 'Payment preferred',  value: (customer as unknown as { paymentPreferred?: string }).paymentPreferred },
    { label: 'Late-night OK',      value: (customer as unknown as { lateNightOK?: string }).lateNightOK },
    { label: 'Access notes',       value: (customer as unknown as { accessNotes?: string }).accessNotes },
    { label: 'Comm preference',    value: (customer as unknown as { communicationPreference?: string }).communicationPreference },
  ];
  const filled = entries.filter(e => e.value && String(e.value).trim());
  if (filled.length === 0) return null;
  return (
    <div style={{ marginTop: 10 }}>
      <div style={subTitleStyle}>Quick Notes</div>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {filled.map(e => (
          <span key={e.label} style={quickNoteChip}>
            <span style={{ fontWeight: 700 }}>{e.label}:</span> {e.value}
          </span>
        ))}
      </div>
    </div>
  );
}

const panelRoot: CSSProperties = {
  padding: 14, marginBottom: 12,
  background: 'var(--s2, #1f1f1f)',
  border: '1px solid var(--border, #333)', borderRadius: 8,
};
const titleStyle: CSSProperties = {
  fontSize: 14, fontWeight: 700, color: 'var(--t1)', marginBottom: 8,
};
const subTitleStyle: CSSProperties = {
  fontSize: 11, fontWeight: 700, color: 'var(--t3)',
  marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.5px',
};
const rowStyle: CSSProperties = { fontSize: 13, color: 'var(--t2)', padding: '2px 0' };
const linkStyle: CSSProperties = { color: 'var(--brand-primary)', textDecoration: 'none' };
const emptyStyle: CSSProperties = { fontSize: 12, color: 'var(--t3)', margin: 0 };
const nameLink: CSSProperties = {
  background: 'transparent', border: 'none', padding: 0,
  fontSize: 16, fontWeight: 700, color: 'var(--brand-primary)',
  cursor: 'pointer', textAlign: 'left',
};
const footerLink: CSSProperties = {
  display: 'block', marginTop: 12,
  background: 'transparent', border: 'none', padding: 0,
  fontSize: 12, color: 'var(--brand-primary)', cursor: 'pointer',
  textAlign: 'left', textDecoration: 'underline',
};
const quickNoteChip: CSSProperties = {
  fontSize: 11, padding: '2px 6px', borderRadius: 6,
  background: 'var(--s3, #2a2a2a)', color: 'var(--t1)',
};
const newCustomerBadge: CSSProperties = {
  fontSize: 9, fontWeight: 800, padding: '2px 6px', borderRadius: 99,
  background: '#fb923c', color: '#1a1a1a',
  textTransform: 'uppercase', letterSpacing: '0.5px',
};
const fleetBadge: CSSProperties = {
  fontSize: 9, fontWeight: 800, padding: '2px 6px', borderRadius: 99,
  background: '#3b82f6', color: '#fff',
  textTransform: 'uppercase', letterSpacing: '0.5px',
};
function vipBadge(tier: 'Gold' | 'Platinum'): CSSProperties {
  return {
    fontSize: 9, fontWeight: 800, padding: '2px 6px', borderRadius: 99,
    background: tier === 'Platinum' ? '#b5a5e8' : '#d4af37',
    color: '#1a1a1a',
    textTransform: 'uppercase', letterSpacing: '0.5px',
  };
}

export const CustomerEnrichmentPanel = memo(CustomerEnrichmentPanelImpl);
```

- [ ] **Step 2: Write LeadDetailSheet**

Create `src/components/leads/LeadDetailSheet.tsx`:

```tsx
// src/components/leads/LeadDetailSheet.tsx
// ═══════════════════════════════════════════════════════════════════
//  LeadDetailSheet — SP4B full-screen Lead detail modal.
//
//  Spec: docs/superpowers/specs/2026-06-04-sp4b-missed-call-recovery-design.md
//        §"LeadDetailSheet (Wheel Rush enrichment)"
//
//  Composes:
//    1. CustomerEnrichmentPanel (Wheel Rush block)
//    2. Status section (current pill + state-machine dropdown +
//       Create Job from Lead button)
//    3. SMS thread (communicationEvents WHERE leadId)
//    4. Composer (sendManualOutboundSms)
//    5. Notes editor (lead.notes save on blur)
//    6. Audit footer
// ═══════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import {
  collection, doc, onSnapshot, orderBy, query, where, setDoc,
  Timestamp,
  type Firestore,
} from 'firebase/firestore';
import { getFunctions, httpsCallable, connectFunctionsEmulator } from 'firebase/functions';
import { _db, _auth } from '@/lib/firebase';
import { usePermissions } from '@/context/MembershipContext';
import { useFocusTrap } from '@/lib/useFocusTrap';
import { CustomerEnrichmentPanel } from '@/components/leads/CustomerEnrichmentPanel';
import type { Lead, LeadStatus, CommunicationEvent, Job } from '@/types';

interface Props {
  businessId: string;
  leadId: string;
  onClose: () => void;
  onOpenCustomer?: (cid: string) => void;
  onCreateJob?: (draft: Partial<Job>, leadId: string) => void;
}

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

const LEGAL_NEXT_STATUSES: Record<LeadStatus, LeadStatus[]> = {
  New:       ['Contacted', 'Lost'],
  Contacted: ['Quoted', 'Booked', 'Lost'],
  Quoted:    ['Booked', 'Lost'],
  Booked:    ['Closed', 'Lost'],
  Closed:    [],
  Lost:      [],
};

export function LeadDetailSheet({
  businessId, leadId, onClose, onOpenCustomer, onCreateJob,
}: Props): JSX.Element {
  const trapRef = useFocusTrap<HTMLDivElement>(true);
  const perms = usePermissions();
  const canEdit = perms.canEditBusinessSettings ?? false;
  const canViewFinancials = perms.canViewFinancials ?? false;

  const [lead, setLead] = useState<Lead | null>(null);
  const [events, setEvents] = useState<CommunicationEvent[]>([]);
  const [notesLocal, setNotesLocal] = useState('');
  const [composerBody, setComposerBody] = useState('');
  const [composerInFlight, setComposerInFlight] = useState(false);
  const [composerError, setComposerError] = useState<string | null>(null);
  const [statusChangeOpen, setStatusChangeOpen] = useState(false);
  const [lostReasonOpen, setLostReasonOpen] = useState(false);
  const [lostReasonText, setLostReasonText] = useState('');

  // Lead subscription
  useEffect(() => {
    if (!businessId || !leadId) return;
    const unsub = onSnapshot(doc(_db as Firestore, 'businesses', businessId, 'leads', leadId), (snap) => {
      if (snap.exists()) {
        const l = { id: snap.id, ...snap.data() } as Lead;
        setLead(l);
        setNotesLocal(l.notes ?? '');
      } else {
        setLead(null);
      }
    });
    return () => unsub();
  }, [businessId, leadId]);

  // Communication events for this lead
  useEffect(() => {
    if (!businessId || !leadId) return;
    const q = query(
      collection(_db as Firestore, 'businesses', businessId, 'communicationEvents'),
      where('leadId', '==', leadId),
      orderBy('sentAt', 'asc'),
    );
    const unsub = onSnapshot(q, (snap) => {
      const next: CommunicationEvent[] = [];
      snap.forEach(d => next.push({ id: d.id, ...d.data() } as CommunicationEvent));
      setEvents(next);
    });
    return () => unsub();
  }, [businessId, leadId]);

  const onChangeStatus = useCallback(async (next: LeadStatus) => {
    if (!lead || !canEdit) return;
    if (next === 'Lost') {
      setLostReasonOpen(true);
      return;
    }
    const ref = doc(_db as Firestore, 'businesses', businessId, 'leads', leadId);
    await setDoc(ref, {
      status: next,
      updatedAt: Timestamp.now(),
      lastEditedByUid: _auth?.currentUser?.uid ?? 'unknown',
    }, { merge: true });
    setStatusChangeOpen(false);
  }, [lead, canEdit, businessId, leadId]);

  const onConfirmLost = useCallback(async () => {
    if (!lead || !canEdit) return;
    const reason = lostReasonText.trim();
    if (!reason) return;
    const ref = doc(_db as Firestore, 'businesses', businessId, 'leads', leadId);
    await setDoc(ref, {
      status: 'Lost' as LeadStatus,
      closedReason: reason,
      closedAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
      lastEditedByUid: _auth?.currentUser?.uid ?? 'unknown',
    }, { merge: true });
    setLostReasonOpen(false);
    setLostReasonText('');
    setStatusChangeOpen(false);
  }, [lead, canEdit, businessId, leadId, lostReasonText]);

  const onBlurNotes = useCallback(async () => {
    if (!lead || !canEdit) return;
    if (notesLocal === (lead.notes ?? '')) return;
    const ref = doc(_db as Firestore, 'businesses', businessId, 'leads', leadId);
    await setDoc(ref, {
      notes: notesLocal,
      updatedAt: Timestamp.now(),
      lastEditedByUid: _auth?.currentUser?.uid ?? 'unknown',
    }, { merge: true });
  }, [lead, canEdit, businessId, leadId, notesLocal]);

  const onSendComposer = useCallback(async () => {
    if (!lead || !composerBody.trim()) return;
    setComposerError(null);
    setComposerInFlight(true);
    try {
      const fn = httpsCallable<
        { businessId: string; leadId: string; body: string },
        { smsId: string }
      >(_getEmulatorAwareFunctions(), 'sendManualOutboundSms');
      await fn({ businessId, leadId, body: composerBody });
      setComposerBody('');
    } catch (err) {
      setComposerError(err instanceof Error ? err.message : String(err));
    } finally {
      setComposerInFlight(false);
    }
  }, [lead, businessId, leadId, composerBody]);

  const onCreateJobFromLead = useCallback(() => {
    if (!lead || !onCreateJob) return;
    onCreateJob({
      customerId: lead.customerId,
      customerPhone: lead.phoneE164,
      note: lead.notes ?? '',
    } as Partial<Job>, lead.id);
  }, [lead, onCreateJob]);

  const nextLegalStatuses = useMemo(() => {
    if (!lead) return [] as LeadStatus[];
    return LEGAL_NEXT_STATUSES[lead.status] ?? [];
  }, [lead]);

  if (!lead) {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal-card" style={{ maxWidth: 480 }}>
          <p style={{ color: 'var(--t2)' }}>Loading lead…</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="modal-overlay"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div ref={trapRef} className="modal-card" style={{ maxWidth: 640, maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>Lead</h2>
          <button type="button" className="btn sm secondary" onClick={onClose}>Close</button>
        </div>

        {/* 1. Customer enrichment */}
        <CustomerEnrichmentPanel
          businessId={businessId}
          customerId={lead.customerId}
          wasNewCustomer={lead.wasNewCustomer}
          canViewFinancials={canViewFinancials}
          onOpenCustomer={onOpenCustomer}
        />

        {/* 2. Status section */}
        <div style={sectionRoot}>
          <div style={sectionTitle}>Status</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={statusPill(lead.status)}>{lead.status}</span>
            {canEdit && nextLegalStatuses.length > 0 && (
              <button
                type="button"
                className="btn sm secondary"
                onClick={() => setStatusChangeOpen(!statusChangeOpen)}
              >
                Change Status
              </button>
            )}
            {canEdit && onCreateJob && (
              <button
                type="button"
                className="btn sm primary"
                onClick={onCreateJobFromLead}
              >
                Create Job from Lead
              </button>
            )}
          </div>
          {statusChangeOpen && (
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 8 }}>
              {nextLegalStatuses.map(s => (
                <button
                  key={s}
                  type="button"
                  className={'btn sm ' + (s === 'Lost' ? 'danger' : 'secondary')}
                  onClick={() => onChangeStatus(s)}
                >
                  → {s}
                </button>
              ))}
            </div>
          )}
          {lostReasonOpen && (
            <div style={{ marginTop: 8 }}>
              <label style={labelStyle}>Why was this lead lost?</label>
              <input
                type="text"
                value={lostReasonText}
                onChange={(e) => setLostReasonText(e.target.value)}
                placeholder="e.g. went with competitor"
                style={inputStyle}
              />
              <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
                <button type="button" className="btn sm secondary" onClick={() => { setLostReasonOpen(false); setLostReasonText(''); }}>Cancel</button>
                <button type="button" className="btn sm danger" disabled={!lostReasonText.trim()} onClick={onConfirmLost}>Mark Lost</button>
              </div>
            </div>
          )}
        </div>

        {/* 3. SMS thread */}
        <div style={sectionRoot}>
          <div style={sectionTitle}>Conversation</div>
          {events.length === 0 && (
            <p style={emptyStyle}>No messages yet.</p>
          )}
          {events.map(e => {
            const isOut = e.direction === 'outbound';
            return (
              <div key={e.id} style={{
                display: 'flex', justifyContent: isOut ? 'flex-end' : 'flex-start',
                marginBottom: 6,
              }}>
                <div style={bubble(isOut, e.status)}>
                  <div>{e.content || '—'}</div>
                  <div style={bubbleMeta}>
                    {e.status} · {formatTs((e as unknown as { sentAt?: { toMillis?: () => number } }).sentAt)}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* 4. Composer */}
        {canEdit && (
          <div style={sectionRoot}>
            <div style={sectionTitle}>Send SMS</div>
            <textarea
              value={composerBody}
              onChange={(e) => setComposerBody(e.target.value)}
              placeholder="Type a message to send via Twilio…"
              rows={3}
              style={{ ...inputStyle, minHeight: 70, fontFamily: 'inherit' }}
            />
            <button
              type="button"
              className="btn sm primary"
              disabled={composerInFlight || !composerBody.trim()}
              onClick={onSendComposer}
              style={{ marginTop: 6 }}
            >
              {composerInFlight ? 'Sending…' : 'Send'}
            </button>
            {composerError && <p style={{ ...emptyStyle, color: 'var(--danger, #f87171)', marginTop: 6 }}>{composerError}</p>}
          </div>
        )}

        {/* 5. Notes editor */}
        <div style={sectionRoot}>
          <div style={sectionTitle}>Notes</div>
          <textarea
            value={notesLocal}
            onChange={(e) => setNotesLocal(e.target.value)}
            onBlur={onBlurNotes}
            placeholder="Operator notes about this lead…"
            rows={3}
            disabled={!canEdit}
            style={{ ...inputStyle, minHeight: 70, fontFamily: 'inherit' }}
          />
        </div>

        {/* 6. Audit footer */}
        <details style={{ marginTop: 12 }}>
          <summary style={{ fontSize: 11, color: 'var(--t3)', cursor: 'pointer' }}>Audit</summary>
          <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 6 }}>
            <div>Received: {formatTs((lead as unknown as { receivedAt?: { toMillis?: () => number } }).receivedAt)}</div>
            <div>CallSid: {lead.callSid ?? '—'}</div>
            <div>CallStatus: {lead.callStatus ?? '—'}</div>
            <div>Auto-text sent: {lead.autoTextSent ? 'yes' : 'no'}</div>
            <div>outboundSmsId: {lead.outboundSmsId ?? '—'}</div>
            <div>wasNewCustomer: {lead.wasNewCustomer ? 'yes' : 'no'}</div>
            <div>Last edited by: {lead.lastEditedByUid ?? '—'}</div>
          </div>
        </details>
      </div>
    </div>
  );
}

function statusPill(status: LeadStatus): CSSProperties {
  const colorMap: Record<LeadStatus, string> = {
    New: '#3b82f6', Contacted: '#f59e0b', Quoted: '#a78bfa',
    Booked: '#4ade80', Closed: '#6b7280', Lost: '#f87171',
  };
  return {
    fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 99,
    color: '#fff', background: colorMap[status] ?? '#666',
    textTransform: 'uppercase', letterSpacing: '0.4px',
  };
}
function bubble(isOut: boolean, status: string): CSSProperties {
  return {
    maxWidth: '75%', padding: '6px 10px', borderRadius: 12,
    background: isOut
      ? (status === 'failed' ? '#7f1d1d' : 'var(--brand-primary, #f4b400)')
      : 'var(--s3, #2a2a2a)',
    color: isOut ? '#1a1a1a' : 'var(--t1)',
    fontSize: 13, whiteSpace: 'pre-wrap',
  };
}
const bubbleMeta: CSSProperties = {
  fontSize: 10, opacity: 0.7, marginTop: 2,
};
function formatTs(ts: { toMillis?: () => number } | undefined): string {
  if (!ts || typeof ts.toMillis !== 'function') return '—';
  return new Date(ts.toMillis()).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

const sectionRoot: CSSProperties = {
  marginBottom: 12, padding: 12,
  background: 'var(--s2, #1f1f1f)',
  border: '1px solid var(--border, #333)', borderRadius: 8,
};
const sectionTitle: CSSProperties = {
  fontSize: 12, fontWeight: 700, color: 'var(--t2)',
  marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.5px',
};
const labelStyle: CSSProperties = {
  display: 'block', fontWeight: 600, fontSize: 12,
  color: 'var(--t2)', marginBottom: 4,
};
const inputStyle: CSSProperties = {
  width: '100%', padding: '6px 8px', fontSize: 13,
  background: 'var(--s3, #2a2a2a)', color: 'var(--t1)',
  border: '1px solid var(--border, #333)', borderRadius: 6,
};
const emptyStyle: CSSProperties = { fontSize: 12, color: 'var(--t3)', margin: 0 };
```

- [ ] **Step 3: Type-check + build**

Run: `npm run build`
Expected: tsc + vite finish cleanly.

- [ ] **Step 4: Commit**

```bash
git add src/components/leads/CustomerEnrichmentPanel.tsx src/components/leads/LeadDetailSheet.tsx
git commit -m "$(cat <<'EOF'
feat(leads): CustomerEnrichmentPanel + LeadDetailSheet (SP4B task 13)

Wheel Rush customer-context block + full-screen Lead detail modal.

CustomerEnrichmentPanel subscribes to Customer + Vehicle subcollection
+ Jobs subcollection. Renders name + contact + most-recent vehicle +
tire size + last service + lifetime revenue (computed live, NEVER
persisted per SP3 privacy contract, gated by canViewFinancials) +
8 Quick Notes chips.

LeadDetailSheet composes the enrichment panel + status section
(legal-transitions dropdown + Lost requires closedReason) + SMS
thread (communicationEvents WHERE leadId) + composer
(sendManualOutboundSms callable) + notes editor (save on blur) +
collapsible audit footer.

State-machine policing is UI-only — rules at Firestore level only
enforce status is in the legal enum.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: Leads page + tab registration + bottom-nav

The Leads top-level tab. Subscribes to `leads` + `customers` (for priority + name join), sorts client-side by `priorityScore DESC` then `receivedAt DESC`, renders status filter chips with live counts + substring search.

This task also wires the new `'leads'` route in `App.tsx` and adds the bottom-nav button. **Layout decision:** Insert the Leads button as the 3rd item (between Jobs and Customers) so the funnel reads "Home → Jobs → Leads → Customers → +Log → Inv → More." That's 7 buttons in the mobile bottom-nav, which is the right tradeoff for a daily-driver feature; if the operator wants to swap positions they can edit the JSX in one place.

**Files:**
- Create: `src/pages/Leads.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Write the Leads page**

Create `src/pages/Leads.tsx`:

```tsx
// src/pages/Leads.tsx
// ═══════════════════════════════════════════════════════════════════
//  Leads — top-level nav tab for the missed-call queue.
//
//  Spec: docs/superpowers/specs/2026-06-04-sp4b-missed-call-recovery-design.md
//        §"New top-level nav tab: Leads"
//
//  Subscribes to businesses/{bid}/leads + customers. Sorts client-side
//  by priorityScore DESC then receivedAt DESC. Status filter chips
//  show live counts. Substring search across name + phone + notes.
//  Tap card → LeadDetailSheet.
// ═══════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import {
  collection, limit, onSnapshot, orderBy, query,
  type Firestore,
} from 'firebase/firestore';
import { _db } from '@/lib/firebase';
import { LeadCard } from '@/components/leads/LeadCard';
import { LeadDetailSheet } from '@/components/leads/LeadDetailSheet';
import { computeLeadPriority } from '@/lib/leadPriority';
import type { Customer } from '@/lib/customerEntity';
import type { Lead, LeadStatus, Job } from '@/types';

type FilterKey = 'All' | LeadStatus;

interface Props {
  businessId: string;
  onOpenCustomer?: (cid: string) => void;
  onCreateJob?: (draft: Partial<Job>, leadId: string) => void;
}

export default function Leads({ businessId, onOpenCustomer, onCreateJob }: Props): JSX.Element {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [customers, setCustomers] = useState<Map<string, Customer>>(new Map());
  const [filter, setFilter] = useState<FilterKey>('All');
  const [search, setSearch] = useState('');
  const [searchDebounced, setSearchDebounced] = useState('');
  const [openLeadId, setOpenLeadId] = useState<string | null>(null);

  // Debounce search input
  useEffect(() => {
    const id = setTimeout(() => setSearchDebounced(search.trim().toLowerCase()), 250);
    return () => clearTimeout(id);
  }, [search]);

  // Leads subscription
  useEffect(() => {
    if (!businessId) return;
    const q = query(
      collection(_db as Firestore, 'businesses', businessId, 'leads'),
      orderBy('receivedAt', 'desc'),
      limit(200),
    );
    const unsub = onSnapshot(q, (snap) => {
      const next: Lead[] = [];
      snap.forEach(d => next.push({ id: d.id, ...d.data() } as Lead));
      setLeads(next);
    });
    return () => unsub();
  }, [businessId]);

  // Customers subscription — for name display + priority computation
  useEffect(() => {
    if (!businessId || leads.length === 0) return;
    const unsub = onSnapshot(
      collection(_db as Firestore, 'businesses', businessId, 'customers'),
      (snap) => {
        const next = new Map<string, Customer>();
        snap.forEach(d => next.set(d.id, { id: d.id, ...d.data() } as Customer));
        setCustomers(next);
      },
    );
    return () => unsub();
  }, [businessId, leads.length]);

  // Sort by (priorityScore DESC, receivedAtMs DESC)
  const sorted = useMemo(() => {
    const entries = leads.map(l => {
      const cust = customers.get(l.customerId) ?? null;
      const priority = computeLeadPriority(
        cust ? { vipTier: cust.vipTier, kind: cust.kind, jobCount: cust.jobCount } : null,
        l,
      );
      const receivedAtMs = (l as unknown as { receivedAt?: { toMillis?: () => number } }).receivedAt?.toMillis?.() ?? 0;
      return { lead: l, customer: cust, priorityScore: priority.score, receivedAtMs };
    });
    entries.sort((a, b) => {
      if (b.priorityScore !== a.priorityScore) return b.priorityScore - a.priorityScore;
      return b.receivedAtMs - a.receivedAtMs;
    });
    return entries;
  }, [leads, customers]);

  // Status counts (across all leads, not the filtered set)
  const statusCounts = useMemo(() => {
    const counts: Record<FilterKey, number> = {
      All: leads.length, New: 0, Contacted: 0, Quoted: 0, Booked: 0, Closed: 0, Lost: 0,
    };
    for (const l of leads) {
      counts[l.status] = (counts[l.status] ?? 0) + 1;
    }
    return counts;
  }, [leads]);

  // Filter + search
  const visible = useMemo(() => {
    return sorted.filter(({ lead, customer }) => {
      if (filter !== 'All' && lead.status !== filter) return false;
      if (searchDebounced) {
        const phoneDigits = (lead.phoneE164 ?? '').replace(/[^\d]/g, '');
        const hay = [
          customer?.name ?? '',
          lead.phoneE164 ?? '',
          phoneDigits,
          lead.notes ?? '',
        ].join(' ').toLowerCase();
        if (!hay.includes(searchDebounced)) return false;
      }
      return true;
    });
  }, [sorted, filter, searchDebounced]);

  const filterChips: FilterKey[] = ['All', 'New', 'Contacted', 'Quoted', 'Booked', 'Closed', 'Lost'];

  return (
    <div className="page page-enter">
      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 14 }}>
        Leads {visible.length > 0 && <span style={{ fontSize: 14, fontWeight: 400, color: 'var(--t3)' }}>· {visible.length}</span>}
      </div>

      {/* Filter chips */}
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
        {filterChips.map(k => (
          <button
            key={k}
            type="button"
            onClick={() => setFilter(k)}
            className={'btn sm ' + (filter === k ? 'primary' : 'secondary')}
          >
            {k} {statusCounts[k] > 0 && <span style={{ opacity: 0.7 }}>· {statusCounts[k]}</span>}
          </button>
        ))}
      </div>

      {/* Search */}
      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search by name, phone, or notes"
        style={searchInputStyle}
      />

      {/* List */}
      {visible.length === 0 && (
        <div style={emptyStyle}>
          {filter === 'All' && !searchDebounced
            ? "No leads yet. When a customer calls and you miss the call, they'll appear here."
            : 'No leads match the current filter.'}
        </div>
      )}
      {visible.map(({ lead, customer }) => (
        <LeadCard
          key={lead.id}
          lead={lead}
          customer={customer}
          onClick={() => setOpenLeadId(lead.id)}
        />
      ))}

      {openLeadId && (
        <LeadDetailSheet
          businessId={businessId}
          leadId={openLeadId}
          onClose={() => setOpenLeadId(null)}
          onOpenCustomer={onOpenCustomer}
          onCreateJob={onCreateJob}
        />
      )}
    </div>
  );
}

const searchInputStyle: CSSProperties = {
  width: '100%', padding: '8px 10px', fontSize: 14, marginBottom: 12,
  background: 'var(--s2, #1f1f1f)', color: 'var(--t1)',
  border: '1px solid var(--border, #333)', borderRadius: 8,
};
const emptyStyle: CSSProperties = {
  padding: 24, color: 'var(--t3)', fontSize: 13, textAlign: 'center',
};
```

- [ ] **Step 2: Wire `'leads'` route in App.tsx**

Edit `src/App.tsx`. Add the import near the other page imports (around the top of the file):

```ts
import Leads from '@/pages/Leads';
```

Find the existing tab-route block (around line 1458 — the place where `tab === 'customers'` returns the CustomerHub page). Add a `tab === 'leads'` branch immediately before or after it:

```tsx
    if (tab === 'leads' && businessId) return (
      <Leads
        businessId={businessId}
        onOpenCustomer={(cid) => { setSelectedCustomerId(cid); setTab('customerProfile'); }}
        onCreateJob={(draft, leadId) => {
          // Carry leadId through the AddJob flow so the post-save effect
          // can flip lead.status = Booked + lead.jobId on the originating
          // Lead. Task 16 implements the linkback.
          setEditingJob({ ...draft, leadId } as never);
          setTab('add');
        }}
      />
    );
```

(Replace `setEditingJob`/`editingJob` with the actual prop name used in your App.tsx — check what the existing CustomerProfile `onCreateJob` callback at line ~1473 calls into. It uses `onCreateJob?.(draft as Partial<Job>)` pattern; reuse that exact mechanism.)

- [ ] **Step 3: Add bottom-nav Leads button**

In the `<nav className="bottom-nav">` block (around line 1631 of App.tsx), insert a new button between the Jobs button and the Customers button:

```tsx
        <button
          className={'nav-btn' + (tab === 'leads' ? ' active' : '')}
          aria-current={tab === 'leads' ? 'page' : undefined}
          onClick={() => setTab('leads')}
        >
          <span className="nav-ico" aria-hidden="true">📞</span><span>Leads</span>
        </button>
```

This makes the bottom-nav order: Home / Jobs / Leads / Customers / +Log / Inv / More.

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: tsc + vite finish.

If TS errors on the `Leads` import or the route block, the implementer may need to inspect the actual `onCreateJob` flow used by CustomerProfile and adapt the leadId-threading pattern accordingly. The exact mechanism for "pass leadId through AddJob to the post-save effect" is implementation-detail — keep it minimal.

- [ ] **Step 5: Commit**

```bash
git add src/pages/Leads.tsx src/App.tsx
git commit -m "$(cat <<'EOF'
feat(leads): Leads top-level tab + bottom-nav registration (SP4B task 14)

New /leads route in App.tsx. Bottom-nav order is now:
  Home → Jobs → Leads → Customers → +Log → Inv → More

Leads page subscribes to businesses/{bid}/leads + customers, sorts
client-side by (priorityScore DESC, receivedAt DESC), renders status
filter chips with live counts + 250ms debounced substring search
across name + phone (digits + formatted) + notes. Tap card →
LeadDetailSheet.

onCreateJob carries leadId through to the AddJob flow so Task 16's
post-save linkback can flip lead.status='Booked' + lead.jobId.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 15: CustomerProfile MissedCallMetricsCard + Recent Leads

Two new sub-sections under the existing "Communication History" cluster. Both subscribe to the same `leads where customerId == cid` query (limit 20, but the metrics card uses the full set).

**Files:**
- Create: `src/components/leads/MissedCallMetricsCard.tsx`
- Modify: `src/pages/CustomerProfile.tsx`

- [ ] **Step 1: Write the metrics card**

Create `src/components/leads/MissedCallMetricsCard.tsx`:

```tsx
// src/components/leads/MissedCallMetricsCard.tsx
// ═══════════════════════════════════════════════════════════════════
//  MissedCallMetricsCard — SP4B 3-cell counter card for CustomerProfile.
//
//  Spec: docs/superpowers/specs/2026-06-04-sp4b-missed-call-recovery-design.md
//        §"CustomerProfile integration → 1. Missed Call Metrics card"
//
//  Derived from the leads array CustomerProfile already subscribes
//  to for the Recent Leads list. No additional reads.
//
//    Missed Calls = total where source === 'missed_call'
//    Recovered    = count where status in {'Booked', 'Closed'}
//    Lost         = count where status === 'Lost'
//
//  Renders only when total > 0.
// ═══════════════════════════════════════════════════════════════════

import { memo, useMemo, type CSSProperties } from 'react';
import type { Lead } from '@/types';

interface Props {
  leads: Lead[];        // already filtered to this customer's leads by caller
}

function MissedCallMetricsCardImpl({ leads }: Props): JSX.Element | null {
  const counts = useMemo(() => {
    let total = 0, recovered = 0, lost = 0;
    for (const l of leads) {
      if (l.source !== 'missed_call') continue;
      total += 1;
      if (l.status === 'Booked' || l.status === 'Closed') recovered += 1;
      if (l.status === 'Lost')                            lost      += 1;
    }
    return { total, recovered, lost };
  }, [leads]);

  if (counts.total === 0) return null;

  return (
    <div style={cardRoot}>
      <div style={titleStyle}>Missed Call Metrics</div>
      <div style={{ display: 'flex', gap: 12 }}>
        <Cell label="Missed Calls" value={counts.total}     tint="var(--t1)" />
        <Cell label="Recovered"    value={counts.recovered} tint="var(--ok, #4ade80)" />
        <Cell label="Lost"         value={counts.lost}      tint="var(--danger, #f87171)" />
      </div>
    </div>
  );
}

function Cell({ label, value, tint }: { label: string; value: number; tint: string }): JSX.Element {
  return (
    <div style={cellStyle}>
      <div style={{ fontSize: 28, fontWeight: 700, color: tint, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 4, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{label}</div>
    </div>
  );
}

const cardRoot: CSSProperties = {
  padding: 14, marginBottom: 12,
  background: 'var(--s2, #1f1f1f)',
  border: '1px solid var(--border, #333)', borderRadius: 8,
};
const titleStyle: CSSProperties = {
  fontSize: 12, fontWeight: 700, color: 'var(--t2)',
  marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.5px',
};
const cellStyle: CSSProperties = {
  flex: 1, textAlign: 'center',
  padding: '8px 4px',
  background: 'var(--s3, #2a2a2a)', borderRadius: 6,
};

export const MissedCallMetricsCard = memo(MissedCallMetricsCardImpl);
```

- [ ] **Step 2: Wire CustomerProfile additions**

Edit `src/pages/CustomerProfile.tsx`. After the existing SP4A `commEvents` state + effect block (added by SP4A Task 13), add a new state + effect for leads:

```ts
import type { Lead } from '@/types';
import { LeadCard } from '@/components/leads/LeadCard';
import { LeadDetailSheet } from '@/components/leads/LeadDetailSheet';
import { MissedCallMetricsCard } from '@/components/leads/MissedCallMetricsCard';
```

Add the new subscription (insert near the existing `setReviewRequests` / `setCommEvents` effects):

```ts
  const [customerLeads, setCustomerLeads] = useState<Lead[]>([]);
  const [openLeadId, setOpenLeadId] = useState<string | null>(null);
  useEffect(() => {
    if (!businessId || !customerId) return;
    const q = query(
      collection(_db as Firestore, 'businesses', businessId, 'leads'),
      where('customerId', '==', customerId),
      orderBy('receivedAt', 'desc'),
      limit(20),
    );
    const unsub = onSnapshot(q, (snap) => {
      const rows: Lead[] = [];
      snap.forEach(d => rows.push({ id: d.id, ...d.data() } as Lead));
      setCustomerLeads(rows);
    });
    return () => unsub();
  }, [businessId, customerId]);
```

Then, inside the JSX of the "9. Communication History" section, insert the two new sub-sections AT THE TOP (before the existing Review Requests sub-section added by SP4A Task 13):

```tsx
        {/* SP4B: Missed Call Metrics card */}
        <MissedCallMetricsCard leads={customerLeads} />

        {/* SP4B: Recent Leads sub-section */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--t2)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Recent Leads
          </div>
          {customerLeads.length === 0 && (
            <p style={{ fontSize: 12, color: 'var(--t3)', margin: 0 }}>No leads yet for this customer.</p>
          )}
          {customerLeads.slice(0, 5).map(l => (
            <LeadCard
              key={l.id}
              lead={l}
              customer={customer}
              onClick={() => setOpenLeadId(l.id)}
            />
          ))}
        </div>
```

And add the LeadDetailSheet host at the bottom of the component's return (alongside other modal hosts):

```tsx
      {openLeadId && (
        <LeadDetailSheet
          businessId={businessId}
          leadId={openLeadId}
          onClose={() => setOpenLeadId(null)}
          onOpenCustomer={(cid) => { /* no-op — we're already on this customer */ }}
          // CustomerProfile doesn't host AddJob navigation; Create-Job-from-Lead
          // here uses the same onCreateJob prop the existing Customer page uses.
          onCreateJob={(draft, leadId) => {
            props.onCreateJob?.({ ...draft, leadId } as never);
            setOpenLeadId(null);
          }}
        />
      )}
```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: tsc + vite finish.

- [ ] **Step 4: Commit**

```bash
git add src/components/leads/MissedCallMetricsCard.tsx src/pages/CustomerProfile.tsx
git commit -m "$(cat <<'EOF'
feat(customer): MissedCallMetricsCard + Recent Leads (SP4B task 15)

Two new sub-sections under CustomerProfile's Communication History
cluster. Both derived from a single new leads subscription
(where customerId == cid, orderBy receivedAt desc, limit 20).

MissedCallMetricsCard renders 3 large counters (Missed Calls /
Recovered / Lost) derived live from the array — no persisted counters.
Card hides when total = 0.

Recent Leads renders the 5 most-recent leads using the LeadCard
component (priority badges + status pill + age + source icon).
Tap → LeadDetailSheet hosted within CustomerProfile.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 16: JobDetailModal Lead → Job linkback

When a Job was created from a Lead (the AddJob draft carried a `leadId` field from Task 14's `onCreateJob` callback), saving the Job should automatically flip `lead.status = 'Booked'` + `lead.jobId = job.id` on the originating Lead.

The linkback runs at Job-save time. We piggyback on the existing job-save path rather than introducing a new trigger.

**Files:**
- Modify: `src/App.tsx` (saveJob path) OR `src/pages/AddJob.tsx` (wherever the job-save effect lives)

Implementation note: the exact location depends on the codebase. Search for `saveJob` or where `addDoc(collection(..., 'jobs'))` is called. The pattern:

```ts
// After the Job is successfully saved with a generated id:
if (draft.leadId) {
  await setDoc(
    doc(_db as Firestore, 'businesses', businessId, 'leads', draft.leadId),
    {
      status: 'Booked',
      jobId: savedJob.id,
      updatedAt: Timestamp.now(),
      lastEditedByUid: _auth?.currentUser?.uid ?? 'unknown',
    },
    { merge: true },
  );
}
```

- [ ] **Step 1: Locate the save path**

Run: `grep -n "saveJob\|addDoc(.*jobs\|setDoc(.*jobs" src/App.tsx src/pages/AddJob.tsx 2>/dev/null | head -20`

Pick the function that runs AFTER the Job doc is committed with its final id. That's where the Lead linkback fires.

- [ ] **Step 2: Add the linkback**

Inside the post-save block (after the Job's `setDoc` / `addDoc` resolves), insert:

```ts
// SP4B: when this Job was created from a Lead, link them up.
// draft.leadId is carried through the AddJob navigation from
// Leads.tsx → onCreateJob → setTab('add').
const sourceLeadId = (draft as unknown as { leadId?: string }).leadId;
if (sourceLeadId && businessId) {
  try {
    await setDoc(
      doc(_db as Firestore, 'businesses', businessId, 'leads', sourceLeadId),
      {
        status: 'Booked',
        jobId: savedJobId,        // whatever local var holds the just-saved id
        updatedAt: Timestamp.now(),
        lastEditedByUid: _auth?.currentUser?.uid ?? 'unknown',
      },
      { merge: true },
    );
  } catch (err) {
    // Non-blocking — the Job is already saved. Log + continue.
    console.error('[SP4B linkback] failed to update lead.status=Booked', err);
  }
}
```

Adjust `savedJobId` and `businessId` to match the actual local-variable names in your save path. If the save path uses `addDoc` and returns a `DocumentReference`, use `ref.id`. If it uses `setDoc` with a pre-generated id, use that id directly.

The linkback is **non-blocking** — a Lead update failure does NOT abort the Job save. The Job is the source of truth; the Lead is metadata. Operator can manually transition the Lead later via the LeadDetailSheet status dropdown if the linkback ever fails.

- [ ] **Step 3: Strip leadId from the saved Job patch**

The `draft.leadId` field is a UI-only sentinel — it should NOT be persisted on the Job doc. Before the save, ensure leadId is stripped:

```ts
// Strip the UI-only sentinel from the Job patch before persisting.
const { leadId: _strippedLeadId, ...jobPatch } = draft as unknown as { leadId?: string } & Job;
// then save jobPatch (not draft)
```

(If the save path uses spread + explicit fields rather than `draft` as a single object, just don't include `leadId` in the fields list.)

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx
git commit -m "$(cat <<'EOF'
feat(jobs): Lead → Job linkback on save (SP4B task 16)

When a Job is saved with a leadId in the draft (carried through
from Leads.tsx → onCreateJob → setTab('add')), flip the originating
Lead to status='Booked' + lead.jobId = savedJob.id.

Linkback is non-blocking — Lead update failure logs but does NOT
abort the Job save. Operator can manually advance the Lead later
via the status dropdown if the linkback ever fails.

leadId is stripped from the Job patch before persisting — it's a
UI-only sentinel, never written to the Job doc.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 17: Final verification

Run the full battery before declaring SP4B shipped. Operator emulator smoke is the next step but driven by the user.

**Files:** none (verification only)

- [ ] **Step 1: Run the full logic test suite**

Run: `npm test`
Expected: every test file ✓, exit 0. The 4 new SP4B test files should report:
- `tests/leadPriority.test.ts` — `~27 passed, 0 failed`
- `tests/twilioVoiceStatus.test.ts` — `~25 passed, 0 failed`
- `tests/drainOutboundSms.test.ts` — `~26 passed, 0 failed`
- `tests/missedCallCallables.test.ts` — `~20 passed, 0 failed`

(Counts are approximate — what matters is `0 failed` on each.)

- [ ] **Step 2: Type-check**

Run: `npm run lint`
Expected: exit 0.

- [ ] **Step 3: Build the client**

Run: `npm run build`
Expected: vite finishes; bundle includes the new Leads page + LeadDetailSheet + ReviewAutomationSection sibling.

- [ ] **Step 4: Build the functions**

Run: `cd functions && npm run build && cd ..`
Expected: exit 0. Confirm the 4 SP4B function files compile:

```bash
ls functions/lib/twilioVoiceStatus.js \
   functions/lib/drainOutboundSms.js \
   functions/lib/sendTestMissedCall.js \
   functions/lib/sendManualOutboundSms.js \
   functions/lib/lib/twilioSignatureValidator.js
```

All five files should exist.

- [ ] **Step 5: Operator emulator smoke (Nashy-driven)**

This step is for the operator, not the implementer. The implementer outlines it in the report; the operator executes manually.

```bash
# Terminal A
npm run emulator:start

# Terminal B (when "All emulators ready")
npm run emulator:seed

# Terminal C
npm run dev:emulator
```

Browser at http://localhost:5173. Sign in as `admin@localhost.dev` / `dev-password-1234`. Walk through:

1. Settings → Missed Call Recovery → toggle ON. Without a phone number, confirm the warning banner appears.
2. Paste `+13055550100` (or any E.164) in the Twilio Phone Number field, blur. Warning disappears.
3. Settings → Missed Call Recovery → Send Test Missed Call → enter `+13055551234` → Fire Test Missed Call.
4. Open Firestore emulator UI at http://localhost:4000/firestore.
5. Confirm `businesses/dev-business/leads/lead-test-<uid>-<ms>` exists with `status: 'New'`.
6. Confirm `businesses/dev-business/outboundSms/sms-lead-test-<uid>-<ms>` exists with `status: 'pending'`.
7. Wait ~60s for the drainer tick. Without Twilio env, outboundSms stays at `pending` (dormant). With Twilio env set, it flips to `sent` + populates `twilioMessageSid`.
8. Open the Leads tab — the test lead appears at the BOTTOM of the queue (score = -1).
9. Tap the lead card → LeadDetailSheet opens. Customer enrichment panel shows "Test lead — no real customer record."
10. Change status to Contacted → confirm `lead.status` updates and `updatedAt` bumps.
11. Tap "Create Job from Lead" → AddJob opens. Save the Job → confirm `lead.status === 'Booked'` and `lead.jobId === <new job id>`.
12. Open Maria Lopez's CustomerProfile (one of the seed customers) → confirm Recent Leads + MissedCallMetricsCard sub-sections render (likely empty for seed data, but the layout should be intact).

If steps 1-12 succeed, SP4B's code is working end-to-end against the emulator. Actual Twilio webhook traffic requires deploying to a public URL + configuring the Twilio Console — that's an operator deployment task, not part of the smoke.

- [ ] **Step 6: Git status check**

```bash
git status --short
git log --oneline <SP4A-tip-commit>..HEAD
```

Expected:
- Pre-existing dirty files (`.gitignore`, `scripts/seed-emulator.ts`) still in working tree. SP4B did NOT touch them.
- 16 SP4B commits between the SP4A tip (commit `9592c92` — the spec amendment) and HEAD.

---

## Self-review notes

**Spec coverage walk-through:**

| Acceptance criterion | Implementing task(s) |
|---|---|
| 1. Trigger latency ≤5s | Task 6 (webhook) |
| 2. 24h dedup via doc id | Task 6 (computeLeadId + dedup guard) |
| 3. Twilio-off path stays pending | Task 7 (TWILIO_NOT_CONFIGURED handling) |
| 4. Toggle OFF skips outboundSms | Task 6 (Step 3 decision logic) |
| 5. Existing customer matched | Task 6 (phoneKey lookup) |
| 6. Unknown caller → new customer | Task 6 (wasNewCustomer + Customer create in tx) |
| 7. LeadDetailSheet enrichment | Task 13 (CustomerEnrichmentPanel) |
| 8. New Customer badge | Task 12 (LeadCard) + Task 13 (CustomerEnrichmentPanel) |
| 9. Operator-driven status | Task 13 (LeadDetailSheet status dropdown, LEGAL_NEXT_STATUSES gate) |
| 10. Create Job pre-fill | Task 14 (Leads onCreateJob) + Task 16 (linkback) |
| 11. Job save → Lead.Booked | Task 16 |
| 12. Send Test admin button | Task 8 + Task 10 |
| 13. Search by name+phone+notes | Task 14 (Leads page filter) |
| 14. Status chips with counts | Task 14 (statusCounts memo) |
| 15. Twilio signature 403 | Task 5 + Task 6 |
| 16. CustomerProfile Recent Leads | Task 15 |
| 17. Manual composer | Task 8 (sendManualOutboundSms) + Task 13 (LeadDetailSheet) |
| 18. Lost requires closedReason | Task 13 (LeadDetailSheet lost-reason modal) |
| 19. Priority badges on all 3 surfaces | Task 12 (LeadCard) + Task 13 (LeadDetailSheet) + Task 15 (CustomerProfile via LeadCard) |
| 20. Leads tab sort + test-lead bottom | Task 14 (sort memo) + Task 3 (helper) |
| 21. computeLeadPriority pure helper | Task 3 |
| 22. MissedCallMetricsCard | Task 15 |

**Cross-task type consistency:**

- `Lead.status` is `LeadStatus` union (Task 1) — used in Tasks 6, 7, 8, 12, 13, 14, 15, 16. Same spelling in all sites.
- `OutboundSms.kind` is `OutboundSmsKind` union (Task 1) — `'missed_call_response'` and `'manual_lead_reply'` are the two literal values. Tasks 6, 7, 8 all use these spellings.
- `lead-{phoneDigits}-{dateISO}` doc id format — Task 6's `_computeLeadId` is the canonical implementation. Task 7's drainer doesn't touch this format. Task 8's test lead uses a different prefix (`lead-test-`) but the same shape afterwards.
- `'TWILIO_NOT_CONFIGURED'` sentinel string — SP4A's `twilioClient.ts` throws; SP4B's `drainOutboundSms.ts` catches (Task 7). Same string. **Do not rename without coordinating across both files.**
- `'TWILIO_SIGNATURE_INVALID'` sentinel string — Task 5 throws; Task 6 catches. Same string.
- `computeLeadPriority` signature: `(customer | null | undefined, lead) → { score, badges }`. Used in Task 12 (LeadCard) and Task 14 (Leads sort). Same signature both sites.

**Known limitations the plan does NOT address (and shouldn't):**
- Twilio number provisioning UI — future SP.
- Inbound SMS reply ingestion — SP4C.
- Lead assignment automation — SP5.
- Lead aging alerts — SP5.

---

## Handoff prompt

You're picking up SP4B — Missed Call Recovery. The spec is at `docs/superpowers/specs/2026-06-04-sp4b-missed-call-recovery-design.md`; this plan is at `docs/superpowers/plans/2026-06-04-sp4b-missed-call-recovery.md`. Work through tasks 1-17 in order. Use TDD strictly.

Repo facts worth pinning:

- `npm test` runs every `tests/*.test.ts` via `tsx`. Tests use a hand-rolled `check()` counter; no Vitest. New tests live flat at `tests/*.test.ts`.
- Functions can't import from `src/`. SP4B reuses SP4A's already-duplicated `reviewTemplate` mirror at `functions/src/lib/reviewTemplate.ts` — don't touch it.
- Firebase admin imports use the modular API: `import { Timestamp, FieldValue } from 'firebase-admin/firestore'`. Namespace `admin.firestore.X` access fails at runtime in the emulator (SP3 hot-fix in commit 810a31c).
- `usePermissions()` / `useMembership()` hook must be called inside a component rendered under `MembershipProvider`. SP4B's accordion + LeadDetailSheet render inside the provider tree, so it's safe.
- The settings AccordionShell pattern: see `src/components/settings/ReviewAutomationSection.tsx` (SP4A Task 11) for the canonical shape. SP4B Task 10 mirrors it.
- The Member shape on this codebase has NO `phoneE164` field (SP4A discovered this). Task 10's test-phone input defaults to empty string + operator types.
- v2 schedule: `import { onSchedule } from 'firebase-functions/v2/scheduler'`; cron `'every 1 minutes'` (plural).
- v2 HTTPS: `import { onRequest } from 'firebase-functions/v2/https'` for the webhook (NOT onCall — Twilio POSTs form-encoded). `import { onCall, HttpsError } from 'firebase-functions/v2/https'` for the callables.
- `twilio` npm package is installed in Task 5. Don't try to `npm install` it again.
- Emulator dev tenant: businessId `dev-business`, admin user `admin@localhost.dev` / `dev-password-1234`.
- Java 21 is required for the Firestore emulator smoke. `brew install openjdk@21` if `java -version` shows the macOS stub.

The implementer subagent should match existing patterns rather than impose new ones. If the actual `Member` / `Customer` / `Job` field shape differs from this plan's assumptions, use the EXISTING field names — don't invent. When in doubt, grep first.

End of plan. Good luck.
