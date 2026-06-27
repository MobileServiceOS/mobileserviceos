// tests/scheduledRevenueExclusion.spec.ts
// Run: npx vitest run tests/scheduledRevenueExclusion.spec.ts
//
// Hard requirement of the scheduling feature: a Scheduled job (booked ahead,
// not yet done) must NOT count toward revenue/profit until it's Completed.
// The allow-list surfaces (Dashboard/Payouts: status === 'Completed') already
// exclude it; these guard the two DENY-list surfaces that previously only
// excluded Cancelled — Insights and customer profiles.

import { describe, it, expect } from 'vitest';
import { computeInsights } from '@/lib/insights';
import { deriveCustomerProfiles } from '@/lib/customers';
import { EMPTY_JOB } from '@/lib/defaults';
import type { Job, Settings } from '@/types';

const settings = { workWeekStartDay: 1, costPerMile: 0, freeMilesIncluded: 0 } as unknown as Settings;
const TODAY = '2026-06-27';
const job = (o: Partial<Job>): Job => ({ ...EMPTY_JOB(), ...o });

describe('Insights revenue excludes scheduled jobs', () => {
  it('a Scheduled job with a price does not inflate top-service revenue', () => {
    const jobs = [
      job({ id: 'done', status: 'Completed', service: 'Flat Tire Repair', revenue: 100, date: TODAY }),
      job({ id: 'booked', status: 'Scheduled', service: 'Flat Tire Repair', revenue: 999, date: TODAY, appointmentDate: '2026-06-29T10:00' }),
    ];
    const ins = computeInsights(jobs, settings, TODAY);
    const flat = ins.topServices.find((s) => s.service === 'Flat Tire Repair');
    expect(flat?.revenue).toBe(100); // 999 from the scheduled job is excluded
    expect(flat?.count).toBe(1);
  });

  it('scheduled jobs do not count toward today/this-week job stats', () => {
    const jobs = [
      job({ id: 'done', status: 'Completed', revenue: 50, date: TODAY }),
      job({ id: 'booked', status: 'Scheduled', revenue: 50, date: TODAY, appointmentDate: `${TODAY}T15:00` }),
    ];
    const ins = computeInsights(jobs, settings, TODAY);
    expect(ins.dailyJobs.jobsToday).toBe(1); // only the completed one
  });
});

describe('Customer profiles revenue excludes scheduled jobs', () => {
  it('lifetime revenue/profit ignore a booked-but-not-done job', () => {
    const jobs = [
      job({ id: 'done', customerPhone: '+13055551234', customerName: 'Lucas', status: 'Completed', revenue: 200, date: '2026-06-01' }),
      job({ id: 'booked', customerPhone: '+13055551234', customerName: 'Lucas', status: 'Scheduled', revenue: 800, appointmentDate: '2026-07-06T10:00' }),
    ];
    const profiles = deriveCustomerProfiles(jobs, settings);
    const lucas = profiles.find((p) => p.phone.includes('3055551234') || p.name === 'Lucas');
    expect(lucas).toBeTruthy();
    expect(lucas!.revenue).toBe(200); // the 800 scheduled job is excluded
  });
});
