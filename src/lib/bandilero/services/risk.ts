// src/lib/bandilero/services/risk.ts
// ═══════════════════════════════════════════════════════════════════
//  Bandilero — Risk signals (DETERMINISTIC, no LLM).
//
//  Surfaces risk as Action-shaped items (so Growth can rank everything
//  uniformly by dollar exposure). Focused on signals NOT already raised
//  by the Phase 1 alerts (unpaid, missed calls, stock) to avoid
//  double-counting:
//    • churn risk          — at-risk customers' near-term revenue (ESTIMATED)
//    • revenue-decline risk — week-over-week drop from revenueTrend (LIVE $)
// ═══════════════════════════════════════════════════════════════════

import { money } from '@/lib/utils';
import type { WeekPoint } from '@/lib/insights';
import type { CustomerProfile } from '@/lib/customers';
import { type Action } from '../types';
import { live, estimated } from '../confidence';

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/** Min week-over-week revenue drop (%) before a decline risk fires. */
const REVENUE_DECLINE_PCT = 15;

export interface RiskInput {
  /** At-risk customers (from customerSegments). */
  atRiskCustomers: ReadonlyArray<CustomerProfile>;
  /** 8-week revenue trend, oldest → newest (computeInsights.revenueTrend). */
  revenueTrend: ReadonlyArray<WeekPoint>;
}

export function computeRisks(input: RiskInput): Action[] {
  const out: Action[] = [];

  // ── Churn risk — near-term revenue from at-risk customers ───────
  const atRisk = input.atRiskCustomers || [];
  if (atRisk.length > 0) {
    // Per-visit value = lifetime revenue ÷ jobCount, summed across the
    // at-risk set — a model of the revenue at stake if they don't return.
    const exposure = round2(
      atRisk.reduce((t, p) => t + (p.jobCount > 0 ? p.revenue / p.jobCount : 0), 0),
    );
    const sev = atRisk.length >= 5 ? 'high' : atRisk.length >= 2 ? 'medium' : 'low';
    out.push({
      id: 'risk-churn',
      title: 'Win back at-risk customers',
      detail: `${atRisk.length} repeat customer(s) overdue for a visit.`,
      severity: sev,
      impact: estimated(
        exposure,
        `est. next-visit value of ${atRisk.length} at-risk customer(s) (avg revenue per visit)`,
        'customers',
      ),
      source: 'customers',
    });
  }

  // ── Revenue-decline risk — last complete week vs the prior week ──
  const t = input.revenueTrend || [];
  if (t.length >= 3) {
    const recent = t[t.length - 2]; // last COMPLETE week (last entry is the partial current week)
    const prior = t[t.length - 3];
    if (prior.revenue > 0 && recent.revenue < prior.revenue) {
      const dropPct = round2(((prior.revenue - recent.revenue) / prior.revenue) * 100);
      if (dropPct >= REVENUE_DECLINE_PCT) {
        const dropDollars = round2(prior.revenue - recent.revenue);
        out.push({
          id: 'risk-revenue-decline',
          title: 'Revenue is trending down',
          detail: `Last full week ${money(recent.revenue)} vs prior ${money(prior.revenue)} — down ${dropPct}%.`,
          severity: dropPct >= 30 ? 'high' : 'medium',
          impact: live(dropDollars, 'jobs'),
          source: 'jobs',
        });
      }
    }
  }

  return out;
}
