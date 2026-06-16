// tests/ops/reorder.spec.ts — Loop 1 gather + ranking + parse.
import { describe, it, expect } from 'vitest';
import {
  gatherReorderContext,
  buildReorderPrompt,
  parseReorderResult,
} from '@/lib/ops/loops/reorder';
import { job, inv, NOW } from './fixtures';

const jobs = [
  // Hot size, fully out of stock (inventory entry with qty 0).
  job({ id: 'a1', tireSize: '225/65R17', revenue: 100, qty: 1, date: '2026-06-10' }),
  job({ id: 'a2', tireSize: '225/65R17', revenue: 100, qty: 1, date: '2026-06-10' }),
  job({ id: 'a3', tireSize: '225/65R17', revenue: 100, qty: 1, date: '2026-06-10' }),
  // Well-stocked in-demand size — should NOT be a reorder candidate.
  job({ id: 'b1', tireSize: '205/55R16', revenue: 80, qty: 1, date: '2026-06-12' }),
  // Hot size we have NEVER stocked (no inventory entry).
  job({ id: 'c1', tireSize: '195/65R15', revenue: 90, qty: 1, date: '2026-06-11' }),
  job({ id: 'c2', tireSize: '195/65R15', revenue: 90, qty: 1, date: '2026-06-11' }),
];

const inventory = [
  inv({ id: 'i1', size: '225/65R17', qty: 0, cost: 50, reorderPoint: 2 }),
  inv({ id: 'i2', size: '205/55R16', qty: 10, cost: 40, reorderPoint: 2 }),
];

describe('gatherReorderContext', () => {
  const ctx = gatherReorderContext(jobs, inventory, { now: NOW, windowDays: 90 });

  it('ranks out-of-stock + most-called-for first', () => {
    expect(ctx.items[0].size).toBe('225/65R17'); // 3 jobs, out of stock
    expect(ctx.items[1].size).toBe('195/65R15'); // 2 jobs, never stocked
  });

  it('surfaces a never-stocked hot size as out of stock', () => {
    const c = ctx.items.find((i) => i.size === '195/65R15');
    expect(c?.outOfStock).toBe(true);
    expect(c?.onHand).toBe(0);
    expect(c?.jobsInWindow).toBe(2);
  });

  it('excludes well-stocked sizes', () => {
    expect(ctx.items.find((i) => i.size === '205/55R16')).toBeUndefined();
  });

  it('computes combined on-hand, jobs, and avg $/tire', () => {
    const a = ctx.items[0];
    expect(a.onHand).toBe(0);
    expect(a.jobsInWindow).toBe(3);
    expect(a.unitsInWindow).toBe(3);
    expect(a.avgPerTire).toBe(100); // 300 revenue / 3 units
    expect(a.outOfStock).toBe(true);
  });

  it('handles empty inputs without throwing', () => {
    expect(gatherReorderContext([], [], { now: NOW }).items).toEqual([]);
    expect(gatherReorderContext(null, null).items).toEqual([]);
  });
});

describe('buildReorderPrompt', () => {
  it('asks for JSON-only output and names the candidates', () => {
    const ctx = gatherReorderContext(jobs, inventory, { now: NOW });
    const { system, user } = buildReorderPrompt(ctx, 'Acme Tire');
    expect(system).toContain('JSON');
    expect(system.toLowerCase()).toContain('out-of-stock');
    expect(user).toContain('225/65R17');
  });
});

describe('parseReorderResult', () => {
  it('parses a valid response (with prose + fences)', () => {
    const raw = '```json\n{"recommendations":[{"size":"225/65R17","suggestedBuyQty":4,"reason":"3 jobs, out of stock"}]}\n```';
    const r = parseReorderResult(raw);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.recommendations).toHaveLength(1);
      expect(r.value.recommendations[0].suggestedBuyQty).toBe(4);
    }
  });

  it('coerces qty (string, negative) and drops entries without a size', () => {
    const raw =
      '{"recommendations":[{"size":"225/65R17","suggestedBuyQty":"6","reason":"x"},{"suggestedBuyQty":3,"reason":"no size"},{"size":"195/65R15","suggestedBuyQty":-2,"reason":"y"}]}';
    const r = parseReorderResult(raw);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.recommendations).toHaveLength(2);
      expect(r.value.recommendations[0].suggestedBuyQty).toBe(6);
      expect(r.value.recommendations[1].suggestedBuyQty).toBe(0); // clamped
    }
  });

  it('fails on malformed JSON', () => {
    expect(parseReorderResult('not json at all').ok).toBe(false);
    expect(parseReorderResult('{"recommendations": "oops"}').ok).toBe(false);
    expect(parseReorderResult('{"recommendations": []}').ok).toBe(false);
  });
});
