// tests/quoteDocument.spec.ts
// Run: npx vitest run tests/quoteDocument.spec.ts
//
// Pure helpers behind the invoice / estimate document: the doc number,
// line-item normalization, and the itemized total. (The PDF layout itself
// is visual; these are the testable inputs.)

import { describe, it, expect } from 'vitest';
import { buildDocNumber, normalizeLineItems, lineItemsTotal } from '@/lib/invoice';
import { EMPTY_JOB, DEFAULT_BRAND } from '@/lib/defaults';
import type { Job, Brand, JobLineItem } from '@/types';

const job = (over: Partial<Job>): Job => ({ ...EMPTY_JOB(), ...over });
const brand = (over: Partial<Brand>): Brand => ({ ...DEFAULT_BRAND, ...over });

describe('buildDocNumber', () => {
  it('formats as INITIALS-YYYY-MMDD (e.g. WR-2026-0623)', () => {
    expect(buildDocNumber(brand({ businessName: 'Wheel Rush' }), job({ date: '2026-06-23' }))).toBe('WR-2026-0623');
  });
  it('uses up to three initials', () => {
    expect(buildDocNumber(brand({ businessName: 'Mobile Service OS' }), job({ date: '2026-01-05' }))).toBe('MSO-2026-0105');
  });
  it('falls back to WR when no business name', () => {
    expect(buildDocNumber(brand({ businessName: '' }), job({ date: '2026-06-23' }))).toBe('WR-2026-0623');
  });
});

describe('normalizeLineItems', () => {
  const li = (o: Partial<JobLineItem>): JobLineItem => ({ description: 'x', qty: 1, unitPrice: 1, ...o });

  it('keeps valid rows and coerces numbers', () => {
    const out = normalizeLineItems(job({ lineItems: [
      li({ description: 'LT245/75R16 tire', qty: 1, unitPrice: 170 }),
      li({ description: 'Mobile labor', qty: 1, unitPrice: 160 }),
    ] }));
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ description: 'LT245/75R16 tire', qty: 1, unitPrice: 170 });
  });
  it('drops rows with no description, or with zero qty AND zero price', () => {
    const out = normalizeLineItems(job({ lineItems: [
      li({ description: '', qty: 2, unitPrice: 50 }),
      li({ description: 'Disposal', qty: 0, unitPrice: 0 }),
      li({ description: 'Balance', qty: 1, unitPrice: 20 }),
    ] }));
    expect(out.map((r) => r.description)).toEqual(['Balance']);
  });
  it('clamps negative numbers to 0', () => {
    const out = normalizeLineItems(job({ lineItems: [li({ description: 'Tire', qty: -3, unitPrice: 100 })] }));
    expect(out[0].qty).toBe(0);
  });
  it('handles missing/absent lineItems', () => {
    expect(normalizeLineItems(job({}))).toEqual([]);
  });
});

describe('lineItemsTotal', () => {
  it('sums qty × unitPrice (the sample: 170 + 160 = 330)', () => {
    expect(lineItemsTotal([
      { description: 'Tire', qty: 1, unitPrice: 170 },
      { description: 'Labor', qty: 1, unitPrice: 160 },
    ])).toBe(330);
  });
  it('multiplies qty', () => {
    expect(lineItemsTotal([{ description: 'Tire', qty: 4, unitPrice: 175 }])).toBe(700);
  });
  it('rounds to cents', () => {
    expect(lineItemsTotal([{ description: 'x', qty: 3, unitPrice: 33.333 }])).toBe(100);
  });
});
