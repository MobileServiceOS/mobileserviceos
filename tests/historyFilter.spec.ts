// tests/historyFilter.spec.ts
// Run: npx vitest run tests/historyFilter.spec.ts
//
// The History list filter — powers the Inventory → "View jobs for this
// size" reverse link (size set as the query) plus the status filters.

import { describe, it, expect } from 'vitest';
import { filterHistoryJobs } from '@/lib/historyFilter';
import type { Job } from '@/types';

const job = (over: Partial<Job>): Job => ({
  id: over.id || Math.random().toString(36).slice(2),
  status: 'Completed', date: '2026-05-01', tireSize: '', qty: 1, revenue: 100,
  tireCost: 0, materialCost: 0, miles: 0, note: '', customerName: '', service: 'Tire',
  emergency: false, lateNight: false, highway: false, weekend: false, tireSource: 'in_stock',
  ...over,
}) as Job;

describe('filterHistoryJobs — Inventory → filtered History (reverse link)', () => {
  const jobs = [
    job({ id: 'a', tireSize: '225/55R18', customerName: 'Alice', date: '2026-05-10' }),
    job({ id: 'b', tireSize: '205/55R16', customerName: 'Bob', date: '2026-05-11' }),
    job({ id: 'c', tireSize: '225/55R18', customerName: 'Carol', date: '2026-05-12' }),
  ];

  it('a size query returns only jobs for that size', () => {
    const r = filterHistoryJobs(jobs, '225/55R18', 'all');
    expect(r.map((j) => j.id).sort()).toEqual(['a', 'c']);
  });

  it('matches across size-format variants (slash vs R)', () => {
    // Inventory may pass "225/55/18"; jobs stored as "225/55R18" still match.
    const r = filterHistoryJobs(jobs, '225/55/18', 'all');
    expect(r.map((j) => j.id).sort()).toEqual(['a', 'c']);
  });

  it('newest first', () => {
    const r = filterHistoryJobs(jobs, '225/55R18', 'all');
    expect(r[0].id).toBe('c'); // 2026-05-12 before 2026-05-10
  });

  it('empty query returns all (sorted)', () => {
    expect(filterHistoryJobs(jobs, '', 'all')).toHaveLength(3);
  });
});

describe('filterHistoryJobs — status filters', () => {
  const jobs = [
    job({ id: 'done', status: 'Completed' }),
    job({ id: 'pend', status: 'Pending' }),
    job({ id: 'cxl', status: 'Cancelled' }),
  ];
  it('completed', () => {
    expect(filterHistoryJobs(jobs, '', 'completed').map((j) => j.id)).toEqual(['done']);
  });
  it('pending', () => {
    expect(filterHistoryJobs(jobs, '', 'pending').map((j) => j.id)).toEqual(['pend']);
  });
  it('cancelled', () => {
    expect(filterHistoryJobs(jobs, '', 'cancelled').map((j) => j.id)).toEqual(['cxl']);
  });
});
