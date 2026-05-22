// src/lib/inventoryFilters.ts
// ═══════════════════════════════════════════════════════════════════
//  Smart-filter chip matching for the tire-vertical Inventory page.
//
//  The chips work over EXISTING InventoryItem data — there are no
//  new fields. Most chips are case-insensitive substring matches
//  against the item's brand / model / notes / size. "Low Profile"
//  adds a parsed aspect-ratio heuristic so an operator who hasn't
//  written "low profile" in notes still gets a useful filter.
//
//  Phase 1 of the inventory upgrade. Spec:
//  docs/superpowers/specs/2026-05-22-inventory-polish-design.md
// ═══════════════════════════════════════════════════════════════════

import type { InventoryItem } from '@/types';

export type SmartChip =
  | 'Run Flat' | 'Truck' | 'Commercial' | 'Tesla'
  | 'Trailer' | 'Low Profile' | 'SUV';

export const SMART_CHIPS: SmartChip[] = [
  'Run Flat', 'Truck', 'Commercial', 'Tesla',
  'Trailer', 'Low Profile', 'SUV',
];

// Keyword each chip substring-matches against the item's text fields
// (brand / model / notes). Lower-case; the haystack is lower-cased
// before comparison.
const KEYWORD: Record<SmartChip, string> = {
  'Run Flat': 'run flat',
  'Truck': 'truck',
  'Commercial': 'commercial',
  'Tesla': 'tesla',
  'Trailer': 'trailer',
  'Low Profile': 'low profile',
  'SUV': 'suv',
};

function haystack(item: InventoryItem): string {
  return [
    item.brand || '', item.model || '', item.notes || '',
  ].join(' ').toLowerCase();
}

// Parse the aspect ratio out of a `WWW/AARR…`-shape tire size string
// (e.g. "245/40R18" → 40). Returns null on a malformed size.
function aspectRatio(size: string | undefined): number | null {
  if (!size) return null;
  const m = size.match(/\d+\s*\/\s*(\d+)/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) ? n : null;
}

export function matchesSmartChip(item: InventoryItem, chip: SmartChip): boolean {
  const kw = KEYWORD[chip];
  if (haystack(item).includes(kw)) return true;
  // Low Profile gets the parsed-size heuristic as well.
  if (chip === 'Low Profile') {
    const ar = aspectRatio(item.size);
    if (ar !== null && ar < 50) return true;
  }
  return false;
}
