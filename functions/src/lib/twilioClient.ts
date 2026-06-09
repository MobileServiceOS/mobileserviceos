// functions/src/lib/twilioClient.ts
// ═══════════════════════════════════════════════════════════════════
//  twilioClient — SP4A SMS sender.
//
//  Spec: docs/superpowers/specs/2026-06-03-sp4a-review-automation-design.md
//        §"4. twilioClient helper"
//
//  Reads TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_PHONE_NUMBER
//  from process.env. When any is missing, throws the SENTINEL STRING
//  'TWILIO_NOT_CONFIGURED' — the drainer catches this specific error
//  and leaves the queue entry at 'pending' (no retry counter bump,
//  no failure transition). This is the seam that lets SP4A ship
//  dormant: trigger + queue + drainer all run, but no SMS goes out
//  until SP4B's operator-side Twilio wiring lands.
//
//  When credentials ARE present, performs the real REST POST to
//  Twilio's Messages API. Single-tenant — every business sends from
//  the same TWILIO_PHONE_NUMBER for now. Per-business numbers are
//  SP4B's "Messaging Service routing" deliverable.
// ═══════════════════════════════════════════════════════════════════

import { TWILIO_ENABLED } from './twilioEnabled';

export class TwilioError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly carrierCode?: string,
  ) {
    super(message);
    this.name = 'TwilioError';
  }
}

export interface SendSmsArgs {
  to: string;       // E.164 destination, e.g. '+13055551234'
  body: string;     // rendered SMS body
}

export interface SendSmsResult {
  messageSid: string;
  deliveryStatus: string; // 'queued' on a successful submission
}

/**
 * Send an SMS via Twilio's Messages API.
 *
 * Throws:
 *   - 'TWILIO_NOT_CONFIGURED' (plain Error) when env vars missing.
 *   - TwilioError (status 4xx) on a permanent failure (bad number,
 *     suspended account, etc.) — drainer marks status='failed'.
 *   - TwilioError (status 5xx) on a transient failure — drainer
 *     increments retryCount and leaves pending until cap exhausted.
 */
export async function sendSms(args: SendSmsArgs): Promise<SendSmsResult> {
  // Twilio disconnected in-app (TWILIO_ENABLED=false). Throw the same
  // dormant sentinel the drainers already handle — every outbound text
  // (review automation, missed-call auto-text, manual SMS) goes quietly
  // dormant with no send, no retry/failure churn. Flip TWILIO_ENABLED to
  // reconnect. See functions/src/lib/twilioEnabled.ts.
  if (!TWILIO_ENABLED) {
    throw new Error('TWILIO_NOT_CONFIGURED');
  }
  const sid   = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from  = process.env.TWILIO_PHONE_NUMBER;
  if (!sid || !token || !from) {
    throw new Error('TWILIO_NOT_CONFIGURED');
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`;
  const auth = Buffer.from(`${sid}:${token}`).toString('base64');
  const form = new URLSearchParams({ From: from, To: args.to, Body: args.body });

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type':  'application/x-www-form-urlencoded',
      },
      body: form.toString(),
    });
  } catch (err) {
    // Network / DNS / socket-level failure — treat as transient 5xx
    // so the drainer retries on the next tick.
    throw new TwilioError(`network error: ${(err as Error).message}`, 503);
  }

  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    let carrierCode: string | undefined;
    try {
      const body = await res.json() as { message?: string; code?: string | number };
      if (body.message) detail = body.message;
      if (body.code != null) carrierCode = String(body.code);
    } catch { /* non-JSON error body */ }
    throw new TwilioError(detail, res.status, carrierCode);
  }

  const body = await res.json() as { sid?: string; status?: string };
  if (!body.sid) {
    // Twilio always returns a sid on 2xx — defensive shield.
    throw new TwilioError('twilio response missing sid', 502);
  }
  return { messageSid: body.sid, deliveryStatus: body.status ?? 'queued' };
}

/** Cheap, side-effect-free env probe. Drainer + Settings UI both
 *  call this to decide whether to attempt a send vs short-circuit. */
export function isTwilioConfigured(): boolean {
  return !!(process.env.TWILIO_ACCOUNT_SID
         && process.env.TWILIO_AUTH_TOKEN
         && process.env.TWILIO_PHONE_NUMBER);
}
