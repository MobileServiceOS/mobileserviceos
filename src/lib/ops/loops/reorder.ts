// src/lib/ops/loops/reorder.ts
// ═══════════════════════════════════════════════════════════════════
//  Loop 1 — Reorder recommendations (READ-ONLY).
//
//  Reuses the app's existing deduped-inventory + job-count ranking
//  (computeSizeDemand + computeInventoryIntel) — it does NOT reinvent
//  ranking. The candidate set is:
//    • reorderNow  — in demand (jobs in window) AND at/below reorder
//                    point (the existing intelligence), PLUS
//    • hot sizes you carry ZERO of (out of stock / never stocked) that
//      still pull jobs — the ultimate reorder targets, which the
//      inventory-only list can't surface for never-stocked sizes.
//
//  Out-of-stock and most-called-for rank first. The model adds a
//  suggested buy quantity and a one-line reason per size; all the hard
//  numbers (combined on-hand, jobs/window, avg $/tire) come from our
//  deterministic gather, not the model.
//
//  The owner places the actual order — nothing here acts on its own.
// ═══════════════════════════════════════════════════════════════════

import type { Job, InventoryItem } from '@/types';
import {
  computeSizeDemand,
  computeInventoryIntel,
  sizeKey,
  type SizeDemand,
} from '@/lib/inventoryIntel';
import { safeParseJson, asNumber, asString, type ParseResult } from '@/lib/ops/json';

/** One ranked reorder candidate, with the deterministic numbers. */
export interface ReorderContextItem {
  /** Display tire size, e.g. "225/65R17". */
  size: string;
  /** Combined on-hand across every inventory entry of this size. */
  onHand: number;
  /** Distinct jobs this size appeared in within the window. */
  jobsInWindow: number;
  /** Tire units sold in the window. */
  unitsInWindow: number;
  /** Revenue from this size in the window. */
  revenueInWindow: number;
  /** Average revenue per tire (revenue / units), rounded to cents. */
  avgPerTire: number;
  /** True when combined on-hand is zero. */
  outOfStock: boolean;
}

export interface ReorderContext {
  windowDays: number;
  items: ReorderContextItem[];
}

/** The model's per-size recommendation, merged with context in the UI. */
export interface ReorderRecommendation {
  size: string;
  suggestedBuyQty: number;
  reason: string;
}

export interface ReorderResult {
  recommendations: ReorderRecommendation[];
}

const DEFAULT_WINDOW_DAYS = 90;
const MAX_CANDIDATES = 8;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Gather the reorder context from already-loaded MSOS data. Pure — same
 * inputs, same output — so it is unit-testable without Firestore.
 */
export function gatherReorderContext(
  jobs: ReadonlyArray<Job> | null | undefined,
  inventory: ReadonlyArray<InventoryItem> | null | undefined,
  opts: { windowDays?: number; now?: Date } = {},
): ReorderContext {
  const windowDays = opts.windowDays ?? DEFAULT_WINDOW_DAYS;
  const now = opts.now ?? new Date();
  const jobsArr = jobs ?? [];
  const invArr = inventory ?? [];

  const demand = computeSizeDemand(jobsArr, { windowDays, now });

  // Reuse the existing reorder intelligence for in-stock-ish candidates.
  const intel = computeInventoryIntel(
    invArr.map((i) => ({ id: i.id, size: i.size, qty: i.qty, cost: i.cost, reorderPoint: i.reorderPoint })),
    demand,
  );

  // Combined on-hand per normalized size (matches Inventory's qtyBySize).
  const onHandByKey = new Map<string, number>();
  for (const i of invArr) {
    const key = sizeKey(i.size || '');
    if (!key) continue;
    onHandByKey.set(key, (onHandByKey.get(key) ?? 0) + (Number(i.qty) || 0));
  }

  // Representative display string per size key (prefer inventory's, then
  // the first job's) so never-stocked candidates still show a real size.
  const displayByKey = new Map<string, string>();
  for (const i of invArr) {
    const raw = (i.size || '').trim();
    if (!raw) continue;
    const key = sizeKey(raw);
    if (key && !displayByKey.has(key)) displayByKey.set(key, raw);
  }
  for (const j of jobsArr) {
    const raw = (j.tireSize || '').trim();
    if (!raw) continue;
    const key = sizeKey(raw);
    if (key && !displayByKey.has(key)) displayByKey.set(key, raw);
  }

  const toItem = (key: string, size: string, d: SizeDemand | undefined): ReorderContextItem => {
    const onHand = onHandByKey.get(key) ?? 0;
    const jobsInWindow = d?.jobs ?? 0;
    const unitsInWindow = d?.units ?? 0;
    const revenueInWindow = d?.revenue ?? 0;
    return {
      size,
      onHand,
      jobsInWindow,
      unitsInWindow,
      revenueInWindow: round2(revenueInWindow),
      avgPerTire: unitsInWindow > 0 ? round2(revenueInWindow / unitsInWindow) : 0,
      outOfStock: onHand === 0,
    };
  };

  const byKey = new Map<string, ReorderContextItem>();

  // 1) Existing reorderNow intelligence (in demand + low/out of stock).
  for (const r of intel.reorderNow) {
    const key = sizeKey(r.size);
    if (!key || byKey.has(key)) continue;
    byKey.set(key, toItem(key, r.size, demand.get(key)));
  }

  // 2) Hot sizes we carry zero of (out of stock / never stocked).
  for (const [key, d] of demand.entries()) {
    if (d.jobs <= 0) continue;
    if (byKey.has(key)) continue;
    if ((onHandByKey.get(key) ?? 0) > 0) continue; // only the empties here
    const size = displayByKey.get(key) ?? key;
    byKey.set(key, toItem(key, size, d));
  }

  // Rank: out-of-stock first, then most jobs, then revenue, then units.
  const items = Array.from(byKey.values()).sort((a, b) => {
    if (a.outOfStock !== b.outOfStock) return a.outOfStock ? -1 : 1;
    if (b.jobsInWindow !== a.jobsInWindow) return b.jobsInWindow - a.jobsInWindow;
    if (b.revenueInWindow !== a.revenueInWindow) return b.revenueInWindow - a.revenueInWindow;
    return b.unitsInWindow - a.unitsInWindow;
  });

  return { windowDays, items: items.slice(0, MAX_CANDIDATES) };
}

/** Build the JSON-only prompt for the reorder loop. */
export function buildReorderPrompt(
  ctx: ReorderContext,
  businessName: string,
): { system: string; user: string } {
  const system = [
    `You are an inventory analyst for ${businessName}, a mobile tire repair service.`,
    `You are given candidate tire sizes with their demand and current stock over the last ${ctx.windowDays} days.`,
    `Recommend what to reorder.`,
    ``,
    `Return ONLY a JSON object, no prose, no code fences, in exactly this shape:`,
    `{"recommendations":[{"size":"<size>","suggestedBuyQty":<integer>,"reason":"<one short line>"}]}`,
    ``,
    `Rules:`,
    `- Recommend ONLY from the provided sizes; echo the size string exactly.`,
    `- Rank out-of-stock and most-called-for sizes first.`,
    `- suggestedBuyQty is a sensible whole number based on jobs in the window and current on-hand (cover expected demand, don't overbuy).`,
    `- reason is ONE short line referencing the data (jobs, stock, or revenue).`,
    `- Do not invent sizes or numbers. Output nothing except the JSON object.`,
  ].join('\n');

  const user = JSON.stringify({ windowDays: ctx.windowDays, candidates: ctx.items }, null, 2);
  return { system, user };
}

/** Safely parse + validate the model's reorder output. */
export function parseReorderResult(raw: string): ParseResult<ReorderResult> {
  const parsed = safeParseJson<unknown>(raw);
  if (!parsed.ok) return parsed;

  const root = parsed.value as { recommendations?: unknown };
  const list = Array.isArray(root?.recommendations) ? root.recommendations : null;
  if (!list) return { ok: false, error: 'missing "recommendations" array' };

  const recommendations: ReorderRecommendation[] = [];
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    const size = asString(e.size);
    const reason = asString(e.reason);
    const qty = Math.max(0, Math.round(asNumber(e.suggestedBuyQty, 0)));
    if (!size) continue; // a recommendation without a size is unusable
    recommendations.push({ size, suggestedBuyQty: qty, reason });
  }

  if (recommendations.length === 0) {
    return { ok: false, error: 'no valid recommendations in response' };
  }
  return { ok: true, value: { recommendations } };
}
