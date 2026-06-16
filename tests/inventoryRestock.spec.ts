// tests/inventoryRestock.spec.ts
// Run: npx vitest run tests/inventoryRestock.spec.ts
//
// The focus-banner "reorder" action: record restocked units for a size.

import { describe, it, expect } from 'vitest';
import { addStockForSize } from '@/lib/inventoryRestock';
import { sizeKey } from '@/lib/inventoryIntel';
import type { InventoryItem } from '@/types';

const item = (over: Partial<InventoryItem>): InventoryItem => ({
  id: 'i' + (over.size ?? '') + (over.qty ?? 0), size: '', qty: 0, cost: 0, condition: 'New', reorderPoint: 1, ...over,
});
const totalFor = (list: InventoryItem[], size: string) =>
  list.filter((i) => sizeKey(i.size || '') === sizeKey(size)).reduce((s, i) => s + Number(i.qty || 0), 0);

describe('addStockForSize', () => {
  it('adds the quantity to an existing entry of the size', () => {
    const next = addStockForSize([item({ id: 'a', size: '225/55R18', qty: 2 })], '225/55R18', 4);
    expect(next).toHaveLength(1);
    expect(next[0].qty).toBe(6);
  });

  it('matches formatting variants (slash vs R) when adding', () => {
    const next = addStockForSize([item({ id: 'a', size: '205/55R16', qty: 1 })], '205/55/16', 3);
    expect(next).toHaveLength(1);
    expect(next[0].qty).toBe(4);
  });

  it('creates a new entry when the size was never stocked (out-of-stock reorder)', () => {
    const next = addStockForSize([item({ id: 'a', size: '225/55R18', qty: 2 })], '205/65R16', 4);
    expect(next).toHaveLength(2);
    expect(totalFor(next, '205/65R16')).toBe(4);
    expect(totalFor(next, '225/55R18')).toBe(2); // untouched
  });

  it('ignores non-positive / invalid quantities', () => {
    const list = [item({ id: 'a', size: '225/55R18', qty: 2 })];
    expect(addStockForSize(list, '225/55R18', 0)[0].qty).toBe(2);
    expect(addStockForSize(list, '225/55R18', -3)[0].qty).toBe(2);
    expect(addStockForSize(list, '225/55R18', NaN)[0].qty).toBe(2);
  });

  it('does not mutate the input list', () => {
    const list = [item({ id: 'a', size: '225/55R18', qty: 2 })];
    addStockForSize(list, '225/55R18', 5);
    expect(list[0].qty).toBe(2);
  });

  it('floors fractional quantities', () => {
    const next = addStockForSize([item({ id: 'a', size: '225/55R18', qty: 0 })], '225/55R18', 3.9);
    expect(next[0].qty).toBe(3);
  });
});
