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

// Module-scoped throttle so the dev-mode warning fires at most once
// per Cloud Function instance instead of on every webhook invocation.
let warnedTokenMissing = false;

/**
 * Throws Error('TWILIO_SIGNATURE_INVALID') on a forged signature.
 * Silently returns when TWILIO_AUTH_TOKEN is unset (with a warning).
 */
export function assertValidTwilioSignature(input: ValidationInput): void {
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!token) {
    if (!warnedTokenMissing) {
      warnedTokenMissing = true;
      // eslint-disable-next-line no-console
      console.warn('[twilioSignatureValidator] TWILIO_AUTH_TOKEN unset — signature validation DISABLED. Do not deploy to production in this state.');
    }
    return;
  }
  const sig = input.signatureHeader ?? '';
  const ok = validateRequest(token, sig, input.url, input.params);
  if (!ok) {
    throw new Error('TWILIO_SIGNATURE_INVALID');
  }
}
