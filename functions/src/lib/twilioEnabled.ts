// functions/src/lib/twilioEnabled.ts
// ═══════════════════════════════════════════════════════════════════
//  Master kill switch for the Twilio integration (TEXT + VOICE).
//
//  false  = DISCONNECTED (current). Nothing is sent or processed:
//             • sendSms() throws the dormant 'TWILIO_NOT_CONFIGURED'
//               sentinel — the drainers already leave the queue entry
//               at 'pending' with no retry/failure churn, so review
//               automation + missed-call auto-text + manual SMS all
//               go quietly dormant.
//             • the inbound voice webhooks no-op (hang up / 200 ok),
//               so no call is handled and no auto-text is enqueued.
//
//  To RECONNECT: flip to true, set the TWILIO_* function secrets, and
//  configure the per-business number + webhooks. No code is deleted —
//  the whole pipeline stays deployed, just idle.
// ═══════════════════════════════════════════════════════════════════

export const TWILIO_ENABLED = false;
