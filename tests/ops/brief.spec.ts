// tests/ops/brief.spec.ts — Loop 3 gather + parse.
import { describe, it, expect } from 'vitest';
import { gatherBriefContext, buildBriefPrompt, parseBriefResult } from '@/lib/ops/loops/brief';
import { job, inv, NOW } from './fixtures';

const jobs = [
  // Today (2026-06-16)
  job({ id: 'a', date: '2026-06-16', revenue: 100, tireCost: 40, tireSize: '225/65R17', source: 'Google', paymentStatus: 'Paid' }),
  job({ id: 'b', date: '2026-06-16', revenue: 200, tireCost: 60, tireSize: '225/65R17', source: 'Referral', paymentStatus: 'Pending Payment' }),
  // Earlier this week (within 7 days)
  job({ id: 'c', date: '2026-06-13', revenue: 50, tireCost: 10, tireSize: '205/55R16', source: 'Google', paymentStatus: 'Paid' }),
  // Outside the week (older than 7 days) but inside 90 days — week totals ignore it.
  job({ id: 'd', date: '2026-06-01', revenue: 999, tireCost: 0, tireSize: '225/65R17', source: 'Google', paymentStatus: 'Paid' }),
];

const inventory = [inv({ id: 'i1', size: '225/65R17', qty: 0, cost: 50, reorderPoint: 1 })];

describe('gatherBriefContext', () => {
  const ctx = gatherBriefContext(jobs, inventory, { now: NOW });

  it('uses today (UTC) as the date', () => {
    expect(ctx.today).toBe('2026-06-16');
  });
  it('computes today totals (jobs, revenue, profit)', () => {
    expect(ctx.todayJobs).toBe(2);
    expect(ctx.todayRevenue).toBe(300);
    expect(ctx.todayProfit).toBe(200); // (100-40)+(200-60)
  });
  it('computes week totals and excludes jobs older than the window', () => {
    expect(ctx.weekJobs).toBe(3); // a, b, c (not d)
    expect(ctx.weekRevenue).toBe(350);
    expect(ctx.weekProfit).toBe(240); // 60 + 140 + 40
  });
  it('counts pending payments / unpaid invoices', () => {
    expect(ctx.pendingPayments.count).toBe(1);
    expect(ctx.pendingPayments.total).toBe(200);
  });
  it('ranks top sizes by week job count', () => {
    expect(ctx.topSizes[0]).toEqual({ size: '225/65R17', jobs: 2 });
  });
  it('attributes lead source from job.source (no leads pipeline)', () => {
    expect(ctx.topSources[0]).toEqual({ source: 'Google', jobs: 2 });
  });
  it('flags out-of-stock in-demand sizes for reorder', () => {
    expect(ctx.reorderFlags[0].size).toBe('225/65R17');
    expect(ctx.reorderFlags[0].onHand).toBe(0);
  });
  it('handles empty inputs', () => {
    const empty = gatherBriefContext([], [], { now: NOW });
    expect(empty.todayJobs).toBe(0);
    expect(empty.reorderFlags).toEqual([]);
  });
});

describe('buildBriefPrompt', () => {
  it('forbids the removed leads pipeline and asks for JSON', () => {
    const ctx = gatherBriefContext(jobs, inventory, { now: NOW });
    const { system } = buildBriefPrompt(ctx, 'Acme Tire');
    expect(system).toContain('JSON');
    expect(system.toLowerCase()).toContain('leads');
    expect(system.toLowerCase()).toContain('do not');
  });
});

describe('parseBriefResult', () => {
  it('parses a valid brief', () => {
    const raw = '{"headline":"Solid day","summary":"3 jobs this week.","mostImportant":"Reorder 225/65R17"}';
    const r = parseBriefResult(raw);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.mostImportant).toBe('Reorder 225/65R17');
  });
  it('fails on malformed output', () => {
    expect(parseBriefResult('sorry, no JSON').ok).toBe(false);
    expect(parseBriefResult('{}').ok).toBe(false);
  });
});
