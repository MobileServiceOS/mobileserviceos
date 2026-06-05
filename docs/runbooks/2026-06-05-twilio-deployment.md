# Twilio Integration Deployment Runbook

**Target date:** 2026-06-05
**Scope:** Flip SP4A (outbound review SMS) and SP4B (inbound missed-call webhook) from dormant to live in production.
**Status before this runbook:** Both features implementation-complete. Smoke 20/20 PASS at commit `89409f9`. Drainers + trigger + queue all run, but `TWILIO_NOT_CONFIGURED` keeps every send short-circuited until the env vars below are populated.

---

## 0. Heads-up before you start

This runbook is the FIRST live Twilio cutover for this codebase. Two things to know up front:

1. **Twilio credentials are not yet declared as Firebase secrets in the function options.**
   The Twilio code (`functions/src/lib/twilioClient.ts`, `functions/src/lib/twilioSignatureValidator.ts`) reads `process.env.TWILIO_*` directly, but the consuming functions (`drainReviewRequests`, `drainOutboundSms`, `twilioVoiceStatus`, the two callables) do NOT declare `secrets: ['TWILIO_AUTH_TOKEN', …]` in their `onSchedule` / `onRequest` / `onCall` options. That means `firebase functions:secrets:set TWILIO_AUTH_TOKEN` will store the value in Secret Manager but it WILL NOT be injected into the runtime env at function startup.

   The supported path until that small refactor lands is `functions/.env` (Firebase Functions v2 reads it and exposes the values as `process.env.*`). This is acceptable for a single-tenant cutover; secret-grade rotation should land as a follow-up before the second operator goes live.

2. **Webhook signature validation is silently disabled while `TWILIO_AUTH_TOKEN` is unset.** Don't expose the `twilioVoiceStatus` URL to the public internet before completing Step 2.

---

## 1. Prerequisites

- [ ] Twilio account (paid; trial accounts cannot send to unverified numbers)
- [ ] One Twilio phone number purchased with **Voice + SMS capabilities** in the operator's service area code
- [ ] Twilio Account SID + Auth Token from `console.twilio.com` → Account → API keys & tokens
- [ ] Firebase project access (Editor or Owner on `mobile-service-os`)
- [ ] `firebase` CLI installed and authenticated: `firebase login` → `firebase use mobile-service-os`
- [ ] `gcloud` CLI installed and authenticated (only required if you choose the Secret Manager path in Step 2B): `gcloud auth login` → `gcloud config set project mobile-service-os`
- [ ] A cell phone NOT registered to the business, for the smoke call in Step 5
- [ ] Local working copy on `main` at or after commit `89409f9`

---

## 2. Configure Twilio credentials on Cloud Functions

Pick ONE path. Path A is what works with the code as-shipped today. Path B is the future-state secret-grade path that requires a small code change first.

### Path A — `.env` file (works today, recommended for this cutover)

1. In the repo root, create `functions/.env` (the file is already gitignored via the parent `.gitignore`):

   ```bash
   cat > functions/.env <<'EOF'
   TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   TWILIO_AUTH_TOKEN=your-auth-token-here
   TWILIO_PHONE_NUMBER=+15555550123
   EOF
   ```

2. Verify the file is NOT staged for commit:

   ```bash
   git status functions/.env
   # expected: nothing — file is ignored
   ```

3. Deploy the functions (the `.env` is bundled into the deploy package):

   ```bash
   cd functions
   npm run deploy
   ```

   Equivalent to `firebase deploy --only functions` from the repo root. The pre-deploy hook in `firebase.json` runs `npm run build` first.

4. After deploy completes, verify the env vars are live on the function runtime:

   ```bash
   firebase functions:config:get
   gcloud functions describe drainReviewRequests --region us-central1 --gen2 \
     --format='value(serviceConfig.environmentVariables)'
   ```

   You should see `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` listed.

### Path B — Firebase Secret Manager (requires code change first)

DO NOT use this path until the following one-line change ships:

```ts
// functions/src/drainReviewRequests.ts (and drainOutboundSms.ts, twilioVoiceStatus.ts,
// sendTestReviewSms.ts, sendManualReviewRequest.ts, sendTestMissedCall.ts,
// sendManualOutboundSms.ts)
export const drainReviewRequests = onSchedule(
  {
    schedule: 'every 1 minutes',
    timeoutSeconds: 540,
    memory: '512MiB',
    secrets: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_PHONE_NUMBER'], // ← add
  },
  // ...
);
```

Once that ships, the operator-side becomes:

```bash
firebase functions:secrets:set TWILIO_ACCOUNT_SID
firebase functions:secrets:set TWILIO_AUTH_TOKEN
firebase functions:secrets:set TWILIO_PHONE_NUMBER
cd functions && npm run deploy
```

Tracked as a follow-up before second-tenant rollout.

---

## 3. Configure Twilio Console

After the functions are deployed and the env vars are live:

1. Go to `console.twilio.com` → Phone Numbers → Manage → Active numbers → click the purchased number.

2. **Voice & Fax section:**
   - **A Call Comes In:** leave at default (or your existing IVR if you have one).
   - **Call Status Changes** (this is the SP4B hook):
     - URL: `https://us-central1-mobile-service-os.cloudfunctions.net/twilioVoiceStatus`
     - Method: **HTTP POST**
   - Twilio's Voice Status Callback fires on the events `initiated`, `ringing`, `answered`, `completed`. The webhook handler keys off `CallStatus === 'no-answer'` / `'busy'` / `'failed'` (see `functions/src/twilioVoiceStatus.ts`); other statuses short-circuit with a 200. There is no per-event opt-in in the Console — Twilio sends all of them.

3. **Messaging section (for SP4A outbound):**
   - No configuration needed in the Console. Outbound SMS is initiated by our function with the purchased number as the `From`.
   - If the number is a long code (10DLC), make sure it's been registered with The Campaign Registry and assigned to a Messaging Service. Untagged 10DLC traffic is filtered by US carriers.

4. **Save** the number configuration. Twilio applies it immediately.

---

## 4. Activate the features

### 4A. SP4A — outbound review SMS

No per-business toggle. The instant `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_PHONE_NUMBER` are live on the function runtime, the next 1-minute `drainReviewRequests` tick will drain any `pending` review requests that have accumulated while dormant.

Verify:

```bash
firebase functions:log --only drainReviewRequests --lines 50
```

Look for `[drainReviewRequests] done { scanned: N, sent: N, … }` with non-zero `sent` (assuming there's a pending queue) and NO `TWILIO_NOT_CONFIGURED` lines.

### 4B. SP4B — missed-call recovery

Per-business activation:

1. Sign in as the operator → **Settings** → **Missed Call Recovery**.
2. Expand the accordion.
3. Paste the purchased Twilio number into the **Business phone number** field in E.164 format (e.g. `+15555550123`).
4. Toggle **Missed Call Recovery** to ON.
5. (Optional) Customize the auto-text template. The default lives in `src/lib/missedCallDefaults.ts` (`DEFAULT_MISSED_CALL_TEMPLATE`).
6. **Save.**

The webhook routes inbound `CallStatus=no-answer|busy|failed` events to this business by exact match on `twilioPhoneNumber == form.To` (collection-group query in `functions/src/twilioVoiceStatus.ts:222-230`).

---

## 5. Smoke verification (live)

**Required after every deploy that touches the Twilio config.**

### 5A. SP4B inbound test

1. From a cell phone NOT registered to the business, call the Twilio number.
2. Don't answer; let it ring out to voicemail / hang up after 4-5 rings.
3. Within 60 seconds:
   - [ ] Operator-side Firestore: a Lead doc appears at `businesses/{businessId}/leads/{leadId}` with `phoneE164` set to the caller's number.
   - [ ] An `outboundSms` doc appears at `businesses/{businessId}/outboundSms/{smsId}` with `status: 'pending'`.
   - [ ] On the next `drainOutboundSms` tick, `status` flips to `sent` and your cell phone receives the auto-text SMS.
   - [ ] The Lead doc's `autoTextSent` field flips to `true`.
4. Open the Leads tab in the app — the new Lead should appear at the top with the priority badge.

If the Lead never appears, check `firebase functions:log --only twilioVoiceStatus --lines 30` for `[twilioVoiceStatus] no business found for To` (= phone number mismatch in Settings) or `[twilioVoiceStatus] signature invalid` (= `TWILIO_AUTH_TOKEN` mismatch).

### 5B. SP4A outbound test

1. In the operator app, complete a Job (mark it Done from the Job detail screen).
2. Within 60 seconds, the customer's phone receives the review-request SMS.
3. Verify the `businesses/{businessId}/reviewRequests/{id}` doc transitioned `pending → sent` with `messageSid` populated.

Alternative test path (no real job required): **Settings → Customer Communications → Send Test Review SMS** button. Fires `sendTestReviewSms` callable with `isTest: true` so it bypasses guards.

---

## 6. Cost expectations

- **Outbound SMS (US, long code or toll-free):** ~$0.0079 per segment + ~$0.0050 carrier surcharge ≈ **$0.013 per 160-char message**. Multi-segment messages are billed per segment.
- **Outbound MMS (US):** ~$0.0200 per message + carrier surcharge.
- **Inbound voice (for the Status Callback to fire, the call has to land on the Twilio number):** ~$0.0085/min for a long code, $0.0220/min toll-free. A missed call that rings out for 20s costs ~$0.003.
- **Phone number rental:** $1.15/month long code, $2.00/month toll-free.
- **Webhook delivery (Twilio → our function):** free.

For a 100-customer/month service business, expected monthly Twilio spend is **~$3-8** assuming ~150 outbound SMS + ~30 missed-call recoveries.

Verify live pricing at `https://www.twilio.com/sms/pricing/us` and `https://www.twilio.com/voice/pricing/us` — these numbers move.

---

## 7. Monitoring

Firebase Functions logs are the single source of truth post-deploy.

```bash
# SP4B inbound funnel
firebase functions:log --only twilioVoiceStatus --lines 100

# SP4A drainer
firebase functions:log --only drainReviewRequests --lines 100

# SP4B drainer
firebase functions:log --only drainOutboundSms --lines 100

# All four at once
firebase functions:log --only twilioVoiceStatus,drainReviewRequests,drainOutboundSms,onJobCompletedReviewRequest --lines 200
```

Useful log prefixes to grep for:

- `[twilioVoiceStatus]` — webhook routing, signature, dedup
- `[drainReviewRequests]` — SP4A tick summary
- `[drainOutboundSms]` — SP4B tick summary
- `[twilioSignatureValidator] TWILIO_AUTH_TOKEN unset` — fires once per cold start when the token is missing; **must not appear in production logs**

Set up a Cloud Logging alert on the signature-invalid line if you want forge-attempt visibility:

```
resource.type="cloud_function"
resource.labels.function_name="twilioVoiceStatus"
textPayload:"signature invalid"
```

---

## 8. Rollback procedure

If anything misbehaves and you need to return the system to dormant:

### Fast rollback (keeps function deployed; turns Twilio off)

1. Delete the three env values from `functions/.env`.
2. `cd functions && npm run deploy`
3. After deploy:
   - `sendSms()` throws `TWILIO_NOT_CONFIGURED`; drainers catch this and leave queue entries at `pending` (no retry counter bump, no `failed` transition).
   - `twilioVoiceStatus` returns `200 OK` for valid Twilio signatures but writes no Lead — actually, with `TWILIO_AUTH_TOKEN` unset, signature validation is skipped entirely and ALL POSTs to the URL are accepted as if from Twilio. **Take the Twilio Console webhook URL down too** (Step 8 below) to fully close the inbound path.

### Full rollback (disconnect Twilio entirely)

4. In Twilio Console → Phone Numbers → the purchased number → Voice & Fax → **Call Status Changes URL**: delete the URL or set it back to default. Save.
5. In the operator app → Settings → Missed Call Recovery → toggle OFF and clear the phone number.

Verify dormant state:

```bash
firebase functions:log --only drainReviewRequests --lines 20
# Expected: '[drainReviewRequests] skip — TWILIO_NOT_CONFIGURED' or no 'sent' lines.
```

Pending queue entries persist; they'll drain on the next live cutover. There is no data loss from rollback.

---

## 9. Known limitations

- **Single Twilio number per business.** Multi-number routing (per location, per service line) is future work. The `twilioVoiceStatus` webhook routes by exact match on `Settings.twilioPhoneNumber == form.To`, so a business can only have one number wired up at a time.

- **Day-boundary dedup race.** Mitigated in commit `06ed91c` by the `(phoneE164, receivedAt)` composite index on `leads`. Two calls from the same number within milliseconds may both create Lead docs if they straddle a Firestore region's clock skew window (~1ms). Acceptable for missed-call recovery; revisit if it manifests.

- **No inbound SMS reply ingestion.** Customers replying STOP / start replying to the auto-text are not yet processed. SP4C will add the inbound-SMS webhook + `leads.repliedAt` write. Until then, replies land in the Twilio Console inbox and the operator must read them there.

- **Signature validation silently disabled when `TWILIO_AUTH_TOKEN` unset.** Must be set before the webhook URL is exposed (see Step 0). The validator logs a single warning per cold start (`[twilioSignatureValidator] TWILIO_AUTH_TOKEN unset — signature validation DISABLED`) but does NOT block the function from running.

- **Env-var injection vs. Secret Manager.** Current code path is plain `process.env`, not declared as `defineSecret`. See Step 2, Path A vs B.

- **10DLC registration.** Untagged US long codes are increasingly filtered. If outbound SMS deliverability is poor, the long code likely needs to be registered with The Campaign Registry and attached to a Messaging Service. Toll-free numbers don't need this.

- **No per-business `From` number for SP4A.** Every outbound review-request SMS sends from the single `TWILIO_PHONE_NUMBER` env var. Per-business numbers come with the multi-tenant Messaging Service rework.

---

## 10. Sign-off checklist

- [ ] Step 1 prerequisites confirmed
- [ ] Step 2 env vars deployed and verified live via `gcloud functions describe`
- [ ] Step 3 Twilio Console Status Callback URL set + saved
- [ ] Step 4A: `drainReviewRequests` log shows clean tick without `TWILIO_NOT_CONFIGURED`
- [ ] Step 4B: operator Settings shows the Twilio number saved + toggle ON
- [ ] Step 5A: missed-call smoke produced Lead + auto-text SMS
- [ ] Step 5B: completed-job smoke produced review-request SMS
- [ ] Step 7 monitoring/alerting configured
- [ ] Rollback procedure dry-run documented (no need to actually rollback)

Cutover is **GO** when all 9 boxes are checked.
