// ═══════════════════════════════════════════════════════════════════
//  src/lib/formatPhone.ts — US phone number formatting
// ═══════════════════════════════════════════════════════════════════
//
//  Operators in the field enter customer phone numbers dozens of
//  times a day on a phone keypad. Auto-formatting eliminates the
//  cognitive load of remembering parentheses + dashes, and produces
//  consistent records that look clean in invoices, customer lists,
//  and review-request SMS.
//
//  Behavior:
//   - Strips every non-digit before formatting.
//   - 10-digit US numbers format as "(555) 123-4567".
//   - 11-digit numbers starting with '1' format as
//     "+1 (555) 123-4567" (country code preserved).
//   - Anything else (incomplete, international, garbage) is returned
//     digits-only so the user can keep typing without the formatter
//     fighting them; the formatter only commits on blur or when a
//     complete number is reached.
//   - Empty string in, empty string out.
//
//  Use case in AddJob:
//   - onChange: stores raw input (formatPhonePartial for live feedback)
//   - onBlur:   commits the canonical formatted string
// ═══════════════════════════════════════════════════════════════════

/**
 * Return only the digits from an arbitrary input string.
 */
export function digitsOnly(input: string | null | undefined): string {
  if (!input) return '';
  return String(input).replace(/\D+/g, '');
}

/**
 * Format a US phone number to the canonical "(NNN) NNN-NNNN" or
 * "+1 (NNN) NNN-NNNN" form. Inputs that don't have 10 or 11 digits
 * are returned digits-only — the formatter does not corrupt
 * incomplete entries.
 */
export function formatPhone(input: string | null | undefined): string {
  const d = digitsOnly(input);
  if (d.length === 0) return '';
  if (d.length === 10) {
    return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  }
  if (d.length === 11 && d.startsWith('1')) {
    const rest = d.slice(1);
    return `+1 (${rest.slice(0, 3)}) ${rest.slice(3, 6)}-${rest.slice(6)}`;
  }
  return d;
}

/**
 * Progressive formatting for the onChange path — formats partial
 * input gracefully so the user sees structure forming as they type.
 * Returns digits unformatted for short inputs (< 4 digits) since
 * adding parens early is jarring.
 */
export function formatPhonePartial(input: string | null | undefined): string {
  const d = digitsOnly(input).slice(0, 11);
  if (d.length === 0) return '';
  if (d.length < 4) return d;
  if (d.length < 7) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
  if (d.length <= 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  // 11 digits, starts with 1 → country code.
  if (d.startsWith('1')) {
    const rest = d.slice(1);
    return `+1 (${rest.slice(0, 3)}) ${rest.slice(3, 6)}-${rest.slice(6)}`;
  }
  return d;
}
