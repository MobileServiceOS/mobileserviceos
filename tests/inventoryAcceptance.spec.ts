// tests/inventoryAcceptance.spec.ts
// Run: npx vitest run tests/inventoryAcceptance.spec.ts
//
// End-to-end acceptance for the demand-by-jobs + per-size on-hand fix,
// validated against the spec's named export values (see fixtures).

import { describe, it, expect } from 'vitest';
import { computeSizeDemand, computeInventoryIntel, sizeKey } from '@/lib/inventoryIntel';
import { computeBestSellingTires } from '@/lib/bestSellingTires';
import { inventoryRecords, jobs, NOW, EXPECTED } from './fixtures/inventoryExport';

const demand90 = computeSizeDemand(jobs, { windowDays: 90, now: NOW });
const intel = computeInventoryIntel(inventoryRecords, demand90);

// Read-time on-hand: SUM qty per normalized size (what the page's flags use).
const onHandBySize = (() => {
  const m = new Map<string, number>();
  for (const i of inventoryRecords) {
    const k = sizeKey(i.size || '');
    if (!k) continue;
    m.set(k, (m.get(k) ?? 0) + Number(i.qty || 0));
  }
  return m;
})();
const onHand = (size: string) => onHandBySize.get(sizeKey(size)) ?? 0;

describe('demand is measured in JOBS per 90-day window', () => {
  for (const [size, jobCount] of Object.entries(EXPECTED.jobs90d)) {
    it(`${size} → ${jobCount} jobs/90d`, () => {
      expect(demand90.get(sizeKey(size))?.jobs).toBe(jobCount);
    });
  }

  it('out-of-window and non-Completed jobs are excluded', () => {
    // 235/45R18 has 8 in-window Completed + 1 old (excluded) = 8, not 9.
    expect(demand90.get(sizeKey('235/45R18'))?.jobs).toBe(8);
    // 205/65R16 has 6 Completed + 1 Pending (excluded) = 6, not 7.
    expect(demand90.get(sizeKey('205/65R16'))?.jobs).toBe(6);
  });

  it('set-buys move many UNITS across few JOBS (the divergence)', () => {
    const setBuy = demand90.get(sizeKey('255/50R19'))!;
    expect(setBuy.jobs).toBe(2);   // ranks by 2
    expect(setBuy.units).toBe(5);  // not 5
    expect(demand90.get(sizeKey('275/50R21'))).toMatchObject({ jobs: 1, units: 4 });
    expect(demand90.get(sizeKey('235/55R18'))).toMatchObject({ jobs: 2, units: 5 });
  });
});

describe('on-hand is aggregated per size across duplicate entries', () => {
  it('235/40R18 reads 2 (two entries 1+1), NOT 0', () => {
    expect(onHand('235/40R18')).toBe(2);
  });
  it('225/55R18 reads 4 and is NOT out of stock', () => {
    expect(onHand('225/55R18')).toBe(4);
    expect(onHand('225/55R18')).toBeGreaterThan(0);
  });
  it('205/55R16 reads 2 (Used 0 + New 2), NOT 0', () => {
    expect(onHand('205/55R16')).toBe(2);
  });
});

describe('Reorder Now is ranked by jobs/90d, with out-of-stock surfacing', () => {
  it('top of reorder = 235/45R18 (8), 205/55R16 (7), 205/65R16 (6)', () => {
    const top3 = intel.reorderNow.slice(0, 3).map((i) => sizeKey(i.size));
    expect(top3).toEqual(EXPECTED.reorderTop.map(sizeKey));
  });

  it('205/65R16 (6 jobs, 0 on hand) surfaces in Reorder Now', () => {
    const found = intel.reorderNow.find((i) => sizeKey(i.size) === sizeKey('205/65R16'));
    expect(found).toBeTruthy();
    expect(found!.qty).toBe(0);
    expect(found!.jobs).toBe(6);
  });

  it('reorder consolidates duplicates: 205/55R16 shows combined on-hand 2', () => {
    const r = intel.reorderNow.find((i) => sizeKey(i.size) === sizeKey('205/55R16'));
    expect(r?.qty).toBe(2);
  });
});

describe('set-buy sizes drop when ranked by jobs, not units', () => {
  it('a 6-job size outranks a 5-unit / 2-job set-buy in fast movers', () => {
    const idx = (s: string) => intel.fastMovers.findIndex((i) => sizeKey(i.size) === sizeKey(s));
    expect(idx('205/65R16')).toBeGreaterThanOrEqual(0);
    expect(idx('255/50R19')).toBeGreaterThan(idx('205/65R16'));
  });
});

describe('dead stock excludes in-demand sizes', () => {
  it('every in-stock, zero-demand size is counted dead (18 here)', () => {
    // 2 named dup sizes (235/40R18, 225/55R18) + 15 filler dup sizes +
    // 185/65R14 = 18; 205/55R16 is in demand so it is NOT among them.
    expect(intel.deadStockCount).toBe(18);
  });
  it('an in-demand size is never classified dead (not in list, not counted)', () => {
    expect(intel.deadStock.some((i) => sizeKey(i.size) === sizeKey('205/55R16'))).toBe(false);
    expect(intel.fastMovers.some((i) => sizeKey(i.size) === sizeKey('185/65R14'))).toBe(false);
  });
});

describe('Best Sellers default sort is JOBS', () => {
  const stockBySize = (() => {
    // keyed by extractTireSize canonical — but sizeKey-equivalent here.
    const m = new Map<string, number>();
    for (const [k, v] of onHandBySize) m.set(k, v);
    return m;
  })();

  it('default (no sortBy) ranks by jobs — 235/45R18 first with jobCount 8', () => {
    const rows = computeBestSellingTires(jobs, { windowDays: 90, now: NOW });
    expect(sizeKey(rows[0].tireSize)).toBe(sizeKey('235/45R18'));
    expect(rows[0].jobCount).toBe(8);
  });

  it('set-buy row reports jobs (2), not units (5), while units stay visible', () => {
    const rows = computeBestSellingTires(jobs, { windowDays: 90, now: NOW, sortBy: 'jobs' });
    const setBuy = rows.find((r) => sizeKey(r.tireSize) === sizeKey('255/50R19'))!;
    expect(setBuy.jobCount).toBe(2);
    expect(setBuy.quantity).toBe(5); // unit count still available for display
  });

  it('explicit jobs sort matches the default order', () => {
    const a = computeBestSellingTires(jobs, { windowDays: 90, now: NOW }).map((r) => r.tireSize);
    const b = computeBestSellingTires(jobs, { windowDays: 90, now: NOW, sortBy: 'jobs' }).map((r) => r.tireSize);
    expect(a).toEqual(b);
  });
});
