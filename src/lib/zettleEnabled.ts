// src/lib/zettleEnabled.ts
// ═══════════════════════════════════════════════════════════════════
//  Client kill switch for the PayPal Zettle integration.
//
//  While false (default): NO Zettle UI renders anywhere — the Settings
//  Connect flow, "Take Card Payment", the Zettle dashboard section, and
//  the per-job Zettle details are all hidden, and "Card" is a plain
//  manual Mark Paid method like Cash/Zelle. The Cloud Functions and the
//  matching engine stay in the codebase but dormant (nothing calls them).
//
//  Flip to true to restore the entire integration in one place — the
//  code was disabled, not deleted.
// ═══════════════════════════════════════════════════════════════════

export const ZETTLE_ENABLED = false;
