// functions/src/lib/zettleSignature.ts
// ═══════════════════════════════════════════════════════════════════
//  zettleSignature — verify inbound Zettle (Pusher API) webhook messages.
//
//  Mirrors functions/src/lib/twilioSignatureValidator.ts:
//    • In the Functions emulator with no signing key → SKIP (dev only).
//    • In production with no/!match signature → FAIL CLOSED (throw).
//
//  Zettle returns a `signingKey` when you CREATE a webhook subscription
//  (stored per-business in the private path). Each delivery carries a
//  signature; we recompute HMAC-SHA256 with that key and compare in
//  constant time.
//
//  ⚠️ The exact string-to-sign isn't pinned down in Zettle's public docs
//  (the message includes a `timestamp` and a `payload`; common schemes
//  are HMAC over the raw body, or over `${timestamp}.${payload}`). To be
//  robust at bring-up we accept a match against any of the documented-
//  plausible candidate strings, in BOTH hex and base64 encodings. This
//  does NOT weaken security — every candidate is still an HMAC keyed by
//  the secret signingKey, so an attacker without the key cannot forge
//  any of them. Once you confirm the real scheme against a live delivery,
//  collapse `candidateStrings()` to the single correct form.
// ═══════════════════════════════════════════════════════════════════

import { createHmac, timingSafeEqual } from 'crypto';

let warnedKeyMissing = false;

export class ZettleSignatureError extends Error {
  constructor() {
    super('ZETTLE_SIGNATURE_INVALID');
    this.name = 'ZettleSignatureError';
  }
}

export interface ZettleSignatureInput {
  rawBody: string;
  signatureHeader: string | undefined;
  signingKey: string | null;
  /** Optional message timestamp + payload, when present in the body —
   *  used to build the `${timestamp}.${payload}` candidate. */
  timestamp?: string;
  payload?: string;
}

function candidateStrings(input: ZettleSignatureInput): string[] {
  const c = [input.rawBody];
  if (input.timestamp && input.payload) {
    c.push(`${input.timestamp}.${input.payload}`);
    c.push(`${input.timestamp}${input.payload}`);
  }
  if (input.payload) c.push(input.payload);
  return c;
}

/** All HMAC-SHA256 candidates (hex + base64) for a signing key. */
function expectedSignatures(input: ZettleSignatureInput, signingKey: string): Set<string> {
  const out = new Set<string>();
  for (const s of candidateStrings(input)) {
    const mac = createHmac('sha256', signingKey).update(s, 'utf8').digest();
    out.add(mac.toString('hex'));
    out.add(mac.toString('base64'));
  }
  return out;
}

function anyEqual(provided: string, expected: Set<string>): boolean {
  for (const e of expected) {
    if (e.length === provided.length && timingSafeEqual(Buffer.from(e), Buffer.from(provided))) {
      return true;
    }
  }
  return false;
}

/** Throws ZettleSignatureError on a forged/invalid signature. */
export function assertValidZettleSignature(input: ZettleSignatureInput): void {
  if (!input.signingKey) {
    if (process.env.FUNCTIONS_EMULATOR === 'true') {
      if (!warnedKeyMissing) {
        warnedKeyMissing = true;
        // eslint-disable-next-line no-console
        console.warn('[zettleSignature] no signingKey — verification DISABLED (emulator only).');
      }
      return;
    }
    // eslint-disable-next-line no-console
    console.error('[zettleSignature] no signingKey in production — rejecting webhook (fail-closed).');
    throw new ZettleSignatureError();
  }
  const provided = (input.signatureHeader ?? '').trim();
  if (!provided || !anyEqual(provided, expectedSignatures(input, input.signingKey))) {
    throw new ZettleSignatureError();
  }
}
