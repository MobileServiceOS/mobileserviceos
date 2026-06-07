// src/lib/leadLifecycle.ts
// ═══════════════════════════════════════════════════════════════════
//  leadLifecycle — pure read-state + stage-timestamp derivation.
//
//  The Leads system separates three INDEPENDENT concepts that were
//  previously conflated into a single "NEW" badge:
//
//    • READ STATE   — unread vs viewed   (driven by lead.viewedAt)
//    • LEAD STATE   — New → … → Closed/Lost (driven by lead.status)
//    • CUSTOMER TYPE — New/Repeat/VIP/etc. (driven by the Customer doc,
//                      see leadPriority.ts)
//
//  Everything here is a pure function over REAL Firestore fields — no
//  inference, no time-window guessing, no fabricated state. The UI and
//  the Firestore-write call sites both consume these helpers so the
//  badge shown and the data written can never drift apart.
// ═══════════════════════════════════════════════════════════════════

import type { Lead, LeadStatus } from '@/types';

/** Minimal timestamp shape — matches firebase Timestamp without importing it. */
export interface TimestampLike { toMillis?: () => number; }

/** A field patch destined for setDoc(..., { merge: true }). */
export type LeadPatch = Record<string, unknown>;

// ── Read state ─────────────────────────────────────────────────────

export type ReadState = 'unread' | 'viewed';

/**
 * A lead is unread until it has been opened once (viewedAt written).
 * Absent viewedAt ⇒ unread. This is the single source of truth for the
 * "Unread" badge — it replaces the old wasNewCustomer-driven "NEW".
 */
export function isLeadUnread(lead: Pick<Lead, 'viewedAt'>): boolean {
  return !lead.viewedAt;
}

export function leadReadState(lead: Pick<Lead, 'viewedAt'>): ReadState {
  return isLeadUnread(lead) ? 'unread' : 'viewed';
}

/**
 * Patch to mark a lead viewed — written the first time it's opened.
 * Returns null when the lead is ALREADY viewed, so callers can skip a
 * redundant write (viewedAt is a stable first-open receipt, never moved).
 */
export function markViewedPatch(
  lead: Pick<Lead, 'viewedAt'>,
  uid: string,
  now: TimestampLike,
): LeadPatch | null {
  if (lead.viewedAt) return null;
  return { viewedAt: now, updatedAt: now, lastEditedByUid: uid };
}

// ── Lead state (lifecycle stages) ──────────────────────────────────

/** Maps each status to the timestamp field stamped on entering it. */
export const STAGE_TIMESTAMP_FIELD: Record<LeadStatus, keyof Lead | null> = {
  New:       null,           // creation time is receivedAt
  Contacted: 'contactedAt',
  Quoted:    'quotedAt',
  Booked:    'bookedAt',
  Closed:    'completedAt',
  Lost:      'lostAt',
};

/**
 * Patch for advancing a lead to `next`: sets status, stamps the stage's
 * timestamp (if any), and updates the audit fields. `extra` carries
 * stage-specific data (e.g. closedReason/closedAt for Lost).
 */
export function stageTransitionPatch(
  next: LeadStatus,
  uid: string,
  now: TimestampLike,
  extra?: LeadPatch,
): LeadPatch {
  const patch: LeadPatch = { status: next, updatedAt: now, lastEditedByUid: uid };
  const field = STAGE_TIMESTAMP_FIELD[next];
  if (field) patch[field] = now;
  return { ...patch, ...extra };
}
