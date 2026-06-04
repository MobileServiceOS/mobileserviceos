# SP4A — Review Automation — Design

**Date:** 2026-06-03
**Status:** Approved (with 8 additions from operator review)
**Scope:** SP4A. First sub-project under the SP4 communications umbrella. Wires the outbound-SMS sending half (review-request flow) without depending on inbound Twilio webhooks. SP4B (incoming call/SMS webhook ingest + missed-call leads) and SP4C (auto-text-back) sit downstream.

---

## Goal

When a job's status flips to **Completed**, queue a Google-review-request SMS that drains automatically once Twilio is connected. Architecture must work today (Twilio off) and tomorrow (Twilio on) without code change. Operator controls the toggle, delay, template, and Google review URL via Settings → Review Automation.

---

## Architecture

Four moving parts, all server-side.

### 1. `onJobCompletedReviewRequest` Firestore trigger

File: `functions/src/onJobCompletedReviewRequest.ts`

Fires on every write to `businesses/{businessId}/jobs/{jobId}`. Inside, a chain of guards decides whether to enqueue:

```ts
if (before?.status === 'Completed')        return; // already-completed edit
if (after.status !== 'Completed')          return; // not a completion event
if (after.reviewRequestSent === true)      return; // idempotency layer 1
if (!settings.reviewAutomationEnabled)     return; // operator opted out
if (!settings.googleReviewLink?.trim())    return; // addition #7
if (!customer.phoneE164)                   return; // no number to text
// All guards passed — render template, enqueue, flip flag.
```

The trigger reads the Customer doc (for phoneE164 + firstName + lastName), the Vehicle doc if any (for {vehicle}), and the Settings doc (for businessName + template + delay + reviewLink). It then computes `sendAfterAt = completedAt + delayMinutes * 60_000` and writes:

- **Customer-keyed transaction (atomic):**
  1. `reviewRequests/{requestId}` ← full queue entry (`status: 'pending'`)
  2. `jobs/{jobId}` ← merge `{ reviewRequestSent: true, reviewRequestId: '{requestId}' }`

Both succeed or both fail. The transaction prevents the "SMS fired but flag write lost" failure mode.

### 2. `reviewRequests` queue collection

Path: `businesses/{businessId}/reviewRequests/{requestId}`

Doc id pattern: `req-{jobId}-{completedDateISO}` (e.g. `req-job_abc123-2026-06-03`). Re-saving a Completed job the same day = same id = no duplicate. Months later = new date suffix = new request (intentional).

Schema:

```ts
interface ReviewRequest {
  id: string;
  // ─── Source refs ─────────────────────────────────
  jobId: string;
  customerId: string;
  phoneE164: string;
  // ─── Rendered content ────────────────────────────
  templateUsed: string;       // raw template at enqueue time (for audit)
  templateRendered: string;   // final SMS body sent
  // ─── Scheduling ──────────────────────────────────
  sendAfterAt: Timestamp;     // earliest send time
  status: 'pending' | 'scheduled' | 'sending' | 'sent' | 'failed' | 'cancelled';
  retryCount: number;         // capped at 3
  // ─── Outcome ─────────────────────────────────────
  createdAt: Timestamp;
  sentAt?: Timestamp;
  failedAt?: Timestamp;
  errorMessage?: string;
  // ─── Future-ready (addition #8) ──────────────────
  twilioMessageSid?: string;  // Twilio's MessageSid on send
  deliveryStatus?: string;    // 'queued' | 'sending' | 'sent' | 'delivered' | 'undelivered' | 'failed' (Twilio's lifecycle)
  carrierResponse?: string;   // raw carrier error code/message when reported
  // ─── Flags ───────────────────────────────────────
  isTest?: boolean;           // Send Test SMS path sets true; UI surfaces "TEST" badge
  isManual?: boolean;         // Send Review Request button (addition #6) sets true
  invokedByUid?: string;      // 'system:reviewAutomation' for trigger, real uid for manual/test
}
```

**Status transitions:**

- `pending` — created, awaiting `sendAfterAt`. While `sendAfterAt > now`, the drainer skips it. Once `sendAfterAt <= now` AND Twilio is connected the drainer transitions it to `sending`.
- `scheduled` — *display-only synonym* for `pending` when `sendAfterAt > now`. The UI filter "Scheduled" reads `status == 'pending' AND sendAfterAt > now`. The status field itself never stores `'scheduled'`; the drainer never has to special-case it. Filter computed at query time.
- `sending` — drainer claimed the doc, SMS call in flight. Used to prevent racing instances from double-sending.
- `sent` — Twilio returned a MessageSid. `sentAt`, `twilioMessageSid`, `deliveryStatus: 'queued'` (Twilio's initial state) populated.
- `failed` — 4xx or retryCount exhausted. `errorMessage` populated.
- `cancelled` — operator action (history view → cancel button on a pending row).

### 3. `drainReviewRequests` scheduled function

File: `functions/src/drainReviewRequests.ts`

Cron: every 1 minute (Cloud Scheduler trigger).

Algorithm per tick:

```
For each businessId in active-tenant cache:
  Query: reviewRequests where status='pending' AND sendAfterAt <= now, limit 50
  For each pending request:
    Read settings.twilioConnected.
    If false: leave pending (no log spam, no retry counter bump).
    If true:
      Transactional flip: status='pending' → status='sending'
        (skip on retry-loss; another instance already claimed)
      Call sendSMS via twilioClient
        success: status='sent', twilioMessageSid, deliveryStatus='queued',
                 communicationEvents log appended
        4xx:     status='failed', errorMessage = carrier code
                 communicationEvents log appended (type='review_request_failed')
        5xx:     status='pending' again, retryCount += 1
                 if retryCount >= 3: status='failed' (transient retries exhausted)
```

The 1-minute granularity is the cost of dropping Cloud Tasks. "Immediate" delay actually means "within 1 minute". Acceptable per the operator brief.

### 4. `twilioClient` helper

File: `functions/src/lib/twilioClient.ts`

Reads `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_PHONE_NUMBER` from Secret Manager (configured at SP4 main deploy). Returns `MessageSid` on success.

Throws `'TWILIO_NOT_CONFIGURED'` when env vars missing — drainer catches this specific error and **leaves the queue entry at `pending`** (no `failed` transition, no retry counter bump). This is the seam that lets SP4A ship dormant.

The first Twilio-actual-call ships in SP4B when the operator wires up their account. SP4A imports the helper and exercises the contract via the test harness.

---

## Template engine

File pair: `functions/src/lib/reviewTemplate.ts` + `src/lib/reviewTemplate.ts` (byte-identical mirror).

```ts
export interface TemplateVars {
  firstName?: string;
  lastName?: string;
  businessName?: string;
  serviceType?: string;
  city?: string;
  vehicle?: string;
  reviewLink?: string;
}

export function renderTemplate(template: string, vars: TemplateVars): string;
```

**Supported placeholders (addition #1):**

| Placeholder | Source |
|---|---|
| `{firstName}` | Customer name → first word; "Maria Lopez" → "Maria" |
| `{lastName}`  | Customer name → words 2..n; "Maria Sofia Lopez" → "Sofia Lopez" |
| `{businessName}` | `settings.businessName` (addition #2 — never hardcoded) |
| `{serviceType}` | `job.service` |
| `{city}` | `job.city`, else `job.area`, else `settings.serviceArea`, else empty (addition #3) |
| `{vehicle}` | `vehicle.vehicleMakeModel`, else `{year} {make} {model}`, else empty |
| `{reviewLink}` | `settings.googleReviewLink` |

**Smart-empty stripping (addition #3):**

If a placeholder evaluates to empty string, the renderer ALSO strips the connective phrase that would produce broken grammar. Specifically:

- `" in {city}"` → `""` when city is empty
- `" for your {vehicle}"` → `""` when vehicle is empty
- `" {lastName}"` → `""` when lastName is empty

The strip patterns are pure-text regexes co-located with the helper. Tests cover each. Unknown placeholders (`{foo}`) are left literal so operators see their typo.

**Default template** (in `src/lib/defaults.ts`):

```ts
export const DEFAULT_REVIEW_TEMPLATE =
  'Hi {firstName}, thanks for choosing {businessName} for your {serviceType} in {city}. ' +
  'We’d appreciate a quick Google review: {reviewLink}';
```

For Maria Lopez, Wheel Rush Dev Tenant, Tire Replacement, Hollywood:

> "Hi Maria, thanks for choosing Wheel Rush Dev Tenant for your Tire Replacement in Hollywood. We'd appreciate a quick Google review: https://g.page/r/..."

For a customer with no city set:

> "Hi Maria, thanks for choosing Wheel Rush Dev Tenant for your Tire Replacement. We'd appreciate a quick Google review: https://g.page/r/..."

---

## Settings schema additions

```ts
interface Settings {
  // existing fields...
  reviewAutomationEnabled: boolean;       // default false
  reviewSmsTemplate: string;              // default DEFAULT_REVIEW_TEMPLATE
  reviewDelayMinutes: 0 | 5 | 15 | 60;    // default 0 (Immediate ≈ 1min poll)
  googleReviewLink: string;               // default ''
  serviceArea?: string;                   // operator's primary service area
                                          // (addition #3 fallback for {city})
}
```

`serviceArea` may already exist on the Settings shape. Confirm at implementation time; if absent, add it.

---

## UI — `ReviewAutomationSection` accordion

File: `src/components/settings/ReviewAutomationSection.tsx`

Renders between Communications and Owners & Permissions in Settings.tsx.

Sections in order:

1. **Enable toggle** — bound to `reviewAutomationEnabled`. Owner/admin via `canEditBusinessSettings`. Default OFF.

2. **Warning banner (addition #7)** — visible when `reviewAutomationEnabled && !googleReviewLink.trim()`:
   > "⚠ Set your Google Review URL below to enable automation. Without it, no SMS is queued."

3. **Google Review URL input** — `settings.googleReviewLink`. Save on blur. Inline validation: must start with `http://` or `https://`. Hint text: "Find at: business.google.com → Customers → Reviews → Get more reviews."

4. **Delay picker** — radio chip group: Immediate / 5 min / 15 min / 1 hr. Maps to `reviewDelayMinutes` integer.

5. **Template editor** — textarea bound to `reviewSmsTemplate`. Save on blur. 7-character variable legend rendered below the textarea (addition #1):
   > Available: `{firstName}` · `{lastName}` · `{businessName}` · `{serviceType}` · `{city}` · `{vehicle}` · `{reviewLink}`

6. **Live preview pane** — renders the current template against:
   - The most-recent Completed job in the business (last 30d), OR
   - A static fallback ("Sample Customer / Honda Civic / Tire Repair / Hollywood") when no completed job exists
   - Pure-client render — never hits the network — uses the `src/lib/reviewTemplate.ts` mirror

7. **Send Test SMS form**
   - Phone input (defaults to operator's own number from member doc)
   - "Send Test" button → calls `sendTestReviewSms` HTTPS callable → enqueues a `reviewRequests` doc with `isTest: true` + `sendAfterAt: now`
   - When Twilio off: status banner "Test queued — connect Twilio to actually send"
   - Result appears in the history table below with TEST badge

8. **Review Request History table (addition #4)** — owns the bottom 60% of the accordion when expanded.
   - Status filter chips: All / Pending / Scheduled / Sent / Failed / Cancelled (multi-select-or-single — single is simpler)
     - "Scheduled" filter = `status == 'pending' AND sendAfterAt > now` (computed)
     - "Pending" filter = `status == 'pending' AND sendAfterAt <= now` (ready to drain but Twilio off)
   - Search input — substring match on customerName / phoneE164 / jobId. Client-side filter over the loaded set (last 100 by createdAt desc).
   - Row: customer name · phone (formatted) · status pill · createdAt · sentAt · job link · TEST/MANUAL badge
   - Tap row → expands inline to show full `templateRendered` text + errorMessage if failed + Cancel button if pending

---

## CustomerProfile Communication History wire-up

The placeholder section already exists (rendered as "Calls and texts appear here once Twilio is connected."). This task replaces the placeholder text with:

1. **Review Requests section (addition #5)** — pulls from `reviewRequests where customerId == cid` ordered by `createdAt desc`, limit 20. Each row:
   - Date (createdAt)
   - Status pill
   - Sent date (sentAt, when present, else "—")
   - Brief preview of templateRendered (first 60 chars)
   - Tap → modal with full body + errorMessage

2. **Communication Events section** — pulls from `communicationEvents where customerId == cid` ordered by `sentAt desc`, limit 20. SP4A only writes to this collection on `sent` and `failed` outcomes, so for now it's a subset of the Review Requests view. SP4B will add inbound calls/SMS and the two views will diverge.

Both render as collapsible sub-sections under the existing "Communication History" header.

---

## Manual Review Request (addition #6)

A new button on the Job detail surface (JobDetailModal):

- Visible when `job.status === 'Completed'`
- Disabled with tooltip when `job.reviewRequestSent === true` → "Already requested — see Review history"
- Disabled with tooltip when `!settings.googleReviewLink || !settings.reviewAutomationEnabled` → "Enable Review Automation + set Review URL in Settings"
- Active state → button label "Send Review Request"

Click flow:

1. Confirm modal: "Send a review request SMS to {customerName} at {phoneE164}?"
2. On confirm → calls `sendManualReviewRequest` HTTPS callable (separate from the test callable so the audit trail differs)
3. Callable enqueues with `isManual: true`, `sendAfterAt: now` (manual override on delay), `invokedByUid: req.auth.uid`
4. Returns the requestId — UI navigates to the history table with that row highlighted

Same idempotency: doc id is the same `req-{jobId}-{dateISO}`. Re-clicking same day = same doc = no duplicate. Different day = new request (matches the auto-trigger semantics).

---

## `communicationEvents` schema (built minimally for SP4A; extends for SP4B)

Path: `businesses/{businessId}/communicationEvents/{eventId}`

```ts
interface CommunicationEvent {
  id: string;
  type: 'review_request_sent' | 'review_request_failed' | 'review_request_skipped';
  // SP4B will add: 'incoming_call' | 'incoming_sms' | 'missed_call' | 'auto_text_back_sent'
  channel: 'sms' | 'call' | 'email';
  direction: 'outbound' | 'inbound';
  customerId: string;
  jobId?: string;
  reviewRequestId?: string;
  content?: string;        // rendered SMS body for sent events
  status: 'sent' | 'failed' | 'queued' | 'skipped';
  providerMessageId?: string;  // Twilio MessageSid
  deliveryStatus?: string;     // future-ready
  carrierResponse?: string;    // future-ready
  sentAt: Timestamp;
  createdByUid: string;        // 'system:reviewAutomation' | uid for manual
}
```

Writes are admin-SDK-only (Cloud Function path). Client reads only.

---

## firestore.rules additions

```
match /businesses/{businessId} {
  // ... existing rules ...

  // SP4A — Review queue. Client reads only; writes via admin SDK.
  match /reviewRequests/{requestId} {
    allow read: if isMemberOfBusiness(businessId);
    allow write: if false;
  }

  // SP4A — Unified communication event log. Same access pattern.
  match /communicationEvents/{eventId} {
    allow read: if isMemberOfBusiness(businessId);
    allow write: if false;
  }
}
```

Cloud Functions use admin SDK which bypasses rules. Client manual + test send paths route through HTTPS callables, never write directly.

---

## firestore.indexes.json additions

Two composite indexes needed:

```json
{
  "collectionGroup": "reviewRequests",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "status", "order": "ASCENDING" },
    { "fieldPath": "sendAfterAt", "order": "ASCENDING" }
  ]
}
```

Powers the drainer query (`status == 'pending' AND sendAfterAt <= now`).

```json
{
  "collectionGroup": "reviewRequests",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "customerId", "order": "ASCENDING" },
    { "fieldPath": "createdAt",  "order": "DESCENDING" }
  ]
}
```

Powers the CustomerProfile "Review Requests" section.

The Settings history table query (`status == X AND createdAt DESC, limit 100`) is covered by Firestore's auto single-field index — no composite needed.

---

## Idempotency layers

1. **Doc id** = `req-{jobId}-{completedDateISO}`. Same job + same day = same doc. Two identical writes hit `setDoc(..., {merge: true})` and produce one row.
2. **`reviewRequestSent: true`** on the Job. Trigger checks this BEFORE any work. Set transactionally with the enqueue.
3. **Transactional flip `pending → sending`** in the drainer. Two instances racing to drain the same doc: only one wins the flip, the other sees the doc is now `sending` and skips.
4. **`sentAt` non-empty check** before any subsequent re-send attempt — belt-and-suspenders.

---

## What ships dormant (acceptable per v3.1 priority lock)

- **Without Twilio:** the trigger still fires on job completion, the queue still writes, the drainer still polls. Items sit at `pending` indefinitely. The history table shows them with "Pending — Twilio not connected" subline (computed in UI from `status == 'pending'` and a settings-derived `twilioConnected === false`).
- **When operator connects Twilio later (SP4B):** the existing queue drains automatically on the next 1-min poll. Zero code change. No operator action required beyond flipping `settings.twilioConnected = true`.

---

## Test plan

### Pure helpers — `tests/reviewTemplate.test.ts`

- Renders all 7 placeholders
- Strips `" in "` when `{city}` empty
- Strips `" for your "` when `{vehicle}` empty
- Strips `" "` (single space) between adjacent name placeholders when `{lastName}` empty
- Returns literal `{unknown}` for non-supported placeholders (so operators see typos)
- Pure function — same input → same output, no side effects

### Trigger — `functions/tests/onJobCompletedReviewRequest.test.ts`

- Skips when `before.status === 'Completed'` (edit of already-completed job)
- Skips when `after.status !== 'Completed'`
- Skips when `reviewRequestSent === true`
- Skips when `settings.reviewAutomationEnabled === false`
- Skips when `settings.googleReviewLink === ''`
- Skips when `customer.phoneE164` absent
- Fires when all guards pass — writes reviewRequests doc + flips job flag
- Transactional integrity: simulated write failure of either side leaves both untouched

### Drainer — `functions/tests/drainReviewRequests.test.ts`

- Selects only `status == 'pending' AND sendAfterAt <= now`
- Twilio-off path: leaves pending, no retryCount increment, no errorMessage
- Twilio 4xx: status=failed, no retry
- Twilio 5xx: retryCount += 1, leaves pending; at 3 → status=failed
- Twilio success: status=sent, twilioMessageSid set, deliveryStatus='queued', communicationEvents row written
- Racing instances: transactional flip prevents double-send

### Manual + Test SMS callables — `functions/tests/manualReviewRequest.test.ts` (consolidated)

- `sendTestReviewSms` enqueues `isTest: true`
- `sendManualReviewRequest` enqueues `isManual: true`
- Both: idempotent on doc id

### End-to-end (against emulator)

1. Settings toggle ON + paste Google Review URL + save
2. Save a job for Maria Lopez, status=Completed
3. Verify `reviewRequests/req-{jobId}-{date}` appears within 5s
4. Verify CustomerProfile shows pending request
5. Open Settings → Review Automation history table shows pending request
6. (With Twilio off): wait 90s, verify still pending
7. Click manual "Send Review Request" on Maria's completed job → confirms idempotency (no duplicate)

---

## Files

**Create (10):**
- `functions/src/onJobCompletedReviewRequest.ts`
- `functions/src/drainReviewRequests.ts`
- `functions/src/sendTestReviewSms.ts`
- `functions/src/sendManualReviewRequest.ts`
- `functions/src/lib/twilioClient.ts`
- `functions/src/lib/reviewTemplate.ts`
- `src/lib/reviewTemplate.ts` (client mirror)
- `src/components/settings/ReviewAutomationSection.tsx`
- `tests/reviewTemplate.test.ts`
- `functions/tests/reviewAutomation.test.ts` (consolidates trigger + drainer + callable tests)

**Modify (8):**
- `functions/src/index.ts` (4 new exports — trigger, drainer, 2 callables)
- `src/types/index.ts` (Settings additions + ReviewRequest + CommunicationEvent types)
- `src/lib/defaults.ts` (DEFAULT_REVIEW_TEMPLATE + reviewDelayMinutes default)
- `src/pages/Settings.tsx` (accordion wire-in)
- `src/pages/CustomerProfile.tsx` (Review Requests section + Communication Events section)
- `src/components/JobDetailModal.tsx` (manual "Send Review Request" button on Completed jobs)
- `firestore.rules` (reviewRequests + communicationEvents)
- `firestore.indexes.json` (2 composite indexes)

---

## Out of scope (SP4A)

- Two-way reply handling (customer replies to the review SMS) — SP4B's webhook ingest
- Per-customer suppression list (do-not-text flag on Customer doc) — SP4C
- A/B testing of templates
- Multi-language templates
- Quiet hours / scheduled overrides ("no SMS on Sundays")
- Cloud Tasks delay primitive (poller is sufficient at SP4A scale)
- Twilio Messaging Service routing — SP4 main spec covers
- Receipt/delivery webhook ingestion (`deliveryStatus` field future-ready but not populated until SP4B's status-callback webhook lands)
- Inbound SMS reply attaching to the request — SP4B
- Bulk-send / scheduled-batch review requests — SP7

---

## Acceptance criteria

1. Save a job → status flip to Completed → `reviewRequests` doc appears with `status='pending'` within 5 seconds (the trigger latency)
2. With Twilio off + Settings toggle ON + reviewLink set: stays `pending` indefinitely. No errors.
3. Settings toggle OFF → no reviewRequest doc created on completion
4. Delay = 15min → `sendAfterAt` = completedAt + 15min, drainer respects it (with 1min poll granularity)
5. Send Test SMS button → `reviewRequests` doc with `isTest: true` enqueued, surfaces in history with TEST badge
6. Manual "Send Review Request" button on a Completed job → enqueues with `isManual: true`, idempotent on doc id
7. Template preview renders live as operator edits the textarea — using real customer when available, fallback otherwise
8. Settings warning banner appears when toggle ON but reviewLink is empty (addition #7) — trigger also refuses to enqueue
9. City fallback (addition #3): customer with no city set → SMS body contains "your Tire Replacement." (no "in undefined")
10. CustomerProfile shows Review Requests section + Communication Events section, both populated for the customer
11. History filter chips work: Pending / Scheduled / Sent / Failed / Cancelled — each shows the correct subset (addition #4)
12. History search by name / phone / jobId returns matching rows
13. ReviewRequest schema future-ready fields (`deliveryStatus`, `carrierResponse`, `twilioMessageSid`) exist on every doc, populated when Twilio sends (addition #8)
14. Re-completing the same job same day = no duplicate doc (idempotent doc id)

---

## Sign-off

Approved by operator on 2026-06-03 with 8 additions:
1. Dynamic vars expanded to 7 (added `{lastName}`, `{vehicle}`)
2. businessName sourced from Settings (never hardcoded)
3. City fallback chain + smart-empty stripping ("never 'in undefined'")
4. History filters: Pending / Scheduled / Sent / Failed / Cancelled + search
5. CustomerProfile Review Requests section
6. Manual "Send Review Request" button on completed jobs
7. Google Review Link validation + Settings warning banner
8. Future-ready fields: `deliveryStatus`, `carrierResponse`, `twilioMessageSid`

Implementation plan to be authored next via the `writing-plans` skill.
