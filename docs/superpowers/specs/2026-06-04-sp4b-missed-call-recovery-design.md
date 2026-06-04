# SP4B — Missed Call Recovery — Design

**Date:** 2026-06-04
**Status:** Approved (3 architectural calls blessed + Wheel Rush enrichment requirements)
**Scope:** SP4B. Second sub-project under the SP4 communications umbrella. Inbound side: missed-call detection via Twilio voice status callback, automatic Lead creation, automatic acknowledgment SMS, Lead workflow state machine, dedicated Lead Queue dashboard. Builds on SP4A's outbound rails — reuses `renderTemplate`, `twilioClient.sendSms`, and the dormant-mode `TWILIO_NOT_CONFIGURED` sentinel.

---

## Goal

When a caller dials the operator's Twilio number and nobody picks up:

1. Twilio fires a voice status-callback webhook.
2. The handler matches the caller against the Customer CRM (or creates a new Customer if unknown).
3. A Lead doc is written with status='New', source='missed_call'.
4. If `missedCallAutoTextEnabled` is ON, an acknowledgment SMS is enqueued and drained on the next tick.
5. The Lead surfaces in a dedicated **Leads** queue tab so the operator can work it manually.

Architecture must work today (operator has hand-configured their Twilio number + status-callback URL in the Twilio Console + pasted the number into Settings) and degrade gracefully when missed-call auto-text is OFF (Lead is still created, no SMS sent).

---

## Architecture

Four moving parts: one new public HTTPS webhook, one new collection (Lead), one new outbound queue (outboundSms), one new UI surface cluster (Leads tab + Settings accordion + LeadDetailSheet + CustomerProfile sub-section).

### 1. `twilioVoiceStatus` HTTPS webhook

File: `functions/src/twilioVoiceStatus.ts`

Public HTTPS Cloud Function. Twilio POSTs here on every call completion (operator configures this URL in the Twilio Console manually — out of scope to provision).

Request flow:

1. **Signature validation.** `twilio.validateRequest(authToken, headers['x-twilio-signature'], fullUrl, params)`. Forged requests → 403, no write, log to `console.error`.
2. **Parse form body.** `From` (E.164), `To` (E.164), `CallSid`, `CallStatus`, `CallDuration`, `Direction`.
3. **Filter.** Proceed only when `Direction === 'inbound'` AND `CallStatus ∈ {'no-answer','busy','failed'}`. Anything else (`completed`, `in-progress`, `outbound-*`) → 200 OK no-op.
4. **Route to business.** Collection-group query: `db.collectionGroup('settings').where('twilioPhoneNumber','==', To).limit(1)`. Extract `businessId` from `doc.ref.parent.parent.id`. No match → 200 OK no-op + `console.warn` (mis-configured operator).
5. **Normalize `From`.** Reuse SP1's `normalizePhone`. Invalid → log + 200 OK no-op.
6. **Dedup check.** Query `businesses/{bid}/leads` where `phoneE164 == From AND receivedAt > now - 24h`. If a Lead exists → 200 OK no-op (silent dedup).
7. **Customer lookup.** `lookupCustomerByPhone(businessId, From)`. Existing → use `customerId`. New → create a Customer doc with phoneE164-only identity (mark `kind: 'individual'`, no jobs yet) and remember `wasNewCustomer = true`.
8. **Write Lead doc.** Transactional: re-check dedup inside the tx, then `tx.set(leadRef, {...})`.
9. **Enqueue outboundSms.** Only when `settings.missedCallAutoTextEnabled === true`. Same transaction as the Lead write so the two stay consistent.
10. **Log communicationEvent.** `type: 'missed_call_received'`, with `leadId`, `customerId`, `callSid`.
11. **Return 200 OK** to Twilio. Always 200 even on internal failures (log loudly) so Twilio doesn't initiate a retry storm.

### 2. `leads` collection

Path: `businesses/{businessId}/leads/{leadId}`

Doc id pattern: `lead-{phoneDigits}-{dateISO}` (e.g. `lead-3055551234-2026-06-04`). Same caller + same day = same doc = silent dedup. Reset daily.

Schema:

```ts
type LeadStatus = 'New' | 'Contacted' | 'Quoted' | 'Booked' | 'Closed' | 'Lost';
type LeadSource = 'missed_call' | 'inbound_sms' | 'manual';
type CallStatus = 'no-answer' | 'busy' | 'failed' | 'voicemail';

interface Lead {
  id: string;
  customerId: string;            // FK → Customer; new Customer created if caller unknown
  phoneE164: string;
  source: LeadSource;
  status: LeadStatus;
  wasNewCustomer: boolean;       // true when the caller was unknown at first touch
                                 //   drives the "New Customer" badge on LeadDetailSheet

  // ── First-touch metadata ─────────────────────────
  callSid?: string;
  callStatus?: CallStatus;
  receivedAt: Timestamp;

  // ── Auto-text outcome ────────────────────────────
  autoTextSent: boolean;         // flips to true after the drainer succeeds
  autoTextSentAt?: Timestamp;
  outboundSmsId?: string;        // FK → outboundSms queue

  // ── Operator workflow ────────────────────────────
  notes?: string;                // free-form, save-on-blur from LeadDetailSheet
  assignedToUid?: string;
  jobId?: string;                // populated when status='Booked'
  closedAt?: Timestamp;
  closedReason?: string;         // free-form, required when status='Lost'

  // ── Audit ────────────────────────────────────────
  createdAt: Timestamp;
  updatedAt: Timestamp;
  lastEditedByUid: string;       // 'system:missedCallRecovery' on create
}
```

**Status transitions are operator-driven, NEVER automatic.** A customer texting back into the auto-text does NOT auto-bump the status. The operator manually advances the state machine. The legal transitions are:

```
New ──→ Contacted ──→ Quoted ──→ Booked ──→ Closed
  ↓         ↓           ↓          ↓
  └─────────┴───────────┴──────────┴────→ Lost
```

(Any state can transition to `Lost`. `Closed` is the terminal success state; `Lost` is the terminal failure state.) The Lead rules at the Firestore level enforce only "status is in the legal enum"; the state-machine policing is UI-only.

### 3. `outboundSms` queue

Path: `businesses/{businessId}/outboundSms/{smsId}`

Sibling to SP4A's `reviewRequests`. Same drainer DNA. Separate collection, separate drainer, separate indexes — per the operator's "two queues, two drainers" decision.

Doc id patterns:
- `sms-{leadId}` for missed-call auto-text (one auto-text per Lead, idempotent)
- `sms-manual-{leadId}-{epochMs}` for operator-typed ad-hoc messages from LeadDetailSheet
- `sms-test-{uid}-{epochMs}` for the "Send Test Missed Call" admin button

Schema:

```ts
type OutboundSmsKind = 'missed_call_response' | 'manual_lead_reply';

interface OutboundSms {
  id: string;
  kind: OutboundSmsKind;

  // Source refs — leadId always present for SP4B
  leadId: string;
  customerId: string;
  phoneE164: string;

  templateUsed: string;
  templateRendered: string;

  sendAfterAt: Timestamp;        // always 'now' for missed-call (no delay setting)
  status: 'pending' | 'sending' | 'sent' | 'failed' | 'cancelled';
  retryCount: number;

  createdAt: Timestamp;
  sentAt?: Timestamp;
  failedAt?: Timestamp;
  errorMessage?: string;

  twilioMessageSid?: string;
  deliveryStatus?: string;
  carrierResponse?: string;

  isTest?: boolean;              // 'Send Test Missed Call' admin path
  isManual?: boolean;            // operator-typed ad-hoc send
  invokedByUid: string;          // 'system:missedCallRecovery' or real uid
}
```

### 4. `drainOutboundSms` scheduled function

File: `functions/src/drainOutboundSms.ts`

`onSchedule('every 1 minutes')`. Reads from `outboundSms` collection. Logic structurally identical to SP4A's `drainReviewRequests` — same TWILIO_NOT_CONFIGURED path, same 4xx/5xx/success transitions, same transactional `pending → sending` race protection, same communicationEvents logging.

Only difference: this drainer writes `outbound_sms_sent` / `outbound_sms_failed` event types instead of the review-request ones. On success it also flips the parent `lead.autoTextSent = true` + `lead.autoTextSentAt = now`.

---

## Template engine

SP4B **reuses SP4A's `renderTemplate` helper unchanged.** No new placeholders, no engine changes.

New default template at `src/lib/defaults.ts`:

```ts
export const DEFAULT_MISSED_CALL_TEMPLATE =
  'Hi, thanks for contacting {businessName}.\n\n' +
  'Please reply with:\n\n' +
  '1. Your location\n' +
  '2. Vehicle\n' +
  '3. Tire size (if known)\n' +
  '4. Service needed\n\n' +
  "We'll get back to you shortly.";
```

The default uses **only `{businessName}`** — no `{firstName}`. Reason: the caller may be an unknown customer; sending "Hi , thanks..." with an empty firstName slot would read awkwardly. Operators who only serve repeat customers can edit the template to add `{firstName}` themselves; the renderer substitutes empty strings for missing values either way.

(SP4A's smart-empty strip patterns already handle `" {lastName}"`, `" in {city}"`, `" for your {vehicle}"`. We do NOT add a `"Hi {firstName}, " → "Hi, "` pattern in SP4B — the default avoids the problem, and edited templates with `{firstName}` are an operator choice.)

---

## Settings additions

```ts
interface Settings {
  // existing fields...

  // SP4B
  twilioPhoneNumber?: string;        // operator-provided E.164 (routing key)
  twilioPhoneNumberSid?: string;     // operator-provided PNxxx sid (debug)
  missedCallTemplate?: string;       // default DEFAULT_MISSED_CALL_TEMPLATE
  // missedCallAutoTextEnabled?: boolean — already exists from SP1
}
```

`DEFAULT_SETTINGS` extended:

```ts
twilioPhoneNumber: '',
missedCallTemplate: DEFAULT_MISSED_CALL_TEMPLATE,
// missedCallAutoTextEnabled already defaulted false in SP1
```

`twilioPhoneNumberSid` left undefined by default (optional debug field).

---

## UI

### Settings → Missed Call Recovery accordion

File: `src/components/settings/MissedCallRecoverySection.tsx`

Sibling to `ReviewAutomationSection`. Renders between Review Automation and Owners & Permissions in `Settings.tsx`.

Sub-sections in order:

1. **Enable toggle** — bound to `missedCallAutoTextEnabled`. Default OFF.
2. **Warning banner** — visible when `missedCallAutoTextEnabled && !twilioPhoneNumber.trim()`:
   > "⚠ Set your Twilio number below to enable missed-call recovery. Without it, no calls can be routed."
3. **Twilio Phone Number input** — `settings.twilioPhoneNumber`, E.164 validated on blur (regex `^\+[1-9]\d{6,14}$`). Save on blur. Hint text:
   > "Enter the Twilio number your customers call. In Twilio Console → Phone Numbers → [Number] → Voice & Fax, set the **Status Callback URL** to: `https://{region}-{project}.cloudfunctions.net/twilioVoiceStatus`"
4. **Twilio Phone Number SID input (optional)** — `settings.twilioPhoneNumberSid` for operator's own reference / debugging.
5. **Template editor** — textarea bound to `missedCallTemplate`, save on blur. 7-variable legend below (same as SP4A — reuses the same `renderTemplate` engine).
6. **Live preview pane** — pure-client `renderTemplate` against an "unknown caller" sample (`{firstName}` = empty) + the operator's businessName. Updates as operator types.
7. **Send Test Missed Call** (owner+admin only) — admin button. Calls `sendTestMissedCall` HTTPS callable → synthesizes a fake Lead (status='New', wasNewCustomer=false, customerId pointing at the caller's own member doc) + enqueues outboundSms with `isTest:true`. Result appears in the Recent Leads list below + the main Leads tab.
8. **Recent Leads** (read-only) — last 5 leads sorted by `receivedAt` desc with status pill. Tap → opens `LeadDetailSheet`. Shows TEST badge for test sends.

### New top-level nav tab: Leads

File: `src/pages/Leads.tsx`. New `'leads'` value on the `TabId` union.

Layout:

- **Header** with total count and active-filter chip
- **Status filter chip group** — `All` / `New` / `Contacted` / `Quoted` / `Booked` / `Closed` / `Lost`. Each chip shows the count for that status (computed client-side from the loaded set).
- **Search input** — 250ms debounced, substring across `customer.name`, `phoneE164` (digits + formatted), and `lead.notes`.
- **Card list** sorted by `receivedAt` desc. Lead cards:
  - Customer name (or "Unknown caller" when `customer.name` is empty AND `lead.wasNewCustomer`)
  - Phone with tap-to-call (📞 icon)
  - Status pill with status-specific color
  - Age timeago ("12 min ago", "2 hours ago", "3 days ago")
  - Source icon (📞 missed call, 💬 inbound SMS — SP4C, 👤 manual)
  - One-line preview of the most recent `communicationEvents` entry (inbound or outbound SMS body, first 60 chars)
  - "New Customer" mini-badge when `wasNewCustomer === true`
  - Tap → opens `LeadDetailSheet`

Empty state: "No leads yet. When a customer calls and you miss the call, they'll appear here." with a Settings link.

### LeadDetailSheet (Wheel Rush enrichment)

File: `src/components/leads/LeadDetailSheet.tsx`

Full-screen modal sheet (matches `JobDetailModal` shape). Top-down sections:

**Customer Enrichment Panel** (`src/components/leads/CustomerEnrichmentPanel.tsx`, extracted for reuse):

This is the Wheel Rush enrichment requirement. Pulled live from the Customer + Vehicle + Jobs subcollections on open:

- Customer name (clickable → CustomerProfile) — or "Unknown caller" + "New Customer" badge when `wasNewCustomer`
- Phone with tap-to-call
- Address line (if known: addressLine + city + state + zipCode)
- Email (if known)
- **Most recent vehicle:** vehicleMakeModel, tire size (from the most recent Vehicle subdoc, ordered by lastServicedAt desc)
- **Last service:** date + service type + revenue (from the most recent Job, gated by `canViewFinancials`)
- **Lifetime revenue:** computed live from the customer's jobs (gated by `canViewFinancials`). **NEVER persisted on the Customer doc per SP3 privacy contract — computed at render time only.**
- **Quick Notes:** all 8 SP3 Quick Notes fields rendered as read-only chips (gateOpen, leashTheDog, parkingNotes, fragileCargo, paymentPreferred, lateNightOK, accessNotes, communicationPreference). Empty chips hidden.
- "Tap to open customer profile →" footer link

**Status section:**

- Current status pill
- Status change dropdown — radio group with all 6 statuses (state-machine validation is UI-only: legal transitions enabled, illegal greyed). Each click writes `lead.status` + `lead.updatedAt` + `lead.lastEditedByUid`.
- Required `closedReason` input when transitioning to `Lost` (modal prompt before the write commits).
- "Create Job from Lead" button (large, primary):
  - Opens AddJob (via the existing onCreateJob navigation prop from CustomerProfile)
  - Pre-fills customerId, customerName, customerPhone, vehicleMakeModel (from latest vehicle), city/state (from customer)
  - Inserts `lead.notes` into the Job's `note` field
  - On Job save: a follow-up effect writes `lead.status = 'Booked'` + `lead.jobId` to the originating Lead

**Communication thread:**

Inline SMS bubble thread. Pulled from `communicationEvents where leadId == this.leadId ORDER BY sentAt ASC`. Visual:

- Outbound bubbles (auto-text + operator manual sends) on the right, brand-color background, white text
- Inbound bubbles (customer replies — SP4C will populate these) on the left, grey background
- Each bubble shows timestamp + status pill (sent/failed/queued)
- Failed sends show inline error message + "Retry" button (re-enqueues via `sendManualOutboundSms`)

**Composer at the bottom:**

- Textarea + Send button. Calls `sendManualOutboundSms` (new HTTPS callable) with `{ businessId, leadId, body }`. Doc id `sms-manual-{leadId}-{Date.now()}`, kind=`'manual_lead_reply'`, isManual=true, sendAfterAt=now.
- Drainer picks up on next tick (or pending if Twilio off).

**Notes editor:**

- Free-text textarea bound to `lead.notes`. Save on blur. Last-edited timestamp shown below.

**Audit footer (collapsed by default):**

- `receivedAt`, `callSid`, `callStatus`, `wasNewCustomer`
- `autoTextSent` + `autoTextSentAt` + `outboundSmsId` (clickable to open SMS detail in history)
- `assignedToUid` + `createdAt` + `updatedAt` + `lastEditedByUid`

### CustomerProfile integration

Add a **Recent Leads** sub-section to `src/pages/CustomerProfile.tsx`, under the SP4A "Communication History" cluster (alongside Review Requests and Communication Events sub-sections).

- Subscribes to `leads where customerId == this.customerId ORDER BY receivedAt DESC, limit 5`
- Each row: receivedAt date + status pill + source icon + first 60 chars of `lead.notes` (or "No notes" when empty)
- Tap → opens `LeadDetailSheet`
- Empty state: "No leads yet for this customer."

---

## `communicationEvents` schema extension

SP4B extends SP4A's `CommunicationEventType` union and the `CommunicationEvent` interface.

```ts
type CommunicationEventType =
  | 'review_request_sent'             // SP4A
  | 'review_request_failed'           // SP4A
  | 'review_request_skipped'          // SP4A (reserved)
  | 'missed_call_received'            // SP4B — webhook acknowledges receipt
  | 'missed_call_auto_text_sent'      // SP4B — drainer success
  | 'missed_call_auto_text_failed'    // SP4B — drainer failure
  | 'outbound_sms_sent'               // SP4B — operator manual send success
  | 'outbound_sms_failed';            // SP4B — operator manual send failure

interface CommunicationEvent {
  // ... existing fields from SP4A
  leadId?: string;                    // SP4B addition
}
```

Producers:
- `twilioVoiceStatus` writes `missed_call_received` on every successful webhook (whether or not auto-text is enabled)
- `drainOutboundSms` writes `missed_call_auto_text_sent` / `_failed` for `kind: 'missed_call_response'`, and `outbound_sms_sent` / `_failed` for `kind: 'manual_lead_reply'`

Inbound SMS reply events (`inbound_sms_received`) are SP4C scope — the type union is not extended for them here. SP4C will add `inbound_sms_received` and the inbound SMS webhook ingestion.

---

## Webhook security

- `twilio` npm package added to `functions/package.json`.
- `twilioSignatureValidator` helper at `functions/src/lib/twilioSignatureValidator.ts` wraps `twilio.validateRequest` with consistent error handling.
- Auth token from `process.env.TWILIO_AUTH_TOKEN` (the same env var SP4A's `twilioClient` already reads).
- Validation uses the canonical Twilio recipe: full URL + sorted form params + auth token, HMAC-SHA1 → base64 → compare against `x-twilio-signature` header.
- Failed validation → 403, no Lead write, `console.error` with `{from, to, callSid}` for forensics.
- When `TWILIO_AUTH_TOKEN` is unset: validation is skipped with a `console.warn('signature validation disabled — TWILIO_AUTH_TOKEN unset')`. The webhook still processes the request (otherwise SP4B is undeployable in dev). Operator must set the env var before production exposure.

---

## Idempotency layers

1. **Lead doc id `lead-{phoneDigits}-{dateISO}`** — same caller + same day = same Lead. Multiple missed calls in 24h collapse to one row.
2. **outboundSms doc id `sms-{leadId}`** — one auto-text per Lead. Multiple webhook fires for the same Lead don't double-send.
3. **`lead.autoTextSent` flag** — webhook checks this BEFORE enqueueing. Belt-and-suspenders.
4. **`outboundSms.status` re-read inside drainer transaction** — SP4A's race protection carries over directly.

---

## firestore.rules additions

Inside `match /businesses/{businessId} { ... }`, after the SP4A `reviewRequests` + `communicationEvents` blocks:

```
// SP4B: leads — webhook writes via admin SDK; client may update workflow fields only.
match /leads/{leadId} {
  allow read:   if isMemberOfBusiness(businessId);
  allow create: if false;   // webhook only
  allow update: if isMemberOfBusiness(businessId)
               && request.resource.data.diff(resource.data).affectedKeys()
                  .hasOnly(['status','notes','assignedToUid','jobId','closedAt',
                            'closedReason','updatedAt','lastEditedByUid']);
  allow delete: if false;
}

// SP4B: outboundSms — same access pattern as SP4A reviewRequests.
match /outboundSms/{smsId} {
  allow read:  if isMemberOfBusiness(businessId);
  allow write: if false;
}
```

The webhook + callables use the admin SDK and bypass these rules.

---

## firestore.indexes.json additions

Four new entries:

```json
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

The first powers the Leads tab status filter. The second powers the CustomerProfile Recent Leads section. The third powers the drainer query. The fourth powers the webhook's business-routing query.

---

## What ships when Twilio is off

Three states the operator might be in:

1. **No Twilio account at all.** Webhook endpoint never receives traffic. Settings accordion renders, Leads tab renders empty, CustomerProfile Recent Leads renders empty. Zero log noise.

2. **Twilio account exists, env secrets set in Cloud Functions, but operator hasn't pasted their number into Settings.** Webhook receives traffic, `settings.twilioPhoneNumber` lookup returns no match → 200 OK + `console.warn`. No data is written. Operator sees no leads. The Settings accordion's warning banner is the operator's signal.

3. **Twilio account exists, number pasted into Settings, but `TWILIO_AUTH_TOKEN` / `TWILIO_ACCOUNT_SID` / `TWILIO_PHONE_NUMBER` env unset in Cloud Functions.** Webhook receives traffic, validates (with warning), routes to business, creates Lead, enqueues outboundSms. Drainer fires, hits `TWILIO_NOT_CONFIGURED` sentinel, leaves outboundSms at status=pending indefinitely. Operator sees the Lead immediately, can manually reach out. Auto-text is dormant. Same pattern as SP4A.

---

## Test plan

### Pure helpers

- Reuse SP4A's `tests/reviewTemplate.test.ts` — no new template tests. (Same engine.)
- `tests/leadEntity.test.ts` — Lead doc id construction, dedup window logic, status state-machine validity (which transitions are legal).

### Webhook handler

`tests/twilioVoiceStatus.test.ts` — exercises every guard branch via `__testHooks.decide`:

- Skips when `Direction === 'outbound-api'`
- Skips when `CallStatus === 'completed'` (caller hung up after answer)
- Skips when no business found for `To`
- Skips when `From` is invalid E.164
- Silent-dedup when a Lead from same number exists in last 24h
- Creates Customer when caller is unknown (sets `wasNewCustomer: true`)
- Reuses Customer when phone matches via the phoneKey lookup chain
- Enqueues outboundSms when `missedCallAutoTextEnabled === true`
- Skips outboundSms when `missedCallAutoTextEnabled === false` (but still writes Lead)
- Signature validation: passes when valid; throws when forged
- Returns the correct status code (200 for all paths except 403 for forged signature)

### Drainer

`tests/drainOutboundSms.test.ts` — mirrors SP4A's `drainReviewRequests.test.ts` for the outboundSms collection. Same seven paths: `TWILIO_NOT_CONFIGURED`, 4xx, 5xx-first-retry, 5xx-third-strike, success (also flips `lead.autoTextSent`), racing instances, sendAfterAt in the future.

### Callables

`tests/missedCallCallables.test.ts` — covers both `sendTestMissedCall` + `sendManualOutboundSms`:
- `sendTestMissedCall` creates a Lead with `isTest:true` flag + enqueues a corresponding outboundSms
- `sendManualOutboundSms` enqueues a new outboundSms with kind=`manual_lead_reply`, isManual=true, doc id matches `sms-manual-{leadId}-{epochMs}` pattern
- Both reject when caller is not owner+admin
- Both reject when target Lead doesn't exist

### End-to-end (against the emulator)

1. Operator: Settings → Missed Call Recovery → toggle ON, paste E.164 Twilio number, save.
2. Operator: Settings → "Fire Test Missed Call" → confirm Lead appears in Leads tab within 5s.
3. Verify Lead has `status: 'New'`, `wasNewCustomer: false` (the operator's member doc was matched), `autoTextSent: true` (after drainer tick) OR pending (when Twilio env unset).
4. Open Lead detail → verify customer enrichment renders (vehicle from latest Vehicle subdoc, tire size, last service, lifetime revenue gated by canViewFinancials, quick notes).
5. Change status to `Contacted` → confirm `lead.status` updates and `updatedAt` bumps.
6. Tap "Create Job from Lead" → AddJob opens pre-filled with customer + lead.notes in the Job note field.
7. Save the Job → `lead.status === 'Booked'` + `lead.jobId === <new job's id>`.
8. Re-fire Test Missed Call same day from same number → no duplicate Lead doc (silent dedup).
9. Send a manual SMS from LeadDetailSheet composer → new outboundSms row, drainer attempts send, kind=`manual_lead_reply`.
10. Verify CustomerProfile Recent Leads sub-section shows the lead.

---

## Files

**Create (13):**

- `functions/src/twilioVoiceStatus.ts` — public HTTP webhook handler
- `functions/src/drainOutboundSms.ts` — scheduled drainer (sibling of `drainReviewRequests`)
- `functions/src/sendTestMissedCall.ts` — HTTPS callable; owner+admin; writes test Lead + outboundSms
- `functions/src/sendManualOutboundSms.ts` — HTTPS callable; owner+admin; LeadDetailSheet composer
- `functions/src/lib/twilioSignatureValidator.ts` — signature-check helper wrapping `twilio.validateRequest`
- `src/components/settings/MissedCallRecoverySection.tsx` — Settings accordion
- `src/pages/Leads.tsx` — new top-level Leads tab
- `src/components/leads/LeadCard.tsx` — list card for Leads tab + Recent Leads sub-sections
- `src/components/leads/LeadDetailSheet.tsx` — full-screen Lead detail modal
- `src/components/leads/CustomerEnrichmentPanel.tsx` — Wheel Rush customer-context block (extracted for reuse)
- `tests/twilioVoiceStatus.test.ts`
- `tests/drainOutboundSms.test.ts`
- `tests/missedCallCallables.test.ts`

**Modify (10):**

- `functions/src/index.ts` — export the 4 new functions
- `functions/package.json` — add `twilio` dependency
- `src/types/index.ts` — `Lead`, `OutboundSms`, `LeadStatus`, `LeadSource`, `CallStatus`, `OutboundSmsKind` types; extend `CommunicationEventType`; extend `CommunicationEvent` with `leadId?`; add `'leads'` to `TabId`; add SP4B Settings fields
- `src/lib/defaults.ts` — `DEFAULT_MISSED_CALL_TEMPLATE` + `DEFAULT_SETTINGS` additions
- `src/pages/Settings.tsx` — wire `MissedCallRecoverySection` accordion between Review Automation and Owners
- `src/App.tsx` — register the `'leads'` tab route
- `src/components/AppBottomNav.tsx` — add Leads bottom-nav entry (between Customers and History likely; pin to a position that doesn't displace muscle memory)
- `src/pages/CustomerProfile.tsx` — add Recent Leads sub-section under Communication History
- `firestore.rules` — leads + outboundSms collection rules
- `firestore.indexes.json` — 4 new indexes

---

## Out of scope (SP4B)

- **Twilio number provisioning UI** (buy/port a number through Settings) — future SP. Operator manually configures Twilio Console + pastes E.164 into Settings.
- **Inbound SMS reply ingestion** (customer replies "I'm at 1234 Main St, Toyota Camry, 215/55R17, flat tire" to the auto-text) — SP4C.
- **Auto-triage of inbound replies** (regex-extract location/vehicle/tire-size + pre-fill the Lead) — SP4C+.
- **Lead assignment rules** (round-robin to technicians, geo-based assignment) — SP5.
- **Lead aging alerts** ("This lead has been New for 24h, escalate") — SP5.
- **Voicemail transcription** — depends on Twilio Voicemail product; defer.
- **Lead-to-Customer merge UI** (when operator realizes a "new customer" lead was actually an existing customer typed differently) — future, manual workaround is to edit the Customer doc.
- **Lead-source attribution beyond `missed_call | inbound_sms | manual`** (Google Ads, Yelp, referrer chain) — SP6 marketing analytics scope.
- **Multi-Twilio-number-per-business** (one biz with multiple inbound lines, e.g. main + after-hours) — future. SP4B is single-number-per-business.

---

## Acceptance criteria

1. Operator with `twilioPhoneNumber` set + `missedCallAutoTextEnabled: true`: a missed call → Lead doc appears in Leads tab within 5 seconds.
2. Same number calls again same day → no duplicate Lead (doc id dedup at the `lead-{phone}-{date}` level).
3. Toggle ON + Twilio env secrets unset: Lead is created, outboundSms stays pending indefinitely (dormant), no errors.
4. Toggle OFF: Lead is created, NO outboundSms enqueued.
5. Caller matches existing Customer by phoneE164 → `lead.customerId` points to the existing doc, `wasNewCustomer: false`.
6. Caller is unknown → Customer doc created with phoneE164-only identity, `lead.customerId` points to the new doc, `wasNewCustomer: true`.
7. LeadDetailSheet shows full customer enrichment for existing customers: latest vehicle + tire size + last service + lifetime revenue (computed live, gated by `canViewFinancials`) + all 8 SP3 Quick Notes (read-only).
8. LeadDetailSheet shows "New Customer" badge when `lead.wasNewCustomer === true`.
9. Status dropdown allows operator to move through `New → Contacted → Quoted → Booked → Closed | Lost`. All transitions are operator-controlled; none are automatic. Inbound SMS replies (when SP4C lands) do NOT auto-bump status.
10. "Create Job from Lead" pre-fills AddJob with customer data + `lead.notes` in the Job's `note` field.
11. Saving a Job created from a Lead → `lead.status = 'Booked'` + `lead.jobId = <new job's id>` automatically.
12. Settings → "Fire Test Missed Call" admin button → fake Lead appears in queue with the TEST badge, drainer attempts to send the auto-text (sits pending when Twilio off).
13. Leads tab search filters across customer name + phone (digits + formatted) + lead notes substring.
14. Leads tab status chips show the correct count per status and filter the visible list.
15. Twilio signature validation rejects forged webhook requests (403, no Lead write). When `TWILIO_AUTH_TOKEN` is unset, validation is skipped with a `console.warn`.
16. CustomerProfile shows a Recent Leads sub-section with the customer's last 5 leads.
17. LeadDetailSheet composer can send a manual outbound SMS to the Lead — enqueued as `kind: 'manual_lead_reply'`, drains via the same pipeline.
18. Closing a Lead as `Lost` prompts for and persists `closedReason`.

---

## Sign-off

Approved by operator (2026-06-04) with three architectural calls blessed:

1. **Twilio number provisioning is out of scope.** Operator hand-configures Twilio Console + pastes E.164 into Settings.
2. **No automatic Lead status transitions.** Inbound SMS replies (SP4C) are logged but do NOT auto-bump status. Operator drives the state machine.
3. **Two separate queues.** `reviewRequests` (SP4A) and `outboundSms` (SP4B) remain independent collections with independent drainers, indexes, and history.

Plus Wheel Rush enrichment requirements:

- Existing-customer detection → LeadDetailSheet shows vehicle / tire size / last service / lifetime revenue / quick notes.
- Unknown caller → Customer + Lead created automatically, `wasNewCustomer: true` flag drives the "New Customer" badge.
- Auto-text default uses `{businessName}` only (firstName omitted for caller-anonymity tolerance).

Implementation plan to be authored next via the `writing-plans` skill.
