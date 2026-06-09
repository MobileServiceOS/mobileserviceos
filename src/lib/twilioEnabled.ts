// src/lib/twilioEnabled.ts
// ═══════════════════════════════════════════════════════════════════
//  Client mirror of the Twilio kill switch (functions/src/lib/
//  twilioEnabled.ts). false = DISCONNECTED:
//    • the lead composer texts from the operator's own phone (free
//      native sms: link) instead of the Twilio backend;
//    • Settings shows Twilio as "Not connected".
//  Flip to true (and reconnect on the backend) to restore in-app
//  Twilio messaging. Keep this in sync with the functions copy.
// ═══════════════════════════════════════════════════════════════════

export const TWILIO_ENABLED = false;
