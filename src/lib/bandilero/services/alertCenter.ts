// src/lib/bandilero/services/alertCenter.ts
// ═══════════════════════════════════════════════════════════════════
//  Bandilero — Alert Center (DETERMINISTIC categorization).
//
//  Buckets the already-ranked recommendations (real alerts only — they
//  fire from real signals, never fabricated) into:
//    CRITICAL    — out-of-stock, steep declines, oldest unpaid (high sev)
//    WARNING     — medium-severity risks (missed calls, dead stock, …)
//    OPPORTUNITY — pricing gaps + win-back (upside, not threats)
//  No new metrics; pure routing over Action[].
// ═══════════════════════════════════════════════════════════════════

import type { Action } from '../types';
import { hasValue } from '../confidence';

export type AlertCategory = 'critical' | 'warning' | 'opportunity';

export function categorizeAlert(a: Action): AlertCategory {
  // Upside items are opportunities regardless of severity.
  if (a.id.startsWith('pricing-') || a.id === 'risk-churn') return 'opportunity';
  if (a.severity === 'high') return 'critical';
  return 'warning';
}

export interface AlertCenter {
  critical: Action[];
  warning: Action[];
  opportunity: Action[];
  total: number;
}

function byImpactDesc(a: Action, b: Action): number {
  const av = hasValue(a.impact) ? a.impact.value : -Infinity;
  const bv = hasValue(b.impact) ? b.impact.value : -Infinity;
  return bv - av;
}

export function buildAlertCenter(recommendations: ReadonlyArray<Action>): AlertCenter {
  const critical: Action[] = [];
  const warning: Action[] = [];
  const opportunity: Action[] = [];
  for (const a of recommendations) {
    const c = categorizeAlert(a);
    if (c === 'critical') critical.push(a);
    else if (c === 'warning') warning.push(a);
    else opportunity.push(a);
  }
  critical.sort(byImpactDesc);
  warning.sort(byImpactDesc);
  opportunity.sort(byImpactDesc);
  return { critical, warning, opportunity, total: recommendations.length };
}
