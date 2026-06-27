// src/lib/schedule.ts
// ═══════════════════════════════════════════════════════════════════
//  Pure selectors for the scheduling views. Kept out of the page
//  components so they're unit-testable and the home screen + Jobs tab
//  agree on exactly what "today" and "upcoming" mean.
// ═══════════════════════════════════════════════════════════════════

import type { Job } from '@/types';
import { isScheduledPipeline } from '@/lib/jobStatus';
import { apptDatePart } from '@/lib/utils';

/** Sort by appointment datetime ascending (soonest first). Jobs without an
 *  appointment sort to the front (empty string) — they shouldn't occur in
 *  these lists, but the comparator stays total. */
function byAppointmentAsc(a: Job, b: Job): number {
  return (a.appointmentDate || '').localeCompare(b.appointmentDate || '');
}

/**
 * Booked jobs in the scheduling pipeline (Scheduled / En Route / In Progress)
 * whose appointment falls on `today` (a YYYY-MM-DD string from TODAY()),
 * soonest first. Drives the home screen's "Today's Schedule" section.
 */
export function todaysSchedule(jobs: ReadonlyArray<Job> | null | undefined, today: string): Job[] {
  return (jobs || [])
    .filter((j) => isScheduledPipeline(j.status) && apptDatePart(j.appointmentDate) === today)
    .sort(byAppointmentAsc);
}

/**
 * Every booked job in the scheduling pipeline, soonest appointment first —
 * regardless of date. Drives the Jobs tab's "Upcoming" list (where a job
 * tomorrow and one next week show together).
 */
export function upcomingSchedule(jobs: ReadonlyArray<Job> | null | undefined): Job[] {
  return (jobs || [])
    .filter((j) => isScheduledPipeline(j.status))
    .sort(byAppointmentAsc);
}
