// src/lib/ops/loops/brief.ts
// ═══════════════════════════════════════════════════════════════════
//  Loop 3 — Daily brief (READ-ONLY).
//
//  Summarizes the day and week: jobs, revenue, profit, top sizes by job
//  count, out-of-stock in-demand sizes (reorder flags), pending
//  payments / unpaid invoices, top lead sources (from job.source), and
//  asks the model for the single most important thing to act on today.
//
//  There is NO leads pipeline / "leads to call" (that tab was removed).
//  Lead-source attribution still lives on job.source and informs the
//  brief, but there is no prospect list — the prompt forbids inventing one.
// ═══════════════════════════════════════════════════════════════════

import type { Job, InventoryItem } from '@/types';
import { computeSizeDemand, computeInventoryIntel, sizeKey } from '@/lib/inventoryIntel';
import { safeParseJson, asString, type ParseResult } from '@/lib/ops/json';

export interface BriefContext {
  today: string; // YYYY-MM-DD (UTC)
  weekWindowDays: number;
  todayJobs: number;
  todayRevenue: number;
  todayProfit: number;
  weekJobs: number;
  weekRevenue: number;
  weekProfit: number;
  topSizes: Array<{ size: string; jobs: number }>;
  reorderFlags: Array<{ size: string; onHand: number; jobs: number }>;
  pendingPayments: { count: number; total: number };
  topSources: Array<{ source: string; jobs: number }>;
}

export interface DailyBrief {
  headline: string;
  summary: string;
  mostImportant: string;
}

const WEEK_DAYS = 7;
const REORDER_WINDOW_DAYS = 90;

function num(v: unknown): number {
  const n = typeof v === 'string' ? Number(v) : (v as number);
  return Number.isFinite(n) ? (n as number) : 0;
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function jobProfit(j: Job): number {
  return num(j.revenue) - num(j.tireCost) - num(j.materialCost) - num(j.miscCost) - num(j.partsCost);
}
function jobMs(j: Job): number {
  return Date.parse((j.date || '') + 'T00:00:00Z');
}

/**
 * Gather the daily-brief context from already-loaded MSOS data. Pure —
 * unit-testable with a fixed `now`.
 */
export function gatherBriefContext(
  jobs: ReadonlyArray<Job> | null | undefined,
  inventory: ReadonlyArray<InventoryItem> | null | undefined,
  opts: { now?: Date } = {},
): BriefContext {
  const now = opts.now ?? new Date();
  const jobsArr = jobs ?? [];
  const invArr = inventory ?? [];
  const todayIso = now.toISOString().slice(0, 10);
  const weekCutoff = now.getTime() - WEEK_DAYS * 86_400_000;

  let todayJobs = 0, todayRevenue = 0, todayProfit = 0;
  let weekJobs = 0, weekRevenue = 0, weekProfit = 0;
  const sourceCounts = new Map<string, number>();

  for (const j of jobsArr) {
    if (j.status !== 'Completed') continue;
    const rev = num(j.revenue);
    const profit = jobProfit(j);

    if (j.date === todayIso) {
      todayJobs += 1;
      todayRevenue += rev;
      todayProfit += profit;
    }
    const t = jobMs(j);
    if (Number.isFinite(t) && t >= weekCutoff) {
      weekJobs += 1;
      weekRevenue += rev;
      weekProfit += profit;
      const src = (j.source || '').trim() || 'Unknown';
      sourceCounts.set(src, (sourceCounts.get(src) ?? 0) + 1);
    }
  }

  // Top sizes this week by distinct job count (reuses computeSizeDemand).
  const weekDemand = computeSizeDemand(jobsArr, { windowDays: WEEK_DAYS, now });
  const displayByKey = new Map<string, string>();
  for (const j of jobsArr) {
    const raw = (j.tireSize || '').trim();
    if (!raw) continue;
    const key = sizeKey(raw);
    if (key && !displayByKey.has(key)) displayByKey.set(key, raw);
  }
  const topSizes = Array.from(weekDemand.entries())
    .sort((a, b) => b[1].jobs - a[1].jobs)
    .slice(0, 5)
    .map(([key, d]) => ({ size: displayByKey.get(key) ?? key, jobs: d.jobs }));

  // Reorder flags — out-of-stock in-demand sizes via existing intel.
  const reorderDemand = computeSizeDemand(jobsArr, { windowDays: REORDER_WINDOW_DAYS, now });
  const intel = computeInventoryIntel(
    invArr.map((i) => ({ id: i.id, size: i.size, qty: i.qty, cost: i.cost, reorderPoint: i.reorderPoint })),
    reorderDemand,
  );
  const reorderFlags = intel.reorderNow
    .slice(0, 5)
    .map((r) => ({ size: r.size, onHand: r.qty, jobs: r.jobs }));

  // Pending payments / unpaid invoices.
  let pendingCount = 0;
  let pendingTotal = 0;
  for (const j of jobsArr) {
    if (j.status === 'Cancelled') continue;
    if (j.paymentStatus === 'Pending Payment' || j.paymentStatus === 'Partial Payment') {
      pendingCount += 1;
      pendingTotal += num(j.revenue);
    }
  }

  const topSources = Array.from(sourceCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([source, jobs]) => ({ source, jobs }));

  return {
    today: todayIso,
    weekWindowDays: WEEK_DAYS,
    todayJobs,
    todayRevenue: round2(todayRevenue),
    todayProfit: round2(todayProfit),
    weekJobs,
    weekRevenue: round2(weekRevenue),
    weekProfit: round2(weekProfit),
    topSizes,
    reorderFlags,
    pendingPayments: { count: pendingCount, total: round2(pendingTotal) },
    topSources,
  };
}

/** Build the JSON-only prompt for the daily brief. */
export function buildBriefPrompt(ctx: BriefContext, businessName: string): { system: string; user: string } {
  const system = [
    `You are an operations assistant for ${businessName}, a mobile tire repair service in Broward and Miami Dade.`,
    `Summarize the day and week for the owner from the data provided.`,
    ``,
    `Return ONLY a JSON object, no prose, no code fences, in exactly this shape:`,
    `{"headline":"<one short line>","summary":"<2 to 4 sentences>","mostImportant":"<the single most important thing to act on today>"}`,
    ``,
    `Rules:`,
    `- Use ONLY the numbers provided. Do not invent jobs, revenue, sizes, or customers.`,
    `- summary should touch on jobs, revenue, profit, top sizes, reorder flags, and unpaid invoices where relevant.`,
    `- mostImportant is the one action that matters most today (e.g. reorder an out-of-stock hot size, or collect a large unpaid invoice).`,
    `- Do NOT mention a leads pipeline or "leads to call" — there is no prospect list. Lead-source counts are for context only.`,
    `- Output nothing except the JSON object.`,
  ].join('\n');

  const user = JSON.stringify(ctx, null, 2);
  return { system, user };
}

/** Safely parse + validate the model's daily brief. */
export function parseBriefResult(raw: string): ParseResult<DailyBrief> {
  const parsed = safeParseJson<unknown>(raw);
  if (!parsed.ok) return parsed;

  const root = parsed.value as Record<string, unknown>;
  const headline = asString(root?.headline);
  const summary = asString(root?.summary);
  const mostImportant = asString(root?.mostImportant);
  if (!headline && !summary && !mostImportant) {
    return { ok: false, error: 'brief had no usable fields' };
  }
  return { ok: true, value: { headline, summary, mostImportant } };
}
