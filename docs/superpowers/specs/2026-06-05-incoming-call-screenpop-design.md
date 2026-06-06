# Incoming Call Screen-Pop — Phase 1 Design

**Date:** 2026-06-05
**Author:** ArchitectUX
**Status:** Shipped (server-side dormant; client-side active on the
existing missed-call path)

## Problem

The operator needs a real-time caller-ID popup whenever a call rings
the business line — not just after the call is missed. Today's flow
relies on the `twilioVoiceStatus` Twilio Status Callback, which fires
**after** the call ends. By the time the popup arrives, the operator
has already answered (or missed) the call and the screen-pop is a
post-mortem rather than a heads-up.

## Architectural conflict

A real-time popup and a normally-ringing phone are in tension:

- **Twilio handles the call → real-time popup is free, audio is degraded.**
  Twilio dials the operator's cell from the Twilio number; on iOS the
  operator sees "Twilio +1 555…" rather than the caller's name, and
  the call quality is a Twilio leg over data instead of native cell.
- **Cell carrier handles the call → audio is native, no popup hook.**
  Customer dials business line → carrier forwards to operator's cell
  → call rings. Twilio never sees the live ring, so the only signal
  is the post-call status callback (the current `twilioVoiceStatus`).

## Resolution: T-Mobile SimRing

T-Mobile (and most US carriers in some form) supports **SimRing /
Multi-Ring** — the business line rings the operator's cell **AND**
the Twilio number **simultaneously**. The operator answers on their
cell (native audio, real caller ID); Twilio's leg has no audio
purpose, but it does invoke the Twilio Voice URL the moment the ring
begins. Our `twilioIncomingCall` Cloud Function listens at that URL,
writes a Firestore doc with the caller's identity, and returns
`<Hangup/>` so Twilio drops its leg cleanly.

Net effect: native audio + real-time screen-pop, no operator workflow
change beyond configuring SimRing once on the T-Mobile portal.

Phase 1 ships the code dormant. Phase 2 (operator activation) is
purely operator-side: confirm SimRing on T-Mobile, point the Twilio
Voice URL at `twilioIncomingCall`. No code change required to switch
on.

## Component dual-source subscription

`IncomingCallNotification.tsx` subscribes to **two** Firestore streams:

1. `businesses/{bid}/leads` (`source='missed_call'`, `receivedAt >
   mountTime`) — the existing SP4B path. Fires on the POST-CALL Twilio
   Status Callback. Active in production today.

2. `businesses/{bid}/incoming_calls` (`receivedAt > mountTime`) — the
   Phase 1 real-time path. Fires DURING the live ring, dormant until
   operator activates SimRing.

Whichever doc lands first triggers the popup. Per-session phone-keyed
dedup (`dismissedPhonesRef`) prevents the post-call Lead from
re-triggering after the real-time `incoming_call` has already fired
(and vice versa). Each phone gets at most ONE popup per page session.

## Compact banner → full popup UX

Default arrival is a slim ~72px banner sliding down from the top of
the viewport (`bannerStyle.animation: slideDownFromTop 200ms`). After
5 seconds of no interaction the banner auto-expands into the full
modal-style popup (matching the existing post-miss popup aesthetic).
Tap the banner to expand immediately. ESC + backdrop tap dismiss in
both modes; 30s auto-dismiss in full mode.

Rationale: a screen-pop that interrupts the operator MID-CALL with
a full-screen modal would obstruct in-progress work. The banner is
the "you've got an incoming call" heads-up; the full popup is the
"you have a moment, here's the customer history" follow-on.

## `twilioIncomingCall` function role (dormant)

- **Trigger:** Twilio Voice URL webhook (NOT the status callback).
  Fires once per inbound ring.
- **Routing:** look up the business via the same
  `collectionGroup('operational_settings')` query on `twilioPhoneNumber`
  used by `twilioVoiceStatus`.
- **Customer lookup:** check `businesses/{bid}/customers/p_{digits}`.
  Found → `customerId` + `customerExists: true`. Missing → both null
  / false. Component renders Known vs Unknown UI accordingly.
- **Doc write:** `businesses/{bid}/incoming_calls/{callSid}` with
  `{ from, to, customerId, customerExists, receivedAt, direction,
  callStatus: 'ringing', expiresAt }`. CallSid-keyed → natural
  idempotency on Twilio retry.
- **Response:** `<Response><Hangup/></Response>`. Twilio drops its
  leg cleanly; the operator's cell keeps ringing on T-Mobile.

## TTL on `incoming_calls` docs

Each doc carries `expiresAt = receivedAt + 60s`. The popup's
auto-dismiss is 30s; the extra buffer covers late-arriving
subscribers (slow device wake, brief network blip).

**Operator setup required:** Firebase Console → Firestore → TTL → Add
Policy. Declare `incoming_calls.expiresAt` as the TTL field. Without
this, docs accrue indefinitely — non-fatal but wasteful (~one doc per
inbound call, retained forever instead of 60s).

## Failure modes

| Failure | Behavior |
| --- | --- |
| Twilio signature invalid | Function returns 403. Twilio sees a hard failure, no retry. Operator's cell still rings on T-Mobile. No popup. |
| Business not found for `To` | Function logs warn, returns `<Hangup/>` + 200. No popup. Likely operator misconfigured `twilioPhoneNumber` in operational settings. |
| Customer lookup error | Function falls through with `customerId: null` (unknown-caller UI). |
| `incoming_calls` write fails | Function logs error, returns `<Hangup/>` + 200. Operator's cell still rings; degraded popup UX but call still connects. |
| Internal exception | Always returns 200 + `<Hangup/>`. Never a Twilio retry storm. |

## Indexes

The `where('receivedAt', '>', mountTime) orderBy('receivedAt', 'desc')
limit(1)` query against `incoming_calls` runs against the single-field
`receivedAt` index, which Firestore auto-creates. No composite index
required, no `firestore.indexes.json` entry needed.

## Firestore rules

`businesses/{bid}/incoming_calls/{callId}` is read-only for members of
the business; writes are blocked from the client. The Cloud Function
writes via Admin SDK, which bypasses rules.

Note this is intentionally distinct from the existing
`businesses/{bid}/incomingCalls/{callId}` collection (camelCase, SP6
test-call admin write path). The two collections have different
lifecycles (TTL ~60s here vs operator-managed there) and different
sources (Twilio webhook here vs client admin write there).

## Pure helpers (for tests)

- `computeBadgeState(jobCount)` — Repeat / VIP thresholds.
- `shouldShowLead(lead, mountMs, receivedMs)` — boundary at
  `receivedMs > mountMs`, filters `lead-test-` prefix.
- `shouldShowIncomingCall(call, mountMs, receivedMs)` — mirrors
  `shouldShowLead`; filters `call-test-` prefix and missing-from.
- `computeBalanceDisplay(customer, openInvoiceTotal)` — takes the max
  of `customer.balance` and `openInvoiceTotal`; suppresses negative
  balances (credit, not debt); never double-counts.
- `twilioIncomingCall.__testHooks.decide(form, existingCustomer)` —
  pure doc-shape decision tree; skip vs write with reasoned shape.

## Phase 2 (operator activation)

1. Operator confirms T-Mobile plan supports SimRing / DIGITS.
2. T-Mobile portal → configure SimRing to ring Twilio number in
   parallel with cell.
3. Twilio Console → Phone Numbers → [Number] → Voice & Fax →
   "A Call Comes In" → Webhook →
   `https://us-central1-mobile-service-os.cloudfunctions.net/twilioIncomingCall`.
4. Firebase Console → Firestore → TTL → Add Policy on
   `incoming_calls.expiresAt`.
5. Test by calling the business line. Within 1-2 sec of the live
   ring, every connected operator device shows the banner.

No code change is required for activation. The function is bytecode
in the Cloud Functions runtime with zero traffic until the Twilio
Console URL points at it.
