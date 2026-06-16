// tests/ops/fixtures.ts
// Minimal Job / InventoryItem builders for the ops-layer specs. The
// gather functions only read a handful of fields; we cast partials so
// tests stay readable without constructing the full ~100-field Job.
import type { Job, InventoryItem } from '@/types';

export function job(p: Partial<Job>): Job {
  return {
    id: 'j',
    date: '2026-06-16',
    status: 'Completed',
    tireSize: '',
    qty: 1,
    revenue: 0,
    tireCost: 0,
    materialCost: 0,
    source: '',
    paymentStatus: 'Paid',
    ...p,
  } as unknown as Job;
}

export function inv(p: Partial<InventoryItem>): InventoryItem {
  return { id: 'i', size: '', qty: 0, cost: 0, ...p } as InventoryItem;
}

export const NOW = new Date('2026-06-16T12:00:00Z');
