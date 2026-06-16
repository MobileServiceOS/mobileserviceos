// tests/leadSourceAttribution.spec.ts
// Run: npx vitest run tests/leadSourceAttribution.spec.ts
//
// Guards the critical invariant for the Leads-tab removal: the Insights
// "Top Lead Sources by Revenue" card is fed by job.source (captured on the
// AddJob form), NOT by the removed Leads pipeline. Removing Leads must not
// break attribution.

import { describe, it, expect } from 'vitest';
import { computeInsights } from '@/lib/insights';
import { DEFAULT_SETTINGS } from '@/lib/defaults';
import type { Job } from '@/types';

const job = (over: Partial<Job>): Job => ({
  id: Math.random().toString(36).slice(2),
  status: 'Completed', date: '2026-05-10', tireSize: '', qty: 1, revenue: 100,
  tireCost: 0, materialCost: 0, miles: 0, note: '', customerName: '', service: 'Tire',
  source: '', emergency: false, lateNight: false, highway: false, weekend: false,
  tireSource: 'in_stock',
  ...over,
}) as Job;

describe('lead-source attribution survives Leads removal', () => {
  const jobs = [
    job({ source: 'Google', revenue: 300 }),
    job({ source: 'Referral', revenue: 500 }),
    job({ source: 'Google', revenue: 200 }),
    job({ source: '', revenue: 50 }), // blank → "Unknown"
  ];
  const ins = computeInsights(jobs, DEFAULT_SETTINGS, '2026-05-31');

  it('topSources is derived from job.source (not the Leads pipeline)', () => {
    const google = ins.topSources.find((s) => s.source === 'Google');
    const referral = ins.topSources.find((s) => s.source === 'Referral');
    expect(google).toMatchObject({ revenue: 500, count: 2 });
    expect(referral).toMatchObject({ revenue: 500, count: 1 });
  });

  it('ranks sources by revenue, highest first', () => {
    // Referral (500, 1 job) and Google (500, 2 jobs) tie on revenue; both
    // outrank Unknown (50). The top entry is one of the 500-revenue sources.
    expect(ins.topSources[0].revenue).toBe(500);
    expect(ins.topSources.at(-1)).toMatchObject({ source: 'Unknown', revenue: 50 });
  });

  it('blank source falls back to "Unknown" (no crash, still attributed)', () => {
    expect(ins.topSources.some((s) => s.source === 'Unknown')).toBe(true);
  });
});
