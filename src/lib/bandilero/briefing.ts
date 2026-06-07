// src/lib/bandilero/briefing.ts
// ═══════════════════════════════════════════════════════════════════
//  Bandilero — Daily Briefing assembler (DETERMINISTIC orchestration).
//
//  This is the single orchestrator composing the deterministic services
//  into the command-center briefing. It owns NO business math itself —
//  it calls the services (and computeInsights once) and arranges the
//  results into sections + Top-3 Actions.
//
//  Guarantees:
//    • Every metric carries a confidence state (final assertValidMetric
//      sweep throws if any is malformed — a bad metric can't reach UI).
//    • Financial sections + dollar-impact Actions are REDACTED (not
//      faked) for viewers without financial permission (technicians).
//    • Sources with no integration (SEO/GBP/Dispatch) render as
//      NOT_CONNECTED, never as 0.
//    • The LLM narrative defaults to NOT_CONNECTED (AI optional).
// ═══════════════════════════════════════════════════════════════════

import type { Job, Lead, ReviewRequest, InventoryItem, Settings } from '@/types';
import { computeInsights } from '@/lib/insights';
import {
  type Metric,
  type LabeledMetric,
  live,
  notConnected,
  labeled,
  assertValidMetric,
} from './confidence';
import type { Briefing, BriefingSection, Connectivity } from './types';
import { revenueTodayVsYesterday, averageTicket } from './services/revenue';
import { grossProfitForRange } from './services/finance';
import { missedCallMetrics, missedCallStats } from './services/callIntel';
import { inventoryAlertMetrics } from './services/inventory';
import { reviewRequestMetrics } from './services/reviews';
import { computeAlerts, topActions } from './alerts';
import { getWeekStart } from '@/lib/utils';

export interface BriefingInput {
  today: string;
  settings: Settings;
  jobs: ReadonlyArray<Job>;
  leads: ReadonlyArray<Lead>;
  reviewRequests: ReadonlyArray<ReviewRequest>;
  inventory: ReadonlyArray<InventoryItem>;
  connectivity: Connectivity;
  operatorName: string | null;
  businessName: string | null;
  /** When false, financial sections + dollar Actions are redacted. */
  canViewFinancials: boolean;
  /** Trailing window (days) for missed-call / review counts. Default 7. */
  windowDays?: number;
  /** Optional LLM narrative. Defaults to NOT_CONNECTED (AI optional). */
  narrative?: Metric<string>;
}

function dateLabel(todayISO: string): string {
  const d = new Date(todayISO + 'T12:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

export function buildDailyBriefing(input: BriefingInput): Briefing {
  const { today, settings, jobs, leads, reviewRequests, inventory, connectivity } = input;
  const windowDays = input.windowDays ?? 7;

  // Compute the shared insights bundle ONCE (repeat, unpaid aging, daily jobs).
  const insights = computeInsights(jobs, settings, today);
  const avgTicket = averageTicket(jobs);

  // ── Revenue (financial) ─────────────────────────────────────────
  const rev = revenueTodayVsYesterday(jobs, today);
  const weekStart = getWeekStart(today, settings.workWeekStartDay ?? 1);
  const weekProfit = grossProfitForRange(jobs, settings, weekStart, today);
  const revenueSection: BriefingSection = {
    key: 'revenue',
    title: 'Revenue',
    metrics: [
      labeled(rev.today, 'Revenue today', 'money'),
      labeled(rev.yesterday, 'Revenue yesterday', 'money'),
      labeled(weekProfit, 'Gross profit (week to date)', 'money'),
    ],
  };

  // ── Jobs (operational, all roles): completed + pending ──────────
  const completedToday = jobs.filter((j) => j.date === today && j.status === 'Completed').length;
  // Pending = open jobs not yet completed/cancelled (any date).
  const pendingJobs = jobs.filter((j) => j.status === 'Pending').length;
  const jobsSection: BriefingSection = {
    key: 'jobs',
    title: 'Jobs',
    metrics: [
      labeled(live(completedToday, 'jobs', today), 'Completed today', 'count'),
      labeled(live(pendingJobs, 'jobs', today), 'Pending', 'count'),
      labeled(live(insights.dailyJobs.jobsThisWeek, 'jobs', today), 'Jobs this week', 'count'),
    ],
  };

  // ── Missed calls (counts only — operational; $ lives in Actions) ─
  const calls = missedCallMetrics(leads, connectivity, today, windowDays, avgTicket);
  const callStatsVal = connectivity.twilio ? missedCallStats(leads, today, windowDays) : null;
  const missedCallsSection: BriefingSection = {
    key: 'missedCalls',
    title: 'Missed calls',
    metrics: [
      labeled(calls.count, `Missed calls (${windowDays}d)`, 'count'),
      labeled(calls.recovered, 'Recovered', 'count'),
      labeled(calls.unrecovered, 'Unrecovered', 'count'),
    ],
  };

  // ── Reviews (request counts — operational) ──────────────────────
  const reviews = reviewRequestMetrics(reviewRequests, connectivity, today, windowDays);
  const reviewsSection: BriefingSection = {
    key: 'reviews',
    title: 'Review alerts',
    metrics: [
      labeled(reviews.sent, `Sent (${windowDays}d)`, 'count'),
      labeled(reviews.pending, 'Pending', 'count'),
      labeled(reviews.failed, 'Failed', 'count'),
    ],
  };

  // ── Inventory (counts — operational; $ value lives in Actions) ──
  const inv = inventoryAlertMetrics(inventory, jobs, today);
  const inventorySection: BriefingSection = {
    key: 'inventory',
    title: 'Inventory alerts',
    metrics: [
      labeled(inv.critical, 'Out of stock', 'count'),
      labeled(inv.low, 'Low stock', 'count'),
      labeled(inv.dead, 'Dead stock', 'count'),
    ],
  };

  // Customer + reputation/visibility detail live in their dedicated
  // Phase 2/3 panels (Customer Segments, Reputation) — the core command
  // briefing stays to the spec'd format to avoid duplication.

  // ── Top-3 Actions (financial — dollar impact) ───────────────────
  const allActions = computeAlerts({
    unpaidAging: insights.unpaidAging,
    missedCalls: calls,
    unrecoveredCount: callStatsVal?.unrecovered ?? 0,
    inventory: inv,
    avgTicket,
  });
  const ranked = topActions(allActions, 3);

  // ── Apply tech redaction (access overlay, NOT a confidence state) ─
  // Spec'd command-briefing order: Revenue → Jobs → Missed calls →
  // Review alerts → Inventory alerts (greeting + Top-3 Actions render
  // around these in the page).
  const sections: BriefingSection[] = [
    revenueSection, jobsSection, missedCallsSection,
    reviewsSection, inventorySection,
  ];
  let actionsRestricted = false;
  if (!input.canViewFinancials) {
    // Withhold financial values the technician isn't permitted to see —
    // never replace with a fake number.
    revenueSection.restricted = true;
    revenueSection.metrics = [];
    actionsRestricted = true;
  }
  const visibleActions = input.canViewFinancials ? ranked : [];

  // ── Invariant sweep: every metric must be a valid confidence state ─
  for (const s of sections) {
    for (const m of s.metrics) assertValidMetric(m, `${s.key}.${m.label}`);
  }
  for (const a of visibleActions) assertValidMetric(a.impact, `action.${a.id}`);
  const narrative = input.narrative ?? notConnected<string>('AI not connected', 'ai');
  assertValidMetric(narrative, 'narrative');

  return {
    greeting: {
      operatorName: input.operatorName,
      businessName: input.businessName,
      dateLabel: dateLabel(today),
    },
    sections,
    topActions: visibleActions,
    actionsRestricted,
    narrative,
    generatedFor: today,
    connectivity,
  };
}
