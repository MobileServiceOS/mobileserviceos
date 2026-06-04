// functions/src/lib/phone.ts
// ═══════════════════════════════════════════════════════════════════
//  Phone normalization — duplicate of src/lib/phone.ts since functions
//  cannot import from the client tree. Algorithm must stay byte-
//  identical so client-side phoneKey lookups match server writes.
//
//  Spec: docs/superpowers/specs/2026-06-03-customer-intelligence-design.md
//        §"Phone Number Normalization (canonical)"
// ═══════════════════════════════════════════════════════════════════

export interface NormalizedPhone {
  e164: string;
  digits: string;       // 11-digit canonical (US: leading '1')
  formatted: string;
  valid: boolean;
}

export function normalizePhone(raw: string | null | undefined): NormalizedPhone {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return { e164: '', digits: '', formatted: '', valid: false };
  const onlyDigits = trimmed.replace(/[^\d]/g, '');
  let digits = onlyDigits;
  if (digits.length === 10) digits = '1' + digits;
  if (digits.length !== 11 || !digits.startsWith('1')) {
    return { e164: '', digits: '', formatted: trimmed, valid: false };
  }
  const e164 = '+' + digits;
  const formatted = '(' + digits.slice(1, 4) + ') ' + digits.slice(4, 7) + '-' + digits.slice(7, 11);
  return { e164, digits, formatted, valid: true };
}
