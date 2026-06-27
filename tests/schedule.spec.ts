// tests/schedule.spec.ts
// Run: npx vitest run tests/schedule.spec.ts
//
// The two scheduling selectors behind the home "Today's Schedule" section
// and the Jobs → "Upcoming" list. Today shows only today's pipeline jobs;
// Upcoming shows all pipeline jobs sorted soonest-first.

import { describe, it, expect } from 'vitest';
import { todaysSchedule, upcomingSchedule } from '@/lib/schedule';
import { EMPTY_JOB } from '@/lib/defaults';
import type { Job } from '@/types';

const job = (o: Partial<Job>): Job => ({ ...EMPTY_JOB(), ...o });
const TODAY = '2026-06-27';

describe('todaysSchedule', () => {
  it('includes only scheduled-pipeline jobs whose appointment is today, sorted by time', () => {
    const jobs = [
      job({ id: 'a', status: 'Scheduled', appointmentDate: `${TODAY}T14:00` }),
      job({ id: 'b', status: 'En Route', appointmentDate: `${TODAY}T09:30` }),
      job({ id: 'c', status: 'Scheduled', appointmentDate: '2026-06-29T10:00' }), // future day
      job({ id: 'd', status: 'Completed', appointmentDate: `${TODAY}T11:00` }),  // not in pipeline
      job({ id: 'e', status: 'In Progress', appointmentDate: `${TODAY}T08:00` }),
    ];
    // 08:00 (e) → 09:30 (b) → 14:00 (a); c (future) and d (completed) excluded.
    expect(todaysSchedule(jobs, TODAY).map((j) => j.id)).toEqual(['e', 'b', 'a']);
  });

  it('excludes a job scheduled for tomorrow', () => {
    const jobs = [job({ id: 'x', status: 'Scheduled', appointmentDate: '2026-06-28T09:00' })];
    expect(todaysSchedule(jobs, TODAY)).toHaveLength(0);
  });

  it('is empty when nothing is booked today', () => {
    expect(todaysSchedule([], TODAY)).toHaveLength(0);
    expect(todaysSchedule(null, TODAY)).toHaveLength(0);
  });
});

describe('upcomingSchedule', () => {
  it('returns every pipeline job sorted by appointment ascending', () => {
    const jobs = [
      job({ id: 'jul6', status: 'Scheduled', appointmentDate: '2026-07-06T10:00' }),
      job({ id: 'sun', status: 'Scheduled', appointmentDate: '2026-06-29T13:00' }),
      job({ id: 'done', status: 'Completed', appointmentDate: '2026-06-20T10:00' }), // excluded
    ];
    // Sunday June 29 before July 6; the completed job is not "upcoming".
    expect(upcomingSchedule(jobs).map((j) => j.id)).toEqual(['sun', 'jul6']);
  });

  it('is empty with no pipeline jobs', () => {
    expect(upcomingSchedule([job({ status: 'Completed' }), job({ status: 'Cancelled' })])).toHaveLength(0);
  });
});
