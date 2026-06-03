# Twilio Integration + Customer Intelligence System — Design

**Date:** 2026-06-03
**Status:** v3.2 — final pre-SP1 refinements: Customer Hub nav, Quick Notes, Fleet kind, photos aggregation, System of Record callout, pending user approval

> ### Priority lock (v3.1 — user-confirmed 2026-06-03)
>
> **Customer Directory + Customer Intelligence are THE primary work.** The user does not yet have a chosen Twilio number or call-forwarding configuration. Therefore:
> - **SP1, SP2, SP3 ship complete operator-visible value with ZERO Twilio configuration.** Every feature in the spec EXCEPT the live incoming-call popup and outbound SMS works on day 1 without a Twilio number being chosen, registered, or connected.
> - **SP4 (Twilio webhooks) and SP4-outbound (sendSMS) ship as fully dormant infrastructure.** Cloud Functions deploy disabled by default via `TWILIO_WEBHOOK_ENABLED=false`. No environment variable is required to ship SP4 code.
> - **SP6 (Incoming Call Popup) decouples from SP4** — see SP6 below. The popup UI ships as part of the customer-intelligence work and is testable via a dev/admin Test Incoming Call action without any Twilio configuration. When SP4 webhooks are later activated, the popup pipeline begins firing automatically with no code change.
> - **Twilio activation is a configuration-only operation** performed entirely through Settings → Communications. No code redeploy required.

> ### System of Record (v3.2 — user-confirmed 2026-06-03)
>
> **Refinement #9 (verbatim):** *"Customer Directory is core — this is a primary system of record, not an add-on. Schema designs must be future-proof, indexes must support scalability, RBAC must be production-grade. Spec should call this out explicitly so future contributors don't deprioritize it."*
>
> **Implication for every contributor downstream of v3.2:**
> - **Customer Directory is a PRIMARY SYSTEM OF RECORD for MSOS.** It is not an add-on, not a side-car, not a derived projection. Customer + Vehicle + Service History are top-shelf entities, peer to Jobs in operational importance.
> - **Schemas must be future-proof.** Every new field added downstream of v3.2 must be designed with the assumption it will outlive the SP it lands in. Default-on indexing is the rule, not the exception; deprecating a field requires a written migration plan, not a hot-patch.
> - **Indexes must support scalability.** Customer / Vehicle collections will outgrow Wheel Rush within 12 months. Composite indexes for global search, list filtering, and Insights rollups are deployed at SP1 time (not "added later when performance degrades"). The scale-tier table in *Global Customer Search* is the canonical contract.
> - **RBAC must be production-grade.** Every read path enforces the existing `scopeJobsByRole` / `canViewFinancials` discipline. No new permission flag is invented without a corresponding rules-layer enforcement (see *RBAC — Technician vs Admin*). Financial rollups remain derived-and-scoped, never persisted at owner-level visibility.
> - **Future contributors must not deprioritize.** This callout exists so a hypothetical "let's defer the Customers tab until SP5" decision triggers the System of Record gate: any deferral of Customer Directory scope requires explicit user re-approval, not engineering judgment alone.

> ### Top-level Navigation (v3.2 — user-confirmed 2026-06-03)
>
> **Refinement #1 (paraphrased):** Customer Hub must be a top-level navigation item, peer to Dashboard, Jobs, Inventory, Analytics, Settings. Customers must NOT be buried inside Jobs or Settings.
>
> **Canonical navigation order:**
> 1. **Dashboard**
> 2. **Jobs**
> 3. **Customers (NEW — Customer Hub)**
> 4. **Inventory**
> 5. **Analytics**
> 6. **Settings**
>
> The "Customers" tab is the entry point to the Customer Directory module. **Path:** `/customers`. **Component file:** `src/pages/CustomerHub.tsx` (or repurpose the existing `src/pages/Customers.tsx` — agent should grep at SP1 time to confirm which file actually exists in the codebase; today the file is `src/pages/Customers.tsx` and the v3.2 plan is to evolve it in-place rather than fork a new component, preserving the existing route).
>
> **Mobile-first bottom-nav placement.** The existing main nav adds this tab; any existing settings-buried customer affordances (if any are discovered at SP1 grep time) are removed or redirected to the new top-level tab. The Customer Directory has no other entry point — search and Insights drill in from this tab.
>
> **UX viability flag — six-tab bottom nav.** This refinement makes Customers the **fifth tab on a six-tab bottom nav**. Six tabs at mobile widths approaches a known UX limit (icon legibility + thumb-reach + label truncation at 360px viewport). SP1 implementation MUST confirm viability with a screenshot review at 360px, 390px (iPhone 14 Pro), and 414px viewports. If any tab label truncates or any icon overlaps a thumb-reach safe zone, **recommend overflow:** push Analytics OR Settings into a MoreSheet ("...") sixth tab, keeping Dashboard / Jobs / Customers / Inventory / [MoreSheet] as the visible five. The MoreSheet pattern already exists in MSOS (used today for the Leads tab landing in SP5) — reusing it for overflow is zero-net-new-component cost. The user-confirmed canonical order above is the ASPIRATIONAL contract; the overflow recommendation is the IMPLEMENTATION SAFETY NET.

**Scope:** Full architecture for user phases 1-18. This spec defines the data model, integration points, security model, and sub-project shipping order. Each sub-project will get its own dedicated implementation plan after the user signs off on this architecture.

**v3 framing:** Twilio is the primary (and only active) communications provider. The architecture introduces a thin **Provider Abstraction Layer** so future providers could be added without rewriting business logic — but Twilio is the only implementation that exists. Quo/OpenPhone references throughout v2 have been replaced. See *v3 Update Log* at the bottom for the full pivot diff.

---

## User Answers to Open Questions (resolved) — v2 changelog

The user reviewed v1 and provided the following verbatim answers. Every item below has been folded into the spec body (Data Model, AddJob Workflow, Customer Profile Actions, Twilio Integration, Ship Order). This section is preserved as a permanent changelog so future readers can trace why certain decisions were made.

1. **Communications provider (v3 update):** *"Twilio is now the primary communications provider. The user already has a Twilio account and a Twilio phone number provisioned."* → SP4 ships with `TWILIO_WEBHOOK_ENABLED=false` (kill switch, default off until operator opts in) and a per-business `settings.twilioConnected` toggle. The architecture is provider-abstracted, but Twilio is the only active implementation. See *Twilio-Optional Architecture*.
2. **Webhook signature verification (v3 update):** *"Twilio webhook signature verification using X-Twilio-Signature header (HMAC-SHA1)."* → SP4 verifies every webhook via Twilio's documented algorithm: HMAC-SHA1 of `URL + sorted POST params (key+value concatenated)`, base64-encoded, timing-safe comparison against the `X-Twilio-Signature` header. See *Twilio webhook signature verification*.
3. **Backfill existing jobs:** *"YES. Scan all existing jobs, create Customer profiles from historical data using phone number as primary identifier, auto-merge duplicates where possible. No existing data lost."* → New Phase 3 (P3) lands in SP3 as a one-shot `backfillCustomers` Cloud Function triggered from Settings. See *Backfill Existing Jobs (P3)*.
4. **Missed-call SMS auto-text:** *"Defer to Phase 7 (SP7). Build the architecture only. No automated outbound texts yet."* → Unchanged from v1 recommendation; explicitly recorded here. v3 lands the outbound `sendSMS` callable scaffolding in SP4 (Twilio plumbing already exists); rules-based auto-text is SP7.
5. **Address input in AddJob:** *"YES. Add customer address lookup + autofill in AddJob workflow."* → New `AddressAutofillInput` component lands in SP2 at AddJob step 7 (Location). See *AddJob Workflow Change*.
6. **Outgoing Call/Text buttons (v3 update):** *"Twilio is now THE provider; provider abstraction allows future additions but no other providers planned."* → v1 ships native `tel:` / `sms:` for Call. Outbound SMS uses Twilio via the new `sendSMS` callable (SP4 plumbing, SP6+ wiring). Provider abstraction documented for future-proofing only.

**Three NEW first-class requirements added by the user:**

A. **Global Customer Search** — universal search accessible from main nav. Fields: phone, customer name, company name, vehicle make, vehicle model, license plate, tire size, city, zip code. Sub-300ms target on Wheel Rush-scale dataset. Lands in SP3 as Phase 5 (P5). See *Global Customer Search*.

B. **Customer Insights card on Customer Profile** — Lifetime Revenue, Total Jobs, Average Ticket, Last Service Date, Most Common Vehicle, Most Common Tire Size, Most Common Service Type, Referral Count (schema-only), VIP Tier badge (Gold $1,000+, Platinum $2,500+). Lands in SP3 as Phase 9 (P9). See *Customer Insights Card (Phase 9)*.

C. **"Auto-save customers from completed jobs" toggle in Settings** — default ON. When OFF, `saveJob` skips `upsertCustomerFromJob`. Schema field lands in SP1; toggle UI lands in SP3 inside a new "Customer Directory" Settings accordion. Lands as Phase 17 (P17). See *Auto-Save Customers Setting (Phase 17)*.

**Vertical-agnostic framing (architectural principle):** the system must work for ALL MSOS verticals from day 1 — mobile tire, roadside assistance, mobile mechanics, car wash / detailing, and future categories — not just tire. The Customer entity is fully vertical-agnostic. The Vehicle entity has a universal core (`year`, `make`, `model`, `trim`, `color`, `vin`, `licensePlate`) plus per-vertical sub-objects (`vehicle.tire`, `vehicle.mechanic`, `vehicle.detailing`). The Customer Timeline displays service-type labels via the active vertical's service catalog rather than hardcoded strings. See *Vertical-Agnostic Entity Design*.

---

## Goal & Success Criteria

User's stated goal (verbatim):

> "Turn MSOS into a phone-first customer intelligence system. When a customer phones our business line, every signed-in MSOS device pops a card within ~2 seconds showing who they are, what they drive, what we last did for them, and one-tap actions to answer, create a job, send a quote, or open their profile. Every time we save a job, that customer and their vehicle automatically become first-class entities — no re-keying, no double entry. Repeat customers should fly through AddJob. Missed calls should never vanish — they become leads we can work. And the whole thing has to be ready for an AI receptionist later without rewriting the data model."

Restated in implementation terms:

1. **Identity is persistent.** Customer and Vehicle stop being read-time projections and become real Firestore entities under `businesses/{businessId}/customers/{customerId}` and `customers/{customerId}/vehicles/{vehicleId}`. Job documents gain `customerId` + `vehicleId` foreign keys, written at save time. The existing derived-customers UI keeps working through a hybrid read path so we ship without a backfill.
2. **Phones are canonical.** A single `normalizePhone()` helper produces an E.164 form and a digit-only `phoneKey` used everywhere — Customer lookup, Job lookup, webhook resolution. No format-mismatch dedup failures.
3. **Inbound calls drive UI.** Three new Cloud Functions — `twilioIncomingCall` (voice webhook), `twilioIncomingSMS` (SMS webhook), and `twilioCallStatus` (status-callback webhook) — receive Twilio's form-encoded webhook payloads, verify the `X-Twilio-Signature` HMAC-SHA1 signature, deduplicate by `CallSid` / `MessageSid`, resolve business + customer, and write a Firestore doc that a real-time client listener turns into a screen-blocking popup with caller intelligence. The voice webhook returns minimal TwiML (`<Response><Pause length="1"/></Response>`) — Twilio's number-level call forwarding still rings the operator's actual phone; the MSOS popup is an **out-of-band signal** to the operator's MSOS device.
4. **Missed calls become leads.** Every missed-call webhook creates a `leads/{leadId}` row keyed off the same `phoneKey`, with status `new → contacted → converted | lost`.
5. **Permissions reuse what we have.** No new permission flags. Technicians see customer identity + vehicle + service history; financial rollups gate on existing `canViewFinancials` / `canViewProfit`.
6. **AddJob gets a returning-customer card.** Phone-first input at the top of the form auto-fills name/email/city/vehicle in <300ms when a known number is typed.
7. **Future-ready.** Call recording, transcript, AI receptionist, auto-text-back, and FCM background push all have named seams in the schema and component graph; none ship in v1.

Success is binary per sub-project (see *Ship Order*); the headline success criterion is: **a customer calls the business number, and within 2 seconds every foregrounded MSOS device shows the caller's name, vehicle, last service date, and Accept / Create Job / Open Profile buttons.**

### v2 scope additions (from user answers) — v3-updated

The scope is broadened in three architectural directions without changing the headline success criterion:

1. **Twilio is optional in v1 at the MSOS layer, even though the operator owns a Twilio account.** The entire SP1-SP3 customer-intelligence value chain (entities, lookup, profile, search, insights, backfill, settings toggle) ships **without** any Twilio configuration. SP4 (webhooks + sendSMS) is gated behind `TWILIO_WEBHOOK_ENABLED` (global kill switch) and `settings.twilioConnected` (per-business). SP6 (popup) is harmless when no `incomingCalls` docs ever land. When the global kill switch is off, every Twilio webhook endpoint returns `404`. When the per-business flag is off, the IncomingCallModal listener never attaches, the Leads page is empty, and Settings → Communications shows a "Connect Twilio" CTA. **Critical:** MSOS must work even if the Twilio env vars are not configured yet — this is success criterion #12.
2. **The entity model is vertical-agnostic.** Customer is fully universal. Vehicle has a universal core (year/make/model/trim/color/vin/licensePlate) plus per-vertical sub-objects (`vehicle.tire`, `vehicle.mechanic`, `vehicle.detailing`). Customer Timeline labels read from `verticalConfig.services` rather than hardcoded "Tire Replacement" strings. This is a first-class requirement, not a future seam — tire-specific fields are NEVER persisted at the Vehicle root level in v2.
3. **Global search, Customer Insights, and the auto-save Settings toggle are v1 deliverables, not future-ready seams.** They land alongside the Customer Profile page in SP3. Global search targets sub-300ms on the Wheel Rush dataset (~2k customers, ~3k vehicles) via composite indexes + parallel queries + result caching. Customer Insights computes nine metrics with two persisted as Customer-doc rollups (averageTicket, vipTier) for fast list-sort. The auto-save toggle reads through a context cache initialized at App.tsx mount.

---

## Problem (current state)

**Customer entity does not exist.** [src/lib/customers.ts:1-13](../../../src/lib/customers.ts) opens with an explicit comment: *"Customers are NOT a stored entity."* The `businesses/{bid}/customers/{key}` collection exists ([firestore.rules:604-607](../../../firestore.rules)) but only persists `CustomerMeta = { note?: string; tags?: string[]; updatedAt?: string }` ([src/lib/customers.ts:26-30](../../../src/lib/customers.ts)). Every other field — name, phone, email, lifetime revenue, visit cadence, vehicles owned, tire sizes — is derived live from the job list by `deriveCustomerProfiles()` ([src/lib/customers.ts:113-195](../../../src/lib/customers.ts)).

**Customer "key" is computed, not persisted.** `customerKey(job)` at [src/lib/customers.ts:91-102](../../../src/lib/customers.ts) returns `p_<digits>` from `customerPhone` or `n_<slug>` from `customerName`. Two jobs for the same person with slightly different phone formatting resolve to the same key only because `digits-only` normalization happens at read time; a job missing the phone falls back to the name slug and ends up under a *different* key. Read-time dedup ≠ write-time identity.

**Vehicle entity does not exist anywhere.** No `vehicles` collection. Vehicle identity is whatever the tech typed into `vehicleType` / `vehicleMakeModel` / `vehicleSize` / `tireSize` on each job ([src/types/index.ts:662, 743, 748, 684](../../../src/types/index.ts)). `deriveCustomerProfiles` aggregates `vehicleMakeModel` via `pushDistinct` ([src/lib/customers.ts:165-166](../../../src/lib/customers.ts)) but ignores `vehicleType`; `tireSizes` is aggregated separately.

**AddJob captures only Name + Phone + City.** The Customer card ([src/pages/AddJob.tsx:752-840](../../../src/pages/AddJob.tsx)) is the **fourth** section in form order, after Suggested-price, Revenue, and Service. No address, no email (even though `Job.customerEmail` exists at [src/types/index.ts:683](../../../src/types/index.ts) with no UI binding), no vehicle make/model in the Customer card itself — `vehicleMakeModel` is rendered later in the per-vertical job-fields loop at [src/pages/AddJob.tsx:864](../../../src/pages/AddJob.tsx). There is no lookup-by-phone UI; the only repeat-job affordance is `handleDuplicate` at [src/App.tsx:1296-1302](../../../src/App.tsx), reachable from History / JobDetailModal / JobSuccessPanel.

**RBAC exists and is already wired for financial-field hiding.** Three roles — owner / admin / technician — live on `businesses/{businessId}/members/{uid}.role` ([src/types/index.ts:115, 193-244](../../../src/types/index.ts)). `getPermissions()` ([src/lib/permissions.ts](../../../src/lib/permissions.ts)) produces a flat `Permissions` boolean map. The canonical field-hiding pattern is `{canViewProfit && <Row ... />}` used at [src/components/JobDetailModal.tsx:121-135](../../../src/components/JobDetailModal.tsx) and [src/pages/Customers.tsx:600](../../../src/pages/Customers.tsx). Firestore rules cannot mask individual fields on a doc; the established workaround when server enforcement is required is to split sensitive data into a subcollection with its own rule.

**Webhook pattern is established but unused for inbound.** [functions/src/stripeWebhook.ts:1-225](../../../functions/src/stripeWebhook.ts) is a complete reference: v2 `onRequest`, `defineSecret`, raw-body HMAC verification, Firestore-based idempotency, kill-switch env-var. It is intentionally not exported from [functions/src/index.ts:69-82](../../../functions/src/index.ts) because production Stripe events flow through the Firebase Stripe Extension. We will mirror this file's defensive structure for each of the three Twilio webhook endpoints (`twilioIncomingCall`, `twilioIncomingSMS`, `twilioCallStatus`) — same kill-switch + idempotency + structured-logging discipline, but with Twilio's signature algorithm (HMAC-SHA1 of URL + sorted POST params) substituted for Stripe's.

**Real-time delivery exists but only via Firestore listeners.** [src/lib/firebase.ts:266-285](../../../src/lib/firebase.ts) defines `fbListen` over `onSnapshot`. App.tsx attaches all real-time listeners between [src/App.tsx:437-583](../../../src/App.tsx). There is **no FCM, no web push, no service-worker push handler** anywhere in the codebase. `public/sw.js` is purely cache-strategy. Mobile browsers suspend WebSockets on backgrounded tabs after ~30s, so a Firestore-listener-driven popup only fires when the tab is foregrounded. This is a known v1 gap, documented and accepted; FCM is a future-ready seam.

**Modals are state-driven, not bus-driven.** There is no `openModal()` registry. Every modal is rendered conditionally in App.tsx from local state (e.g. `{detailJob && <JobDetailModal ... />}` at [src/App.tsx:1568-1590](../../../src/App.tsx)). A new modal driven by Firestore must follow the same shape: attach an `onSnapshot` listener in App.tsx, hold the result in state, render conditionally.

---

## Architecture Overview

### High-level navigation (v3.2 — refinement #1)

```
+-----------+-----------+-----------+-----------+-----------+-----------+
| Dashboard |   Jobs    | Customers | Inventory | Analytics | Settings  |
|           |           | (NEW)     |           |           |           |
+-----------+-----------+-----------+-----------+-----------+-----------+
                              |
                              v
                +-----------------------------+
                |  Customer Hub  (/customers) |
                |  - Customer Directory list  |
                |  - Global Search entry      |
                |  - Tap row -> CustomerProfile (SP3)
                +-----------------------------+
```

**Customer Hub is a top-level navigation peer** to Dashboard, Jobs, Inventory, Analytics, and Settings (v3.2 — refinement #1). The Hub is the canonical entry point to every Customer Directory surface: list view, global search launcher, drill-in to CustomerProfile. Component file: today the file is `src/pages/Customers.tsx`; v3.2 evolves it in place (no fork) and adds the new top-level nav tab. See *Top-level Navigation (v3.2 — user-confirmed)* callout above for the full canonical order and the six-tab overflow viability flag.

### End-to-end incoming-call flow (headline scenario) — Twilio

```
+---------------------+     +-----------------------+     +-----------------------------------+
| Customer dials      |     | Twilio receives call  |     | Cloud Function: twilioIncomingCall|
| business line       | --> | Voice webhook fires   | --> |  1. Verify X-Twilio-Signature     |
| (305) 897-7030      |     | (POST, form-encoded)  |     |     (HMAC-SHA1 of URL+POST params)|
+---------------------+     +-----------+-----------+     |  2. Idempotency: CallSid          |
                                        |                 |  3. Resolve businessId from       |
              Twilio's number-level     |                 |     twilioPhoneNumbers/{To-E164}  |
              call forwarding ALSO      |                 |  4. Normalize From -> digits      |
              rings operator's actual   |                 |  5. lookupCustomerByPhone() at    |
              phone CONCURRENTLY        |                 |     customer layer                |
                                        v                 |  6. Read up to 3 vehicles +       |
                          +-------------+----------+      |     last job summary              |
                          | Operator's phone rings |      |  7. Write incomingCalls/{CallSid} |
                          | per Twilio's call      |      |     status='ringing' +            |
                          | forwarding config      |      |     denormalized snapshot         |
                          +------------------------+      |  8. Return minimal TwiML:         |
                                                          |     <Response><Pause length="1"/> |
                                                          |     </Response>                   |
                                                          +-----------------+-----------------+
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

**Critical architecture point: the voice webhook does NOT route the call.** Twilio's number-level forwarding (configured in the Twilio console: VoiceUrl + Voice fallback/forwarding rules) is what rings the operator's actual mobile phone. The webhook fires **concurrently** with that ringing path. The MSOS popup is purely an **out-of-band** signal to the operator's MSOS device — a richer caller-intelligence overlay while the real call rings on their phone. The operator picks up via their phone (Twilio's forward); the popup auto-clears when `status` transitions on a subsequent `twilioCallStatus` webhook (`CallStatus=completed`). A future SP7 may add an "Answer in MSOS" button using the Twilio Programmable Voice client SDK, but that's not in v1 scope.

End-to-end target: <2s wall-clock from Twilio webhook receipt to popup visible on a foregrounded device. Cloud Function work is well under 1s; the Firestore → onSnapshot leg is 200-800ms in practice.

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

All paths are scoped under `businesses/{businessId}/...` except `twilioPhoneNumbers/{e164}` and `twilioWebhookEvents/{webhookEventId}`, which are top-level (the webhook arrives without a business context and must resolve from the dialed number — Twilio's `To` field).

### `businesses/{businessId}/customers/{customerId}`

Doc ID is the existing `customerKey()` output (`p_<digits>` or `n_<slug>`) — preserves continuity with today's `customers/{key}` meta docs.

| Field | Type | Notes |
|---|---|---|
| `id` | string | Doc ID. |
| `name` | string | Migrated from `Job.customerName` on first upsert. |
| `nameLower` | string? | **v2 NEW.** `name.trim().toLowerCase()` for global-search prefix queries. Written by `upsertCustomerFromJob`. |
| `kind` | `'individual' \| 'fleet'` | **v3.2 NEW (refinement #6).** Default `'individual'`. **DATA MODEL ONLY — no fleet workflow UI in v1.** This field exists so future fleet features (multi-vehicle batch invoicing, fleet pricing tiers, fleet contact roles) can plug in without rewriting the entity shape. When `kind === 'fleet'`, `companyName` is required (see below); when `kind === 'individual'`, `companyName` is informational. Settings UI / fleet workflow features land in a future SP (not SP1-SP3). Writes default to `'individual'` from `upsertCustomerFromJob` and from the AddJob form; promotion to `'fleet'` is a manual operator action on CustomerProfile edit (owner/admin only). |
| `companyName` | string? | **v2 NEW (v3.2 amended).** For fleet or business customers. **Informational when `kind === 'individual'`; required when `kind === 'fleet'`.** Optional in v1 input flows; UI surfaces a "Company" field in AddJob and CustomerProfile edit. Validation contract for the `kind === 'fleet'` required-state lands when fleet workflow UI lands (post-v1). |
| `companyLower` | string? | **v2 NEW.** Lowercased copy for search. |
| `phoneE164` | string | Normalized phone, e.g. `+13058977030`. |
| `phoneKey` | string | Digits-only, e.g. `13058977030`. **Indexed.** Primary webhook lookup field. |
| `email` | string? | From `Job.customerEmail` ([src/types/index.ts:683](../../../src/types/index.ts)). |
| `addressLine` | string? | NEW; captured in AddJob (v2) via `AddressAutofillInput`, edited via CustomerProfile. |
| `city` | string? | Migrated from `Job.city`. |
| `cityLower` | string? | **v2 NEW.** Lowercased copy for search. |
| `state` | string? | Migrated from `Job.state`. |
| `zipCode` | string? | **v2 NEW.** 5-digit US zip (optional). Captured by `AddressAutofillInput`. Indexed for exact-match search. |
| `note` | string? | **EXISTING** field on CustomerMeta. Preserved verbatim. |
| `tags` | string[]? | **EXISTING** field on CustomerMeta. Preserved verbatim. |
| `gateCode` | string? | **v3.2 NEW Quick Note (refinement #2).** Gated-community / parking-gate access code. Auto-attached to AddJob context when this customer is selected. Free-text, short. No index. |
| `apartmentNumber` | string? | **v3.2 NEW Quick Note (refinement #2).** Apartment / suite / unit number. Auto-attached to AddJob context. Free-text. No index. |
| `wheelLockKeyLocation` | string? | **v3.2 NEW Quick Note (refinement #2).** Tire-vertical helper: where the operator can find the wheel-lock key in the vehicle (e.g. "glovebox", "spare-tire well", "with paperwork in console"). Auto-attached to AddJob context. Free-text. No index. Distinct from the existing Vehicle-level `wheelLockNotes` (a per-vehicle TPMS/lock annotation set at job time); this Customer-level field captures the customer's repeatable habit. |
| `tpmsNotes` | string? | **v3.2 cross-reference Quick Note (refinement #2).** Tire-vertical helper: customer-level TPMS guidance ("uses aftermarket sensors", "no relearn tool needed", "reset button in glovebox"). **Cross-references the existing Vehicle-level `tpmsNotes` field** — this Customer-level note captures the customer's standing instruction across all their vehicles; the Vehicle-level note captures the specific vehicle's quirks at job time. The two fields are surfaced together in the AddJob auto-attach card. Free-text. No index. |
| `preferredPaymentMethod` | string? | **v3.2 NEW Quick Note (refinement #2).** Customer's preferred payment method ("Zelle to 305-...", "Always pays cash", "Square invoice"). Auto-attached to AddJob context. Free-text. No index. Does NOT replace the Job-level `payment` field; this is an advisory note for the technician. |
| `parkingInstructions` | string? | **v3.2 NEW Quick Note (refinement #2).** Where to park on arrival ("behind garage", "in the alley", "park at gate, walk in"). Auto-attached to AddJob context. Free-text. No index. |
| `preferredContactMethod` | `'phone' \| 'sms' \| 'email'` | **v3.2 NEW Quick Note (refinement #2).** How this customer prefers to be contacted. Default unset. Auto-attached to AddJob context. When set, drives subtle UI nudges (the CustomerProfile Call/Text buttons render the preferred one as the primary CTA). No index in v1 (filterability deferred to SP7 if retention campaigns need it). |
| `generalNotes` | string? | **v3.2 NEW Quick Note (refinement #2).** Free-text catch-all for customer-level standing instructions ("dog in yard", "call before arriving", "deaf — text only"). Auto-attached to AddJob context. Distinct from the existing `note` field which is the operator's freeform CustomerProfile note; `generalNotes` is specifically the **job-context-surfacing** note that the technician sees inline in AddJob. (The operator may choose to keep both, or treat `generalNotes` as the primary; spec leaves both fields available to avoid a destructive merge at SP1 time.) |
| `firstJobAt` | Timestamp? | Set on first upsert; never overwritten. |
| `lastJobAt` | Timestamp? | Updated on every upsert. |
| `lastJobId` | string? | Most recent job. Drives "Repeat Last Service" action. |
| `jobCount` | number? | Rollup counter. Nullable; fallback to derived count for legacy. |
| `averageTicket` | number? | **v2 NEW. COMPUTED rollup** = `lifetimeRevenue / jobCount`. Recomputed by a `onJobWrite` Cloud Function trigger (SP3). Falls back to client-computed on read for legacy customers without the rollup. Stored to enable Customers-page sort/filter without scanning the jobs collection. |
| `customerStatus` | `'Active' \| 'Inactive' \| 'Fleet' \| 'VIP' \| 'Archived'` | **v2 NEW / v3-updated. DERIVED rollup with manual-override semantics.** `Active` if `lastJobAt` within 12 months (override `settings.activeWindowMonths` if set); `Inactive` if outside that window; `Fleet` if `companyName` is non-empty; `'VIP'` is a **MANUAL** override only — set by owner/admin via CustomerProfile edit to flag a customer as VIP regardless of revenue tier; `Archived` only via manual override. **`'VIP'` here is operational/manual** — distinct from `vipTier` below which is a revenue-derived badge. A customer can be `(Active, Gold)` (auto status + auto tier), `(VIP, Standard)` (operator-flagged VIP at low revenue), or `(Fleet, Platinum)` (auto status + auto tier). Both badges can render side-by-side on CustomerProfile. The Customers-page filter UX uses two independent filters (status + tier), not a single mutually-exclusive selector. |
| `vipTier` | `'Standard' \| 'Gold' \| 'Platinum'` | **v2 NEW. DERIVED rollup — REVENUE TIER.** `deriveVipTier(lifetimeRevenue)`: Standard `< $1,000`, Gold `$1,000-$2,499`, Platinum `$2,500+`. Recomputed by the `onJobWrite` trigger. Displayed as a badge on CustomerProfile and CustomersList row. Independent of `customerStatus='VIP'` manual flag. |
| `referralCount` | number? | **v2 NEW.** Schema-only in v1; defaults to 0. Reserved for a future referral-tracking feature. No UI surfaces it as an editable field. |
| `lastContactedAt` | Timestamp? | Future-ready seam for retention campaigns. Updated when an outbound call/text is logged or when a call is accepted from the popup. |
| `createdByUid` | string? | First tech who saved a job for this customer. |
| `createdAt` | Timestamp | Server timestamp (admin SDK) or ISO string (client). |
| `updatedAt` | string | EXISTING ISO string field. **v3 reaffirmed** — written by every upsert and every inline edit. Read as ISO string from client writes; Timestamp from Cloud Function writes. |
| `lastEditedByUid` | string? | Uid of the last person to modify the doc. **Required on every update** going forward. |
| `lastEditedAt` | Timestamp \| string? | When the last modification occurred. Required on every update. |
| `processedJobIds` | string[] | Idempotency key array (last ~100 jobIds). Used by `upsertCustomerFromJob` transaction. |

**Indexes:**
- `(phoneKey ASC)` — incoming-call lookup
- `(lastJobAt DESC)` — Customers page sort
- **v2 NEW** `(nameLower ASC)` — global-search name prefix match
- **v2 NEW** `(companyLower ASC)` — global-search company prefix match
- **v2 NEW** `(cityLower ASC)` — global-search city prefix match
- **v2 NEW** `(zipCode ASC)` — global-search zip exact match
- **v2 NEW** `(vipTier ASC, lastJobAt DESC)` — Customers page filter-by-tier sort
- **v2 NEW** `(customerStatus ASC, lastJobAt DESC)` — Customers page filter-by-status sort

**Security rule sketch** (delta against [firestore.rules:604-607](../../../firestore.rules)):

```
match /businesses/{bid}/customers/{customerId} {
  allow read: if isMemberOfBusiness(bid);
  // Meta-only writes (note, tags, quick notes, kind) remain owner/admin
  // (v3.2: Quick Notes + kind are operator-edited and need the same write gating as note/tags —
  // a tech can't promote a customer to fleet or rewrite the gate code, only owner/admin can.)
  allow update: if isOwnerOrAdmin(bid)
              && request.resource.data.diff(resource.data).affectedKeys()
                 .hasOnly(['note','tags','kind',
                          'gateCode','apartmentNumber','wheelLockKeyLocation','tpmsNotes',
                          'preferredPaymentMethod','parkingInstructions','preferredContactMethod','generalNotes',
                          'updatedAt','lastEditedByUid','lastEditedAt']);
  // Identity upserts (from saveJob) allowed for any active member.
  // canCreateJobs is true for owner/admin/technician today; the existing role check covers it.
  allow create, update: if isMemberOfBusiness(bid)
              && memberRole(bid) in ['owner','admin','technician']
              && request.resource.data.diff(resource.data).affectedKeys()
                 .hasOnly(['name','nameLower','kind','companyName','companyLower',
                          'phoneE164','phoneKey','email','addressLine',
                          'city','cityLower','state','zipCode',
                          'firstJobAt','lastJobAt','lastJobId',
                          'jobCount','averageTicket','customerStatus','vipTier','referralCount',
                          'lastContactedAt','createdByUid','createdAt','updatedAt',
                          'processedJobIds','lastEditedByUid','lastEditedAt']);
}
```

**No new rules helper.** The spec uses ONLY the existing helpers from `firestore.rules`: `isMemberOfBusiness`, `isOwnerOrAdmin`, `memberRole`, `memberDocExists`, `businessOwnerUid`. Maintaining a parallel permission table inside rules would diverge from the established pattern in the rules file. The role-list check `memberRole(bid) in ['owner','admin','technician']` is the canonical "active member with canCreateJobs" predicate — every active role today has `canCreateJobs == true`, so the role-list check is exact. The same approach applies to the `leads` rule below: replace `hasPermission(bid, 'canCreateJobs')` with `memberRole(bid) in ['owner','admin','technician']`.

The dual `allow update` rules (owner/admin-only for meta vs any-active-member for identity) are intentionally separate — Firestore rules OR them at evaluation time, which is the desired semantic.

**Financial rollup fields (`lifetimeRevenue`, `lifetimeProfit`, `expensesTotal`) are deliberately NOT stored.** Today these are derived live from `jobs` via `scopeJobsByRole` ([src/lib/jobPermissions.ts:16](../../../src/lib/jobPermissions.ts)) so the technician's "Lifetime Revenue" is automatically scoped to their own jobs. Persisting these rollups would either leak owner-level totals to techs or require a Cloud-Function-only write path. We keep them derived; the CustomerProfile gates Lifetime Revenue / Profit / Expenses behind `permissions.canViewFinancials` so techs only ever see derived-from-their-own-jobs totals (which they already see today on the Customers page).

### Customer Quick Notes (v3.2 user-confirmed)

**Refinement #2:** structured note fields that live on the Customer entity and **auto-appear during future jobs** — the technician sees the customer's standing instructions inline in AddJob the moment a returning customer is selected, before they tap Save.

**The 8 Quick Note fields** (all listed in the Customer schema table above, repeated here as a coherent reference):

| Field | Type | Default | Purpose |
|---|---|---|---|
| `gateCode` | string? | unset | Gated-community / parking-gate access code. |
| `apartmentNumber` | string? | unset | Apartment / suite / unit number. |
| `wheelLockKeyLocation` | string? | unset | Where the wheel-lock key lives in the vehicle (tire vertical). |
| `tpmsNotes` | string? | unset | Customer-level TPMS guidance. Cross-references the Vehicle-level `tpmsNotes` field — both render side-by-side in the AddJob context card. |
| `preferredPaymentMethod` | string? | unset | Customer's standing payment preference (free-text advisory). |
| `parkingInstructions` | string? | unset | Where to park on arrival. |
| `preferredContactMethod` | `'phone' \| 'sms' \| 'email'`? | unset | Drives the CustomerProfile primary CTA selection (Call vs Text). |
| `generalNotes` | string? | unset | Catch-all standing instructions (e.g. "dog in yard", "deaf — text only"). |

**Indexing posture (v3.2):** mostly free-text fields, **no indexes needed for v1**. `preferredContactMethod` could earn an index in SP7 if retention campaigns need to segment by it; none of the other seven warrant an index. This explicit "no indexes" decision is part of the System of Record callout's future-proofing posture — the fields are reserved on the schema with intentional, documented index minimalism.

**AUTO-ATTACH BEHAVIOR (the key v3.2 contract):**

When AddJob's Returning Customer card autofills (operator types a phone number, `lookupCustomerByPhone` resolves a hit, operator taps **Use Customer** or **Repeat Last Service** — see *AddJob Workflow Change*), the customer's Quick Notes are surfaced as a **non-dismissable info card at the top of the job notes section**. The technician sees the Quick Notes inline — they cannot tap them away before saving the job. Sample render (mobile, illustrative):

```
+-------------------------------------------------+
|  📌 Customer Quick Notes                        |
|                                                 |
|  Gate code:    4421                             |
|  Apt #:        3B                               |
|  Parking:      Behind garage, alley access      |
|  Wheel lock:   Glovebox                         |
|  Payment:      Zelle to (305) 555-0100          |
|  Contact:      SMS preferred                    |
|  Notes:        Dog in yard — call first         |
+-------------------------------------------------+
```

**Critical contract — Quick Notes live on the Customer, not on the Job.** The Job entity does **NOT** duplicate these fields. The Quick Notes are READ AT DISPLAY TIME from the Customer doc that `Job.customerId` references. This has two important consequences:

1. **Retroactive edits propagate.** When the operator edits Quick Notes on the CustomerProfile (e.g. the gate code changes from `4421` to `9988` because the HOA rotated codes), the new value is reflected on **every future job's** auto-attach card without any per-job rewrite. Historical jobs naturally render the historical context the technician saw at job time (the technician's free-text job notes already capture that), but the live Quick Notes view always reflects current customer state.
2. **No write amplification at job-save time.** The 8 fields are NOT copied into the Job document on save. This keeps Job docs lean and avoids stale-copy hazards.

**SP1 vs SP3 split for the Quick Notes capability:**

- **SP1 (Data Model):** the 8 fields land on the Customer schema, the Firestore rule allowlist permits them, the TypeScript `Customer` interface exposes them. No UI yet. Empty / unset for every existing customer.
- **SP2 (AddJob auto-attach):** the AddJob Returning Customer card reads the Customer doc's Quick Notes and renders the non-dismissable info card above the notes section when any Quick Notes field is non-empty. If all 8 are unset, no card renders.
- **SP3 (CustomerProfile edit surface):** CustomerProfile gains a "Quick Notes" section (owner/admin editable; see *Customer Profile* placement note in cross-references below) where operators populate the 8 fields. The inline editing pattern reuses the existing `canEditBusinessSettings` gate plus the new Quick Notes write-allowlist branch in the security rule.

**RBAC posture for Quick Notes editing.** Operationally these are operator-side instructions, not personally identifying customer data. The security rule above gates writes to **owner/admin only** for editing the Quick Notes (same as `note`/`tags`). Technicians **read** the Quick Notes (they need to see them at job time) but **cannot rewrite** them. This matches the existing `canEditNote` precedent in `src/pages/Customers.tsx`.

### `businesses/{businessId}/customers/{customerId}/vehicles/{vehicleId}`

**v3 update — tire fields are TOP-LEVEL on Vehicle.** v2 hoisted tire fields under a `vehicle.tire` sub-object. The user's v3 requirement reverses this: `tireSize`, `alternateTireSize`, `wheelLockNotes`, and `tpmsNotes` are **top-level Vehicle fields**, not under a sub-object. The vertical-agnostic principle survives — for non-tire verticals these fields are simply `null` / unset. Mechanic / detailing verticals add their own top-level fields the same way when they graduate from placeholder. No `vehicle.tire` / `vehicle.mechanic` / `vehicle.detailing` sub-objects.

Doc ID is `vehicleKey(job)`. Updated v2 algorithm (unchanged in v3):
- If universal `make` + `model` are non-empty → `slug(year + '-' + make + '-' + model + '-' + (trim ?? 'base'))` (e.g. `2019-honda-civic-sport`).
- Else if `job.vehicleMakeModel` is non-empty → `slug(vehicleMakeModel)` (legacy fallback, e.g. `honda-civic`).
- Else if tire-vertical AND `job.vehicleType` is non-empty → `slug(vehicleType + '-' + (job.tireSize || 'na'))` (e.g. `sedan-215-55r17`).
- Else → `slug('unknown-' + jobId.slice(0,6))` (rare fallback).

#### Universal core (every vertical)

| Field | Type | Notes |
|---|---|---|
| `id` | string | Doc ID. |
| `year` | number? | **v2 NEW universal.** Model year. |
| `make` | string? | **v2 NEW universal.** e.g. `Honda`. |
| `model` | string? | **v2 NEW universal.** e.g. `Civic`. |
| `trim` | string? | **v2 NEW universal.** e.g. `Sport`, `Limited`, `LX`. |
| `color` | string? | **v2 NEW universal.** e.g. `Pearl White`. |
| `vin` | string? | Optional, future-ready for `vehicleDiagnostics` flag ([src/config/businessTypes/types.ts:117](../../../src/config/businessTypes/types.ts)). |
| `licensePlate` | string? | Optional. Uppercased and trimmed for search. |
| `makeModelLower` | string? | **v2 NEW.** `(make + ' ' + model).toLowerCase()` for global-search prefix queries. |
| `vehicleMakeModel` | string? | **LEGACY** — from `Job.vehicleMakeModel`. Retained for backward-compat read path; new writes prefer universal `make`/`model`. |
| `vehicleType` | string? | **LEGACY (tire vertical)** — retained for backward compat. |
| `vehicleSize` | string? | **LEGACY (detailing vertical)** — retained for backward compat. |
| `lastServicedAt` | Timestamp | Most recent job date for this vehicle. |
| `lastJobId` | string | Most recent job id for this vehicle. |
| `serviceCount` | number? | Rollup counter. |
| `createdAt` | Timestamp | Server timestamp. |
| `updatedAt` | Timestamp | Server timestamp. **v3 reaffirmed.** Written by every upsert and every inline edit. |
| `processedJobIds` | string[] | Per-vehicle idempotency array (mirrors Customer). |

#### Tire-vertical fields (top-level — v3)

These are top-level Vehicle fields for tire-vertical tenants. For non-tire verticals they are simply unset / null. The v2 `vehicle.tire.*` sub-object form is **removed in v3**.

| Field | Type | Notes |
|---|---|---|
| `tireSize` | string? | **v3 TOP-LEVEL.** From `Job.tireSize` (e.g. `215/55R17`). Indexed for global search. |
| `alternateTireSize` | string? | **v3 TOP-LEVEL.** Operator-entered alternate (winter set, staggered fitment). |
| `tireBrand` | string? | **v3 TOP-LEVEL.** Most recent. |
| `tireCondition` | string? | **v3 TOP-LEVEL.** From `Job.tireCondition`. |
| `tpmsNotes` | string? | **v3 TOP-LEVEL.** TPMS reset / sensor notes. |
| `wheelLockNotes` | string? | **v3 TOP-LEVEL.** Wheel lock location / key notes. |

#### Mechanic-vertical fields (top-level — schema-only in v1)

| Field | Type | Notes |
|---|---|---|
| `engineCode` | string? | Reserved. No UI in v1. |
| `lastDiagnostic` | string? | Reserved. No UI in v1. |

#### Detailing-vertical fields (top-level — schema-only in v1)

| Field | Type | Notes |
|---|---|---|
| `interiorMaterial` | string? | Reserved. No UI in v1. |
| `paintCondition` | string? | Reserved. No UI in v1. |

**Indexes:**
- `(lastServicedAt DESC)` — for "vehicles owned" sort on CustomerProfile.
- **v2 NEW** `(makeModelLower ASC)` — global-search by make/model.
- **v2 NEW** `(licensePlate ASC)` — global-search by plate.
- **v3 UPDATED** `(tireSize ASC)` — global-search by tire size (tire vertical, top-level field).

Composite indexes are added as collection-group indexes so global search can fan out across all customers' vehicles in a single query.

**Security:** inherits the parent customer rule (any member read; any member with `canCreateJobs` may upsert via saveJob). No financial fields, so no extra gating.

**Backfill migration note (P3 — v3 update):** v3 no longer needs to hoist tire fields into a sub-object (they were always intended to be top-level). The SP3 `backfillCustomers` Cloud Function simply ensures `tireSize`, `alternateTireSize`, `tireBrand`, `tireCondition`, `tpmsNotes`, `wheelLockNotes` are written from `Job.tireSize` / `Job.tireBrand` / `Job.tireCondition` onto the Vehicle doc as top-level fields. Legacy Job rows already carry these as flat fields; the migration is a straight copy.

### `businesses/{businessId}/incomingCalls/{callId}`

Doc ID is the Twilio `CallSid` (e.g. `CAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`). Cloud-Function-only create; clients may update only a constrained subset.

| Field | Type | Notes |
|---|---|---|
| `id` | string | Twilio CallSid. |
| `twilioCallSid` | string | Same as id; kept distinct for future provider abstraction (would be `providerEventId` in a multi-provider future). |
| `provider` | `'twilio'` | **v3 NEW.** Always `'twilio'` in v1. Future providers would carry their own enum value. |
| `direction` | `'incoming' \| 'outgoing'` | Always `'incoming'` for popup-triggering docs. |
| `status` | `'ringing' \| 'answered' \| 'missed' \| 'declined' \| 'dismissed' \| 'completed'` | Drives popup visibility. Only `'ringing'` renders the modal. Updated from `twilioCallStatus` webhook on `CallStatus=completed/busy/no-answer/failed`. |
| `fromE164` | string | Caller, E.164. Sourced from Twilio `From` field. |
| `fromDigits` | string | Caller, digits-only. Client re-lookup fallback if `customerId` is null. |
| `toE164` | string | Business number (Twilio `To` field). Disambiguates multi-line businesses. |
| `customerId` | string \| null | Resolved at webhook time via `lookupCustomerByPhone()`. `null` = unknown caller (new lead) OR invalid phone (see `lookupSkippedReason`). For shared-phone cases, the primary (first) customer's id; the disambiguation sheet may rewrite this. |
| `customerName` | string \| null | Snapshot of the PRIMARY match's name so popup renders even if the doc changes. |
| `customersSnapshot` | `Array<{customerId, name, vehiclesSnapshot: VehicleSnapshotEntry[]}>` where `VehicleSnapshotEntry = { year?, make?, model?, trim?, color?, licensePlate?, tireSize?, tireBrand?, lastServicedAt? }` | Up to 3 matches snapshotted at ring time. Empty array on unknown caller. **Only the render-relevant Vehicle subset is snapshotted** — full Vehicle docs are NEVER spread into the snapshot; the resolveAndWrite pseudocode picks fields explicitly to keep the IncomingCalls doc small (matters for the rapid-listener path and Firestore doc-size limits). **v3 NOTE:** tire fields are now top-level on the Vehicle so the snapshot picks `tireSize` and `tireBrand` directly. Supports the shared-phone "Also: Jose Lopez" render path. |
| `additionalMatchesCount` | number | Number of matches beyond the 3 in `customersSnapshot`. Drives "Also: Jose Lopez (+N more)" tail. |
| `lastJobSummary` | object \| null | `{ jobId, service, date, vehicleLabel, tireSize, paymentStatus }`. **`paymentStatus` is null unless the line is single-tech-assigned** — see *Privacy posture* above. |
| `lookupSkippedReason` | string? | Diagnostic. `'invalid_phone'` when `normalizePhone(from).valid === false`. |
| `assignedToUid` | string \| null | If the called Twilio line maps to a single tech, only their device should ring. `null` = all-members. **v3 note:** Twilio (unlike Quo) does NOT have a multi-user-per-account workspace concept that surfaces a per-call routed-user — this field is populated only from `twilioPhoneNumbers.defaultAssignedToUid`. |
| `createdAt` | Timestamp | Server timestamp at webhook receipt. |
| `ringingExpiresAt` | Timestamp | `createdAt + 60s`. Client auto-dismisses stale rings. |
| `answeredByUid` | string? | Who tapped Accept. |
| `callbackBookedJobId` | string? | If operator tapped "Create Job" from the popup. |
| `missedAt` | Timestamp? | Set from `twilioCallStatus` webhook when `CallStatus=no-answer` or `busy`. |
| `completedAt` | Timestamp? | Set from `twilioCallStatus` webhook when `CallStatus=completed`. |
| `durationSec` | number? | From `twilioCallStatus` webhook's `CallDuration` field. |
| `recordingUrl` | string? | **Future-ready.** Twilio supports call recording via TwiML `<Record>` verb or recording rules; not enabled in v1. |
| `transcript` | string? | **Future-ready (AI receptionist seam).** Twilio offers Voice Intelligence transcripts; not enabled in v1. |

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

### `twilioPhoneNumbers/{e164}` (top-level)

Doc ID is the E.164 business phone number — the webhook's `To` field. Top-level because the webhook resolves business *from* this collection.

| Field | Type | Notes |
|---|---|---|
| `e164` | string | Doc ID. |
| `businessId` | string | Which MSOS business owns this Twilio line. |
| `twilioPhoneNumberSid` | string | Twilio's `PNxxxx` SID for this number (used for future outbound API operations, e.g. setting per-number config). |
| `messagingServiceSid` | string? | Optional per-business Messaging Service SID (`MGxxxx`) — if set, outbound SMS uses this instead of the global `TWILIO_PHONE_NUMBER`. Encrypted-at-rest by Firestore Google-managed keys. |
| `label` | string? | Operator-friendly label e.g. "Main line", "Tech 1". |
| `defaultAssignedToUid` | string? | If set, only this tech's device rings. |
| `active` | boolean | Per-number kill switch. |
| `createdAt` | Timestamp | |

**Indexes:** `(businessId ASC, active ASC)`.

**Security:** Reads only allowed for owner/admin of the linked business; writes blocked (managed via `adminConnectTwilioNumber` callable). The webhook reads via the admin SDK and bypasses rules.

### `twilioWebhookEvents/{webhookEventId}` (top-level)

Mirrors `stripeWebhookEvents` pattern from [functions/src/stripeWebhook.ts:141-177](../../../functions/src/stripeWebhook.ts). Doc ID is a deterministic key: `${endpoint}:${CallSid|MessageSid}` where `endpoint ∈ {'voice', 'sms', 'status'}`. This guarantees that the same Twilio retry attempt (which carries the same CallSid + endpoint) is deduplicated, while still allowing the voice + status webhooks for the same CallSid to coexist as separate idempotency rows.

| Field | Type | Notes |
|---|---|---|
| `webhookEventId` | string | Doc ID. Idempotency key. |
| `endpoint` | `'voice' \| 'sms' \| 'status'` | Which Twilio endpoint received the webhook. |
| `providerEventId` | string | The Twilio CallSid or MessageSid. |
| `createdAt` | Timestamp | When the function first saw this event. |
| `processed` | boolean | Set true after side effects committed. |
| `processedAt` | Timestamp? | When `processed` flipped to true. |
| `businessId` | string? | Resolved (debug). |
| `callId` | string? | Resolved Twilio CallSid (debug). |

**TTL:** auto-delete after 28h via Firestore TTL policy on `createdAt`. **The TTL policy MUST be configured at SP4 deploy time** — Twilio retries up to 4 attempts spread over a few hours, so 28h is a comfortable safety margin. The existing `scheduledDeletionPurge` weekly sweep is a secondary safety net.

**Security:** all client access denied; Cloud Function service account only.

### `twilioSyncCursors/{twilioPhoneNumberSid}` (top-level)

Used by the `reconcileTwilioCalls` scheduled function (analogue of v2's `reconcileQuoCalls`) to query Twilio's REST API for any call records that may have arrived during a webhook outage.

| Field | Type | Notes |
|---|---|---|
| `twilioPhoneNumberSid` | string | Doc ID. |
| `businessId` | string | For cascade deletion. |
| `lastSyncedAt` | Timestamp | Cursor advanced after each successful poll of Twilio's `/2010-04-01/Accounts/{AccountSid}/Calls.json?To={e164}&StartTime>={lastSyncedAt}`. |
| `updatedAt` | Timestamp | |

**Security:** all client access denied; Cloud Function service account only.

### `twilioPhoneNumberOwnershipAudits/{auditId}` (top-level)

Identical purpose to v2's `quoPhoneNumberOwnershipAudits` — records every attempt (refused or forced) to overwrite a `twilioPhoneNumbers/{e164}` mapping owned by another business. Retained 90 days for compliance.

**v3 NOTE — removed collections.** v2's `quoUserMapping/{quoUserId}` (which mapped Quo workspace user ids to MSOS uids for per-call routing) is **NOT carried over**. Twilio does not surface a per-call routed-user concept like Quo did, so multi-operator routing in v3 is simpler: all operators in the business see the popup; per-line operator targeting still works via `twilioPhoneNumbers.defaultAssignedToUid` but no per-call override exists.

### `businesses/{businessId}/communicationEvents/{eventId}` (v3 NEW)

**Purpose:** unified customer-facing timeline of all communications (incoming calls, outgoing calls, incoming SMS, outgoing SMS, missed calls, future AI interactions). Rendered in CustomerProfile's Communication History section. **Distinct from `incomingCalls`** — `incomingCalls` is the real-time pipeline source optimized for popup latency; `communicationEvents` is the denormalized timeline copy optimized for chronological customer-history rendering. The denormalization is intentional: the popup pipeline needs sub-2s read latency; the customer timeline can lag.

When a Twilio incoming call resolves to a customer, a row is written to BOTH `incomingCalls` (popup) AND `communicationEvents` (timeline). When the call completes (`twilioCallStatus` webhook), the `communicationEvents` row is updated with duration/status.

| Field | Type | Notes |
|---|---|---|
| `id` | string | Random Firestore ID. |
| `type` | `'incoming_call' \| 'outgoing_call' \| 'incoming_sms' \| 'outgoing_sms' \| 'missed_call' \| 'ai_interaction'` | Event type. |
| `direction` | `'inbound' \| 'outbound'` | |
| `provider` | `'twilio'` | Always `'twilio'` in v1. |
| `providerEventId` | string | Twilio `CallSid` or `MessageSid`. Idempotency key. |
| `customerId` | string \| null | Resolved via `lookupCustomerByPhone()` at write time. Nullable for unknown callers. |
| `customerPhoneE164` | string | Caller / recipient phone. |
| `customerPhoneKey` | string | Digits-only form. |
| `businessPhoneE164` | string | Twilio number that received/sent the event. |
| `body` | string? | SMS body (truncated to 2000 chars). NULL for calls. |
| `durationSec` | number? | For completed calls. |
| `callStatus` | string? | Twilio `CallStatus` for calls (`completed`, `busy`, `no-answer`, `failed`). |
| `messageStatus` | string? | Twilio message status for SMS (`queued`, `sent`, `delivered`, `failed`, `undelivered`). |
| `actorUid` | string? | For outbound events: which operator sent it. |
| `occurredAt` | Timestamp | When the underlying communication happened. |
| `createdAt` | Timestamp | When the doc was written. |
| `payloadSnapshot` | object | A shallow copy of the relevant Twilio webhook params for debugging — `{From, To, CallSid, CallStatus, ...}`. NEVER contains the full raw body; SMS `Body` is in the top-level `body` field. |

**Indexes:** `(customerId ASC, occurredAt DESC)` — customer-timeline render. `(type ASC, occurredAt DESC)` — for ops filtering. `(providerEventId ASC)` — idempotency lookup.

**Security:**
```
match /businesses/{bid}/communicationEvents/{eventId} {
  allow read: if isMemberOfBusiness(bid);
  allow create, delete: if false; // Cloud Function service account only
  allow update: if false;
}
```

Outbound SMS sends from the `sendSMS` callable also write to this collection (admin SDK bypasses rules).

### `businesses/{businessId}/callerLookupEvents/{eventId}` (v3 NEW)

**Purpose:** telemetry + audit log of every `lookupCustomerByPhone()` invocation triggered by the popup pipeline. Used to debug the resolution chain (Twilio → number mapping → phoneKey → customer match) when an operator reports a missed popup or wrong-customer popup.

| Field | Type | Notes |
|---|---|---|
| `id` | string | Random Firestore ID. |
| `triggeredBy` | `'twilio_voice_webhook' \| 'twilio_sms_webhook' \| 'manual_lookup'` | What kicked off the lookup. |
| `providerEventId` | string? | Twilio CallSid or MessageSid (when applicable). |
| `rawFromPhone` | string | The phone Twilio reported. |
| `normalizedPhoneKey` | string \| null | After `normalizePhone()`. Null if invalid. |
| `normalizedValid` | boolean | Whether `normalizePhone()` succeeded. |
| `customerIdMatched` | string \| null | The customer the lookup resolved to. Null on miss. |
| `matchCount` | number | How many customer docs matched the phoneKey (0, 1, or N for shared-phone case). |
| `latencyMs` | number | End-to-end webhook → write latency. |
| `outcome` | `'matched' \| 'no_match' \| 'invalid_phone' \| 'unmapped_business' \| 'error'` | Resolution outcome. |
| `errorDetail` | string? | Short error message (no PII, no stack). |
| `createdAt` | Timestamp | |

**Indexes:** `(createdAt DESC)`, `(outcome ASC, createdAt DESC)`.

**Security:** read for owner/admin only; write blocked (Cloud Function only).

**TTL:** 30 days. Telemetry-grade; not part of customer history.

### `businesses/{businessId}/missedCallEvents/{eventId}` (v3 NEW)

**Purpose:** captures every missed-call notification + status, separate from `leads`. A missed call always creates a `missedCallEvents` row; a `leads` row is created only when the missed call is deemed a fresh sales opportunity (deduplicated within a 7d window per `phoneKey`). This separation lets operators see "every missed call" in a notification feed while keeping the Leads funnel clean.

| Field | Type | Notes |
|---|---|---|
| `id` | string | Random Firestore ID. |
| `twilioCallSid` | string | Idempotency key. |
| `fromE164` | string | |
| `phoneKey` | string | |
| `toE164` | string | Which business line was called. |
| `customerId` | string \| null | Resolved at missed-call time. |
| `callStatus` | `'no-answer' \| 'busy' \| 'failed'` | The Twilio `CallStatus` that classified this as a miss. |
| `leadId` | string? | Set if a `leads` row was also created for this miss. |
| `acknowledged` | boolean | Operator can dismiss from the missed-call feed. Default false. |
| `occurredAt` | Timestamp | |
| `createdAt` | Timestamp | |

**Indexes:** `(acknowledged ASC, occurredAt DESC)` for the feed; `(twilioCallSid ASC)` for idempotency; `(customerId ASC, occurredAt DESC)` for customer-timeline render.

**Security:** read for all members; `update` allowed for any member to set `acknowledged = true`; create/delete blocked (Cloud Function only).

### `businesses/{businessId}/autoTextRules/{ruleId}` (v3 NEW — schema only in v1; UI deferred to SP7)

**Purpose:** operator-defined rules for missed-call auto-text-back. Stored in v1 so the schema is stable when SP7 builds the rule engine.

| Field | Type | Notes |
|---|---|---|
| `id` | string | Random Firestore ID. |
| `enabled` | boolean | Per-rule kill switch. |
| `trigger` | `'missed_call' \| 'after_hours_call' \| 'new_customer_call'` | What fires the rule. |
| `messageTemplate` | string | Operator-authored template. Supports `{customer.name}` / `{business.name}` placeholders (v1 schema; v1 doesn't render them — SP7 does). |
| `cooldownMinutes` | number | Don't re-trigger for the same phoneKey within N minutes. Default 1440 (24h). |
| `appliesTo` | `'all_callers' \| 'new_callers_only' \| 'known_callers_only'` | Audience filter. |
| `createdByUid` | string | |
| `createdAt` | Timestamp | |
| `updatedAt` | Timestamp | |

**Indexes:** `(enabled ASC)`.

**Security:** read for all members; create/update/delete for owner/admin only. v1 has no UI for this collection; it ships schema-only as an SP7 future-ready seam.

### Data retention & cascade deletion

Every collection introduced by this spec MUST be reachable by tenant deletion. The existing `scheduledDeletionPurge` calls `db.recursiveDelete(businessRef)`, which walks `businesses/{bid}/**` — that covers `customers`, `vehicles`, `incomingCalls`, and `leads` automatically. The two top-level collections require explicit handling:

| Collection | Path | How it's purged on business deletion |
|---|---|---|
| `businesses/{bid}/customers/**` | tenant-scoped | `recursiveDelete(businessRef)` (existing). |
| `businesses/{bid}/customers/{cid}/vehicles/**` | tenant-scoped | `recursiveDelete(businessRef)` (existing). |
| `businesses/{bid}/incomingCalls/**` | tenant-scoped | `recursiveDelete(businessRef)` (existing). Note: `recordingUrl` (future) would point at Twilio's CDN — the recording itself would be governed by Twilio retention; operator must align Twilio settings with their privacy policy. |
| `businesses/{bid}/leads/**` | tenant-scoped | `recursiveDelete(businessRef)` (existing). |
| `businesses/{bid}/communicationEvents/**` | tenant-scoped (v3 NEW) | `recursiveDelete(businessRef)` (existing). |
| `businesses/{bid}/callerLookupEvents/**` | tenant-scoped (v3 NEW) | `recursiveDelete(businessRef)` (existing). |
| `businesses/{bid}/missedCallEvents/**` | tenant-scoped (v3 NEW) | `recursiveDelete(businessRef)` (existing). |
| `businesses/{bid}/autoTextRules/**` | tenant-scoped (v3 NEW) | `recursiveDelete(businessRef)` (existing). |
| `twilioPhoneNumbers/{e164}` | **top-level** | **`scheduledDeletionPurge` MUST be extended** to query `twilioPhoneNumbers where businessId == purgedBusinessId` and delete each doc AFTER the `recursiveDelete(businessRef)` completes. This work is part of SP4, not a follow-up. |
| `twilioWebhookEvents/{webhookEventId}` | top-level | TTL-managed (28h). Not tenant-scoped — events for the deleted tenant naturally age out within 28h of their last write. No explicit purge step required, but document the asymmetry. |
| `twilioSyncCursors/{twilioPhoneNumberSid}` | top-level | Deleted alongside `twilioPhoneNumbers` in the same purge sweep (lookup `twilioPhoneNumberSid` from each soon-to-be-deleted `twilioPhoneNumbers` doc before its deletion). Part of SP4. |
| `twilioPhoneNumberOwnershipAudits/{...}` | top-level | Retained 90 days for compliance; sweep via a separate scheduled function. SP4 scope. |

After this extension, a tenant deletion leaves zero records pointing at the deleted businessId. The audit-collection retention is intentional (90 days) and matches the compliance posture for ownership conflicts.

**v3 note — removed:** v2's `quoUserMapping` is not part of v3 (Twilio has no analogue), so no cascade-delete handling for it is needed.

### Per-customer right-to-delete (GDPR / CCPA)

End-customers of an MSOS business have the right under GDPR Article 17 and CCPA Section 1798.105 to request erasure of their PII. Soft-delete (`customer.deletedAt = now`) is NOT sufficient — phone, email, address, and the denormalized `customerName`/`customerPhone`/`customerEmail` on every related Job must be hard-removed or anonymized.

**v1 decision (deferred):** Per-customer GDPR/CCPA hard-delete is **explicitly out of scope for v1**. The "Delete" button in CustomerProfile is soft-delete only, intended as an operator UX affordance ("hide this customer from my list") not a regulatory deletion. This is added to *Out of Scope* with a named follow-up: **SP7.5 — Customer hard-delete (GDPR/CCPA)**. The follow-up will:

- Add a separate "Forget customer (GDPR)" action, owner-only, with a second-confirmation prompt that names the regulatory implications.
- Hard-cascade: delete the Customer doc; delete all `vehicles` subdocs; for every Job with this customerId, tombstone `customerName`/`customerPhone`/`customerEmail`/`city`/`state` to `'[deleted]'` (PRESERVE financial records for tax compliance — IRS retention requirements supersede the right to erasure for financial data); delete `leads` matching `phoneKey`; scrub `incomingCalls` (clear `fromE164`/`fromDigits`/`customerName`/`customersSnapshot`).
- Trigger Twilio recording deletion (via the Twilio REST API) of any `recordingUrl` referenced from the scrubbed calls. v1 does not enable recordings; SP7.5 inherits the Twilio recording-delete path.
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

### `businesses/{businessId}/settings` — additive changes (v2)

The existing Settings doc (already a single doc per business) gains new fields. No new collections, no rule rewrites — the existing owner/admin-only update rule covers them.

| Field | Type | Default | Notes |
|---|---|---|---|
| `autoSaveCustomersFromJobs` | boolean | `true` | **v2 NEW — P17.** When `true`, `saveJob` calls `upsertCustomerFromJob`. When `false`, the job saves with no `customerId` / `vehicleId` / `phoneKey`. Settings UI lands in SP3 ("Customer Directory" accordion). |
| `communicationProvider` | `'twilio'` | `'twilio'` | **v3 NEW.** Read-only label in v1 (always `'twilio'`). The provider-abstraction layer resolves the implementation at request time from this field. Future providers would add new enum values. |
| `twilioConnected` | boolean | `false` | **v3 NEW — replaces v2's `openphoneConnected`.** Per-business toggle. When `false`, IncomingCallModal listener does not attach; Settings → Communications shows "Connect Twilio" CTA. Set to `true` by `adminConnectTwilioNumber` after operator supplies their Twilio number + (verified) account info. **Derived display value:** Settings UI shows "Connected" when this is true AND `lastTwilioWebhookSuccessAt` (telemetry) is within 7d; otherwise "Not connected". |
| `incomingCallLookupEnabled` | boolean | `true` | **v3 NEW.** Controls whether the voice webhook performs customer lookup + writes `incomingCalls`. Owner-only toggle. |
| `incomingSMSLoggingEnabled` | boolean | `true` | **v3 NEW.** Controls whether the SMS webhook writes `communicationEvents` rows. Owner-only toggle. |
| `missedCallAutoTextEnabled` | boolean | `false` | **v3 NEW.** Master switch for the SP7 `autoTextRules` engine. Default OFF — no automated outbound texts in v1. Owner-only toggle. |
| `outboundSMSEnabled` | boolean | `true` | **v3 NEW.** Master switch consulted by the `sendSMS` callable before sending. Default ON (callable still gated on auth + env-var safeguards). Owner-only toggle. |
| `outboundCommunicationProvider` | `'native' \| 'twilio'` | `'native'` | **v3-updated.** v1 always uses `tel:` for Call; outbound SMS uses Twilio via the `sendSMS` callable. The "Text" button in v1 opens a small inline UI that calls `sendSMS` when `outboundSMSEnabled === true`, else falls back to native `sms:` link. |
| `autoTextBackEnabled` | boolean | `false` | **Future-ready seam (SP7).** Superseded in v3 by `missedCallAutoTextEnabled`; retained for backward-compat. |

Existing Settings fields (verticalId, mileageRate, defaultTaxRate, currency, etc.) are unchanged. The v2/v3 additions follow the same `lastEditedByUid` / `lastEditedAt` audit pattern already required on Customer writes.

**Migration note:** existing Wheel Rush tenants default to `autoSaveCustomersFromJobs: true` (preserves current behavior), `twilioConnected: false` (no Twilio config until operator opts in), `communicationProvider: 'twilio'` (read-only). No admin action required for upgrade.

---

## Vertical-Agnostic Entity Design

The system supports mobile tire, roadside assistance, mobile mechanics, car wash / detailing, and future MSOS verticals from day 1. Three architectural principles enforce this:

### 1. Customer is fully vertical-agnostic

No field on the Customer doc is specific to a single vertical. Fleet (`companyName`), VIP tiering, status derivation, and global search all operate uniformly across every vertical. The mobile-tire-specific historical pattern of bundling tire metadata onto the customer entity is explicitly rejected.

### 2. Vehicle has a universal core + per-vertical sub-objects

The Vehicle schema (above) separates a universal core (`year`, `make`, `model`, `trim`, `color`, `vin`, `licensePlate`) from vertical-specific sub-objects:

- `vehicle.tire` — written only for tire-vertical jobs. Contains `size`, `alternateSize`, `brand`, `condition`, `tpmsNotes`, `wheelLockNotes`.
- `vehicle.mechanic` — placeholder sub-object reserved for the mechanic vertical. Schema-only in v1.
- `vehicle.detailing` — placeholder sub-object reserved for the detailing vertical. Schema-only in v1.

`upsertCustomerFromJob` reads the active `verticalId` from `settings.verticalId` and writes ONLY the matching sub-object. A roadside or mechanic tenant never accumulates empty `vehicle.tire` keys.

### 3. Customer Timeline labels read from the vertical config

The Customer Timeline (Service History section of CustomerProfile) renders each job's service label by looking up `verticalConfig.services[job.service].label` rather than hardcoded strings. The existing `resolveVertical()` pattern at `src/lib/verticals/resolveVertical.ts` is already shaped this way; SP3 wires the Customer Timeline through the same lookup.

### 4. `vehicleKey()` prefers universal fields

The doc-ID generator is updated to slug `year-make-model-trim` when those universal fields are present, and only falls back to tire-vertical-specific keys (`vehicleType + tireSize`) for legacy tire jobs that lack make/model. This means switching verticals on an existing tenant does not cause vehicle-key collisions.

### 5. Backfill migration collapses tire fields into the sub-object

The SP3 `backfillCustomers` Cloud Function walks every existing job and rewrites tire-flat-field Vehicle docs into the `vehicle.tire.{size,brand,condition}` sub-object form. Legacy reads continue to work via a fallback path (`vehicle.tire?.size ?? vehicle.tireSize`) — the migration is non-breaking.

### 6. CustomerProfile renders fields conditional on active vertical

CustomerProfile uses the existing `resolveVertical()` pattern to conditionally render tire-specific Insights tiles ("Most Common Tire Size") only for tire-vertical tenants. Mechanic and detailing tenants see vertical-appropriate tiles in their place (when those verticals graduate from schema-only).

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

**Hard contract for callers (upsertCustomerFromJob, saveJob, twilioIncomingCall provider handler):**

If `normalizePhone(raw).valid === false`:
- `upsertCustomerFromJob` MUST NOT write `phoneKey` or `phoneE164` on the Customer doc. Instead it falls back to the `n_<slug>` name-keyed customer doc with phone fields unset. If both phone and name are empty/invalid, throw and let the caller's try/catch toast the warning.
- `saveJob` MUST NOT write `phoneKey` on the Job doc (omit the field; never write `''`).
- The `twilioIncomingCall` provider handler MUST bail out of the `customers.where('phoneKey','==',digits)` query before issuing it, write `customerId: null` with diagnostic `lookupSkippedReason: 'invalid_phone'` on the `incomingCalls` doc, and treat the call as an unknown-caller lead.

**phoneKey canonical form — single source of truth:** `phoneKey` is the 11-digit US E.164 digits (e.g. `13058977030`) **everywhere**: the `Customer.phoneKey` field, `Job.phoneKey` field, all Firestore indexes, and inside the Customer doc ID prefix `p_<phoneKey>` (so the canonical doc ID for the example becomes `p_13058977030`).

This is a **breaking change vs today's `customerKey()`** at `src/lib/customers.ts:91-102`, which returns `p_<raw 10-digit local>` (e.g. `p_3058977030`). To reconcile:

1. **`customerKey()` is updated in SP1** to compute via `normalizePhone(...).digits` and produce `p_13058977030`-style IDs going forward.
2. **SP3's `backfillCustomers` Cloud Function (P3 — confirmed in v2) explicitly renames every legacy `p_<10-digit>` Customer doc to `p_<11-digit>`** and adds `phoneKey` to every doc that lacks it. The hybrid second-chance lookup below becomes a **transitional safety net** during backfill execution (and for the short window between SP1 deploy and SP3 deploy), not a permanent fallback.
3. **Hybrid read path also tries the legacy form (transitional).** `deriveCustomerProfiles` and `lookupCustomerByPhone` first query `customers/p_<normalized 11-digit>`; on miss they fall back to `customers/p_<legacy 10-digit>` (digits 1-10 of the normalized form, i.e. drop the leading `1`). Found legacy docs are surfaced unchanged. After SP3's backfill runs, the fallback path becomes dead code — kept for one release cycle as a safety net, then removed.
4. **Webhook `phoneKey` query stays single-form:** the `customers.where('phoneKey','==',digits)` query in the `twilioIncomingCall` provider handler uses ONLY the 11-digit form. Pre-backfill, legacy customers without a `phoneKey` field on the doc resolve to `customerId: null` and show as unknown callers. **Post-backfill, every customer has a `phoneKey` and the unknown-caller fallback only fires for genuine first-time callers.** This is the primary reason backfill became confirmed scope in v2.

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
| `twilioIncomingCall.ts` | cloud-function | `functions/src/twilioIncomingCall.ts` | v2 `onRequest` Twilio voice webhook. Verifies `X-Twilio-Signature` (HMAC-SHA1 of URL + sorted POST params). Resolves business from `twilioPhoneNumbers/{To}`. Resolves customer via `lookupCustomerByPhone()`. Writes `incomingCalls/{CallSid}`. Returns minimal TwiML `<Response><Pause length="1"/></Response>`. See *Twilio Integration* below. | `phone.ts` (functions), `communicationProvider.ts` |
| `twilioIncomingSMS.ts` | cloud-function | `functions/src/twilioIncomingSMS.ts` | v2 `onRequest` Twilio SMS webhook. Same signature verification. Writes `communicationEvents` row (type `incoming_sms`). Returns empty `<Response/>` TwiML. | `phone.ts` (functions), `communicationProvider.ts` |
| `twilioCallStatus.ts` | cloud-function | `functions/src/twilioCallStatus.ts` | v2 `onRequest` Twilio status-callback webhook. Same signature verification. Updates `incomingCalls/{CallSid}` with `completedAt` / `missedAt` / `durationSec` based on `CallStatus`. On `no-answer` / `busy` / `failed`, writes `missedCallEvents` row and optionally creates a `leads` row (7d dedup). Returns 200 + empty body. | `phone.ts` (functions), `communicationProvider.ts` |
| `sendSMS.ts` | cloud-function | `functions/src/sendSMS.ts` | v2 `onCall` callable. Owner/admin only. Inputs `{businessId, to, message}`. Safeguards: `TWILIO_*` env present; `settings.outboundSMSEnabled !== false`; rate-limit per business per minute. Resolves per-business sender (Messaging Service SID > global `TWILIO_PHONE_NUMBER`). Calls Twilio REST API via `twilioClient.ts`. Logs to `communicationEvents`. Returns `{messageSid, status}`. Graceful "Twilio not configured" error when env unset. | `twilioClient.ts`, `communicationProvider.ts` |
| `twilioClient.ts` | helper-library | `functions/src/lib/twilioClient.ts` | Thin wrapper over Twilio's Node SDK (or raw `fetch` to REST API). Loads `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN` from secrets. Exposes `sendSMS({from, to, body})` and `validateSignature(authToken, url, params, signature)` helpers. Centralizes the env-var presence check so the three webhook endpoints and the callable share one source of truth. | — |
| `communicationProvider.ts` | helper-library | `functions/src/lib/communicationProvider.ts` | Provider abstraction interface + registry. Exposes `getProvider(name: 'twilio')` returning an object with `handleIncomingCall`, `handleIncomingSMS`, `handleCallStatusUpdate`, `sendSMS`, `verifySignature` methods. Registry: `{ twilio: TwilioProvider }`. See *Provider Abstraction Layer*. | `providers/twilio.ts` |
| `providers/twilio.ts` | helper-library | `functions/src/lib/providers/twilio.ts` | Twilio implementation of the `CommunicationProvider` interface. Encapsulates form-encoded payload parsing, signature verification, TwiML response construction, and the Twilio REST API client. | `twilioClient.ts` |
| `functions/src/index.ts` (mod) | barrel | `functions/src/index.ts` | Add `export { twilioIncomingCall } from './twilioIncomingCall'; export { twilioIncomingSMS } from './twilioIncomingSMS'; export { twilioCallStatus } from './twilioCallStatus'; export { sendSMS } from './sendSMS';`. Mirrors the Stripe pattern. | (above) |
| `adminConnectTwilioNumber.ts` | cloud-function | `functions/src/adminConnectTwilioNumber.ts` | v1 `https.onCall`. Owner/admin only via `assertOwnerOrAdmin`. Inputs: `{businessId, e164, twilioPhoneNumberSid, messagingServiceSid?, label?, defaultAssignedToUid?, force?: boolean}`. Normalizes `e164` via `normalizePhone()`, rejects `valid === false`. **Uniqueness check:** if `twilioPhoneNumbers/{e164}` already exists AND its `businessId !== input.businessId`, refuse with error code `'phone_number_owned_by_other_business'` UNLESS `force: true` (owner-only + UI confirmation). Every conflict-write (refusal or forced overwrite) writes an audit doc to `twilioPhoneNumberOwnershipAudits/{ts}_{e164}` with `{actorUid, attemptedBusinessId, existingBusinessId, action, ip}`. Sets `settings.twilioConnected = true` on success. | — |
| `IncomingCallModal.tsx` | react-component | `src/components/IncomingCallModal.tsx` | Centered modal at z-index 9500. `.modal-overlay` + `useFocusTrap` + `role='alert' aria-live='assertive'`. Renders caller name (or "Unknown caller"), formatted phone, repeat badge, vehicles, last-job card, Accept / Decline / Dismiss + quick action buttons. Plays `/sounds/ringtone.mp3` via `HTMLAudioElement` loop until any action or `ringingExpiresAt` passes. | `useFocusTrap.ts`, `phone.ts` |
| `useIncomingCallListener.ts` | client-module | `src/lib/useIncomingCallListener.ts` | `useIncomingCallListener(businessId, currentUid): IncomingCall \| null`. Attaches `onSnapshot` on `collection(_db, 'businesses/${businessId}/incomingCalls')` filtered by `where('status','==','ringing')` + ordered by `createdAt desc` + `limit(5)`. Returns most recent unexpired ringing doc visible to current user (respects `assignedToUid`). Auto-clears when `ringingExpiresAt` passes via a single `setTimeout`. | `firebase.ts` |
| `App.tsx` (mod) | react-component | `src/App.tsx` | Add `const incomingCall = useIncomingCallListener(businessId, uid)` near existing listener setup ([lines 437-583](../../../src/App.tsx)). Render `{incomingCall && <IncomingCallModal ... />}` near `JobDetailModal` mount at [line 1568](../../../src/App.tsx). | `useIncomingCallListener.ts`, `IncomingCallModal.tsx` |
| `Leads.tsx` + `Lead` type | react-component | `src/pages/Leads.tsx` | List page sorted by `createdAt DESC`. Columns: time, name (or "Unknown"), phone, source, status, last action. Row actions: Call back (`tel:`), Text (`sms:` or `sendSMS`), Convert to Job (preloads AddJob draft with customer + lead context), Mark Lost. New tab added to MoreSheet for owner/admin/canCreateJobs. | `twilioCallStatus.ts` (indirectly via writes) |
| `firestore.rules` (mod) | rules | `firestore.rules` | Add rules for `customers/{cid}/vehicles/**`, `incomingCalls/**`, `leads/**`, `twilioPhoneNumbers/**`, `twilioWebhookEvents/**`, `communicationEvents/**`, `callerLookupEvents/**`, `missedCallEvents/**`, `autoTextRules/**`. Tighten `customers/{cid}` update to allow non-meta upserts by any member with `canCreateJobs` while preserving owner/admin gate on note/tags. | — |
| `CommunicationsSettingsSection.tsx` | react-component | `src/components/settings/CommunicationsSettingsSection.tsx` | **v3 NEW** Settings accordion. Read-only "Communication Provider: Twilio" label, derived "Connected/Not connected" status, four toggles (`incomingCallLookupEnabled`, `incomingSMSLoggingEnabled`, `missedCallAutoTextEnabled`, `outboundSMSEnabled`), a "Connect Twilio Number" form that calls `adminConnectTwilioNumber`, and an owner-only "Last 50 webhook events" debug panel. Replaces v2's `QuoIntegrationSection.tsx`. | `adminConnectTwilioNumber.ts` |
| **v2 NEW** `searchCustomers.ts` | client-module | `src/lib/searchCustomers.ts` | Debounced multi-field search across `customers.{nameLower, companyLower, phoneKey, cityLower, zipCode}` + collection-group on `vehicles.{makeModelLower, licensePlate, tire.size}`. Parallel `Promise.all` for the field branches; per-query `limit(20)`; result merge keyed on `customerId`; 60s in-memory result cache keyed on normalized query. Targets sub-300ms on Wheel Rush-scale data. RBAC: techs see only their own customers (post-fetch filter by `customerId IN scopedCustomerIds`); owners/admins see all. | `phone.ts`, `firebase.ts` |
| **v2 NEW** `GlobalSearchSheet.tsx` | react-component | `src/components/GlobalSearchSheet.tsx` | Bottom-sheet modal launched from a persistent search icon in main nav. Single text input using the `MemoInput` pattern with 200ms debounce. Renders grouped results: Customer header + nested Vehicle sub-rows; tap → CustomerProfile. Empty / no-match / loading skeleton states. Mobile-first. | `searchCustomers.ts` |
| **v2 NEW** `CustomerInsightsCard.tsx` | react-component | `src/components/customerProfile/CustomerInsightsCard.tsx` | Renders the 9 insight metrics on CustomerProfile. Financial metrics gated by `canViewFinancials`; non-financial metrics visible to all. VIP Tier badge rendered prominently. Vertical-aware: "Most Common Tire Size" only renders for tire-vertical tenants. | `customerInsights.ts` |
| **v2 NEW** `customerInsights.ts` | client-module | `src/lib/customerInsights.ts` | Pure helpers: `deriveVipTier(lifetimeRevenue)`, `deriveCustomerStatus({ lastJobAt, companyName, vipTier })`, `computeMostCommonVehicle(jobs)`, `computeMostCommonTireSize(jobs)`, `computeMostCommonServiceType(jobs, verticalConfig)`. Used both by the client card AND by the `onJobWrite` Cloud Function rollup trigger. | — |
| **v2 NEW** `onJobWriteCustomerRollup.ts` | cloud-function | `functions/src/onJobWriteCustomerRollup.ts` | Firestore trigger on `businesses/{bid}/jobs/{jobId}` writes. Recomputes `averageTicket`, `vipTier`, `customerStatus` on the Customer doc. Idempotent (re-runs are safe). Wraps the same helpers as the client `customerInsights.ts` (logic colocated via the duplicated-helper pattern). | `customerInsights.ts` (duplicate) |
| **v2 NEW** `backfillCustomers.ts` | cloud-function | `functions/src/backfillCustomers.ts` | One-shot HTTPS callable (owner-only) triggered from Settings admin button. Takes `{businessId, dryRun: boolean}`. Scans all jobs, upserts Customer + Vehicle, auto-merges duplicates by `phoneKey`, migrates legacy `p_<10-digit>` doc IDs to `p_<11-digit>`, hoists tire fields into `vehicle.tire`, computes initial rollups. Writes audit doc `businesses/{bid}/maintenance/backfillCustomers`. Re-runnable via `processedJobIds` dedup. | `phone.ts` (functions), `customerInsights.ts` (functions) |
| **v2 NEW** `AddressAutofillInput.tsx` | react-component | `src/components/AddressAutofillInput.tsx` | v1 contract: ZIP-first input flow — operator types 5-digit ZIP → `addressLine`/`city`/`state` autofill from a bundled US ZIP → city/state JSON dataset (~200 KB gzipped, ~40k ZIPs, shipped with the client). No external API, no street-level validation, no PII sent off-device. `addressLine` is free-text. Populates `addressLine`, `city`, `state`, `zipCode` on the draft. Used in AddJob step 7 (Location) and in CustomerProfile edit mode. **SP7 follow-up:** swap dataset for Google Places API to add street-level autocomplete (requires `GOOGLE_PLACES_API_KEY` secret + per-tenant privacy disclosure). | — |
| **v2 NEW** `CustomerDirectorySettingsSection.tsx` | react-component | `src/components/settings/CustomerDirectorySettingsSection.tsx` | New Settings accordion: (a) `autoSaveCustomersFromJobs` toggle row with helper copy, (b) "Backfill Customers from Job History" button (owner-only, calls `backfillCustomers` callable; shows audit-doc summary when complete), (c) future home for retention-campaign opt-ins. Gated by `canEditBusinessSettings`. | `backfillCustomers.ts` |

---

## Provider Abstraction Layer (v3)

**Rationale:** Twilio is the only active communications provider in v3 — the user explicitly stated *"Twilio is now the primary communications provider"* with no other providers planned. But the architecture exposes a thin abstraction so future provider additions don't require rewiring every business-logic call site. The abstraction lives at the **business-logic layer**, NOT the HTTP route layer (each provider's webhook payload shape differs, so each needs its own HTTP route).

### Interface

```ts
// functions/src/lib/communicationProvider.ts
export interface CommunicationProvider {
  /** Process an inbound voice webhook payload. Resolves business + customer; writes incomingCalls. */
  handleIncomingCall(rawPayload: Record<string, string>, signature: string, requestUrl: string): Promise<HandleResult>;

  /** Process an inbound SMS webhook payload. Resolves business + customer; writes communicationEvents. */
  handleIncomingSMS(rawPayload: Record<string, string>, signature: string, requestUrl: string): Promise<HandleResult>;

  /** Process a call status-update webhook (completed/missed/etc.). Updates incomingCalls + missedCallEvents. */
  handleCallStatusUpdate(rawPayload: Record<string, string>, signature: string, requestUrl: string): Promise<HandleResult>;

  /** Send an outbound SMS via this provider. */
  sendSMS(args: { businessId: string; to: string; message: string; actorUid: string }): Promise<SendResult>;

  /** Verify a webhook signature for this provider's webhook payload format. */
  verifySignature(authToken: string, requestUrl: string, params: Record<string, string>, signature: string): boolean;

  /** Build the provider-appropriate HTTP response body. For Twilio voice/SMS this is TwiML XML. */
  buildAcceptResponse(): { contentType: string; body: string };
}

export type HandleResult =
  | { kind: 'ok'; incomingCallId?: string; communicationEventId?: string }
  | { kind: 'idempotent_skip' }
  | { kind: 'bad_signature' }
  | { kind: 'unmapped_business' }
  | { kind: 'invalid_payload'; reason: string };

export type SendResult =
  | { kind: 'ok'; providerEventId: string; status: string }
  | { kind: 'disabled'; reason: 'env_missing' | 'outbound_disabled' | 'rate_limited' }
  | { kind: 'error'; reason: string };
```

### Registry

```ts
import { TwilioProvider } from './providers/twilio';

const PROVIDERS: Record<string, CommunicationProvider> = {
  twilio: new TwilioProvider(),
};

export function getProvider(name: string): CommunicationProvider {
  const p = PROVIDERS[name];
  if (!p) throw new Error(`Unknown communication provider: ${name}`);
  return p;
}
```

Resolved at request time from `settings.communicationProvider` (currently always `'twilio'`). The three webhook endpoint files each construct their provider via `getProvider('twilio')` (hardcoded in v1 since there's only one provider; the indirection exists so SP7+ can swap to a settings-driven lookup without rewriting the endpoints).

### Files

- `functions/src/lib/communicationProvider.ts` — interface + registry.
- `functions/src/lib/providers/twilio.ts` — Twilio implementation.
- `functions/src/lib/twilioClient.ts` — thin wrapper over Twilio's REST SDK (used by both the SMS-send path and the Twilio-managed signature verification).

### Why not at the HTTP-route layer?

Twilio webhooks arrive as `application/x-www-form-urlencoded` with field names like `From`, `To`, `CallSid`. A hypothetical future provider would have a different payload shape and a different signature algorithm. Putting all providers behind a single `/inboundCommunicationWebhook` endpoint would require sniffing User-Agent or path prefixes to dispatch — fragile and error-prone. Instead, each provider has its own HTTP route (`twilioIncomingCall`, `twilioIncomingSMS`, `twilioCallStatus`); the route deserializes the provider-specific payload and hands a normalized `Record<string, string>` to the provider interface. The provider does signature verification, business logic, and returns a normalized result that the route turns into the provider-appropriate HTTP response.

### `lookupCustomerByPhone` is at the customer layer, not the provider

`lookupCustomerByPhone(businessId, rawPhone)` lives at `src/lib/lookupCustomerByPhone.ts` (client) and `functions/src/lib/lookupCustomerByPhone.ts` (functions) — it is NOT part of the provider interface. Provider implementations call it after resolving `businessId` from their phone-number mapping. This keeps customer-resolution logic provider-agnostic.

---

## Twilio Integration

### Twilio-Optional Architecture (v3)

**Decision (from user requirement #16):** MSOS must work even if the Twilio env vars are NOT configured yet. The architecture is feature-flag gated such that SP1-SP3 ship full value with NO Twilio config; SP4 (webhooks) returns 404 when `TWILIO_WEBHOOK_ENABLED !== 'true'`; SP6 (popup) listener is harmless when no `incomingCalls` docs ever land; `sendSMS` callable returns "Twilio not configured" error gracefully.

#### Two-layer gating

1. **Global gate — `TWILIO_WEBHOOK_ENABLED` env var on Cloud Functions.**
   - Default `'false'` at v1 deploy.
   - When `'false'`: every Twilio webhook endpoint (`twilioIncomingCall`, `twilioIncomingSMS`, `twilioCallStatus`) returns a cheap `404` immediately (no secret read, no Firestore touch). Same kill-switch pattern as the Stripe webhook.
   - Flip via `firebase functions:config:set twilio.webhook_enabled=true` + `firebase deploy --only functions:twilioIncomingCall,functions:twilioIncomingSMS,functions:twilioCallStatus` (no source change).

2. **Per-business gate — `businesses/{bid}/settings.twilioConnected` boolean.**
   - Default `false`.
   - When `false`: client-side `useIncomingCallListener` short-circuits before attaching the `onSnapshot`. Settings → Communications shows a "Connect Twilio" CTA. CustomerProfile Call button always uses `tel:`; Text button falls back to native `sms:` instead of the Twilio-backed inline UI.
   - Set to `true` by `adminConnectTwilioNumber` after the operator supplies their Twilio number + verified account info.

#### Unconnected-mode UX (the v1 default — even though the operator owns a Twilio account)

- **CustomerProfile Call button:** native `tel:` only.
- **CustomerProfile Text button:** falls back to native `sms:` when `twilioConnected === false` OR `outboundSMSEnabled === false` OR `sendSMS` returns `'disabled'`.
- **IncomingCallModal:** never renders (listener does not attach). No flash of error UI.
- **Leads page:** still accessible from MoreSheet; empty list until either missed-call webhooks land OR a future "manual lead" affordance ships.
- **Settings → Communications:** displays a "Connect Twilio" CTA with operator instructions: (1) confirm Twilio account + provisioned number, (2) provide the Twilio number's E.164 form and SID via the connect form, (3) MSOS ops flips `TWILIO_WEBHOOK_ENABLED`, (4) operator configures the Twilio number's VoiceUrl/StatusCallback/SMS webhook URLs in the Twilio console.
- **Global Customer Search, Customer Profile, Customer Insights, Add Job, Backfill:** all fully functional. The user gets the SP1-SP3 value pile regardless of Twilio status.

#### Activation flow (when operator opts in)

1. Owner opens Settings → Communications → "Connect Twilio Number". Supplies E.164 number + Twilio Phone Number SID (`PNxxxx`) + optional Messaging Service SID + label.
2. `adminConnectTwilioNumber` callable:
   - Normalizes `e164` via `normalizePhone()`.
   - Refuses overwrite if `twilioPhoneNumbers/{e164}` is owned by another business (unless `force: true` + audit).
   - Writes `twilioPhoneNumbers/{e164}` mapping.
   - Sets `settings.twilioConnected = true`.
   - Writes audit doc.
3. MSOS ops flips `TWILIO_WEBHOOK_ENABLED=true` on the functions via `firebase functions:config:set` and redeploys. Within ~60s the three webhook endpoints accept traffic.
4. Operator opens Twilio console for their number and points:
   - **A Call Comes In** (Voice) → `https://us-central1-<project>.cloudfunctions.net/twilioIncomingCall` (HTTP POST).
   - **Call Status Changes** (Status Callback) → `https://us-central1-<project>.cloudfunctions.net/twilioCallStatus` (HTTP POST). Subscribes to `completed`, `busy`, `no-answer`, `failed` events.
   - **A Message Comes In** (Messaging) → `https://us-central1-<project>.cloudfunctions.net/twilioIncomingSMS` (HTTP POST).
   - **Call Forwarding** (still operator-configured in Twilio console — rings their actual mobile phone). The MSOS webhook does NOT replace this; it complements it.
5. IncomingCallModal listener attaches on next App.tsx mount.

#### Why these flags can stay safe-off by default

The architecture is already shaped this way: all webhook endpoints check `TWILIO_WEBHOOK_ENABLED` first. The IncomingCallModal listener checks `settings.twilioConnected` first. The `sendSMS` callable checks env-var presence first. This section makes the principle explicit so future engineers don't accidentally add Twilio-required code paths to SP1-SP3.

### Three webhook endpoints (Twilio model)

Twilio sends a separate webhook for each event kind. v3 ships **three** distinct Firebase Cloud Functions, each with its own URL:

| Function | URL | Triggered by | Response |
|---|---|---|---|
| `twilioIncomingCall` | `https://us-central1-<project>.cloudfunctions.net/twilioIncomingCall` | Twilio number's **VoiceUrl** when an inbound call rings. | Minimal TwiML `<Response><Pause length="1"/></Response>` — keeps the call alive without barging in on Twilio's number-level forwarding which routes the call to the operator's actual phone. |
| `twilioIncomingSMS` | `https://us-central1-<project>.cloudfunctions.net/twilioIncomingSMS` | Twilio number's **MessagingUrl** when an inbound SMS arrives. | Empty TwiML `<Response/>` — accepts the message without auto-replying. |
| `twilioCallStatus` | `https://us-central1-<project>.cloudfunctions.net/twilioCallStatus` | Twilio number's **StatusCallback** when call state transitions (`completed`, `busy`, `no-answer`, `failed`). | 200 + empty body. |

**Why three endpoints, not one:** Twilio's payload differs by event type. The voice webhook carries `From / To / CallSid / CallStatus / Direction / Caller / Called`; the SMS webhook carries `From / To / Body / MessageSid / NumMedia`; the status webhook carries `From / To / CallSid / CallStatus / CallDuration`. Twilio configures these URLs separately in the phone-number console. A single combined endpoint would have to dispatch on the presence of `Body` vs `CallSid` vs `CallDuration` — fragile and error-prone. Three endpoints match Twilio's configuration model 1:1.

**Subscribed events (v1):**

| Endpoint | Twilio event | Handler behavior |
|---|---|---|
| `twilioIncomingCall` | Voice webhook (Twilio fires this when the inbound call begins to ring) | Verify signature. Create `incomingCalls/{CallSid}` with `status='ringing'`. Resolve business + customer via `lookupCustomerByPhone()`. Write `customersSnapshot`. ALSO write a `communicationEvents` row (type `incoming_call`, status `ringing`). Return TwiML pause. |
| `twilioCallStatus` | Status callback for `CallStatus=completed` | Verify signature. Update `incomingCalls/{CallSid}` with `completedAt`, `durationSec`, status `'completed'`. Update the corresponding `communicationEvents` row. |
| `twilioCallStatus` | Status callback for `CallStatus=no-answer`, `busy`, `failed` | Verify signature. Update `incomingCalls/{CallSid}` with `missedAt` + status `'missed'`. Write `missedCallEvents` row. Create or update `leads` row (7d dedup by `phoneKey`). |
| `twilioIncomingSMS` | Messaging webhook | Verify signature. Resolve customer via `lookupCustomerByPhone()`. Write `communicationEvents` row (type `incoming_sms`, body, payloadSnapshot). Return empty TwiML. |

**Not subscribed in v1:** call recording webhooks, transcript webhooks, MMS/WhatsApp/RCS channels. The provider abstraction supports adding them later (same provider interface, new handler arms).

### Webhook payloads (form-encoded — not JSON)

Twilio webhooks arrive as `application/x-www-form-urlencoded`. Firebase Functions v2 `onRequest` exposes `req.body` already-parsed for this content type AND preserves `req.rawBody` for signature verification.

**Voice (incoming call) payload — required fields:**
- `From` — caller E.164
- `To` — business number E.164
- `CallSid` — Twilio's unique call id (idempotency key)
- `CallStatus` — typically `ringing` for the initial voice webhook
- `AccountSid` — Twilio account id (sanity check against `TWILIO_ACCOUNT_SID`)
- `Direction` — `inbound`
- `Caller` — same as `From`
- `Called` — same as `To`

**SMS (incoming message) payload — required fields:**
- `From` — sender E.164
- `To` — business number E.164
- `Body` — message text
- `MessageSid` — idempotency key
- `NumMedia` — `0` for SMS, `>0` for MMS (v1 ignores MMS attachments; we just log the message)
- `AccountSid`

**Call status callback payload — required fields:**
- `From` — caller E.164
- `To` — business number E.164
- `CallSid` — matches the original voice webhook's `CallSid`
- `CallStatus` — one of `completed`, `busy`, `no-answer`, `failed`, `canceled`
- `CallDuration` — seconds, when `CallStatus=completed`

### TwiML response shapes (v1)

The voice webhook returns:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Pause length="1"/>
</Response>
```

**Why a pause?** The operator's phone is being rung by Twilio's separate number-level call forwarding (configured in the Twilio console). The MSOS webhook fires concurrently. Returning a `<Pause length="1"/>` keeps Twilio from immediately barging into the call with default behavior (which would otherwise be to say "Sorry, an application error has occurred"). One second is enough for Twilio's forwarding to take over the call routing. **No AI receptionist in v1.** SP7 may add `<Say>` / `<Gather>` / `<Dial>` verbs for an AI receptionist; that's deferred.

The SMS webhook returns an empty Response (Twilio interprets this as "accepted, no auto-reply"):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<Response/>
```

The status callback returns 200 + empty body (Twilio doesn't expect TwiML on status callbacks).

### Twilio webhook signature verification

**Algorithm (verified against [Twilio's security docs](https://www.twilio.com/docs/usage/security)):**

1. **Header:** `X-Twilio-Signature`.
2. **HMAC:** HMAC-SHA1 using `TWILIO_AUTH_TOKEN` as the key.
3. **Signed content:** the exact request URL (including query string, exactly as Twilio sees it) concatenated with the sorted POST params as `key + value + key + value + ...` (Unix-style case-sensitive sort, NO delimiters between concatenated entries).
4. **Encoding:** base64-encode the HMAC-SHA1 result.
5. **Comparison:** timing-safe compare against `X-Twilio-Signature`.
6. **Special case (JSON bodies — not applicable to v1):** when `Content-Type` is `application/json`, Twilio appends a `bodySHA256` query param and signs that instead of the body. Our v1 webhooks are all form-encoded so this branch doesn't apply, but the provider helper documents it.

**Note: Twilio does NOT sign a timestamp.** Unlike Standard Webhooks (Quo's signing model), there is no replay-tolerance window built into the signature. Twilio's defense is: signatures are HMAC-strong; idempotency keys (`CallSid`, `MessageSid`) prevent replay-causing duplicate side-effects; Twilio retries are limited (up to 4 attempts over ~4h). We accept the entire signature window — captured-and-replayed signatures within the retry window will hit the idempotency dedup table and be skipped.

**Webhook URL construction note:** The URL that goes into the signed content must match exactly what Twilio sees on the wire. For Firebase Functions, this is `https://<region>-<project>.cloudfunctions.net/<functionName>` (no trailing slash) plus the original query string if any. The helper accepts a `requestUrl` parameter from the route so it can be tested without a real request.

**Pseudocode:**

```ts
import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import * as crypto from 'crypto';
import { getProvider } from './lib/communicationProvider';

const TWILIO_AUTH_TOKEN = defineSecret('TWILIO_AUTH_TOKEN');
const TWILIO_ACCOUNT_SID_PARAM = defineSecret('TWILIO_ACCOUNT_SID');

export const twilioIncomingCall = onRequest(
  {
    secrets: [TWILIO_AUTH_TOKEN, TWILIO_ACCOUNT_SID_PARAM],
    cors: false,
    invoker: 'public',
    memory: '256MiB',
    timeoutSeconds: 30,
    region: 'us-central1',
    maxInstances: 10,
  },
  async (req, res) => {
    if (process.env.TWILIO_WEBHOOK_ENABLED !== 'true') {
      res.status(404).send('not found'); return;
    }
    if (req.method !== 'POST') {
      res.status(405).send('method not allowed'); return;
    }

    const signature = req.header('x-twilio-signature') || '';
    if (!signature) {
      console.warn('twilioIncomingCall_missing_signature', {
        ip: req.ip, ua: req.header('user-agent'),
        contentLength: req.header('content-length')
      });
      res.status(403).send('forbidden'); return;
    }

    // req.body is already parsed as Record<string, string> for application/x-www-form-urlencoded.
    const params = req.body as Record<string, string>;

    // Sanity check Twilio account id (defense against cross-account misconfiguration).
    if (params.AccountSid !== TWILIO_ACCOUNT_SID_PARAM.value()) {
      console.warn('twilioIncomingCall_account_sid_mismatch', { ip: req.ip });
      res.status(403).send('forbidden'); return;
    }

    // Reconstruct the URL Twilio signed.
    const requestUrl = `https://${req.hostname}${req.originalUrl}`;

    const provider = getProvider('twilio');

    if (!provider.verifySignature(TWILIO_AUTH_TOKEN.value(), requestUrl, params, signature)) {
      console.warn('twilioIncomingCall_bad_signature', {
        ip: req.ip, ua: req.header('user-agent'),
        contentLength: req.header('content-length')
      });
      res.status(403).send('forbidden'); return;
    }

    // Hand off to provider business logic.
    const result = await provider.handleIncomingCall(params, signature, requestUrl);

    // Always respond with TwiML — even on idempotent-skip.
    const accept = provider.buildAcceptResponse();
    res.set('Content-Type', accept.contentType);
    res.status(200).send(accept.body);
  }
);
```

**Twilio signature helper (inside `providers/twilio.ts`):**

```ts
verifySignature(authToken: string, requestUrl: string, params: Record<string, string>, signature: string): boolean {
  // Algorithm per https://www.twilio.com/docs/usage/security
  // 1. Sort POST params alphabetically by key (Unix case-sensitive).
  // 2. Concatenate key+value pairs with no delimiters, appended to the URL.
  // 3. HMAC-SHA1 with authToken as key.
  // 4. Base64-encode.
  // 5. Timing-safe compare with the X-Twilio-Signature header.
  const sortedKeys = Object.keys(params).sort();
  let data = requestUrl;
  for (const k of sortedKeys) data += k + params[k];

  const expected = crypto.createHmac('sha1', authToken).update(data, 'utf8').digest('base64');

  // Both buffers must be the same length for timingSafeEqual.
  try {
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
```

**Hardening posture & accepted risk:**

- **`maxInstances: 10`** caps the cost-amplification blast radius from anyone POSTing to the discovered URL.
- **`TWILIO_WEBHOOK_ENABLED='false'` kill switch** returns 404 cheaply (no secret read, no Firestore touch). Under sustained attack, flip this env var to mute all three endpoints instantly.
- **No timestamp window — accepted risk:** Twilio doesn't sign a timestamp. We rely on (a) HMAC-SHA1 strength against forgery, (b) idempotency keys (CallSid/MessageSid) preventing side-effect replay, (c) the 28h `twilioWebhookEvents` TTL window matching Twilio's retry horizon (~4h). A captured-signature replay outside the retry window can still cause a fresh write since the idempotency row may have aged out — but the side effects (writing an `incomingCalls` row for a long-past call) are operationally low-harm; the operator sees a stale "ringing" doc that auto-clears in 60s via `ringingExpiresAt`.
- **AccountSid sanity check:** every webhook verifies `params.AccountSid === TWILIO_ACCOUNT_SID` (the value our function expects). Defends against a misconfigured Twilio number from a different account accidentally hitting our endpoint.
- **Logging rules (mandatory):** structured WARN at every signature/header failure with `contentLength`, `ip`, `ua`. **NEVER log** `req.rawBody`, the `X-Twilio-Signature` header value, the `TWILIO_AUTH_TOKEN`, customer phone numbers extracted from the payload, SMS message bodies, or any field of the payload at WARN/ERROR levels. INFO-level logs may include `CallSid` / `MessageSid` and `CallStatus` only.
- **Alerting:** elevate to ERROR-level log on the 11th consecutive bad-signature attempt in a 5-minute window so Cloud Logging metric-based alerts can fire.
- **Cloud Armor / App Check / IP allowlist:** OUT OF SCOPE for v1. The defense is HMAC + idempotency + `maxInstances` + kill switch + AccountSid check. The function is `invoker: 'public'` because the webhook receiver pattern requires unauthenticated POST.
- **Plaintext PII:** `phoneE164`, `phoneKey`, `fromE164`, `fromDigits`, `toE164`, `customerPhone`, SMS bodies on `communicationEvents` are stored plaintext in Firestore. Intentional — the `phoneKey` index drives sub-2s lookup. Protection model: Firestore at-rest encryption (Google-managed) + role-based rules + per-business path scoping + tenant isolation invariants. CMEK is OUT OF SCOPE for v1.
- **`incomingCalls.toE164`** is business-confidential (operator's Twilio line) not customer PII; same protection model applies.

### Idempotency

Each Twilio retry of the same event carries the same `CallSid` (for calls) or `MessageSid` (for SMS). Twilio retries up to 4 attempts over ~4 hours.

Key off a deterministic compound key: `${endpoint}:${CallSid|MessageSid}`. This lets the voice webhook for CallSid=CAxxx and the status webhook for the same CallSid=CAxxx coexist as separate idempotency rows.

```ts
const webhookEventId = `${endpoint}:${params.CallSid || params.MessageSid}`;
const ref = db.collection('twilioWebhookEvents').doc(webhookEventId);
await db.runTransaction(async tx => {
  const snap = await tx.get(ref);
  if (snap.exists) {
    return { alreadyProcessed: true }; // 200 + TwiML to stop retries
  }
  tx.set(ref, {
    webhookEventId,
    endpoint,
    providerEventId: params.CallSid || params.MessageSid,
    createdAt: FieldValue.serverTimestamp(),
    processed: false,
  });
  return { alreadyProcessed: false };
});
```

After successful handling: `ref.set({ processed: true, processedAt: FieldValue.serverTimestamp(), businessId, callId }, { merge: true })`.

On idempotency-store failure return **503** (not 200) so Twilio retries.

### Secret management

Register the Twilio secrets with Firebase Secret Manager via operator CLI:

```bash
firebase functions:secrets:set TWILIO_ACCOUNT_SID
# Paste the Twilio Account SID (ACxxxxxxxxxxxx)

firebase functions:secrets:set TWILIO_AUTH_TOKEN
# Paste the Twilio Auth Token (used for both signature verification and REST API calls)

firebase functions:secrets:set TWILIO_PHONE_NUMBER
# Paste the business's primary Twilio E.164 number, used as the default outbound sender
```

Optional secrets:

```bash
firebase functions:secrets:set TWILIO_MESSAGING_SERVICE_SID
# Optional — when set, sendSMS uses Messaging Service instead of single phone number

firebase functions:secrets:set TWILIO_WEBHOOK_SECRET
# Optional — defaults to TWILIO_AUTH_TOKEN (Twilio's standard); only set if your account uses a separate webhook signing key
```

All register via `defineSecret('NAME')` at module top and pass via `{ secrets: [...] }` in `onRequest` options — same pattern as the existing Stripe webhook.

Kill switch: env var `TWILIO_WEBHOOK_ENABLED='true'` required for any of the three endpoints to do anything other than return 404. Same safe-by-default pattern as the existing Stripe webhook.

### Per-business sender resolution (outbound SMS)

When `sendSMS` runs, it resolves the outbound sender as:

1. If `twilioPhoneNumbers/{business.primaryE164}.messagingServiceSid` is set → use that Messaging Service SID (Twilio routes via the service's pool of numbers and pre-configured copy/branding).
2. Else if the env var `TWILIO_MESSAGING_SERVICE_SID` is set globally → use that (single-tenant deploys).
3. Else → use the business's `twilioPhoneNumbers.e164` as the From number. The env var `TWILIO_PHONE_NUMBER` is the fallback for businesses without a registered number doc.

### Retry / failure handling

- **Always return 200 + TwiML on accepted webhooks** (signature valid, idempotent dedup hit OR successful handle). Twilio retries on non-2xx.
- Return **403** on bad signature, missing signature header, or AccountSid mismatch — these are non-retryable.
- Return **404** when `TWILIO_WEBHOOK_ENABLED !== 'true'`.
- Return **400** on malformed payload or missing required Twilio fields.
- Return **405** on non-POST.
- Return **503** on idempotency-store failure or downstream Firestore write failure — Twilio retries.
- Set the function timeout to **30s** (down from Quo's 60s) — Twilio's webhook timeout is 15s, so we have headroom but no need for the full 60s.

### Outbound SMS (sendSMS)

**Function:** `sendSMS` — v2 `https.onCall` Firebase callable.

**File layout:**
- `functions/src/sendSMS.ts` — the callable function (entry point + auth + safeguards).
- `functions/src/lib/twilioClient.ts` — provider helper that wraps Twilio's REST SDK.

**Auth check:** only owner/admin can call. Technicians can request via the in-app UI but the callable rejects with `permission-denied`.

**Safeguards (in order):**

1. **Twilio config present.** Refuse with `failed-precondition` code `'twilio_not_configured'` if `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, or `TWILIO_PHONE_NUMBER` env vars are missing. This is the graceful "Twilio not configured" failure mode that lets MSOS function without Twilio (per success criterion #12).
2. **Outbound SMS enabled.** Refuse with `failed-precondition` code `'outbound_sms_disabled'` if `settings.outboundSMSEnabled === false`.
3. **Recipient phone valid.** Refuse with `invalid-argument` if `normalizePhone(to).valid === false`.
4. **Message body non-empty + under length cap.** Refuse with `invalid-argument` if `message.trim().length === 0` or `> 1600` (Twilio SMS 10-segment cap).
5. **Rate limit.** Refuse with `resource-exhausted` if this business has sent > 30 outbound SMS in the last 60 seconds (anti-runaway-loop defense). Counter lives in `businesses/{bid}/_rateLimits/sendSMS` as a transactional sliding window.

**Behavior:**

```ts
export const sendSMS = onCall<{ businessId: string; to: string; message: string }>(
  {
    secrets: [TWILIO_ACCOUNT_SID_PARAM, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER_PARAM],
    maxInstances: 10,
    region: 'us-central1',
  },
  async (req) => {
    await assertOwnerOrAdmin(req.auth, req.data.businessId);
    await assertTwilioConfigured();           // safeguard 1
    await assertOutboundSMSEnabled(req.data.businessId); // safeguard 2
    const normalized = normalizePhone(req.data.to);
    if (!normalized.valid) throw new HttpsError('invalid-argument', 'bad phone');
    if (!req.data.message?.trim() || req.data.message.length > 1600)
      throw new HttpsError('invalid-argument', 'bad message');
    await assertRateLimit(req.data.businessId); // safeguard 5

    const sender = await resolveSender(req.data.businessId);
    const provider = getProvider('twilio');
    const result = await provider.sendSMS({
      businessId: req.data.businessId,
      to: normalized.e164,
      message: req.data.message,
      actorUid: req.auth!.uid,
    });

    if (result.kind !== 'ok') {
      throw new HttpsError('internal', result.kind === 'disabled' ? result.reason : result.reason);
    }

    // Log every send to communicationEvents.
    await db.collection(`businesses/${req.data.businessId}/communicationEvents`).add({
      type: 'outgoing_sms',
      direction: 'outbound',
      provider: 'twilio',
      providerEventId: result.providerEventId,
      customerPhoneE164: normalized.e164,
      customerPhoneKey: normalized.digits,
      businessPhoneE164: sender,
      body: req.data.message,
      messageStatus: result.status,
      actorUid: req.auth!.uid,
      occurredAt: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
      payloadSnapshot: { From: sender, To: normalized.e164, MessageSid: result.providerEventId },
    });

    return { messageSid: result.providerEventId, status: result.status };
  }
);
```

**Future (SP7):**
- Per-business default templates (operator picks a saved snippet).
- Bulk-send (operator picks a customer-list filter and sends one message to all).
- Scheduled sends (operator drafts a message and picks "Send at 9am tomorrow").
- The `autoTextRules` engine consumes `sendSMS` programmatically.

### Webhook tenant isolation invariants

These are HARD invariants. Any future contributor who breaks them creates a cross-tenant data leak.

1. **`businessId` MUST be derived solely from `twilioPhoneNumbers/{toE164}` (the dialed number's mapping doc).** It is NEVER taken from the webhook payload. A forged but HMAC-valid payload from a compromised Twilio account can only affect the tenant who owns the dialed number on our side.
2. **`toE164` MUST be extracted from the payload BEFORE the businessId resolution.** Order of operations:
   1. Outer handler reads `To` from `req.body`, normalizes via `normalizePhone()` — REJECT 400 if `valid === false`.
   2. Outer handler reads `twilioPhoneNumbers/{normalizedToE164}` — if missing OR `active === false`, returns **200 + TwiML accept** (so Twilio stops retrying) and writes NOTHING. This is a deliberate ghost-write prevention.
   3. Outer handler resolves `businessId = numberDoc.data().businessId`.
   4. Outer handler THEN delegates to `provider.handleIncomingCall(...)` with the resolved `businessId`.
3. **All customer / vehicle / job / lead lookups MUST be path-scoped to `businesses/{resolvedBusinessId}/...`.** Collection-group queries on `phoneKey` (or any field) are **EXPLICITLY FORBIDDEN** in the webhook handler. Code review for any future PR touching this file MUST reject collection-group queries.
4. **`toE164` normalization at write AND read.** `adminConnectTwilioNumber` MUST normalize its input via the same `normalizePhone()` helper and reject `valid === false`. Otherwise an operator typing `305-897-7030` into the admin form and Twilio sending `+13058977030` in the payload would produce two doc IDs that never match.
5. **Uniqueness / ownership on `twilioPhoneNumbers/{e164}`.** `adminConnectTwilioNumber` MUST refuse to overwrite an existing doc whose `businessId !== caller.businessId`. The refusal is hard: return an error to the caller with code `'phone_number_owned_by_other_business'` and write an audit entry to `twilioPhoneNumberOwnershipAudits/{ts}_{e164}`. An explicit `force: true` parameter, owner-only, plus a confirmation in the UI, is required to override — and any forced overwrite ALSO writes the audit entry.

### Customer resolution algorithm (inside the provider's `handleIncomingCall`)

```ts
// Inside providers/twilio.ts -> handleIncomingCall(params, signature, requestUrl)
// (Outer route already verified signature, idempotency, and TWILIO_WEBHOOK_ENABLED.)

const callSid = params.CallSid;
const toRaw = String(params.To ?? '');
const fromRaw = String(params.From ?? '');

// 1. Tenant resolution from To-number (HARD invariant — never from payload-supplied businessId).
const toNorm = normalizePhone(toRaw);
if (!toNorm.valid) return { kind: 'invalid_payload', reason: 'bad_to_number' };

const numberDoc = await db.doc(`twilioPhoneNumbers/${toNorm.e164}`).get();
if (!numberDoc.exists || numberDoc.data()?.active === false) {
  console.warn('twilioIncomingCall_unmapped_number', { toE164: toNorm.e164, callSid });
  return { kind: 'unmapped_business' };
}
const businessId = numberDoc.data()!.businessId as string;
const assignedToUid = numberDoc.data()?.defaultAssignedToUid ?? null;

// 2. Caller normalization.
const fromNorm = normalizePhone(fromRaw);

// 3. Invalid caller phone → unknown-caller doc, no phoneKey lookup.
const lookupStart = Date.now();
if (!fromNorm.valid) {
  await db.doc(`businesses/${businessId}/incomingCalls/${callSid}`).set({
    id: callSid, twilioCallSid: callSid, provider: 'twilio',
    direction: 'incoming', status: 'ringing',
    fromE164: '', fromDigits: '', toE164: toNorm.e164,
    customerId: null, customerName: null,
    customersSnapshot: [], additionalMatchesCount: 0,
    lastJobSummary: null, assignedToUid,
    lookupSkippedReason: 'invalid_phone',
    createdAt: FieldValue.serverTimestamp(),
    ringingExpiresAt: Timestamp.fromMillis(Date.now() + 60_000),
  });
  await writeLookupTelemetry(businessId, {
    triggeredBy: 'twilio_voice_webhook',
    providerEventId: callSid,
    rawFromPhone: fromRaw,
    normalizedPhoneKey: null, normalizedValid: false,
    customerIdMatched: null, matchCount: 0,
    latencyMs: Date.now() - lookupStart,
    outcome: 'invalid_phone',
  });
  return { kind: 'ok', incomingCallId: callSid };
}
const { e164, digits } = fromNorm;

// 4. Customer lookup — path-scoped, NEVER collection-group.
//    Implementation lives in lookupCustomerByPhone() at the customer layer.
const lookupResult = await lookupCustomerByPhone(businessId, digits);
const { customer, customerId, customers, hasMultiple } = lookupResult;

// 5. Build customersSnapshot for up to 3 matches; record overflow count.
//    Vehicle subset is EXPLICITLY PICKED — never spread the full doc.
//    v3: tire fields are top-level (no .tire sub-object).
const customersSnapshot = [];
const matchDocs = customers.slice(0, 3);
for (const cust of matchDocs) {
  const vSnap = await db.collection(
    `businesses/${businessId}/customers/${cust.id}/vehicles`
  ).orderBy('lastServicedAt', 'desc').limit(3).get();
  customersSnapshot.push({
    customerId: cust.id,
    name: cust.name ?? null,
    vehiclesSnapshot: vSnap.docs.map(d => {
      const v = d.data();
      return {
        year:          v.year          ?? null,
        make:          v.make          ?? null,
        model:         v.model         ?? null,
        trim:          v.trim          ?? null,
        color:         v.color         ?? null,
        licensePlate:  v.licensePlate  ?? null,
        tireSize:      v.tireSize      ?? null,   // v3: top-level
        tireBrand:     v.tireBrand     ?? null,   // v3: top-level
        lastServicedAt: v.lastServicedAt ?? null
      };
    })
  });
}
const additionalMatchesCount = Math.max(0, customers.length - 3);

// 6. Last job summary — for the PRIMARY (first) customer only.
//    Privacy: scope by assignedToUid when set; omit paymentStatus when null.
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
      paymentStatus: assignedToUid ? j.paymentStatus : null,
    };
  }
}

// 7. Write the incoming-call doc (popup pipeline source).
await db.doc(`businesses/${businessId}/incomingCalls/${callSid}`).set({
  id: callSid, twilioCallSid: callSid, provider: 'twilio',
  direction: 'incoming', status: 'ringing',
  fromE164: e164, fromDigits: digits, toE164: toNorm.e164,
  customerId, customerName: customer?.name ?? null,
  customersSnapshot, additionalMatchesCount,
  lastJobSummary, assignedToUid,
  createdAt: FieldValue.serverTimestamp(),
  ringingExpiresAt: Timestamp.fromMillis(Date.now() + 60_000),
  multipleMatches: hasMultiple,
});

// 8. Mirror to communicationEvents (customer timeline copy).
await db.collection(`businesses/${businessId}/communicationEvents`).add({
  type: 'incoming_call', direction: 'inbound', provider: 'twilio',
  providerEventId: callSid,
  customerId, customerPhoneE164: e164, customerPhoneKey: digits,
  businessPhoneE164: toNorm.e164,
  callStatus: 'ringing',
  occurredAt: FieldValue.serverTimestamp(),
  createdAt: FieldValue.serverTimestamp(),
  payloadSnapshot: { From: e164, To: toNorm.e164, CallSid: callSid, CallStatus: 'ringing' },
});

// 9. Telemetry.
await writeLookupTelemetry(businessId, {
  triggeredBy: 'twilio_voice_webhook',
  providerEventId: callSid,
  rawFromPhone: fromRaw,
  normalizedPhoneKey: digits, normalizedValid: true,
  customerIdMatched: customerId, matchCount: customers.length,
  latencyMs: Date.now() - lookupStart,
  outcome: customerId ? 'matched' : 'no_match',
});

return { kind: 'ok', incomingCallId: callSid };
```

**Multi-match render contract.** The `incomingCalls` schema replaces the singular `customerName` + `vehiclesSnapshot` with a `customersSnapshot: Array<{customerId, name, vehiclesSnapshot}>` (capped at 3) plus an `additionalMatchesCount: number` for the overflow. The primary customer (`customerId`, `customerName`) still appears as top-level convenience fields for the most common single-match case; on shared-phone cases the client renders the first entry of `customersSnapshot` as the hero, a secondary chip "Also: {name} (+N more)" using `customersSnapshot[1].name` and `additionalMatchesCount`, and a tap-to-disambiguate sheet that lets the operator pick which customer the call is for. The picked customerId is written back via the same Firestore rule that allows members to update `status`/`answeredByUid`/`callbackBookedJobId` — extend the rule's `affectedKeys()` allowlist to include `customerId`.

**New-caller variant.** When the lookup yields no match (`customerId === null` and `customers.length === 0`), the popup renders a **NEW CALLER** card showing the phone number and three buttons:

- **Create Customer** → opens CustomerProfile in new-customer mode pre-filled with `fromE164`.
- **Create Job** → opens AddJob with `customerPhone` pre-filled.
- **Text Back** → opens an inline send-SMS UI that (when `outboundSMSEnabled === true`) calls `sendSMS`; otherwise falls back to a `sms:` link. SP7 evolves this into a templated quick-reply.

The disambiguation sheet for shared-phone matches and the New Caller card are mutually exclusive UI paths driven by `customersSnapshot.length`.

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

- Webhook receipt → Firestore write: ~200-500ms (HMAC-SHA1 + 2 reads + 1 write on warm function; +500-1000ms cold start tolerated since Twilio's voice webhook fires concurrently with the actual phone ring)
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
- **`twilioPhoneNumbers/{e164}.defaultAssignedToUid`** is a per-line override: when set, only that user's foregrounded devices ring.
- **`incomingCalls.assignedToUid` is populated from `twilioPhoneNumbers.defaultAssignedToUid`.** v3 note: Twilio (unlike v2's Quo) does NOT surface a per-call routed-user concept, so v3 has no `twilioUserMapping` collection. Per-call routing is not available; only per-line targeting via `defaultAssignedToUid` is. When `defaultAssignedToUid` is null, the call rings "all members".
- The listener filter `assignedToUid == null || assignedToUid === uid` correctly delivers in all three modes without further code changes.
- Success criterion is precise: **every FOREGROUNDED MSOS device that the call is targeted at**. Backgrounded devices are SP5 (toast) and SP7 (FCM) concerns — not a v1 deliverable for SP6.

### Missed-call reconciliation — closes the "calls never vanish" promise

Three concrete mechanisms ensure missed calls never disappear:

1. **Reconciliation scheduled function (`reconcileTwilioCalls`)** runs every 5 minutes (`onSchedule('every 5 minutes')`). Reads each `twilioPhoneNumbers/{e164}` with `active === true`, calls Twilio's REST API `/2010-04-01/Accounts/{AccountSid}/Calls.json?To={e164}&StartTime>={lastSyncedAt}`, and creates/updates `incomingCalls/{CallSid}` docs for any call missing from Firestore. Same idempotency key (Twilio CallSid == doc id) prevents duplicates. Status determined from Twilio's `Status` field on the call resource. Persisted `twilioSyncCursors/{twilioPhoneNumberSid}.lastSyncedAt` cursor advances after each successful poll. Added to SP4 scope.
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

1. **Storage location.** `recordingUrl` (future, not enabled in v1) would point at Twilio's CDN (signed URL with Twilio-defined expiry). The recording itself would not be stored in Firestore or Cloud Storage — only the URL. Twilio's retention policy governs the recording itself; operators must align Twilio's retention settings with their published privacy policy.
2. **Transcripts in Firestore.** `transcript` (future) would be stored as plaintext on the `incomingCalls` doc. CMEK encryption is OUT OF SCOPE for v1. Accepted risk; documented.
3. **Access control in v1.** v1 does not enable recordings or transcripts. SP7 may introduce a `canViewRecordings` Permissions flag and gate these fields client-side at the same time as enabling Twilio's recording webhooks.
4. **Two-party-consent jurisdictions.** Recording calls without notification is illegal in California, Florida, Pennsylvania, and other two-party-consent states. The OPERATOR would be responsible for enabling Twilio's `<Record>` verb with the appropriate consent prompt or configuring recording with Twilio's compliance features. The spec does NOT generate the disclosure; it does NOT validate compliance; this is documented as the operator's regulatory obligation. SP4's Settings → Communications panel will surface a notice and link to Twilio's recording-compliance docs when recordings are eventually enabled.
5. **Cascade deletion.** Recording URLs and transcripts on `incomingCalls` are deleted alongside the call doc on business deletion (via `recursiveDelete(businessRef)`). The Twilio-hosted recording itself is NOT deleted by MSOS — Twilio's retention policy applies. The SP7.5 GDPR follow-up adds a Twilio REST API call to delete the recording in response to a per-customer erasure request.
6. **Logging hygiene.** `transcript` must NEVER appear in Cloud Logging (it is customer PII). Handler logic that processes transcripts MUST NOT log payload bodies at any level.

---

## AddJob Workflow Change

**v2 confirmed 8-step explicit order (from user answer #5 + new requirement F):**

The user confirmed the following top-down step order, replacing v1's looser "above the suggested-price tile" framing:

1. **Phone** — phone input (`MemoInput` with debounced lookup; mirrors P1-3 keystroke-storm fix). Phone is the primary identifier and the first thing the operator types.
2. **Lookup** — `<CustomerLookupCard />` renders inline once the phone normalizes to `valid: true`. On hit: Returning Customer card with Use Customer / Repeat Last Service buttons. On miss: "No match — continue as new" with phone preserved.
3. **Vehicle** — vehicle chips (when Returning Customer is matched, chips show known vehicles; tap a chip to set the active vehicle for this draft). For new customers, vehicle make/model/trim/color inputs.
4. **Quick Pricing** — suggested-price sticky tile + revenue charged input + miles to job. v2 keeps these together as a single conceptual block (matches the user's mental model: "what am I quoting").
5. **Service Type** — service picker (vertical-aware; reads from `verticalConfig.services`).
6. **Tire Size** — **tire-vertical only.** For non-tire verticals this step is REPLACED by the active vertical's domain field (e.g. mechanic vertical might show "Diagnostic Code"; detailing vertical might show "Package Tier"). The step slot persists; the content is vertical-dispatched via `resolveVertical()`.
7. **Location** — **v2 NEW:** `<AddressAutofillInput />` populates `addressLine`, `city`, `state`, `zipCode`. Confirmed by user answer #5. Replaces the previous "Customer card has City only" pattern. **v1 implementation contract (review-pass):** the component uses a bundled US ZIP → city/state JSON dataset (~200 KB gzipped, ~40k US ZIPs) shipped with the client. The operator types the 5-digit ZIP first; city + state autofill instantly from the table; the `addressLine` field is **free-text** (no street-level validation in v1). No external API call, no privacy concerns sending PII to a third party, zero round-trips. SP7 may swap in Google Places API to enable real street-address autocomplete — that's a deferred upgrade documented in Future-Ready Seams (requires `GOOGLE_PLACES_API_KEY` secret + privacy-policy disclosure to the operator's tenant since customer addresses would then be sent to Google).
8. **Notes** — free-text notes field. End of the standard AddJob flow. Vertical job-fields loop and Assigned-To picker render below this as before.

The "Returning Customer card sits above suggested-price tile" framing from v1 is replaced by the explicit 8-step ordering: **Phone is step 1, Lookup is step 2, Pricing is step 4**. This means the operator types phone → sees match → confirms vehicle → THEN sees pricing. The cognitive flow is "who is this person" before "what am I charging them."

**Vertical dispatch on step 6 (Tire Size).** For tire-vertical tenants, the step renders the existing tire-size input. For other verticals, the step renders the vertical's primary domain input (defined in `verticalConfig.primaryDomainField`). For verticals that have no domain-specific field, the step is omitted entirely.

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
|  Last service: {label} · ${rev} · {paymentStatus}|
|                                                 |
|  [Use Customer]  [Repeat Last Service]  [×]     |
+-------------------------------------------------+
```

*(Mock is vertical-agnostic — `{label}` is resolved via `verticalConfig.services[lastJobSummary.service].label` at render time. For a tire-vertical tenant this might display "Tire Replacement"; for a mechanic tenant "Brake Service"; for detailing "Full Detail".)*

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

**Quick Notes auto-render (v3.2 — refinement #2 cross-reference):** when **Use Customer** OR **Repeat Last Service** fires, AddJob ALSO surfaces the customer's *Quick Notes* (see *Customer Quick Notes (v3.2 user-confirmed)*) as a non-dismissable info card pinned to the **top of the job notes section**. The technician sees `Gate code: 4421` / `Wheel lock key in glovebox` / `SMS preferred` / etc. before they tap Save. The card reads the Quick Notes fields LIVE from the Customer doc (`gateCode`, `apartmentNumber`, `wheelLockKeyLocation`, `tpmsNotes`, `preferredPaymentMethod`, `parkingInstructions`, `preferredContactMethod`, `generalNotes`) — none are copied into the Job document on save. If all 8 fields are unset, no card renders.

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
// v2: gate the entire upsert path on the autoSaveCustomersFromJobs setting.
const autoSave = settingsCtx?.autoSaveCustomersFromJobs ?? true;

if (autoSave) {
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
} else {
  // Auto-save toggle OFF: the operator manages Customer entries manually.
  // The job still saves; it just has no customerId/vehicleId/phoneKey.
  // Toast is one-time-per-session so the operator who intentionally disabled
  // the toggle isn't nag-spammed every save. The post-save success surface
  // additionally shows a "Save this customer to your directory? [Save] [Skip]"
  // row when there was NO existing Customer match — see "Manual customer
  // creation path" under Auto-Save Customers Setting.
  if (!sessionStorage.getItem('autoSaveOffToastShown')) {
    addToast('Customer not auto-saved (toggle OFF) — Manage manually from Customers tab', 'info');
    sessionStorage.setItem('autoSaveOffToastShown', '1');
  }
}

await fbSetFast(jobsCol, finalJob.id, finalJob);
```

The try/catch enforces the contract: **the Job write is authoritative; the Customer upsert is best-effort.** If Firestore rejects the customer upsert (e.g. transient permissions issue), the job still saves with `customerId === undefined` and falls back to the derived path on read. The `if (phone.valid)` guard mirrors the `normalizePhone` contract above — invalid inputs never produce a `phoneKey`.

**v2 auto-save setting integration:** `settingsCtx.autoSaveCustomersFromJobs` is read once at App.tsx mount via the existing Settings listener (`businesses/{bid}/settings` onSnapshot). The value is cached in a React context so saveJob does not re-fetch on every save. Toggling the setting in the UI updates the context within ~200ms (Firestore propagation + state set). When OFF: CustomerLookupCard in AddJob still surfaces matches from existing Customer docs (read-only behavior); "Use Customer" continues to autofill the draft; the job save just does not write back to the directory. The toast on save makes the behavior visible so the operator never wonders why their directory isn't growing.

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
11. **Tire dual-write (SP1 → SP3 transition window — v2 review-pass).** For tire-vertical writes, the transaction MUST write tire data to BOTH `vehicle.tire.size` AND the legacy `vehicle.tireSize` root field (same for `brand`, `condition`). This guarantees global search in SP3 (which queries `vehicle.tire.size`) and legacy-branch reads can co-exist while the SP3 backfill catches up on historic docs. The dual-write is retired in SP4 once the backfill audit doc records `tireFieldsHoisted >= legacy-count`.

**Client-write field types:** Firestore client writes go through `fbSetFast` (`src/lib/firebase.ts:209-223`), which JSON-stringifies object values and would corrupt `FieldValue.serverTimestamp()` / `FieldValue.increment()` / `Timestamp` instances. Therefore:

- **From the client (`upsertCustomerFromJob` running in saveJob):** use `runTransaction` directly with the unmodified Firestore SDK — bypass `fbSetFast`. Inside the transaction, `FieldValue.increment(1)` / `FieldValue.arrayUnion(jobId)` are written as-is on `tx.update(...)`. For timestamp-type fields written from the client, store ISO strings (`new Date().toISOString()`) and let the Cloud Function path use real `Timestamp` / `serverTimestamp()`. The schema-table columns marked `Timestamp` accept either form on read (a string parses to a Date; a Timestamp `.toDate()`s); document this dual-form explicitly in the `Customer` TypeScript interface so future contributors don't get caught.
- **From the Cloud Function (`twilioIncomingCall`, `twilioIncomingSMS`, `twilioCallStatus`, `sendSMS`, `adminConnectTwilioNumber`, future SP7 background jobs):** use admin SDK directly with `FieldValue.serverTimestamp()` and real `Timestamp` — admin SDK bypasses `fbSetFast` entirely.

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
| 2 | **Repeat Last Service** | **v3.2 emphasis (refinement #3):** clones the customer's MOST RECENT COMPLETED job into a new AddJob draft. **Field-clone list:** `service` (service type), `vehicleType` / `vehicleMakeModel` / `vehicleSize` / `tireSize` / `tireBrand` (vehicle + tire identity), `customerId` / `customerName` / `customerPhone` / `customerEmail` (customer), `city` / `state` / `addressLine` / `zipCode` (location), `source` (lead source), `payment` (method). **Price stays editable.** `revenue` / `tireCost` / `materialCost` are NOT cloned — the operator may need to adjust for current conditions (tire prices fluctuate, services may scope differently). This button's behavior is **identical to** the Returning Customer card's "Repeat Last Service" CTA defined in *AddJob Workflow Change → Returning Customer card spec*; both surfaces wire to the same shared helper (`cloneLastCompletedJobIntoDraft(customerId)`). The CustomerProfile surface widens the operator's reach: the same one-tap clone is available from the profile page (drilling in from search results or the Customer Hub) without going through AddJob's Lookup step first. | New wiring, shared helper with AddJob CTA | No |
| 3 | **Call** | **v1 always uses `tel:` native scheme.** `<a href={`tel:${customer.phoneE164}`}>`. Free, instant. Logs `lastContactedAt = now` on the customer doc via merge write. SP7 may add an "Answer in MSOS" capability via Twilio Programmable Voice client SDK (deferred). UI is identical; only the dispatch path would change. | New | No |
| 4 | **Text** | **v3 default uses Twilio `sendSMS`** when `settings.twilioConnected && settings.outboundSMSEnabled`. Opens an inline SMS composer (single message); on Send calls the `sendSMS` callable, logs to `communicationEvents`, updates `lastContactedAt`. **Fallback:** native `sms:` scheme when Twilio is not configured or `sendSMS` returns `'disabled'`. Resolves user answer #6 (v3 variant). | New | No |
| 5 | **Send Quote** | Opens existing QuoteWorkflow (separate spec, [2026-05-22-quote-workflow-design.md](2026-05-22-quote-workflow-design.md)) preloaded with customer + most-recent vehicle. | Existing dispatch, new entry point | No |
| 6 | **Send Invoice** | Resolves to last unpaid job for this customer; if found, opens the existing invoice send flow (reuses the path triggered from JobDetailModal). If no unpaid jobs, shows toast "No unpaid jobs for this customer." | Existing dispatch | No |
| 7 | **Send Review** | Reuses existing ReviewAutomation send path ([2026-05-22-review-automation-design.md](2026-05-22-review-automation-design.md)), targets `customer.email` (falls back to phone). | Existing dispatch | No |
| 8 | **Edit** | Inline editing of name / email / address / tags / notes within the profile (no separate modal). Gated by `canEditBusinessSettings` for notes/tags (existing `canEditNote` pattern at [Customers.tsx](../../../src/pages/Customers.tsx)), `canEditJobs` for identity fields (techs can update name typos but not delete the customer). | New UI, existing permission gates | No |
| 9 | **Delete** | Owner/admin only. Confirms with "This will hide the customer but keep all jobs intact. Continue?" Soft-delete via `customer.deletedAt = now`. Read paths filter `deletedAt == null`. Jobs retain `customerId` for audit. | New | No |

All 9 buttons are part of SP3. None require further design after this spec.

---

## Customer Profile Sections (v3.2 user-confirmed)

The Customer Profile page is a vertically scrolling stack of sections. v3.2 locks the section order and adds the v3.2-introduced **Quick Notes** and **Service History Photos** sections so future contributors do not have to re-derive placement.

### Canonical section order (top-to-bottom)

1. **Header** — name, kind badge (`fleet` if `kind === 'fleet'`), VIP tier badge, customerStatus badge, formatted phone, repeat-customer badge, tags (chips).
2. **Quick Actions row** — the 9 buttons from *Customer Profile Actions*.
3. **Customer Insights card** — the 9 metrics from *Customer Insights Card (Phase 9)*.
4. **Vehicles** — chip list of all vehicles in the subcollection, tap to filter the timeline.
5. **Quick Notes** — **v3.2 NEW (refinement #2).** The 8 structured note fields rendered as a labeled list (gate code, apt #, wheel-lock key location, TPMS, payment, parking, contact preference, general). Inline-editable by owner/admin. Placement sits **between Vehicles and Service History** so technicians who drill into a profile mid-job have the Quick Notes visible without scrolling past timeline cards. When all 8 fields are unset, the section renders an empty-state stub with an "Add Quick Notes" CTA for owner/admin and a hidden block for technicians (no point cluttering the tech view).
6. **Service History (timeline)** — the chronological JobList. Newest first. Each row: service type, date, location, price (gated by `canViewFinancials`), vehicle (year + make + model), technician. Tap a row to open `JobDetailModal`. Reaffirmed by refinement #8.
7. **Service History Photos** — **v3.2 NEW (refinement #7).** See sub-section below.
8. **Notes** — the existing free-text `note` field from CustomerMeta. Editable by owner/admin.
9. **Communication log** (when SP4 lands) — chronological feed of `communicationEvents` for this customer (calls, texts). Hidden when SP4 is dormant.

### Service History Photos (v3.2 user-confirmed — refinement #7)

**Goal:** the operator should be able to see "last tire repair photos" or "all detailing photos" for a customer **without opening individual old jobs**. Today, photos live on the `Job` entity (per existing MSOS — `Job.photos` is an array of photo URLs / metadata). v3.2 surfaces them in aggregate on the CustomerProfile.

**Implementation contract (SP3 — pure rendering, no storage changes):**

- **No new storage.** Photo URLs already exist on Job docs. The CustomerProfile does NOT duplicate, re-upload, or re-index photos. This refinement is **rendering-only**.
- **Aggregation source.** CustomerProfile already loads the bounded timeline of the customer's recent jobs (limit 100, per *Insights jobs-load bound*). The Photos section reuses that same job array — no second query — by flattening `jobs.flatMap(j => (j.photos || []).map(p => ({ jobId: j.id, service: j.service, date: j.date, photoUrl: p })))`. Implementation MAY swap to a Firestore collection-group query against a hypothetical `businesses/{bid}/jobs/{jobId}/photos/*` subcollection if photos ever migrate to a subcollection, but per existing MSOS they are flat on the Job doc.
- **Grouping.** The aggregated photo array is grouped by **service type** (from `verticalConfig.services[j.service].label`): "Tire Repair photos", "Replacement photos", "Detailing photos", etc. Within each group, photos sort newest-first.
- **Bounded window.** Same 100-job window as the Insights jobs-load bound — this avoids surprise scans for long-history customers and keeps the section render fast. For customers with more than 100 jobs, the section displays a **"See full history"** affordance that paginates further pages of 100 jobs and re-aggregates their photos (the same pagination control already specified for the Insights metrics).
- **Tap-through.** Tapping any photo opens the **original job's `JobDetailModal`** (existing modal, no new component) scrolled to its Photos sub-section. The Customer Profile photos section is purely a discovery surface; full per-job context is one tap away.
- **RBAC.** Photos render to all roles — the existing `scopeJobsByRole` gating on the timeline already filters technicians to their own jobs, and the photos derive from that same filtered job array. Owners and admins see every job's photos; technicians see only their own.
- **Empty state.** When the customer has zero photos in the bounded window, the section renders an unobtrusive "No service photos yet" stub instead of hiding entirely — keeps the profile's vertical rhythm consistent.

**SP1 storage impact: NONE.** Per refinement #7's "No SP1 storage changes — pure aggregation" instruction, SP1 does not need to touch the Job photos schema. The aggregation lands in SP3 alongside CustomerProfile.

**SP3 component:** `src/components/customerProfile/ServiceHistoryPhotos.tsx`. Reads the jobs array already loaded by CustomerProfile (no prop drilling beyond what's already there). Renders a vertically-stacked accordion of service-type groups; each group is a horizontally scrolling thumbnail strip. Tap → existing JobDetailModal.

---

## Global Customer Search (Phase 5)

**Goal:** universal search accessible from main navigation. Operator types one query, sees every matching customer across name, company, phone, vehicle, license plate, tire size, city, or zip — sub-300ms on Wheel Rush-scale data.

### Entry surface

- Persistent search icon in the main nav (mobile-first, prominent — sits next to MoreSheet).
- Tap opens `<GlobalSearchSheet />` as a bottom-sheet modal (`.modal-overlay` + `useFocusTrap` + `role='search'`).
- Single text input using the `MemoInput` pattern with a `useCallback`-wrapped `onChange` and **200ms debounce** (same keystroke-storm fix as P1-3).
- Voice input is OUT OF SCOPE for v1.

### Search algorithm

```ts
// src/lib/searchCustomers.ts
export async function searchCustomers(
  businessId: string,
  query: string,
  opts: { scopedCustomerIds?: Set<string>; limitPerField?: number } = {}
): Promise<{ customer: Customer; matchedVehicles: Vehicle[]; matchedField: string }[]>
```

### Scale tiers (v2 — review-pass fix)

Global search routes through one of four scale tiers based on the tenant's persisted customer count (cached at App.tsx mount from the same `customers` listener used by the Customers page):

| Tier | Customer count | Strategy | Notes |
|---|---|---|---|
| **T0** | `< 1,000` | Client-side filter over the already-hydrated `customers` collection (today's pattern). | Triggers ONLY after the Customers-page `customers` onSnapshot listener has hydrated the cache. Before hydration completes (cold deep-link into search), the path falls through to T1. Implementation contract: `searchCustomers` reads the hydrated count from a `customersHydrated` boolean kept on the React context; never re-loads the full collection just to decide which tier to use. |
| **T1** | `1,000 – 10,000` | Server-side composite-index parallel queries (the 9-branch fan-out below). | The headline v1 path. |
| **T2** | `10,000 – 50,000` | Same fan-out as T1 BUT with cursor pagination on the merged result set and a hard cap of 200 total returned rows before client-side ranking. | Operator sees a "Showing top 200 — refine your query" tail. |
| **T3** | `> 50,000` | Migrate to Algolia or Meilisearch via a Firestore extension. | **Migration trigger:** p95 query latency `> 500ms` over a rolling 24h window OR customer count crosses 25,000 → ops files an SP7.x ticket. Not a v1 deliverable. |

The T0 / T1 boundary is checked from a `customerCount` rollup persisted on `businesses/{bid}/settings` (incremented by `upsertCustomerFromJob` on first-create, decremented on soft-delete) — NOT from a `customers.length` check on the client, which would require the full collection to already be loaded.

### Algorithm (T1 / T2 server-side path)

1. Normalize the query: `q = query.trim().toLowerCase()`; also compute `qDigits = query.replace(/\D/g, '')` for phone matching. **Short-circuit:** if `q.length < 2` AND `qDigits.length < 2`, return `[]` immediately — single-letter prefixes would hit Firestore with hundreds of rows per branch.
2. Define the prefix high-sentinel: `qHigh = q + ''` (the Firestore-canonical end-of-prefix marker — `` is in the Unicode Private Use Area, after every standard character). For the digit-only `phoneKey` index where values are pure `[0-9]`, use `qDigits + ':'` (the next ASCII code point after `'9'`, giving a tight index scan).
3. **Parallel fetch via `Promise.all`** across 9 field branches (each `limit(20)`):
   - `customers where nameLower >= q AND nameLower < qHigh` (prefix)
   - `customers where companyLower >= q AND companyLower < qHigh` (prefix)
   - `customers where phoneKey == qDigits` (exact)
   - `customers where phoneKey >= qDigits AND phoneKey < qDigits + ':'` (suffix-of-last-4 via `phoneKeySuffix4` index — added if user supplies exactly 4 digits)
   - `customers where cityLower >= q AND cityLower < qHigh` (prefix)
   - `customers where zipCode == query` (exact)
   - Collection-group on `vehicles`:
     - `vehicles where makeModelLower >= q AND makeModelLower < qHigh` (prefix)
     - `vehicles where licensePlate == query.toUpperCase()` (exact)
     - `vehicles where tire.size == query` (exact)
     - **Dual-read transition window (SP3 → SP4):** ALSO query `vehicles where tireSize == query` (legacy root-level field) and merge into results. Removes once SP3 backfill audit-doc confirms all legacy docs have been hoisted. See Backfill — *Dual-write transition window for tire fields*.
4. **Client-side merge** by `customerId`; deduplicate; rank by field-priority (exact phone > exact plate > exact zip > name prefix > company prefix > city prefix > vehicle prefix).
5. **RBAC filter:** if the current user is a technician, post-fetch filter results by `customerId IN scopedCustomerIds` (derived from `scopeJobsByRole`-filtered jobs).
6. **Cache:** in-memory `Map<string, Result[]>` keyed on the normalized query; 60s TTL; cache invalidated on any Customer/Vehicle write via the existing onSnapshot listeners.

**Critical prefix-query contract.** The high-sentinel `` MUST be explicit in every prefix branch — a missing/empty upper bound (`q + ''`) reduces to `[q, q)` which is an empty range and returns ZERO rows. The `` constant is the canonical idiom from Firestore docs; equivalent forms (`String.fromCharCode(0xf8ff)`) are interchangeable. The phoneKey suffix branch uses `':'` instead because phoneKeys are guaranteed pure digits and `':'` is the next ASCII code point above `'9'`, giving a tighter index scan than `` would. **Acceptance test (regression gate):** searching `te` MUST return customers with names starting `Te...` (Tesla, Tetris, Terra). This unit test ships with the `searchCustomers.ts` helper as the canonical regression test for the prefix-query bug and MUST pass before SP3 merges to main.

**Mobile keyboard friction.** The `GlobalSearchSheet` input MUST set `inputmode='search'`, `autocapitalize='off'`, `autocorrect='off'`, `spellcheck='false'` so operators can type tire sizes like `215/55R17` and license plates without iOS auto-correct sabotaging the query.

**Ranking acceptance tests.** The field-priority order is hand-coded and ships with three deterministic regression tests in `searchCustomers.test.ts`:

| Query | Expected top-3 ordering | Why |
|---|---|---|
| `3058977030` (exact 10-digit phone) | (1) Maria Lopez `+13058977030` (exact phone hit) → (2) any name-prefix match for `'305...'` if present → (3) any other branch | exact-phone beats every prefix branch. |
| `7030` (last 4) | (1) Maria Lopez (`phoneKeySuffix4 == '7030'`) → (2) other suffix-4 hits → (3) name-prefix matches | suffix-4 ranks above name-prefix when query is exactly 4 digits. |
| `te` (2-letter prefix) | (1) Customers with names starting `Te...` (Tesla, Terra) → (2) companies starting `Te...` → (3) cities starting `Te...` | name-prefix beats company-prefix beats city-prefix; tire/vehicle prefix lower still. Critical regression test for the prefix-query high-sentinel bug. |

### Result panel

Grouped by Customer. Each customer row shows:
- Name (with bolded substring match)
- Company name (if matched)
- Formatted phone
- City + state
- VIP tier badge if non-Standard
- Nested vehicle sub-rows for any matched vehicles (shows make/model/trim, plate, tire size)
- Tap → CustomerProfile (deep link via existing routing)

States:
- **Empty (query.length === 0):** prompt copy "Search by name, phone, company, vehicle, plate, tire size, city, or zip".
- **Loading:** 3-row skeleton.
- **No match:** "No customers match '\{query\}' — try a phone number or vehicle plate."

### Performance contract

- **Target:** p95 < 300ms on Wheel Rush dataset (~2k customers, ~3k vehicles).
- **Mechanisms:** composite indexes per field branch + parallel `Promise.all` + `limit(20)` per branch + in-memory result cache.
- **Network budget:** 7 parallel reads × ~50ms each on warm Firestore ≈ ~70ms wall-clock; merge + filter ≈ 30ms; total ≈ ~150ms typical, ~280ms p95.
- **Cold start:** first search after app boot is ~100ms slower; cache warmup hides subsequent typing.

### Required Firestore indexes (new)

- `customers (nameLower ASC)`
- `customers (companyLower ASC)`
- `customers (cityLower ASC)`
- `customers (zipCode ASC)`
- `vehicles (makeModelLower ASC)` — **collection group**
- `vehicles (licensePlate ASC)` — **collection group**
- `vehicles (tire.size ASC)` — **collection group**

All collection-group indexes require deploy via `firebase deploy --only firestore:indexes` with explicit collection-group declarations in `firestore.indexes.json`.

### v1 fuzzy-search posture

v1 does substring / prefix matching only. No typo tolerance. No semantic search. Algolia / Meilisearch integration is deferred to SP7 if Wheel Rush feedback indicates real demand. The 200ms debounce + prefix queries match user mental model ("I type three letters of 'Tesla' and see Teslas") without the infra cost.

### Lands in SP3

The component, helper, indexes, and main-nav entry all land alongside CustomerProfile in SP3. No separate sub-project.

---

## Customer Insights Card (Phase 9)

**Goal:** at-a-glance customer value summary on CustomerProfile. Replaces the v1 "Lifetime Revenue stat" with a structured 9-metric card and a derived VIP Tier badge.

### Card placement & visibility

- Renders at the bottom of CustomerProfile's Overview section, above the Quick Actions row.
- Financial metrics (Lifetime Revenue, Total Jobs counted-against-revenue, Average Ticket) gated by `permissions.canViewFinancials`.
- Non-financial metrics (vehicles, service types, last service, vehicle make/model) shown to all roles.
- VIP Tier badge: shown to all roles (operational signal, not a financial figure).

### The 9 metrics

| # | Metric | Source / derivation | Gated? |
|---|---|---|---|
| 1 | **Lifetime Revenue** | `sum(scopedJobs.revenue)` — uses existing `scopeJobsByRole` so techs see only their own | `canViewFinancials` |
| 2 | **Total Jobs** | `scopedJobs.length` | always |
| 3 | **Average Ticket** | `lifetimeRevenue / totalJobs` — computed live AND persisted on Customer doc as `averageTicket` for list-sort | `canViewFinancials` |
| 4 | **Last Service Date** | `Customer.lastJobAt` | always |
| 5 | **Most Common Vehicle** | `mode(jobs map { year + ' ' + make + ' ' + model })` | always |
| 6 | **Most Common Tire Size** | **tire-vertical only**; `mode(jobs.tireSize)` | always (when tire vertical) |
| 7 | **Most Common Service Type** | `mode(jobs.service)` mapped through `verticalConfig.services[id].label` for display | always |
| 8 | **Referral Count** | `Customer.referralCount` (defaults to 0); **schema-only in v1** — no UI surfaces it as editable | always (read-only) |
| 9 | **VIP Tier** | `deriveVipTier(lifetimeRevenue)` — badge rendered prominently | always |

### VIP tier derivation

```ts
// src/lib/customerInsights.ts
export type VipTier = 'Standard' | 'Gold' | 'Platinum';

export function deriveVipTier(lifetimeRevenue: number): VipTier {
  if (lifetimeRevenue >= 2500) return 'Platinum';
  if (lifetimeRevenue >= 1000) return 'Gold';
  return 'Standard';
}
```

**Thresholds confirmed by user:** Gold at $1,000+, Platinum at $2,500+. These are mode-aware of Wheel Rush's current Average Ticket (~$400-600) — a Gold customer is roughly 2-3 services in, a Platinum is roughly 5+. Future tenants in higher-AOV verticals (e.g. mechanic engine work) may want a per-business override; **deferred to SP7** as a Settings field `vipThresholds: { gold: number; platinum: number }`.

### customerStatus derivation

`customerStatus` is the OPERATIONAL state — independent of `vipTier`. The two values render as separate side-by-side badges on CustomerProfile.

```ts
export type CustomerStatus = 'Active' | 'Inactive' | 'Fleet' | 'Archived';

export function deriveCustomerStatus(args: {
  lastJobAt: Date | null;
  companyName?: string;
  manualOverride?: CustomerStatus;
  activeWindowMs?: number;  // default 365d; overridable via settings.activeWindowMonths
}): CustomerStatus {
  if (args.manualOverride) return args.manualOverride;
  if (args.companyName) return 'Fleet';
  const windowMs = args.activeWindowMs ?? 365 * 24 * 60 * 60 * 1000;
  if (args.lastJobAt && Date.now() - args.lastJobAt.getTime() < windowMs) return 'Active';
  return 'Inactive';
}
```

**Key changes from v1 review:**
- `'VIP'` REMOVED from the enum. VIP-ness is a revenue tier, not an operational state. A Gold Fleet customer is `(Fleet, Gold)`, displayed as two badges; a Platinum Active customer is `(Active, Platinum)`.
- `'Archived'` ADDED as a manual-only override for customers the operator wants hidden from default lists without soft-deleting. Read paths filter `customerStatus != 'Archived'` by default.
- `activeWindowMs` is parameterized. Different verticals have different repeat cycles (tire rotation ~6mo, oil change ~3mo, detailing ~1mo). v1 hardcodes 12 months for Wheel Rush; SP7 adds `settings.activeWindowMonths` per-business override (same SP7 ticket as the VIP-threshold override).

Owners/admins can override status manually via CustomerProfile edit (`manualOverride` field on the Customer doc).

### Insights jobs-load bound (v2 — review-pass)

The CustomerProfile MUST bound its jobs query to **the most recent 100 jobs per customer** (`orderBy('date', 'desc'), limit(100)`). The 6 "computed live" metrics (Most Common Vehicle, Most Common Tire Size, Most Common Service Type, etc.) run `mode()` over the returned array — bounding the input to the recent 100 jobs is both an operationally-meaningful improvement (a customer who switched cars five years ago shouldn't show their old vehicle as "most common") and a hard cap on the worst-case `mode()` cost for long-tail customers with 500+ lifetime jobs.

For customers with more than 100 lifetime jobs, the timeline section displays a **"See full history"** affordance that paginates further pages of 100 jobs each. The "computed live" insights metrics are NOT recomputed across pagination — they remain bound to the most recent 100 by spec.

Lifetime totals (`lifetimeRevenue`, `jobCount`, `lastJobAt`) are NOT bound by the 100-job window — they're computed by the `onJobWriteCustomerRollup` trigger over the FULL job history (admin SDK, no scoping). Only client-side `mode()`-style "Most Common X" metrics use the bounded window.

**Performance contract update:** p95 < 200ms on profile open for customers with up to 500 lifetime jobs (jobs query is `limit(100)`; only 100 docs travel over the wire regardless of history depth).

### Rollup persistence (recommendation: persist averageTicket + vipTier + customerStatus)

**Recommended approach:** persist `averageTicket`, `vipTier`, `customerStatus` on the Customer doc via a Cloud Function trigger (`onJobWriteCustomerRollup`). Compute on-the-fly for the remaining 6 metrics from the bounded (recent-100) jobs query.

**Rationale:**
- `averageTicket` + `vipTier` are the only metrics that need to be SORTABLE / FILTERABLE on the Customers list page. Persisting them enables index-backed queries like `customers where vipTier == 'Platinum' orderBy averageTicket desc`.
- `customerStatus` is similarly used for list filtering.
- The other 6 metrics are derived purely from the jobs list, which is already loaded for the timeline render — no incremental cost.
- A Cloud Function trigger is preferred over client-side recomputation because techs only see their own jobs (rollups would skew per-viewer), but the rollup must reflect the OWNER's view of revenue.

**Trigger spec:** `onJobWriteCustomerRollup` listens to `businesses/{bid}/jobs/{jobId}` create/update/delete. When `job.customerId` is set, it loads ALL jobs for that customerId (admin SDK bypasses scoping), computes `lifetimeRevenue` + `jobCount` **in memory**, derives `averageTicket = lifetimeRevenue / jobCount`, calls `deriveVipTier(lifetimeRevenue)` + `deriveCustomerStatus(...)`, and writes back ONLY `{ jobCount, averageTicket, vipTier, customerStatus, lastJobAt, lastJobId }` to the Customer doc. Debounced via a 30s coalescing window per `customerId` to avoid write storms when batches of jobs are imported. Skips when the source Job carries `metadata.backfillRun` (see Backfill — *Idempotency*).

**Critical privacy contract: `lifetimeRevenue` MUST NOT be persisted on the Customer doc.** It is computed in-memory inside the trigger solely to derive `averageTicket` and `vipTier`. Persisting `lifetimeRevenue` would leak owner-aggregated revenue to technicians who can read the customer doc (the Firestore rule `allow read: if isMemberOfBusiness(bid)` is intentionally broad to keep the cross-role hybrid read path simple). The same rule applies to `lifetimeProfit` and `expensesTotal` if a future trigger ever computes them. A Firestore-rule allowlist negative-check (rejecting writes that include any of these three field names) belongs in the SP3 rules delta, and an explicit code-review checklist item enforces it: *"PR must not add `lifetimeRevenue`, `lifetimeProfit`, or `expensesTotal` to any write path on the Customer doc."*

**Stale-rollup display contract.** The 30s coalescing window means `averageTicket` / `vipTier` on the Customer doc may be up to 30s older than `lastJobAt` after a fresh save. The CustomerProfile page MUST recompute these values client-side from the loaded jobs list (via the same `customerInsights.ts` helpers used by the trigger) when `(lastJobAt - updatedAt) > 30s` — this keeps the post-save UX consistent without coupling the page to the trigger's debounce. The Customers-page list (where index-backed sort/filter matters more than 30s staleness) reads the persisted rollup as-is.

**Progress-to-next-tier UX (v2 — review-pass).** A customer at $999 lifetime revenue would otherwise show a plain "Standard" badge with no signal that the next sale tiers them up. The CustomerInsightsCard renders a small subline under the VIP badge:

| Tier | Subline |
|---|---|
| Standard | `Gold tier in $XXX` where `XXX = 1000 - lifetimeRevenue` |
| Gold | `Platinum tier in $XXX` where `XXX = 2500 - lifetimeRevenue` |
| Platinum | `Top tier reached` (read-only) |

Computed live on the client from the same in-memory `lifetimeRevenue` used to render the current badge — no schema change, no trigger change, no additional Firestore read. This closes the retention-engineering UX gap raised in the v2 review pass.

**Legacy fallback:** for customers without persisted rollups (pre-trigger or pre-backfill), the card falls back to client-computed values from the loaded jobs list.

### Lands in SP3

CustomerInsightsCard component, customerInsights helper, onJobWriteCustomerRollup Cloud Function, VIP tier badge component — all in SP3 alongside CustomerProfile.

---

## Auto-Save Customers Setting (Phase 17)

**Goal:** operator-controlled toggle to disable the automatic Customer/Vehicle upsert in saveJob. Default ON. When OFF, the operator manages Customer entries manually (or via the search + manual-create UI in SP3).

### Schema

- Field: `businesses/{bid}/settings.autoSaveCustomersFromJobs: boolean`
- Default: `true` (preserves v1 behavior on upgrade)
- Field: `businesses/{bid}/settings.autoSaveDisabledAt: Timestamp?` — written every time the toggle transitions from `true` → `false`. Used by the OFF→ON banner (below) to scope the "orphan job" count.
- Rule: owner/admin only (existing Settings update rule covers it)

### Read-time default contract (v2 — review-pass)

All v2 Settings fields are OPTIONAL (`?:`) in the `Settings` TypeScript interface and MUST be read with a nullish-coalesce default at every read site. Existing Settings docs (Wheel Rush et al.) do NOT carry these fields and MUST behave as if they were set to their defaults:

```ts
const autoSave    = settings.autoSaveCustomersFromJobs ?? true;
const twilioConnected = settings.twilioConnected ?? false;
const provider    = settings.outboundCommunicationProvider ?? 'native';
```

No backfill of existing Settings docs is required — they read as their default until the owner first changes the value via the new Settings UI. A future contributor doing `settings = { ...settings, autoSaveCustomersFromJobs: false }` as a "safe default" would silently break every existing tenant, so the type signature MUST mark these fields optional and the saveJob/CustomerProfile snippets MUST always nullish-coalesce. SP1's PR adds a code-review checklist item enforcing this pattern.

### Placement

- New "Customer Directory" accordion section in Settings (between "Operations" and "Integrations").
- Toggle row label: **"Auto-save customers from completed jobs"**.
- Helper copy: *"When ON, every saved job upserts a Customer record (and a Vehicle if applicable). When OFF, jobs save without creating directory entries — useful if you prefer to manage your customer list manually."*
- Component: `CustomerDirectorySettingsSection.tsx` (gated by `canEditBusinessSettings`).

### saveJob integration

See *saveJob change* in the AddJob Workflow Change section above for the full code path. Summary:

- `App.tsx` reads `settings.autoSaveCustomersFromJobs` once at mount via the existing Settings listener and caches it in a React context (with nullish-coalesce default `true`).
- saveJob checks the context value before calling `upsertCustomerFromJob`. When OFF, the entire upsert path is skipped.
- The Job document still saves successfully; it just has no `customerId`, `vehicleId`, or `phoneKey`.

### UX when toggle is OFF

- CustomerLookupCard in AddJob still surfaces matches from existing Customer docs (read-only behavior).
- "Use Customer" continues to autofill the draft (operator convenience).
- On save, a one-time-per-session toast appears: *"Customer not auto-saved (toggle OFF)"* — makes the behavior visible without nag-spamming. The toast is dismissible-with-"don't show again-this-session" via a chip on the toast itself. Re-fires on the next session unless the operator toggles back ON.
- No orphaned data: Customer docs already created remain untouched; only NEW jobs do not contribute to the directory.

#### Manual customer creation path (v2 — review-pass)

When `autoSaveCustomersFromJobs` is OFF and the operator saves a job for a phone with **no existing Customer match** (the CustomerLookupCard had no hit), the post-save success surface displays a single confirmation row:

```
+--------------------------------------------------+
| Save this customer to your directory?            |
| [ Save customer ]    [ Skip ]                    |
+--------------------------------------------------+
```

- **Save customer** invokes `upsertCustomerFromJob(businessId, finalJob)` synchronously (the exact same transactional helper saveJob would have called) and then writes back `customerId` / `vehicleId` / `phoneKey` to the just-saved Job doc via `fbSetFast` merge update.
- **Skip** dismisses the row. No further action.
- The row is rendered ONCE per AddJob session — closing AddJob without picking either button is treated as Skip.

The same affordance lands on the Customers page as a permanent **"+ New Customer"** button (gated by `canCreateJobs`) that opens an empty CustomerProfile edit form. Customer docs no longer require originating from a job; with auto-save OFF, the operator's directory IS the manual-creation path.

### OFF→ON transition behavior (v2 — review-pass)

Flipping the toggle from OFF → ON does NOT retroactively upsert prior toggle-OFF jobs. Instead:

1. When the toggle transitions `true` → `false`, the Settings doc records `autoSaveDisabledAt: serverTimestamp()`. When the toggle transitions `false` → `true`, `autoSaveDisabledAt` is left in place (used to scope the banner below) and a `autoSaveReEnabledAt: serverTimestamp()` field is also written.
2. When the Customer Directory Settings panel is rendered AND `autoSaveCustomersFromJobs === true` AND `autoSaveDisabledAt` exists AND no completed backfill audit doc references the post-disable window, the panel shows a banner:
   > *"You have N jobs saved while auto-save was off. Run Backfill to add them to your directory."*
   The `N` is computed via `count(jobs where customerId == null AND date > autoSaveDisabledAt)`.
3. Clicking the banner CTA re-uses the existing `backfillCustomers` Cloud Function — it is already idempotent via `processedJobIds` and skips jobs already in the directory. The same audit-doc + dry-run surface applies.
4. The banner auto-dismisses when the next backfill audit doc shows `jobsUpdated >= N` for the window. The operator may also dismiss it manually (writes a `autoSaveOrphanBannerDismissedAt` Settings field); dismissal is per-banner-instance, not permanent.

This makes the toggle-OFF → toggle-ON cycle operationally complete without `saveJob` ever retroactively writing — the retro-pull is always an explicit operator action via the existing Backfill primitive.

### Migration

Existing Wheel Rush tenants default to `autoSaveCustomersFromJobs: true` (via the nullish-coalesce read contract above — no doc write required). No admin action required for upgrade. The toggle is opt-out for operators who want manual control.

### Lands in SP1 + SP3

- **SP1:** schema field added + saveJob gate reads the setting. No UI yet.
- **SP3:** toggle UI added to Settings → Customer Directory section, alongside the Backfill button.

---

## Communications Settings (v3 NEW)

**Goal:** operator-visible Settings accordion that surfaces every Twilio-related toggle and the connect form. Replaces v2's "Settings → Integrations → Connect OpenPhone" surface.

### Placement

- New top-level Settings accordion labeled **"Communications"** — sits between "Customer Directory" and the existing "Integrations" accordion.
- Gated by `canEditBusinessSettings` for edit; read-visible to all members.

### Section contents

1. **Communication Provider — Twilio** (read-only label). Future-ready for provider switching; v1 has no other providers.
2. **Twilio connected status** (read-only). Derived display value: "Connected" when `settings.twilioConnected === true` AND a successful webhook has been observed in the last 7 days; "Not connected" otherwise. The 7d freshness threshold lives in `lastTwilioWebhookSuccessAt` (telemetry field updated by every successful webhook write).
3. **"Connect Twilio Number" form** (when `twilioConnected === false`). Inputs: E.164 number, Twilio Phone Number SID (`PNxxxx`), optional Messaging Service SID (`MGxxxx`), optional label, optional default-assigned tech. Calls `adminConnectTwilioNumber`.
4. **Enable incoming call lookup** — toggle bound to `settings.incomingCallLookupEnabled`, default ON. When OFF, the `twilioIncomingCall` provider handler skips the customer lookup + customersSnapshot build, still writes a bare `incomingCalls` doc with `customerId: null` for diagnostic continuity.
5. **Enable incoming SMS logging** — toggle bound to `settings.incomingSMSLoggingEnabled`, default ON. When OFF, the `twilioIncomingSMS` handler returns the empty TwiML response without writing `communicationEvents`.
6. **Enable missed-call auto text** — toggle bound to `settings.missedCallAutoTextEnabled`, default OFF. v1 reads only; SP7's `autoTextRules` engine consumes the flag.
7. **Enable outbound SMS** — toggle bound to `settings.outboundSMSEnabled`, default ON. When OFF, the `sendSMS` callable refuses with `'outbound_sms_disabled'`.
8. **"Auto-save customers from completed jobs"** — cross-link reference to the existing **Customer Directory** accordion's toggle (which stays where it is). Communications doesn't own this toggle — it just points at it so the operator can find it from either entry.
9. **"Test Incoming Call" admin action (v3.1 NEW)** — owner-only button visible regardless of `twilioConnected` state. Opens a customer-picker sheet (typeahead over the same `searchCustomers` helper used by Global Search). On confirm, writes a synthetic `incomingCalls/{id}` doc with `provider: 'test'`, `status: 'ringing'`, `customersSnapshot[]` populated from the picked customer (or empty for the "Pick: New Caller" option), `createdAt: serverTimestamp()`, `assignedToUid: null` (rings every device). The SP6 listener fires the popup within 1-2s on every foregrounded device. The synthetic doc auto-deletes after 60s (TTL field) so it doesn't pollute the customer's communication history. **This action enables full SP6 dogfooding without Twilio being connected** — see SP6 dormant-popup contract.

### Per-business connected status verification

A successful test call from the operator's mobile to their Twilio line should:
1. Fire `twilioIncomingCall` → resolve business → write `incomingCalls` doc.
2. Update `settings.lastTwilioWebhookSuccessAt = serverTimestamp()` on the same Firestore transaction.
3. Within 1-2s the Settings UI re-derives "Connected" status from the updated timestamp.

If the operator never makes a test call, `lastTwilioWebhookSuccessAt` stays unset → status reads "Not connected" even if `twilioConnected === true`. This is intentional — the operator can see the difference between "configured but never tested" and "configured and actively receiving".

### Migration

Existing tenants have none of these fields populated; nullish-coalesce defaults apply per the *Read-time default contract* subsection (defined for v2 fields, extended to v3 fields with the defaults listed above).

### Lands in SP3 + SP4 (v3.1 update)

- **SP3 (priority slice):** `CommunicationsSettingsSection.tsx` ships with items 1, 2, 4-8, **and 9 (Test Incoming Call)**. The Connect form (item 3) is rendered with disabled inputs + a "Configuration available when Cloud Functions are deployed" hint. The Test Incoming Call button works immediately (writes directly to Firestore from the client — owner-only Firestore rule); SP6's listener picks it up. The accordion is FULLY VALUABLE at SP3 without SP4 being deployed.
- **SP4:** Enables the Connect form (calls `adminConnectTwilioNumber`), enables real webhook telemetry on `lastTwilioWebhookSuccessAt`, and the four event-related toggles (items 4-7) gain effect. Items already shipped in SP3 do not move.

This split exists because the user's v3.1 priority lock requires the Customer Directory + Intelligence priority work to deliver the popup UX surface (including the test-fire affordance) without waiting on Twilio configuration.

---

## Backfill Existing Jobs (Phase 3)

**Confirmed by user answer #3.** A one-shot HTTPS-callable Cloud Function scans every existing job for a business, creates Customer + Vehicle docs from the job history, auto-merges duplicates by `phoneKey`, migrates legacy doc IDs, and computes initial rollups. Owner triggers it from Settings → Customer Directory after SP3 deploys.

### Function signature

```ts
// functions/src/backfillCustomers.ts
export const backfillCustomers = onCall<
  { businessId: string; dryRun: boolean },
  Promise<BackfillResult>
>(async (req) => { ... });

type BackfillResult = {
  customerCount: number;
  vehicleCount: number;
  jobsUpdated: number;
  mergesPerformed: number;
  legacyKeysRenamed: number;
  tireFieldsHoisted: number;
  durationMs: number;
  auditDocPath: string;
};
```

### Algorithm

1. Assert owner role on `req.auth.uid` for `businessId` (`assertOwnerOrAdmin`).
2. Read all `businesses/{bid}/jobs` ordered by `date ASC` (admin SDK; ~5k docs paginated).
3. For each job in order, invoke the **same transactional `upsertCustomerFromJob(businessId, job)` helper that live saveJob uses** (small batches of ~10-20 parallel invocations to bound transactional cost). The helper handles all field merging, idempotency, and concurrency safety; backfill does NOT pre-compute aggregates client-side and bulk-write — that path is race-unsafe (see *Live-write concurrency* below).
4. After all jobs are processed, walk the resulting Customer/Vehicle docs and finalize:
   - Recompute `averageTicket`, `vipTier`, `customerStatus` from the final `jobCount` + summed revenue (via `customerInsights.ts`). These are also written by `onJobWriteCustomerRollup`; the backfill writes them directly to avoid waiting for 5k debounced trigger invocations.
   - Ensure `nameLower`, `companyLower`, `cityLower`, `makeModelLower` are present on every doc.
   - Hoist tire-specific legacy fields (`tireSize` / `tireBrand` / `tireCondition`) from each Vehicle root into `vehicle.tire.{size, brand, condition}`. The dual-write contract below keeps SP1-SP3 reads unbroken.
5. **Batch-update each job doc** with `customerId`, `vehicleId`, `phoneKey` if missing (Firestore batches of 500).
6. **Migrate legacy `p_<10-digit>` Customer docs to `p_<11-digit>`:** write the new doc with all fields, rewrite every Job's `customerId` reference, then delete the old doc. Idempotent via a `migratedFrom` field on the new doc.
7. Write audit doc to `businesses/{bid}/maintenance/backfillCustomers` with the result struct + timestamps, including `backfillConflictsResolved` counters (see *Conflict resolution policy* below).

### Live-write concurrency (v2 — review-pass)

Backfill MUST be race-safe against `saveJob`-driven `upsertCustomerFromJob` invocations that may fire during the 30+ second backfill walk. The contract:

- **Backfill uses the same transactional `upsertCustomerFromJob` helper as live writes** — invoked per-job (or in small parallel batches), NOT as a precomputed bulk write. The `processedJobIds` array on the Customer doc, combined with `runTransaction` semantics, guarantees that concurrent live saveJob + backfill writes serialize and each `jobCount` increment lands at most once per `jobId` regardless of which path processed the job first.
- Specifically: if a live saveJob processes `jobId X` at 14:00:15 (writing `processedJobIds = [..., 'X']`, `jobCount = 43`), and backfill reaches `jobId X` at 14:00:42, backfill's transaction reads `processedJobIds` containing `'X'` and SKIPS the increment but still merges identity fields (per the *Concurrency Contract* on `upsertCustomerFromJob`). Counters stay correct.
- **Per-business advisory lock (optional belt-and-suspenders):** backfill writes `businesses/{bid}/maintenance/backfillCustomers.lockedAt = serverTimestamp()` at start and clears at completion. The live `saveJob` path does NOT check this lock (it would block AddJob save during backfill, which is unacceptable). Instead, an out-of-band watchdog in the backfill function aborts itself if it detects a stale lock from a prior crashed run (`lockedAt > 10 minutes old AND no completedAt`). This is a Cloud-Function-side concern only; clients are unaware.
- **Backfill MAY also be run during a "maintenance window"** where the operator temporarily flips `autoSaveCustomersFromJobs` to OFF for the duration. This is documented as the operator's preferred posture for very large backfills (>10k jobs) where the additional transactional cost of dual-write would slow active operations. The Settings UI offers a one-click "Pause auto-save and run backfill" affordance that flips the toggle, runs backfill, then flips back.

### Conflict resolution policy (v2 — review-pass)

When jobs grouped under the same `phoneKey` carry different values for the same Customer field (e.g. `customerName = 'J. Smith'` on a 2023 job and `'John A Smith'` on a 2025 job), the merge policy is:

| Field | Policy |
|---|---|
| `name`, `email`, `addressLine`, `city`, `state`, `zipCode`, `companyName` | **Most-recent-job-wins** (jobs ordered `date desc` within the group; first non-empty value chosen). Rationale: operators who update a customer's address on a 2025 job intended that as the current address. |
| `firstJobAt` | `min(date)` across the group. |
| `lastJobAt` | `max(date)` across the group. |
| `jobCount` | `length` of the deduplicated group. |
| `lifetimeRevenue` (for trigger-only persisted `averageTicket` derivation) | `sum(revenue)` always. |
| `tags`, `note` from any pre-existing customer doc | **Preserved verbatim** — backfill NEVER overwrites operator-typed notes/tags. |
| `lastEditedByUid` / `lastEditedAt` | Set to `'system:backfill'` / `serverTimestamp()`. |

The backfill audit doc records a `backfillConflictsResolved: { name?: number; email?: number; addressLine?: number; companyName?: number }` counter so the operator can see how many conflicts the policy resolved silently. After backfill completes, the operator can override any field via inline edit in CustomerProfile.

### Dual-write transition window for tire fields (v2 — review-pass)

Between SP1 deploy and SP3 backfill completion (could be days to weeks), `upsertCustomerFromJob` MUST dual-write tire data to BOTH `vehicle.tire.size` AND the legacy `vehicle.tireSize` root field. Global search (which queries `vehicle.tire.size`) ALSO issues a parallel legacy-branch query `vehicles where tireSize == query` during the transition window and merges the results. This guarantees:

- New writes between SP1 and SP3 are discoverable in global search via either index (dual-write).
- Legacy unmigrated Vehicle docs from before SP1 remain discoverable via the legacy-branch query.
- SP3 backfill rewrites all historic docs into the sub-object form. Once the backfill audit doc records `tireFieldsHoisted >= legacy count`, the legacy branch is retired in SP4 (PR removes the legacy query + stops dual-writing).
- Tire-vertical reads (CustomerProfile vehicle chips, AddJob lookup card) use the fallback `vehicle.tire?.size ?? vehicle.tireSize` for both reads — no operator-visible regression at SP1 deploy.

The SP1 ship-value checklist explicitly includes: *"Tire-vertical reads continue to work via the dual-write; no operator-visible regression at SP1 deploy."*

### Idempotency

- Re-runnable safely. The `processedJobIds` array on the Customer doc gates `jobCount` increments and `lastJobAt` updates inside `upsertCustomerFromJob`'s transaction. Re-running the backfill on a customer that already has all its jobs in `processedJobIds` is a no-op for counters; identity fields still merge with the conflict-resolution policy above.
- The audit doc records `startedAt`, `completedAt`, `customerCount`, etc. A second run that finds the audit doc with `completedAt < 7 days ago` warns the owner but proceeds (cheap no-op).
- **Trigger interaction:** the SP3 `onJobWriteCustomerRollup` trigger fires on every Job write the backfill makes (Step 5). To prevent N×30s coalescing churn, the backfill flags each job's batch-update with `metadata: { backfillRun: '<auditDocId>' }`; the trigger short-circuits when this metadata is present (the backfill writes the final rollups directly in Step 4 already, so the trigger has nothing to add). The flag is cleared by a follow-up sweep after audit-doc finalization.

### Dry-run mode

`dryRun: true` returns counts and merge previews only; no Firestore writes. The dry-run runs the same per-job transactional walk but with all `tx.set/update` calls replaced by an in-memory accumulator that produces the result struct. Useful for the owner to verify expected scale AND to calibrate the operator-shown estimate (`"Will create ~342 customers in ~30 seconds"`) — the 30-second figure is derived from the dry-run's measured `durationMs` × 1.5 (typical write-path overhead) rather than a hardcoded constant.

### Trigger UX

- "Backfill Customers from Job History" button in Settings → Customer Directory section (owner-only, gated by `permissions.role === 'owner'`).
- Shown only when no completed audit doc exists OR a re-run is explicitly requested via a "Re-run backfill" affordance.
- On click: confirmation modal showing dry-run estimate ("Will create ~342 customers, ~487 vehicles. This takes ~30 seconds. Continue?") → live progress indicator → success toast with audit-doc summary.

### Performance

Wheel Rush's job count (~3k-5k) backfills in well under a minute on a single Cloud Function invocation (admin SDK batched writes at 500/batch). Tenants with 50k+ jobs would need a multi-invocation cursor pattern — deferred to a future enhancement.

### Lands in SP3

Function + Settings button land in SP3 alongside CustomerProfile. The operator runs the backfill ONCE after SP3 deploys, verifies via the audit doc, and moves on.

---

## Future-Ready Seams

Phase 12 (the user's "ready for AI receptionist later" requirement) is delivered by named seams in the v1 schema and components — no rewrites needed when future work lands.

| Future capability | Seam in v1 | What still needs to be built later |
|---|---|---|
| **AI receptionist** | `incomingCalls.transcript` (from `call.transcript.completed`) + `leads.status` state machine (`'new' → 'contacted' → 'converted' \| 'lost'`) | A new Cloud Function `aiReceptionistHandler` triggered on `incomingCalls.transcript` writes; updates `lead.status` and writes a follow-up suggestion to `leads.aiSuggestedAction`. Frontend consumes existing `Lead` type. |
| **Retention campaigns** | `customer.tags` (existing, preserved) + `customer.lastContactedAt` (new field, written on every Call/Text action and on Accept of an incoming call) + `customer.lastJobAt` | A scheduled Cloud Function that queries `customers where lastJobAt < now - 60d AND lastContactedAt < now - 30d AND 'no_marketing' not in tags` and enqueues an SMS/email send. The query already works against the v1 schema. |
| **Auto-text-back on missed call** | `twilioCallStatus` already handles missed-call status callbacks (`CallStatus=no-answer/busy/failed`) and creates the Lead. `sendSMS` is wired in v1. `autoTextRules` collection schema is shaped in v1. | A new rules-engine evaluator inside `twilioCallStatus` that queries enabled `autoTextRules` matching the trigger, evaluates audience filters and cooldown, and calls `sendSMS` programmatically when `settings.missedCallAutoTextEnabled == true` AND `customer.tags` does not include `'no_marketing'`. Per-business toggle already exists in v1. |
| **FCM background push** | The IncomingCallModal already accepts being driven by any state setter; switching from Firestore listener to FCM-triggered state requires no UI changes. | Add `firebase/messaging` SDK, register a service-worker push handler in `public/sw.js`, persist FCM tokens per device in a new `businesses/{bid}/members/{uid}/fcmTokens/{tokenId}` subcollection, and modify `twilioIncomingCall` to ALSO send an FCM push (in addition to writing the Firestore doc) when on iOS/Android backgrounded contexts. The Firestore doc remains the source of truth; the push is a wake signal. |
| **Call recording playback** | `incomingCalls.recordingUrl` (persisted in v1, just not rendered) | Add an `<audio>` element to a "Past Calls" section of CustomerProfile that loads `recordingUrl`. v1 stores; v2 surfaces. |
| **Two-way SMS thread in app** | `twilioIncomingSMS` already writes inbound messages to `communicationEvents`; `sendSMS` writes outbound. v1 doesn't surface a chronological thread view, but the data is already structured for it. | A new `ConversationsPage` and per-customer `MessageThread` component that read `communicationEvents` where `type in ['incoming_sms', 'outgoing_sms']` and `customerPhoneKey == phoneKey`, grouped chronologically with composer footer. No new collection required. |
| **Vehicle directory (cross-customer)** | The Vehicle subcollection already carries `vin`, `licensePlate`, `color` fields — present but optional in v1. | A top-level vehicle search page that uses a Firestore Collection Group query on `vehicles` filtered by `licensePlate` or `vin`. No schema change. |
| **Multiple matches on shared phone** | `incomingCalls.multipleMatches: boolean` + `vehiclesSnapshot` already carries up to 3 vehicles | IncomingCallModal renders the secondary "Also: Jose Lopez" line when `multipleMatches == true`. v1 already renders this. |
| **Lead → Customer auto-promote** | `Lead.phoneKey` and `Customer.phoneKey` share the same field. When a future job is saved with a matching `phoneKey`, `upsertCustomerFromJob` can detect an unconverted lead and flip `lead.status = 'converted'` + `lead.convertedJobId`. | v1 doesn't auto-promote; the operator does it manually from the Leads page. SP7 adds the auto-flip. |
| **v2 Per-vertical service catalogs** | Customer Timeline + Customer Insights "Most Common Service Type" already read service labels via `verticalConfig.services[id].label` rather than hardcoded strings. | When a new vertical's service catalog is added (e.g. mechanic engine codes, detailing packages), the timeline and insights render correctly with zero code change. |
| **v3 Per-business Twilio integration** | `settings.twilioConnected`, `incomingCallLookupEnabled`, `incomingSMSLoggingEnabled`, `outboundSMSEnabled`, `missedCallAutoTextEnabled` are all shaped in v1 schema with sensible defaults. CustomerProfile Call always uses `tel:`; Text uses `sendSMS` when enabled, else `sms:`. | SP7 may add an "Answer in MSOS" path via Twilio Programmable Voice client SDK (replaces native `tel:` dispatch with in-app call control). No schema change, no UI change. |
| **v2 Referral tracking** | `Customer.referralCount: number` reserved on schema (defaults to 0). Insights card shows the count read-only. | A future referral-flow surface (CustomerProfile → "Refer a friend" action) increments this counter. No schema change. |
| **v2 Per-vertical Vehicle sub-objects** | `vehicle.mechanic` and `vehicle.detailing` placeholder sub-objects reserved in schema. CustomerProfile renders fields conditional on active vertical via existing `resolveVertical()` pattern. | When mechanic / detailing verticals graduate from placeholder, the sub-objects fill in with no schema migration on existing Vehicle docs. |
| **v2 Per-business VIP thresholds** | `deriveVipTier` reads thresholds from a config; v1 hardcodes Gold $1,000+ / Platinum $2,500+. | SP7 adds `settings.vipThresholds: { gold: number; platinum: number }` for tenants in higher-AOV verticals. The trigger Cloud Function rereads on each rollup. |

---

## Phase Mapping (user phases 1-18 → sub-projects SP1-SP7.5)

v2 expands the marketed phase numbering from 12 to 18. The dev-execution sub-project structure (SP1-SP7.5) is unchanged — the 18 phases are how the operator narrates value as it lands; SP1-SP7.5 are how engineering ships.

| Old phase (12) | New phase (18) | New phase title | Lands in SP |
|---|---|---|---|
| P1 Customer Directory | **P1** | Customer Directory foundation **+ top-level Customers nav route + skeleton CustomerHub page (v3.2 — refinement #1)** | SP1 |
| P2 Vehicle Directory | **P2** | Vehicle Directory | SP1 |
| (was OQ#3) | **P3 NEW** | Backfill existing data | SP3 (backfill button + Cloud Function) |
| P3 Universal Lookup | **P4** | Universal Customer Lookup by phone | SP2 |
| (NEW) | **P5 NEW** | Global Customer Search | SP3 |
| P4 AddJob redesign | **P6** | AddJob redesign with 8-step order | SP2 |
| P9 Customer Profile | **P7** | Customer Profile page (Overview, Vehicles, Service History, Photos, Invoices, Communication, Notes, Insights) | SP3 |
| P5 Service Timeline | **P8** | Service Timeline | SP3 |
| (NEW) | **P9 NEW** | Customer Insights + VIP tiers (Gold $1,000+, Platinum $2,500+) | SP3 |
| P9 Quick Actions | **P10** | Quick Actions | SP3 |
| P6 OpenPhone integration | **P11** | Twilio integration (gated, optional) | SP4 |
| P7 Incoming Call Popup | **P12** | Incoming Call Popup | SP6 |
| P8 Missed Call framework | **P13** | Missed Call framework | SP5 |
| (was implicit in P6/P8) | **P14 NEW-EXPLICIT** | Communication Logging | SP4 + SP5 |
| P10 Technician Permissions | **P15** | Technician Permissions | spans SP1-SP3 |
| P11 Database Structure | **P16** | Database Structure (vertical-agnostic + new fields) | SP1 |
| (NEW) | **P17 NEW** | Settings toggle for auto-save | SP1 schema + SP3 UI |
| P12 AI receptionist | **P18** | Future AI foundation | SP7 |

**Reading the map:**
- P1, P2, P15, P16, P17-schema all land in **SP1** (the foundation slice).
- P4, P6 land in **SP2** (the AddJob slice).
- P3, P5, P7, P8, P9, P10, P17-UI all land in **SP3** (the CustomerProfile + global search + backfill + settings slice — this is the biggest SP3 has ever been, but it ships as a coherent operator-visible value pile).
- P11, P14 land in **SP4** (the webhook foundation).
- P13, P14 land in **SP5** (the leads + missed-call slice).
- P12 lands in **SP6** (the popup slice).
- P18 lands in **SP7** (future-ready follow-ups).

The 18-phase numbering is the marketing scaffolding for what the operator sees in their app over time. The SP1-SP7.5 boundaries are the engineering execution structure. They run in parallel.

---

## Ship Order (Sub-Projects)

Each sub-project is shippable in isolation. The order minimizes risk and accumulates value the operator can feel at each step.

### SP1 — Customer + Vehicle entities + saveJob upsert

- **Phases covered:** **P1, P2, P15 (RBAC schema), P16 (Database Structure), P17 (Settings schema only)**
- **Scope:** `src/lib/phone.ts`, `src/lib/customerEntity.ts`, `src/lib/customers.ts` (hybrid refactor), `src/App.tsx` saveJob hook, `firestore.rules` deltas for `customers/{cid}/vehicles/**` and tightened `customers/{cid}` update rules. **v3.2 additions (refinement #1 nav, #2 Quick Notes, #6 fleet kind):**
  - **Top-level Customers nav route + skeleton CustomerHub page (v3.2 — refinement #1).** SP1 lands the `/customers` route and the existing `src/pages/Customers.tsx` is wired as the entry point (no fork; the file evolves in place — agent verifies at SP1 grep time). Bottom-nav adds the **Customers** tab as the fifth tab per the canonical order (Dashboard / Jobs / Customers / Inventory / Analytics / Settings). Six-tab viability is verified at 360px / 390px / 414px viewports; overflow recommendation (push Analytics or Settings to a MoreSheet) is implemented if any tab label truncates or icon overlaps a thumb-reach safe zone. Any existing settings-buried customer affordances discovered at grep time are redirected to the new tab.
  - **Customer Quick Notes fields (v3.2 — refinement #2): SCHEMA ONLY.** Adds `gateCode`, `apartmentNumber`, `wheelLockKeyLocation`, `tpmsNotes`, `preferredPaymentMethod`, `parkingInstructions`, `preferredContactMethod`, `generalNotes` to the Customer schema and the Firestore-rule write allowlist. No UI yet. AddJob auto-attach lands in SP2; CustomerProfile edit lands in SP3.
  - **Customer kind enum (v3.2 — refinement #6): SCHEMA ONLY.** Adds `kind: 'individual' | 'fleet'` (default `'individual'`) to the Customer schema and the rule allowlist. Default-writes from `upsertCustomerFromJob` set `kind = 'individual'`. No fleet workflow UI in SP1-SP3; the field is reserved so future fleet features plug in without entity-shape changes.
  - **v2 additions (carried forward):**
  - **New Customer fields:** `companyName`, `nameLower`, `companyLower`, `cityLower`, `zipCode`, `averageTicket`, `customerStatus`, `vipTier`, `referralCount`. Firestore-rule allowlist + index registrations.
  - **New Vehicle fields:** `year`, `make`, `model`, `trim`, `color`, `makeModelLower`. Tire-specific fields **hoisted under `vehicle.tire`** sub-object (vertical-agnostic refactor). Legacy flat-field reads still work via fallback.
  - **Settings schema:** `autoSaveCustomersFromJobs: boolean` (default true), `twilioConnected: boolean` (default false), `communicationProvider: 'twilio'` (read-only label), `incomingCallLookupEnabled: boolean` (default true), `incomingSMSLoggingEnabled: boolean` (default true), `missedCallAutoTextEnabled: boolean` (default false), `outboundSMSEnabled: boolean` (default true), `outboundCommunicationProvider: 'native' | 'twilio'` (default 'native'). No UI yet — schema + Firestore-rule allowlist only.
  - **saveJob gate:** reads `settings.autoSaveCustomersFromJobs` via cached context; when false, skips the entire upsert path. Toast "Customer not auto-saved (toggle OFF)" on save.
  - **Updated `customerKey()`** uses `normalizePhone(...).digits` → `p_<11-digit>` format (breaking change from legacy `p_<10-digit>`; reconciled via hybrid read).
  - **Updated `vehicleKey()`** prefers universal `year-make-model-trim` slug; falls back to legacy tire-vertical keys only for jobs without make/model.
- **Rationale:** Smallest viable slice that unlocks every later phase. Adds persistence at save time without changing any visible operator flow. Hybrid read keeps Customers page working for both legacy and new data on day 1. Zero risk because upsert is wrapped in try/catch. The auto-save gate + new fields are schema-only at SP1 — UI lands in SP3 — so SP1's visible-change surface stays small.
- **Dependencies:** none
- **Ships value when:** Every newly saved job auto-creates a real Customer doc with `phoneKey` and a Vehicle subdoc (assuming the auto-save toggle is ON, which it is by default). Customers page sorts by persisted `lastJobAt` for jobs saved post-deploy. Schema is fully vertical-agnostic from day 1. **Tire-vertical reads continue to work via the SP1→SP3 dual-write contract — no operator-visible regression at SP1 deploy.**

### SP2 — Phone lookup + AddJob "returning customer" card + 8-step order + address autofill

- **Phases covered:** **P4 (Universal Lookup), P6 (AddJob redesign with 8-step order)**
- **Scope:** `src/lib/lookupCustomerByPhone.ts`, `src/components/addJob/CustomerLookupCard.tsx`, `src/pages/AddJob.tsx` restructured into the confirmed 8-step order (Phone → Lookup → Vehicle → Quick Pricing → Service Type → Tire Size → Location → Notes), email input added to existing Customer card. **v3.2 addition (refinement #2 — Quick Notes auto-attach in AddJob):** when AddJob's Returning Customer card autofills, the customer's 8 Quick Notes fields render as a non-dismissable info card pinned at the top of the job notes section. The card reads LIVE from the Customer doc (no field copy into the Job). Component: `src/components/addJob/QuickNotesInfoCard.tsx`. If all 8 fields are unset, no card renders. **v2 additions:**
  - **`AddressAutofillInput` component** inserted at AddJob step 7 (Location). Populates `addressLine`, `city`, `state`, `zipCode`. Lightweight US-ZIP lookup in v1 (no external API). Also added to CustomerProfile edit mode.
  - **Vertical dispatch on step 6** (Tire Size): tire-vertical renders tire-size input; other verticals render their `verticalConfig.primaryDomainField` or skip the step entirely.
  - **Customer card** captures `companyName` (optional) for fleet customers.
- **Rationale:** First operator-visible win. Phone-first auto-fill on returning customers. The explicit 8-step order matches the user's mental model: "who is this person" (steps 1-3) → "what am I charging" (steps 4-5) → "where am I going" (step 7) → "anything else" (step 8). Address capture lands here per user answer #5 (no longer deferred to SP3).
- **Dependencies:** SP1
- **Ships value when:** Tech opens AddJob, types `(305) 897-7030`, sees Maria Lopez + Honda Civic / 215/55R17 card in <300ms, taps "Use Customer," watches the whole Customer card autofill. Step 7 Location autofills city/state/zip from a typed ZIP. The 8-step order feels deliberate, not arbitrary.

### SP3 — Customer Profile + Global Search + Insights + Backfill + Customer Directory Settings

- **Phases covered:** **P3 (Backfill), P5 (Global Search), P7 (Customer Profile), P8 (Service Timeline), P9 (Customer Insights), P10 (Quick Actions), P17 UI (Auto-save toggle), P15 UI (RBAC)**
- **Scope:** This is the BIG slice — it absorbs most of v2's new requirements.
  - **v3.2 additions (refinement #2 Quick Notes edit UI, #3 Repeat Last Service surface, #7 Service History Photos):**
    - **Quick Notes edit surface on CustomerProfile.** Inline edit of the 8 Quick Notes fields gated by `canEditBusinessSettings` (owner/admin); technicians see read-only. Placement: between Vehicles and Service History (canonical Customer Profile section order).
    - **Repeat Last Service CustomerProfile button.** Wires the existing AddJob CTA's helper (`cloneLastCompletedJobIntoDraft(customerId)`) to a button on CustomerProfile's Quick Actions row (button #2). Field-clone list and editable-price contract are identical to the AddJob version.
    - **Service History Photos aggregation.** `src/components/customerProfile/ServiceHistoryPhotos.tsx` — flattens the bounded (100-job) jobs array into photo groups by service type. No new storage. Tap-through opens existing JobDetailModal scrolled to its Photos sub-section.
  - **CustomerProfile + timeline:** `src/pages/CustomerProfile.tsx`, `src/pages/Customers.tsx` modifications (row click → CustomerProfile, tightened revenue gating, vehicles surfaced), routing add to App.tsx, 9 quick-action buttons wired.
  - **v2: Global Customer Search.** `GlobalSearchSheet.tsx` (bottom-sheet), `searchCustomers.ts` (parallel multi-field helper), persistent search icon in main nav, new composite indexes for `nameLower` / `companyLower` / `cityLower` / `zipCode` on Customers and `makeModelLower` / `licensePlate` / `tire.size` collection-group on Vehicles.
  - **v2: Customer Insights card.** `CustomerInsightsCard.tsx` (rendered on CustomerProfile), `customerInsights.ts` (helpers: `deriveVipTier`, `deriveCustomerStatus`, `computeMostCommonVehicle`, etc.), VIP tier badge component. `onJobWriteCustomerRollup` Cloud Function trigger that recomputes `averageTicket` / `vipTier` / `customerStatus` on Customer doc on every job write.
  - **v2: Auto-save toggle UI.** `CustomerDirectorySettingsSection.tsx` adds a new "Customer Directory" accordion in Settings with the toggle row (schema lands in SP1; UI lands here).
  - **v2: Backfill function + admin button.** `backfillCustomers` Cloud Function (HTTPS callable, owner-only). Settings → Customer Directory → "Backfill Customers from Job History" button. Audit doc + dry-run mode. Migrates legacy `p_<10-digit>` Customer doc IDs to `p_<11-digit>`. Hoists tire fields into `vehicle.tire`. Auto-merges by phoneKey.
  - **Per-vertical service-catalog label lookup** in the timeline (vertical-agnostic framing — Service Type display reads from `verticalConfig.services` rather than hardcoded strings).
- **Rationale:** SP3 is bigger in v2 than v1, but the additions are all CustomerProfile-adjacent — Global Search benefits from the same `nameLower` / `companyLower` fields the profile uses; Insights derives from the same jobs query the profile loads; Backfill is the natural moment to enrich the directory before the operator dogfoods Insights; Settings toggle UI lands here because that's where the Backfill button also lives. Shipping these together gives the operator one coherent "directory + intelligence" upgrade.
- **Dependencies:** SP1
- **Ships value when:** Operator taps any customer in Customers page → drills into full profile with phone, vehicles, full service history, notes, tags, 9 quick actions, AND a Customer Insights card with VIP tier badge. They tap the new search icon in main nav, type "Tesla" or "235/45R18" or "Hollywood", get sub-300ms results across name/vehicle/zip. They open Settings → Customer Directory, see the auto-save toggle (default ON), and run the Backfill button — within ~30s every existing job has been organized into Customer + Vehicle records.

### SP4 — Twilio webhooks (3 endpoints) + sendSMS + provider abstraction + business-number mapping (gated, disabled by default)

- **Phases covered:** **P11 (Twilio integration), P14 (Communication Logging — receive side: incoming call/SMS webhook + Firestore write)**
- **Scope:** `functions/src/twilioIncomingCall.ts`, `functions/src/twilioIncomingSMS.ts`, `functions/src/twilioCallStatus.ts`, `functions/src/sendSMS.ts`, `functions/src/adminConnectTwilioNumber.ts`, `functions/src/reconcileTwilioCalls.ts` (scheduled), `functions/src/lib/communicationProvider.ts` (interface + registry), `functions/src/lib/providers/twilio.ts` (Twilio implementation), `functions/src/lib/twilioClient.ts` (REST SDK wrapper), `functions/src/lib/phone.ts` (duplicate of client copy), `functions/src/lib/lookupCustomerByPhone.ts` (duplicate at functions layer), `functions/src/index.ts` exports, `firestore.rules` for `incomingCalls/**`, `twilioPhoneNumbers/**`, `twilioWebhookEvents/**`, `twilioSyncCursors/**`, `communicationEvents/**`, `callerLookupEvents/**`, `missedCallEvents/**`, `autoTextRules/**`. Operator-visible `CommunicationsSettingsSection.tsx` (v3 NEW) for connect form + toggles. **Extension of `scheduledDeletionPurge`** to purge top-level `twilioPhoneNumbers` / `twilioSyncCursors` docs owned by a purged business. **Firestore TTL policy on `twilioWebhookEvents.createdAt` (28h)** configured at deploy time — hard requirement, not optional.
- **v3 emphasis: ships DISABLED by default.**
  - **`TWILIO_WEBHOOK_ENABLED=false`** at v1 deploy. All three webhooks return 404. Per success criterion #12.
  - **Per-business `settings.twilioConnected = false`** at default. Settings → Communications shows "Connect Twilio" CTA when false.
  - **`sendSMS` callable returns `'twilio_not_configured'`** gracefully when env vars unset — does not throw an unhandled exception.
  - Operator already owns a Twilio account + provisioned number → supplies E.164 + Twilio SID via Settings → Communications form → `adminConnectTwilioNumber` writes mapping + flips `settings.twilioConnected = true` → MSOS ops flips `TWILIO_WEBHOOK_ENABLED=true` on the function → operator configures the Twilio number's VoiceUrl / StatusCallback / MessagingUrl in the Twilio console. Activation is a config-only operation, no code deploy.
- **Rationale:** Backend-first. Ship the three webhooks with full HMAC-SHA1 signature verification + idempotency + business resolution + tenant isolation invariants before adding the popup surface. Lets us instrument latency and verify the resolution chain (Twilio number → business → customer) in production before any operator sees a popup. Reconciliation function closes the "calls never vanish" promise even on webhook outages. The Twilio-optional gating means SP1-SP3 ship and provide value without requiring SP4 to be turned on. Including `sendSMS` in SP4 (rather than deferring to SP7) means the inline-SMS Text button on CustomerProfile can ship in SP3 with the safeguards (env present, outboundSMSEnabled, rate limit) already in place.
- **Dependencies:** SP1 (needs Customer entity to resolve)
- **Ships value when:** Owner connects their Twilio number in Settings → Communications, MSOS ops flips the env flag, owner places a test call to the Twilio line from a known customer's phone, and within 1s sees an `incomingCalls/{CallSid}` doc in Firestore with `customerId` resolved + vehicle snapshot. Owner sends a test SMS via the new Text inline UI and watches a `communicationEvents` row land. Foundational plumbing done. Until the operator opts in, this SP is invisible.

### SP5 — Missed-call workflow + Leads

- **Phases covered:** **P13 (Missed Call framework), P14 (Communication Logging — leads/send side)**
- **Scope:** `twilioCallStatus` adds Lead creation on `CallStatus=no-answer|busy|failed` (transactional dedup so two parallel webhooks for the same caller don't race-create two leads — read-then-create inside `runTransaction` keyed on `(phoneKey, createdAt window)`); `missedCallEvents` writes on every miss; `src/pages/Leads.tsx`, `Lead` type added, MoreSheet tab entry, in-app toast notification on missed call (uses existing `addActionToast` bus), missed-call feed surfaced via `missedCallEvents` listener, **"Attach to customer" manual link action** for unknown-caller leads (typeahead picks a Customer; updates both `leads.customerId` and the originating `incomingCalls.customerId`).
- **Rationale:** Builds on SP4 webhook plumbing. Missed calls stop vanishing; operators can work the funnel.
- **Dependencies:** SP4
- **Ships value when:** Every missed call to the business number creates a Lead row that any operator can act on. Known customers' missed calls show their name; unknown numbers are first-touch leads. The toast surfaces them in real time when the tab is foregrounded. Lead dedup contract: a missed call from the same `phoneKey` within 7d updates the existing lead's `lastMissedCallAt` and increments `missedCallCount` instead of creating a duplicate row.

### SP6 — Incoming Call Popup UI (ships dormant; auto-activates when SP4 is connected)

- **Phases covered:** **P12 (Incoming Call Popup)**
- **Scope:** `src/lib/useIncomingCallListener.ts`, `src/components/IncomingCallModal.tsx`, `src/App.tsx` listener attach + modal render, `/public/sounds/ringtone.mp3` asset. **Accept and Decline are Firestore transactions** with the "already answered by {name}" losing-device UX. Disambiguation sheet for shared-phone matches (renders `customersSnapshot[]` and writes the picked `customerId` back via the update-allowed field). **v3 NEW: New Caller card variant** — when `customersSnapshot.length === 0`, popup shows "NEW CALLER" with the formatted phone number and three buttons: **Create Customer** (opens CustomerProfile in new-customer mode with phone pre-filled), **Create Job** (opens AddJob with customerPhone pre-filled), **Text Back** (opens the inline send-SMS UI; when SP4 is unconnected this falls back to a `sms:` deep-link). Audio autoplay unlock via a one-time pointer listener on App mount.
- **v3.1 dormant-popup contract:** SP6 ships **without requiring SP4 to be deployed or connected**. The Firestore listener is attached at app boot; if no `incomingCalls` doc ever lands, the modal never renders — zero overhead, zero noise. Verification path during SP6 development uses the **Test Incoming Call admin action** (Settings → Communications → "Test Incoming Call" button, owner-only) which writes a synthetic `incomingCalls` doc with a chosen customer's snapshot. The popup pipeline exercises end-to-end without any Twilio configuration. Once SP4 lands and Twilio webhooks begin writing real `incomingCalls` docs, the popup activates automatically — no code change.
- **Rationale:** The headline UI lands as part of the customer-intelligence priority push, dormant until communications infrastructure activates. Decoupling from SP4 means: (a) the popup design is dogfooded and refined while Twilio number selection is still pending, (b) SP4 can ship/activate later without re-litigating the popup UX, (c) the operator sees a coherent CustomerProfile + Insights + popup UI surface in one ship without waiting on external configuration. The New Caller variant lands here (not SP3) because it's a popup-resident affordance — but its three buttons (Create Customer, Create Job, Text Back) all dispatch into already-existing SP1-SP3 surfaces, so SP6 introduces no new dependencies.
- **Dependencies:** SP1, SP3. **SP4 is NOT a strict dependency** — the popup activates when `incomingCalls` docs appear, regardless of who writes them (Twilio webhook in SP4, or the Test Incoming Call admin action in this SP). SP5 (Leads/missed-call) remains gated on SP4 since it depends on real webhook events.
- **Ships value when:** Operator opens MSOS, taps Settings → Communications → "Test Incoming Call" with a chosen customer; within 1-2s a popup appears showing caller name, vehicle, last service, with Accept / Decline / Open Profile / Create Job and a ringtone. Unknown-caller test fires the NEW CALLER card with three quick actions. The full popup UX is exercised and dogfooded without Twilio being connected. When SP4 lands later, the same popup begins firing on real calls automatically.

### SP7 — Future-ready seams (optional follow-up)

- **Phases covered:** **P18 (Future AI foundation) + extensions to P11 (Answer-in-MSOS, recordings, transcripts), P14 (auto-text-back via `autoTextRules`)**
- **Scope:** Per-item; not a single bundle. Items: (a) surface `recordingUrl` and `transcript` in CustomerProfile post-call section (gated by NEW `canViewRecordings` flag; requires enabling Twilio `<Record>` + Voice Intelligence transcripts); (b) FCM web push for background delivery (firebase/messaging, sw.js push handler, token table, VAPID); (c) **rules-based auto-text-back on missed call via `sendSMS` + `autoTextRules` engine** (the `sendSMS` callable already ships in SP4; SP7 builds the rule evaluator and rule-creation UI); (d) AI receptionist hook on `transcript` write; (e) "Answer in MSOS" using Twilio Programmable Voice client SDK so operators can take calls inside the app instead of via Twilio's call forwarding; (f) admin "Merge customers" tool for the customer-changes-phone-number case (rewrites every Job's `customerId` from source → target, sums rollup counters, concatenates notes, unions tags, then soft-deletes the source); (g) outbound SMS bulk-send + scheduled-send + templated quick-replies.
- **Rationale:** Not required for the user's stated goal. Each item ships independently as ROI dictates.
- **Dependencies:** SP6
- **Ships value when:** Each item ships individually — auto-text-back in <1 week; FCM in 2-3 weeks; AI receptionist in a separate quarter-scoped project; customer-merge tool when the first split is reported.

### SP7.5 — GDPR/CCPA hard-delete + customer audit log

- **Phases covered:** compliance follow-up
- **Scope:** "Forget customer (GDPR)" owner-only action with hard cascade (tombstone `customerName`/phone/email/city/state on related Jobs while preserving financial fields for tax compliance; delete `vehicles`/`leads`/`incomingCalls`/`communicationEvents`/`missedCallEvents`/`callerLookupEvents` scrubbed for the customer); Firestore trigger Cloud Function populating `businesses/{bid}/customers/{cid}/audits/{auditId}` on every customer doc change; Twilio REST API call to delete any upstream recording for any `recordingUrl` referenced from scrubbed `incomingCalls`; operator-facing compliance log surface in Settings.
- **Rationale:** Soft-delete in v1 is operator UX only and does NOT satisfy regulatory deletion requests. This follow-up closes the compliance gap before MSOS markets to GDPR-regulated jurisdictions or any business that explicitly requires CCPA conformance.
- **Dependencies:** SP3 (Customer profile + soft-delete UI), SP4 (recording URL persistence if/when Twilio recordings are enabled)
- **Ships value when:** Owner can invoke "Forget customer" from CustomerProfile and the request flows through to (a) MSOS Firestore tombstoning, (b) Twilio recording deletion via REST API, (c) an audit-log entry the operator can show a regulator.

---

## Out of Scope (this spec)

- No production code yet (design only)
- No live Twilio secrets / no real webhook deployment yet
- **No Twilio number provisioning automation** — operator owns the number in Twilio's console and provides the credentials. MSOS does not call Twilio's incoming-number provisioning API.
- **No multi-channel messaging (WhatsApp, MMS, RCS) in v1** — text-only SMS via Twilio Messaging Service / Twilio Phone Number. The provider abstraction permits adding channels later.
- ~~No backfill of historical jobs into the Customer collection~~ **— now IN SCOPE as Phase 3, lands in SP3 via the `backfillCustomers` Cloud Function + Settings admin button. Per user answer #3.**
- ~~Address capture in AddJob deferred to SP3~~ **— now IN SCOPE in SP2 (AddJob step 7 Location) via `AddressAutofillInput`. Per user answer #5.**
- No outbound SMS sending (P13 is backend logging only; outbound is SP7)
- No FCM web push (SP7)
- No two-way SMS thread UI (SP7-adjacent)
- No call recording or transcript surfacing in v1 — fields persisted, UI deferred
- No customer-changes-phone-number auto-merge — phone change in v1 creates a SECOND Customer doc (history splits); admin merge tool is SP7.
- No customer-changes-phone-number auto-detection UI — operator notices via the duplicate row in Customers.
- No multi-country phone normalization — US default only. International, extension, and vanity inputs are explicitly REJECTED by `normalizePhone` (return `valid: false`) in v1.
- **Call button in v1 always uses native `tel:`** — "Answer in MSOS" via Twilio Programmable Voice client SDK is SP7. Text button in v1 uses `sendSMS` when Twilio is configured, else falls back to native `sms:`.
- **No AI receptionist / TwiML `<Say>` / `<Gather>` / `<Dial>` verbs in v1** — the voice webhook returns a minimal `<Pause length="1"/>` and the call rings through to the operator's actual phone via Twilio's number-level call forwarding. SP7 may evolve this.
- **No service-vertical-specific search filters in P5 global search — search is field-agnostic across all verticals.** Vertical-specific power-search filters (e.g. "show only Platinum-tier tire customers in Hollywood") are SP7.
- **No client-side or server-side fuzzy/typo-tolerant search in v1** — substring/prefix matching only. Full-text via Algolia / Meilisearch deferred to SP7 if Wheel Rush feedback indicates real demand.
- No new permission flags in v1 — existing `Permissions` map suffices. (`canViewRecordings` is added in SP7.)
- **No per-customer GDPR/CCPA hard-delete in v1.** The CustomerProfile "Delete" button is SOFT-DELETE only (operator UX affordance). Hard-delete with Job tombstoning, Twilio recording removal, and audit logging is SP7.5. Businesses receiving GDPR/CCPA erasure requests before SP7.5 ships must run the operation manually via Firestore console.
- No full customer-change diff audit log in v1 — only `lastEditedByUid` / `lastEditedAt` is captured. Full before/after diff log is SP7.5.
- No CMEK encryption for plaintext PII (phones, transcripts) — Google-managed at-rest encryption is the v1 protection model.
- No Cloud Armor / App Check / IP allowlist on the webhook — `maxInstances: 10` + HMAC + replay window + kill switch is the v1 defense.
- No automatic two-party-consent recording disclosure — operator's regulatory responsibility, surfaced via a Settings notice and link to Twilio's recording-compliance docs when recordings are eventually enabled.
- **No per-business VIP threshold overrides in v1** — Gold $1,000+ / Platinum $2,500+ are hardcoded thresholds. Per-business `settings.vipThresholds` deferred to SP7.
- **No external address-autocomplete API in v1** — `AddressAutofillInput` ships a bundled US ZIP → city/state JSON dataset (~200 KB gzipped, ~40k US ZIPs). Operator types ZIP first; city/state autofill; street `addressLine` is free-text. No street-level address validation in v1. Google Places API integration is an SP7 follow-up; it requires `GOOGLE_PLACES_API_KEY` and a per-tenant privacy-policy update since customer addresses would then be sent to Google for autocomplete.

---

## Open Questions for User

### Resolved in v2 (user-answered)

1. **Communications provider / API access:** ✓ **RESOLVED — v3.** User answer: *"Twilio is now the primary communications provider. Already has Twilio account + provisioned number."* → SP4 ships with `TWILIO_WEBHOOK_ENABLED=false` (global kill switch) and `settings.twilioConnected=false` (per-business) by default. SP1-SP3 ship and provide full value without Twilio configuration. See *Twilio-Optional Architecture*.

2. **Multi-line / multi-tech routing:** ✓ **RESOLVED in v1 spec** — see *Multi-operator delivery rule — resolved* under Real-Time Popup Delivery.

3. **Historical job backfill:** ✓ **RESOLVED — v2.** User answer: *"YES. Scan all existing jobs, create Customer profiles from historical data using phone number as primary identifier, auto-merge duplicates where possible. No existing data lost."* → New Phase 3. `backfillCustomers` Cloud Function + Settings admin button land in SP3. See *Backfill Existing Jobs (Phase 3)*.

4. **Missed-call SMS automation:** ✓ **RESOLVED — v2.** User answer: *"Defer to Phase 7 (SP7). Build the architecture only. No automated outbound texts yet."* → Webhook architecture in SP4-SP5; outbound deferred to SP7 with per-business opt-in.

5. **Phone lookup ambiguity (shared household line):** ✓ **RESOLVED in v1 spec** — `customersSnapshot[]` carries up to 3 candidate customers; disambiguation sheet on tap.

6. **Address capture in AddJob:** ✓ **RESOLVED — v2.** User answer: *"YES. Add customer address lookup + autofill in AddJob workflow."* → `AddressAutofillInput` lands in SP2 at AddJob step 7 (Location). Lightweight US-ZIP lookup in v1; Google Places deferred to SP7.

7. **Webhook signature verification:** ✓ **RESOLVED — v3.** Twilio uses `X-Twilio-Signature` (HMAC-SHA1 of URL + sorted POST params, base64-encoded, timing-safe compare). No timestamp signed; replay defense is idempotency + retry window. Algorithm verified against [Twilio's security docs](https://www.twilio.com/docs/usage/security). See *Twilio webhook signature verification*.

8. **Outgoing call/SMS UX:** ✓ **RESOLVED — v3.** Call always uses `tel:` (SP7 may add Answer-in-MSOS via Twilio Voice client SDK). Text uses Twilio `sendSMS` when `twilioConnected && outboundSMSEnabled`, else falls back to native `sms:`. v3 introduces Provider Abstraction Layer so future providers add without schema/UI changes.

9. **Customer entity ID strategy:** ✓ **RESOLVED in v1 spec** — `p_<11-digit>` canonical; legacy `p_<10-digit>` migrated by SP3 backfill (now confirmed).

10. **Toast vs full popup for missed/race-condition calls:** ✓ **RESOLVED in v1 spec** — toast on every `call.missed` regardless.

### Resolved in v2 (new requirements added by user — auto-confirmed)

A. **Global Customer Search (new P5):** ✓ **CONFIRMED.** Universal search from main nav, 7 field branches via `Promise.all`, sub-300ms target. Lands in SP3. See *Global Customer Search (Phase 5)*.

B. **Customer Insights card (new P9):** ✓ **CONFIRMED.** 9 metrics with VIP tier badge (Gold $1,000+, Platinum $2,500+ thresholds confirmed by user). `averageTicket`, `vipTier`, `customerStatus` persisted as rollups via `onJobWriteCustomerRollup` trigger. Other 6 metrics computed live. Lands in SP3. See *Customer Insights Card (Phase 9)*.

C. **Auto-save customers toggle (new P17):** ✓ **CONFIRMED.** Default ON. Settings → Customer Directory accordion. Owner/admin only. Schema lands in SP1; toggle UI lands in SP3. See *Auto-Save Customers Setting (Phase 17)*.

### Remaining open questions (NEW, surfaced by v2 additions + v3 pivot)

The v2 additions surfaced three follow-up decisions. v3 adds two more. None are blockers for sign-off; the spec ships with the recommended defaults. User can override any of them.

11. **Backfill execution timing.** When should the operator run the SP3 backfill — immediately on SP3 deploy, or after a few days of dogfooding the new CustomerProfile against new-write data? **Recommendation:** run immediately on SP3 deploy. The audit doc + dry-run mode gives the operator confidence; running early means CustomerProfile shows real history from day 1 instead of growing organically.

12. **VIP tier threshold confirmation.** Gold $1,000+ / Platinum $2,500+ are tuned for Wheel Rush's average ticket (~$400-600). Does the operator want these to be **business-configurable from day 1** (Settings field) or **hardcoded in v1, with override deferred to SP7**? **Recommendation:** hardcode in v1; ship the override in SP7 once we see whether other tenants in higher-AOV verticals (mechanic engine work, detailing packages) need it.

13. **Settings accordion placement for "Customer Directory" section.** Add as a new top-level accordion in Settings, or nest under the existing "Operations" section? **Recommendation:** new top-level section labeled "Customer Directory" — it's a coherent feature pile (auto-save toggle + backfill button + future retention-campaign opt-ins) and deserves its own surface.

14. **(v3 NEW — v3.1 RESOLVED)** ~~Twilio number identification & registration.~~ **User confirmed 2026-06-03: no Twilio business number selected yet.** Number selection is deferred to whenever the operator chooses. SP1-SP3 ship without requiring a number. SP4 ships as dormant infrastructure (`TWILIO_WEBHOOK_ENABLED=false`). The Settings → Communications → Connect form remains in the spec but is exercised by the operator only when ready. **No blocker for the priority Customer Directory + Intelligence work.**

15. **(v3 NEW — v3.1 RESOLVED)** ~~Twilio call forwarding confirmation.~~ **User confirmed 2026-06-03: no call forwarding configured yet.** Forwarding is a SP4 activation prerequisite, not a SP1-SP6 blocker. SP6 popup ships dormant and is testable via the **Test Incoming Call** admin action (see SP6 scope). When the operator later activates SP4, the Settings → Communications connect form will surface the four-URL checklist + forwarding-acknowledgement gate before flipping `settings.twilioConnected = true`. **No blocker for the priority Customer Directory + Intelligence work.**

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

---

## v2 Update Log

This pass applied the user's answers to the seven deferred open questions plus three NEW first-class requirements (Global Search, Customer Insights, Auto-save toggle). All changes land within the existing SP1-SP7.5 dev-execution structure with no new sub-projects. Phase numbering expanded from 12 to 18.

### Header / framing changes
- Status flipped: `Draft — pending user approval` → `v2 — user-answered, pending final approval`.
- Scope updated: "user phases 1-12" → "user phases 1-18".
- Added a new top-level *User Answers to Open Questions (resolved) — v2 changelog* section recording all seven user answers verbatim plus the three NEW requirements and the vertical-agnostic framing principle.

### Goal & Success Criteria
- Appended *v2 scope additions* paragraph explicitly stating: (a) OpenPhone is optional in v1 (gated by `QUO_WEBHOOK_ENABLED` + `settings.openphoneConnected`); (b) entity model is vertical-agnostic from day 1; (c) Global Search + Customer Insights + Auto-save toggle are first-class v1 requirements (not future seams).

### Data Model
- **Customer schema:** added `nameLower`, `companyName`, `companyLower`, `cityLower`, `zipCode`, `averageTicket` (computed rollup), `customerStatus` (derived rollup), `vipTier` (derived rollup), `referralCount` (schema-only).
- **Customer indexes:** added 6 new indexes for global-search and Customers-page filter-by-tier/status.
- **Customer rule allowlist:** expanded to include all new fields.
- **Vehicle schema:** added universal core fields (`year`, `make`, `model`, `trim`, `color`, `makeModelLower`); hoisted tire-specific fields under `vehicle.tire.{size, alternateSize, brand, condition, tpmsNotes, wheelLockNotes}` sub-object; added placeholder `vehicle.mechanic` and `vehicle.detailing` sub-objects (schema-only); marked legacy flat fields (`vehicleType`, `vehicleMakeModel`, `vehicleSize`) as backward-compat read-only.
- **Vehicle indexes:** added 3 new collection-group indexes for global search.
- **`vehicleKey()` algorithm:** updated to prefer universal `year-make-model-trim` slug; legacy tire-vertical keys retained as fallback.
- **Settings schema:** added `autoSaveCustomersFromJobs`, `openphoneConnected`, `outboundCommunicationProvider`, `autoTextBackEnabled` fields with defaults and migration notes.
- **New section: Vertical-Agnostic Entity Design** documenting the six principles that keep the system non-tire-coupled.

### Phone Number Normalization
- Updated the `phoneKey canonical form` paragraph to make explicit that SP3's backfill (now confirmed) renames every legacy `p_<10-digit>` doc to `p_<11-digit>` and adds `phoneKey` to docs that lack it. The hybrid second-chance lookup is now a *transitional safety net* rather than a permanent fallback.

### System Components
- Added 8 new component rows: `searchCustomers.ts`, `GlobalSearchSheet.tsx`, `CustomerInsightsCard.tsx`, `customerInsights.ts`, `onJobWriteCustomerRollup.ts`, `backfillCustomers.ts`, `AddressAutofillInput.tsx`, `CustomerDirectorySettingsSection.tsx`.

### OpenPhone Integration
- Added new **OpenPhone-Optional Architecture (v2)** section documenting the two-layer gating (`QUO_WEBHOOK_ENABLED` global + `settings.openphoneConnected` per-business), the unconnected-mode UX, and the activation flow.

### AddJob Workflow Change
- Replaced v1's loose ordering with the confirmed 8-step explicit order: Phone → Lookup → Vehicle → Quick Pricing → Service Type → Tire Size → Location → Notes.
- Added vertical dispatch note on step 6 (Tire Size becomes the vertical's `primaryDomainField` for non-tire verticals).
- Inserted `AddressAutofillInput` into step 7 (Location).
- Updated saveJob snippet to read `settings.autoSaveCustomersFromJobs` and skip `upsertCustomerFromJob` when false. Added toast on save when toggle is OFF.

### Customer Profile Actions
- Updated Call (#3) and Text (#4) rows: v1 always uses `tel:` / `sms:`; SP7 introduces `outboundCommunicationProvider: 'native' | 'openphone'` per-business toggle. UI identical; dispatch path differs.

### NEW sections added (in order of appearance)
- **Vertical-Agnostic Entity Design** (after Data Model) — 6 principles.
- **Global Customer Search (Phase 5)** (after Customer Profile Actions) — entry surface, algorithm, performance contract, required indexes.
- **Customer Insights Card (Phase 9)** — 9 metrics, VIP tier derivation, `customerStatus` derivation, rollup persistence recommendation.
- **Auto-Save Customers Setting (Phase 17)** — schema, placement, saveJob integration, UX when OFF, migration.
- **Backfill Existing Jobs (Phase 3)** — function signature, algorithm, idempotency, dry-run, trigger UX, performance.
- **Phase Mapping (user phases 1-18 → sub-projects SP1-SP7.5)** (before Ship Order) — the old-12 → new-18 mapping table.

### Future-Ready Seams
- Appended 5 new seam rows: per-vertical service catalogs, per-business OpenPhone toggle, referral tracking, per-vertical Vehicle sub-objects, per-business VIP thresholds.

### Ship Order (Sub-Projects)
- **SP1** scope expanded with: new Customer fields, new Vehicle fields, tire-fields-hoisting refactor, Settings schema fields, saveJob gate, updated `customerKey()` + `vehicleKey()`. UI surface unchanged (still schema-only).
- **SP2** scope expanded with: confirmed 8-step AddJob order, `AddressAutofillInput`, `companyName` capture, vertical dispatch on step 6.
- **SP3** scope dramatically expanded with: Global Search (component + helper + indexes + main-nav entry), Customer Insights card + helpers + Cloud Function trigger, Customer Directory Settings section + auto-save toggle UI, `backfillCustomers` Cloud Function + admin button, per-vertical service-catalog label lookup.
- **SP4** scope re-emphasized: ships DISABLED by default (`QUO_WEBHOOK_ENABLED=false` + `settings.openphoneConnected=false`); activation is a config-only operation per user answer #1.
- SP5, SP6, SP7, SP7.5 names and boundaries unchanged.

### Out of Scope
- Removed "No backfill of historical jobs" (now confirmed in scope).
- Removed "Address capture in AddJob deferred to SP3" (now in scope in SP2).
- Added "No outbound Quo API for Call/Text buttons in v1 — native `tel:` / `sms:` only" with SP7 deferral.
- Added "No service-vertical-specific search filters in P5 global search."
- Added "No client-side or server-side fuzzy/typo-tolerant search in v1."
- Added "No per-business VIP threshold overrides in v1."
- Added "No external address-autocomplete API in v1."

### Open Questions
- Marked questions 1, 3, 4, 6, 7, 8 RESOLVED with user's verbatim answer.
- Added three new auto-confirmed entries (A, B, C) summarizing the three new requirements and their SP landings.
- Added three new open questions (11, 12, 13) for backfill timing, VIP threshold configurability, and Settings accordion placement — all with recommended defaults.

### Spec coverage summary
- 18 marketed phases (was 12)
- 7 sub-projects (unchanged: SP1, SP2, SP3, SP4, SP5, SP6, SP7, SP7.5)
- 0 new sub-projects — all v2 additions fit cleanly into existing SP boundaries.
- 0 backward-incompatible schema changes for already-shipped collections — the tire-field hoisting is gated by a fallback read path until the SP3 backfill runs.

---

## Review Pass 2 (Workflow-internal)

This pass addressed two adversarial reviews against the v2 spec. Every critical issue called out by either reviewer was either fixed inline or recorded below as deferred-for-user-judgment. No new sub-projects, no scope changes, no headline-architecture changes — all edits are targeted contract refinements.

### Critical issues addressed

1. **Firestore prefix-query syntax bug (both reviews).** The `q + ''` upper bound in every prefix branch was an empty range — fix replaces every branch with `qHigh = q + ''` (`` Private Use Area sentinel) and the phoneKey suffix branch with `qDigits + ':'` (next ASCII after `'9'`). Added: explicit "Critical prefix-query contract" note, regression unit-test (`searching 'te' MUST return Tesla/Tetris/Terra`) committed as the SP3 merge gate, and a three-row ranking acceptance-test rubric. See *Global Customer Search → Algorithm + Critical prefix-query contract + Ranking acceptance tests*.

2. **Scale tiers for global search (Review 2).** Removed the inconsistent "client-side fallback when `customers.length < 1000`" wording (it required loading the full collection to check the length). Replaced with an explicit four-tier table (T0 <1k client-cache; T1 1k-10k server-fan-out; T2 10k-50k paginated + capped; T3 >50k Algolia migration) keyed off a persisted `settings.customerCount` rollup. Documented migration trigger (p95 > 500ms over 24h OR count > 25k). See *Global Customer Search → Scale tiers*.

3. **SP5 / SP6 phase numbering inconsistency (Review 1).** SP5 said "Phases covered: 8" and SP6 said "7, 9, 12" using old 12-phase numbering. Rewrote both to use the new P1-P18 names with parenthetical descriptions: SP5 = P13 (Missed Call framework) + P14 (Communication Logging — leads/send side); SP6 = P12 (Incoming Call Popup). Also clarified SP4 as P14 receive side and SP7 as P18 + P11/P14 extensions for full consistency. See *Ship Order → SP4/SP5/SP6/SP7*.

4. **Auto-Save OFF→ON transition undocumented (Review 1).** Added explicit *OFF→ON transition behavior* subsection: (a) flipping ON does NOT retroactively upsert prior toggle-OFF jobs; (b) Settings panel shows a banner *"You have N jobs saved while auto-save was off. Run Backfill to add them"* scoped by `autoSaveDisabledAt`; (c) banner CTA re-uses the idempotent `backfillCustomers` function. Added Settings field `autoSaveDisabledAt`. See *Auto-Save Customers Setting → OFF→ON transition behavior*.

5. **Manual customer creation path when toggle OFF (Review 2).** Toggle-OFF + new phone in AddJob previously had no explicit affordance — the operator only saw a post-save toast. Added: post-save *"Save this customer to your directory? [Save] [Skip]"* row that synchronously runs `upsertCustomerFromJob` and writes back the FK to the just-saved Job. Added a permanent **"+ New Customer"** button on the Customers page (gated by `canCreateJobs`). See *Auto-Save Customers Setting → Manual customer creation path*.

6. **Backfill ↔ live-saveJob concurrency contract (both reviews).** Re-specified backfill to use the SAME transactional `upsertCustomerFromJob` helper as saveJob (per-job invocation in small parallel batches), NOT a pre-computed bulk-write. This serializes concurrent writes via `processedJobIds` + `runTransaction`. Added an explicit *Live-write concurrency* subsection; added the optional advisory `backfillCustomers.lockedAt` lock pattern; added a "Pause auto-save and run backfill" Settings affordance for very large backfills. See *Backfill Existing Jobs → Live-write concurrency*.

7. **Backfill duplicate-merge conflict resolution undefined (Review 2).** Added explicit *Conflict resolution policy* table: name/email/addressLine/city/state/zipCode/companyName = most-recent-job-wins; firstJobAt = min; lastJobAt = max; tags/note = never-overwritten; backfill audit doc records `backfillConflictsResolved` counters per field. See *Backfill Existing Jobs → Conflict resolution policy*.

8. **`lifetimeRevenue` must not be persisted on Customer doc (Review 1).** The `onJobWriteCustomerRollup` trigger spec previously said it "recomputes lifetimeRevenue + jobCount" without saying it should not persist `lifetimeRevenue`. Added explicit *Critical privacy contract* clause: `lifetimeRevenue`, `lifetimeProfit`, `expensesTotal` MUST NEVER be persisted on the Customer doc; computed in-memory only for deriving `averageTicket` / `vipTier`. Added a Firestore-rules negative check + PR code-review checklist item. See *Customer Insights Card → Rollup persistence + Trigger spec*.

9. **Vehicle subdoc denormalization in `customersSnapshot` under-specified (Review 1).** Replaced the unspecified `Vehicle[]` shape with an explicit `VehicleSnapshotEntry` type listing exactly the fields snapshotted; rewrote the resolveAndWrite pseudocode to pick fields rather than spread the whole doc (drops `processedJobIds`, `createdAt`, etc. from the doc to keep IncomingCalls small). See *Data Model → IncomingCalls schema + Webhook resolveAndWrite pseudocode*.

10. **Tire dual-write transition window (Review 2).** SP1 deploys before SP3 backfill — without dual-write, new tire-vertical reads would only find `vehicle.tire.size` and legacy unmigrated docs would be invisible. Added: SP1 `upsertCustomerFromJob` MUST dual-write tire data to BOTH `vehicle.tire.{size,brand,condition}` AND legacy root `vehicle.tireSize/tireBrand/tireCondition`. Global search runs a parallel legacy-branch query during SP3→SP4 window. Dual-write retired in SP4 once backfill audit confirms hoisting complete. Added explicit "no operator-visible regression at SP1 deploy" to SP1 ship-value. See *Concurrency Contract step 11, Backfill → Dual-write transition window, Global Search → Algorithm dual-read note, SP1 Ships value*.

11. **AddressAutofillInput v1 implementation commitment (Review 2).** Previously vague "lightweight US ZIP → city/state lookup". Committed to Option A: bundled ~200 KB gzipped JSON dataset (~40k US ZIPs) shipped with the client; operator types ZIP first; city/state autofill; `addressLine` is free-text; no external API; no PII off-device. SP7 Google Places path documented as requiring `GOOGLE_PLACES_API_KEY` + per-tenant privacy-policy disclosure. See *AddJob Workflow Change → step 7 + Out of Scope*.

12. **Read-time defaults for new Settings fields (Review 2).** Added explicit *Read-time default contract* subsection: `autoSaveCustomersFromJobs ?? true`, `openphoneConnected ?? false`, `outboundCommunicationProvider ?? 'native'`. TypeScript interface marks fields optional; no backfill of existing Settings docs required. See *Auto-Save Customers Setting → Read-time default contract*.

13. **customerStatus + vipTier overlap (Review 2).** Previous derivation collapsed `'VIP'` into `customerStatus` and lost the signal when a Gold customer was also Fleet. Disambiguated: `customerStatus` is OPERATIONAL only (`'Active' | 'Inactive' | 'Fleet' | 'Archived'` — REMOVED `'VIP'`); `vipTier` is the SEPARATE revenue-tier signal. Both badges render side-by-side. Customers-page filter UX uses two independent filters. Parameterized `activeWindowMs` so SP7 can ship `settings.activeWindowMonths` per-business override. See *Data Model → Customer schema customerStatus + Customer Insights → deriveCustomerStatus*.

14. **VIP tier progress-to-next-tier UX gap (Review 2).** A customer at $999 lifetime revenue had no signal that the next sale would tier them up. Added: CustomerInsightsCard renders a subline under the VIP badge — `"Gold tier in $X"`, `"Platinum tier in $X"`, or `"Top tier reached"` — computed live on the client from `lifetimeRevenue`. No schema change. Documented the 30s rollup-coalescing window as known acceptable lag with client-side fallback when `(lastJobAt - updatedAt) > 30s`. See *Customer Insights Card → Trigger spec + Stale-rollup display contract + Progress-to-next-tier UX*.

15. **Insights computation cost on long-tail customers (Review 2).** Mode-over-all-jobs was unbounded for 500-job customers. Bounded the CustomerProfile jobs query to `orderBy('date', 'desc'), limit(100)`. Lifetime totals stay full-history via the trigger; only `mode()` insights use the bounded window. "See full history" affordance for pagination. Performance contract updated: p95 < 200ms on profile open up to 500 lifetime jobs. See *Customer Insights Card → Insights jobs-load bound*.

### Minor issues addressed (mechanical)

- **Minimum query length** for global search: short-circuits when `q.length < 2 AND qDigits.length < 2`. Documented in algorithm step 1.
- **Mobile keyboard hints**: `inputmode='search'`, `autocapitalize='off'`, `autocorrect='off'`, `spellcheck='false'` on `GlobalSearchSheet` input.
- **One-time-per-session toast** for auto-save-OFF: snippet uses `sessionStorage.getItem('autoSaveOffToastShown')` to fire once per session, not on every save. Mitigates nag-spam.
- **Returning Customer card mock** hardcoded "Tire Replacement · $480 · Paid" replaced with `{label} · ${rev} · {paymentStatus}` template + a "Mock is vertical-agnostic" annotation pointing at `verticalConfig.services[lastJobSummary.service].label`.
- **`activeWindowMs` parameterized** in `deriveCustomerStatus` so SP7 can per-business override the "Active" lookback window without touching the core helper.
- **Trigger × backfill interaction**: documented that backfill flags each job batch-update with `metadata.backfillRun` and the trigger short-circuits when present, preventing N×30s coalescing churn during bulk import.
- **Ranking acceptance tests**: three deterministic test cases (`'3058977030'`, `'7030'`, `'te'`) committed as the SP3 regression test suite for the field-priority order.

### Deferred for user judgment

The following minor issues from either review are judgment calls that the user (not the workflow) should decide on after reading the v2 + Review Pass 2 spec:

- **`processedJobIds` array trim mechanism**: Review 2 flagged "cap at last 100 jobIds" as vaguely described. The current spec keeps it as `FieldValue.arrayUnion(jobId)` + out-of-band trim; the exact trim trigger (every N writes? scheduled cleanup?) is left for SP1 implementation per a code-review note. Pin precisely if you want the spec to commit.
- **Lead conversion + re-miss behavior** (Review 2 minor): if a Lead converts and the same phone misses again, does the converted Lead re-open or a new Lead row get created? Spec is currently silent. Recommend: new Lead row per missed-call episode; converted Leads are immutable. Confirm if you'd like this committed.
- **AddJob address update overwrites Customer doc** (Review 2 minor): when AddJob captures a new address for a returning customer, `upsertCustomerFromJob`'s last-write-wins behavior silently overwrites the Customer doc's previous address. Recommend: keep last-write-wins per the *Concurrency Contract* (operator typing fresh data wants it persisted). Confirm if you'd prefer a "Address changed — confirm update?" affordance instead.
- **Settings accordion placement** for "Customer Directory" (existing OQ #13) — recommendation stands (new top-level section); confirm or override.
- **VIP threshold configurability per-business** (existing OQ #12) — recommendation stands (hardcode v1; SP7 override). Confirm or override.
- **Backfill execution timing** (existing OQ #11) — recommendation stands (run immediately on SP3 deploy). Confirm or override.

### Strengths preserved (no edits)

- OpenPhone-optional two-layer gating, Concurrency Contract on `upsertCustomerFromJob`, Webhook tenant-isolation invariants, Vertical-agnostic Vehicle sub-objects, Soft-delete vs. SP7.5 GDPR/CCPA split, Cross-device Accept/Decline race contract — all flagged as strengths by both reviewers; no changes.

---

## v3 Update Log

This pass pivots the v2 communications layer from Quo (formerly OpenPhone) to Twilio. The user provided 16 new requirements; all are folded into the spec body. The customer/vehicle/search/insights/AddJob/RBAC architecture is unchanged; the provider layer is rewritten end-to-end. v2's `Review Pass 1` / `Review Pass 2` sections are preserved as historical records — they accurately describe v2's design at sign-off and contextualize the v3 deltas below.

### Header / framing changes

- Title changed: "OpenPhone Integration + Customer Intelligence System — Design" → "Twilio Integration + Customer Intelligence System — Design".
- Status flipped: `v2 — user-answered, pending final approval` → `v3 — Twilio pivot (OpenPhone/Quo removed), pending user approval`.
- Added a v3 framing paragraph below the scope line explaining the provider abstraction posture.

### User Answers section

- Q1 rewritten: "Quo/OpenPhone account: will purchase Business plan" → "Twilio is now the primary communications provider; user already has Twilio account + provisioned number".
- Q2 rewritten: "Beta webhook system: Standard Webhooks signing" → "Twilio webhook signature verification (HMAC-SHA1, X-Twilio-Signature)".
- Q6 rewritten: "Phase 1 native tel:/sms:; SP7 OpenPhone API option" → "Twilio is THE provider; provider abstraction permits future additions; v1 Call uses tel:; v1 Text uses Twilio sendSMS when configured, native sms: fallback".
- Q3/Q4/Q5 preserved verbatim from v2 (no v3-impacting changes).

### Goal & Success Criteria

- Rewrote item 3 of the implementation-terms list: removed `quoWebhook` single-handler description; replaced with three-endpoint Twilio model (`twilioIncomingCall`, `twilioIncomingSMS`, `twilioCallStatus`) and added the critical out-of-band-popup architecture note.
- Rewrote v2's "OpenPhone is optional" scope addition as "Twilio is optional at the MSOS layer" — added success criterion #12: MSOS must function with zero Twilio config.

### Architecture Overview

- End-to-end call-flow diagram replaced from Quo-Beta-single-webhook flow to Twilio-three-webhook + concurrent-call-forwarding flow.
- Added explicit "voice webhook does NOT route the call" architecture note: Twilio's number-level call forwarding rings the operator's phone; MSOS popup is an out-of-band signal.

### Data Model

- **incomingCalls schema:** `quoCallId` → `twilioCallSid`. Added `provider: 'twilio'` field. Updated lookup-fallback notes for Twilio's single-user-per-call model.
- **customerStatus enum (v3 update):** added `'VIP'` as a manual-only operator override. Distinct from `vipTier` which remains a derived revenue tier.
- **Vehicle schema (v3 reversal):** v2 hoisted tire fields into `vehicle.tire.*` sub-object; v3 puts them back at TOP-LEVEL (`tireSize`, `alternateTireSize`, `tireBrand`, `tireCondition`, `tpmsNotes`, `wheelLockNotes`). Vertical-agnostic principle preserved: non-tire verticals leave these unset. Removed the `vehicle.tire` / `vehicle.mechanic` / `vehicle.detailing` sub-object structure.
- **Removed collections:** `quoPhoneNumbers`, `quoWebhookEvents`, `quoUserMapping`, `quoSyncCursors`, `quoPhoneNumberOwnershipAudits` → `twilioPhoneNumbers`, `twilioWebhookEvents`, (nothing replaces quoUserMapping — Twilio has no analogue), `twilioSyncCursors`, `twilioPhoneNumberOwnershipAudits`. The `twilioWebhookEvents` idempotency key is now `${endpoint}:${CallSid|MessageSid}` to allow the voice/status webhooks for the same CallSid to coexist.
- **New collections (v3):** `communicationEvents` (unified customer timeline of calls + texts), `callerLookupEvents` (telemetry / audit of every popup-pipeline lookup), `missedCallEvents` (every miss notification, separate from `leads`), `autoTextRules` (schema-only; SP7 rules engine).
- **Settings schema:** removed `openphoneConnected`; added `twilioConnected`, `communicationProvider: 'twilio'` (read-only label), `incomingCallLookupEnabled`, `incomingSMSLoggingEnabled`, `missedCallAutoTextEnabled`, `outboundSMSEnabled`. Updated `outboundCommunicationProvider` enum to `'native' | 'twilio'`.
- **Customer + Vehicle:** reaffirmed `updatedAt` as explicit field per user requirement #3 + #4.
- **Indexes:** added `tireSize` top-level (was `tire.size` in v2); added indexes for the four v3 new collections.

### Provider Abstraction Layer (NEW section)

- New section "Provider Abstraction Layer (v3)" inserted before Twilio Integration. Defines interface `CommunicationProvider` with `handleIncomingCall`, `handleIncomingSMS`, `handleCallStatusUpdate`, `sendSMS`, `verifySignature`, `buildAcceptResponse`. Documents registry pattern. Explains why abstraction is at business-logic layer (not HTTP route layer). Notes that `lookupCustomerByPhone` lives at customer layer, not provider layer.

### Twilio Integration (full rewrite)

- Renamed section "OpenPhone Integration" → "Twilio Integration". Renamed sub-section "OpenPhone-Optional Architecture (v2)" → "Twilio-Optional Architecture (v3)".
- **Replaced single `quoWebhook` endpoint** with three Twilio endpoints (`twilioIncomingCall`, `twilioIncomingSMS`, `twilioCallStatus`) — each with its own URL, payload shape, idempotency key, and response shape. Documented form-encoded payloads (vs JSON for Quo).
- **TwiML responses:** voice returns `<Response><Pause length="1"/></Response>`; SMS returns `<Response/>`; status callback returns 200 + empty body. Documented why minimal TwiML keeps the call forwarding intact (no AI receptionist in v1).
- **Signature verification rewritten:** HMAC-SHA1 (not SHA256), `X-Twilio-Signature` header (not `webhook-signature`), signed content is `URL + sorted POST params (key+value concatenated)` (not `webhook-id.timestamp.rawBody`), base64-encoded, timing-safe compare. Algorithm verified against Twilio's docs. No timestamp signed — replay defense is idempotency + retry window.
- **Idempotency key:** compound key `${endpoint}:${CallSid|MessageSid}` (not just `webhook-id`).
- **Secret management:** new env vars `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`, optional `TWILIO_MESSAGING_SERVICE_SID` + `TWILIO_WEBHOOK_SECRET`. Removed `QUO_WEBHOOK_SIGNING_KEY` + `QUO_API_KEY`.
- **Kill switch renamed:** `QUO_WEBHOOK_ENABLED` → `TWILIO_WEBHOOK_ENABLED` (default `'false'`).
- **Per-business sender resolution:** Messaging Service SID > global `TWILIO_PHONE_NUMBER`.
- **Customer resolution pseudocode rewritten:** all Quo payload paths replaced with Twilio `From` / `To` / `CallSid`. Vehicle snapshot now picks `tireSize` / `tireBrand` (top-level) instead of `tire: {...}`. Added telemetry write to `callerLookupEvents`. Added mirror write to `communicationEvents`. Removed `quoUserMapping` per-call routing branch.
- **New subsection: Outbound SMS (sendSMS):** Firebase callable, owner/admin only, safeguards (env present / `outboundSMSEnabled` / phone valid / message length / rate limit). Logs every send to `communicationEvents`. Returns `messageSid + status`. Graceful "Twilio not configured" failure.

### Communications Settings (NEW section)

- New section between "Auto-Save Customers Setting" and "Backfill Existing Jobs" — defines the Settings → Communications accordion (replaces v2's "Settings → Integrations → Connect OpenPhone" surface). Lists the four toggles + read-only provider label + connect form + derived connected-status display. Cross-links the existing Customer Directory auto-save toggle. Lands in SP4.

### Incoming Call Popup — New Caller variant

- Added New Caller render contract: when `customersSnapshot.length === 0`, popup shows the phone number + three buttons: Create Customer, Create Job, Text Back (uses `sendSMS` when configured, else native `sms:`). Distinct from the shared-phone disambiguation sheet.

### Customer Profile Actions

- Call (#3): updated note from v2's "SP7 outboundCommunicationProvider=openphone" to v3's "SP7 Answer-in-MSOS via Twilio Voice client SDK".
- Text (#4): rewrote from v2's "always native sms:" to v3's "default uses Twilio sendSMS when twilioConnected && outboundSMSEnabled; native sms: fallback".

### Future-Ready Seams

- Updated auto-text-back row: now references `autoTextRules` collection (schema in v1) + `sendSMS` callable (v1) — SP7 only builds the rule evaluator.
- Updated two-way SMS thread row: notes `communicationEvents` already structures the data; SP7 only adds the UI.
- Updated FCM row: references `twilioIncomingCall` not `quoWebhook`.
- Replaced "Per-business OpenPhone toggle" seam with "Per-business Twilio integration" seam (all flags shaped in v1).

### Ship Order

- **SP1:** Settings schema expanded to include all v3 communications flags (schema only; no UI).
- **SP4 fully renamed:** "Quo webhook + idempotency + business-number mapping" → "Twilio webhooks (3 endpoints) + sendSMS + provider abstraction + business-number mapping". Scope expanded to include the three webhook endpoints, `sendSMS` callable, provider abstraction files, four new collections' rules, the v3 Settings panel. `TWILIO_WEBHOOK_ENABLED=false` + `settings.twilioConnected=false` default. Operator activation flow rewritten (no `whsec_` key paste; instead SID + E.164 + Twilio console URL configuration).
- **SP5:** Lead-creation trigger moved from `call.missed` Beta event to `twilioCallStatus` callback with `CallStatus=no-answer|busy|failed`. Adds `missedCallEvents` writes.
- **SP6:** New Caller card variant added to scope explicitly.
- **SP7:** Outbound SMS bulk-send + templates + scheduled-sends added. AI receptionist + Answer-in-MSOS added. Auto-text-back now driven by the `autoTextRules` engine (v1 has the schema; SP7 has the evaluator).
- **SP7.5:** Twilio REST API recording-delete in cascade; communicationEvents/missedCallEvents/callerLookupEvents added to the per-customer scrub list.

### Out of Scope

- Added: "No Twilio number provisioning automation — operator owns the number in Twilio's console."
- Added: "No multi-channel messaging (WhatsApp, MMS, RCS) in v1 — text-only SMS."
- Added: "No AI receptionist / TwiML `<Say>` / `<Gather>` / `<Dial>` verbs in v1 — minimal TwiML pause keeps call forwarding intact."
- Rewrote Quo-specific outbound-API line to reflect v3's `sendSMS` for Text + tel: for Call posture.
- Updated GDPR section to reference Twilio recording deletion via REST API (not Quo CDN).
- Updated two-party-consent recording disclosure language to reference Twilio's compliance docs.

### Open Questions

- Q1 rewritten as RESOLVED with Twilio account confirmation.
- Q7 rewritten from "Quo Beta signup" to "Webhook signature verification algorithm" (HMAC-SHA1 documented and verified).
- Q8 rewritten from "outboundCommunicationProvider: 'native' | 'openphone'" to "Call uses tel:; Text uses sendSMS when configured".
- Added Q14 (Twilio number identification + Phone Number SID — operator action) and Q15 (call forwarding configuration confirmation — operator action). Both are operator-side actions, not MSOS-side decisions.

### Spec coverage summary

- 18 marketed phases (unchanged from v2).
- 8 sub-projects (unchanged: SP1, SP2, SP3, SP4, SP5, SP6, SP7, SP7.5).
- 0 new sub-projects in v3 — the Twilio pivot fit cleanly inside SP4's expanded scope.
- 4 new Firestore collections (`communicationEvents`, `callerLookupEvents`, `missedCallEvents`, `autoTextRules`).
- 5 new Cloud Functions (`twilioIncomingCall`, `twilioIncomingSMS`, `twilioCallStatus`, `sendSMS`, `adminConnectTwilioNumber`). 1 new scheduled function (`reconcileTwilioCalls`). 2 new helper libraries (`communicationProvider`, `twilioClient`).
- 1 architectural reversal vs v2: Vehicle tire fields are TOP-LEVEL again (not `vehicle.tire.*` sub-object).
- 0 backward-incompatible changes to v2 customer/vehicle/job/search/insights/AddJob/RBAC architecture.

---

## v3.1 Update Log

This pass locks in the **priority and dormancy contract** confirmed by the user on 2026-06-03 (Q14, Q15 answers):

- **Q14 RESOLVED:** No Twilio business number selected yet. Customer Directory + Customer Intelligence are the priority. Build everything (including the incoming-call popup UI) independently of Twilio.
- **Q15 RESOLVED:** No call forwarding configured yet. Communication provider architecture must assume Twilio may not be active initially.

### Changes in v3.1

1. **Status line** updated to `v3.1 — Twilio-deferred priority lock + dormant-popup contract, pending user approval`.
2. **Priority lock callout** added immediately under the status header. Names SP1, SP2, SP3 as the priority slice that ships complete operator-visible value with ZERO Twilio configuration. Names SP4 and outbound SMS as fully dormant infrastructure deployable with no env vars set.
3. **SP6 dependency relaxed** — removed strict SP4 dependency. SP6 now depends only on SP1 and SP3. SP6 ships dormant (the listener attaches and waits; no `incomingCalls` docs → no popup → zero noise). The popup activates when ANY writer produces an `incomingCalls` doc — Twilio webhook (SP4 when activated) OR the new Test Incoming Call admin action (added in SP3).
4. **Test Incoming Call admin action** added to Communications Settings as item 9. Owner-only client-side write of a synthetic `incomingCalls` doc with `provider: 'test'` for end-to-end SP6 dogfooding without Twilio. 60s TTL so the synthetic doc doesn't pollute customer history.
5. **Communications Settings accordion split between SP3 and SP4** (was SP4-only). SP3 ships items 1, 2, 4-9 with the Connect form rendered disabled. SP4 enables the Connect form and the event-related toggles' effects. This ensures the priority slice (SP3) delivers a fully usable Communications surface — including Test Incoming Call — without waiting on Twilio Cloud Functions to deploy.
6. **Open Questions Q14 and Q15** marked resolved with strikethroughs and user-confirmation timestamps. No new open questions introduced.
7. **SP6 ship order note:** SP6 can ship at any point after SP3; the marketed numbering keeps SP4 → SP5 → SP6 for clarity, but engineering can land SP6 before SP4 without breaking anything. SP5 (Leads / missed-call workflow) still requires SP4 since it consumes real Twilio webhook events.

### Implementation impact summary

| Question | Before v3.1 | After v3.1 |
|---|---|---|
| Can SP1, SP2, SP3 ship without a Twilio number? | Yes (intended, but SP6 popup felt blocked by SP4) | Yes (explicit, SP6 popup fully ships in dormant mode and is dogfoodable) |
| Can the operator see the incoming-call popup UI before Twilio is connected? | No | Yes — via Settings → Communications → Test Incoming Call |
| Does Twilio activation require a code deploy? | No (config + env flag flip) | No (unchanged) |
| When can SP6 start? | After SP4 | After SP3 |

### Scope unchanged in v3.1

- v3 Twilio integration architecture (3 webhook endpoints, HMAC-SHA1 signature verification, sendSMS callable, Provider Abstraction Layer) — unchanged.
- v2 customer/vehicle/search/insights/AddJob/RBAC architecture — unchanged.
- v2 ship order (SP1 → SP2 → SP3 → SP4 → SP5 → SP6 → SP7 → SP7.5) — unchanged for marketing purposes; engineering execution can land SP6 between SP3 and SP4 without altering the spec.
- Open Questions Q3 (backfill), Q4 (auto-text), Q5 (address autofill), Q6 (outbound provider), Q9 (entity ID), Q10 (toast), Q13 (provider abstraction) — all still resolved per their v2/v3 answers.

---

## v3.2 Update Log

This pass applies **nine user-confirmed refinements** captured on 2026-06-03 in the final pre-SP1 sign-off review. All refinements concern the Customer Directory module — no Twilio architecture changes, no Vehicle / Job / RBAC / Search / Insights changes beyond what each refinement explicitly touches. v3 / v3.1 priority lock and dormant-Twilio contracts are preserved verbatim.

### Header / framing changes

- **Status line** updated to `v3.2 — final pre-SP1 refinements: Customer Hub nav, Quick Notes, Fleet kind, photos aggregation, System of Record callout, pending user approval`.
- **System of Record callout** added directly below the v3.1 Priority Lock callout, citing refinement #9 verbatim and explaining the future-proofing posture for schemas, indexes, RBAC, and contributor priority.
- **Top-level Navigation callout** added below the System of Record callout, locking the canonical Dashboard / Jobs / Customers / Inventory / Analytics / Settings order and flagging the six-tab UX viability with the MoreSheet overflow recommendation.

### Architecture Overview

- New **High-level navigation** sub-section at the top of Architecture Overview showing the six-tab bottom-nav diagram and naming `/customers` as the entry path to CustomerHub. Component file: `src/pages/Customers.tsx` (evolves in place; no fork).

### Data Model

- **Customer schema:** added `kind: 'individual' | 'fleet'` (default `'individual'`) per refinement #6. DATA MODEL ONLY — no fleet workflow UI in v1. `companyName` description amended: informational for individuals, required when `kind === 'fleet'`.
- **Customer schema:** added 8 Quick Notes fields per refinement #2 — `gateCode`, `apartmentNumber`, `wheelLockKeyLocation`, `tpmsNotes`, `preferredPaymentMethod`, `parkingInstructions`, `preferredContactMethod`, `generalNotes`. No indexes in v1.
- **Customer rule allowlist:** expanded to include `kind` and all 8 Quick Notes fields in both the meta-write (owner/admin) and identity-upsert branches.
- **New section:** *Customer Quick Notes (v3.2 user-confirmed)* directly under the Customer schema — defines the auto-attach behavior (read live from Customer doc; never copied into Job; retroactive edits propagate), the SP1 / SP2 / SP3 split, and the RBAC posture.

### AddJob Workflow Change

- **Returning Customer card spec:** added a Quick Notes auto-render paragraph (refinement #2 cross-reference). When **Use Customer** or **Repeat Last Service** fires, the customer's 8 Quick Notes fields render as a non-dismissable info card pinned at the top of the job notes section. Live read from the Customer doc; no field copy into the Job.

### Customer Profile Actions

- **Repeat Last Service (button #2)** row rewritten with the explicit field-clone list (per refinement #3): service type, vehicle + tire identity, customer identity, location, source, payment. **Price stays editable** — `revenue` / `tireCost` / `materialCost` are NOT cloned. Behavior identical to the AddJob CTA; both wire to `cloneLastCompletedJobIntoDraft(customerId)`. The CustomerProfile surface widens reach to operators drilling in from search / Customer Hub.

### NEW section: Customer Profile Sections (v3.2 user-confirmed)

- Locks the canonical Customer Profile section order: Header → Quick Actions → Insights → Vehicles → **Quick Notes (NEW)** → Service History → **Service History Photos (NEW)** → Notes → Communication log.
- **Quick Notes placement** between Vehicles and Service History so technicians drilling into a profile mid-job have the notes visible without scrolling past timeline cards.
- **Service History Photos** sub-section (refinement #7) — pure rendering, no storage changes. Aggregates `Job.photos[]` across the bounded 100-job window into service-type groups; tap-through opens existing JobDetailModal scrolled to its Photos sub-section.

### Ship Order

- **SP1** scope expanded with: (a) top-level Customers nav route + skeleton CustomerHub page (refinement #1 — verified six-tab viability with MoreSheet overflow recommendation), (b) Customer Quick Notes fields SCHEMA ONLY (refinement #2), (c) Customer `kind` enum SCHEMA ONLY (refinement #6).
- **SP2** scope expanded with: AddJob Quick Notes auto-attach info card component (`QuickNotesInfoCard.tsx`) per refinement #2.
- **SP3** scope expanded with: (a) Quick Notes edit surface on CustomerProfile (refinement #2 UI), (b) Repeat Last Service CustomerProfile button (refinement #3), (c) Service History Photos aggregation component `src/components/customerProfile/ServiceHistoryPhotos.tsx` (refinement #7).
- **SP4 / SP5 / SP6 / SP7 / SP7.5** — unchanged in v3.2.

### Phase Mapping

- **P1 Customer Directory** row updated to include the top-level Customers nav route + skeleton CustomerHub page (refinement #1).

### Refinements 4, 5, 8 — reaffirmation only

- **Refinement #4 (Customer Search):** reaffirmed. Already specified as Phase 5 / SP3 in v2/v3 with global search across phone / name / company / tire size / vehicle / license plate / city. No spec change in v3.2 — refinement #4 reinforces priority only.
- **Refinement #5 (Customer Lifetime Value):** reaffirmed. Already specified in v2/v3 Customer Insights card with Lifetime Revenue, Total Jobs, Average Ticket, Last Service Date, plus VIP tier badge (Gold $1,000+, Platinum $2,500+). No spec change in v3.2 — refinement #5 reinforces priority only.
- **Refinement #8 (Customer Timeline newest-first):** reaffirmed. Already specified in v2/v3 SP3 with newest-first ordering. The Customer Profile Sections canonical order section (above) now explicitly enumerates the per-row fields — service type, date, location, price (gated by RBAC), vehicle (year + make + model), technician.

### Refinements 9 — callout-only

- **Refinement #9 (System of Record):** added as a verbatim-citation callout block at the top of the spec (below the v3.1 Priority Lock). Calls out future-proof schemas, scalable indexes, production-grade RBAC, and the explicit instruction that future contributors must not deprioritize Customer Directory work.

### Implementation impact summary

| Question | Before v3.2 | After v3.2 |
|---|---|---|
| Where is the Customers tab? | Implicit / inside Settings or Jobs | Top-level fifth tab in canonical six-tab nav |
| Do Quick Notes auto-attach during future jobs? | Not specified | Yes — non-dismissable info card at top of AddJob notes section |
| Is `kind: individual \| fleet` on the Customer schema? | No (companyName implied fleet) | Yes (default `'individual'`); fleet workflow deferred to a future SP |
| Are Service History photos aggregated on CustomerProfile? | No (operator opened individual jobs to see photos) | Yes — grouped by service type, bounded by 100-job window, tap-through to JobDetailModal |
| Does the spec call out Customer Directory as a System of Record? | Implicit | Explicit callout cited from refinement #9 |

### Scope unchanged in v3.2

- v3 / v3.1 Twilio integration architecture, dormant-popup contract, Priority Lock — all unchanged.
- v2 search / insights / RBAC / AddJob 8-step order — unchanged beyond the Quick Notes auto-attach addition.
- Open Questions Q1-Q15 — all still resolved per their v2 / v3 / v3.1 answers; no new open questions introduced.
- Sub-project shipping order SP1 → SP2 → SP3 → SP4 → SP5 → SP6 → SP7 → SP7.5 — unchanged. All v3.2 additions fit cleanly inside SP1 (schema + nav route), SP2 (Quick Notes auto-attach card), and SP3 (Quick Notes edit + Repeat Last Service surface + Service History Photos).
