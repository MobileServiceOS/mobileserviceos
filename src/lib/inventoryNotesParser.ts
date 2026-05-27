// src/lib/inventoryNotesParser.ts
// ═══════════════════════════════════════════════════════════════════
//  Free-text inventory parser. Accepts the kind of notes operators
//  actually write in iPhone Notes / SMS / scratch pads and extracts
//  a structured row per line — tire size, qty, cost, condition.
//
//  Examples it handles:
//    225/65R17 5
//    225/65R17 x5 $80
//    245/40R18 used 2 @$95
//    225-65R17 USED qty 2
//    275/35R20 Michelin 1 new $120
//    5x 225/65R17 used
//
//  Examples it FLAGS (returns with _error so the user can fix them
//  in the preview grid):
//    Bring more tires — no tire size pattern → "No tire size found"
//
//  Public API:
//    parseInventoryNotes(text) → ParsedNotesRow[]
//
//  Shape is compatible with the existing CSV ParsedRow surface in
//  Inventory.tsx so the preview-grid + dedup-on-save flow works
//  unchanged. Vendor + sellingPrice are left blank — the user can
//  fill those in the preview if needed.
// ═══════════════════════════════════════════════════════════════════

export interface ParsedNotesRow {
  tireSize: string;
  condition: 'New' | 'Used';
  quantity: number;
  cost: number;
  sellingPrice: number;
  vendor: string;
  notes: string;
  _row: number;
  _error?: string;
}

/**
 * Extract a canonical tire-size string from a line of free text.
 * Recognized forms (digits separated by /, -, R, or whitespace):
 *   225/65R17
 *   225/65-17
 *   225-65-17
 *   225 65 17
 *   225/65 R 17
 * Output is always normalized to "WIDTH/ASPECTRRIM" — e.g. "225/65R17".
 * Returns "" if no plausible size pattern matches.
 */
export function extractTireSize(s: string): string {
  const m = s.match(/(\d{3})\s*[/\- ]\s*(\d{2})\s*[R\- ]\s*(\d{2})\b/i);
  if (!m) return '';
  return `${m[1]}/${m[2]}R${m[3]}`;
}

/**
 * Extract a cost figure from a $- or @-prefixed number. Handles
 * decimals up to 2 places. Returns 0 if none found.
 */
export function extractCost(s: string): number {
  // $80, $ 80, $80.50, @$80, @80
  const m = s.match(/[$@]\s*\$?\s*(\d{1,4}(?:\.\d{1,2})?)/);
  if (!m) return 0;
  return Number(m[1]) || 0;
}

/**
 * Extract a condition keyword. "used" / "blem" / "blemished" → 'Used'.
 * Everything else (including missing) defaults to 'New' — the most
 * common case in fresh inventory uploads.
 */
export function extractCondition(s: string): 'New' | 'Used' {
  if (/\bused\b/i.test(s)) return 'Used';
  if (/\bblem(?:ished)?\b/i.test(s)) return 'Used';
  return 'New';
}

/**
 * Extract a quantity from the line after stripping size, cost, and
 * condition keywords. Looks for:
 *   "x5" / "x 5" / "5x" / "qty 5" / "qty:5" / "5pcs" / "5 ea"
 * Falls back to the first standalone 1–3 digit number in the residue.
 * Returns 0 if no quantity-looking number is found.
 */
export function extractQuantity(line: string): number {
  // Strip the parts we already recognize so they don't confuse the
  // quantity scan. Tire size has digits that would otherwise win.
  const residue = line
    .replace(/(\d{3})\s*[/\- ]\s*(\d{2})\s*[R\- ]\s*(\d{2})\b/i, ' ')
    .replace(/[$@]\s*\$?\s*\d{1,4}(?:\.\d{1,2})?/g, ' ')
    .replace(/\bnew\b|\bused\b|\bblem(?:ished)?\b/gi, ' ')
    .replace(/[,;:]/g, ' ')
    .trim();

  // Explicit quantity markers first.
  const m = residue.match(
    /x\s*(\d{1,3})\b|(\d{1,3})\s*x\b|qty\s*[:\s]*(\d{1,3})|(\d{1,3})\s*(?:pcs?|ea|each)\b/i,
  );
  if (m) {
    const n = Number(m[1] || m[2] || m[3] || m[4]);
    if (n > 0 && n < 1000) return n;
  }
  // Fallback: first standalone 1–3 digit number in the residue.
  const fallback = residue.match(/\b(\d{1,3})\b/);
  if (fallback) {
    const n = Number(fallback[1]);
    if (n > 0 && n < 1000) return n;
  }
  return 0;
}

/**
 * Parse a block of free text — one inventory entry per non-empty
 * line — into ParsedNotesRow[]. Empty / separator lines are skipped.
 * Lines with no recognizable tire size are returned with _error so
 * the user can edit them in the preview grid.
 */
export function parseInventoryNotes(text: string): ParsedNotesRow[] {
  const lines = text.split(/\r?\n/);
  const rows: ParsedNotesRow[] = [];
  let row = 0;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].trim();
    if (!raw) continue;
    // Skip pure separators / header-ish lines.
    if (/^[-=*_]{3,}$/.test(raw)) continue;
    if (/^(inventory|tires?|stock|list)\s*[:\-]?\s*$/i.test(raw)) continue;
    row++;

    const tireSize = extractTireSize(raw);
    if (!tireSize) {
      rows.push({
        tireSize: '', condition: 'New', quantity: 0,
        cost: 0, sellingPrice: 0,
        vendor: '', notes: raw,
        _row: row, _error: 'No tire size found',
      });
      continue;
    }
    const cost = extractCost(raw);
    const condition = extractCondition(raw);
    const parsedQty = extractQuantity(raw);
    // When no quantity is found in the line, default to 1 rather
    // than flagging as an error. Operators who paste bare size lists
    // (e.g. 71 lines like "235/65R16") typically mean "one of each";
    // erroring would force them to retype every line. The preview
    // grid is editable so they can adjust before saving. Cost
    // defaults to 0 silently — already non-blocking pre-existing.
    const quantity = parsedQty > 0 ? parsedQty : 1;

    rows.push({
      tireSize, condition, quantity, cost,
      sellingPrice: 0,
      vendor: '', notes: '',
      _row: row,
    });
  }
  return rows;
}
