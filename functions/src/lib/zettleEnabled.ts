// functions/src/lib/zettleEnabled.ts
// ═══════════════════════════════════════════════════════════════════
//  zettleEnabled — dormant feature flag for the PayPal Zettle integration.
//
//  Mirrors functions/src/lib/twilioEnabled.ts. The whole Zettle feature
//  ships DORMANT: all functions deploy, the Settings UI renders, but no
//  OAuth / API / webhook work happens until these app-level secrets are
//  present (set in Secret Manager once the MSOS Zettle developer app is
//  registered and US availability confirmed):
//
//    ZETTLE_CLIENT_ID         — MSOS app client id
//    ZETTLE_CLIENT_SECRET     — MSOS app client secret
//    ZETTLE_TOKEN_ENC_KEY     — base64 32-byte AES key for token-at-rest
//    ZETTLE_REDIRECT_URI      — OAuth redirect (the zettleOAuthCallback URL)
//
//  Handlers check ZETTLE_ENABLED and short-circuit cleanly when unset,
//  so accidental invocations are no-ops rather than 500s.
// ═══════════════════════════════════════════════════════════════════

export const ZETTLE_ENABLED: boolean = !!(
  process.env.ZETTLE_CLIENT_ID
  && process.env.ZETTLE_CLIENT_SECRET
  && process.env.ZETTLE_TOKEN_ENC_KEY
);

/** Cheap, side-effect-free probe used by handlers + the Settings test
 *  path to decide whether to attempt real Zettle work. */
export function isZettleConfigured(): boolean {
  return ZETTLE_ENABLED;
}

/** The app secrets every Zettle function declares so Secret Manager
 *  injects them into process.env. Listed once, reused on each function. */
export const ZETTLE_SECRETS = [
  'ZETTLE_CLIENT_ID',
  'ZETTLE_CLIENT_SECRET',
  'ZETTLE_TOKEN_ENC_KEY',
  'ZETTLE_REDIRECT_URI',
];
