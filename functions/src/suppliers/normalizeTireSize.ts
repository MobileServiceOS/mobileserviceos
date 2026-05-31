// Normalize any of the accepted tire-size input formats into the
// canonical "WWW/AARR" form, e.g.
//
//   "2254517"     → "225/45R17"
//   "225/45/17"   → "225/45R17"
//   "225/45R17"   → "225/45R17"
//   "225 45 17"   → "225/45R17"
//   "225-45-17"   → "225/45R17"
//   "225/45r17"   → "225/45R17" (case-insensitive)
//
// Returns null for any value that doesn't parse as a plausible
// passenger-tire size. Sanity bounds prevent the obvious garbage:
//   width  : 145..405 mm
//   aspect : 25..85
//   rim    : 10..30 inches
// (Commercial 22.5"-rim tires with 3-digit rim values are not supported
// in Phase 1 — the rim regex group is fixed at 2 digits.)

export function normalizeTireSize(input: unknown): string | null {
  if (typeof input !== 'string') return null;

  // Uppercase + strip whitespace + strip separators (/ and -)
  const compact = input.trim().toUpperCase().replace(/[\s\-/]/g, '');
  if (compact.length === 0) return null;

  // Match: 3 digits (width), 2 digits (aspect), optional R, 2 digits (rim)
  const match = /^(\d{3})(\d{2})R?(\d{2})$/.exec(compact);
  if (!match) return null;

  const width = parseInt(match[1], 10);
  const aspect = parseInt(match[2], 10);
  const rim = parseInt(match[3], 10);

  if (width < 145 || width > 405) return null;
  if (aspect < 25 || aspect > 85) return null;
  if (rim < 10 || rim > 30) return null;

  return `${match[1]}/${match[2]}R${match[3]}`;
}
