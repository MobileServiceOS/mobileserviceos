// src/lib/bandilero/connectivity.ts
// ═══════════════════════════════════════════════════════════════════
//  Bandilero — connectivity detection.
//
//  Decides, from REAL tenant config, which data sources are wired so
//  the services know when to return LIVE vs NOT_CONNECTED. Pure: takes
//  the resolved values as args (aiConfigured is passed in so callers
//  inject isAIConfigured() and tests can control it).
//
//  Per the STEP-1 audit, GBP / SEO / Dispatch have NO integration in
//  MSOS today — they are hard-false here, so any module depending on
//  them renders NOT_CONNECTED rather than a fake value.
// ═══════════════════════════════════════════════════════════════════

import type { Settings } from '@/types';
import type { Connectivity } from './types';

export interface ConnectivityInputs {
  settings: Settings | null | undefined;
  /** brand.reviewUrl (a manually-pasted review link), if any. */
  brandReviewUrl?: string | null;
  /** isAIConfigured() result — injected so it stays pure/testable. */
  aiConfigured: boolean;
}

function nonEmpty(s: unknown): boolean {
  return typeof s === 'string' && s.trim().length > 0;
}

export function detectConnectivity(input: ConnectivityInputs): Connectivity {
  const s = input.settings ?? ({} as Settings);

  // Twilio is wired once the operator has a provisioned number in
  // operational settings (the webhook tenant-lookup key). Without it,
  // no missed-call / inbound-call data can flow.
  const twilio = nonEmpty(s.twilioPhoneNumber);

  // Review automation is usable when it's enabled AND a destination
  // review link exists (settings.googleReviewLink or brand.reviewUrl).
  const reviews = Boolean(s.reviewAutomationEnabled)
    && (nonEmpty(s.googleReviewLink) || nonEmpty(input.brandReviewUrl));

  return {
    ai: input.aiConfigured,
    twilio,
    reviews,
    // No integration exists for these in MSOS today (STEP-1 audit).
    gbp: false,
    seo: false,
    dispatch: false,
  };
}
