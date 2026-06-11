// functions/src/lib/callerIdEnabled.ts
// ═══════════════════════════════════════════════════════════════════
//  Caller-ID screen-pop kill switch — INDEPENDENT of the Twilio SMS
//  switch (TWILIO_ENABLED).
//
//  The real-time caller popup is voice-only: under SimRing the Twilio
//  number rings in parallel with the operator's cell, twilioIncomingCall
//  writes a businesses/{bid}/incoming_calls/{callSid} doc, and responds
//  <Hangup/>. It sends NO SMS and never touches the messaging path — so
//  it can be ON while review texts / missed-call texts stay OFF
//  (TWILIO_ENABLED = false).
//
//  true  = twilioIncomingCall processes inbound calls + writes the popup
//          doc (still requires the operator to point their Twilio Voice
//          URL here and set settings.twilioPhoneNumber).
//  false = the webhook short-circuits with <Hangup/> and writes nothing.
// ═══════════════════════════════════════════════════════════════════

export const CALLER_ID_ENABLED = true;
