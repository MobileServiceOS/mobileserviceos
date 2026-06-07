// src/lib/leadPriority.ts
// ═══════════════════════════════════════════════════════════════════
//  leadPriority — pure 5-badge taxonomy derivation.
//
//  Spec: docs/superpowers/specs/2026-06-04-sp4b-missed-call-recovery-design.md
//        §"Priority Score (new for SP4B)"
//
//  Reads existing SP3 Customer fields (vipTier, kind, jobCount) +
//  Lead.wasNewCustomer. Returns the sum of applicable badge scores
//  plus the list of badges for display. Test leads (id starts with
//  'lead-test-') short-circuit to score -1, no badges — so test
//  traffic doesn't pollute the live priority queue.
//
//  No persisted state. No Lead schema changes. Same Customer data
//  the Leads tab already subscribes to drives the priority signal.
// ═══════════════════════════════════════════════════════════════════

import type { Customer } from '@/lib/customerEntity';
import type { Lead } from '@/types';

export interface LeadPriorityBadge {
  // CUSTOMER-TYPE / value badges — distinct from read state (Unread/Viewed)
  // and lead state (status). new_customer reflects the Customer, not the
  // lead's read state, so it is labelled "New Customer", never "New".
  key: 'vip' | 'fleet' | 'high_value' | 'repeat_customer' | 'new_customer';
  label: 'VIP' | 'Fleet' | 'High Value' | 'Repeat Customer' | 'New Customer';
  score: number;
}

export interface LeadPriority {
  score: number;
  badges: LeadPriorityBadge[];
}

const BADGE_VIP:    LeadPriorityBadge = { key: 'vip',             label: 'VIP',             score: 100 };
const BADGE_FLEET:  LeadPriorityBadge = { key: 'fleet',           label: 'Fleet',           score: 80  };
const BADGE_HIGH:   LeadPriorityBadge = { key: 'high_value',      label: 'High Value',      score: 60  };
const BADGE_REPEAT: LeadPriorityBadge = { key: 'repeat_customer', label: 'Repeat Customer', score: 40  };
const BADGE_NEW:    LeadPriorityBadge = { key: 'new_customer',    label: 'New Customer',    score: 20  };

type CustomerSlice = Pick<Customer, 'vipTier' | 'kind' | 'jobCount'>;
type LeadSlice     = Pick<Lead, 'id' | 'wasNewCustomer'>;

export function computeLeadPriority(
  customer: CustomerSlice | null | undefined,
  lead: LeadSlice,
): LeadPriority {
  // Test-lead override — id pattern `lead-test-{uid}-{ms}` from the
  // sendTestMissedCall callable. Sort to the bottom of the queue.
  if (typeof lead.id === 'string' && lead.id.startsWith('lead-test-')) {
    return { score: -1, badges: [] };
  }

  const badges: LeadPriorityBadge[] = [];

  // VIP / High Value / Repeat Customer derive from vipTier — the
  // tiers are mutually exclusive so at most one of these three lands.
  if (customer?.vipTier === 'Platinum') {
    badges.push(BADGE_VIP);
  } else if (customer?.vipTier === 'Gold') {
    badges.push(BADGE_HIGH);
  } else if (
    customer?.vipTier === 'Standard'
    && typeof customer.jobCount === 'number'
    && customer.jobCount >= 2
  ) {
    badges.push(BADGE_REPEAT);
  }

  // Fleet stacks with any of the above.
  if (customer?.kind === 'fleet') {
    badges.push(BADGE_FLEET);
  }

  // New Customer applies when EITHER the lead flagged itself as a new
  // customer OR the customer has zero jobs on record (covers
  // backfill-without-jobs edge case + absent-customer fallback).
  const noJobs = !customer || typeof customer.jobCount !== 'number' || customer.jobCount === 0;
  if (lead.wasNewCustomer === true || noJobs) {
    badges.push(BADGE_NEW);
  }

  const score = badges.reduce((sum, b) => sum + b.score, 0);
  return { score, badges };
}
