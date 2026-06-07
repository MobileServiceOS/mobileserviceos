// src/lib/bandilero/alerts.ts
// ═══════════════════════════════════════════════════════════════════
//  Bandilero — Alerts & Top-3 Actions (DETERMINISTIC threshold checks).
//
//  Alerts are pure threshold checks over already-derived, real metrics.
//  Each Action carries an `impact` Metric (LIVE for real dollars,
//  ESTIMATED for modeled) and a `source`. The Top 3 Actions are simply
//  the alerts sorted by estimated dollar impact, descending.
//
//  No LLM. No fabricated numbers — an alert only fires when there is a
//  real, positive signal; modeled impacts are ESTIMATED with their
//  assumption attached.
// ═══════════════════════════════════════════════════════════════════

import type { AgingRow } from '@/lib/insights';
import { money } from '@/lib/utils';
import { type Metric, live, estimated, hasValue } from './confidence';
import type { Action } from './types';
import type { MissedCallMetrics } from './services/callIntel';
import type { InventoryAlertMetrics } from './services/inventory';

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

export interface AlertInput {
  /** Unpaid aging buckets from computeInsights (real $ + counts). */
  unpaidAging: AgingRow[];
  /** Missed-call metrics (already connectivity-aware). */
  missedCalls: MissedCallMetrics;
  /** Number of unrecovered missed calls (for the detail copy). */
  unrecoveredCount: number;
  /** Inventory health metrics (LIVE). */
  inventory: InventoryAlertMetrics;
  /** Average ticket — basis for the critical-stock lost-sales estimate. */
  avgTicket: number;
}

/**
 * Build the alert list. Order here is not significant — topActions()
 * ranks by dollar impact. Only fires alerts backed by a real positive
 * number.
 */
export function computeAlerts(input: AlertInput): Action[] {
  const actions: Action[] = [];

  // ── 1. Unpaid invoices (LIVE dollars) ──────────────────────────
  const unpaidTotal = round2(input.unpaidAging.reduce((t, r) => t + (Number(r.total) || 0), 0));
  const unpaidCount = input.unpaidAging.reduce((t, r) => t + (Number(r.count) || 0), 0);
  if (unpaidTotal > 0 && unpaidCount > 0) {
    // Worst (oldest) non-empty bucket drives severity.
    const oldest = [...input.unpaidAging].reverse().find((r) => (r.count || 0) > 0);
    const sev = oldest?.bucket === '60d+' ? 'high' : oldest?.bucket === '31-60d' ? 'medium' : 'low';
    actions.push({
      id: 'unpaid-invoices',
      title: 'Collect unpaid invoices',
      detail: `${unpaidCount} unpaid invoice(s) totaling ${money(unpaidTotal)}${oldest ? ` — oldest in ${oldest.bucket}` : ''}.`,
      severity: sev,
      impact: live(unpaidTotal, 'jobs'),
      source: 'jobs',
    });
  }

  // ── 2. Unrecovered missed calls (ESTIMATED) ────────────────────
  // Only when Twilio is connected (missedCalls.lostRevenue carries a
  // value) and there's actually unrecovered revenue at stake.
  if (hasValue(input.missedCalls.lostRevenue) && input.missedCalls.lostRevenue.value > 0) {
    const sev = input.unrecoveredCount >= 5 ? 'high' : input.unrecoveredCount >= 2 ? 'medium' : 'low';
    actions.push({
      id: 'missed-calls',
      title: 'Follow up on missed calls',
      detail: `${input.unrecoveredCount} unrecovered missed call(s) — ${input.missedCalls.lostRevenue.assumption}.`,
      severity: sev,
      impact: input.missedCalls.lostRevenue,
      source: 'leads',
    });
  }

  // ── 3. Out-of-stock on demand (ESTIMATED lost sales) ───────────
  if (hasValue(input.inventory.critical) && input.inventory.critical.value > 0 && input.avgTicket > 0) {
    const criticalCount = input.inventory.critical.value;
    const estLost = round2(criticalCount * input.avgTicket);
    const sev = criticalCount >= 5 ? 'high' : criticalCount >= 2 ? 'medium' : 'low';
    actions.push({
      id: 'critical-stock',
      title: 'Restock out-of-stock items',
      detail: `${criticalCount} item(s) at zero stock — potential lost sales.`,
      severity: sev,
      impact: estimated(
        estLost,
        `est. ${criticalCount} out-of-stock item(s) × avg ticket ${money(input.avgTicket)}`,
        'inventory',
      ),
      source: 'inventory',
    });
  }

  // ── 4. Dead stock tying up capital (LIVE dollars) ──────────────
  if (hasValue(input.inventory.deadValue) && input.inventory.deadValue.value > 0
      && hasValue(input.inventory.dead) && input.inventory.dead.value > 0) {
    const deadCount = input.inventory.dead.value;
    actions.push({
      id: 'dead-stock',
      title: 'Move dead stock',
      detail: `${deadCount} dead item(s) tying up ${money(input.inventory.deadValue.value)} in capital (no matching job in 90 days).`,
      severity: 'low',
      impact: input.inventory.deadValue,
      source: 'inventory',
    });
  }

  return actions;
}

/** Numeric impact for ranking; NOT_CONNECTED / null sink to the bottom. */
function impactValue(m: Metric<number>): number {
  return hasValue(m) ? m.value : -Infinity;
}

/**
 * Top N actions by dollar impact (desc). This IS the "Top 3 Actions"
 * surface — alerts ranked by estimated dollar impact.
 */
export function topActions(actions: Action[], n = 3): Action[] {
  return [...actions]
    .sort((a, b) => impactValue(b.impact) - impactValue(a.impact))
    .slice(0, Math.max(0, n));
}
