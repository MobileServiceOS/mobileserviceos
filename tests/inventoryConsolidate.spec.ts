// tests/inventoryConsolidate.spec.ts
// Run: npx vitest run tests/inventoryConsolidate.spec.ts
//
// The one-time consolidation migration (FIX 2b): collapse duplicate size
// entries into one row per size, non-destructively and idempotently.

import { describe, it, expect } from 'vitest';
import { consolidateInventoryBySize } from '@/lib/inventoryConsolidate';
import type { InventoryItem } from '@/types';
import { inventoryRecords, EXPECTED } from './fixtures/inventoryExport';

const item = (over: Partial<InventoryItem>): InventoryItem => ({
  id: 'x' + Math.round(over.qty ?? 0) + (over.size ?? ''),
  size: '', qty: 0, cost: 0, condition: 'New', reorderPoint: 1, ...over,
});

const totalQty = (rows: InventoryItem[]) => rows.reduce((s, r) => s + Number(r.qty || 0), 0);
const rowFor = (rows: InventoryItem[], size: string) =>
  rows.find((r) => r.size.replace(/[^0-9]/g, '') === size.replace(/[^0-9]/g, ''));

describe('consolidateInventoryBySize — aggregation', () => {
  it('sums qty across duplicate entries of one size', () => {
    const { next, mergedCount, sizesAffected } = consolidateInventoryBySize([
      item({ id: 'a', size: '235/40R18', qty: 1 }),
      item({ id: 'b', size: '235/40R18', qty: 1 }),
    ]);
    expect(next).toHaveLength(1);
    expect(next[0].qty).toBe(2);
    expect(mergedCount).toBe(1);
    expect(sizesAffected).toBe(1);
  });

  it('groups formatting variants (slash vs R, spacing, case) as one size', () => {
    const { next } = consolidateInventoryBySize([
      item({ id: 'a', size: '205/55R16', qty: 1 }),
      item({ id: 'b', size: '205/55/16', qty: 2 }),
      item({ id: 'c', size: ' 205/55r16 ', qty: 3 }),
    ]);
    expect(next).toHaveLength(1);
    expect(next[0].qty).toBe(6);
  });

  it('aggregates a New + Used (and blank-brand) split into one row', () => {
    const { next } = consolidateInventoryBySize([
      item({ id: 'used', size: '205/55R16', qty: 0, condition: 'Used', brand: '' }),
      item({ id: 'new', size: '205/55R16', qty: 2, condition: 'New', brand: 'Goodyear' }),
    ]);
    expect(next).toHaveLength(1);
    expect(next[0].qty).toBe(2); // 0 + 2, not lost
  });

  it('sums reservations across folded entries', () => {
    const { next } = consolidateInventoryBySize([
      item({ id: 'a', size: '225/45R17', qty: 2, reservations: [{ qty: 1, label: 'job-1' }] as never }),
      item({ id: 'b', size: '225/45R17', qty: 2, reservations: [{ qty: 1, label: 'job-2' }] as never }),
    ]);
    expect(next[0].reservations).toHaveLength(2);
  });

  it('takes the MAX reorder point across entries', () => {
    const { next } = consolidateInventoryBySize([
      item({ id: 'a', size: '215/55R17', qty: 1, reorderPoint: 1 }),
      item({ id: 'b', size: '215/55R17', qty: 1, reorderPoint: 4 }),
    ]);
    expect(next[0].reorderPoint).toBe(4);
  });

  it('survivor keeps its descriptors, falling back only when blank', () => {
    const { next } = consolidateInventoryBySize([
      item({ id: 'a', size: '215/55R17', qty: 1, brand: '', cost: 0, notes: '' }),
      item({ id: 'b', size: '215/55R17', qty: 1, brand: 'Pirelli', cost: 88, notes: 'rear' }),
    ]);
    // survivor (a) had blanks → falls back to b's values; id stays a's.
    expect(next[0].id).toBe('a');
    expect(next[0].brand).toBe('Pirelli');
    expect(next[0].cost).toBe(88);
    expect(next[0].notes).toBe('rear');
  });
});

describe('consolidateInventoryBySize — edges & idempotency', () => {
  it('leaves blank / in-progress rows untouched and in place', () => {
    const { next, mergedCount } = consolidateInventoryBySize([
      item({ id: 'blank1', size: '', qty: 0 }),
      item({ id: 'a', size: '235/40R18', qty: 1 }),
      item({ id: 'blank2', size: '   ', qty: 0 }),
    ]);
    expect(mergedCount).toBe(0);
    expect(next.map((r) => r.id)).toEqual(['blank1', 'a', 'blank2']);
  });

  it('is idempotent — a second run is a no-op and preserves total qty', () => {
    const before = totalQty(inventoryRecords);
    const once = consolidateInventoryBySize(inventoryRecords);
    const twice = consolidateInventoryBySize(once.next);
    expect(twice.mergedCount).toBe(0);
    expect(twice.sizesAffected).toBe(0);
    expect(twice.next).toHaveLength(once.next.length);
    expect(totalQty(once.next)).toBe(before);  // no qty created or lost
    expect(totalQty(twice.next)).toBe(before);
  });
});

describe('consolidateInventoryBySize — acceptance fixture', () => {
  const { next, sizesAffected } = consolidateInventoryBySize(inventoryRecords);

  it(`reports exactly ${EXPECTED.duplicateSizes} sizes with duplicate entries`, () => {
    expect(sizesAffected).toBe(EXPECTED.duplicateSizes);
  });

  it('each consolidated size is a single row with the combined on-hand', () => {
    for (const [size, onHand] of Object.entries(EXPECTED.onHand)) {
      const rows = next.filter((r) => r.size.replace(/[^0-9]/g, '') === size.replace(/[^0-9]/g, ''));
      expect(rows).toHaveLength(1);
      expect(rows[0].qty).toBe(onHand);
    }
  });

  it('235/40R18 reads 2 (not 0), 225/55R18 reads 4, 205/55R16 reads 2', () => {
    expect(rowFor(next, '235/40R18')?.qty).toBe(2);
    expect(rowFor(next, '225/55R18')?.qty).toBe(4);
    expect(rowFor(next, '205/55R16')?.qty).toBe(2);
  });
});
