// src/lib/bandilero/commandCore.ts
// ═══════════════════════════════════════════════════════════════════
//  Bandilero — AI Core model (DETERMINISTIC).
//
//  Derives the 8 intelligence-node descriptors + the core state from
//  REAL data: module Data-Confidence (health) + the real ranked alerts
//  (badge counts). No fabricated state — a node only pulses/badges when
//  its module is actually connected / actually has alerts.
// ═══════════════════════════════════════════════════════════════════

import type { ModuleStatus } from './moduleStatus';
import type { Action } from './types';

export type CoreState = 'healthy' | 'analyzing' | 'alert';
export type NodeKey = 'revenue' | 'customers' | 'pricing' | 'inventory' | 'dispatch' | 'reputation' | 'seo' | 'growth';

export interface CoreNode {
  key: NodeKey;
  label: string;
  icon: string;
  status: ModuleStatus;
  alerts: number;
  /** Element id to scroll to on tap. */
  targetId: string;
}

const NODE_DEFS: { key: NodeKey; label: string; icon: string; targetId: string }[] = [
  { key: 'revenue',    label: 'Revenue',    icon: '💵', targetId: 'bnd-mod-revenue' },
  { key: 'customers',  label: 'Customers',  icon: '👥', targetId: 'bnd-mod-customer' },
  { key: 'pricing',    label: 'Pricing',    icon: '🏷️', targetId: 'bnd-mod-pricing' },
  { key: 'inventory',  label: 'Inventory',  icon: '📦', targetId: 'bnd-mod-inventory' },
  { key: 'dispatch',   label: 'Dispatch',   icon: '🛰️', targetId: 'bnd-mod-dispatch' },
  { key: 'reputation', label: 'Reputation', icon: '⭐', targetId: 'bnd-mod-reputation' },
  { key: 'seo',        label: 'SEO',        icon: '🔍', targetId: 'bnd-mod-reputation' },
  { key: 'growth',     label: 'Growth',     icon: '📈', targetId: 'bnd-mod-growth' },
];

/** Map a real alert id to the node it belongs to (null = no node). */
export function nodeForAlert(id: string): NodeKey | null {
  if (id.startsWith('pricing-')) return 'pricing';
  if (id === 'risk-churn') return 'customers';
  if (id === 'unpaid-invoices' || id === 'risk-revenue-decline') return 'revenue';
  if (id === 'critical-stock' || id === 'dead-stock') return 'inventory';
  if (id === 'missed-calls') return 'growth';
  return null;
}

/** Real alert counts per node, from the ranked recommendations. */
export function alertCountsByNode(recommendations: ReadonlyArray<Action>): Record<NodeKey, number> {
  const counts = { revenue: 0, customers: 0, pricing: 0, inventory: 0, dispatch: 0, reputation: 0, seo: 0, growth: 0 } as Record<NodeKey, number>;
  for (const a of recommendations) {
    const k = nodeForAlert(a.id);
    if (k) counts[k] += 1;
  }
  return counts;
}

/** Core state from real alert totals. */
export function coreStateFrom(criticalCount: number, totalAlerts: number): CoreState {
  if (criticalCount > 0) return 'alert';
  if (totalAlerts > 0) return 'analyzing';
  return 'healthy';
}

/** Build the 8 node descriptors from module statuses + real alerts. */
export function buildCoreNodes(statuses: Record<NodeKey, ModuleStatus>, recommendations: ReadonlyArray<Action>): CoreNode[] {
  const counts = alertCountsByNode(recommendations);
  return NODE_DEFS.map((d) => ({ ...d, status: statuses[d.key], alerts: counts[d.key] }));
}
