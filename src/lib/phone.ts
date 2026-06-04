// src/lib/phone.ts
// ═══════════════════════════════════════════════════════════════════
//  Canonical US phone normalization.
//
//  Single source of truth for:
//    - Customer.phoneE164 ('+13058977030')
//    - Customer.phoneKey  ('13058977030')  — also Firestore index key
//    - Customer doc ID    ('p_13058977030')
//
//  Spec: docs/superpowers/specs/2026-06-03-customer-intelligence-design.md
//        §"Phone Number Normalization (canonical)"
//
//  v1 supports US (NANP) only. International / extension / vanity
//  inputs return { valid: false } with blank e164/digits — callers
//  MUST gate on .valid before persisting phoneKey/phoneE164.
// ═══════════════════════════════════════════════════════════════════

export interface NormalizedPhone {
  e164: string;        // '+13058977030' or '' when invalid
  digits: string;      // '13058977030'  or '' when invalid (phoneKey)
  formatted: string;   // '(305) 897-7030' for display; raw passthrough on invalid
  valid: boolean;
}

/**
 * Normalize raw user input into the canonical phone forms.
 *
 * Contract:
 *   - `raw` MUST be a string. Non-string input throws TypeError —
 *     fail loud, never silently produce a bogus phoneKey.
 *   - Returns { valid: false } with blank e164/digits for anything
 *     outside US/NANP 10- or 11-digit format. The original raw
 *     string (trimmed) is echoed back via `formatted` so the UI can
 *     keep displaying what the operator typed.
 */
export function normalizePhone(raw: string, _defaultCountry: 'US' = 'US'): NormalizedPhone {
  if (typeof raw !== 'string') {
    throw new TypeError('normalizePhone: raw must be a string');
  }
  const trimmed = raw.trim();
  const stripped = trimmed.replace(/[^\d+]/g, '');
  let digits = stripped.startsWith('+') ? stripped.slice(1) : stripped;
  if (digits.length === 10) digits = '1' + digits;
  const valid = digits.length === 11 && digits[0] === '1';
  if (!valid) {
    return { e164: '', digits: '', formatted: trimmed, valid: false };
  }
  const e164 = '+' + digits;
  const formatted = '(' + digits.slice(1, 4) + ') ' + digits.slice(4, 7) + '-' + digits.slice(7, 11);
  return { e164, digits, formatted, valid: true };
}

/** Convenience: returns true iff normalizePhone accepts the input. */
export function isValidPhone(raw: string): boolean {
  return normalizePhone(raw).valid;
}

/**
 * Display helper — accepts an E.164 string and returns the canonical
 * formatted form. Passes invalid input through unchanged so legacy
 * Job.customerPhone values still render readably.
 */
export function formatPhoneForDisplay(e164: string): string {
  if (!e164) return '';
  const n = normalizePhone(e164);
  return n.valid ? n.formatted : e164;
}
