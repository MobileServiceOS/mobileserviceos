// src/lib/bandilero/recommendations.ts
// ═══════════════════════════════════════════════════════════════════
//  Bandilero — recommendation orchestrator (DETERMINISTIC).
//
//  Assembles every opportunity across the modules — Phase 1 alerts,
//  Phase 3 risks, and pricing gaps — from raw real data, then ranks
//  them by dollar impact (growth.rankRecommendations). This is the
//  single "what to do next" list; the AI growth synthesis (reasoning.ts)
//  narrates it.
// ═══════════════════════════════════════════════════════════════════

import type { Job, Lead, InventoryItem, Settings } from '@/types';
import { computeInsights } from '@/lib/insights';
import { buildPricingDigest } from '@/lib/pricingInsights';
import { deriveCustomerProfiles } from '@/lib/customers';
import type { Action, Connectivity } from './types';
import { averageTicket } from './services/revenue';
import { missedCallMetrics, missedCallStats } from './services/callIntel';
import { inventoryAlertMetrics } from './services/inventory';
import { computeAlerts } from './alerts';
import { computeRisks } from './services/risk';
import { isAtRisk } from './services/customerSegments';
import { rankRecommendations } from './services/growth';

export interface RecommendationsInput {
  jobs: ReadonlyArray<Job>;
  leads: ReadonlyArray<Lead>;
  inventory: ReadonlyArray<InventoryItem>;
  settings: Settings;
  connectivity: Pick<Connectivity, 'twilio'>;
  today: string;
  windowDays: number;
}

export function buildRecommendations(input: RecommendationsInput, topN = 6): Action[] {
  const { jobs, leads, inventory, settings, connectivity, today, windowDays } = input;

  const insights = computeInsights(jobs, settings, today);
  const avgTicket = averageTicket(jobs);

  const calls = missedCallMetrics(leads, connectivity, today, windowDays, avgTicket);
  const callStats = connectivity.twilio ? missedCallStats(leads, today, windowDays) : null;
  const inv = inventoryAlertMetrics(inventory, jobs, today);

  const alerts = computeAlerts({
    unpaidAging: insights.unpaidAging,
    missedCalls: calls,
    unrecoveredCount: callStats?.unrecovered ?? 0,
    inventory: inv,
    avgTicket,
  });

  const profiles = deriveCustomerProfiles(jobs as Job[], settings);
  const atRiskCustomers = profiles.filter((p) => isAtRisk(p, today));
  const risks = computeRisks({ atRiskCustomers, revenueTrend: insights.revenueTrend });

  const pricingDigest = buildPricingDigest(jobs, settings, today);

  return rankRecommendations({ alerts, risks, pricingDigest }, topN);
}
