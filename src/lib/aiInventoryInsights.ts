// src/lib/aiInventoryInsights.ts
// ═══════════════════════════════════════════════════════════════════
//  Inventory AI Insights — pure helpers (roadmap inventory
//  upgrade — Phase 4 / final). Mirrors aiInsights.ts: build a
//  compact aggregate digest, ground Claude's reply against the
//  digest's number set.
//
//  Owner/admin only at the UI layer; pure here.
//  Spec: docs/superpowers/specs/2026-05-22-inventory-ai-insights-design.md
// ═══════════════════════════════════════════════════════════════════

import type { InventoryItem, Job } from '@/types';
import { normalizeTireSize } from '@/lib/utils';
import { inventoryHealthCounts } from '@/lib/inventoryHealth';
import { availableQty, reservedQty } from '@/lib/inventoryReservations';

export interface InventoryInsightsDigest {
  totalSKUs: number;
  totalQty: number;
  totalValue: number;
  criticalCount: number;
  lowCount: number;
  healthyCount: number;
  deadCount: number;
  topSelling: Array<{ size: string; count: number }>;
  slowMovers: Array<{ size: string; qty: number; daysSinceLastJob: number | null }>;
  topReserved: Array<{ size: string; reserved: number; available: number }>;
}

export type InventoryInsightsResult =
  | { ok: true; bullets: string[] }
  | { ok: false; error: string };

const TOP_SELL_N = 5;
const SLOW_MOVE_N = 5;
const TOP_RESERVED_N = 3;
const TOP_SELL_WINDOW_DAYS = 30;
const SLOW_MOVE_WINDOW_DAYS = 84;
const MAX_BULLETS = 6;
const r = Math.round;

function daysBetween(a: string, b: string): number {
  const ta = new Date(a + 'T00:00:00Z').getTime();
  const tb = new Date(b + 'T00:00:00Z').getTime();
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return Infinity;
  return Math.max(0, Math.floor((ta - tb) / 86_400_000));
}

export function buildInventoryInsightsInput(
  items: ReadonlyArray<InventoryItem>,
  jobs: ReadonlyArray<Job>,
  today: string,
): InventoryInsightsDigest {
  // Totals.
  let totalQty = 0;
  let totalValue = 0;
  for (const it of items) {
    const q = Number(it.qty || 0);
    const c = Number(it.cost || 0);
    if (Number.isFinite(q)) totalQty += q;
    if (Number.isFinite(q) && Number.isFinite(c)) totalValue += q * c;
  }

  // Health counts (Phase 2 helper).
  const health = inventoryHealthCounts(items, jobs, today);

  // Map of normalized size → user-facing size (first-seen).
  const labelBySize = new Map<string, string>();
  for (const it of items) {
    const n = normalizeTireSize(it.size || '');
    if (n && !labelBySize.has(n)) labelBySize.set(n, it.size);
  }

  // Top selling: jobs in the last TOP_SELL_WINDOW_DAYS, by size.
  const sellTally = new Map<string, number>();
  // Also track the latest job date per normalized size (for slow movers).
  const lastJobDateBySize = new Map<string, string>();
  for (const j of jobs) {
    const n = normalizeTireSize(j.tireSize || '');
    if (!n || !j.date) continue;
    const age = daysBetween(today, j.date);
    if (age <= TOP_SELL_WINDOW_DAYS) {
      sellTally.set(n, (sellTally.get(n) || 0) + 1);
    }
    const prev = lastJobDateBySize.get(n);
    if (!prev || j.date > prev) lastJobDateBySize.set(n, j.date);
    if (!labelBySize.has(n)) labelBySize.set(n, j.tireSize);
  }
  const topSelling = Array.from(sellTally.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_SELL_N)
    .map(([n, count]) => ({ size: labelBySize.get(n) || n, count }));

  // Slow movers: qty > 1, no matching job within SLOW_MOVE_WINDOW_DAYS.
  const slowCandidates: Array<{ size: string; qty: number; daysSinceLastJob: number | null }> = [];
  for (const it of items) {
    const q = Number(it.qty || 0);
    if (q <= 1) continue;
    const n = normalizeTireSize(it.size || '');
    if (!n) continue;
    const lastDate = lastJobDateBySize.get(n);
    const days = lastDate ? daysBetween(today, lastDate) : null;
    const isSlow = days === null || days > SLOW_MOVE_WINDOW_DAYS;
    if (!isSlow) continue;
    slowCandidates.push({ size: it.size, qty: q, daysSinceLastJob: days });
  }
  slowCandidates.sort((a, b) => {
    const ad = a.daysSinceLastJob === null ? Infinity : a.daysSinceLastJob;
    const bd = b.daysSinceLastJob === null ? Infinity : b.daysSinceLastJob;
    return bd - ad;
  });
  const slowMovers = slowCandidates.slice(0, SLOW_MOVE_N);

  // Top reserved.
  const reservedCandidates: Array<{ size: string; reserved: number; available: number }> = [];
  for (const it of items) {
    const rq = reservedQty(it);
    if (rq <= 0) continue;
    reservedCandidates.push({
      size: it.size, reserved: rq, available: availableQty(it),
    });
  }
  reservedCandidates.sort((a, b) => b.reserved - a.reserved);
  const topReserved = reservedCandidates.slice(0, TOP_RESERVED_N);

  return {
    totalSKUs: items.length,
    totalQty: r(totalQty),
    totalValue: r(totalValue),
    criticalCount: health.critical,
    lowCount: health.low,
    healthyCount: health.healthy,
    deadCount: health.dead,
    topSelling,
    slowMovers,
    topReserved,
  };
}

// Flatten every numeric value in the digest into a Set<number>. Tire
// size strings contribute their CONSTITUENT digits (225/65R17 → 225,
// 65, 17) so a bullet referencing a size by its digits is grounded.
function digestNumbers(d: InventoryInsightsDigest): Set<number> {
  const set = new Set<number>();
  const add = (n: number): void => { if (Number.isFinite(n)) set.add(n); };
  add(d.totalSKUs); add(d.totalQty); add(d.totalValue);
  add(d.criticalCount); add(d.lowCount); add(d.healthyCount); add(d.deadCount);
  const addSizeDigits = (size: string): void => {
    const tokens = size.match(/\d+/g);
    if (!tokens) return;
    for (const t of tokens) add(parseInt(t, 10));
  };
  for (const s of d.topSelling) { add(s.count); addSizeDigits(s.size); }
  for (const s of d.slowMovers) {
    add(s.qty);
    if (s.daysSinceLastJob !== null) add(s.daysSinceLastJob);
    addSizeDigits(s.size);
  }
  for (const t of d.topReserved) {
    add(t.reserved); add(t.available); addSizeDigits(t.size);
  }
  return set;
}

export function parseInventoryInsightsResponse(
  text: string,
  digest: InventoryInsightsDigest,
): InventoryInsightsResult {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return { ok: false, error: 'unparseable' };
  let obj: unknown;
  try {
    obj = JSON.parse(match[0]);
  } catch {
    return { ok: false, error: 'unparseable' };
  }
  const raw = (obj as { bullets?: unknown }).bullets;
  if (!Array.isArray(raw)) return { ok: false, error: 'malformed' };

  const numbers = digestNumbers(digest);
  const seen = new Set<string>();
  const bullets: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const bullet = item.trim();
    if (!bullet || seen.has(bullet)) continue;
    const tokens = bullet.match(/\d[\d,]*(?:\.\d+)?/g);
    if (!tokens) continue;
    const grounded = tokens.every((t) => numbers.has(parseFloat(t.replace(/,/g, ''))));
    if (!grounded) continue;
    seen.add(bullet);
    bullets.push(bullet);
    if (bullets.length >= MAX_BULLETS) break;
  }
  if (!bullets.length) return { ok: false, error: 'ungrounded' };
  return { ok: true, bullets };
}
