// tests/jobStatus.spec.ts
// Run: npx vitest run tests/jobStatus.spec.ts
//
// The scheduling pipeline transition rules: a job can only move FORWARD
// (Scheduled → En Route → In Progress → Completed), never backward, and a
// scheduled-pipeline job is "not done yet" (excluded from revenue/inventory).

import { describe, it, expect } from 'vitest';
import {
  isScheduledPipeline, nextStatus, nextStatusLabel, canAdvanceStatus,
} from '@/lib/jobStatus';

describe('isScheduledPipeline', () => {
  it('true for the booked-but-not-done states', () => {
    expect(isScheduledPipeline('Scheduled')).toBe(true);
    expect(isScheduledPipeline('En Route')).toBe(true);
    expect(isScheduledPipeline('In Progress')).toBe(true);
  });
  it('false for terminal / legacy / missing states', () => {
    expect(isScheduledPipeline('Completed')).toBe(false);
    expect(isScheduledPipeline('Pending')).toBe(false);
    expect(isScheduledPipeline('Cancelled')).toBe(false);
    expect(isScheduledPipeline(undefined)).toBe(false);
    expect(isScheduledPipeline(null)).toBe(false);
  });
});

describe('nextStatus / nextStatusLabel', () => {
  it('advances one step through the pipeline', () => {
    expect(nextStatus('Scheduled')).toBe('En Route');
    expect(nextStatus('En Route')).toBe('In Progress');
    expect(nextStatus('In Progress')).toBe('Completed');
  });
  it('returns null at the end and for terminal/legacy states', () => {
    expect(nextStatus('Completed')).toBe(null);
    expect(nextStatus('Cancelled')).toBe(null);
    expect(nextStatus('Pending')).toBe(null);
  });
  it('labels the one-tap advance button', () => {
    expect(nextStatusLabel('Scheduled')).toBe('Mark En Route');
    expect(nextStatusLabel('En Route')).toBe('Mark In Progress');
    expect(nextStatusLabel('In Progress')).toBe('Mark Complete');
    expect(nextStatusLabel('Completed')).toBe(null);
  });
});

describe('canAdvanceStatus — forward only, never backward', () => {
  it('allows strictly-forward moves (incl. skipping ahead)', () => {
    expect(canAdvanceStatus('Scheduled', 'En Route')).toBe(true);
    expect(canAdvanceStatus('Scheduled', 'In Progress')).toBe(true);
    expect(canAdvanceStatus('Scheduled', 'Completed')).toBe(true);
    expect(canAdvanceStatus('En Route', 'Completed')).toBe(true);
    expect(canAdvanceStatus('In Progress', 'Completed')).toBe(true);
  });
  it('rejects every backward move', () => {
    expect(canAdvanceStatus('En Route', 'Scheduled')).toBe(false);
    expect(canAdvanceStatus('In Progress', 'En Route')).toBe(false);
    expect(canAdvanceStatus('In Progress', 'Scheduled')).toBe(false);
    expect(canAdvanceStatus('Completed', 'In Progress')).toBe(false);
  });
  it('rejects no-ops and any exit from a terminal state', () => {
    expect(canAdvanceStatus('Scheduled', 'Scheduled')).toBe(false);
    expect(canAdvanceStatus('Completed', 'Cancelled')).toBe(false);
    expect(canAdvanceStatus('Cancelled', 'Scheduled')).toBe(false);
    expect(canAdvanceStatus('Cancelled', 'Completed')).toBe(false);
  });
  it('allows cancelling any non-terminal job', () => {
    expect(canAdvanceStatus('Scheduled', 'Cancelled')).toBe(true);
    expect(canAdvanceStatus('En Route', 'Cancelled')).toBe(true);
    expect(canAdvanceStatus('In Progress', 'Cancelled')).toBe(true);
  });
});
