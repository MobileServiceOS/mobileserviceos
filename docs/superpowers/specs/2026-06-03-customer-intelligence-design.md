# OpenPhone Integration + Customer Intelligence System — Design

**Date:** 2026-06-03
**Status:** Draft — pending user approval
**Scope:** Full architecture for user phases 1-12. This spec defines the data model, integration points, security model, and sub-project shipping order. Each sub-project will get its own dedicated implementation plan after the user signs off on this architecture.

---

## Goal & Success Criteria

User's stated goal (verbatim):

> "Turn MSOS into a phone-first customer intelligence system. When a customer phones our business line, every signed-in MSOS device pops a card within ~2 seconds showing who they are, what they drive, what we last did for them, and one-tap actions to answer, create a job, send a quote, or open their profile. Every time we save a job, that customer and their vehicle automatically become first-class entities — no re-keying, no double entry. Repeat customers should fly through AddJob. Missed calls should never vanish — they become leads we can work. And the whole thing has to be ready for an AI receptionist later without rewriting the data model."

Restated in implementation terms:

1. **Identity is persistent.** Customer and Vehicle stop being read-time projections and become real Firestore entities under `businesses/{businessId}/customers/{customerId}` and `customers/{customerId}/vehicles/{vehicleId}`. Job documents gain `customerId` + `vehicleId` foreign keys, written at save time. The existing derived-customers UI keeps working through a hybrid read path so we ship without a backfill.
2. **Phones are canonical.** A single `normalizePhone()` helper produces an E.164 form and a digit-only `phoneKey` used everywhere — Customer lookup, Job lookup, webhook resolution. No format-mismatch dedup failures.
3. **Inbound calls drive UI.** A new Cloud Function `quoWebhook` receives Quo (formerly OpenPhone) `call.ringing` / `call.missed` / `call.completed` events, verifies HMAC, deduplicates by `webhook-id`, resolves business + customer, and writes a Firestore doc that a real-time client listener turns into a screen-blocking popup with caller intelligence.
4. **Missed calls become leads.** Every missed-call webhook creates a `leads/{leadId}` row keyed off the same `phoneKey`, with status `new → contacted → converted | lost`.
5. **Permissions reuse what we have.** No new permission flags. Technicians see customer identity + vehicle + service history; financial rollups gate on existing `canViewFinancials` / `canViewProfit`.
6. **AddJob gets a returning-customer card.** Phone-first input at the top of the form auto-fills name/email/city/vehicle in <300ms when a known number is typed.
7. **Future-ready.** Call recording, transcript, AI receptionist, auto-text-back, and FCM background push all have named seams in the schema and component graph; none ship in v1.

Success is binary per sub-project (see *Ship Order*); the headline success criterion is: **a customer calls the business number, and within 2 seconds every foregrounded MSOS device shows the caller's name, vehicle, last service date, and Accept / Create Job / Open Profile buttons.**

---

## Problem (current state)

**Customer entity does not exist.** [src/lib/customers.ts:1-13](../../../src/lib/customers.ts) opens with an explicit comment: *"Customers are NOT a stored entity."* The `businesses/{bid}/customers/{key}` collection exists ([firestore.rules:604-607](../../../firestore.rules)) but only persists `CustomerMeta = { note?: string; tags?: string[]; updatedAt?: string }` ([src/lib/customers.ts:26-30](../../../src/lib/customers.ts)). Every other field — name, phone, email, lifetime revenue, visit cadence, vehicles owned, tire sizes — is derived live from the job list by `deriveCustomerProfiles()` ([src/lib/customers.ts:113-195](../../../src/lib/customers.ts)).

**Customer "key" is computed, not persisted.** `customerKey(job)` at [src/lib/customers.ts:91-102](../../../src/lib/customers.ts) returns `p_<digits>` from `customerPhone` or `n_<slug>` from `customerName`. Two jobs for the same person with slightly different phone formatting resolve to the same key only because `digits-only` normalization happens at read time; a job missing the phone falls back to the name slug and ends up under a *different* key. Read-time dedup ≠ write-time identity.

**Vehicle entity does not exist anywhere.** No `vehicles` collection. Vehicle identity is whatever the tech typed into `vehicleType` / `vehicleMakeModel` / `vehicleSize` / `tireSize` on each job ([src/types/index.ts:662, 743, 748, 684](../../../src/types/index.ts)). `deriveCustomerProfiles` aggregates `vehicleMakeModel` via `pushDistinct` ([src/lib/customers.ts:165-166](../../../src/lib/customers.ts)) but ignores `vehicleType`; `tireSizes` is aggregated separately.

**AddJob captures only Name + Phone + City.** The Customer card ([src/pages/AddJob.tsx:752-840](../../../src/pages/AddJob.tsx)) is the **fourth** section in form order, after Suggested-price, Revenue, and Service. No address, no email (even though `Job.customerEmail` exists at [src/types/index.ts:683](../../../src/types/index.ts) with no UI binding), no vehicle make/model in the Customer card itself — `vehicleMakeModel` is rendered later in the per-vertical job-fields loop at [src/pages/AddJob.tsx:864](../../../src/pages/AddJob.tsx). There is no lookup-by-phone UI; the only repeat-job affordance is `handleDuplicate` at [src/App.tsx:1296-1302](../../../src/App.tsx), reachable from History / JobDetailModal / JobSuccessPanel.

**RBAC exists and is already wired for financial-field hiding.** Three roles — owner / admin / technician — live on `businesses/{businessId}/members/{uid}.role` ([src/types/index.ts:115, 193-244](../../../src/types/index.ts)). `getPermissions()` ([src/lib/permissions.ts](../../../src/lib/permissions.ts)) produces a flat `Permissions` boolean map. The canonical field-hiding pattern is `{canViewProfit && <Row ... />}` used at [src/components/JobDetailModal.tsx:121-135](../../../src/components/JobDetailModal.tsx) and [src/pages/Customers.tsx:600](../../../src/pages/Customers.tsx). Firestore rules cannot mask individual fields on a doc; the established workaround when server enforcement is required is to split sensitive data into a subcollection with its own rule.

**Webhook pattern is established but unused for inbound.** [functions/src/stripeWebhook.ts:1-225](../../../functions/src/stripeWebhook.ts) is a complete reference: v2 `onRequest`, `defineSecret`, raw-body HMAC verification, Firestore-based idempotency, kill-switch env-var. It is intentionally not exported from [functions/src/index.ts:69-82](../../../functions/src/index.ts) because production Stripe events flow through the Firebase Stripe Extension. We will mirror this file exactly for `quoWebhook`.

**Real-time delivery exists but only via Firestore listeners.** [src/lib/firebase.ts:266-285](../../../src/lib/firebase.ts) defines `fbListen` over `onSnapshot`. App.tsx attaches all real-time listeners between [src/App.tsx:437-583](../../../src/App.tsx). There is **no FCM, no web push, no service-worker push handler** anywhere in the codebase. `public/sw.js` is purely cache-strategy. Mobile browsers suspend WebSockets on backgrounded tabs after ~30s, so a Firestore-listener-driven popup only fires when the tab is foregrounded. This is a known v1 gap, documented and accepted; FCM is a future-ready seam.

**Modals are state-driven, not bus-driven.** There is no `openModal()` registry. Every modal is rendered conditionally in App.tsx from local state (e.g. `{detailJob && <JobDetailModal ... />}` at [src/App.tsx:1568-1590](../../../src/App.tsx)). A new modal driven by Firestore must follow the same shape: attach an `onSnapshot` listener in App.tsx, hold the result in state, render conditionally.

---

## Architecture Overview

### End-to-end incoming-call flow (headline scenario)

```
+---------------------+     +-----------------------+     +---------------------------------+
| Customer dials      |     | Quo (OpenPhone) Beta  |     | Cloud Function: quoWebhook      |
| business line       | --> | sends call.ringing    | --> |  1. Verify webhook-signature    |
| (305) 897-7030      |     | webhook to MSOS       |     |  2. Idempotency: webhook-id     |
+---------------------+     +-----------------------+     |  3. Resolve businessId from     |
                                                          |     quoPhoneNumbers/{toE164}    |
                                                          |  4. Normalize fromE164 -> digits|
                                                          |  5. Query customers where       |
                                                          |     phoneKey == digits          |
                                                          |  6. Read up to 3 vehicles +     |
                                                          |     last job summary            |
                                                          |  7. Write incomingCalls/{id}    |
                                                          |     status='ringing' +          |
                                                          |     denormalized snapshot       |
                                                          +---------------------------------+
                                                                              |
                                            (Firestore realtime channel, 200-800ms)
                                                                              v
                          +-----------------------------------------------------------------+
                          | All foregrounded MSOS devices for that business:                |
                          |   useIncomingCallListener(businessId) <- attached in App.tsx    |
                          |   filters status=='ringing' AND createdAt > now-60s             |
                          |   AND (assignedToUid == null OR == currentUid)                  |
                          |   -> setIncomingCall(doc)                                       |
                          |   -> <IncomingCallModal /> renders at z-index 9500              |
                          |      with ringtone, focus trap, accept/decline/dismiss          |
                          +-----------------------------------------------------------------+
```

End-to-end target: <2s wall-clock from Quo webhook receipt to popup visible on a foregrounded device. Cloud Function work is well under 1s; the Firestore → onSnapshot leg is 200-800ms in practice.

### Job-save → Customer auto-creation flow

```
+----------------------+    +-----------------------+    +-----------------------+
| Tech taps Save Job   | -> | App.tsx#saveJob       | -> | upsertCustomerFromJob |
| in AddJob            |    | assembles finalJob    |    |  1. normalizePhone    |
+----------------------+    +-----------------------+    |  2. customerKey       |
                                                          |  3. merge-write       |
                                                          |     customers/{key}   |
                                                          |  4. vehicleKey(job)   |
                                                          |  5. merge-write       |
                                                          |     vehicles/{vid}    |
                                                          |  returns {cId, vId}   |
                                                          +-----------------------+
                                                                      |
                                            +------------------------+
                                            v
                          +---------------------------------------+
                          | fbSetFast(jobsCol, finalJob.id,       |
                          |   { ...finalJob,                      |
                          |     customerId, vehicleId, phoneKey   |
                          |   })                                  |
                          +---------------------------------------+
```

`upsertCustomerFromJob` is idempotent; if it throws, saveJob catches and toasts a non-blocking warning (job save still succeeds). This is the resilience contract: the Customer entity is best-effort; the Job is authoritative.

### Hybrid customers read path

`deriveCustomerProfiles()` keeps working. On each call it:

1. Loads `customers/{*}` (the meta + new persisted fields) and `customers/{*}/vehicles/{*}` once.
2. Loops over jobs (already filtered by `scopeJobsByRole`).
3. For each job, prefers `job.customerId` if present; falls back to `customerKey(job)` computed from `customerPhone` / `customerName` for legacy rows.
4. Merges persisted customer fields when available; otherwise materializes the profile entirely from job fields (today's behavior).

Result: zero migration required to ship SP1. New jobs use persisted entities; legacy jobs continue to surface in the Customers page via derivation.

---

## Data Model

All paths are scoped under `businesses/{businessId}/...` except `quoPhoneNumbers/{e164}` and `quoWebhookEvents/{webhookId}`, which are top-level (the webhook arrives without a business context and must resolve from the dialed number).

### `businesses/{businessId}/customers/{customerId}`

Doc ID is the existing `customerKey()` output (`p_<digits>` or `n_<slug>`) — preserves continuity with today's `customers/{key}` meta docs.

| Field | Type | Notes |
|---|---|---|
| `id` | string | Doc ID. |
| `name` | string | Migrated from `Job.customerName` on first upsert. |
| `phoneE164` | string | Normalized phone, e.g. `+13058977030`. |
| `phoneKey` | string | Digits-only, e.g. `13058977030`. **Indexed.** Primary webhook lookup field. |
| `email` | string? | From `Job.customerEmail` ([src/types/index.ts:683](../../../src/types/index.ts)). |
| `addressLine` | string? | NEW; not captured in AddJob today, edited via CustomerProfile (SP3). |
| `city` | string? | Migrated from `Job.city`. |
| `state` | string? | Migrated from `Job.state`. |
| `note` | string? | **EXISTING** field on CustomerMeta. Preserved verbatim. |
| `tags` | string[]? | **EXISTING** field on CustomerMeta. Preserved verbatim. |
| `firstJobAt` | Timestamp? | Set on first upsert; never overwritten. |
| `lastJobAt` | Timestamp? | Updated on every upsert. |
| `lastJobId` | string? | Most recent job. Drives "Repeat Last Service" action. |
| `jobCount` | number? | Rollup counter. Nullable; fallback to derived count for legacy. |
| `lastContactedAt` | Timestamp? | Future-ready seam for retention campaigns. Updated when an outbound call/text is logged or when a call is accepted from the popup. |
| `createdByUid` | string? | First tech who saved a job for this customer. |
| `createdAt` | Timestamp | Server timestamp (admin SDK) or ISO string (client). |
| `updatedAt` | string | EXISTING ISO string field. Preserved. |
| `lastEditedByUid` | string? | Uid of the last person to modify the doc. **Required on every update** going forward. |
| `lastEditedAt` | Timestamp \| string? | When the last modification occurred. Required on every update. |
| `processedJobIds` | string[] | Idempotency key array (last ~100 jobIds). Used by `upsertCustomerFromJob` transaction. |

**Indexes:**
- `(phoneKey ASC)` — incoming-call lookup
- `(lastJobAt DESC)` — Customers page sort

**Security rule sketch** (delta against [firestore.rules:604-607](../../../firestore.rules)):

```
match /businesses/{bid}/customers/{customerId} {
  allow read: if isMemberOfBusiness(bid);
  // Meta-only writes (note, tags) remain owner/admin
  allow update: if isOwnerOrAdmin(bid)
              && request.resource.data.diff(resource.data).affectedKeys()
                 .hasOnly(['note','tags','updatedAt','lastEditedByUid','lastEditedAt']);
  // Identity upserts (from saveJob) allowed for any active member.
  // canCreateJobs is true for owner/admin/technician today; the existing role check covers it.
  allow create, update: if isMemberOfBusiness(bid)
              && memberRole(bid) in ['owner','admin','technician']
              && request.resource.data.diff(resource.data).affectedKeys()
                 .hasOnly(['name','phoneE164','phoneKey','email','addressLine',
                          'city','state','firstJobAt','lastJobAt','lastJobId',
                          'jobCount','lastContactedAt','createdByUid','createdAt','updatedAt',
                          'processedJobIds','lastEditedByUid','lastEditedAt']);
}
```

**No new rules helper.** The spec uses ONLY the existing helpers from `firestore.rules`: `isMemberOfBusiness`, `isOwnerOrAdmin`, `memberRole`, `memberDocExists`, `businessOwnerUid`. Maintaining a parallel permission table inside rules would diverge from the established pattern in the rules file. The role-list check `memberRole(bid) in ['owner','admin','technician']` is the canonical "active member with canCreateJobs" predicate — every active role today has `canCreateJobs == true`, so the role-list check is exact. The same approach applies to the `leads` rule below: replace `hasPermission(bid, 'canCreateJobs')` with `memberRole(bid) in ['owner','admin','technician']`.

The dual `allow update` rules (owner/admin-only for meta vs any-active-member for identity) are intentionally separate — Firestore rules OR them at evaluation time, which is the desired semantic.

**Financial rollup fields (`lifetimeRevenue`, `lifetimeProfit`, `expensesTotal`) are deliberately NOT stored.** Today these are derived live from `jobs` via `scopeJobsByRole` ([src/lib/jobPermissions.ts:16](../../../src/lib/jobPermissions.ts)) so the technician's "Lifetime Revenue" is automatically scoped to their own jobs. Persisting these rollups would either leak owner-level totals to techs or require a Cloud-Function-only write path. We keep them derived; the CustomerProfile gates Lifetime Revenue / Profit / Expenses behind `permissions.canViewFinancials` so techs only ever see derived-from-their-own-jobs totals (which they already see today on the Customers page).

### `businesses/{businessId}/customers/{customerId}/vehicles/{vehicleId}`

Doc ID is `vehicleKey(job)`:
- If `job.vehicleMakeModel` is non-empty → `slug(vehicleMakeModel)` (e.g. `honda-civic`).
- Else if `job.vehicleType` is non-empty → `slug(vehicleType + '-' + (job.tireSize || job.vehicleSize || 'na'))` (e.g. `sedan-215-55r17`).
- Else → `slug('unknown-' + jobId.slice(0,6))` (rare fallback).

| Field | Type | Notes |
|---|---|---|
| `id` | string | Doc ID. |
| `vehicleType` | string? | From `Job.vehicleType` (tire vertical). |
| `vehicleMakeModel` | string? | From `Job.vehicleMakeModel` (mechanic vertical). |
| `vehicleSize` | string? | From `Job.vehicleSize` (detailing vertical). |
| `tireSize` | string? | From `Job.tireSize`. For tire vertical this is vehicle identity. |
| `tireBrand` | string? | Most recent. |
| `color` | string? | NEW; optional, v2 field. |
| `licensePlate` | string? | NEW; optional, v2 field. |
| `vin` | string? | NEW; optional, future-ready for `vehicleDiagnostics` flag ([src/config/businessTypes/types.ts:117](../../../src/config/businessTypes/types.ts)). |
| `lastServicedAt` | Timestamp | Most recent job date for this vehicle. |
| `lastJobId` | string | Most recent job id for this vehicle. |
| `createdAt` | Timestamp | Server timestamp. |
| `updatedAt` | Timestamp | Server timestamp. |

**Indexes:** `(lastServicedAt DESC)` — for "vehicles owned" sort on CustomerProfile.

**Security:** inherits the parent customer rule (any member read; any member with `canCreateJobs` may upsert via saveJob). No financial fields, so no extra gating.

### `businesses/{businessId}/incomingCalls/{callId}`

Doc ID is the Quo call resource id (e.g. `AC...`). Cloud-Function-only create; clients may update only a constrained subset.

| Field | Type | Notes |
|---|---|---|
| `id` | string | Quo call id. |
| `quoCallId` | string | Same as id; kept distinct for future provider abstraction. |
| `direction` | `'incoming' \| 'outgoing'` | Always `'incoming'` for popup-triggering docs. |
| `status` | `'ringing' \| 'answered' \| 'missed' \| 'declined' \| 'dismissed' \| 'completed'` | Drives popup visibility. Only `'ringing'` renders the modal. |
| `fromE164` | string | Caller, E.164. |
| `fromDigits` | string | Caller, digits-only. Client re-lookup fallback if `customerId` is null. |
| `toE164` | string | Business number. Disambiguates multi-line businesses. |
| `customerId` | string \| null | Resolved at webhook time. `null` = lead OR invalid phone (see `lookupSkippedReason`). For shared-phone cases, the primary (first) customer's id; the disambiguation sheet may rewrite this. |
| `customerName` | string \| null | Snapshot of the PRIMARY match's name so popup renders even if the doc changes. |
| `customersSnapshot` | `Array<{customerId, name, vehiclesSnapshot: Vehicle[]}>` | Up to 3 matches snapshotted at ring time. Empty array on unknown caller. Supports the shared-phone "Also: Jose Lopez" render path. |
| `additionalMatchesCount` | number | Number of matches beyond the 3 in `customersSnapshot`. Drives "Also: Jose Lopez (+N more)" tail. |
| `lastJobSummary` | object \| null | `{ jobId, service, date, vehicleLabel, tireSize, paymentStatus }`. **`paymentStatus` is null unless the line is single-tech-assigned** — see *Privacy posture* above. |
| `lookupSkippedReason` | string? | Diagnostic. `'invalid_phone'` when `normalizePhone(from).valid === false`. |
| `assignedToUid` | string \| null | If the called Quo line maps to a single tech, only their device should ring. `null` = all-members. |
| `createdAt` | Timestamp | Server timestamp at webhook receipt. |
| `ringingExpiresAt` | Timestamp | `createdAt + 60s`. Client auto-dismisses stale rings. |
| `answeredByUid` | string? | Who tapped Accept. |
| `callbackBookedJobId` | string? | If operator tapped "Create Job" from the popup. |
| `missedAt` | Timestamp? | From `call.missed`. |
| `completedAt` | Timestamp? | From `call.completed`. |
| `durationSec` | number? | From `call.completed`. |
| `recordingUrl` | string? | From `call.recording.completed`. **Future-ready.** |
| `transcript` | string? | From `call.transcript.completed`. **Future-ready (AI receptionist seam).** |

**Indexes:**
- `(status ASC, createdAt DESC)` — client subscribes filtered to `status=='ringing'`
- `(customerId ASC, createdAt DESC)` — for customer timeline "Calls" view

**Security rule:**

```
match /businesses/{bid}/incomingCalls/{callId} {
  allow read: if isMemberOfBusiness(bid);
  allow create, delete: if false;  // Cloud Function service account only
  allow update: if isMemberOfBusiness(bid)
              && request.resource.data.diff(resource.data).affectedKeys()
                 .hasOnly(['status','answeredByUid','callbackBookedJobId','customerId']);
}
```

The `customerId` field is included in the update allowlist so the disambiguation sheet (shared-phone path) can rewrite the call's resolved customer. The Cloud Function still owns initial `customerId` resolution; member writes are limited to picking among the candidates already snapshotted in `customersSnapshot`.

The Cloud Function uses the default Firebase service account (admin SDK), which bypasses rules. Clients can only mutate the three accept/decline/convert fields; everything else is server-authored.

### `businesses/{businessId}/leads/{leadId}`

| Field | Type | Notes |
|---|---|---|
| `id` | string | Random Firestore ID. |
| `phoneE164` | string | Caller, E.164. |
| `phoneKey` | string | Digits-only. **Indexed.** |
| `customerId` | string \| null | Matched at missed-call time. |
| `callId` | string | FK to `incomingCalls/{callId}`. |
| `source` | `'missed_call' \| 'manual' \| 'quote' \| 'web'` | How the lead entered. |
| `status` | `'new' \| 'contacted' \| 'converted' \| 'lost'` | Operator-driven state machine. **AI-receptionist seam.** |
| `convertedJobId` | string? | If `status` flips to `'converted'`. |
| `assignedToUid` | string? | Operator who claimed the lead. |
| `createdAt` | Timestamp | When the lead was created. |
| `updatedAt` | Timestamp | Last status change. |
| `lastMissedCallAt` | Timestamp? | Most recent missed call for this `phoneKey`. Updated instead of creating a duplicate when a new missed call lands within the 7d dedup window. |
| `missedCallCount` | number | Incremented via `FieldValue.increment(1)` on each missed call within the dedup window. |

**Indexes:** `(status ASC, createdAt DESC)`, `(phoneKey ASC)`.

**Security:**
```
match /businesses/{bid}/leads/{leadId} {
  allow read: if isMemberOfBusiness(bid);
  allow create: if false;  // Cloud Function only
  allow update: if isMemberOfBusiness(bid)
              && memberRole(bid) in ['owner','admin','technician'];
}
```

### `quoPhoneNumbers/{e164}` (top-level)

Doc ID is the E.164 business phone number — the webhook's `to` field. Top-level because the webhook resolves business *from* this collection.

| Field | Type | Notes |
|---|---|---|
| `e164` | string | Doc ID. |
| `businessId` | string | Which MSOS business owns this Quo line. |
| `quoPhoneNumberId` | string | Quo's internal `phoneNumberId` for outbound API calls. |
| `label` | string? | Operator-friendly label e.g. "Main line", "Tech 1". |
| `defaultAssignedToUid` | string? | If set, only this tech's device rings. |
| `active` | boolean | Per-number kill switch. |
| `createdAt` | Timestamp | |

**Indexes:** `(businessId ASC, active ASC)`.

**Security:** Reads only allowed for owner/admin of the linked business; writes blocked (managed via `adminConnectQuoNumber` callable). The webhook reads via the admin SDK and bypasses rules.

### `quoWebhookEvents/{webhookId}` (top-level)

Mirrors `stripeWebhookEvents` pattern from [functions/src/stripeWebhook.ts:141-177](../../../functions/src/stripeWebhook.ts). Doc ID is the Quo Beta `webhook-id` header value.

| Field | Type | Notes |
|---|---|---|
| `webhookId` | string | Doc ID. Idempotency key. |
| `type` | string | Event type e.g. `'call.ringing'`. |
| `createdAt` | Timestamp | When the function first saw this webhook id. |
| `processed` | boolean | Set true after side effects committed. |
| `processedAt` | Timestamp? | When `processed` flipped to true. |
| `businessId` | string? | Resolved (debug). |
| `callId` | string? | Quo call resource id (debug). |

**TTL:** auto-delete after 28h via Firestore TTL policy on `createdAt` (Quo Beta idempotency window is ~27.5h). **The TTL policy MUST be configured at SP4 deploy time** — it is a hard requirement, not a fallback. The existing `scheduledDeletionPurge` weekly sweep is a secondary safety net but the per-doc TTL is the primary defense against post-window replay attacks.

**Security:** all client access denied; Cloud Function service account only.

### Data retention & cascade deletion

Every collection introduced by this spec MUST be reachable by tenant deletion. The existing `scheduledDeletionPurge` calls `db.recursiveDelete(businessRef)`, which walks `businesses/{bid}/**` — that covers `customers`, `vehicles`, `incomingCalls`, and `leads` automatically. The two top-level collections require explicit handling:

| Collection | Path | How it's purged on business deletion |
|---|---|---|
| `businesses/{bid}/customers/**` | tenant-scoped | `recursiveDelete(businessRef)` (existing). |
| `businesses/{bid}/customers/{cid}/vehicles/**` | tenant-scoped | `recursiveDelete(businessRef)` (existing). |
| `businesses/{bid}/incomingCalls/**` | tenant-scoped | `recursiveDelete(businessRef)` (existing). Note: `recordingUrl` points at Quo's CDN — the recording itself is governed by Quo retention; operator must align Quo settings with their privacy policy. |
| `businesses/{bid}/leads/**` | tenant-scoped | `recursiveDelete(businessRef)` (existing). |
| `quoPhoneNumbers/{e164}` | **top-level** | **`scheduledDeletionPurge` MUST be extended** to query `quoPhoneNumbers where businessId == purgedBusinessId` and delete each doc AFTER the `recursiveDelete(businessRef)` completes. This work is part of SP4, not a follow-up. |
| `quoWebhookEvents/{webhookId}` | top-level | TTL-managed (28h). Not tenant-scoped — events for the deleted tenant naturally age out within 28h of their last write. No explicit purge step required, but document the asymmetry. |
| `quoUserMapping/{quoUserId}` | top-level | **`scheduledDeletionPurge` MUST be extended** to query `quoUserMapping where businessId == purgedBusinessId` and delete each doc. Part of SP4. |
| `quoSyncCursors/{quoPhoneNumberId}` | top-level | Deleted alongside `quoPhoneNumbers` in the same purge sweep (lookup `quoPhoneNumberId` from each soon-to-be-deleted `quoPhoneNumbers` doc before its deletion). Part of SP4. |
| `quoPhoneNumberOwnershipAudits/{...}` | top-level | Retained 90 days for compliance; sweep via a separate scheduled function. SP4 scope. |

After this extension, a tenant deletion leaves zero records pointing at the deleted businessId. The audit-collection retention is intentional (90 days) and matches the compliance posture for ownership conflicts.

### Per-customer right-to-delete (GDPR / CCPA)

End-customers of an MSOS business have the right under GDPR Article 17 and CCPA Section 1798.105 to request erasure of their PII. Soft-delete (`customer.deletedAt = now`) is NOT sufficient — phone, email, address, and the denormalized `customerName`/`customerPhone`/`customerEmail` on every related Job must be hard-removed or anonymized.

**v1 decision (deferred):** Per-customer GDPR/CCPA hard-delete is **explicitly out of scope for v1**. The "Delete" button in CustomerProfile is soft-delete only, intended as an operator UX affordance ("hide this customer from my list") not a regulatory deletion. This is added to *Out of Scope* with a named follow-up: **SP7.5 — Customer hard-delete (GDPR/CCPA)**. The follow-up will:

- Add a separate "Forget customer (GDPR)" action, owner-only, with a second-confirmation prompt that names the regulatory implications.
- Hard-cascade: delete the Customer doc; delete all `vehicles` subdocs; for every Job with this customerId, tombstone `customerName`/`customerPhone`/`customerEmail`/`city`/`state` to `'[deleted]'` (PRESERVE financial records for tax compliance — IRS retention requirements supersede the right to erasure for financial data); delete `leads` matching `phoneKey`; scrub `incomingCalls` (clear `fromE164`/`fromDigits`/`customerName`/`customersSnapshot`).
- Trigger Quo CDN deletion of any `recordingUrl` referenced from the scrubbed calls.
- Generate an audit record in the operator's business-level compliance log.

Until SP7.5 ships, businesses receiving a GDPR/CCPA erasure request must run the operation manually (deleting the docs via Firestore console). The Out of Scope section calls this out.

### Customer modification audit trail

Per GDPR Article 5(1)(d) (accuracy) and Article 30 (records of processing), customer record modifications require an audit trail. v1 adds **two fields** to the `Customer` schema:

- `lastEditedByUid: string` — uid of the last person to update the doc.
- `lastEditedAt: Timestamp` (or ISO string from client) — when.

These are written by `upsertCustomerFromJob` AND by the SP3 inline Edit action. The Firestore rules above include both fields in the `affectedKeys()` allowlists.

**Full diff audit logging** (`businesses/{bid}/customers/{cid}/audits/{auditId}` with `{actorUid, action, before, after, at}` populated by a Firestore trigger Cloud Function) is **deferred to SP7.5** alongside the GDPR work — operationally the two requirements are closely coupled.

### `businesses/{businessId}/jobs/{jobId}` — additive changes only

| Field | Type | Notes |
|---|---|---|
| `customerId` | string? | **NEW.** FK to `customers/{customerId}`. Written by `upsertCustomerFromJob`. |
| `vehicleId` | string? | **NEW.** FK to `customers/{customerId}/vehicles/{vehicleId}`. |
| `phoneKey` | string? | **NEW.** Digits-only phone, matches `Customer.phoneKey`. Enables legacy lookup without a customer doc. |
| (all existing fields) | preserved | `customerName`, `customerPhone`, `customerEmail`, `vehicleType`, `vehicleMakeModel`, `vehicleSize`, `tireSize`, `tireBrand`, `tireCondition`, `city`, `state`, `area`, `fullLocationLabel` — ALL retained. |

**Additional indexes:**
- `(customerId ASC, date DESC)` — customer timeline render
- `(vehicleId ASC, date DESC)` — per-vehicle history
- `(phoneKey ASC, date DESC)` — fallback lookup for legacy customers without `customerId`

**No change** to existing job rules at [firestore.rules:573-588](../../../firestore.rules). The new fields are part of the same write that already writes the job; the existing role-based create/update rules cover them.

---

## Phone Number Normalization (canonical)

A single helper, two copies (client + functions) because the repo has no shared package today — same precedent as duplicated types between [functions/src](../../../functions/src) and [src/types](../../../src/types).

**Signature:**

```ts
// src/lib/phone.ts  (and identical copy at functions/src/lib/phone.ts)
export interface NormalizedPhone {
  e164: string;        // '+13058977030'
  digits: string;      // '13058977030'  (used as phoneKey)
  formatted: string;   // '(305) 897-7030'
  valid: boolean;      // true iff e164 matches /^\+1\d{10}$/ for US default
}

export function normalizePhone(raw: string, defaultCountry: 'US' = 'US'): NormalizedPhone;
export function isValidPhone(raw: string): boolean;
export function formatPhoneForDisplay(e164: string): string;
```

**Input contract:** `raw` must be `string`. Callers pass `String(value ?? '')`; `null`, `undefined`, and numeric inputs are coerced to empty string at the call site (NOT inside `normalizePhone`). Passing a non-string directly throws `TypeError` — fail loud, never silently produce a bogus key.

**Algorithm (US default — only country supported in v1):**

1. `stripped = raw.replace(/[^\d+]/g, '')` — strip everything except digits and `+`. (Note: this means `x`, letters, and extension markers are silently dropped; see the explicit edge case table below for the resulting behavior.)
2. If `stripped` starts with `+`:
   - `digits = stripped.slice(1)`.
3. Else:
   - `digits = stripped`.
4. If `digits.length === 10`: prefix with `'1'` → `digits = '1' + digits`.
5. If `digits.length === 11` and `digits[0] === '1'`: leave as-is.
6. Otherwise: `valid = false`. Return `{ e164: '', digits: '', formatted: raw.trim(), valid: false }`. **NEVER** return a populated `e164`/`digits` for an invalid input — downstream code uses `valid` as the gate, and a populated `digits` would pollute `phoneKey` queries.
7. If valid: `e164 = '+' + digits`; `formatted = '(' + digits.slice(1,4) + ') ' + digits.slice(4,7) + '-' + digits.slice(7,11)`.
8. Return `{ e164, digits, formatted, valid }`.

**Edge cases (exhaustive — verified against the user-supplied input set plus international / extension / vanity inputs intentionally rejected in v1):**

| Input | digits | e164 | formatted | valid | Notes |
|---|---|---|---|---|---|
| `3058977030` | `13058977030` | `+13058977030` | `(305) 897-7030` | true | |
| `(305) 897-7030` | `13058977030` | `+13058977030` | `(305) 897-7030` | true | |
| `+13058977030` | `13058977030` | `+13058977030` | `(305) 897-7030` | true | |
| `305.897.7030` | `13058977030` | `+13058977030` | `(305) 897-7030` | true | |
| `1-305-897-7030` | `13058977030` | `+13058977030` | `(305) 897-7030` | true | |
| `` (empty) | `` | `` | `` | false | Invalid; callers MUST NOT persist phoneKey/phoneE164. |
| `911` | `` | `` | `911` | false | Short codes rejected — never become a customer phoneKey. |
| `305-897-703` (9 digits) | `` | `` | `305-897-703` | false | Too short — rejected. |
| `13058977030555` (14 digits) | `` | `` | `13058977030555` | false | Too long — rejected. |
| `+447911123456` (UK, intl) | `` | `` | `+447911123456` | false | International rejected in v1 — see "Out of scope" + below. |
| `305-897-7030 x123` (ext) | `` | `` | `305-897-7030 x123` | false | Extensions stripped to 13-digit garbage (`13058977030123`) which fails the length check → invalid. Operators with PBX extensions must enter the bare number in v1. |
| `1-800-FLOWERS` (vanity) | `` | `` | `1-800-FLOWERS` | false | Letters stripped to 4 digits → invalid. Vanity numbers rejected. |

**Hard contract for callers (upsertCustomerFromJob, saveJob, quoWebhook resolveAndWrite):**

If `normalizePhone(raw).valid === false`:
- `upsertCustomerFromJob` MUST NOT write `phoneKey` or `phoneE164` on the Customer doc. Instead it falls back to the `n_<slug>` name-keyed customer doc with phone fields unset. If both phone and name are empty/invalid, throw and let the caller's try/catch toast the warning.
- `saveJob` MUST NOT write `phoneKey` on the Job doc (omit the field; never write `''`).
- `quoWebhook resolveAndWrite` MUST bail out of the `customers.where('phoneKey','==',digits)` query before issuing it, write `customerId: null` with diagnostic `lookupSkippedReason: 'invalid_phone'` on the `incomingCalls` doc, and treat the call as an unknown-caller lead.

**phoneKey canonical form — single source of truth:** `phoneKey` is the 11-digit US E.164 digits (e.g. `13058977030`) **everywhere**: the `Customer.phoneKey` field, `Job.phoneKey` field, all Firestore indexes, and inside the Customer doc ID prefix `p_<phoneKey>` (so the canonical doc ID for the example becomes `p_13058977030`).

This is a **breaking change vs today's `customerKey()`** at `src/lib/customers.ts:91-102`, which returns `p_<raw 10-digit local>` (e.g. `p_3058977030`). To reconcile:

1. **`customerKey()` is updated in SP1** to compute via `normalizePhone(...).digits` and produce `p_13058977030`-style IDs going forward.
2. **Hybrid read path also tries the legacy form.** `deriveCustomerProfiles` and `lookupCustomerByPhone` first query `customers/p_<normalized 11-digit>`; on miss they fall back to `customers/p_<legacy 10-digit>` (digits 1-10 of the normalized form, i.e. drop the leading `1`). Found legacy docs are surfaced unchanged in v1; SP3's optional backfill renames them to the new key.
3. **Webhook `phoneKey` query stays single-form:** the `customers.where('phoneKey','==',digits)` query in `quoWebhook` uses ONLY the 11-digit form. Legacy customers without a `phoneKey` field on the doc are picked up via the SP3 backfill or by the operator's first job save (which calls `upsertCustomerFromJob`, populating `phoneKey`). Until then, an inbound call to a legacy-only customer resolves to `customerId: null` and shows as an unknown caller — acceptable v1 tradeoff.

**International / extension / vanity — explicit deferral.** v1 rejects everything outside US/Canada NANP. International support is deferred until we adopt `libphonenumber-js`; the spec table above lists the exact rejection behavior for each input class so operators get a deterministic "invalid phone" rather than a silently corrupt customer record.

**Persisted forms:**
- `Customer.phoneKey` and `Job.phoneKey` always store `digits` (e.g. `13058977030`) — ONLY when `valid === true`.
- `Customer.phoneE164` and `IncomingCall.fromE164`/`toE164` store `e164` — ONLY when `valid === true`.
- `Job.customerPhone` continues to store the operator-entered or formatted form for display (no migration needed).

**AddJob integration:** the existing `formatPhonePartial` / `formatPhone` helpers at [src/pages/AddJob.tsx:761-770](../../../src/pages/AddJob.tsx) are replaced by `formatPhoneForDisplay` for display and `normalizePhone(...).digits` is written to `Job.phoneKey` at save time inside `saveJob`.

---

## System Components

| Component | Kind | Path | Responsibility | Depends on |
|---|---|---|---|---|
| `phone.ts` (client) | helper-library | `src/lib/phone.ts` | Single source of truth for normalization. Exports `normalizePhone`, `isValidPhone`, `formatPhoneForDisplay`. | — |
| `phone.ts` (functions) | helper-library | `functions/src/lib/phone.ts` | Identical copy for Cloud Function. | — |
| `customerEntity.ts` | client-module | `src/lib/customerEntity.ts` | Defines `Customer`, `Vehicle` types. Exports `upsertCustomerFromJob(businessId, job): Promise<{customerId, vehicleId}>` — transactionally safe upsert (see *Concurrency contract* below); preserves existing `note`/`tags`, never overwrites `firstJobAt`, uses `FieldValue.increment(1)` for `jobCount`, and computes `lastJobAt` as `max(existing, job.date)`. Idempotent per `(customerId, jobId)`. | `phone.ts`, `firebase.ts` |
| `customers.ts` (refactor) | client-module | `src/lib/customers.ts` | Widen `CustomerMeta` to the new field set. `deriveCustomerProfiles` becomes hybrid: prefer persisted doc when `job.customerId` is present; fall back to today's pure derivation otherwise. `customerKey()` preserved as the canonical key generator. | `customerEntity.ts` |
| `lookupCustomerByPhone.ts` | client-module | `src/lib/lookupCustomerByPhone.ts` | `lookupCustomerByPhone(businessId, rawPhone): Promise<{customer, vehicles[], recentJobs[]}>`. Normalizes, queries `customers where phoneKey == digits`, loads `vehicles` subcollection, loads last 5 jobs ordered by `date DESC` where `customerId == hit.id`. Used by `CustomerLookupCard` AND as `IncomingCallModal` hydration fallback when `customerId` was null at webhook time. | `phone.ts`, `customerEntity.ts` |
| `CustomerLookupCard.tsx` | react-component | `src/components/addJob/CustomerLookupCard.tsx` | Phone-first card at top of AddJob. **Phone input MUST be a `MemoInput` consuming a `useCallback`-wrapped `onPhoneChange` setter** (mirrors the P1-3 keystroke-storm fix at `src/pages/AddJob.tsx:207-235`). Debounce (250ms) runs against the stable callback's stored value, NOT against an inline lambda. On hit renders Returning Customer card with name + vehicle chips + last-job line + buttons. On miss shows "No match — continue as new" with phone preserved. | `lookupCustomerByPhone.ts` |
| `AddJob.tsx` (modification) | react-component | `src/pages/AddJob.tsx` | Insert `<CustomerLookupCard />` as a NEW top section above the Suggested-price sticky tile (currently [line 462](../../../src/pages/AddJob.tsx)). Existing Customer card at [lines 752-840](../../../src/pages/AddJob.tsx) retained for manual entry. Email field added inside that card (presently absent despite `Job.customerEmail` existing). | `CustomerLookupCard.tsx` |
| `App.tsx#saveJob` (mod) | client-module | `src/App.tsx` | Insert `upsertCustomerFromJob(businessId, finalJob)` between finalJob assembly at [line 1076](../../../src/App.tsx) and `fbSetFast` write at [line 1078](../../../src/App.tsx). Wrap in try/catch — failure toasts non-blocking warning. Write `customerId`, `vehicleId`, `phoneKey` onto `finalJob` before save. | `customerEntity.ts` |
| `CustomerProfile.tsx` | react-component | `src/pages/CustomerProfile.tsx` | Drill-down page. Header (name, phone, repeat badge, tags), Vehicles section (chips), Service Timeline (chronological JobList reusing `JobDetailModal`), Notes (editable when `canEditBusinessSettings`), Quick Actions row (Create Job, Repeat Last, Call, Text, Quote, Invoice, Review, Edit, Delete), Lifetime stats (gated by `canViewFinancials`). | `customers.ts`, `phone.ts` |
| `Customers.tsx` (mod) | react-component | `src/pages/Customers.tsx` | Surface vehicles per customer (from new subcollection), wire row click → `CustomerProfile`, gate Lifetime Revenue strictly behind `canViewFinancials` (tighter than today's per-row `canViewProfit` at [line 600](../../../src/pages/Customers.tsx)). | `CustomerProfile.tsx` |
| `quoWebhook.ts` | cloud-function | `functions/src/quoWebhook.ts` | v2 `onRequest` HMAC-verified webhook. Mirrors [stripeWebhook.ts](../../../functions/src/stripeWebhook.ts) line-for-line. See *OpenPhone Integration* below. | `phone.ts` (functions) |
| `functions/src/index.ts` (mod) | barrel | `functions/src/index.ts` | Add `export { quoWebhook } from './quoWebhook';`. Mirrors commented-out Stripe pattern but enabled. | `quoWebhook.ts` |
| `adminConnectQuoNumber.ts` | cloud-function | `functions/src/adminConnectQuoNumber.ts` | v1 `https.onCall`. Owner/admin only via `assertOwnerOrAdmin`. Inputs: `{businessId, e164, quoPhoneNumberId, label?, defaultAssignedToUid?, force?: boolean}`. Normalizes `e164` via `normalizePhone()`, rejects `valid === false`. **Uniqueness check:** if `quoPhoneNumbers/{e164}` already exists AND its `businessId !== input.businessId`, refuse with error code `'phone_number_owned_by_other_business'` UNLESS `force: true` (owner-only + UI confirmation). Every conflict-write (refusal or forced overwrite) writes an audit doc to `quoPhoneNumberOwnershipAudits/{ts}_{e164}` with `{actorUid, attemptedBusinessId, existingBusinessId, action, ip}`. | — |
| `IncomingCallModal.tsx` | react-component | `src/components/IncomingCallModal.tsx` | Centered modal at z-index 9500. `.modal-overlay` + `useFocusTrap` + `role='alert' aria-live='assertive'`. Renders caller name (or "Unknown caller"), formatted phone, repeat badge, vehicles, last-job card, Accept / Decline / Dismiss + quick action buttons. Plays `/sounds/ringtone.mp3` via `HTMLAudioElement` loop until any action or `ringingExpiresAt` passes. | `useFocusTrap.ts`, `phone.ts` |
| `useIncomingCallListener.ts` | client-module | `src/lib/useIncomingCallListener.ts` | `useIncomingCallListener(businessId, currentUid): IncomingCall \| null`. Attaches `onSnapshot` on `collection(_db, 'businesses/${businessId}/incomingCalls')` filtered by `where('status','==','ringing')` + ordered by `createdAt desc` + `limit(5)`. Returns most recent unexpired ringing doc visible to current user (respects `assignedToUid`). Auto-clears when `ringingExpiresAt` passes via a single `setTimeout`. | `firebase.ts` |
| `App.tsx` (mod) | react-component | `src/App.tsx` | Add `const incomingCall = useIncomingCallListener(businessId, uid)` near existing listener setup ([lines 437-583](../../../src/App.tsx)). Render `{incomingCall && <IncomingCallModal ... />}` near `JobDetailModal` mount at [line 1568](../../../src/App.tsx). | `useIncomingCallListener.ts`, `IncomingCallModal.tsx` |
| `Leads.tsx` + `Lead` type | react-component | `src/pages/Leads.tsx` | List page sorted by `createdAt DESC`. Columns: time, name (or "Unknown"), phone, source, status, last action. Row actions: Call back (`tel:`), Text (`sms:`), Convert to Job (preloads AddJob draft with customer + lead context), Mark Lost. New tab added to MoreSheet for owner/admin/canCreateJobs. | `quoWebhook.ts` (indirectly via writes) |
| `firestore.rules` (mod) | rules | `firestore.rules` | Add rules for `customers/{cid}/vehicles/**`, `incomingCalls/**`, `leads/**`, `quoPhoneNumbers/**`, `quoWebhookEvents/**`. Tighten `customers/{cid}` update to allow non-meta upserts by any member with `canCreateJobs` while preserving owner/admin gate on note/tags. | — |
| `QuoIntegrationSection.tsx` | react-component | `src/components/settings/QuoIntegrationSection.tsx` | Owner-only debug panel under Settings → Integrations. Lists last 50 `quoWebhookEvents`, lets owner re-process a failed event, shows signing-key registration status, and a "Connect Quo Number" form that calls `adminConnectQuoNumber`. | `adminConnectQuoNumber.ts` |

---

## OpenPhone Integration

### Webhook endpoint

**Function:** `quoWebhook` — single v2 `onRequest` handler at `https://us-central1-mobile-service-os.cloudfunctions.net/quoWebhook` (matches the URL shape confirmed in [stripeWebhook.ts:33](../../../functions/src/stripeWebhook.ts)).

**Plan/system:** Subscribe to the **Quo Beta** webhook system. Rationale (from discovery):
- Beta is the only system that emits a distinct `call.missed` event (richer than inferring from `call.completed.status == 'unanswered' | 'abandoned'` in the legacy system).
- Beta uses Standard-Webhooks-compatible signing (`whsec_`-prefixed key, `webhook-signature` header with `v1,{base64}` format, signed content `{webhook-id}.{webhook-timestamp}.{rawBody}`).
- Beta is available on all Quo plan tiers (Starter $15/mo annual, Business $23/mo, Scale $35/mo) — Business plan is NOT required.
- Beta payload shape uses `data.resource` (vs legacy `data.object`) and provides `context.participants.workspace[]` / `external[]` arrays + `context.contacts.lookupStatus` — cleaner lookup signals.

**Subscribed events (v1):**

| Event | Beta payload key path | Handler behavior |
|---|---|---|
| `call.ringing` | `data.resource.{id,direction,createdAt}`, `data.context.{phoneNumberId,conversationId}` | Create `incomingCalls/{id}` with `status='ringing'`, resolve customer, snapshot vehicles + last job. |
| `call.missed` | `data.resource.{id}`, `data.context.{participants.workspace[], participants.external[], contacts.{ids,lookupStatus}}` | Update existing `incomingCalls/{id}` `status='missed'` + `missedAt`. Create `leads/{leadId}` if not already present for that `phoneKey` in last 7d. |
| `call.completed` | `data.resource.{id,status,duration,answeredAt,completedAt,hasVoicemail}` | Update `incomingCalls/{id}` with `completedAt`, `durationSec`. If `status == 'answered'` → set `incomingCalls.status='completed'`. If `status in ('unanswered','abandoned','failed')` AND no `call.missed` arrived → treat as missed (defensive). |
| `call.recording.completed` | `data.resource.{id}`, `data.recording.url` | Update `incomingCalls/{id}.recordingUrl`. v1 stores only. |
| `call.transcript.completed` | `data.resource.{id}`, `data.transcript` | Update `incomingCalls/{id}.transcript`. v1 stores only. **AI receptionist seam.** |

**Not subscribed in v1:** `message.received`, `message.delivered`, `contact.updated`, `contact.deleted`. The architecture supports adding them later (same handler, new switch arm).

### HMAC verification (Quo Beta — Standard Webhooks)

Mirror [stripeWebhook.ts:71-139](../../../functions/src/stripeWebhook.ts) exactly. Differences from Stripe:

1. **Secret:** `defineSecret('QUO_WEBHOOK_SIGNING_KEY')`. The key is `whsec_`-prefixed; **strip the prefix** before base64-decoding.
2. **Headers required:** `webhook-id`, `webhook-timestamp`, `webhook-signature`. Reject 400 if any missing.
3. **Signed content:** `${webhookId}.${webhookTimestamp}.${rawBody}` (NOT `${timestamp}.${rawBody}` like Stripe legacy).
4. **Signature header format:** `v1,{base64-signature}` — may contain space-separated multiple versions; iterate and accept first match.
5. **Algorithm:** HMAC-SHA256 with timing-safe comparison via `crypto.timingSafeEqual`.
6. **Raw body:** `req.rawBody` Buffer — preserved by Firebase Functions on `onRequest` automatically.
7. **Method:** POST only; reject 405.

**Pseudocode:**

```ts
import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import * as crypto from 'crypto';

const QUO_SIGNING_KEY = defineSecret('QUO_WEBHOOK_SIGNING_KEY');
const REPLAY_TOLERANCE_SEC = 300; // Standard Webhooks recommendation

export const quoWebhook = onRequest(
  {
    secrets: [QUO_SIGNING_KEY],
    cors: false,
    invoker: 'public',
    memory: '256MiB',
    timeoutSeconds: 60,
    region: 'us-central1',
    maxInstances: 10,  // cap blast radius from URL-discovery cost-amplification attacks
  },
  async (req, res) => {
    if (process.env.QUO_WEBHOOK_ENABLED !== 'true') {
      // Cheap 404 keeps the function killable under sustained attack.
      res.status(404).send('not found'); return;
    }
    if (req.method !== 'POST') { res.status(405).send('method not allowed'); return; }

    const id = req.header('webhook-id');
    const ts = req.header('webhook-timestamp');
    const sigHeader = req.header('webhook-signature');
    if (!id || !ts || !sigHeader || !req.rawBody) {
      // Structured warn — NEVER log rawBody or sigHeader values (would leak PII / signature material).
      console.warn('quoWebhook_missing_headers', {
        hasId: !!id, hasTs: !!ts, hasSig: !!sigHeader,
        contentLength: req.header('content-length'),
        ip: req.ip, ua: req.header('user-agent')
      });
      res.status(400).send('missing'); return;
    }

    // Replay-attack defense: reject if signed timestamp is more than 5 minutes off wall clock.
    const tsNum = parseInt(ts, 10);
    if (!Number.isFinite(tsNum) || Math.abs(Date.now() / 1000 - tsNum) > REPLAY_TOLERANCE_SEC) {
      console.warn('quoWebhook_stale_timestamp', {
        webhookId: id, deltaSec: Math.abs(Date.now() / 1000 - (tsNum || 0)),
        ip: req.ip, ua: req.header('user-agent')
      });
      res.status(400).send('stale timestamp'); return;
    }

    // Strip whsec_ prefix, base64-decode
    const rawKey = QUO_SIGNING_KEY.value();
    const secret = Buffer.from(rawKey.replace(/^whsec_/, ''), 'base64');
    const signed = `${id}.${ts}.${req.rawBody.toString('utf8')}`;
    const expected = crypto.createHmac('sha256', secret).update(signed).digest('base64');

    const ok = sigHeader.split(' ').some(part => {
      const [ver, sig] = part.split(',');
      if (ver !== 'v1' || !sig) return false;
      try {
        return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
      } catch { return false; }
    });
    if (!ok) {
      // Structured WARN, no rawBody, no sigHeader value, no secret.
      console.warn('quoWebhook_bad_signature', {
        webhookId: id, webhookTs: ts,
        contentLength: req.header('content-length'),
        ip: req.ip, ua: req.header('user-agent')
      });
      res.status(400).send('bad signature'); return;
    }

    // Idempotency, routing, handlers ...
  }
);
```

**Hardening posture & accepted risk:**

- **`maxInstances: 10`** caps the cost-amplification blast radius from anyone POSTing to the discovered URL.
- **`QUO_WEBHOOK_ENABLED='false'` kill switch** returns 404 cheaply (no secret read, no Firestore touch). Under sustained attack, flip this env var to mute the endpoint instantly.
- **Replay tolerance: 300 seconds** matches the Standard Webhooks recommended 5-minute window. Combined with the 28h `quoWebhookEvents` TTL, captured-and-replayed-after-window attacks are blocked at the timestamp check, not just the dedup table.
- **Logging rules (mandatory):** structured WARN at every signature/timestamp/header failure with `webhookId`, `webhookTs`, `contentLength`, `ip`, `ua`. **NEVER log** `req.rawBody`, the `webhook-signature` header value, the `QUO_WEBHOOK_SIGNING_KEY`, customer phone numbers extracted from the payload, or any field of the payload at WARN/ERROR levels. INFO-level logs may include `webhookId` and event `type` only.
- **Alerting:** elevate to ERROR-level log on the 11th consecutive bad-signature attempt in a 5-minute window so Cloud Logging metric-based alerts can fire to the operator's on-call.
- **Cloud Armor / App Check / IP allowlist:** OUT OF SCOPE for v1. Documented as a future hardening seam. The defense is HMAC + idempotency + replay window + `maxInstances` + kill switch. The function is `invoker: 'public'` because the webhook receiver pattern requires unauthenticated POST.
- **Plaintext PII:** `phoneE164`, `phoneKey`, `fromE164`, `fromDigits`, `toE164`, `customerPhone` are stored plaintext in Firestore. This is INTENTIONAL — the `phoneKey` index is the sub-2s lookup primary key and equality-on-encrypted-fields is not supported. Protection model: Firestore at-rest encryption (Google-managed) + role-based rules + per-business path scoping + the tenant isolation invariants above. CMEK is OUT OF SCOPE for v1.
- **`incomingCalls.toE164`** is business-confidential (operator's Quo line) not customer PII; same protection model applies.

### Idempotency

Mirror [stripeWebhook.ts:141-177](../../../functions/src/stripeWebhook.ts). Key off the `webhook-id` header (not the payload event id — payload event ids can repeat across retries; `webhook-id` is unique per delivery attempt grouping per Quo's docs).

```ts
const ref = db.collection('quoWebhookEvents').doc(id);
await db.runTransaction(async tx => {
  const snap = await tx.get(ref);
  if (snap.exists) {
    // Already processed or in flight; 200 to stop retries
    return { alreadyProcessed: true };
  }
  tx.set(ref, { type: body.type, createdAt: FieldValue.serverTimestamp(), processed: false });
  return { alreadyProcessed: false };
});
```

After successful handling: `ref.set({ processed: true, processedAt: FieldValue.serverTimestamp(), businessId, callId }, { merge: true })`.

On idempotency-store failure return **503** (not 200) so Quo retries — matches the Stripe rule "never process events we can't dedupe."

### Secret management

Register exactly one secret with Firebase Secret Manager via operator CLI:

```bash
firebase functions:secrets:set QUO_WEBHOOK_SIGNING_KEY
# Paste the whsec_-prefixed signing key revealed in the Quo dashboard
```

A second secret `QUO_API_KEY` is registered now but only used by SP7 outbound-SMS work — including it in the v1 secret set means SP7 needs zero deploy changes:

```bash
firebase functions:secrets:set QUO_API_KEY
# Paste the Quo Bearer API token (sk_live_... or similar)
```

Both register via `defineSecret('NAME')` at module top and pass via `{ secrets: [...] }` in `onRequest` options — same pattern as `STRIPE_WEBHOOK_SECRET` / `STRIPE_SECRET_KEY` at [functions/src/stripeWebhook.ts](../../../functions/src/stripeWebhook.ts) and [functions/src/onSubscriptionWrite.ts:37-44](../../../functions/src/onSubscriptionWrite.ts).

Kill switch: env var `QUO_WEBHOOK_ENABLED=='true'` required for the function to do anything other than return 404. Same safe-by-default pattern as the existing Stripe webhook.

### Retry / failure handling

- **Always return 200 on accepted webhooks** (signature valid, idempotent dedup hit OR successful handle).
- Return **400** on bad signature, missing headers, malformed body, or invalid event type — these are non-retryable client errors and we don't want Quo wasting attempts on them.
- Return **503** on idempotency-store failure or downstream Firestore write failure — Quo Beta retries up to 8 times over ~27.5h with exponential backoff (5s → 10h), giving us a long recovery window.
- Set the function timeout to **60s** to match Quo's 10s soft-timeout (legacy) plus headroom for cold start.

### Webhook tenant isolation invariants

These are HARD invariants. Any future contributor who breaks them creates a cross-tenant data leak.

1. **`businessId` MUST be derived solely from `quoPhoneNumbers/{toE164}` (the dialed number's mapping doc).** It is NEVER taken from the webhook payload. A forged but HMAC-valid payload from a compromised Quo workspace can only affect the tenant who owns the dialed number on our side.
2. **`toE164` MUST be extracted from the payload BEFORE the businessId resolution.** Order of operations:
   1. Outer handler reads `toE164` from `payload.data.context.participants.workspace[0]` (Beta) or `payload.data.object.to` (legacy fallback), normalizes via `normalizePhone()` — REJECT 400 if `valid === false`.
   2. Outer handler reads `quoPhoneNumbers/{normalizedToE164}` — if missing OR `active === false`, returns **200 + structured log warning** (so Quo stops retrying) and writes NOTHING. This is a deliberate ghost-write prevention.
   3. Outer handler resolves `businessId = numberDoc.data().businessId`.
   4. Outer handler THEN calls `resolveAndWrite(payload, businessId, normalizedToE164)`.
3. **All customer / vehicle / job / lead lookups MUST be path-scoped to `businesses/{resolvedBusinessId}/...`.** Collection-group queries on `phoneKey` (or any field) are **EXPLICITLY FORBIDDEN** in the webhook handler. Code review for any future PR touching this file MUST reject collection-group queries.
4. **`toE164` normalization at write AND read.** `adminConnectQuoNumber` MUST normalize its input via the same `normalizePhone()` helper and reject `valid === false`. Otherwise an operator typing `305-897-7030` into the admin form and Quo sending `+13058977030` in the payload would produce two doc IDs that never match.
5. **Uniqueness / ownership on `quoPhoneNumbers/{e164}`.** `adminConnectQuoNumber` MUST refuse to overwrite an existing doc whose `businessId !== caller.businessId`. The refusal is hard: return an error to the caller with code `'phone_number_owned_by_other_business'` and write an audit entry to `quoPhoneNumberOwnershipAudits/{ts}_{e164}`. An explicit `force: true` parameter, owner-only, plus a confirmation in the UI, is required to override — and any forced overwrite ALSO writes the audit entry.

### Customer resolution algorithm (inside the handler)

```ts
// Outer handler (abbreviated, after HMAC + idempotency):
const toE164Raw = payload.data.context?.participants?.workspace?.[0]?.phoneNumber
               ?? payload.data.object?.to
               ?? '';
const toNorm = normalizePhone(toE164Raw);
if (!toNorm.valid) { res.status(400).send('bad to-number'); return; }

const numberDoc = await db.doc(`quoPhoneNumbers/${toNorm.e164}`).get();
if (!numberDoc.exists || numberDoc.data()?.active === false) {
  console.warn('quoWebhook_unmapped_number', { toE164: toNorm.e164, webhookId: id });
  res.status(200).send('ok'); // stop retries; nothing to do
  return;
}
const businessId = numberDoc.data()!.businessId as string;
const assignedToUid = numberDoc.data()?.defaultAssignedToUid ?? null;

await resolveAndWrite(payload, businessId, toNorm.e164, assignedToUid);

// resolveAndWrite:
async function resolveAndWrite(payload, businessId, toE164, assignedToUid) {
  const callId = payload.data.resource.id;
  const fromE164Raw = payload.data.context?.participants?.external?.[0]?.phoneNumber
                   ?? payload.data.resource.from
                   ?? '';
  const fromNorm = normalizePhone(String(fromE164Raw));

  // Invalid caller phone → write unknown-caller doc, no phoneKey lookup.
  if (!fromNorm.valid) {
    await db.doc(`businesses/${businessId}/incomingCalls/${callId}`).set({
      id: callId, quoCallId: callId, direction: 'incoming', status: 'ringing',
      fromE164: '', fromDigits: '', toE164,
      customerId: null, customerName: null,
      customersSnapshot: [], additionalMatchesCount: 0,
      lastJobSummary: null, assignedToUid,
      lookupSkippedReason: 'invalid_phone',
      createdAt: FieldValue.serverTimestamp(),
      ringingExpiresAt: Timestamp.fromMillis(Date.now() + 60_000)
    });
    return;
  }
  const { e164, digits } = fromNorm;

  // 1. Find customer(s) — path-scoped, NEVER collection-group.
  const custSnap = await db.collection(`businesses/${businessId}/customers`)
    .where('phoneKey', '==', digits).limit(4).get();
  const customer = custSnap.docs[0]?.data() ?? null;
  const customerId = custSnap.docs[0]?.id ?? null;
  const hasMultiple = custSnap.size > 1;  // shared phone number edge case

  // 2. Build customersSnapshot for up to 3 matches; record overflow count.
  const customersSnapshot = [];
  const matchDocs = custSnap.docs.slice(0, 3);
  for (const doc of matchDocs) {
    const cData = doc.data();
    const vSnap = await db.collection(
      `businesses/${businessId}/customers/${doc.id}/vehicles`
    ).orderBy('lastServicedAt', 'desc').limit(3).get();
    customersSnapshot.push({
      customerId: doc.id,
      name: cData.name ?? null,
      vehiclesSnapshot: vSnap.docs.map(d => d.data())
    });
  }
  const additionalMatchesCount = Math.max(0, custSnap.size - 3);

  // 3. Last job summary — for the PRIMARY (first) customer only.
  //    Privacy: scope by assignedToUid when set so techs don't see other techs' jobs.
  //    When assignedToUid is null (rings everywhere), snapshot identity-only — no paymentStatus.
  let lastJobSummary = null;
  if (customerId) {
    let q = db.collection(`businesses/${businessId}/jobs`)
      .where('customerId', '==', customerId);
    if (assignedToUid) q = q.where('techId', '==', assignedToUid);
    const jSnap = await q.orderBy('date', 'desc').limit(1).get();
    const j = jSnap.docs[0]?.data();
    if (j) {
      lastJobSummary = {
        jobId: j.id, service: j.service, date: j.date,
        vehicleLabel: j.vehicleMakeModel || j.vehicleType || '',
        tireSize: j.tireSize ?? null,
        // paymentStatus only when the lookup was tech-scoped — never leak other techs' financial outcome.
        paymentStatus: assignedToUid ? j.paymentStatus : null
      };
    }
  }

  // 4. Write the call doc.
  await db.doc(`businesses/${businessId}/incomingCalls/${callId}`).set({
    id: callId, quoCallId: callId, direction: 'incoming', status: 'ringing',
    fromE164: e164, fromDigits: digits, toE164,
    customerId, customerName: customer?.name ?? null,
    customersSnapshot, additionalMatchesCount,
    lastJobSummary, assignedToUid,
    createdAt: FieldValue.serverTimestamp(),
    ringingExpiresAt: Timestamp.fromMillis(Date.now() + 60_000),
    multipleMatches: hasMultiple
  });
}
```

**Multi-match render contract.** The `incomingCalls` schema replaces the singular `customerName` + `vehiclesSnapshot` with a `customersSnapshot: Array<{customerId, name, vehiclesSnapshot}>` (capped at 3) plus an `additionalMatchesCount: number` for the overflow. The primary customer (`customerId`, `customerName`) still appears as top-level convenience fields for the most common single-match case; on shared-phone cases the client renders the first entry of `customersSnapshot` as the hero, a secondary chip "Also: {name} (+N more)" using `customersSnapshot[1].name` and `additionalMatchesCount`, and a tap-to-disambiguate sheet that lets the operator pick which customer the call is for. The picked customerId is written back via the same Firestore rule that allows members to update `status`/`answeredByUid`/`callbackBookedJobId` — extend the rule's `affectedKeys()` allowlist to include `customerId`.

**Privacy posture for `lastJobSummary`.** When the line has a `defaultAssignedToUid` set, the snapshot reads only that tech's jobs (no cross-tech leak). When the line rings everywhere (`assignedToUid == null`), the snapshot omits `paymentStatus` entirely — the most sensitive field — and shows identity + service + date only. This satisfies the tenant-isolation review and preserves the popup's "triage at a glance" UX.

---

## Real-Time Popup Delivery

**Decision: Firestore `onSnapshot` with a query-level filter.** No FCM in v1. Rationale:

| Option | Latency (foreground) | Latency (background) | New infra | Reuses MSOS patterns |
|---|---|---|---|---|
| Per-business "presence" doc | 200-800ms | Suspended | None | Yes — mirrors `presence.ts` |
| **Filtered onSnapshot query** | **200-800ms** | **Suspended** | **None** | **Yes — mirrors `fbListen` usage in App.tsx** |
| FCM web push | <1s | Wakes service worker | FCM SDK + sw.js push handler + token table + VAPID + Notification.requestPermission | No — none of this exists today |
| Polled query (every 3s) | 1.5s avg | Suspended | None | Sort-of, but defeats the purpose |

We pick **filtered onSnapshot** because it's the only option that ships in v1 with zero new infrastructure. FCM is the Phase 12 future-ready seam.

**Implementation:**

```ts
// src/lib/useIncomingCallListener.ts
import { collection, query, where, onSnapshot, limit, orderBy } from 'firebase/firestore';
import { _db } from './firebase';

export function useIncomingCallListener(businessId: string | null, uid: string): IncomingCall | null {
  const [call, setCall] = useState<IncomingCall | null>(null);
  useEffect(() => {
    if (!businessId) return;
    const q = query(
      collection(_db, `businesses/${businessId}/incomingCalls`),
      where('status', '==', 'ringing'),
      orderBy('createdAt', 'desc'),
      limit(5)
    );
    const unsub = onSnapshot(q, snap => {
      const now = Date.now();
      const fresh = snap.docs
        .map(d => d.data() as IncomingCall)
        .filter(c => c.ringingExpiresAt?.toMillis?.() > now)
        .filter(c => c.assignedToUid == null || c.assignedToUid === uid);
      setCall(fresh[0] ?? null);
    });
    return unsub;
  }, [businessId, uid]);

  // Auto-clear when ringingExpiresAt passes
  useEffect(() => {
    if (!call) return;
    const ttl = call.ringingExpiresAt.toMillis() - Date.now();
    if (ttl <= 0) { setCall(null); return; }
    const t = setTimeout(() => setCall(null), ttl);
    return () => clearTimeout(t);
  }, [call]);

  return call;
}
```

**Why this is <2s end-to-end:**

- Webhook receipt → Firestore write: ~200-500ms (HMAC + 2 reads + 1 write on warm function; +500-1000ms cold start tolerated since fact-of-call already arrived at Quo before ring)
- Firestore write → onSnapshot fire: 200-800ms typical (Firebase realtime channel)
- onSnapshot → setState → modal render: <100ms

p50 ~1s, p95 ~2s on foregrounded devices. p99 may exceed 2s on cold start; that's the failure mode we accept.

**Backgrounded-tab gap (documented, not fixed in v1):** Mobile Safari/Chrome suspend WebSockets after ~30s in background. A ring that arrives while the operator's screen is locked or tab is hidden will not fire `onSnapshot` until they return. **Mitigation in v1:** Sub-Project 5 ensures every missed call also creates a `Lead` and fires an `addActionToast` "Missed call from Maria Lopez" on next tab focus, with tap-to-open-profile. **Real fix (SP7):** FCM web push wakes the service worker even when the tab is suspended.

**Z-index sovereignty:** `IncomingCallModal` uses `z-index: 9500`, above MoreSheet's 9000 and the default `.modal-overlay`'s 1000. The modal is single-instance (the listener returns at most one call); no stacking concerns.

### Cross-device Accept/Decline race contract

The popup may render on multiple foregrounded devices simultaneously. Two tech tap Accept within milliseconds. Spec must define the resolution.

1. **Accept is a Firestore transaction.** The IncomingCallModal's Accept handler reads `incomingCalls/{callId}` inside `runTransaction`:
   - If `status !== 'ringing'`, **abort** the write. Show a 2.5s toast on the losing device: *"Already answered by {answeredByName}"* (resolved from `members/{answeredByUid}`), then fade the modal.
   - Else, `tx.update(ref, { status: 'answered', answeredByUid: currentUid })`.
2. **Decline uses the same transactional pattern.** Losing devices see `"Declined by {name}"` toast then fade.
3. **Other devices' modals do not vanish silently mid-tap.** The listener already filters `status === 'ringing'`; when the doc transitions to `answered` / `declined`, the listener's `setCall(null)` would normally remove the modal instantly. Instead the modal listens to the doc directly (single-doc `onSnapshot` on the currently-mounted callId) and on a `status` transition shows a **brief 1.5s confirmation** card *"Answered by {name}"* (or *"Declined by {name}"*) before fading. This avoids the jarring instant-disappear when the user was mid-tap.
4. **`answeredByName` resolution.** The transactional write only stores `answeredByUid`; the toast/confirmation resolves the display name client-side from the `members` map already in App.tsx state.
5. **Same-device winner UX.** If the device that won the race is the same device the operator is looking at, the modal fades on its own snapshot transition. No special celebration — the call has been picked up and a normal post-accept flow takes over (CustomerProfile open / Call connected to native dialer).

### Multi-operator delivery rule — resolved

Open Question #2 (was unresolved) is **resolved in this spec** as follows:

- **Default: rings every foregrounded device in the business** (the spec's headline-goal language).
- **`quoPhoneNumbers/{e164}.defaultAssignedToUid`** is a per-line override: when set, only that user's foregrounded devices ring.
- **`incomingCalls.assignedToUid` is a per-call override.** Populated by the Cloud Function from the Quo payload's routing data when available — Quo Beta surfaces the targeted workspace user in `payload.data.context.participants.workspace[0].userId`. We map Quo user ids to MSOS uids via a `quoUserMapping/{quoUserId}` doc with `{ businessId, msosUid }` (owner-managed via SP4's debug panel). If a mapping exists, `incomingCalls.assignedToUid` takes precedence over `defaultAssignedToUid`. If no mapping exists, we fall back to the line-level `defaultAssignedToUid` and then to "all members" (null).
- The listener filter `assignedToUid == null || assignedToUid === uid` correctly delivers in all three modes without further code changes.
- Success criterion is precise: **every FOREGROUNDED MSOS device that the call is targeted at**. Backgrounded devices are SP5 (toast) and SP7 (FCM) concerns — not a v1 deliverable for SP6.

### Missed-call reconciliation — closes the "calls never vanish" promise

Three concrete mechanisms ensure missed calls never disappear:

1. **Reconciliation scheduled function (`reconcileQuoCalls`)** runs every 5 minutes (`onSchedule('every 5 minutes')`). Reads each `quoPhoneNumbers/{e164}` with `active === true`, calls Quo's `/v1/calls?phoneNumberId={id}&since={lastSyncTs}` API, and creates/updates `incomingCalls/{id}` docs for any call missing from Firestore. Same idempotency key (Quo callId == doc id) prevents duplicates. Status determined from Quo's `status` field. Persisted `quoSyncCursors/{quoPhoneNumberId}.lastSyncedAt` cursor advances after each successful poll. Added to SP4 scope.
2. **Stale-ring guard in the handler.** When `call.ringing` arrives and `payload.data.resource.createdAt` is more than **30 seconds old** at function-receipt time, the handler writes `status='missed'` directly (skipping `'ringing'`) so we don't pop a popup for a call the customer already hung up on. Also writes the Lead row as if `call.missed` had fired.
3. **Manual "Attach to customer" action on Leads page.** When a webhook arrived with `customerId: null` (unknown caller) and the operator later identifies them, they can pick a customer from a typeahead and the Leads page updates `leads.customerId` and the corresponding `incomingCalls.customerId` (rule allowlist already includes `customerId`). Gated by `canCreateJobs`. Added to SP5.

### Ringtone autoplay degradation (mobile browser gesture requirement)

`HTMLAudioElement.play()` requires a prior user gesture in the same tab on iOS Safari and most mobile Chrome contexts. A foregrounded MSOS tab that has been idle (the operator is on another tab, or just opened MSOS that day) often will NOT have a recent gesture, and `audio.play()` will reject with `NotAllowedError`.

**v1 behavior:**
- On app load (App.tsx mount), register a one-time `pointerdown` listener that primes a hidden audio element by calling `.play()` then immediately `.pause()` — this "unlocks" autoplay for the session.
- The `IncomingCallModal` catches `NotAllowedError` from `.play()` silently and still renders the visual popup. The ringtone is best-effort.
- A small "audio blocked — tap to enable ringtone" banner appears in Settings → Integrations if the unlock has never succeeded for this device/browser. SP4 surfaces the status.
- This is documented as a known v1 degradation; SP7 may add a service worker push with a system notification sound that bypasses the gesture requirement.

---

## RBAC — Technician vs Admin

Reuses the existing `Permissions` flag system at [src/lib/permissions.ts](../../../src/lib/permissions.ts) **without introducing new flags**.

**Customer Profile field visibility:**

| Field | Owner | Admin | Technician | Gate |
|---|---|---|---|---|
| Name | ✓ | ✓ | ✓ | always |
| Phone | ✓ | ✓ | ✓ | always |
| Email | ✓ | ✓ | ✓ | always |
| Address (line / city / state) | ✓ | ✓ | ✓ | always |
| Tags | ✓ | ✓ | ✓ | always |
| Notes | ✓ | ✓ | read-only | edit gated `canEditBusinessSettings` |
| Vehicles list | ✓ | ✓ | ✓ | always |
| Service Timeline (job rows) | ✓ | ✓ | own jobs only | already enforced by `scopeJobsByRole` |
| Per-row Revenue | ✓ | ✓ | own jobs only | already via job rules |
| Per-row Profit | ✓ | ✓ | ✗ | `permissions.canViewProfit` — already used at [JobDetailModal.tsx:121-135](../../../src/components/JobDetailModal.tsx) |
| Lifetime Revenue (stat) | ✓ | ✓ | ✗ | `permissions.canViewFinancials` |
| Lifetime Profit (stat) | ✓ | ✓ | ✗ | `permissions.canViewProfit` |
| Lifetime Expenses | ✓ | ✓ | ✗ | `permissions.canViewFinancials` |
| Last Visit, Visit Cadence, Job Count | ✓ | ✓ | ✓ | always (operational metadata, not financial) |

**Key delta from today:** the current `Customers.tsx` page renders Lifetime Revenue *unconditionally* and only gates Lifetime Profit at [line 600](../../../src/pages/Customers.tsx). The new `CustomerProfile` and the updated `Customers.tsx` BOTH gate Revenue on `canViewFinancials` (stricter). Per-job Revenue inside the timeline remains visible to techs because they collect in field and need it — `permissions.canViewRevenue` is true for techs by design and this nuance is preserved.

**IncomingCallModal visibility:**

- Caller name, phone, vehicle, last-service summary: shown to all roles.
- "Send Quote / Invoice" buttons: visible only when `permissions.canGenerateInvoices` (true for all three roles today, but the gate is explicit for future plan-cap variations).
- "Create Job" button: visible only when `permissions.canCreateJobs` (true for all three).
- No financial figures are ever rendered inside the popup — by design, the popup is identity-only.

**Firestore-level enforcement:**

Field-level masking is not possible in Firestore rules. We choose **client-side gating** for financial fields on the Customer doc because they are not persisted (derived from jobs already scoped by `scopeJobsByRole`). The doc itself contains only identity + metadata, none of which is sensitive. This avoids splitting the doc into `customers/{id}` + `customers/{id}/financials/summary` — which the original synthesis considered — keeping the schema simpler.

For `IncomingCall` docs: vehicle / last-job snapshot is included as denormalized JSON for fast render. Techs see only their assigned jobs' summary because the webhook handler honors `assignedToUid` at write time. Across roles, the snapshot fields are non-financial.

For `Lead` docs: only `convertedJobId` is potentially financial-adjacent (links to a real job); the lead doc itself is operational. Techs see all leads in the business but can only convert (not delete) them.

**Why client-side gating is sufficient for financial fields on CustomerProfile (explicit reasoning):**

1. The Customer doc itself contains **zero financial fields** — only identity (name, phone, email, address), operational rollups (jobCount, firstJobAt, lastJobAt, lastJobId), and meta (note, tags).
2. Lifetime Revenue / Profit / Expenses are computed **live, on the client, from the `jobs` collection**.
3. `jobs` reads are server-enforced via `scopeJobsByRole` (rules at `firestore.rules:573-588`) — a technician can ONLY read jobs where they are the assigned tech.
4. **Therefore** the derivation pipeline (jobs → rollup) is already server-scoped at the source; the technician's "Lifetime Revenue" total is mathematically incapable of including jobs that aren't theirs. The CSS-hidden financial summary is computed from data the tech is already permitted to see.
5. The client gating (`{canViewFinancials && <LifetimeRevenue />}`) prevents the technician from accidentally seeing their OWN derived total when their role doesn't include `canViewFinancials` — but the data is theirs to begin with. There is no field on the technician's device that the technician is forbidden to see; the gate is a presentation choice, not a security boundary.

Auditable summary by enforcement layer:

| Field | Persisted? | Server enforcement | Client enforcement |
|---|---|---|---|
| Customer.name / phone / email / address | yes | role-based read on customers doc | none |
| Customer.note / tags | yes | role-based edit on customers doc (owner/admin only) | edit UI hidden for techs |
| Customer.jobCount / firstJobAt / lastJobAt | yes | role-based read | none |
| Lifetime Revenue (derived) | NO (computed on read) | `scopeJobsByRole` filters source jobs | `canViewFinancials` gates rendering |
| Lifetime Profit (derived) | NO | `scopeJobsByRole` filters source jobs | `canViewProfit` gates rendering |
| Per-job Revenue (in timeline) | yes on Job | `scopeJobsByRole` (techs see own only) | `canViewRevenue` (true for techs) |
| Per-job Profit (in timeline) | yes on Job | `scopeJobsByRole` | `canViewProfit` (false for techs) |
| IncomingCall.lastJobSummary.paymentStatus | yes on IncomingCall | webhook scopes by `assignedToUid` when set; null otherwise | none — server-stripped |

### Recordings & transcripts — compliance posture

`incomingCalls.recordingUrl` and `incomingCalls.transcript` are persisted in v1 (fields exist, written by `call.recording.completed` and `call.transcript.completed` handlers) even though they are NOT surfaced in any v1 UI. Posture:

1. **Storage location.** `recordingUrl` points at Quo's CDN (signed URL with Quo-defined expiry). The recording itself is not stored in Firestore or Cloud Storage in v1 — only the URL is. Quo's retention policy governs the recording itself; operators must align Quo's retention settings with their published privacy policy.
2. **Transcripts in Firestore.** `transcript` is stored as plaintext on the `incomingCalls` doc. CMEK encryption is OUT OF SCOPE for v1. Accepted risk; documented.
3. **Access control in v1.** Any active business member can read `incomingCalls` and thus the `recordingUrl` and `transcript`. SP7 will introduce a `canViewRecordings` Permissions flag and gate these fields client-side; v1 deliberately delegates access to the role-level membership check.
4. **Two-party-consent jurisdictions.** Recording calls without notification is illegal in California, Florida, Pennsylvania, and other two-party-consent states. The OPERATOR is responsible for enabling Quo's built-in recording disclosure prompt. The spec does NOT generate the disclosure; it does NOT validate compliance; this is documented as the operator's regulatory obligation. SP4's Settings → Integrations panel will surface a notice and link to Quo's docs.
5. **Cascade deletion.** Recording URLs and transcripts on `incomingCalls` are deleted alongside the call doc on business deletion (via `recursiveDelete(businessRef)`). The Quo-hosted recording itself is NOT deleted by MSOS — Quo's retention policy applies. The SP7.5 GDPR follow-up adds a Quo API call to delete the recording in response to a per-customer erasure request.
6. **Logging hygiene.** `transcript` must NEVER appear in Cloud Logging (it is customer PII). Handler logic that processes transcripts MUST NOT log payload bodies at any level.

---

## AddJob Workflow Change

**New step order (top-down):**

1. **NEW — Customer Lookup card** (`<CustomerLookupCard />`)
2. Suggested-price sticky tile (existing)
3. Miles to job (existing)
4. Tire cost (existing, tire vertical)
5. Revenue charged (existing)
6. Vehicle size chips (existing)
7. Service picker (existing)
8. Add-ons chips (existing, detailing)
9. Vehicle chips (existing)
10. Customer card (existing — now Name / Phone / Email / Address / City)
11. Assigned to (existing)
12. Vertical job fields loop (existing)
13. … (all remaining sections unchanged)

The Customer Lookup card sits **above** the suggested-price tile because the headline value prop is "type a known phone and the form auto-fills before you pick a service." The existing Customer card stays in its original position to handle new-customer entry and manual overrides — operators who already know it's a new customer just skip the lookup card.

### Returning Customer card spec

When `lookupCustomerByPhone` returns a hit:

```
+-------------------------------------------------+
|  [✓ Returning Customer]      Last seen 3w ago  |
|                                                 |
|  Maria Lopez                                    |
|  (305) 897-7030 · maria@example.com             |
|  Miami, FL                                      |
|                                                 |
|  Vehicles:  [Honda Civic · 215/55R17]           |
|             [Toyota Camry · 205/55R16]          |
|                                                 |
|  Last service: Tire Replacement · $480 · Paid   |
|                                                 |
|  [Use Customer]  [Repeat Last Service]  [×]     |
+-------------------------------------------------+
```

**Fields rendered:**
- Repeat badge (always, when there's any match)
- Last-seen relative time
- Name (bold, hero)
- Formatted phone + email (when present)
- City + state (when present)
- Vehicles as tappable chips — tapping one selects it as the "active vehicle" for this draft
- Last-job line: service, revenue, payment status
- Three buttons + dismiss

**Buttons:**

| Button | Behavior |
|---|---|
| **Use Customer** | Sets `draft.customerId`, `draft.vehicleId` (from selected chip or first vehicle), copies `name → customerName`, `phoneE164 → customerPhone` (via `formatPhoneForDisplay`), `email → customerEmail`, `city → city`, `state → state`. Does NOT prefill service, revenue, miles. |
| **Repeat Last Service** | All of "Use Customer" PLUS clones from `lastJobSummary.jobId`: `service`, `vehicleType`, `vehicleMakeModel`, `vehicleSize`, `tireSize`, `tireBrand`, `qty`, `source` (lead source), `payment` (method). Does NOT copy: `revenue`, `tireCost`, `materialCost`, `note`, `parts`, `photos`, `timeSessions`, `inventoryDeductions`, `partsInventoryDeductions`, `paymentStatus`, `status`, `createdAt`, `lastEditedAt`. Same exclusion list as `handleDuplicate` at [src/App.tsx:1296-1302](../../../src/App.tsx) — operator must re-enter what they charge. |
| **×** | Dismisses the card without affecting the draft. Phone stays in the input. |

**Auto-fill behavior:** the autofill is **non-destructive merge** — if the operator already typed a name into the existing Customer card before the lookup matched, "Use Customer" overwrites with a confirmation toast ("Customer auto-filled from match. Tap to undo."). The undo restores the prior draft via a snapshot kept in `useRef`.

**Miss state:** when no match is found after 500ms of stable input, the card shows:

```
+-------------------------------------------------+
|  No match for (305) 555-0100                    |
|  [Continue as new customer]                     |
+-------------------------------------------------+
```

Tapping the button collapses the lookup card and focuses the existing Customer card's Name input.

### saveJob change

[src/App.tsx:842-1099](../../../src/App.tsx) gains one insertion between the `finalJob` assembly at line 1076 and the `fbSetFast(jobsCol, ...)` write at line 1078:

```ts
try {
  const { customerId, vehicleId } = await upsertCustomerFromJob(businessId, finalJob);
  if (customerId) finalJob.customerId = customerId;
  if (vehicleId) finalJob.vehicleId = vehicleId;
  const phone = normalizePhone(String(finalJob.customerPhone ?? ''));
  if (phone.valid) finalJob.phoneKey = phone.digits;
  // NEVER write phoneKey when invalid — '' and short codes would pollute the directory.
} catch (err) {
  addToast('Customer record not updated (job saved anyway)', 'warn');
  console.warn('upsertCustomerFromJob failed', err);
}
await fbSetFast(jobsCol, finalJob.id, finalJob);
```

The try/catch enforces the contract: **the Job write is authoritative; the Customer upsert is best-effort.** If Firestore rejects the customer upsert (e.g. transient permissions issue), the job still saves with `customerId === undefined` and falls back to the derived path on read. The `if (phone.valid)` guard mirrors the `normalizePhone` contract above — invalid inputs never produce a `phoneKey`.

### Concurrency contract — upsertCustomerFromJob

Two technicians on different devices can save jobs for the same customer at the same time. The doc ID is deterministic so we get no double-create, but naive field-level merge would corrupt the rollups (jobCount stuck at 1, firstJobAt overwritten, lastJobAt going backward). The helper MUST therefore run as a Firestore transaction with the following rules:

1. **`jobCount`** — `FieldValue.increment(1)`, gated by the per-job idempotency key (next bullet).
2. **Idempotency key** — `processedJobIds` is an array field on the Customer doc capped at the last 100 jobIds via `FieldValue.arrayUnion(jobId)` + an out-of-band trim (or a small `processedJobs` map subdocument if array bloat becomes a concern). Inside the transaction: read the customer; if `jobId` is already present in `processedJobIds`, SKIP the `jobCount` increment and the `lastJobAt` / `lastJobId` update but still merge identity fields (name/phone/email/city/state) — those should reflect the latest typed values. This makes the upsert safe to retry on transient errors.
3. **`firstJobAt`** — transactional read-then-set-if-absent. Once set, never overwritten.
4. **`lastJobAt`** — `lastJobAt = max(existing ?? 0, job.date)`. Computed inside the transaction. Prevents B's earlier-dated job from clobbering A's later-dated one.
5. **`lastJobId`** — write only if `job.date >= existing.lastJobAt`. Same rule as `lastJobAt`.
6. **`createdByUid`** — set if absent; never overwritten.
7. **`createdAt`** — server timestamp; set if absent; never overwritten.
8. **`updatedAt`** — always overwritten (ISO string for client writes — see *Client-write field types* below).
9. **Identity fields (name, phoneE164, phoneKey, email, addressLine, city, state)** — always merge-write with the values from the current job. Last-write-wins on these is acceptable because the operator who typed the most recent value almost certainly has the freshest data. (If this becomes a problem we'll add an explicit "Edit customer" surface in SP3 — already part of the spec.)
10. **Vehicle subdoc** — same transactional treatment: increment `serviceCount`, max `lastServicedAt`, set-if-absent `createdAt`, idempotency via a `processedJobIds` array on the vehicle doc.

**Client-write field types:** Firestore client writes go through `fbSetFast` (`src/lib/firebase.ts:209-223`), which JSON-stringifies object values and would corrupt `FieldValue.serverTimestamp()` / `FieldValue.increment()` / `Timestamp` instances. Therefore:

- **From the client (`upsertCustomerFromJob` running in saveJob):** use `runTransaction` directly with the unmodified Firestore SDK — bypass `fbSetFast`. Inside the transaction, `FieldValue.increment(1)` / `FieldValue.arrayUnion(jobId)` are written as-is on `tx.update(...)`. For timestamp-type fields written from the client, store ISO strings (`new Date().toISOString()`) and let the Cloud Function path use real `Timestamp` / `serverTimestamp()`. The schema-table columns marked `Timestamp` accept either form on read (a string parses to a Date; a Timestamp `.toDate()`s); document this dual-form explicitly in the `Customer` TypeScript interface so future contributors don't get caught.
- **From the Cloud Function (`quoWebhook`, `adminConnectQuoNumber`, future SP7 background jobs):** use admin SDK directly with `FieldValue.serverTimestamp()` and real `Timestamp` — admin SDK bypasses `fbSetFast` entirely.

**Customer-changes-phone-number edge case — explicit v1 behavior.** If Maria's number changes from `(305) 897-7030` to `(305) 555-0001` and her next job is saved with the new phone:

- `upsertCustomerFromJob` computes `customerKey = 'p_13055550001'` from the new phone and creates a **second** Customer doc. Her history splits between the two docs.
- The old Customer doc is unchanged; jobs already pointing at `customerId = 'p_13058977030'` continue to render under the old profile.
- The Customers page shows both rows (operator sees the split immediately).
- **v1 has no auto-merge.** An owner/admin merges manually by editing the new doc's phone back to the old number (which re-routes the upsert) or by using the SP7 "merge customers" admin tool listed below. The Out of Scope section is updated to call this out.
- **v1 has no auto-detection.** No background warning UI surfaces the split — that's a deliberate v1 scope cut to keep the slice small. The operator notices via the duplicate row in Customers.
- The shared-phone case (husband and wife both saved jobs under the same phone) IS supported in v1: both writes land on the same Customer doc; the doc carries whichever name was typed most recently. The popup's `multipleMatches` handling (below) does NOT trigger because there's only one Customer doc — `multipleMatches` is reserved for the rare case where someone manually created two Customer docs that happen to share a phone (e.g. by editing one customer's phone to match another's). Spec-as-written supports both branches.

**SP7 follow-up (added to Ship Order):** an admin "Merge customers" tool that takes two Customer doc IDs and rewrites every Job's `customerId` from source → target, sums the rollup counters, concatenates notes, unions tags, then soft-deletes the source. Spec deferred — placeholder in SP7.

---

## Customer Profile Actions

The 9 buttons in the Quick Actions row, each labeled with its dispatch path:

| # | Button | Behavior | Existing or New? | Further design? |
|---|---|---|---|---|
| 1 | **Create Job** | Navigates to `add` tab with draft preloaded: `customerId`, `vehicleId`, `customerName`, `customerPhone`, `customerEmail`, `city`, `state`, plus pre-selected vehicle chip. Reuses existing `setTab('add')` + draft-preload mechanism from `handleDuplicate`. | New wiring, reuses existing draft mechanism | No |
| 2 | **Repeat Last Service** | Same as the Returning Customer card's "Repeat Last Service" button. Calls a shared helper. | New wiring | No |
| 3 | **Call** | `<a href={`tel:${customer.phoneE164}`}>`. Uses device's native dialer. Free, instant. Logs `lastContactedAt = now` on the customer doc via merge write. | New | No |
| 4 | **Text** | `<a href={`sms:${customer.phoneE164}`}>`. Native SMS app. Same `lastContactedAt` update. | New | No |
| 5 | **Send Quote** | Opens existing QuoteWorkflow (separate spec, [2026-05-22-quote-workflow-design.md](2026-05-22-quote-workflow-design.md)) preloaded with customer + most-recent vehicle. | Existing dispatch, new entry point | No |
| 6 | **Send Invoice** | Resolves to last unpaid job for this customer; if found, opens the existing invoice send flow (reuses the path triggered from JobDetailModal). If no unpaid jobs, shows toast "No unpaid jobs for this customer." | Existing dispatch | No |
| 7 | **Send Review** | Reuses existing ReviewAutomation send path ([2026-05-22-review-automation-design.md](2026-05-22-review-automation-design.md)), targets `customer.email` (falls back to phone). | Existing dispatch | No |
| 8 | **Edit** | Inline editing of name / email / address / tags / notes within the profile (no separate modal). Gated by `canEditBusinessSettings` for notes/tags (existing `canEditNote` pattern at [Customers.tsx](../../../src/pages/Customers.tsx)), `canEditJobs` for identity fields (techs can update name typos but not delete the customer). | New UI, existing permission gates | No |
| 9 | **Delete** | Owner/admin only. Confirms with "This will hide the customer but keep all jobs intact. Continue?" Soft-delete via `customer.deletedAt = now`. Read paths filter `deletedAt == null`. Jobs retain `customerId` for audit. | New | No |

All 9 buttons are part of SP3. None require further design after this spec.

---

## Future-Ready Seams

Phase 12 (the user's "ready for AI receptionist later" requirement) is delivered by named seams in the v1 schema and components — no rewrites needed when future work lands.

| Future capability | Seam in v1 | What still needs to be built later |
|---|---|---|
| **AI receptionist** | `incomingCalls.transcript` (from `call.transcript.completed`) + `leads.status` state machine (`'new' → 'contacted' → 'converted' \| 'lost'`) | A new Cloud Function `aiReceptionistHandler` triggered on `incomingCalls.transcript` writes; updates `lead.status` and writes a follow-up suggestion to `leads.aiSuggestedAction`. Frontend consumes existing `Lead` type. |
| **Retention campaigns** | `customer.tags` (existing, preserved) + `customer.lastContactedAt` (new field, written on every Call/Text action and on Accept of an incoming call) + `customer.lastJobAt` | A scheduled Cloud Function that queries `customers where lastJobAt < now - 60d AND lastContactedAt < now - 30d AND 'no_marketing' not in tags` and enqueues an SMS/email send. The query already works against the v1 schema. |
| **Auto-text-back on missed call** | `quoWebhook` already handles `call.missed` and creates the Lead. `QUO_API_KEY` already registered as a secret in v1. | A new helper in `quoWebhook` that POSTs to Quo's `/v1/messages` endpoint when `settings.autoTextBackEnabled == true` AND `customer.tags` does not include `'no_marketing'`. Per-business toggle added to Settings. |
| **FCM background push** | The IncomingCallModal already accepts being driven by any state setter; switching from Firestore listener to FCM-triggered state requires no UI changes. | Add `firebase/messaging` SDK, register a service-worker push handler in `public/sw.js`, persist FCM tokens per device in a new `businesses/{bid}/members/{uid}/fcmTokens/{tokenId}` subcollection, and modify `quoWebhook` to ALSO send an FCM push (in addition to writing the Firestore doc) when on iOS/Android backgrounded contexts. The Firestore doc remains the source of truth; the push is a wake signal. |
| **Call recording playback** | `incomingCalls.recordingUrl` (persisted in v1, just not rendered) | Add an `<audio>` element to a "Past Calls" section of CustomerProfile that loads `recordingUrl`. v1 stores; v2 surfaces. |
| **Two-way SMS thread in app** | `quoWebhook` event handler already has the routing arm; v1 doesn't subscribe to `message.received`/`message.delivered` but adding them is a one-line change to the Quo webhook subscription + a new switch case in the handler. | A new `businesses/{bid}/conversations/{phoneKey}/messages/{msgId}` subcollection mirroring the call doc shape. ConversationsPage and inline message thread UI. |
| **Vehicle directory (cross-customer)** | The Vehicle subcollection already carries `vin`, `licensePlate`, `color` fields — present but optional in v1. | A top-level vehicle search page that uses a Firestore Collection Group query on `vehicles` filtered by `licensePlate` or `vin`. No schema change. |
| **Multiple matches on shared phone** | `incomingCalls.multipleMatches: boolean` + `vehiclesSnapshot` already carries up to 3 vehicles | IncomingCallModal renders the secondary "Also: Jose Lopez" line when `multipleMatches == true`. v1 already renders this. |
| **Lead → Customer auto-promote** | `Lead.phoneKey` and `Customer.phoneKey` share the same field. When a future job is saved with a matching `phoneKey`, `upsertCustomerFromJob` can detect an unconverted lead and flip `lead.status = 'converted'` + `lead.convertedJobId`. | v1 doesn't auto-promote; the operator does it manually from the Leads page. SP7 adds the auto-flip. |

---

## Ship Order (Sub-Projects)

Each sub-project is shippable in isolation. The order minimizes risk and accumulates value the operator can feel at each step.

### SP1 — Customer + Vehicle entities + saveJob upsert

- **Phases covered:** 1, 2, 11
- **Scope:** `src/lib/phone.ts`, `src/lib/customerEntity.ts`, `src/lib/customers.ts` (hybrid refactor), `src/App.tsx` saveJob hook, `firestore.rules` deltas for `customers/{cid}/vehicles/**` and tightened `customers/{cid}` update rules. NO visible UI change other than the Customers page beginning to surface persisted vehicles on new entries.
- **Rationale:** Smallest viable slice that unlocks every later phase. Adds persistence at save time without changing any visible operator flow. Hybrid read keeps Customers page working for both legacy and new data on day 1. Zero risk because upsert is wrapped in try/catch.
- **Dependencies:** none
- **Ships value when:** Every newly saved job auto-creates a real Customer doc with `phoneKey` and a Vehicle subdoc. Customers page sorts by persisted `lastJobAt` for jobs saved post-deploy.

### SP2 — Phone lookup + AddJob "returning customer" card

- **Phases covered:** 3, 4
- **Scope:** `src/lib/lookupCustomerByPhone.ts`, `src/components/addJob/CustomerLookupCard.tsx`, `src/pages/AddJob.tsx` insertion at top of form, email input added to existing Customer card.
- **Rationale:** First operator-visible win. Phone-first auto-fill on returning customers. The headline mobile-tech win.
- **Dependencies:** SP1
- **Ships value when:** Tech opens AddJob, types `(305) 897-7030`, sees Maria Lopez + Honda Civic / 215/55R17 card in <300ms, taps "Use Customer," watches the whole Customer card autofill.

### SP3 — Customer Profile page + timeline

- **Phases covered:** 5, 9, 10
- **Scope:** `src/pages/CustomerProfile.tsx`, `src/pages/Customers.tsx` modifications (row click → CustomerProfile, tightened revenue gating, vehicles surfaced), routing add to App.tsx, 9 quick-action buttons wired.
- **Rationale:** Customer Profile is the operator-facing payoff of SP1. Decouples nicely from the call popup so we can ship + dogfood + polish before adding the incoming-call surface area.
- **Dependencies:** SP1
- **Ships value when:** Operator taps any customer in Customers page → drills into full profile with phone, vehicles, full service history (reusing JobDetailModal), notes, tags, and 9 quick actions. Techs see same screen minus Lifetime Revenue / Profit / Expenses.

### SP4 — Quo webhook + idempotency + business-number mapping (no UI yet)

- **Phases covered:** 6, 11
- **Scope:** `functions/src/quoWebhook.ts`, `functions/src/adminConnectQuoNumber.ts`, `functions/src/reconcileQuoCalls.ts` (scheduled), `functions/src/lib/phone.ts` (duplicate of client copy), `functions/src/index.ts` export, `firestore.rules` for `incomingCalls/**`, `quoPhoneNumbers/**`, `quoWebhookEvents/**`, `quoUserMapping/**`, `quoSyncCursors/**`. Operator-only debug panel `QuoIntegrationSection.tsx` for verification. **Extension of `scheduledDeletionPurge`** to purge top-level `quoPhoneNumbers` / `quoUserMapping` / `quoSyncCursors` docs owned by a purged business. **Firestore TTL policy on `quoWebhookEvents.createdAt` (28h)** configured at deploy time — hard requirement, not optional.
- **Rationale:** Backend-only. Ship the webhook with full HMAC + idempotency + business resolution + replay-window + tenant isolation invariants before adding the popup surface. Lets us instrument latency and verify the resolution chain (Quo number → business → customer) in production before any operator sees a popup. Reconciliation function closes the "calls never vanish" promise even on webhook outages.
- **Dependencies:** SP1 (needs Customer entity to resolve)
- **Ships value when:** Owner connects their Quo number in Settings → Integrations, places a test call to it from a known customer's phone, and within 1s sees a `incomingCalls/{id}` doc in Firestore with `customerId` resolved + vehicle snapshot. Foundational plumbing done.

### SP5 — Missed-call workflow + Leads

- **Phases covered:** 8
- **Scope:** `quoWebhook` adds Lead creation on `call.missed` (transactional dedup so two parallel webhooks for the same caller don't race-create two leads — read-then-create inside `runTransaction` keyed on `(phoneKey, createdAt window)`), `src/pages/Leads.tsx`, `Lead` type added, MoreSheet tab entry, in-app toast notification on missed call (uses existing `addActionToast` bus), **"Attach to customer" manual link action** for unknown-caller leads (typeahead picks a Customer; updates both `leads.customerId` and the originating `incomingCalls.customerId`).
- **Rationale:** Builds on SP4 webhook plumbing. Missed calls stop vanishing; operators can work the funnel.
- **Dependencies:** SP4
- **Ships value when:** Every missed call to the business number creates a Lead row that any operator can act on. Known customers' missed calls show their name; unknown numbers are first-touch leads. The toast surfaces them in real time when the tab is foregrounded. Lead dedup contract: a missed call from the same `phoneKey` within 7d updates the existing lead's `lastMissedCallAt` and increments `missedCallCount` instead of creating a duplicate row.

### SP6 — Incoming Call Popup (headline feature)

- **Phases covered:** 7, 9, 12
- **Scope:** `src/lib/useIncomingCallListener.ts`, `src/components/IncomingCallModal.tsx`, `src/App.tsx` listener attach + modal render, `/public/sounds/ringtone.mp3` asset. **Accept and Decline are Firestore transactions** with the "already answered by {name}" losing-device UX. Disambiguation sheet for shared-phone matches (renders `customersSnapshot[]` and writes the picked `customerId` back via the update-allowed field). Audio autoplay unlock via a one-time pointer listener on App mount.
- **Rationale:** The headline. Ships last because it depends on Customer entity (SP1), CustomerProfile for "Open Profile" deep-link (SP3), and the webhook pipeline (SP4). Documents the backgrounded-tab gap and the SP5 toast-fallback compensating control.
- **Dependencies:** SP1, SP3, SP4
- **Ships value when:** Customer calls business number → within 1-2s on every foregrounded MSOS device a popup appears showing caller name, vehicle, last service, with Accept / Decline / Open Profile / Create Job and a ringtone. The full headline goal delivered.

### SP7 — Future-ready seams (optional follow-up)

- **Phases covered:** 12
- **Scope:** Per-item; not a single bundle. Items: (a) surface `recordingUrl` and `transcript` in CustomerProfile post-call section (gated by NEW `canViewRecordings` flag); (b) FCM web push for background delivery (firebase/messaging, sw.js push handler, token table, VAPID); (c) auto-text-back on missed call via Quo `/v1/messages` (per-business toggle in Settings); (d) AI receptionist hook on `transcript` write; (e) admin "Merge customers" tool for the customer-changes-phone-number case (rewrites every Job's `customerId` from source → target, sums rollup counters, concatenates notes, unions tags, then soft-deletes the source).
- **Rationale:** Not required for the user's stated goal. Each item ships independently as ROI dictates.
- **Dependencies:** SP6
- **Ships value when:** Each item ships individually — auto-text-back in <1 week; FCM in 2-3 weeks; AI receptionist in a separate quarter-scoped project; customer-merge tool when the first split is reported.

### SP7.5 — GDPR/CCPA hard-delete + customer audit log

- **Phases covered:** compliance follow-up
- **Scope:** "Forget customer (GDPR)" owner-only action with hard cascade (tombstone `customerName`/phone/email/city/state on related Jobs while preserving financial fields for tax compliance; delete `vehicles`/`leads`/`incomingCalls` scrubbed); Firestore trigger Cloud Function populating `businesses/{bid}/customers/{cid}/audits/{auditId}` on every customer doc change; Quo API call to delete the upstream recording for any `recordingUrl` referenced from scrubbed `incomingCalls`; operator-facing compliance log surface in Settings.
- **Rationale:** Soft-delete in v1 is operator UX only and does NOT satisfy regulatory deletion requests. This follow-up closes the compliance gap before MSOS markets to GDPR-regulated jurisdictions or any business that explicitly requires CCPA conformance.
- **Dependencies:** SP3 (Customer profile + soft-delete UI), SP4 (recording URL persistence)
- **Ships value when:** Owner can invoke "Forget customer" from CustomerProfile and the request flows through to (a) MSOS Firestore tombstoning, (b) Quo CDN recording deletion, (c) an audit-log entry the operator can show a regulator.

---

## Out of Scope (this spec)

- No production code yet (design only)
- No live OpenPhone secrets / no real webhook deployment yet
- No backfill of historical jobs into the Customer collection (covered as an optional sub-project — SP3 or a follow-up; the hybrid read path makes day-1 backfill non-essential)
- No outbound SMS sending (Phase 8 is backend logging only; outbound is SP7)
- No FCM web push (SP7)
- No two-way SMS thread UI (SP7-adjacent)
- No call recording or transcript surfacing in v1 — fields persisted, UI deferred
- No customer-changes-phone-number auto-merge — phone change in v1 creates a SECOND Customer doc (history splits); admin merge tool is SP7.
- No customer-changes-phone-number auto-detection UI — operator notices via the duplicate row in Customers.
- No multi-country phone normalization — US default only. International, extension, and vanity inputs are explicitly REJECTED by `normalizePhone` (return `valid: false`) in v1.
- No outbound Quo API calls from the client — all outbound goes through Cloud Functions when added
- No new permission flags in v1 — existing `Permissions` map suffices. (`canViewRecordings` is added in SP7.)
- **No per-customer GDPR/CCPA hard-delete in v1.** The CustomerProfile "Delete" button is SOFT-DELETE only (operator UX affordance). Hard-delete with Job tombstoning, Quo recording removal, and audit logging is SP7.5. Businesses receiving GDPR/CCPA erasure requests before SP7.5 ships must run the operation manually via Firestore console.
- No full customer-change diff audit log in v1 — only `lastEditedByUid` / `lastEditedAt` is captured. Full before/after diff log is SP7.5.
- No CMEK encryption for plaintext PII (phones, transcripts) — Google-managed at-rest encryption is the v1 protection model.
- No Cloud Armor / App Check / IP allowlist on the webhook — `maxInstances: 10` + HMAC + replay window + kill switch is the v1 defense.
- No automatic two-party-consent recording disclosure — operator's regulatory responsibility, surfaced via a Settings notice and link to Quo's docs.

---

## Open Questions for User

1. **Quo account / API access:** Does Wheel Rush already have a Quo (formerly OpenPhone) account? If so, which plan (Starter / Business / Scale)? Webhooks are available on all tiers so plan is informational. We need to confirm you can enable the **Beta webhook system** (uses `whsec_`-prefixed key, explicit `call.missed` event). If only legacy is available, we fall back to inferring missed from `call.completed.status in ('unanswered', 'abandoned')` — the spec supports both via the same handler with a tiny shape adapter.

2. **Multi-line / multi-tech routing:** ~~Open.~~ **RESOLVED in this spec — see *Multi-operator delivery rule — resolved* under Real-Time Popup Delivery.** Default is "rings every foregrounded device in the business"; `quoPhoneNumbers/{e164}.defaultAssignedToUid` is the per-line override; `incomingCalls.assignedToUid` (populated from Quo's payload routing data via the `quoUserMapping/{quoUserId}` table) is the per-call override; listener filter `assignedToUid == null || assignedToUid === uid` delivers in all three modes.

3. **Historical job backfill:** Should we batch-upsert Customer + Vehicle docs for ALL existing jobs in a one-time migration (so the Customers page is consistent on day 1 of SP3), or rely on the hybrid derive-or-persisted read path so customers materialize organically? **Recommendation:** ship SP1 without backfill (zero risk), then run a backfill Cloud Function during SP3 once we've verified the upsert path in production.

4. **Missed-call SMS automation:** v1 auto-text-back on every missed call, or defer to SP7 with operator opt-in? **Recommendation:** defer to SP7. Silent auto-SMS on every missed call risks A2P 10DLC reputation damage if it fires on robocalls. SP7 adds a per-business opt-in toggle and a deny-list of known spam patterns.

5. **Phone lookup ambiguity (shared household line):** ~~Open.~~ **RESOLVED in this spec.** `incomingCalls.customersSnapshot` carries up to 3 candidate customers (each with name + up to 3 vehicles); `additionalMatchesCount` covers overflow. IncomingCallModal renders the primary as the hero, a secondary chip "Also: {name} (+N more)", and a tap-to-disambiguate sheet that lets the operator pick the right customer (write-back via the `customerId` field on the updated allowlist). Privacy tradeoff acknowledged: revealing "Also: Jose Lopez" on the popup discloses the existence of a second customer to the answering tech. Fine for household shared lines; documented as a known limitation for abuse-victim or separated-couples cases — operators should soft-delete or rename Customer records in sensitive situations.

6. **Address capture in AddJob:** Add a street-address input to the new CustomerLookupCard / Customer card in SP2, or leave `addressLine` as an optional that's only set via the CustomerProfile edit screen in SP3? **Recommendation:** defer to SP3 to keep SP2 small.

7. **Quo Beta system signup:** The Beta webhook system uses `whsec_`-prefixed keys and Standard-Webhooks-compatible signing. Confirm you can enable Beta on your Quo account (operator action). If not, legacy `openphone-signature` HMAC works too — the spec supports both via the same handler.

8. **Outgoing call/SMS UX:** Quick actions "Call" and "Text" use the device's native `tel:` / `sms:` schemes (free, instant, but uses operator's personal number), OR call the Quo API to dial/text from the business number ($0.01/SMS segment, branded outbound, slower)? **Recommendation:** native `tel:` / `sms:` for v1; Quo-routed outbound in SP7.

9. **Customer entity ID strategy:** ~~Open.~~ **RESOLVED in this spec.** Computed keys retained: `p_<11-digit-normalized-digits>` (e.g. `p_13058977030`) for phone-keyed customers, `n_<slug>` for name-keyed fallback. Hybrid read path tolerates legacy `p_<10-digit>` IDs via a second-chance lookup (see *Phone Number Normalization* → "phoneKey canonical form"). Phone-change edge case: SECOND Customer doc is created automatically; admin merges via the SP7 "Merge customers" tool — explicitly documented in Out of Scope.

10. **Toast vs full popup for missed/race-condition calls:** When the tab is foregrounded but no incoming-call popup fires because we missed the ringing event window (race condition), flash an `addActionToast` "Missed call from Maria Lopez" that taps through to her profile? **Recommendation:** yes, on every `call.missed` event regardless of whether the popup showed, with 8s dismiss + tap-to-open-profile.

---

## Sign-off

_(empty — user reviews before signing)_

---

## Review Pass 1 (Workflow-internal)

This pass addressed three adversarial reviews (correctness/security/operator-fit) and tightened the spec without changing its architecture, sub-project boundaries, or the headline approach. Summary of changes:

### Critical issues addressed

1. **`normalizePhone` invalid-input contract** — Rewrote the algorithm so invalid inputs return `{ e164: '', digits: '', valid: false }` instead of silently producing `+` / `911` strings. Added a hard contract: `upsertCustomerFromJob`, `saveJob`, and `quoWebhook` MUST NOT write `phoneKey` / `phoneE164` when `valid === false`. Updated the saveJob snippet to gate phoneKey assignment on `phone.valid`.
2. **International / extension / vanity inputs** — Expanded the edge case table to include UK numbers, extensions, vanity numbers, too-short, too-long, null/undefined coercion rules. All explicitly REJECTED in v1; `libphonenumber-js` deferral documented.
3. **phoneKey doc-ID format reconciliation** — Committed to `p_<11-digit>` as canonical and documented the hybrid second-chance lookup against legacy `p_<10-digit>` IDs. Closes the breaking-change ambiguity flagged in two reviews.
4. **Concurrency contract for `upsertCustomerFromJob`** — Added a full Concurrency Contract subsection: Firestore `runTransaction`, `FieldValue.increment(1)` on `jobCount`, idempotency via `processedJobIds` array, `firstJobAt` set-if-absent, `lastJobAt = max(existing, job.date)`. Same treatment for the Vehicle subdoc. Explicitly documented as safe-to-retry.
5. **Client-write field types vs `fbSetFast`** — Documented that the client upsert uses `runTransaction` directly (bypassing `fbSetFast`) and stores `updatedAt`/`lastEditedAt` as ISO strings while the Cloud Function path uses real `Timestamp` / `serverTimestamp()`. Closes the JSON-stringify corruption gap.
6. **Customer-phone-change behavior** — Defined explicitly: a phone change creates a SECOND Customer doc; history splits; no auto-detection; admin merges via the SP7 "Merge customers" tool. Added to Out of Scope and SP7 scope.
7. **Webhook tenant isolation invariants** — Added a hard-rules subsection: `businessId` MUST come from `quoPhoneNumbers/{toE164}` (never the payload); missing/inactive mapping returns 200 + log warning + writes nothing; all reads MUST be path-scoped; collection-group queries on `phoneKey` are FORBIDDEN.
8. **Quo phone number ownership uniqueness** — `adminConnectQuoNumber` now normalizes `e164`, refuses overwrite if `businessId` mismatch (with `force: true` owner-only override), writes audit doc on every conflict. Prevents the cross-tenant call-hijacking vector.
9. **Cross-device Accept/Decline race** — Defined as Firestore transactions with `status === 'ringing'` precondition; losing devices see a 2.5s "Already answered by {name}" toast; modals show a 1.5s confirmation before fading. Same contract for Decline.
10. **Multi-operator delivery rule resolved** — Default "rings every foregrounded device"; `defaultAssignedToUid` is per-line override; `incomingCalls.assignedToUid` populated from Quo's payload routing data via a new `quoUserMapping/{quoUserId}` table is the per-call override. Open Question #2 marked resolved.
11. **Missed-call reconciliation** — Added `reconcileQuoCalls` scheduled function (every 5min), stale-ring guard (skip popup if `createdAt > 30s old`), manual "Attach to customer" Leads action for orphan leads. Closes the "missed calls never vanish" promise even on webhook outages.
12. **Shared-phone display ambiguity** — Replaced singular `customerName` + `vehiclesSnapshot` with `customersSnapshot[]` (capped at 3) + `additionalMatchesCount`. Disambiguation sheet writes back to `customerId` (allowlist extended).
13. **Multi-tenant lastJobSummary privacy** — Scoped by `assignedToUid` when set; `paymentStatus` is null when the line rings everywhere. Closes the cross-tech financial leak.
14. **No new rules helper** — Removed `hasPermission(bid, flag)` invention; uses existing `memberRole(bid) in [...]` everywhere. Matches `firestore.rules` conventions.
15. **AddJob perf discipline** — Phone input in CustomerLookupCard MUST be a `MemoInput` with `useCallback`-wrapped setter. Mirrors the P1-3 keystroke-storm fix.
16. **Replay-attack defense** — Added 300s timestamp tolerance check before HMAC verify. Closes the post-TTL replay window.
17. **Webhook cost-amplification** — `maxInstances: 10` cap; kill switch returns cheap 404; structured WARN on bad-sig with explicit no-rawBody / no-signature-header / no-secret logging rules.
18. **Customer modification audit trail** — Added `lastEditedByUid` / `lastEditedAt` to schema (required on every update). Full diff audit log deferred to SP7.5 with explicit reasoning.
19. **GDPR/CCPA right-to-delete** — Explicitly out of scope for v1 with named follow-up SP7.5. Documents that businesses receiving erasure requests must operate manually until then.
20. **Recordings & transcripts compliance** — Added a dedicated subsection: storage location, two-party consent disclosure as operator responsibility, plaintext transcript in Firestore with CMEK out of scope, access gating in v1 vs SP7's `canViewRecordings` flag, cascade deletion on business deletion.
21. **Cascade deletion of top-level collections** — `scheduledDeletionPurge` extended in SP4 to purge `quoPhoneNumbers` / `quoUserMapping` / `quoSyncCursors` for the deleted business. `quoWebhookEvents` TTL is a hard SP4 deploy requirement.
22. **Audio autoplay gesture requirement** — Documented degradation path: one-time pointer listener primes audio; modal catches `NotAllowedError` silently; Settings shows unlock status.

### Deferred for user decision (require user input)

- **Quo account / API access** (OQ#1) — operator confirmation needed.
- **Quo Beta system signup** (OQ#7) — operator confirmation needed.
- **Historical job backfill** (OQ#3) — recommendation stands (defer to SP3); user confirmation requested.
- **Missed-call SMS automation** (OQ#4) — defer to SP7 (recommended); user confirmation.
- **Address capture in AddJob** (OQ#6) — defer to SP3 (recommended); user confirmation.
- **Outgoing call/SMS UX** (OQ#8) — native `tel:` / `sms:` for v1 (recommended); user confirmation.
- **Toast vs full popup for missed/race calls** (OQ#10) — toast on every `call.missed` (recommended); user confirmation.

### Minor issues addressed (mechanical)

- IncomingCalls schema updated with `customersSnapshot[]`, `additionalMatchesCount`, `lookupSkippedReason`.
- Lead schema gained `missedCallCount`, `lastMissedCallAt` for 7d dedup window.
- `useIncomingCallListener` row description aligned with the inline code (no `scopedCol`).
- `Customer` schema noted dual Timestamp/ISO-string form for client vs Cloud-Function writes.
- Firestore-level enforcement reasoning rewritten as an explicit auditable table by enforcement layer.

### Minor issues left for user judgment

- Renaming `assignedToUid` to `routedToUid` (review 2 minor #7) — judgement call; field name stays as `assignedToUid` for consistency with the prior listener code; the per-call override semantic is now documented in the Multi-operator delivery rule subsection.
- `customers/{uid}` Stripe Extension collision note (review 2 minor #1) — paths don't actually collide (one is top-level `/customers/{uid}`, the other is `/businesses/{bid}/customers/{cid}`); no rename required.
- Exact `payload.data.context.participants.workspace` field path documentation (review 2 minor #2) — addressed by the new tenant-isolation pseudocode, but the exact Quo Beta field name should be re-verified during SP4 implementation against the live API.
