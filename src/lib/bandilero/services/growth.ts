// src/lib/bandilero/services/growth.ts
// ═══════════════════════════════════════════════════════════════════
//  Bandilero — Growth synthesis + recommendation ranking
//  (DETERMINISTIC ranking; the narrative is AI-optional, in reasoning.ts).
//
//  Merges every opportunity surfaced across modules — Phase 1 alerts,
//  Phase 3 risks, and pricing gaps — into ONE list ranked by estimated
//  dollar impact. Dedups by id so the same signal can't appear twice.
//  This is the single source for "what to do next, biggest first".
// ═══════════════════════════════════════════════════════════════════

import { money } from '@/lib/utils';
import type { PricingDigest } from '@/lib/pricingInsights';
import { type Action } from '../types';
import { estimated, hasValue, type Metric } from '../confidence';

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/** Min underpricing gap (%) before a pricing opportunity is raised. */
const UNDERPRICED_PCT = 10;

/**
 * Pricing opportunities: per-(service,size) groups selling BELOW the
 * configured minimum (negative gapPct). Estimated lift = bringing the
 * median up to configuredMin across recent sales.
 */
export function pricingOpportunities(digest: PricingDigest): Action[] {
  const out: Action[] = [];
  for (const g of digest.groups || []) {
    if (g.gapPct > -UNDERPRICED_PCT) continue;           // not underpriced enough
    if (g.configuredMin <= g.medianRevenue) continue;    // no positive lift
    const lift = round2((g.configuredMin - g.medianRevenue) * g.sales);
    if (lift <= 0) continue;
    out.push({
      id: `pricing-${g.service}-${g.size}`,
      title: `Underpriced: ${g.service} ${g.size}`,
      detail: `Median ${money(g.medianRevenue)} vs configured min ${money(g.configuredMin)} (${g.gapPct}%) across ${g.sales} recent sales.`,
      severity: 'low',
      impact: estimated(
        lift,
        `est. lift to configured min ${money(g.configuredMin)} × ${g.sales} recent sales`,
        'jobs',
      ),
      source: 'jobs',
    });
  }
  return out;
}

export interface GrowthInput {
  /** Phase 1 alerts (computeAlerts). */
  alerts: ReadonlyArray<Action>;
  /** Phase 3 risks (computeRisks). */
  risks: ReadonlyArray<Action>;
  /** Pricing digest (buildPricingDigest). */
  pricingDigest: PricingDigest;
}

function impactValue(m: Metric<number>): number {
  return hasValue(m) ? m.value : -Infinity;
}

/**
 * Unified, deduped, impact-ranked recommendation list across alerts,
 * risks, and pricing. First occurrence of an id wins.
 */
export function rankRecommendations(input: GrowthInput, n = 5): Action[] {
  const byId = new Map<string, Action>();
  for (const a of [...input.alerts, ...input.risks, ...pricingOpportunities(input.pricingDigest)]) {
    if (!byId.has(a.id)) byId.set(a.id, a);
  }
  return Array.from(byId.values())
    .sort((a, b) => impactValue(b.impact) - impactValue(a.impact))
    .slice(0, Math.max(0, n));
}
