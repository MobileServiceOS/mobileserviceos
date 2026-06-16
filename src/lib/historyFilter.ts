// src/lib/historyFilter.ts
// ───────────────────────────────────────────────────────────────────
//  Pure filter+sort for the Job History list. Extracted from History.tsx
//  so the filtering (incl. the tire-size search that powers the
//  Inventory → "View jobs for this size" reverse link) is testable.
// ───────────────────────────────────────────────────────────────────

import type { Job } from '@/types';
import { resolvePaymentStatus } from '@/lib/utils';
import { normalizeTireSizeQuery } from '@/lib/inventoryNotesParser';

export type HistoryFilter = 'all' | 'completed' | 'pending' | 'cancelled' | 'unpaid';

export function filterHistoryJobs(
  jobs: ReadonlyArray<Job>,
  query: string,
  filter: HistoryFilter,
): Job[] {
  let list = Array.isArray(jobs) ? [...jobs] : [];
  if (filter === 'completed') list = list.filter((j) => j.status === 'Completed');
  if (filter === 'pending') list = list.filter((j) => j.status === 'Pending');
  if (filter === 'cancelled') list = list.filter((j) => j.status === 'Cancelled');
  if (filter === 'unpaid') list = list.filter((j) => resolvePaymentStatus(j) === 'Pending Payment');

  const qRaw = (query || '').trim().toLowerCase();
  if (qRaw) {
    // Tire-size queries canonicalize: "215/55/17" matches jobs stored as
    // "215/55R17" and vice versa. Non-size queries (customer name, service,
    // phone, etc.) pass through. This is what the Inventory size → History
    // reverse link relies on to land on the right jobs.
    const q = normalizeTireSizeQuery(qRaw).toLowerCase();
    list = list.filter((j) => {
      const blob = [j.customerName, j.service, j.area, j.tireSize, j.customerPhone, j.fullLocationLabel]
        .filter(Boolean).join(' ').toLowerCase();
      return blob.includes(q);
    });
  }

  list.sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.id || '').localeCompare(a.id || ''));
  return list;
}
